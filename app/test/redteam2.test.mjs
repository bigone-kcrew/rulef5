// 2026-11-11 API·흐름 레드팀 지적 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { runAmend } from '../flows/amend.mjs';
import { runSimilar, findInstitution, numKey } from '../flows/similar.mjs';
import { headOf } from '../lib/orgs.mjs';
import { headTitle } from '../flows/docset.mjs';
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const DOC = parseRegulationText('가 규정\n제1장 육아휴직\n제5조(신청) ① 육아휴직을 하려는 직원은 30일 전까지 신청서를 낸다.\n② 부서장은 지체 없이 승인한다.\n③ 신청서에는 가족관계증명서를 첨부한다.\n제6조(기간) 육아휴직 기간은 자녀 1명당 3년 이내로 한다.\n제2장 유연근무\n제7조(유형) 유연근무의 유형은 시차출퇴근형으로 한다.\n제8조(기록) ① 유연근무 기록은 3년간 보존한다.\n② 보존기간이 지난 기록은 삭제한다.', { doc_id: 'upload:ffffffffffffffff/0', title: '가 규정' });
const sources = { loadDoc: async () => DOC, searchRegs: async () => ({ rows: [] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };
const run = async (changes, top = {}, objs = []) => { const jobs = createJobs(); return until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '고친다', refs: ['제5조', '제7조', '제8조'], auto: true }, runAmend, { deps: { sources, llm: llmOf({ changes, reason_summary: 's', main_points: [], addenda: {}, checks: [], ...top }, ...objs) } })); };
const A7 = { op: 'amend', ref: '제7조', new_text: '유연근무의 유형은 재택근무형으로 한다.', reason: 'r', basis_ids: [] };
const checklist = (j) => j.result.docset.sections.find((s) => s.id === 'checklist').body;

