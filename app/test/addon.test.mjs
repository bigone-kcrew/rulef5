// 보강 기능 테스트(A1·A3·A2·C4·C3·C1·B1·C2·B2·V1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../lib/llm.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { classifySubject, checkDelegation } from '../flows/enact.mjs';
import { adverseChanges } from '../flows/amend.mjs';
import { procedureDocs } from '../flows/docset.mjs';
import { gatherEvidence, auditLabel, matchStandards } from '../flows/common.mjs';

const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
export const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
export const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };

// A1
test('A1 classifySubject separates external parties from staff', () => {
  assert.equal(classifySubject('이용자는 시설 이용 전에 신청서를 제출하여야 한다.'), 'external');
  assert.equal(classifySubject('직원은 출장 후 7일 이내에 복명서를 제출하여야 한다.'), 'internal');
  assert.equal(classifySubject('이 지침은 재택근무에 필요한 사항을 정한다.'), 'none');
});
const D = [{ id: 'D1', label: '○○법 제12조', text: '③ 시설 이용의 제한에 필요한 사항은 조례로 정한다.' }];
test('A1 internal duties need no delegation; external duties without delegation need basis', async () => {
  const arts = [{ ref: '제3조', title: '복명', text: '직원은 출장 후 복명서를 제출하여야 한다.' }, { ref: '제5조', title: '이용 제한', text: '이용자가 시설을 훼손하면 이용을 제한한다.' }];
  const r = await checkDelegation(arts, [], null, 'public-institution');
  assert.equal(r.find((x) => x.ref === '제3조').verdict, 'internal');
  assert.equal(r.find((x) => x.ref === '제5조').verdict, 'needs_basis');
});
test('A1 LLM verdict needs a real basis id and a quote present in the delegation text', async () => {
  const arts = [{ ref: '제5조', title: '이용 제한', text: '이용자가 시설을 훼손하면 이용을 제한한다.' }];
  const ok = await checkDelegation(arts, D, llmOf({ results: [{ ref: '제5조', verdict: 'within', basis_id: 'D1', quote: '시설 이용의 제한에 필요한 사항', reason: '위임 범위' }] }), 'local-gov');
  assert.equal(ok[0].verdict, 'within'); assert.equal(ok[0].basis_id, 'D1');
  const bad = await checkDelegation(arts, D, llmOf({ results: [{ ref: '제5조', verdict: 'within', basis_id: 'D1', quote: '없는 구절', reason: 'x' }] }), 'local-gov');
  assert.equal(bad[0].verdict, 'unverified');
  const none = await checkDelegation(arts, D, null, 'local-gov');
  assert.equal(none[0].verdict, 'unverified');
});

// A3
test('A3 adverseChanges flags benefit decreases, burden increases, may→must and deletions', () => {
  const ch = [
    { op: 'amend', ref: '제7조', title: '특별휴가', old: '배우자 출산휴가는 20일로 한다.', new: '배우자 출산휴가는 10일로 한다.' },
    { op: 'amend', ref: '제8조', title: '휴가', old: '배우자 출산휴가는 10일로 한다.', new: '배우자 출산휴가는 20일로 한다.' },
    { op: 'amend', ref: '제9조', title: '근무시간', old: '근무시간은 1일 8시간으로 한다.', new: '근무시간은 1일 9시간으로 한다.' },
    { op: 'amend', ref: '제10조', title: '교육', old: '직원은 교육을 받을 수 있다.', new: '직원은 교육을 받아야 한다.' },
    { op: 'delete', ref: '제11조', title: '수당', old: '자격수당을 지급한다.', new: '' },
  ];
  const a = adverseChanges(ch).map((x) => x.ref);
  assert.deepEqual(a, ['제7조', '제9조', '제10조', '제11조']);
});
test('A3 labor opinion form lists adverse candidates (no auto-check)', () => {
  const s = procedureDocs({ title: 'X 규정', kind: '개정', reasonSummary: 'r', points: [], profile: { type: 'public-institution' }, labor: true, adverse: [{ ref: '제7조', reasons: ['휴가 일수 감소'] }] });
  const body = s.find((x) => x.id === 'labor_opinion').body;
  assert.doesNotMatch(body, /■/); assert.match(body, /불리한 변경 후보: 제7조/);
});

