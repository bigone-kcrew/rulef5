import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRegulationText } from '../lib/parse.mjs';
import { hwpxToText } from '../lib/unzip.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { runCheck, checkDocs } from '../flows/check.mjs';
import { findDelegations, runLawChain } from '../flows/lawchain.mjs';

const ERR = parseRegulationText(hwpxToText(readFileSync(new URL('./fixtures/인용오류_예시규정.hwpx', import.meta.url))), { doc_id: 'upload:cccccccccccccccc/0' });
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };

test('checkDocs finds broken references, mixed terms and numeric conflicts', () => {
  const f = checkDocs([ERR], {});
  const broken = f.filter((x) => x.type === 'broken_ref');
  assert.ok(broken.some((x) => x.ref === '제7조' && /제99조/.test(x.message)));
  assert.ok(broken.some((x) => x.ref === '제5조' && /별표 3/.test(x.message)));
  const term = f.filter((x) => x.type === 'term');
  assert.ok(term.some((x) => /임직원|종업원/.test(x.message)));
  const conflict = f.filter((x) => x.type === 'conflict');
  assert.ok(conflict.some((x) => /7일/.test(x.message) && /10일/.test(x.message)));
  assert.ok(conflict.every((x) => x.severity === 'check'));
});

test('external regulation missing from an institution bundle is flagged for confirmation', () => {
  const f = checkDocs([ERR], { wholeInstitution: true });
  assert.ok(f.some((x) => x.type === 'missing_reg' && /인사규정/.test(x.message)));
});

test('check flow runs on uploaded documents without a model', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('check', { doc_ids: [ERR.doc_id], auto: true }, runCheck, { deps: { sources: { loadDoc: async () => ERR }, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.ok(j.result.findings.length >= 3);
  assert.equal(j.result.stats.docs, 1);
});

test('findDelegations detects presidential decree and ordinance delegations', () => {
  const d = findDelegations('② 휴가의 신청방법 및 절차 등은 대통령령으로 정한다.\n③ 세부 사항은 조례로 정할 수 있다.\n④ 장관이 정하여 고시한다.');
  assert.deepEqual(d.map((x) => x.level), ['시행령', '자치법규', '고시']);
});

test('law chain links statute article to decree articles citing it and institution rules', async () => {
  const law = { doc_id: 'law:law:1', title: '테스트법', source: 'law', articles: [{ ref: '제18조의2', no: 18, sub: 2, title: '배우자 출산휴가', body: '① 20일의 휴가를 주어야 한다.\n④ 신청방법은 대통령령으로 정한다.', section: '본칙' }] };
  const dec = { doc_id: 'law:law:2', title: '테스트법 시행령', source: 'law', articles: [{ ref: '제9조의2', no: 9, sub: 2, title: '배우자 출산휴가의 신청', body: '법 제18조의2제4항에 따라 신청한다.', section: '본칙' }, { ref: '제10조', no: 10, title: '기타', body: '법 제20조에 따른다.', section: '본칙' }] };
  const sources = { loadDoc: async (id) => (id === law.doc_id ? law : dec), searchLaw: async (q) => ({ rows: /시행령/.test(q) ? [{ doc_id: dec.doc_id, title: dec.title, source: '법제처' }] : [], errors: [] }), searchRegs: async () => ({ rows: [{ doc_id: 'bylaws:a', inst_name: '가공단', doc_title: '복무규정', art_ref: '제7조', art_title: '휴가', body: '「테스트법」 제18조의2에 따른 휴가', edition_state: 'current' }] }), lawGo: { enabled: true }, mcp: { enabled: false }, related: async () => null };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('lawchain', { law_doc_id: law.doc_id, ref: '제18조의2', auto: true }, runLawChain, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const levels = j.result.chain.map((c) => `${c.level}:${c.ref}`);
  assert.ok(levels.includes('법률:제18조의2')); assert.ok(levels.includes('시행령:제9조의2')); assert.ok(!levels.includes('시행령:제10조'));
  assert.ok(levels.includes('기관 규정:제7조'));
});

test('missing regulation findings are dropped when the regulation exists in ALIO', async () => {
  const doc = { ...ERR, inst: '라마바재단' };
  const sources = { searchRegs: async (q) => ({ rows: q.keyword === '목적' ? [{ doc_id: ERR.doc_id }] : [{ doc_id: 'bylaws:y', doc_title: '라마바재단 인사규정' }] }), loadDoc: async () => doc };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('check', { inst: '라마바재단' }, runCheck, { deps: { sources, llm: null } }));
  assert.equal(j.result.findings.filter((x) => x.type === 'missing_reg').length, 0);
});
