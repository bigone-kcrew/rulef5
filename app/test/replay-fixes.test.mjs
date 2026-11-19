// 실제 개정 이력 재현 검증(docs/replay)에서 나온 약점 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { runAmend } from '../flows/amend.mjs';
import { keywords, scoreArticle, stripHistory, cleanBody } from '../lib/text.mjs';
import { renumber } from '../lib/refs.mjs';
import { amendmentText, buildComparison } from '../lib/table.mjs';
import { addendaDoc } from '../flows/docset.mjs';
import { gatherEvidence } from '../flows/common.mjs';
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const DOC = parseRegulationText('가 지침\n제6조(신청) ① 직원은 신청서를 낸다. <개정 2024.1.1.>\n\n② 부서장은 승인한다.\n\n③ 삭제 <2023.5.1.>\n제7조(휴가) 난임치료휴가 중 최초 2일은 유급으로 한다. [본조신설 2020.1.1.]\n제8조(기타) 기타.', { doc_id: 'upload:ffffffffffffffff/0', title: '가 지침' });
const sources = { loadDoc: async () => DOC, searchRegs: async () => ({ rows: [] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };
const run = async (changes, extra = {}) => { const jobs = createJobs(); return until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '고친다', refs: ['제6조', '제7조'], auto: true, ...extra }, runAmend, { deps: { sources, llm: llmOf({ changes, reason_summary: 's', main_points: [], addenda: { effective: '본 개정규정은 2025년 1월 1일부터 시행한다.' }, checks: [] }) } })); };