// C4
test('C4 auditLabel builds audit name and year from rel_path', () => {
  assert.equal(auditLabel({ inst_name: '한국마사회', rel_path: '[농림축산식품부]한국마사회_C0185/B1220_감사원등지적사항/2022/2020년 감사원 “한국마사회 기관정기감사”/지적사항.md' }), '한국마사회 · 2020년 감사원 “한국마사회 기관정기감사” (2022 공시)');
});
const base = { rest: { search: async () => ({ rows: [] }) }, lawGo: { enabled: false } };
test('C4/A2 evidence includes audit findings filtered by doc_type and reports failures', async () => {
  const rows = [{ doc_id: 'disclosure:a', inst_name: '가공사', doc_type: '감사원등지적사항', doc_title: '지적사항', rel_path: '[부]가공사_C1/B1220_감사원등지적사항/2025/2024년 감사원 출장비 감사/지적사항.md', body: '출장비 정산 부적정' }, { doc_id: 'disclosure:b', inst_name: '가공사', doc_type: '재무성과', doc_title: '결산', rel_path: 'x', body: 'y' }];
  const sources = { ...base, searchRegs: async (q) => ({ rows: q.corpus === 'disclosure' ? rows : [] }) };
  const r = await gatherEvidence({ sources }, { query: '출장비 정산', audits: true });
  const au = r.evidence.filter((e) => e.kind === '지적사항');
  assert.equal(au.length, 1); assert.match(au[0].label, /2024년 감사원 출장비 감사/);
  const down = { ...base, searchRegs: async (q) => { if (q.corpus === 'disclosure') throw new Error('x'); return { rows: [] }; } };
  assert.ok((await gatherEvidence({ sources: down }, { query: '출장비', audits: true })).errors.includes('지적사항'));
});
test('A2 matchStandards finds registered upper standards by topic and says when none', () => {
  assert.ok(matchStandards('직장 내 괴롭힘 예방 지침').length >= 1);
  assert.ok(matchStandards('출장비 여비 정산').some((s) => /여비|회계/.test(s.name)));
  assert.equal(matchStandards('우주선 발사').length, 0);
});

// C3
import { caConflicts } from '../flows/ca-check.mjs';
const caRow = (title, body, inst = '가공단', rel = '[부]가공단_C1/단체협약/2026/단체협약서.md') => ({ doc_id: `ca:${title}`, inst_name: inst, doc_title: title, art_ref: '제40조', body, rel_path: rel, edition_basis: 'folder_year_approx' });
test('C3 flags differing values with article 96 note and no favorability judgment', async () => {
  const sources = { searchRegs: async () => ({ rows: [caRow('2025 단체협약', '조합원의 배우자 출산휴가는 25일로 한다.'), caRow('단체협약 신구대비표', '배우자 출산휴가 10일 → 25일'), caRow('2025 단체협약', '배우자 출산휴가 25일', '가공단노조연합')] }) };
  const r = await caConflicts(sources, { inst: '가공단', topic: '배우자 출산휴가', items: [{ ref: '제7조', text: '배우자 출산휴가는 20일로 한다.' }] });
  assert.equal(r.rows.length, 1); assert.match(r.rows[0].note, /제96조/); assert.doesNotMatch(r.rows[0].note, /유리/);
  assert.deepEqual(r.rows[0].ca_values, ['25일']);
});
test('C3 same values produce no rows; search failure is reported', async () => {
  const same = await caConflicts({ searchRegs: async () => ({ rows: [caRow('단체협약', '배우자 출산휴가는 20일로 한다.')] }) }, { inst: '가공단', topic: '배우자 출산휴가', items: [{ ref: '제7조', text: '배우자 출산휴가는 20일로 한다.' }] });
  assert.equal(same.rows.length, 0); assert.equal(same.searched, true);
  const down = await caConflicts({ searchRegs: async () => { throw new Error('x'); } }, { inst: '가공단', topic: '배우자 출산휴가', items: [] });
  assert.deepEqual(down.errors, ['단체협약 조회']);
});

// C1
import { runSimilar, distribution } from '../flows/similar.mjs';
test('C1 distribution buckets normalized values and counts extraction failures', () => {
  const table = [{ inst: 'A', values: { '휴가 일수': '20일의 휴가' } }, { inst: 'B', values: { '휴가 일수': '20일' } }, { inst: 'C', values: { '휴가 일수': '10일의 휴가' } }, { inst: 'D', values: {} }];
  const d = distribution(table, ['휴가 일수'], 'B');
  assert.deepEqual(d.buckets.map((b) => [b.value, b.count]), [['20일', 2], ['10일', 1]]);
  assert.equal(d.failed, 1); assert.equal(d.sample, 4); assert.equal(d.mine.value, '20일');
});

