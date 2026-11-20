// 레드팀 3차: 기관 유형·실제 문서 형식에서 생기는 결함 재현
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, sameRegulation, findCiting } from '../lib/refs.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { checkDocs } from '../flows/check.mjs';
import { stripHistory } from '../lib/text.mjs';
import { splitOpinions } from '../flows/opinions.mjs';
import { addendaDoc, procedureDocs, regKindOf, noticeDoc } from '../flows/docset.mjs';
import { classifySubject } from '../flows/enact.mjs';
import { detectIssues } from '../flows/review.mjs';
import { numKey } from '../flows/similar.mjs';
const kinds = (t) => extractCitations(t).map((x) => `${x.kind}:${x.name || ''}:${x.no || ''}${x.para ? '/' + x.para : ''}`);

test('citation forms from real documents are classified correctly', () => {
  assert.deepEqual(kinds('제3조제4항부터 제8항까지를 준용한다.'), ['article::3/4', 'article::3/8']);
  assert.deepEqual(kinds('「국가공무원 복무규정」 제9조부터 제11조까지의 규정을 준용(제11조제4항 및 제5항은 제외)한다.').map((x) => x.split(':')[0]), ['external', 'external', 'external', 'external']);
  assert.deepEqual(kinds('「건설기술 진흥법」 제2조(정의) 및 제49조(건설공사감독자의 감독 의무)에 따른').map((x) => x.split(':')[0]), ['external', 'external']);
  assert.ok(kinds('「공직자의 이해충돌 방지법」(이하 "법"이라 한다) 제25조 및 같은 법 시행령(이하 "영"이라 한다) 제31조에 따라').every((x) => x.startsWith('external')));
  const k = kinds('「고용노동부와 그 소속기관 직제 시행규칙」(이하 "직제 시행규칙"이라 한다) 제23조에 따라');
  assert.ok(k.every((x) => x.startsWith('external:고용노동부와 그 소속기관 직제 시행규칙')), k.join());
  assert.ok(kinds('공공기관의 운영에 관한 법률 제34조에 따른다.').every((x) => x.startsWith('external')));
  assert.ok(kinds('법률 제19조에 따라').every((x) => x.startsWith('external')));
});
test('a longer citation name is the same regulation only when the extra prefix is our institution', () => {
  assert.equal(sameRegulation('국가공무원 복무규정', '복무규정', '창업진흥원'), false);
  assert.equal(sameRegulation('창업진흥원 복무규정', '복무규정', '창업진흥원'), true);
  assert.equal(sameRegulation('복무규정', '가나다공단 복무규정'), true);
  const d = parseRegulationText('복무규정\n제20조(휴가) 휴가.\n제39조(특별휴가) 「국가공무원 복무규정」 제20조를 준용한다.', { doc_id: 'b:1', title: '복무규정' });
  assert.equal(findCiting([{ ...d, inst: '창업진흥원' }], { doc_id: 'b:1', ref: '제20조' }).length, 0);
});
test('regulations named after our institution are checked even when they contain 공무원; 강령·내규 are names; upper-level ordinances are excluded', () => {
  const a = parseRegulationText('누리시 문서 규칙\n제1조(목적) 「누리시 지방공무원 복무 조례」와 「누리시 공무원 행동강령」에 따른다.\n제2조(건축) 「경기도 건축 조례」에 따른다.', { doc_id: 'u:1', title: '누리시 문서 규칙' });
  const names = checkDocs([a], { wholeInstitution: true, orgType: 'local-gov', org: '경기도 누리시' }).filter((f) => f.type === 'missing_reg').map((f) => f.message.match(/「([^」]+)」/)[1]).sort();
  assert.deepEqual(names, ['누리시 공무원 행동강령', '누리시 지방공무원 복무 조례']);
});
test('week units and term-of-office topics are compared', () => {
  assert.equal(numKey('6주 이내'), '6주');
  const d = parseRegulationText('가 규칙\n제3조(휴무) 숙직 근무자는 숙직 후 6주 이내에 휴무한다.\n제6조(특례) 숙직 근무자는 숙직 후 4주 이내에 휴무한다.\n제7조(위원) 위원의 임기는 2년으로 한다.\n제8조(위원장) 위원의 임기는 3년으로 한다.', { doc_id: 'x', title: '가 규칙' });
  const c = checkDocs([d]).filter((f) => f.type === 'conflict').map((f) => f.message);
  assert.ok(c.some((m) => /6주|4주/.test(m)), c.join('\n')); assert.ok(c.some((m) => /임기/.test(m)), c.join('\n'));
});
test('date-first history notes are stripped', () => {
  assert.equal(stripHistory('직원은 출근한다.(‘12.9.13. 개정) (2015.3.1. 신설)'), '직원은 출근한다.');
});
test('broken references to articles that exist inside a damaged table layout are downgraded with one structure warning', () => {
  const d = parseRegulationText('가 규정\n제1조(목적) 목적. 제5조를 따른다.\n제2조(표) | 제5조(승인) 부서장이 승인한다. | 제6조(기록) 기록한다. |', { doc_id: 'x', title: '가 규정' });
  const f = checkDocs([d]);
  assert.ok(!f.some((x) => x.type === 'broken_ref' && x.severity === 'high'), JSON.stringify(f));
  assert.ok(f.some((x) => /원문 구조/.test(x.message)));
});
test('opinion replies in official-letter style are split by department', () => {
  const o = splitOpinions('○ 총무과 : 분할 횟수를 늘려 주세요.\n○ 인사과: 증빙을 받게 해 주세요.\n1. 기획팀: 시행일을 늦춰 주세요.\n- 법무팀 : 경과조치를 두세요.');
  assert.deepEqual(o.map((x) => x.from), ['총무과', '인사과', '기획팀', '법무팀']);
});
test('regulation kind follows the document type; 훈령 is issued (발령) even in a local education office; subjects are not doubled', () => {
  assert.equal(regKindOf('경기도교육청 당직 규정', '규정', '훈령'), '훈령');
  assert.equal(regKindOf('가공단 임직원 행동강령'), '강령');
  assert.match(addendaDoc({ effective: '이 강령은 발령한 날부터 시행한다.' }, { type: 'public-institution' }, '강령'), /^부 칙.*\n이 강령은 발령한 날부터 시행한다\.$/);
  assert.match(addendaDoc({}, { type: 'local-gov' }, '훈령'), /이 훈령은 발령한 날부터 시행한다/);
  const forms = procedureDocs({ profile: { type: 'local-gov', name: '경기도교육청' }, title: '경기도교육청 당직 규정', kind: '개정', regKind: '훈령', points: [] }).map((s) => s.body).join('\n');
  assert.doesNotMatch(forms, /이에 공포한다|규정 제 {4}호/);
});
test('labor-related ministry/local rules for 공무직 still get the worker opinion form', () => {
  const ids = procedureDocs({ profile: { type: 'central-ministry', name: '가람부' }, title: '가람부 공무직근로자 운영규정', kind: '개정', regKind: '훈령', points: [], labor: true }).map((s) => s.title).join();
  assert.match(ids, /근로자 의견/);
});
test('ordinance duties on residents, students, owners are external, not internal', () => {
  for (const t of ['보호자는 학생의 등교를 신고하여야 한다.', '건물의 소유자 또는 점유자는 소화기를 비치하여야 한다.', '영업자는 매월 실적을 제출하여야 한다.']) assert.equal(classifySubject(t), 'external', t);
});
test('a local-government draft citing the national civil-service rules is flagged', async () => {
  const r = await detectIssues({ items: [{ ref: '제1조', title: '', text: '「국가공무원 복무규정」에 따른다.' }], docText: '', profile: { type: 'local-gov' }, sources: { searchLaw: async () => ({ rows: [{ title: '국가공무원 복무규정' }], errors: [] }) } });
  assert.match(r.map((x) => x.problem).join(), /지방공무원/);
});
test('markdown headings/bold and annex title variants are parsed', () => {
  const d = parseRegulationText('# 가 규정\n## 제1조(목적) 목적.\n**제2조(정의)** 뜻.\n<별표 1> 휴가 일수\n| 가 | 1 |', { doc_id: 'x' });
  assert.deepEqual(d.articles.filter((a) => a.section === '본칙').map((a) => a.ref), ['제1조', '제2조']);
  assert.equal(d.articles.find((a) => a.ref === '제2조').body, '뜻.');
  assert.ok(d.articles.some((a) => a.section === '별표'));
});
test('autonomous-district notices use the full name (서울특별시 강남구)', () => {
  assert.match(noticeDoc({ profile: { type: 'local-gov', name: '서울특별시 강남구' }, title: 't', kind: '일부개정', points: [] }), /^서울특별시 강남구 공고/);
  assert.match(noticeDoc({ profile: { type: 'local-gov', name: '경기도 수원시' }, title: 't', kind: '일부개정', points: [] }), /^수원시 공고/);
});
import { createJobs } from '../lib/jobs.mjs';
import { runCheck } from '../flows/check.mjs';
test('local missing-regulation check searches the full name first and ignores upper-level ordinances found in 법제처', async () => {
  const doc = parseRegulationText('강남구 민원 규칙\n제1조(목적) 「서울특별시 강남구 행정권한의 민간위탁에 관한 조례」와 「서울특별시 건축 조례」, 「서울특별시 강남구 없는 조례」에 따른다.', { doc_id: 'law:ordin:1', title: '서울특별시 강남구 민원 규칙' });
  const asked = [];
  const sources = { gov: { enabled: true, orgDocs: async () => [{ doc_id: 'law:ordin:1', inst_name: '서울특별시 강남구', doc_title: doc.title }], search: async (q) => { asked.push(q.keyword); if (q.keyword === '서울특별시 강남구 행정권한의 민간위탁에 관한 조례' && q.org === '서울특별시 강남구') return [{ doc_title: '서울특별시 강남구 행정권한의 민간위탁에 관한 조례' }]; return []; } }, loadDoc: async () => doc, lawGo: { enabled: false } };
  const jobs = createJobs();
  const j = await (async () => { const id = jobs.start('check', { inst: '서울특별시 강남구', org_type: 'local-gov' }, runCheck, { deps: { sources, llm: null } }); for (let i = 0; i < 200 && jobs.get(id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 5)); return jobs.get(id); })();
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const left = j.result.findings.filter((f) => f.type === 'missing_reg').map((f) => f.message.match(/「([^」]+)」/)[1]);
  assert.deepEqual(left, ['서울특별시 강남구 없는 조례']);
  assert.ok(asked.includes('서울특별시 강남구 행정권한의 민간위탁에 관한 조례'));
});
test('a document whose article numbers are mostly missing (broken two-column source) gets one structure warning instead of many broken references', () => {
  const body = ['제1조(목적) 목적. 제14조와 제16조를 따른다.', '제5조(감사) 감사. 제28조를 따른다.', '제29조(보고) 보고.', '제39조(시행) 시행.'].join('\n');
  const f = checkDocs([parseRegulationText(`가 감사규정\n${body}`, { doc_id: 'x', title: '가 감사규정' })]);
  assert.equal(f.filter((x) => x.type === 'broken_ref' && x.severity === 'high').length, 0, JSON.stringify(f));
  assert.equal(f.filter((x) => /원문 구조/.test(x.message)).length, 1);
});
// 치명 3건과 같은 유형(이름을 잘라 비교·앞부분만 비교)
import { lawVersions } from '../flows/lawversions.mjs';
import { citesLaw } from '../flows/impact.mjs';
test('law versions accept only the same law, not another law whose name starts the same', async () => {
  const row = (title, eff, body) => ({ doc_id: `legal:${title}(${eff})`, doc_title: title, art_ref: '제71조', effective_from: eff, edition_state: 'current', body });
  const sources = { rest: { search: async () => ({ rows: [row('국가공무원 복무규정', '20260101', '복무규정 제71조'), row('국가공무원법', '20251001', '① 휴직 1년'), row('국가공무원법', '20260301', '① 휴직 2년')] }) }, loadDoc: async (id) => ({ articles: [{ ref: '제71조', section: '본칙', body: id }] }) };
  const r = await lawVersions(sources, { name: '국가공무원법', ref: '제71조' });
  assert.ok(r.versions.every((v) => v.title === '국가공무원법'), JSON.stringify(r.versions));
});
test('a regulation cites a law only when the law name is actually cited, not when a longer different name starts the same way', () => {
  assert.equal(citesLaw('「국가공무원 복무규정」 제20조에 따른다.', '국가공무원법'), false);
  assert.equal(citesLaw('「국가공무원법」 제71조에 따라 휴직한다.', '국가공무원법'), true);
  assert.equal(citesLaw('남녀고용평등법 제18조의2에 따른다.', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률'), true);
  assert.equal(citesLaw('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률 시행령 제2조', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률'), false);
});
test('a law-name existence check does not accept a longer, different law as the same', async () => {
  const r = await detectIssues({ items: [{ ref: '제1조', title: '', text: '「근로기준법 특례법」에 따른다.' }], docText: '가', profile: { type: 'public-institution' }, sources: { searchLaw: async () => ({ rows: [{ title: '근로기준법' }, { title: '근로기준법 시행령' }], errors: [] }) } });
  assert.match(r.map((x) => x.problem).join(), /근로기준법 특례법/);
});
test('first words of uploaded titles count as our institution only when they look like an institution name', () => {
  const d = parseRegulationText('공무원 여비 규정\n제1조(목적) 「공무원 행동강령」에 따른다.', { doc_id: 'u:9', title: '공무원 여비 규정' });
  assert.equal(checkDocs([d]).filter((f) => f.type === 'missing_reg').length, 0);
});
import { findPoints } from '../flows/bulk.mjs';
test('bulk replace skips circular definitions and fixed names, and accepts stacked particles', () => {
  const d = parseRegulationText('가 규정\n제2조(정의) "직원"이란 공단에 근무하는 근로자를 말한다.\n제3조(휴일) 근로자의 날은 유급휴일로 한다.\n제4조(급여) 근로자에게는 수당을 준다.', { doc_id: 'x', title: '가 규정' });
  const p = findPoints(d, '근로자', '직원');
  assert.deepEqual(p.map((x) => [x.ref, x.word, x.compound]), [['제4조', '근로자에게는', false]]);
  assert.equal(p[0].newWord, '직원에게는');
});
test('an ALIO MCP call that never answers gives up (null) instead of hanging the job', async () => {
  const { createAlioMcp } = await import('../lib/alio-mcp.mjs');
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))));
  const m = createAlioMcp({ url: 'https://mcp.example/x', fetchImpl: hang, timeoutMs: 50 });
  const t0 = Date.now(); assert.equal(await m.call('get_related', {}), null); assert.ok(Date.now() - t0 < 2000);
});
test('a job that runs too long (excluding waits for the user) ends as job_timeout and is logged once', async () => {
  const { createJobs } = await import('../lib/jobs.mjs');
  const recs = []; const jobs = createJobs({ maxRunMs: 120, onEnd: (r) => recs.push(r) });
  const id = jobs.start('x', {}, () => new Promise(() => {}));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(jobs.get(id).status, 'failed'); assert.equal(jobs.get(id).error.code, 'job_timeout'); assert.equal(recs.length, 1);
  // 사람 확인을 기다리는 시간은 세지 않는다
  const id2 = jobs.start('y', {}, async (ctx) => { await ctx.gate({ id: 'g' }); return { ok: 1 }; });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(jobs.get(id2).status, 'waiting');
  jobs.answer(id2, 'g', 1); await new Promise((r) => setTimeout(r, 20));
  assert.equal(jobs.get(id2).status, 'done');
});
test('full text after amendment applies amended, inserted, deleted and moved articles in place, with new addenda before annexes', async () => {
  const { consolidatedDoc } = await import('../flows/docset.mjs');
  const doc = { title: '가 규정', articles: [
    { section: '본칙', ref: '제1조', no: 1, title: '목적', body: '이 규정은 목적을 정한다.', chapter: '제1장 총칙' },
    { section: '본칙', ref: '제2조', no: 2, title: '휴가', body: '10일을 준다.', chapter: '제1장 총칙' },
    { section: '본칙', ref: '제3조', no: 3, title: '기록', body: '기록한다.', chapter: '제2장 보칙' },
    { section: '본칙', ref: '제4조', no: 4, title: '보존', body: '3년 보존한다.', chapter: '제2장 보칙' },
    { section: '부칙', ref: '제1조', no: 1, title: '시행일', body: '이 규정은 2020.1.1.부터 시행한다.' },
    { section: '별표', ref: null, title: '[별표 1] 서식', body: '| 구분 | 값 |' } ] };
  const t = consolidatedDoc({ doc, changes: [
    { op: 'amend', ref: '제2조', title: '휴가', new: '20일을 준다.' },
    { op: 'insert', ref: '제2조의2', after: '제2조', title: '배우자 출산휴가', new: '20일의 유급휴가를 준다.' },
    { op: 'delete', ref: '제3조' },
    { op: 'amend', ref: '제4조', new_ref: '제5조', title: '보존', new: '5년 보존한다.' } ], addendaText: '이 규정은 발령한 날부터 시행한다.' });
  const i = (x) => t.indexOf(x);
  assert.ok(i('제1조(목적) 이 규정은 목적을 정한다.') > 0);
  assert.match(t, /제2조\(휴가\) 〈개정〉 20일을 준다\./);
  assert.ok(i("제2조의2(배우자 출산휴가)") > i("제2조(휴가)") && i('제2조의2') < i('제3조 삭제'));
  assert.match(t, /제5조\(보존\) 〈개정 · 조 번호 이동 제4조→제5조〉 5년 보존한다\./);
  assert.ok(i('제2장 보칙') > i('제1장 총칙'));
  assert.ok(i('〈이번 개정〉') > i('2020.1.1.') && i('〈이번 개정〉') < i('[별표 1] 서식'));
});
test('a confirmation that nobody is watching stops counting as active after 5 minutes', async () => {
  const { createJobs } = await import('../lib/jobs.mjs');
  const jobs = createJobs();
  const id = jobs.start('x', {}, async (ctx) => { await ctx.gate({ id: 'g' }); });
  await new Promise((r) => setTimeout(r, 20));
  jobs.get(id); assert.equal(jobs.active(), 1);
  const realNow = Date.now; Date.now = () => realNow() + 6 * 60e3;
  try { assert.equal(jobs.active(), 0); } finally { Date.now = realNow; }
  jobs.answer(id, 'g', 1);
});
