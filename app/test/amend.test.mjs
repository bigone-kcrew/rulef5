import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRegulationText } from '../lib/parse.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runAmend } from '../flows/amend.mjs';
import { keywords } from '../lib/text.mjs';

const SAMPLE = parseRegulationText(readFileSync(new URL('./fixtures/복무규정_예시.md', import.meta.url), 'utf8'), { doc_id: 'upload:aaaaaaaaaaaaaaaa/0' });
export const mockSources = (extra = {}) => ({
  loadDoc: async (id) => { if (id === SAMPLE.doc_id) return SAMPLE; throw Object.assign(new Error('없음'), { status: 404 }); },
  searchRegs: async () => ({ rows: [{ doc_id: 'bylaws:b', inst_name: '다른공단', doc_title: '복무규정', art_ref: '제20조', art_title: '특별휴가', body: '배우자 출산휴가는 20일로 한다.', edition_state: 'current' }], degraded: null }),
  searchLaw: async () => ({ rows: [], errors: [] }),
  rest: { search: async () => ({ rows: [{ doc_id: 'legal:law', doc_title: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', art_ref: '제18조의2', art_title: '배우자 출산전후휴가', body: '사업주는 ... 20일의 휴가를 주어야 한다.', edition_state: 'current' }] }) },
  lawGo: { enabled: false },
  ...extra,
});
const reply = (obj) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }] }) });
const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const input = { doc_id: SAMPLE.doc_id, intent: '배우자 출산휴가를 법 개정에 맞게 20일로 늘린다', auto: true, profile: { type: 'public-institution', name: '가나다공단' } };

test('keywords drop particles and stopwords', () => {
  const k = keywords('우리 복무규정 배우자 출산휴가를 법 개정에 맞게 20일로 고쳐야 해');
  assert.ok(k.includes('출산휴가')); assert.ok(k.includes('배우자')); assert.ok(!k.includes('고쳐야'));
});

const GOOD = { changes: [{ op: 'amend', ref: '제7조', title: '특별휴가', new_text: '① 공단은 직원에게 별표 1의 경조사휴가를 준다.\n② 공단은 배우자가 출산한 직원에게 20일의 배우자 출산휴가를 주어야 한다. 이 경우 출산한 날부터 120일 이내에 청구하여야 하며, 3회에 한하여 나누어 사용할 수 있다.\n③ 제2항의 휴가 기간은 유급으로 한다.', reason: '상위법 개정 반영', basis_ids: ['E2'] }, { op: 'insert', after: '제7조', title: '배우자 출산휴가의 신청', new_text: '배우자 출산휴가는 출산예정일 50일 전부터 사용할 수 있다.', reason: '사용 시기 명확화', basis_ids: ['E2'] }], reason_summary: '남녀고용평등법 개정에 따라 배우자 출산휴가를 20일로 확대한다.', main_points: ['배우자 출산휴가 20일로 확대(제7조)'], addenda: { effective: '이 규정은 발령한 날부터 시행한다.', transition: '' }, checks: ['노동조합 협의 필요 여부 확인'] };

test('amend flow produces comparison rows, citing articles and full document set', async () => {
  const jobs = createJobs();
  const id = jobs.start('amend', { ...input, renumber: true }, runAmend, { deps: { sources: mockSources(), llm: llmOf({ refs: ['제7조'], why: '배우자 출산휴가' }, GOOD) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const ds = j.result.docset, ids = ds.sections.map((s) => s.id);
  for (const k of ['draft', 'comparison', 'reason', 'addenda', 'notice', 'corrections', 'checklist']) assert.ok(ids.includes(k), k);
  const rows = ds.sections.find((s) => s.id === 'comparison').rows;
  assert.ok(rows.some((r) => /<u>20일의<\/u>/.test(r.newHtml)));
  assert.ok(rows.some((r) => r.oldHtml === '&lt;신 설&gt;' && /제8조\(배우자 출산휴가의 신청\)/.test(r.newHtml)));
  // 제8조 신설(조 번호 이동) → 제9조 본문의 "제7조 및 제8조" 인용 정정
  assert.ok(j.result.corrections.some((c) => c.ref === '제9조' && /제7조 및 제9조/.test(c.after)));
  assert.ok(ds.evidence.length >= 2);
  for (const k of ['consult_letter', 'labor_opinion', 'council_agenda', 'board_agenda', 'promulgation']) assert.ok(j.result.docKeys.includes(k), k);
  assert.match(ds.sections.find((s) => s.id === 'draft').body, /일부를 다음과 같이 개정한다/);
});

test('model citing a non-existent article fails the drafting step after retry', async () => {
  const bad = { ...GOOD, changes: [{ op: 'amend', ref: '제99조', title: 'x', new_text: '가', reason: 'r', basis_ids: [] }] };
  const jobs = createJobs();
  const id = jobs.start('amend', { ...input, refs: ['제7조'] }, runAmend, { deps: { sources: mockSources(), llm: llmOf(bad) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'llm_invalid');
  assert.equal(j.steps.find((s) => s.name === '수정안 작성').state, 'failed');
});

test('without a model amend fails at once with a clear message (no searches, no questions first)', async () => {
  const jobs = createJobs();
  const id = jobs.start('amend', { ...input }, runAmend, { deps: { sources: mockSources(), llm: null } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'llm_missing'); assert.match(j.error.message, /모델 설정/);
  assert.equal(j.steps.length, 0);
});

test('evidence search failure is reported, not treated as no evidence', async () => {
  const down = async () => { throw Object.assign(new Error('ALIO 조회에 실패했습니다.'), { code: 'source_unavailable' }); };
  const jobs = createJobs();
  const id = jobs.start('amend', { ...input, refs: ['제7조'] }, runAmend, { deps: { sources: mockSources({ searchRegs: down, rest: { search: down } }), llm: llmOf({ ...GOOD, changes: GOOD.changes.map((c) => ({ ...c, basis_ids: [] })) }) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done');
  assert.match(j.steps.find((s) => s.name === '근거 조사').note, /조회 실패/);
  assert.ok(j.result.docset.sections.find((s) => s.id === 'checklist').body.includes('근거 조사 일부 실패'));
});

test('lawNames extracts statute names and abbreviations from intent', async () => {
  const { lawNames } = await import('../lib/text.mjs');
  assert.deepEqual(lawNames('남녀고용평등법 개정에 맞춰 배우자 출산휴가를 늘린다'), ['남녀고용평등법']);
  assert.deepEqual(lawNames('「근로기준법 시행령」 제5조와 지방자치법에 따라'), ['근로기준법 시행령', '지방자치법']);
  assert.deepEqual(lawNames('출산휴가를 늘린다'), []);
});

test('a draft identical to the current text is reported as nothing to change', async () => {
  const a7 = SAMPLE.articles.find((a) => a.ref === '제7조');
  const same = { ...GOOD, changes: [{ op: 'amend', ref: '제7조', title: a7.title, new_text: a7.body, reason: '이미 반영', basis_ids: ['E2'] }] };
  const jobs = createJobs();
  const id = jobs.start('amend', { ...input, refs: ['제7조'] }, runAmend, { deps: { sources: mockSources(), llm: llmOf(same) } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.no_change, { refs: ['제7조'] });
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /수정안이 현행과 같습니다\(제7조\)/);
  const good = createJobs(); const gid = good.start('amend', { ...input, refs: ['제7조'] }, runAmend, { deps: { sources: mockSources(), llm: llmOf(GOOD) } });
  assert.equal((await until(good, gid)).result.no_change, null);
});