test('C3 is wired into the amend document set when the regulation has an institution', async () => {
  const { runAmend } = await import('../flows/amend.mjs');
  const { parseRegulationText } = await import('../lib/parse.mjs');
  const doc = { ...parseRegulationText('가공단 복무규정\n제7조(배우자 출산휴가) 배우자 출산휴가는 10일로 한다.', { doc_id: 'bylaws:x' }), inst: '가공단', source: 'alio', edition: { state: 'current' } };
  const sources = { loadDoc: async () => doc, searchRegs: async (q) => ({ rows: q.corpus === 'ca' ? [caRow('단체협약', '배우자 출산휴가는 25일로 한다.')] : [] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };
  const llm = llmOf({ changes: [{ op: 'amend', ref: '제7조', title: '배우자 출산휴가', new_text: '배우자 출산휴가는 20일로 한다.', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: 'bylaws:x', intent: '배우자 출산휴가 20일', refs: ['제7조'], auto: true, profile: { type: 'public-institution' } }, runAmend, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const ca = j.result.docset.sections.find((s) => s.id === 'ca_check');
  assert.match(ca.body, /25일/); assert.match(ca.body, /제96조/);
});

// B1
import { splitOpinions, runOpinions } from '../flows/opinions.mjs';
test('B1 splitOpinions keeps numbered lists inside one opinion and reads the submitter', () => {
  const t = '[인사팀] 제7조 관련\n1. 휴가 일수는 20일이 적절함\n2. 분할 사용 3회 허용 필요\n\n[노동조합] 청구 기한을 출산일부터 120일로 해 주십시오.\n\n\n재무팀: 예산 영향 없음';
  const o = splitOpinions(t);
  assert.equal(o.length, 3); assert.equal(o[0].from, '인사팀'); assert.match(o[0].text, /2\. 분할 사용/); assert.equal(o[2].from, '재무팀');
});
const CH = [{ op: 'amend', ref: '제7조', title: '배우자 출산휴가', old: '① 10일로 한다.\n② 1회 분할할 수 있다.', new: '① 20일로 한다.\n② 1회 분할할 수 있다.' }];
test('B1 human picks which opinions to apply; applied revision rebuilds the comparison table', async () => {
  const llm = llmOf({ items: [{ id: 'O1', target_ref: '제7조', proposal: 'accept', reason: '법 개정 취지', revised_text: '① 20일로 한다.\n② 3회 분할할 수 있다.' }, { id: 'O2', target_ref: '제7조', proposal: 'reject', reason: '이미 반영' }] });
  const jobs = createJobs();
  const id = jobs.start('opinions', { title: 'X 규정', kind: '개정', changes: CH, opinions_text: '[인사팀] 분할 3회\n\n[노조] 20일' }, runOpinions, { deps: { llm, sources: {} } });
  for (let i = 0; i < 400 && jobs.get(id).status !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 5));
  const g = jobs.get(id).gate; assert.equal(g.id, 'pick_opinions'); assert.deepEqual(g.options.filter((o) => o.checked).map((o) => o.value), ['O1']);
  jobs.answer(id, 'pick_opinions', ['O1']);
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const rows = j.result.docset.sections.find((s) => s.id === 'comparison').rows;
  assert.ok(rows.some((r) => /<u>3회<\/u>/.test(r.newHtml)));
  const rev = j.result.docset.sections.find((s) => s.id === 'opinion_review').body;
  assert.match(rev, /인사팀/); assert.match(rev, /반영/); assert.match(rev, /미반영/);
});
test('B1 rejects opinion proposals that target a non-existent article', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('opinions', { title: 'X', kind: '개정', changes: CH, opinions_text: '[a] b', auto: true }, runOpinions, { deps: { llm: llmOf({ items: [{ id: 'O1', target_ref: '제99조', proposal: 'accept', reason: 'r' }] }), sources: {} } }));
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'llm_invalid');
});

// C2
import { runRadar } from '../flows/radar.mjs';
const lawDoc = (id, eff, body, extra = []) => ({ doc_id: id, title: '테스트법', edition: { effective_from: eff }, articles: [{ ref: '제5조', no: 5, title: '배우자 출산휴가', body, section: '본칙' }, { ref: '제6조', no: 6, title: '목적', body: '같음', section: '본칙' }, ...extra] });
test('C2 radar compares scheduled version with the previous one and finds affected regulations', async () => {
  const docs = { 'legal:v1': lawDoc('legal:v1', '20260101', '배우자 출산휴가는 10일로 한다.'), 'legal:v2': lawDoc('legal:v2', '20270101', '배우자 출산휴가는 20일로 한다.', [{ ref: '제1조', title: '시행일', body: '이 법은 2027년 1월 1일부터 시행한다.', section: '부칙' }]) };
  const sources = {
    rest: { search: async () => ({ rows: [{ doc_id: 'legal:v1', doc_title: '테스트법', edition_state: 'current', effective_from: '20260101' }, { doc_id: 'legal:v2', doc_title: '테스트법', edition_state: 'scheduled', effective_from: '20270101' }, { doc_id: 'legal:x', doc_title: '테스트법 시행령', edition_state: 'scheduled', effective_from: '20270101' }] }) },
    loadDoc: async (id) => docs[id],
    searchRegs: async () => ({ rows: [{ doc_id: 'bylaws:a', inst_name: '가공단', doc_title: '복무규정', art_ref: '제7조', art_title: '배우자 출산휴가', body: '배우자 출산휴가는 10일로 한다.', edition_state: 'current' }] }),
  };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['테스트법'], auto: true }, runRadar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.items.length, 1);
  const it = j.result.items[0];
  assert.equal(it.ref, '제5조'); assert.equal(it.effective_from, '20270101');
  assert.equal(it.affected[0].status, 'candidate');
  assert.match(j.result.plan_text, /2027-01-01/); assert.match(j.result.plan_text, /2026-12-02/);
  assert.match(it.addenda, /2027년 1월 1일/);
});
test('C2 radar says explicitly when no scheduled version exists in the search range', async () => {
  const sources = { rest: { search: async () => ({ rows: [{ doc_id: 'legal:v1', doc_title: '테스트법', edition_state: 'current', effective_from: '20260101' }] }) }, loadDoc: async () => null, searchRegs: async () => ({ rows: [] }) };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['테스트법'] }, runRadar, { deps: { sources, llm: null } }));
  assert.equal(j.result.items.length, 0); assert.match(j.result.note, /시행예정 판본 없음/);
});

