// 대화로 요청(에이전트) 회귀 평가: 실제 요청 문장을 여러 번 돌려 자동 판정한다 — 한 번 통과가 아니라 「몇 번 중 몇 번」으로 본다.
// node app/scripts/agent-eval.mjs [preset[:model]] [반복=2] [사례ID,...]
// 판정: 끝까지 실행 · 맞는 기관·규정 · (기대 시) 맞는 조문/새 조문 · 법령 위임 문장 없음 · 법률 주체(사업주) 새로 넣지 않음 · 관계없는 조문에 끼워 넣지 않음 · 의도의 수치 반영 · 이유서 조 번호 일치
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { createSources } from '../lib/sources.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { resolveLlmConfig, createLlm } from '../lib/llm.mjs';
import { loadProcedures } from '../flows/procedure.mjs';
import { FLOWS } from '../flows/index.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, '.private', 'app.env')]) loadEnv(f);
const [spec = 'openrouter:openai/gpt-oss-120b', repArg = '2', only = ''] = process.argv.slice(2);
const [preset, model] = spec.split(/:(.+)/);
const llm = createLlm(resolveLlmConfig(process.env, { preset, model }));
const sources = createSources(process.env, fetch, { cacheDir: join(root, 'app', 'var', 'cache') });
const deps = { sources, llm, env: process.env, procedures: loadProcedures() };
const PUB = { name: '예시 공공기관', type: 'public-institution' };
const CASES = [
  { id: 'A1', msg: '창업진흥원 취업규칙의 배우자 출산휴가를 남여고용평등법 개정에 맞게 고쳐야해', inst: '창업진흥원', doc: /^취업규칙$/, op: 'insert', sibling: true, topic: '배우자' },
  { id: 'A2', msg: '창업진흥원 복무규정 배우자 출산휴가를 남녀고용평등법 개정에 맞게 고쳐줘', inst: '창업진흥원', doc: /^복무규정$/, refs: ['제44조의2'], topic: '배우자' },
  { id: 'A3', msg: '창업진흥원 복무규정에서 배우자 출산휴가를 출산예정일 50일 전부터 쓸 수 있게 해줘', inst: '창업진흥원', doc: /^복무규정$/, refs: ['제44조의2'], nums: ['50일'], topic: '배우자' },
  { id: 'A4', msg: '소상공인시장진흥공단 복무규정의 배우자 출산휴가를 20일로 늘려줘', inst: '소상공인시장진흥공단', doc: /복무규정/, nums: ['20일'], topic: '배우자' },
  { id: 'A5', msg: '창업진흥원 여비규정에서 국내출장 숙박비 상한을 올려야 해. 어떻게 고치면 될까', inst: '창업진흥원', doc: /여비/, topic: '숙박' },
];
const sel = only ? CASES.filter((c) => only.split(',').includes(c.id)) : CASES;
const reps = Math.max(1, +repArg || 2);
const DELEG = /(대통령령|총리령|[가-힣]{2,10}부령)으로\s*정한다/;
function judge(c, j) {
  const f = [], r = j.result || {};
  if (j.status !== 'done') return [`실행 실패: ${j.error?.code} ${j.error?.message || ''}`];
  const doc = r.doc || {};
  if (c.inst && doc.inst !== c.inst) f.push(`기관 다름: ${doc.inst}`);
  if (c.doc && !c.doc.test(String(doc.title || ''))) f.push(`규정 다름: ${doc.title}`);
  const ch = (r.changes || []).filter((x) => x.reason !== '조 번호 이동에 따른 인용 정정');
  if (!ch.length) { f.push('변경 없음'); return f; }
  if (c.refs && !c.refs.every((ref) => ch.some((x) => x.ref === ref))) f.push(`대상 조문 다름: ${ch.map((x) => `${x.op} ${x.ref}`).join(', ')}`);
  if (c.op && !ch.some((x) => x.op === c.op)) f.push(`변경 방식 다름: ${ch.map((x) => x.op).join(',')}`);
  if (c.sibling && !r.sibling) f.push('다른 규정에 이미 있다는 안내 없음');
  for (const x of ch) {
    const nw = String(x.new || ''), old = String(x.old || '');
    if (DELEG.test(nw) && !DELEG.test(old)) f.push(`${x.ref}: 법령 위임 문장`);
    if (nw.includes('사업주') && !old.includes('사업주')) f.push(`${x.ref}: 「사업주」를 새로 씀`);
    if (c.topic && x.op === 'amend' && nw.includes(c.topic) && !old.includes(c.topic) && !String(x.title || '').includes(c.topic)) f.push(`${x.ref}(${x.title}): 관계없는 조문에 끼워 넣음`);
  }
  for (const n of c.nums || []) if (!ch.some((x) => String(x.new || '').includes(n))) f.push(`수치 ${n} 없음`);
  const reason = (r.docset?.sections || []).find((s) => s.id === 'reason')?.body || '';
  for (const m of new Set(reason.match(/제\d+조(?:의\d+)?/g) || [])) if (!ch.some((x) => x.ref === m || x.new_ref === m) && !ch.some((x) => x.op === 'insert') && !/인용|따라/.test(reason)) f.push(`이유서의 ${m} 가 변경 조문과 다름`);
  return f;
}
const jobs = createJobs({ maxConcurrent: 3 });
const runOne = async (c) => { const t0 = Date.now(); const id = jobs.start('agent', { auto: true, message: c.msg, profile: c.profile || PUB }, FLOWS.agent, { deps }); for (;;) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return { j, secs: Math.round((Date.now() - t0) / 1000) }; await new Promise((r) => setTimeout(r, 400)); } };
const tasks = sel.flatMap((c) => Array.from({ length: reps }, (_, k) => ({ c, k })));
const out = []; let next = 0;
await Promise.all([0, 1, 2].map(async () => { while (next < tasks.length) { const { c, k } = tasks[next++]; const { j, secs } = await runOne(c); const fails = judge(c, j); out.push({ id: c.id, rep: k + 1, ok: !fails.length, secs, fails, doc: j.result?.doc?.title || null, changes: (j.result?.changes || []).map((x) => `${x.op} ${x.ref}`) }); console.log(`${c.id}#${k + 1} ${fails.length ? 'NG' : 'OK'} ${secs}s ${fails.join(' / ')}`); } }));
console.log('\n사례별 통과');
for (const c of sel) { const xs = out.filter((o) => o.id === c.id); console.log(`${c.id} ${xs.filter((o) => o.ok).length}/${xs.length}  ${c.msg}`); }
const ok = out.filter((o) => o.ok).length; console.log(`\n전체 ${ok}/${out.length}`);
mkdirSync('/tmp/regitda', { recursive: true }); writeFileSync('/tmp/regitda/agent-eval.json', JSON.stringify(out, null, 1));