test('keywords keep nouns ending in particle-like characters; scoring tolerates attached particles', () => {
  const k = keywords('난임치료휴가 유급 일수를 늘리고 배우자가 쓰는 휴가도 직무태만 없이');
  assert.ok(k.includes('난임치료휴가')); assert.ok(k.includes('휴가도') || k.includes('휴가')); assert.ok(k.includes('직무태만'));
  assert.ok(scoreArticle({ title: '배우자 출산휴가', body: '배우자' }, ['배우자가']) > 0);
});
test('stripHistory removes amendment annotations and cleanBody normalizes blank lines and markup', () => {
  assert.equal(stripHistory('① 낸다. <개정 2024.1.1.> [본조신설 2020.1.1.]^([개정 2024.12.12.])'), '① 낸다.');
  assert.equal(stripHistory('③ 삭제 <2023.5.1.>'), '③ 삭제');
  assert.equal(cleanBody('① 가.\n\n\n##### ② 나.  \n`다`'), '① 가.\n② 나.\n다');
});
test('first branch article is 의2 and directive particles follow the number', () => {
  const d = parseRegulationText('가\n제36조(가) 가.\n제37조(나) 나.', { doc_id: 'x', title: '가' });
  assert.equal(renumber(d, [{ op: 'insert', after: '제36조', renumber: false }]).inserted[0].ref, '제36조의2');
  const t = amendmentText('가', [{ op: 'insert', ref: '제35조의3', title: 't', new: 'x' }, { op: 'delete', ref: '제16조' }]);
  assert.match(t, /제35조의3을 다음과 같이 신설/); assert.match(t, /제16조를 삭제/);
});
test('comparison rows are ordered by article number', () => {
  const rows = buildComparison([{ op: 'amend', ref: '제9조', title: '', old: '가', new: '나' }, { op: 'amend', ref: '제3조', title: '', old: '가', new: '나' }]);
  assert.deepEqual(rows.map((r) => r.ref), ['제3조', '제9조']);
});
test('paragraph insert from the model is merged; history annotations do not show as changes; phrase directive is used', async () => {
  const j = await run([{ op: 'insert', after: '제6조②', title: '신청', new_text: '③ 긴급한 경우 사후에 신청할 수 있다.', reason: 'r', basis_ids: [] }, { op: 'amend', ref: '제7조', new_text: '난임치료휴가 중 최초 4일은 유급으로 한다.', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const c6 = j.result.changes.find((c) => c.ref === '제6조');
  assert.equal(c6.new, '① 직원은 신청서를 낸다.\n② 부서장은 승인한다.\n③ 긴급한 경우 사후에 신청할 수 있다.');
  const draft = j.result.docset.sections.find((s) => s.id === 'draft').body;
  assert.match(draft, /제7조 중 "2일은"을 "4일은"으로 한다\./);
  const rows = j.result.docset.sections.find((s) => s.id === 'comparison').rows;
  assert.ok(rows.filter((r) => r.ref === '제6조').slice(0, 2).every((r) => r.newHtml === '(현행과 같음)'));
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /삭제된 항/);
});
test('invalid changes are dropped with a warning when other changes are valid', async () => {
  const j = await run([{ op: 'amend', ref: '제7조', new_text: '난임치료휴가 중 최초 4일은 유급으로 한다.', reason: 'r', basis_ids: [] }, { op: 'amend', ref: '제99조', new_text: 'x', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.changes.length, 1);
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /제99조/);
});
test('addenda: past dates and missing subjects are normalized to the default effective clause', () => {
  const a = addendaDoc({ effective: '본 개정규정은 2025년 1월 1일부터 시행한다.' }, {}, '지침');
  assert.match(a, /이 지침은 발령한 날부터 시행한다\./);
  assert.match(addendaDoc({ effective: '발령한 날부터 시행한다.' }, {}, '규칙'), /이 규칙은 발령한 날부터 시행한다\./);
  assert.match(addendaDoc({ effective: '이 규칙은 2099년 1월 1일부터 시행한다.' }, {}, '규칙'), /2099년 1월 1일/);
});
test('evidence excludes other editions of the same regulation of the same institution', async () => {
  const rows = [{ doc_id: 'bylaws:new', inst_name: '가원', doc_title: '취업규정(2026.7.10.)', art_ref: '제1조', body: 'x' }, { doc_id: 'bylaws:o', inst_name: '나원', doc_title: '취업규정', art_ref: '제1조', body: 'y' }];
  const r = await gatherEvidence({ sources: { searchRegs: async () => ({ rows }), rest: { search: async () => ({ rows: [] }) }, lawGo: { enabled: false } } }, { query: '휴가', excludeDocId: 'bylaws:old', excludeSame: { inst: '가원', title: '취업규정' }, audits: false, standards: false });
  assert.deepEqual(r.evidence.map((e) => e.doc_id), ['bylaws:o']);
});

// 기관 비교 재설계(우리 기관 ↔ 비교 대상) · 법령 3단 체계
import { runSimilar, peerGroup, findInstitution } from '../flows/similar.mjs';
import { lawFamily } from '../flows/lawchain.mjs';
test('findInstitution and peerGroup resolve peers by ministry and type', () => {
  const me = findInstitution('소상공인시장진흥공단');
  assert.equal(me.ministry, '중소벤처기업부'); assert.ok(me.type);
  const byMin = peerGroup(me, 'ministry'); assert.ok(byMin.length >= 3 && byMin.every((x) => x.ministry === me.ministry) && !byMin.some((x) => x.name === me.name));
  const byType = peerGroup(me, 'type'); assert.ok(byType.every((x) => x.type === me.type));
  assert.equal(findInstitution('없는기관XYZ'), null);
});
test('similar puts our institution first and compares against picked institutions', async () => {
  const calls = [];
  const sources = { searchRegs: async (q) => { calls.push(q.inst || q.ministry || 'all'); return { rows: q.inst ? [{ doc_id: `b:${q.inst}`, inst_name: q.inst, doc_title: '복무규정', art_ref: '제7조', art_title: '배우자 출산휴가', body: `배우자 출산휴가는 ${q.inst === '가공단' ? 10 : 20}일로 한다.`, edition_state: 'current' }] : [] }; } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '가공단', scope: 'picked', insts: ['나공단', '다공단'], auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.table[0].inst, '가공단'); assert.equal(j.result.table[0].mine, true);
  assert.deepEqual(j.result.table.slice(1).map((r) => r.inst), ['나공단', '다공단']);
  assert.match(j.result.scope_label, /직접 고른 기관 2곳/);
  // 모델이 없어도 수치 열을 규칙으로 뽑아 우리 기관과 다른 곳을 표시한다
  assert.equal(j.result.table[0].values['수치'], '10일'); assert.equal(j.result.table[1].differs, true);
});
test('lawFamily groups statute, decree and rule into three tiers', async () => {
  const sources = { searchLaw: async () => ({ rows: [{ doc_id: 'legal:a', title: '근로기준법', source: 'ALIO', date: '20261008' }, { doc_id: 'law:law:1', title: '근로기준법', source: '법제처', date: '20261008' }, { doc_id: 'legal:b', title: '근로기준법 시행령', source: 'ALIO' }, { doc_id: 'legal:c', title: '근로기준법 시행규칙', source: 'ALIO' }, { doc_id: 'legal:d', title: '근로자참여 및 협력증진에 관한 법률', source: 'ALIO' }], errors: [] }) };
  const f = await lawFamily(sources, '근로기준법');
  assert.equal(f.base, '근로기준법');
  assert.equal(f.tiers.law.title, '근로기준법'); assert.equal(f.tiers.decree.doc_id, 'legal:b'); assert.equal(f.tiers.rule.doc_id, 'legal:c');
  assert.ok(f.others.some((x) => /근로자참여/.test(x.title)));
});

// 2차 재현 실행에서 나온 약점
test('amend whose text only says the article is abolished becomes a delete', async () => {
  const j = await run([{ op: 'amend', ref: '제7조', new_text: '본 조는 폐지한다.', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.changes[0].op, 'delete');
  assert.match(j.result.docset.sections.find((s) => s.id === 'draft').body, /제7조를 삭제한다\./);
});
test('article pick keeps valid refs when the model also returns unknown ones; unmet requests go to the checklist', async () => {
  const jobs = createJobs();
  const llm = llmOf({ refs: ['제7조', '제99조'], why: 'w' }, { changes: [{ op: 'amend', ref: '제7조', new_text: '난임치료휴가 중 최초 4일은 유급으로 한다.', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [], not_reflected: ['공가 사용 시 해제'] });
  const j = await until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '난임치료휴가 유급 일수를 늘리고 공가 사용 시 해제한다', auto: true }, runAmend, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.match(j.steps.find((s) => s.name === '대상 조문 찾기').note, /제7조/);
  assert.doesNotMatch(j.steps.find((s) => s.name === '대상 조문 찾기').note, /핵심어 일치/);
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /반영하지 못한 요청: 공가 사용 시 해제/);
});

// 기관 비교 정확도: 주제어가 실제로 들어 있는 항을 고르고, 주제와 무관한 조문·부칙 적용례는 값에서 뺀다
import { topicFocus } from '../flows/similar.mjs';
test('topicFocus picks the paragraph about the topic, tolerating split compound nouns and attribute words', () => {
  const body = '① 임신 중의 여성직원은 출산 전과 출산 후를 통하여 90일의 출산휴가를 사용할 수 있다.\n② 직원이 배우자의 출산을 이유로 휴가를 청구하면 20일의 휴가를 준다.';
  const f = topicFocus(body, '배우자 출산휴가 일수');
  assert.equal(f.level, 2); assert.match(f.text, /^② /); assert.doesNotMatch(f.text, /90일/);
  assert.equal(topicFocus('① 임신 중의 여성직원은 90일의 출산전후휴가를 쓴다.', '배우자 출산휴가').level, 0);
  assert.equal(topicFocus('병가는 연 60일 이내로 한다.', '병가 일수').level, 2);
});
test('similar prefers a main-body article on the topic over an addendum and drops off-topic institutions', async () => {
  const mk = (inst, o) => ({ doc_id: `b:${inst}:${o.art_ref}`, inst_name: inst, doc_title: '복무규정', edition_state: 'current', section: '본칙', ...o });
  const sources = { searchRegs: async (q) => {
    if (q.inst === '가공단') return { rows: [mk('가공단', { art_ref: '제29조', art_title: '출산휴가', body: '① 임신 중의 여성직원은 90일의 출산전후휴가를 쓴다.\n② 배우자가 출산한 직원에게는 20일의 휴가를 준다.' })] };
    if (q.inst === '나공단') return { rows: [mk('나공단', { art_ref: '제3조', art_title: '적용례', section: '부칙', body: '제60조는 이 요령 시행 당시 배우자 출산휴가를 사용 중인 직원(청구기한 90일)에게도 적용한다.' }), mk('나공단', { art_ref: '제60조', art_title: '특별휴가', body: '배우자 출산휴가는 10일로 한다.' })] };
    if (q.inst === '다공단') return { rows: [mk('다공단', { art_ref: '제19조', art_title: '출산전후휴가', body: '임신 중의 여성에게 90일의 출산전후휴가를 준다.' })] };
    return { rows: [] };
  } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '가공단', scope: 'picked', insts: ['나공단', '다공단'], auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const t = j.result.table;
  assert.deepEqual(t.map((r) => r.inst), ['가공단', '나공단']);
  assert.equal(t[0].values['수치'], '20일'); assert.match(t[0].excerpt, /^② /);
  assert.equal(t[1].ref, '제60조'); assert.equal(t[1].values['수치'], '10일');
  assert.deepEqual(j.result.off_topic, ['다공단']);
  assert.match(j.steps[0].note, /주제 조문을 찾지 못한 기관 1곳/);
});
test('an insert that repeats the heading of an existing article is treated as an amendment of it', async () => {
  const j = await run([{ op: 'insert', after: '제7조', title: '휴가', new_text: '제7조 휴가\n난임치료휴가 중 최초 4일은 유급으로 한다.', reason: 'r', basis_ids: [] }]);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.changes.map((c) => [c.op, c.ref]), [['amend', '제7조']]);
  assert.equal(j.result.changes[0].new, '난임치료휴가 중 최초 4일은 유급으로 한다.');
});
test('article candidates shown to the model carry the paragraphs that match the intent, not just the opening', async () => {
  const long = '① ' + '일반 사항을 정한다. '.repeat(30) + '\n② 탄력근무 중 공가를 사용하는 경우의 처리는 부서장이 정한다.';
  const D2 = parseRegulationText(`나 지침\n제1조(목적) 목적.\n제2조(복무) ${long}\n제3조(기타) 기타.`, { doc_id: 'upload:eeeeeeeeeeeeeeee/0', title: '나 지침' });
  let seen = '';
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async (u, init) => { const b = JSON.parse(init.body).messages.at(-1).content; if (/후보조문/.test(b)) { seen = b; return reply({ refs: ['제2조'], why: 'w' }); } return reply({ changes: [{ op: 'amend', ref: '제2조', new_text: long + ' 해제한다.', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] }); } });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: D2.doc_id, intent: '탄력근무 중 공가를 쓰면 탄력근무를 해제한다', auto: true }, runAmend, { deps: { sources: { ...sources, loadDoc: async () => D2 }, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.match(seen, /공가를 사용하는 경우/);
});
test('similar: a mislabelled 부칙 section alone does not disqualify an article; annex rows are labelled and unitless day counts are bucketed', async () => {
  const mk = (inst, o) => ({ doc_id: `b:${inst}`, inst_name: inst, doc_title: '복무규정', edition_state: 'current', section: '본칙', ...o });
  const sources = { searchRegs: async (q) => ({ rows: q.inst === '가공단' ? [mk('가공단', { art_ref: '', art_title: '[별표] 경조사휴가', section: '별표', body: '| 구분 | 대상 | 일수 |\n| 출산 | 배우자 출산휴가 | 20 |' })] : q.inst === '나공단' ? [mk('나공단', { art_ref: '제30조', art_title: '휴가', section: '부칙', body: '배우자 출산휴가는 10일로 한다.' })] : [] }) };
  const llm = llmOf({ columns: ['휴가 일수'], rows: [{ key: '0', values: { '휴가 일수': '20' } }, { key: '1', values: { '휴가 일수': '10일' } }] });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '가공단', scope: 'picked', insts: ['나공단'], auto: true }, runSimilar, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.table.map((r) => [r.inst, r.ref]), [['가공단', '별표'], ['나공단', '제30조']]);
  assert.deepEqual(j.result.distribution.buckets.map((b) => b.value).sort(), ['10일', '20일']);
  assert.equal(j.result.table[1].differs, true);
});
test('similar by institution type searches peers one by one when the broad search misses them', async () => {
  const me = findInstitution('한국전력공사'); const peers = peerGroup(me, 'type').map((x) => x.name);
  const asked = [];
  const sources = { searchRegs: async (q) => { if (q.inst) { asked.push(q.inst); return { rows: [{ doc_id: `b:${q.inst}`, inst_name: q.inst, doc_title: '취업규칙', art_ref: '제30조', art_title: '병가', section: '본칙', body: '병가는 연 60일 이내로 한다.', edition_state: 'current' }] }; } return { rows: [], has_more: false }; } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '병가 일수', mine: me.name, scope: 'type', n: 5, auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.table[0].mine, true);
  assert.equal(j.result.table.length, 6);
  assert.ok(j.result.table.slice(1).every((r) => peers.includes(r.inst)));
});
test('picker keeps only valid refs; an insert titled like an existing article becomes its amendment with a warning; abolition wording becomes delete', async () => {
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async (u, init) => { const b = JSON.parse(init.body).messages.at(-1).content; if (/후보조문/.test(b)) return reply({ refs: ['제7조', '제8조②', '제99조'], why: 'w' }); return reply({ changes: [{ op: 'insert', after: '제6조', title: '제7조의2 휴가', new_text: '난임치료휴가 중 최초 4일은 유급으로 한다.', reason: 'r', basis_ids: [] }, { op: 'insert', after: '제8조', title: '동행휴가', new_text: '동행휴가는 8일로 한다.', reason: 'r', basis_ids: [] }, { op: 'amend', ref: '제8조', title: '기타', new_text: '기타\n(본 조는 폐지한다.)', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] }); } });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '난임치료휴가 유급 일수를 늘리고 동행휴가를 새로 두고 기타 조항은 없앤다', auto: true }, runAmend, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.match(j.steps.find((s) => s.name === '대상 조문 찾기').note, /추천: 제7조, 제8조 \(w\)/);
  assert.deepEqual(j.result.changes.map((c) => [c.op, c.ref]).sort(), [['amend', '제7조'], ['delete', '제8조'], ['insert', '제8조의2']]);
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /제7조: 모델이 같은 제목/);
});

