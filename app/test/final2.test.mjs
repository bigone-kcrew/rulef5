// 최종 검토(보강분) 지적 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations } from '../lib/refs.mjs';
import { parseRegulationText as P } from '../lib/parse.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { runBulk, findPoints } from '../flows/bulk.mjs';
import { runOpinions } from '../flows/opinions.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runRadar } from '../flows/radar.mjs';
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });

test('F1 bulk never touches addenda articles that share a number with a main article', async () => {
  const d = P('가 규정\n제1조(목적) 근로자의 복무를 정한다.\n부 칙\n제1조(시행일) 이 규정은 공포한 날부터 시행한다.', { doc_id: 'u1', title: '가 규정' });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('bulk', { doc_ids: ['u1'], find: '근로자', replace: '임직원', auto: true }, runBulk, { deps: { sources: { loadDoc: async () => d } } }));
  const draft = j.result.docset.sections.find((s) => s.id === 'draft').body;
  assert.equal((draft.match(/제1조 중/g) || []).length, 1);
  assert.doesNotMatch(JSON.stringify(j.result.docset), /임직원의 날부터/);
});
test('F2 continuation only after an article-numbered external citation and with pure connectors', () => {
  const k = (s) => extractCitations(s).filter((c) => c.no).map((c) => `${c.kind}:${c.no}`);
  assert.deepEqual(k('「개인정보 보호법」 및 제5조에 따른다'), ['article:5']);
  assert.deepEqual(k('「A법」 제3조에 따른 직원 또는 제5조제2항'), ['external:3', 'article:5']);
  assert.deepEqual(k('「A법」 제3조(정의), 제5조'), ['external:3', 'article:5']);
  assert.deepEqual(k('「A법」 제3조, 제5조'), ['external:3', 'external:5']);
});
test('F3 same-document expressions are internal', () => {
  const k = (s) => extractCitations(s).map((c) => c.kind);
  assert.deepEqual(k('이 정관 제5조'), ['article']); assert.deepEqual(k('본 규정 제4조'), ['article']); assert.deepEqual(k('당해 규정 제4조'), ['article']);
});
test('F5 two opinions on the same article are flagged as conflicting, not both silently applied', async () => {
  const CH = [{ op: 'amend', ref: '제7조', title: 't', old: '① 10일.', new: '① 20일.' }];
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply({ items: [{ id: 'O1', target_ref: '제7조', proposal: 'accept', reason: 'a', revised_text: '① 25일.' }, { id: 'O2', target_ref: '제7조', proposal: 'accept', reason: 'b', revised_text: '① 30일.' }] }) });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('opinions', { title: 'X', changes: CH, opinions_text: '[a] x\n\n[b] y', auto: true }, runOpinions, { deps: { llm, sources: {} } }));
  const rev = j.result.docset.sections.find((s) => s.id === 'opinion_review').body;
  assert.match(rev, /같은 조문/);
  assert.equal(j.result.items.filter((x) => x.applied).length, 1);
});
test('F6 bulk definition terms with 이란 are not treated as compounds; overlapping finds skipped', () => {
  const d = P('가 규정\n제2조(정의) "직원이란" 사람을 말한다. 직원직원은 없다.', { doc_id: 'u2', title: '가' });
  const pts = findPoints(d, '직원', '임직원');
  assert.ok(pts.some((p) => p.word.startsWith('직원이란') && !p.compound));
  const starts = pts.map((p) => p.index).sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 2);
});
test('F7 radar keeps other laws when one law fails to load and reports failure in the plan', async () => {
  const sources = { rest: { search: async (q) => (q.keyword === '실패법' ? { rows: [{ doc_id: 'legal:f1', doc_title: '실패법', edition_state: 'current', effective_from: '20260101' }, { doc_id: 'legal:f2', doc_title: '실패법', edition_state: 'scheduled', effective_from: '20270101' }] } : { rows: [] }) }, loadDoc: async () => { throw new Error('down'); }, searchRegs: async () => ({ rows: [] }) };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['실패법', '다른법'] }, runRadar, { deps: { sources } }));
  assert.equal(j.status, 'done'); assert.match(j.result.plan_text, /조회 실패/);
});