test('string checks / main_points / not_reflected from the model do not crash the job', async () => {
  const j = await run([A7], { checks: '노조 협의 필요', main_points: '유형 확대', not_reflected: '휴가 일수' });
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.match(checklist(j), /노조 협의 필요/); assert.match(checklist(j), /반영하지 못한 요청: 휴가 일수/);
});
test('untitled articles that start with a citation are still articles when the number is next and no titled twin follows', () => {
  const d = parseRegulationText('가\n제1조 이 규칙은 위원회 운영에 필요한 사항을 정한다.\n제2조 제1조에 따른 위원회는 7명으로 구성한다.\n제3조 제2조의 위원은 원장이 위촉한다.\n제4조 이 규칙은 시행한다.', { doc_id: 'x', title: '가' });
  assert.deepEqual(d.articles.map((a) => a.ref), ['제1조', '제2조', '제3조', '제4조']);
  const e = parseRegulationText('가\n제1조(목적)이 규칙은 목적을 정한다.\n제2조(정의)이 규칙에서 쓰는 말은 다음과 같다.', { doc_id: 'y', title: '가' });
  assert.deepEqual(e.articles.map((a) => [a.ref, a.title, a.body]), [['제1조', '목적', '이 규칙은 목적을 정한다.'], ['제2조', '정의', '이 규칙에서 쓰는 말은 다음과 같다.']]);
});
test('item-level refs are rejected and retried instead of overwriting the paragraph', async () => {
  const bad = [{ op: 'amend', ref: '제5조제1항제3호', new_text: '3. 출산 예정일 증명서', reason: 'r', basis_ids: [] }];
  const j = await run(bad, {}, [{ changes: bad, reason_summary: 's', main_points: [], addenda: {}, checks: [] }]);
  assert.equal(j.status, 'failed'); assert.match(j.error.message, /호|목/);
});
test('an insert of a new article whose ref carries a paragraph mark stays an insert', async () => {
  const j = await run([{ op: 'insert', ref: '제7조의2①', after: '제7조', title: '재택근무', new_text: '① 재택근무는 주 2일 이내로 한다.\n② 세부 사항은 따로 정한다.', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.changes.map((c) => [c.op, c.ref]), [['insert', '제7조의2']]);
});
test('duplicate-title conversion only applies to the neighbouring article; otherwise the insert is kept with a warning', async () => {
  const j = await run([{ op: 'insert', after: '제7조', title: '신청', new_text: '유연근무를 하려는 직원은 7일 전까지 신청한다.', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.changes.map((c) => [c.op, c.ref]), [['insert', '제7조의2']]);
  assert.match(checklist(j), /제5조\(신청\)과 제목이 같습니다/);
});
test('conflicting changes to the same article are rejected so the model retries', async () => {
  const dup = [A7, { ...A7, new_text: '유연근무의 유형은 시차출퇴근형으로 한다. 원격근무는 따로 정한다.' }];
  const j = await run(dup, {}, [{ changes: [A7], reason_summary: 's', main_points: [], addenda: {}, checks: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error)); assert.equal(j.result.changes.length, 1);
  const k = await run([{ op: 'delete', ref: '제7조', reason: 'r', basis_ids: [] }, { op: 'delete', ref: '제7조', reason: 'r', basis_ids: [] }], {}, [{ changes: [{ op: 'delete', ref: '제7조', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] }]);
  assert.equal(k.status, 'done', JSON.stringify(k.error)); assert.deepEqual(k.result.changes.map((c) => c.op), ['delete']);
});
test('amend without a model fails at the start, before asking the user anything', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '고친다' }, runAmend, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'llm_missing'); assert.ok(j.steps.length <= 1);
});
test('institution lookup is exact or unique; similar never attributes another institution\'s row', async () => {
  assert.equal(findInstitution('한국'), null);
  assert.equal(findInstitution('소상공인시장진흥공단').name, '소상공인시장진흥공단');
  const sources2 = { searchRegs: async (q) => ({ rows: [{ doc_id: 'b:x', inst_name: '한국가스공사', doc_title: '복무규정', art_ref: '제3조', art_title: '병가', section: '본칙', body: '병가는 연 60일 이내로 한다.', edition_state: 'current' }] }) };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '병가 일수', scope: 'picked', insts: ['한국전력공사', '한국전력공사'], auto: true }, runSimilar, { deps: { sources: sources2, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.table.length, 0); assert.deepEqual(j.result.off_topic, ['한국전력공사']);
  assert.match(j.result.scope_label, /1곳/);
});
test('value keys: years and months compare equal, different units never count as different', () => {
  assert.equal(numKey('3년이 지나면'), numKey('36개월'));
  assert.equal(numKey('3년을 넘지'), '3년');
});
test('topics without a subject word are refused; type scope without a known institution says so', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '기간', auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'bad_input');
  const sources3 = { searchRegs: async () => ({ rows: [] }) };
  const k = await until(jobs, jobs.start('similar', { topic: '병가 일수', scope: 'type', mine: '없는기관XYZ', auto: true }, runSimilar, { deps: { sources: sources3, llm: null } }));
  assert.equal(k.result.scope, 'all'); assert.match(k.result.scope_label, /전체/);
});
test('head titles for 본부 and fallback titles for ministries are correct', () => {
  assert.equal(headOf('central-ministry', '우정사업본부'), '본부장');
  assert.equal(headTitle({ type: 'central-ministry', name: '경찰청' }), '경찰청장');
  assert.equal(headTitle({ type: 'central-ministry', name: '법제처' }), '법제처장');
  assert.equal(headTitle({ type: 'central-ministry', name: '공정거래위원회' }), '공정거래위원회 위원장');
  assert.equal(headTitle({ type: 'central-ministry', name: '국무조정실' }), '국무조정실장');
  assert.equal(headTitle({ type: 'central-ministry', name: '고용노동부' }), '고용노동부장관');
});
test('waiting jobs are capped per client; system error details are not shown', async () => {
  const jobs = createJobs({ maxWaiting: 30, maxWaitingPerOwner: 3 });
  const park = (ctx) => ctx.gate({ id: 'g', prompt: 'p' });
  for (let i = 0; i < 3; i++) { jobs.start('x', {}, park, { owner: '1.1.1.1' }); await new Promise((r) => setTimeout(r, 2)); }
  await new Promise((r) => setTimeout(r, 5));
  assert.throws(() => jobs.start('x', {}, park, { owner: '1.1.1.1' }), /많습니다/);
  assert.doesNotThrow(() => jobs.start('x', {}, park, { owner: '2.2.2.2' }));
  const id = jobs.start('x', {}, async () => { throw Object.assign(new Error("ENOENT: no such file '/srv/secret'"), { code: 'ENOENT' }); }, { owner: '3.3.3.3' });
  const j = await until(jobs, id); assert.doesNotMatch(j.error.message, /srv|ENOENT/);
});
import { runImpact } from '../flows/impact.mjs';
test('impact: a topic kept only in an annex table is reported as a candidate to check, not as zero results', async () => {
  const rows = [{ doc_id: 'b:가', inst_name: '가공단', doc_title: '복무규정', art_ref: '', art_title: '[별표] 경조사휴가', section: '별표', body: '| 출산 | 배우자 출산 | 10 |', edition_state: 'current' }];
  const sources = { searchRegs: async () => ({ rows }), loadDoc: async () => { throw new Error('x'); }, mcp: { enabled: false } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('impact', { law_name: '남녀고용평등법 제18조의2', before: { text: '① 배우자 출산휴가는 10일로 한다.' }, after: { text: '① 배우자 출산휴가는 20일로 한다.' }, topic: '배우자 출산휴가', scope: { inst: '가공단' }, auto: true }, runImpact, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.candidates.length, 1);
  const c = j.result.candidates[0];
  assert.equal(c.ref, '별표'); assert.equal(c.status, 'check'); assert.match(c.reason, /별표/); assert.deepEqual(c.amend.refs, []);
});
test('reason and forms use the article number the code assigned to a new article, not the model\'s guess', async () => {
  const j = await run([{ op: 'insert', after: '제7조', title: '재택근무', new_text: '재택근무는 주 2일 이내로 한다.', reason: 'r', basis_ids: [] }], { reason_summary: '제7조의3(재택근무)를 신설한다.', main_points: ['제7조의3(재택근무) 신설: 주 2일 이내', '제7조(유형)는 그대로 둔다'] });
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const reason = j.result.docset.sections.find((s) => s.id === 'reason').body;
  assert.match(reason, /제7조의2\(재택근무\)/); assert.doesNotMatch(reason, /제7조의3/); assert.match(reason, /제7조\(유형\)/);
});
import { caConflicts, caTable } from '../flows/ca-check.mjs';
test('collective agreement: shorter topic variants are searched, and an existing agreement without the topic is not reported as missing', async () => {
  const qs = [];
  const sources = { searchRegs: async (q) => { qs.push(q.keyword); if (q.keyword === '단체협약') return { rows: [{ doc_id: 'ca:1', inst_name: '가공단', doc_title: '2024년 단체협약서', art_ref: '제1조', body: '이 협약은…' }] }; if (q.keyword === '배우자 출산') return { rows: [{ doc_id: 'ca:1', inst_name: '가공단', doc_title: '2024년 단체협약서', art_ref: '제82조', body: '배우자 출산휴가는 25일로 한다.' }] }; return { rows: [] }; } };
  const r = await caConflicts(sources, { inst: '가공단', topic: '배우자 출산휴가', items: [{ ref: '제7조', text: '배우자 출산휴가는 20일로 한다.' }] });
  assert.ok(qs.includes('배우자 출산')); assert.equal(r.rows.length, 1);
  const none = { searchRegs: async (q) => (q.keyword === '단체협약' ? { rows: [{ doc_id: 'ca:1', inst_name: '가공단', doc_title: '2024년 단체협약서', art_ref: '제1조', body: 'x' }] } : { rows: [] }) };
  const r2 = await caConflicts(none, { inst: '가공단', topic: '배우자 출산휴가', items: [{ ref: '제7조', text: '배우자 출산휴가는 20일로 한다.' }] });
  assert.match(caTable(r2), /2024년 단체협약서.*찾지 못했습니다/); assert.doesNotMatch(caTable(r2), /단체협약을 ALIO에서 찾지 못했습니다/);
});
import { runOpinions } from '../flows/opinions.mjs';
test('two picked opinions on the same article are merged into one text instead of silently dropping one', async () => {
  const CH = [{ op: 'amend', ref: '제7조', title: '휴가', old: '① 휴가는 10일. ② 사업주는 해고하지 못한다.', new: '① 휴가는 20일로 하며 3회 나누어 쓸 수 있다.\n② 사업주는 해고하지 못한다.' }];
  const llm = llmOf(
    { items: [{ id: 'O1', target_ref: '제7조', proposal: 'accept', reason: '분할 4회', revised_text: '① 휴가는 20일로 하며 4회 나누어 쓸 수 있다.\n② 사업주는 해고하지 못한다.' }, { id: 'O2', target_ref: '제7조', proposal: 'accept', reason: '주어', revised_text: '① 휴가는 20일로 하며 3회 나누어 쓸 수 있다.\n② 공단은 해고하지 못한다.' }] },
    { text: '① 휴가는 20일로 하며 4회 나누어 쓸 수 있다.\n② 공단은 해고하지 못한다.' });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('opinions', { title: 'X', kind: '개정', changes: CH, opinions_text: '[인사팀] 분할 4회\n\n[노조] 사업주는→공단은', auto: true }, runOpinions, { deps: { llm, sources: {} } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const cmp = JSON.stringify(j.result.docset.sections.find((s) => s.id === 'comparison'));
  assert.match(cmp, /4회/); assert.match(cmp, /공단은/);
  assert.match(j.steps.at(-1).note, /반영 2건/);
});
test('LLM adapter retries a dropped connection before giving up', async () => {
  let n = 0;
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { retryDelayMs: 1, fetchImpl: async () => { if (++n < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } }); return reply({ ok: 1 }); } });
  assert.deepEqual(await llm.chatJson([{ role: 'user', content: 'x' }], (o) => o), { ok: 1 }); assert.equal(n, 3);
});
test('opinions rejected only because the draft does not contain them are sent back for a real decision', async () => {
  const CH = [{ op: 'amend', ref: '제7조', title: '휴가', old: '① 휴가는 10일.', new: '① 휴가는 20일로 한다.' }];
  let n = 0;
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(++n === 1
    ? { items: [{ id: 'O1', target_ref: '제7조', proposal: 'reject', reason: '수정안에 서류 제출 규정이 포함되지 않아 현행 규정과 충돌한다.', revised_text: null }] }
    : { items: [{ id: 'O1', target_ref: '제7조', proposal: 'accept', reason: '증빙 제출 규정 추가', revised_text: '① 휴가는 20일로 한다.\n② 신청 시 증빙서류를 낸다.' }] }) });
  const { runOpinions } = await import('../flows/opinions.mjs');
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('opinions', { title: 'X', kind: '개정', changes: CH, opinions_text: '[인사팀] 증빙서류를 내게 해 주세요.', auto: true }, runOpinions, { deps: { llm, sources: {} } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error)); assert.equal(n, 2);
  assert.match(j.steps.at(-1).note, /반영 1건/);
});
test('a topic the regulation does not have becomes a new article, not text stuffed into an unrelated article', async () => {
  const D = parseRegulationText('나 규칙\n제20조(산전, 산후휴가) 임신 중인 직원에게 90일의 휴가를 준다.\n제35조(고충처리기관) ① 고충처리위원회를 둔다.\n② 남녀고용평등법상 고충은 위원회가 처리한다.', { doc_id: 'upload:eeeeeeeeeeeeeeee/0', title: '나 규칙' });
  const src = { ...sources, loadDoc: async () => D };
  const pick = { refs: ['제35조'], why: '남녀고용평등법', topic: '배우자 출산휴가', exists: false };
  const stuffed = { changes: [{ op: 'amend', ref: '제35조', new_text: '① 고충처리위원회를 둔다.\n② 직원의 배우자 출산휴가는 20일로 한다.', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] };
  const inserted = { changes: [{ op: 'insert', after: '제20조', title: '배우자 출산휴가', new_text: '직원이 배우자의 출산을 이유로 휴가를 청구하면 20일의 유급휴가를 준다.', basis_ids: [] }], reason_summary: 's', main_points: ['제20조의2 신설'], addenda: {}, checks: [] };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: D.doc_id, intent: '배우자 출산휴가를 20일로 한다', auto: true }, runAmend, { deps: { sources: src, llm: llmOf(pick, stuffed, inserted, { issues: [] }) } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.changes.map((c) => [c.op, c.ref]), [['insert', '제20조의2']]);
  assert.match(j.steps.find((s) => s.name === '대상 조문 찾기').note, /배우자 출산휴가」 조문이 없어/);
});
test('every finished job leaves an improvement record with status, step times and metrics but no user input', async () => {
  const recs = []; const jobs = createJobs({ onEnd: (r) => recs.push(r) });
  const changes = [{ op: 'amend', ref: '제6조', new_text: '육아휴직 기간은 자녀 1명당 3년 이내로 하고 나누어 쓸 수 있다.', basis_ids: [] }];
  const j = await until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '비밀스러운 개정 의도 문장', refs: ['제6조'], auto: true }, runAmend, { deps: { sources, llm: llmOf({ changes, reason_summary: 's', main_points: [], addenda: {}, checks: [] }, { issues: [] }) } }));
  assert.equal(j.status, 'done');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(recs.length, 1); const r = recs[0];
  assert.equal(r.status, 'done'); assert.equal(r.type, 'amend'); assert.ok(r.steps.length >= 4 && r.steps.every(([, st, ms]) => st && (ms === null || ms >= 0)));
  assert.equal(r.metrics.amend.ops, 'amend'); assert.equal(typeof r.metrics.amend.checklist, 'number');
  assert.ok(!JSON.stringify(r).includes('비밀스러운'));
});