// B2
import { findPoints, swapWord, runBulk } from '../flows/bulk.mjs';
import { parseRegulationText as P } from '../lib/parse.mjs';
test('B2 swapWord fixes particles by final consonant', () => {
  assert.equal(swapWord('근로자는', '근로자', '직원'), '직원은');
  assert.equal(swapWord('근로자가', '근로자', '직원'), '직원이');
  assert.equal(swapWord('근로자를', '근로자', '직원'), '직원을');
  assert.equal(swapWord('근로자와', '근로자', '직원'), '직원과');
  assert.equal(swapWord('근로자로', '근로자', '직원'), '직원으로');
  assert.equal(swapWord('직원으로', '직원', '사원'), '사원으로');
  assert.equal(swapWord('직원은', '직원', '근로자'), '근로자는');
});
const BD = P('가 규정\n제2조(정의) "근로자"란 공단에 근무하는 사람을 말한다.\n제3조(복무) ① 근로자는 「근로기준법」에 따른 근로자대표와 협의한다.\n② 기간제근로자를 포함한 근로자를 교육한다.\n부 칙\n제1조(시행일) 근로자 관련 규정은 즉시 시행한다.', { doc_id: 'upload:dddddddddddddddd/0', title: '가 규정' });
test('B2 findPoints includes definitions, skips 「」 and addenda, flags compounds', () => {
  const pts = findPoints(BD, '근로자', '직원');
  const byText = pts.map((p) => `${p.ref}${p.para || ''}:${p.word}:${p.compound ? 'C' : ''}`);
  assert.ok(byText.includes('제2조:근로자:'));
  assert.ok(byText.includes('제3조①:근로자는:'));
  assert.ok(byText.some((x) => /근로자대표와?:C/.test(x)));
  assert.ok(pts.some((p) => p.compound && p.context.includes('기간제근로자')));
  assert.ok(byText.includes('제3조②:근로자를:'));
  assert.ok(!pts.some((p) => p.section === '부칙'));
  assert.ok(!pts.some((p) => p.context.includes('「직원')));
});
test('B2 runBulk applies only approved points with location-specific directive', async () => {
  const BD2 = P('나 규정\n제1조(목적) 근로자의 복무를 정한다.', { doc_id: 'upload:dddddddddddddddd/1', title: '나 규정' });
  const docs = { [BD.doc_id]: BD, [BD2.doc_id]: BD2 };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('bulk', { doc_ids: [BD.doc_id, BD2.doc_id], find: '근로자', replace: '직원', intent: '용어 통일', auto: true }, runBulk, { deps: { sources: { loadDoc: async (id) => docs[id] }, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.per_doc.length, 2);
  const draft = j.result.docset.sections.find((s) => s.id === 'draft').body;
  assert.match(draft, /제3조제1항 중 "근로자는"을 "직원은"으로/);
  assert.doesNotMatch(draft, /근로자대표/);
  assert.match(draft, /「나 규정」 일부를 다음과 같이 개정한다/);
  const rows = j.result.docset.sections.find((s) => s.id === 'comparison').rows;
  assert.ok(rows.some((r) => /「근로기준법」/.test(r.newHtml)));
});
