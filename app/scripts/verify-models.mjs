// 모델 비종속 검증: 같은 시나리오(개정·제정·대화형 에이전트)를 여러 모델로 실행해 결과를 기록한다.
// 사용: node app/scripts/verify-models.mjs exaone nim:nvidia/nemotron-3-ultra-550b-a55b openrouter:openai/gpt-oss-120b
// 결과: docs/model-verification/<모델>.json (키는 기록하지 않음)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { createSources } from '../lib/sources.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { resolveLlmConfig, createLlm } from '../lib/llm.mjs';
import { loadProcedures } from '../flows/procedure.mjs';
import { FLOWS } from '../flows/index.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, 'app', '.env'), join(root, '.env'), join(root, '.private', 'app.env')]) loadEnv(f);
const PROFILE = { type: 'public-institution', name: '대구경북첨단의료산업진흥재단', effective_default: '이 규정은 발령한 날부터 시행한다.' };
const SCENARIOS = [
  ['개정', 'amend', { doc_id: 'bylaws:[보건복지부]대구경북첨단의료산업진흥재단_C0894/취업규칙_20230807.md', intent: '남녀고용평등법 개정에 맞춰 배우자 출산휴가를 20일로 늘리고 청구기간을 120일로 바꾼다' }, (r) => r.docset.sections.find((s) => s.id === 'comparison').rows.some((x) => /20일/.test(x.newHtml)) && r.changes.some((c) => c.ref === '제79조')],
  ['제정', 'enact', { kind: '지침', title: '가나다공단 직장 내 괴롭힘 예방 및 처리 지침', purpose: '직장 내 괴롭힘의 예방 교육, 신고 접수, 조사, 피해자 보호와 행위자 조치 절차를 정한다', delegations: [{ doc_id: 'legal:노동법령/근로기준법(2026.10.8. 시행).md', ref: '제76조의3' }] }, (r) => r.articles.length >= 5 && r.docset.sections.some((s) => s.id === 'reason')],
  ['대화형 에이전트', 'agent', { message: '대구경북첨단의료산업진흥재단 취업규칙의 배우자 출산휴가를 남녀고용평등법 개정에 맞게 20일로 고쳐야 해' }, (r) => !!r.docset && r.changes?.some((c) => c.ref === '제79조')],
];
const sources = createSources(process.env, fetch, { cacheDir: join(root, 'app', 'var', 'cache') });
mkdirSync(join(root, 'docs', 'model-verification'), { recursive: true });
await Promise.all(process.argv.slice(2).map(async (spec) => {
  const [preset, model] = spec.split(/:(.+)/);
  const cfg = resolveLlmConfig(process.env, { preset, model });
  const out = { model: cfg.model, preset, date: new Date().toISOString(), runs: [] };
  for (const [name, type, input, check] of SCENARIOS) {
    const jobs = createJobs(), t0 = Date.now();
    const id = jobs.start(type, { ...input, auto: true, profile: PROFILE }, FLOWS[type], { deps: { sources, llm: createLlm(cfg), env: process.env, procedures: loadProcedures() } });
    let j; for (;;) { j = jobs.get(id); if (['done', 'failed'].includes(j.status)) break; if (j.status === 'waiting') jobs.answer(id, j.gate.id, (j.gate.options || []).filter((o) => o.checked).map((o) => o.value)); await new Promise((r) => setTimeout(r, 500)); }
    let ok = false; try { ok = j.status === 'done' && !!check(j.result); } catch { ok = false; }
    out.runs.push({ scenario: name, status: j.status, check_passed: ok, seconds: +((Date.now() - t0) / 1000).toFixed(1), error: j.error, steps: j.steps.map((s) => `${s.state} ${s.name}: ${(s.note || '').split('\n')[0].slice(0, 160)}`), excerpt: j.result?.docset?.sections?.find((s) => s.id === 'draft')?.body?.slice(0, 600) || null });
    console.log(spec, name, j.status, ok ? '검증 통과' : '검증 실패', out.runs.at(-1).seconds + 's');
  }
  writeFileSync(join(root, 'docs', 'model-verification', `${spec.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify(out, null, 1));
}));
