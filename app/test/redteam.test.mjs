// 레드팀(기존 기능) 지적 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, renumber, corrections } from '../lib/refs.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { keywords } from '../lib/text.mjs';
import { numericChanges, judge } from '../flows/impact.mjs';
import { amendmentText } from '../lib/table.mjs';
import { dedupeEditions } from '../flows/common.mjs';
import { normalizeSections } from '../lib/alio-rest.mjs';

test('RT1 statute and other-regulation names attached to 제N조 are external citations', () => {
  const k = (s) => extractCitations(s).map((c) => `${c.kind}:${c.no}`);
  assert.deepEqual(k('민법 제777조에 따른 친족'), ['external:777']);
  assert.deepEqual(k('인사규정 제34조를 준용한다'), ['external:34']);
  assert.deepEqual(k('근로기준법 제76조의2, 제93조에 따른다'), ['external:76', 'external:93']);
  assert.deepEqual(k('｢근로기준법｣ 제84조에 의한 일시보상'), ['external:84']);
  assert.deepEqual(k('「산업안전보건법」 제129조부터 제131조까지'), ['external:129', 'external:131']);
  assert.deepEqual(k('이 규정 제5조 및 제6조에 따른다'), ['article:5', 'article:6']);
  assert.deepEqual(k('제13조의 1항에 따른다'), ['article:13']);
  assert.equal(extractCitations('제13조의 1항')[0].sub, null);
});
test('RT1 renumbering never rewrites external statute citations', () => {
  const d = parseRegulationText('가 규칙\n제33조(보상) ｢근로기준법｣ 제84조에 의한 일시보상과 근로기준법 제84조에 따른다.\n제79조(가) 가.\n제84조(나) 제79조에 따른다.', { doc_id: 'A', title: '가 규칙' });
  const { map } = renumber(d, [{ op: 'insert', after: '제79조', renumber: true }]);
  const rows = corrections([d], 'A', map);
  assert.ok(!rows.some((r) => r.ref === '제33조'));
});
test('RT3 keywords drop article-number tokens', () => {
  assert.ok(!keywords('제79조 다음에 가족돌봄휴가를 신설한다').some((k) => /제\d+조|^\d+조/.test(k)));
});
test('RT numericChanges handles commas, 만/천 units and compound periods', () => {
  assert.deepEqual(numericChanges('일비 20,000원', '일비 25,000원'), [{ from: '20000원', to: '25000원' }]);
  assert.deepEqual(numericChanges('2만원', '2만5천원'), [{ from: '20000원', to: '25000원' }]);
  assert.deepEqual(numericChanges('1년 이내', '1년 6개월 이내'), [{ from: '12개월', to: '18개월' }]);
});
test('RT judge ignores spacing in topics and skips calendar dates', () => {
  const ch = [{ from: '15일', to: '20일' }];
  assert.equal(judge('연차 유급휴가는 15일을 준다.', ch, '연차휴가').status, 'candidate');
  assert.equal(judge('연차휴가 사용계획은 12월 15일까지 제출한다.', ch, '연차휴가').status, 'check');
});
test('RT2 renumbered amendment text sorts by article and states the moved range', () => {
  const t = amendmentText('가 규칙', [
    { op: 'amend', ref: '제84조', title: '나', old: '제79조에 따른다.', new: '제80조에 따른다.', new_ref: '제85조' },
    { op: 'insert', ref: '제80조', title: '신설', old: '', new: '신설 조문.' },
    { op: 'amend', ref: '제33조', title: '가', old: '제81조에 따른다.', new: '제82조에 따른다.' },
  ], { kind: '일부개정', moves: [{ from: '제80조', to: '제124조', fromNew: '제81조', toNew: '제125조' }] });
  assert.match(t, /제80조부터 제124조까지를 각각 제81조부터 제125조까지로 하고/);
  assert.ok(t.indexOf('제33조') < t.indexOf('제80조를 다음과 같이 신설'));
  assert.match(t, /제85조\(종전의 제84조\)/);
});
test('RT dedupeEditions keeps the latest file per institution, title and article', () => {
  const rows = [
    { doc_id: 'b:1', inst_name: 'A', doc_title: '취업규칙(개정 20180320)', art_ref: '제64조', rel_path: 'A/취업규칙(2026년 7월 23일개정)_20260723/취업규칙(개정 20180320).md', doc_date: '20180320' },
    { doc_id: 'b:2', inst_name: 'A', doc_title: '취업규칙', art_ref: '제64조', rel_path: 'A/취업규칙_20260723.md', doc_date: '20260723' },
    { doc_id: 'b:3', inst_name: 'B', doc_title: '취업규칙', art_ref: '제64조', rel_path: 'B/x.md', doc_date: '20250101' },
  ];
  assert.deepEqual(dedupeEditions(rows).map((r) => r.doc_id), ['b:2', 'b:3']);
});
test('RT7 branch article mis-parsed by source as title "2 (…)" is repaired', () => {
  const { articles } = normalizeSections([{ ref: '제7조', no: 7, sub: null, title: '2 (채용비리 피해자의 구제)', body: 'x', section: '본칙' }, { ref: '제7조', no: 7, sub: null, title: '목적', body: 'y', section: '본칙' }]);
  assert.equal(articles[0].ref, '제7조의2'); assert.equal(articles[0].title, '채용비리 피해자의 구제');
});