// 기관 설정 자동완성(공공기관·중앙행정기관·지방자치단체)
import { searchOrgs, headOf, orgsInfo } from '../lib/orgs.mjs';
test('org autocomplete covers the three institution types and suggests the head title', () => {
  const pub = searchOrgs('public-institution', '소상공인');
  assert.equal(pub[0].name, '소상공인시장진흥공단'); assert.equal(pub[0].ministry, '중소벤처기업부'); assert.ok(pub[0].type);
  const cen = searchOrgs('central-ministry', '고용');
  assert.equal(cen[0].name, '고용노동부'); assert.match(cen[0].sub, /산하 공공기관 \d+곳/); assert.equal(cen[0].head, '장관');
  const loc = searchOrgs('local-gov', '수원');
  assert.match(loc[0].name, /수원시$/); assert.equal(loc[0].head, '시장');
  const gu = searchOrgs('local-gov', '중구'); assert.ok(gu.length >= 3 && gu.every((x) => /중구$/.test(x.name) && x.head === '구청장'));
  assert.ok(searchOrgs('local-gov', '').slice(0, 10).every((x) => x.sub === '광역자치단체'));
  assert.equal(headOf('local-gov', '경기도교육청'), '교육감'); assert.equal(headOf('local-gov', '강원특별자치도'), '도지사'); assert.equal(headOf('central-ministry', '국민권익위원회'), '위원장');
  assert.deepEqual(searchOrgs('local-gov', '없는곳XYZ'), []);
  const info = orgsInfo(); assert.ok(info.counts['local-gov'] > 200 && info.counts['central-ministry'] > 40 && /^\d{4}-\d{2}-\d{2}$/.test(info.asof));
});
test('jobs report how many are still in progress', async () => {
  const jobs = createJobs(); let release;
  const id = jobs.start('x', {}, () => new Promise((r) => { release = r; }), { deps: {} });
  assert.equal(jobs.active(), 1); await new Promise((r) => setTimeout(r, 5)); release({}); await until(jobs, id); assert.equal(jobs.active(), 0);
});
test('similar does not call a value different when our article also contains it for another case', async () => {
  const mk = (inst, body) => ({ doc_id: `b:${inst}`, inst_name: inst, doc_title: '복무규정', art_ref: '제30조', art_title: '병가', section: '본칙', body, edition_state: 'current' });
  const sources = { searchRegs: async (q) => ({ rows: q.inst === '가공단' ? [mk('가공단', '① 업무상 질병에는 연 180일의 범위에서 병가를 허가한다.\n② 그 밖의 경우에는 연 60일의 범위에서 병가를 허가한다.')] : q.inst === '나공단' ? [mk('나공단', '병가는 연 60일의 범위에서 허가한다.')] : q.inst === '다공단' ? [mk('다공단', '병가는 연 30일의 범위에서 허가한다.')] : [] }) };
  const llm = llmOf({ columns: ['병가 일수'], rows: [{ key: '0', values: { '병가 일수': '연 180일의 범위' } }, { key: '1', values: { '병가 일수': '연 60일의 범위' } }, { key: '2', values: { '병가 일수': '연 30일의 범위' } }] });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '병가 일수', mine: '가공단', scope: 'picked', insts: ['나공단', '다공단'], auto: true }, runSimilar, { deps: { sources, llm } }));
  const [, b, c] = j.result.table;
  assert.equal(b.differs, false); assert.equal(b.mixed, true);
  assert.equal(c.differs, true); assert.ok(!c.mixed);
});
import { normNums, numericChanges } from '../flows/impact.mjs';
test('amounts written with 억·천만·백만·만·천 are normalized so changes are detected', () => {
  assert.equal(normNums('1천만원 이하'), '10000000원 이하');
  assert.equal(normNums('1억 5천만원'), '150000000원');
  assert.equal(normNums('3억원 이상'), '300000000원 이상');
  assert.equal(normNums('2만5천원'), '25000원'); assert.equal(normNums('5백만원'), '5000000원'); assert.equal(normNums('20,000원'), '20000원');
  assert.deepEqual(numericChanges('과태료 1천만원 이하', '과태료 3천만원 이하'), [{ from: '10000000원', to: '30000000원' }]);
  assert.equal(normNums('직원 3천명'), '직원 3천명');
});
test('a body line that starts with a citation (제3조 제1항에 따라 …) is not split off as a new article', () => {
  const d = parseRegulationText('가 규정\n제1조(목적) 목적.\n제2조(신청) ① 직원은 신청한다.\n제3조 제1항에 따라 승인한다.\n② 그 밖의 사항.\n제3조(승인) 부서장은 승인한다.\n제4조 및 제5조에 따른 절차는 따로 정한다.\n제5조 (기타) 기타.\n제6조 삭제 <2020.1.1.>\n제7조 이 규정은 준용한다.', { doc_id: 'x', title: '가' });
  assert.deepEqual(d.articles.map((a) => a.ref), ['제1조', '제2조', '제3조', '제5조', '제6조', '제7조']);
  assert.match(d.articles[1].body, /제3조 제1항에 따라 승인한다\.\n② 그 밖의 사항\./);
  assert.match(d.articles[2].body, /제4조 및 제5조에 따른 절차/);
});
test('a new article whose subject already appears in an annex table triggers an annex check', async () => {
  const D3 = parseRegulationText('다 규정\n제1조(목적) 목적.\n제2조(휴가) 휴가는 별표에 따른다.\n[별표] 경조사휴가\n| 구분 | 대상 | 일수 |\n| 출산 | 배우자 출산 | 10 |', { doc_id: 'upload:dddddddddddddddd/0', title: '다 규정' });
  const jobs = createJobs();
  const llm = llmOf({ refs: ['제2조'], why: 'w' }, { changes: [{ op: 'insert', after: '제2조', title: '배우자 출산휴가', new_text: '배우자 출산휴가는 20일로 한다.', reason: 'r', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] });
  const j = await until(jobs, jobs.start('amend', { doc_id: D3.doc_id, intent: '배우자 출산휴가를 20일로 늘린다', auto: true }, runAmend, { deps: { sources: { ...sources, loadDoc: async () => D3 }, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.match(j.result.docset.sections.find((s) => s.id === 'checklist').body, /배우자 출산휴가\): 같은 내용이 별표 「경조사휴가」/);
});
