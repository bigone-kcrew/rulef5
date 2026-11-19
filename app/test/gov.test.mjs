// 중앙행정기관·지방자치단체용 비교·점검(법제처 행정규칙·자치법규)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { runSimilar } from '../flows/similar.mjs';
import { orgMeta } from '../lib/orgs.mjs';
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
// 가짜 법제처: 지자체별 복무 조례(배우자 출산휴가 일수만 다름)
const ORGS = { '경기도 수원시': 10, '경기도 용인시': 20, '경기도 가평군': 20, '서울특별시 강남구': 15, '경기도': 20 };
const docs = new Map(Object.entries(ORGS).map(([org, d], i) => [`law:ordin:${i + 1}`, parseRegulationText(`${org.split(' ').pop()} 지방공무원 복무 조례\n제1조(목적) 목적.\n제9조(특별휴가) ① 시장은 공무원이 배우자의 출산을 이유로 휴가를 청구하면 ${d}일의 휴가를 준다.\n② 출산전후휴가는 90일로 한다.`, { doc_id: `law:ordin:${i + 1}`, title: `${org} 복무 조례` })]));
const rows = Object.keys(ORGS).map((org, i) => ({ doc_id: `law:ordin:${i + 1}`, inst_name: org, doc_title: `${org.split(' ').pop()} 지방공무원 복무 조례`, corpus: 'ordin' }));
const calls = [];
const sources = {
  gov: { enabled: true, search: async (q) => { calls.push(['search', q.keyword]); return rows.filter((r) => q.target === 'ordin' && (!q.org || r.inst_name === q.org)); }, orgDocs: async (q) => { calls.push(['orgDocs', q.org]); return rows.filter((r) => r.inst_name === q.org); } },
  loadDoc: async (id) => docs.get(id),
  searchRegs: async () => { throw new Error('ALIO 를 쓰면 안 됨'); },
};
test('orgMeta classifies local governments and ministries', () => {
  assert.deepEqual([orgMeta('local-gov', '경기도 수원시').kind, orgMeta('local-gov', '경기도 수원시').region], ['기초(시)', '경기도']);
  assert.equal(orgMeta('local-gov', '경기도').kind, '광역'); assert.equal(orgMeta('local-gov', '경기도교육청').kind, '교육청');
  assert.equal(orgMeta('central-ministry', '고용노동부').kind, '부'); assert.equal(orgMeta('central-ministry', '국민권익위원회').kind, '위원회');
});
test('local government compares its ordinance with others in the same province (법제처, not ALIO)', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '경기도 수원시', org_type: 'local-gov', scope: 'region', auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const t = j.result.table;
  assert.equal(t[0].inst, '경기도 수원시'); assert.equal(t[0].mine, true); assert.equal(t[0].values['수치'], '10일');
  assert.deepEqual(t.slice(1).map((r) => r.inst).sort(), ['경기도 가평군', '경기도 용인시']); // 경기도(광역)와 서울 강남구는 같은 시·도의 시·군·구가 아님
  assert.ok(t[1].differs); assert.match(j.result.scope_label, /경기도.*시·군·구/);
  assert.match(t[0].excerpt, /배우자의 출산/); assert.doesNotMatch(t[0].excerpt, /90일/);
});
test('local government same-kind scope compares cities with cities', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '경기도 수원시', org_type: 'local-gov', scope: 'level', auto: true }, runSimilar, { deps: { sources, llm: null } }));
  assert.deepEqual(j.result.table.map((r) => r.inst), ['경기도 수원시', '경기도 용인시']);
  assert.match(j.result.scope_label, /기초\(시\)/);
});
test('without the 법제처 connection a local government gets a clear message instead of public-institution data', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '경기도 수원시', org_type: 'local-gov', scope: 'region', auto: true }, runSimilar, { deps: { sources: { ...sources, gov: { enabled: false } }, llm: null } }));
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'law_go_disabled');
});
test('a ministry can compare its subsidiaries (ALIO) with its own administrative rule first', async () => {
  const adm = parseRegulationText('고용노동부 공무직근로자 운영규정\n제20조(특별휴가) 배우자 출산휴가는 20일로 한다.', { doc_id: 'law:admrul:9', title: '고용노동부 공무직근로자 운영규정' });
  const src = {
    gov: { enabled: true, search: async (q) => (q.target === 'admrul' ? [{ doc_id: 'law:admrul:9', inst_name: '고용노동부', doc_title: adm.title }] : []), orgDocs: async () => [] },
    loadDoc: async (id) => (id === 'law:admrul:9' ? adm : null),
    searchRegs: async (q) => ({ rows: q.ministry === '고용노동부' ? [{ doc_id: 'b:x', inst_name: '근로복지공단', ministry: '고용노동부', doc_title: '복무규정', art_ref: '제5조', art_title: '휴가', section: '본칙', body: '배우자 출산휴가는 10일로 한다.', edition_state: 'current' }] : [] }),
  };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', mine: '고용노동부', org_type: 'central-ministry', scope: 'subsidiaries', auto: true }, runSimilar, { deps: { sources: src, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.table.map((r) => [r.inst, !!r.mine]), [['고용노동부', true], ['근로복지공단', false]]);
  assert.match(j.result.scope_label, /고용노동부 산하 공공기관/);
});
import { runCheck } from '../flows/check.mjs';
test('local government whole-institution check loads its own ordinances from 법제처', async () => {
  const a = parseRegulationText('가시 문서관리 조례\n제1조(목적) 목적.\n제2조(관리) 「가시 기록물 규칙」 제3조에 따른다.\n제3조(보존) 제9조에 따른다.', { doc_id: 'law:ordin:11', title: '가시 문서관리 조례' });
  const asked = [];
  const src = { gov: { enabled: true, orgDocs: async (q) => { asked.push(q); return [{ doc_id: 'law:ordin:11', inst_name: '경기도 가시', doc_title: a.title, doc_type: '조례' }, { doc_id: 'law:ordin:12', inst_name: '경기도 가시', doc_title: '가시 출장 훈령', doc_type: '훈령' }]; }, search: async () => [] }, loadDoc: async (id) => (id === 'law:ordin:11' ? a : parseRegulationText('가시 출장 훈령\n제1조(목적) 목적.', { doc_id: id, title: '가시 출장 훈령' })), searchRegs: async () => { throw new Error('ALIO 금지'); } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('check', { inst: '경기도 가시', org_type: 'local-gov', keyword: '문서', auto: true }, runCheck, { deps: { sources: src, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(asked[0].target, 'ordin'); assert.equal(asked[0].extra, '문서');
  assert.ok(j.result.findings.some((f) => f.type === 'broken_ref' && /제9조/.test(f.message)));
  assert.match(j.steps[0].note, /자치법규/);
});
import { runImpact } from '../flows/impact.mjs';
test('local government impact searches its ordinances (법제처) instead of public-institution bylaws', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('impact', { law_name: '남녀고용평등법 제18조의2', before: { text: '① 배우자 출산휴가는 10일로 한다.' }, after: { text: '① 배우자 출산휴가는 20일로 한다.' }, topic: '배우자 출산휴가', org_type: 'local-gov', scope: { inst: '경기도 수원시' }, auto: true }, runImpact, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const c = j.result.candidates;
  assert.ok(c.length >= 1 && c.every((x) => x.inst === '경기도 수원시'));
  assert.equal(c[0].status, 'candidate'); assert.match(c[0].doc_id, /^law:ordin:/);
});
test('purpose articles lose to the article that actually sets the rule', async () => {
  const d = parseRegulationText('가시 당직 규칙\n제1조(목적) 이 규칙은 당직 근무에 필요한 사항을 정한다.\n제5조(당직 근무) 당직 근무는 2명이 하며 근무시간은 18시부터 다음날 9시까지로 한다.', { doc_id: 'law:ordin:77', title: '가시 당직 규칙' });
  const src = { gov: { enabled: true, search: async () => [{ doc_id: 'law:ordin:77', inst_name: '경기도 가시', doc_title: d.title }], orgDocs: async () => [] }, loadDoc: async () => d };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '당직 근무', org_type: 'local-gov', scope: 'all', auto: true }, runSimilar, { deps: { sources: src, llm: null } }));
  assert.equal(j.result.table[0].ref, '제5조');
});
import { govJsonToDoc } from '../lib/law-go.mjs';
test('법제처 ordinance JSON keeps only article text (no internal codes) and separates deleted articles and paragraphs', () => {
  const j = { 자치법규: { 자치법규기본정보: { 자치법규명: '가시 복무 조례', 지자체기관명: '경기도 가시', 자치법규종류: '조례', 시행일자: '20260101' }, 조문: { 조: [
    { 조문번호: ['002500', '002500'], 조제목: '휴가기간의 초과', 조내용: '제25조(휴가기간의 초과) 이 조례가 정한 휴가일수를 초과한 휴가는 결근으로 본다.', 조문여부: 'Y' },
    { 조문번호: ['002502', '002502'], 조내용: '제25조의2< 삭제 2026.02.26>', 조문여부: 'Y' },
    { 조문번호: ['002600', '002600'], 조제목: '고충처리', 조내용: '제26조(고충처리)① 시장은 고충을 처리한다.② 처리 결과를 알린다.', 조문여부: 'Y' } ] } } };
  const d = govJsonToDoc(j, 'ordin', '9');
  assert.deepEqual(d.articles.map((a) => a.ref), ['제25조', '제25조의2', '제26조']);
  assert.doesNotMatch(d.articles[0].body, /Y|002/);
  assert.equal(d.articles[2].body, '① 시장은 고충을 처리한다.\n② 처리 결과를 알린다.');
  assert.equal(d.inst, '경기도 가시');
  const a = govJsonToDoc({ AdmRulService: { 행정규칙기본정보: { 행정규칙명: '가 규칙', 소관부처명: '가부', 행정규칙종류: '훈령' }, 조문내용: ['제1장 총칙', '제1조(목적) 목적.', '제2조(정의) 뜻은 다음과 같다.1. "직원"이란 가를 말한다.2. "부서"란 나를 말한다.'] } }, 'admrul', '8');
  assert.deepEqual(a.articles.map((x) => x.ref), ['제1조', '제2조']); assert.match(a.articles[1].body, /다음과 같다\.\n1\. "직원"/); assert.equal(a.articles[0].chapter, '제1장 총칙');
});
import { addendaDoc, noticeDoc, headTitle } from '../flows/docset.mjs';
import { stripHistory } from '../lib/text.mjs';
test('local-government documents use 공포, short names and the right head title; round-paren history notes are stripped', () => {
  assert.match(addendaDoc({ effective: '이 규칙은 발령한 날부터 시행한다.' }, { type: 'local-gov' }, '규칙'), /이 규칙은 공포한 날부터 시행한다\./);
  assert.match(addendaDoc({}, { type: 'local-gov' }, '조례'), /이 조례는 공포한 날부터 시행한다\./);
  assert.equal(headTitle({ type: 'local-gov', name: '경기도 수원시', approver: '시장' }), '수원시장');
  assert.equal(headTitle({ type: 'central-ministry', name: '고용노동부', approver: '장관' }), '고용노동부장관');
  assert.equal(headTitle({ type: 'public-institution', name: '가공단', approver: '이사장' }), '이사장');
  const n = noticeDoc({ profile: { type: 'local-gov', name: '경기도 수원시', approver: '시장' }, title: '수원시 당직 규칙', kind: '일부개정', reasonSummary: 'r', points: [] });
  assert.match(n, /^수원시 공고 제/); assert.match(n, /수원시장/); assert.doesNotMatch(n, /경기도 수원시 시장/);
  assert.equal(stripHistory('6주 이내에 1일을 지정하여 휴무할 수 있다. (개정 2019.04.04) (개정 2025.08.25.)'), '6주 이내에 1일을 지정하여 휴무할 수 있다.');
});
import { josa } from '../lib/table.mjs';
test('으로/로 follows ㄹ final consonants', () => {
  assert.equal(josa('10일', '으로', '로'), '로'); assert.equal(josa('6주', '으로', '로'), '로'); assert.equal(josa('3년', '으로', '로'), '으로');
  assert.equal(josa('제1', '으로', '로'), '로'); assert.equal(josa('"20일"', '으로', '로'), '로'); assert.equal(josa('10일', '을', '를'), '을');
});
import { checkDocs } from '../flows/check.mjs';
test('an uploaded bundle reports a same-institution regulation it cites but does not contain', () => {
  const a = parseRegulationText('누리시 지방공무원 복무 조례\n제1조(목적) 목적.\n제6조(당직) 당직은 「누리시 공무원 당직 규칙」으로 정한다.\n제7조(공무직) 공무직은 「누리시 공무직 운영 조례」에서 정한다.\n제8조(기타) 「지방공무원 복무규정」에 따른다.', { doc_id: 'u:1', title: '누리시 지방공무원 복무 조례' });
  const b = parseRegulationText('누리시 공무원 당직 규칙\n제1조(목적) 목적.', { doc_id: 'u:2', title: '누리시 공무원 당직 규칙' });
  const f = checkDocs([a, b]).filter((x) => x.type === 'missing_reg').map((x) => x.message);
  assert.equal(f.length, 1); assert.match(f[0], /누리시 공무직 운영 조례/);
});
test('rules of other agencies and government-wide standards are not reported as our missing regulations; one finding per name', () => {
  const a = parseRegulationText('가공단 계약 지침\n제1조(목적) 「조달청 평가위원 통합관리규정」에 따른다.\n제2조(공시) 「공공기관 통합공시에 관한 기준」에 따른다.\n제3조(인사) 「인사규칙」에 따른다.\n제4조(인사2) 「인사규칙」 제5조에 따른다.', { doc_id: 'u:1', title: '가공단 계약 지침' });
  const f = checkDocs([a], { wholeInstitution: true }).filter((x) => x.type === 'missing_reg');
  assert.equal(f.length, 1); assert.match(f[0].message, /인사규칙/); assert.equal(f[0].ref, '제3조, 제4조');
});