import { procedureDocs, addendaDoc, noticeDoc } from '../flows/docset.mjs';
import { adverseChanges } from '../flows/amend.mjs';
import { checkDocs } from '../flows/check.mjs';
import { lawVersions } from '../flows/lawversions.mjs';

test('RT forms: local-gov head title, rule vs ordinance, ministry kind, notice josa, no fabricated reg name', () => {
  const loc = procedureDocs({ title: '수성구 1인가구 지원 조례', kind: '제정', reasonSummary: 'r', points: [], profile: { type: 'local-gov', name: '대구광역시 수성구' }, regKind: '조례' });
  const pro = loc.find((x) => x.id === 'promulgation').body;
  assert.match(pro, /수성구청장/); assert.doesNotMatch(pro, /수성구장|○○시 조례/);
  assert.match(loc.find((x) => x.id === 'assembly_bill').body, /수성구 1인가구 지원 조례안/); assert.doesNotMatch(loc.find((x) => x.id === 'assembly_bill').body, /조례 제정조례안/);
  const rule = procedureDocs({ title: '수성구 복무 규칙', kind: '개정', reasonSummary: 'r', points: [], profile: { type: 'local-gov', name: '대구광역시 수성구' }, regKind: '규칙' });
  assert.ok(!rule.some((x) => x.id === 'assembly_bill')); assert.match(rule.find((x) => x.id === 'promulgation').body, /일부개정규칙/);
  const min = procedureDocs({ title: '○○부 민원 처리 예규', kind: '개정', reasonSummary: 'r', points: [], profile: { type: 'central-ministry', name: '○○부' }, regKind: '예규' });
  assert.match(min.find((x) => x.id === 'promulgation').body, /예규 제\s+호/);
  assert.doesNotMatch(procedureDocs({ title: 'X', kind: '개정', reasonSummary: 'r', points: [], profile: { type: 'public-institution' } }).find((x) => x.id === 'consult_letter').body, /규정관리 규정/);
  assert.doesNotMatch(noticeDoc({ profile: { type: 'public-institution' }, title: '복무규정', kind: '일부개정', reasonSummary: 'r', points: [] }), /을\(를\)/);
});
test('RT addenda uses the regulation kind and keeps an application-rule label', () => {
  const a = addendaDoc({ effective: '이 규정은 발령한 날부터 시행한다.', transition: '제2조(적용례) 이 규칙 시행 전 출산한 경우에도 적용한다.' }, { effective_default: '이 규정은 발령한 날부터 시행한다.' }, '규칙');
  assert.match(a, /이 규칙은 발령한 날부터 시행한다/); assert.match(a, /제2조\(적용례\)/);
});
test('RT adverse compares paragraph-aligned changed words only', () => {
  const ch = [{ op: 'amend', ref: '제79조', title: '배우자 출산휴가', old: '① 10일의 휴가를 준다.\n② 출산한 날부터 90일이 지나면 청구할 수 없다.', new: '① 20일의 휴가를 준다.\n② 출산예정일 50일 전부터 사용할 수 있고, 출산한 날부터 120일이 지나면 청구할 수 없다.' }];
  assert.deepEqual(adverseChanges(ch), []);
});
test('RT labor opinion never auto-checks; adverse items are shown as candidates', () => {
  const b = procedureDocs({ title: 'X', kind: '개정', reasonSummary: 'r', points: [], profile: { type: 'public-institution' }, labor: true, adverse: [{ ref: '제7조', reasons: ['혜택 감소'] }] }).find((x) => x.id === 'labor_opinion').body;
  assert.doesNotMatch(b, /■/); assert.match(b, /불리한 변경 후보: 제7조/);
});
test('RT check does not flag government norms as missing institution regulations and shows the citation snippet', () => {
  const d = parseRegulationText('가 규정\n제1조(목적) 「공무원 여비 규정」 제5조와 「공공기관의 혁신에 관한 지침」에 따르고, 「나 인사규정」을 준용한다. 이하 생략 '.padEnd(400, '가') + ' 제99조를 위반하면 징계한다.', { doc_id: 'A', title: '가 규정' });
  const f = checkDocs([d], { wholeInstitution: true });
  assert.ok(!f.some((x) => /공무원 여비 규정|혁신에 관한 지침/.test(x.message)));
  assert.ok(f.some((x) => x.type === 'missing_reg' && /나 인사규정/.test(x.message)));
  assert.match(f.find((x) => x.type === 'broken_ref').evidence, /제99조/);
});
test('RT lawVersions searches with the article reference so large statutes are found', async () => {
  const qs = [];
  const sources = { rest: { search: async (q) => { qs.push(q.keyword); return { rows: [] }; } }, loadDoc: async () => null };
  await lawVersions(sources, { name: '근로기준법', ref: '제60조', topic: '' });
  assert.ok(qs.some((q) => /제60조/.test(q)));
});

