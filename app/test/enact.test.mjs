import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runEnact, checkDraft } from '../flows/enact.mjs';
import { parseRegulationText } from '../lib/parse.mjs';

const LAW = { doc_id: 'legal:lsa', title: '근로기준법', source: 'alio', edition: { state: 'current' }, articles: [{ ref: '제2조', no: 2, title: '정의', body: '"근로자"란 …', section: '본칙' }, { ref: '제93조', no: 93, title: '취업규칙의 작성·신고', body: '상시 10명 이상의 근로자를 사용하는 사용자는 다음 각 호의 사항에 관한 취업규칙을 작성하여야 한다.', section: '본칙' }] };
const REL = parseRegulationText('가공단 복무규정\n제1조(목적) 목적.\n제12조(재택근무) 재택근무는 별도로 정한다.', { doc_id: 'upload:bbbbbbbbbbbbbbbb/0', title: '가공단 복무규정' });
const sources = { loadDoc: async (id) => (id === LAW.doc_id ? LAW : id === REL.doc_id ? REL : Promise.reject(Object.assign(new Error('x'), { status: 404 }))), searchRegs: async () => ({ rows: [{ doc_id: 'bylaws:s', inst_name: '다공단', doc_title: '재택근무 운영지침', art_ref: '제3조', body: '재택근무는 주 2일 이내로 한다.', edition_state: 'current' }] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
// 요청 내용(과제)에 따라 응답을 고르는 모의 모델: 체계 → OUTLINE, 장별 조문 → CH, 이유·부칙 → META
const llmBy = ({ outline, chapter, meta }) => createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async (u, init) => { const c = JSON.parse(init.body).messages[1].content; return reply(c.includes('조문 체계(장·조 목차)를 설계') ? outline : c.includes('이 장의 조문') ? chapter : meta); } });
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const OUTLINE = { chapters: [{ title: '제1장 총칙', articles: [{ ref: '제1조', title: '목적', basis_ids: ['D1'] }, { ref: '제2조', title: '정의', basis_ids: [] }, { ref: '제3조', title: '대상', basis_ids: ['E1'] }] }] };
const CH = { articles: [{ ref: '제1조', title: '목적', text: '이 지침은 「근로기준법」 제93조에 따라 재택근무 운영에 필요한 사항을 정한다.', basis_ids: ['D1'] }, { ref: '제2조', title: '정의', text: '"재택근무"란 자택에서 근무하는 것을 말한다.', basis_ids: [] }, { ref: '제3조', title: '대상', text: '제2조에 따른 재택근무는 주 2일 이내로 한다.', basis_ids: ['E1'] }] };
const META = { other_amendments: [{ doc_id: REL.doc_id, ref: '제12조', new_text: '재택근무는 「가공단 재택근무 운영지침」에서 정한다.', reason: '지침 제정에 따른 정비' }], addenda: { effective: '이 지침은 발령한 날부터 시행한다.', transition: '' }, reason_summary: '재택근무 기준을 마련한다.', main_points: ['재택근무 대상(제3조)'], checks: [] };
const input = { kind: '지침', title: '가공단 재택근무 운영지침', purpose: '재택근무 신청·승인·복무관리 기준을 정한다', delegations: [{ doc_id: 'legal:lsa', ref: '제93조' }], related_doc_ids: [REL.doc_id], auto: true, profile: { type: 'public-institution', name: '가공단' } };

test('checkDraft warns on skipped numbers and dangling internal citations', () => {
  const w = checkDraft([{ ref: '제1조', title: 'a', text: '제7조에 따른다.' }, { ref: '제3조', title: 'b', text: '과태료를 부과한다.' }], []);
  assert.ok(w.some((x) => /번호/.test(x))); assert.ok(w.some((x) => /제7조/.test(x))); assert.ok(w.some((x) => /위임/.test(x)));
});

test('enact flow builds outline, draft and a document set with 신설 comparison and related-regulation table', async () => {
  const jobs = createJobs();
  const id = jobs.start('enact', input, runEnact, { deps: { sources, llm: llmBy({ outline: OUTLINE, chapter: CH, meta: META }) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const sec = Object.fromEntries(j.result.docset.sections.map((s) => [s.id, s]));
  assert.ok(sec.comparison.rows.every((r) => r.oldHtml === '&lt;신 설&gt;'));
  assert.equal(sec.comparison.rows.length, 3);
  assert.match(sec.draft.body, /^가공단 재택근무 운영지침\n/);
  assert.match(sec.draft.body, /제1조\(목적\) 이 지침은/);
  assert.match(sec.draft.body, /부 칙/);
  assert.ok(sec.comparison_other.rows[0].newHtml.includes('재택근무 운영지침'));
  assert.ok(sec.reason.body.includes('제정 이유'));
});

test('invalid basis id fails the drafting step after retry', async () => {
  const bad = { articles: CH.articles.map((a) => ({ ...a, basis_ids: ['Z9'] })) };
  const jobs = createJobs();
  const id = jobs.start('enact', input, runEnact, { deps: { sources, llm: llmBy({ outline: OUTLINE, chapter: bad, meta: META }) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'llm_invalid');
  assert.equal(j.steps.find((s) => s.name === '조문 초안 작성').state, 'failed');
});
