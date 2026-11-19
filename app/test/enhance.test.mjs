import test from 'node:test';
import assert from 'node:assert/strict';
import { procedureDocs } from '../flows/docset.mjs';
import { lawVersions } from '../flows/lawversions.mjs';
import { loadProcedures } from '../flows/procedure.mjs';

const base = { title: '가공단 복무규정', kind: '일부개정', reasonSummary: '상위법 개정 반영', points: ['배우자 출산휴가 20일(제7조)'], changes: 1 };

test('public institution procedure docs include consult, labor opinion, council and board agenda, promulgation', () => {
  const s = procedureDocs({ ...base, profile: { type: 'public-institution', name: '가공단', council: '규정심의위원회', approver: '이사장' }, labor: true });
  const ids = s.map((x) => x.id);
  for (const k of ['consult_letter', 'labor_opinion', 'legal_review', 'council_agenda', 'board_agenda', 'promulgation']) assert.ok(ids.includes(k), k);
  assert.match(s.find((x) => x.id === "labor_opinion").body, /근로기준법」? 제94조/);
  assert.match(s.find((x) => x.id === 'council_agenda').body, /규정심의위원회/);
});

test('local government docs include an assembly bill and a promulgation notice', () => {
  const s = procedureDocs({ ...base, title: '○○시 복무 조례', profile: { type: 'local-gov', name: '○○시', approver: '시장' }, labor: false });
  const ids = s.map((x) => x.id);
  assert.ok(ids.includes('assembly_bill')); assert.ok(!ids.includes('board_agenda')); assert.ok(!ids.includes('labor_opinion'));
  assert.match(s.find((x) => x.id === 'promulgation').body, /공포한다/);
});

test('every doc key referenced by procedure templates is producible', () => {
  const producible = new Set(['draft', 'comparison', 'full_text', 'reason', 'addenda', 'notice', 'corrections', 'checklist', 'evidence', ...['public-institution', 'central-ministry', 'local-gov'].flatMap((type) => procedureDocs({ ...base, profile: { type }, labor: true, regKind: type === 'local-gov' ? '조례' : undefined }).map((x) => x.id))]);
  for (const t of Object.values(loadProcedures())) for (const st of t.steps) for (const d of st.docs) assert.ok(producible.has(d), `${t.type}:${st.id}:${d}`);
});

test('lawVersions lists article versions newest first and picks current vs last different version', async () => {
  const v = (date, state, body) => ({ doc_id: `legal:연혁/x/${date}.md`, doc_title: '남녀고용평등과 일·가정 양립 지원에 관한 법률', art_ref: '제18조의2', edition_state: state, effective_from: date, effective_to: null, body });
  const rows = [v('20250223', 'superseded', '10일의 휴가'), v('20260918', 'current', '20일의 휴가'), v('20260820', 'superseded', '20일의 휴가'), v('20261127', 'scheduled', '20일의 휴가 개정예정'), { ...v('20260918', 'current', 'x'), doc_title: '다른 법', art_ref: '제18조의2' }];
  const art = (id) => rows.find((r) => r.doc_id === id && r.doc_title.startsWith('남녀'));
  const sources = { rest: { search: async (q) => { assert.equal(q.all_versions, true); return { rows }; } }, loadDoc: async (id) => ({ doc_id: id, title: art(id).doc_title, articles: [{ ref: '제18조의2', section: '본칙', title: '배우자 출산휴가', body: art(id).body + ' 전문' }] }) };
  const r = await lawVersions(sources, { name: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', ref: '제18조의2', topic: '배우자 출산' });
  assert.deepEqual(r.versions.map((x) => x.effective_from), ['20261127', '20260918', '20260820', '20250223']);
  assert.equal(r.after.effective_from, '20260918'); assert.equal(r.before.effective_from, '20250223');
  assert.match(r.before.text, /10일의 휴가 전문/);
});

test('agent analyze_impact pulls before/after text from law versions when only law and ref are given', async () => {
  const { TOOLS } = await import('../flows/tools.mjs');
  let got = null;
  const rows = [{ doc_id: 'legal:a', doc_title: '테스트법', art_ref: '제3조', edition_state: 'current', effective_from: '20260101', body: '' }, { doc_id: 'legal:b', doc_title: '테스트법', art_ref: '제3조', edition_state: 'superseded', effective_from: '20250101', body: '' }];
  const deps = { sources: { rest: { search: async () => ({ rows }) }, loadDoc: async (id) => ({ articles: [{ ref: '제3조', section: '본칙', body: id === 'legal:a' ? '20일' : '10일' }] }) }, flows: { impact: async (ctx) => { got = ctx.input; return { candidates: [] }; } } };
  await TOOLS.analyze_impact.run({ law_name: '테스트법', ref: '제3조' }, deps, { params: {} }, { input: { message: 'x', profile: {} } });
  assert.equal(got.before.text, '10일'); assert.equal(got.after.text, '20일');
});