import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runEnact } from '../flows/enact.mjs';
import { runImpact } from '../flows/impact.mjs';
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
test('RT4 enact renumbers chapter articles in code and drops addenda-like titles from the outline', async () => {
  const outline = { chapters: [{ title: '제1장 총칙', articles: [{ ref: '제1조', title: '목적', basis_ids: [] }, { ref: '제2조', title: '정의', basis_ids: [] }] }, { title: '제2장 지원', articles: [{ ref: '제3조', title: '지원', basis_ids: [] }, { ref: '제4조', title: '시행일 및 경과조치', basis_ids: [] }] }] };
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async (u, init) => { const c = JSON.parse(init.body).messages[1].content; if (c.includes('조문 체계(장·조 목차)를 설계')) return reply(outline); if (c.includes('이 장의 조문')) return reply(c.includes('"장":"제2장') ? { articles: [{ ref: '제1조', title: '지원', text: '지원한다.', basis_ids: [] }] } : { articles: [{ ref: '제1조', title: '목적', text: '목적이다.', basis_ids: [] }, { ref: '제2조', title: '정의', text: '정의다.', basis_ids: [] }] }); return reply({ reason_summary: 'r', main_points: [], addenda: {}, other_amendments: [], checks: [] }); } });
  const sources = { loadDoc: async () => null, searchRegs: async () => ({ rows: [] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('enact', { kind: '조례', title: '가 조례', purpose: '지원', auto: true, profile: { type: 'local-gov', name: '대구광역시 수성구' } }, runEnact, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(j.result.articles.map((a) => a.ref), ['제1조', '제2조', '제3조']);
  assert.match(j.result.docset.sections.find((s) => s.id === 'addenda').body, /이 조례는/);
});
test('RT impact deduplicates edition files and AI candidate verdicts need a quote from the article', async () => {
  const r1 = { doc_id: 'b:old', inst_name: 'A', doc_title: '취업규칙(개정 20180320)', art_ref: '제64조', art_title: '육아휴직', body: '육아휴직은 1년 이내로 한다.', rel_path: 'A/x_20260723/취업규칙(개정 20180320).md', doc_date: '20180320', edition_state: 'current' };
  const r2 = { ...r1, doc_id: 'b:new', doc_title: '취업규칙', rel_path: 'A/취업규칙_20260723.md', doc_date: '20260723', body: '육아휴직 기간은 3년 이내로 한다.' };
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async (u, init) => reply(JSON.parse(init.body).messages[1].content.includes('판정') ? { results: [{ key: 'b:new#제64조', status: 'candidate', reason: '추가 6개월 없음', quote: '없는 문장' }] } : { summary: 's', topic: '육아휴직' }) });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('impact', { law_name: '법', before: { text: '육아휴직 1년' }, after: { text: '육아휴직 1년 6개월' }, topic: '육아휴직', auto: true }, runImpact, { deps: { sources: { searchRegs: async () => ({ rows: [r1, r2] }), mcp: { enabled: false } }, llm } }));
  assert.equal(j.result.candidates.length, 1);
  assert.equal(j.result.candidates[0].doc_id, 'b:new');
  assert.notEqual(j.result.candidates[0].status, 'candidate');
});

test('RT2b more external citation forms from real data', () => {
  const k = (s) => extractCitations(s).filter((c) => c.kind === 'article').map((c) => c.no);
  assert.deepEqual(k('문화체육관광부 예규 ‘지역서점 확인절차 운영에 관한 규정(이하 “예규”라 한다)’ 제2조의4에 의거'), []);
  assert.deepEqual(k('종전의「전력기술관리법」(법률 제13741호로 개정되기 전의 것을 말한다) 제6조의2에 따라'), []);
  assert.deepEqual(k('「공공기관의 운영에 관한 법률」 제22조, 제48조제4항 및 제8항, 제52조의3에 따라 해임된 경우'), []);
  assert.deepEqual(k('인사규정 제11조 승진, 제36조 인사위원회 운영 등에 관하여'), []);
});
test('RT2b other regulation annexes and missing source forms are not high-severity errors', () => {
  const d = parseRegulationText('가 규칙\n제7조(승진) 보수규정 별표 7의 기준표와 별지 제1호 서식에 따른다. 별표 9를 본다.\n[별표 1] 가\n가', { doc_id: 'A', title: '가 규칙' });
  const f = checkDocs([d], {});
  assert.ok(!f.some((x) => /별표 7/.test(x.message)));
  assert.ok(f.some((x) => /별표 9/.test(x.message) && x.severity === 'high'));
  assert.ok(f.filter((x) => /별지/.test(x.message)).every((x) => x.severity === 'check'));
});

test('SEC judge escapes user topic before building a regex (no ReDoS, no syntax error)', () => {
  const t0 = Date.now();
  assert.equal(judge('a'.repeat(40) + '!', [{ from: '10일', to: '20일' }], '(a+)+$ (a+)+b[').status, 'check');
  assert.ok(Date.now() - t0 < 500);
});
