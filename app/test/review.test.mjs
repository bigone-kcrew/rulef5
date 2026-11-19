// 초안 자체 검토(결정적 탐지 + 모델 검토·수정) 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../lib/llm.mjs';
import { detectIssues, selfReview, lawNamesIn } from '../flows/review.mjs';
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const DOCTEXT = '제2조(정의) 1. "직원"이란 공단에 근무하는 근로자를 말한다.\n제7조(특별휴가) ② 공단은 직원에게 10일의 휴가를 준다.';
const law = (known) => ({ searchLaw: async (q) => ({ rows: known.filter((k) => k.startsWith(q.slice(0, 4))).map((t) => ({ title: t })), errors: [] }) });

test('law names are taken from brackets and named statutes', () => {
  assert.deepEqual(lawNamesIn('「근로기준법」 제60조와 남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률 제18조의2, 「소상공인시장진흥법」에 따라'), ['근로기준법', '소상공인시장진흥법', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률']);
});
test('detects law terms the regulation does not use, unknown law names, and civil-service law in a public institution', async () => {
  const items = [{ ref: '제7조', title: '특별휴가', text: '② 사업주는 근로자에게 20일의 휴가를 준다. 「소상공인시장진흥법」 및 「국가공무원법」에 따른다.' }];
  const r = await detectIssues({ items, docText: DOCTEXT, profile: { type: 'public-institution' }, sources: law(['국가공무원법']) });
  const t = r.map((x) => x.problem).join('\n');
  assert.match(t, /사업주/); assert.match(t, /"근로자"/); // 정의 조항에만 있는 말이므로 본문 주체로는 낯선 말이다
  assert.match(t, /소상공인시장진흥법.*찾지 못했습니다/); assert.match(t, /국가공무원법.*공공기관/);
  assert.ok(r.every((x) => x.ref === '제7조'));
});
test('law-name check is skipped (not flagged) when the search itself fails', async () => {
  const r = await detectIssues({ items: [{ ref: '제1조', title: '', text: '「없는법」에 따른다.' }], docText: '', profile: {}, sources: { searchLaw: async () => ({ rows: [], errors: ['ALIO', '법제처'] }) } });
  assert.equal(r.length, 0);
});
test('self review applies valid fixes, ignores unknown refs, and reports what remains', async () => {
  const items = [{ ref: '제7조', title: '특별휴가', old: '② 공단은 직원에게 10일의 휴가를 준다.\n③ 최초 5일은 유급으로 한다.', text: '② 사업주는 직원에게 20일의 유급휴가를 준다.\n③ 최초 5일은 유급으로 한다.' }];
  const llm = llmOf({ issues: [{ ref: '제7조', problem: '③항이 ②항(전부 유급)과 모순, "사업주" 용어', fixed_text: '② 공단은 직원에게 20일의 유급휴가를 준다.' }, { ref: '제99조', problem: 'x', fixed_text: 'y' }] });
  const r = await selfReview({ llm, sources: law([]), items, intent: '20일로', evidence: [], docText: DOCTEXT, profile: { type: 'public-institution' } });
  assert.equal(r.fixed.get('제7조'), '② 공단은 직원에게 20일의 유급휴가를 준다.');
  assert.equal(r.applied.length, 1); assert.match(r.applied[0].problem, /모순/);
  assert.deepEqual(r.remaining, []);
});
test('self review keeps the draft and lists deterministic issues when the model fails or is absent', async () => {
  const items = [{ ref: '제7조', title: '특별휴가', text: '② 사업주는 직원에게 20일을 준다.' }];
  const r = await selfReview({ llm: null, sources: law([]), items, intent: 'x', evidence: [], docText: DOCTEXT, profile: {} });
  assert.equal(r.fixed.size, 0); assert.match(r.remaining.join('\n'), /사업주/);
});
test('a fix that drops most of the article is rejected', async () => {
  const long = '① ' + '가'.repeat(300) + '\n② 사업주는 20일을 준다.\n③ ' + '나'.repeat(300);
  const llm = llmOf({ issues: [{ ref: '제7조', problem: '용어', fixed_text: '② 공단은 20일을 준다.' }] });
  const r = await selfReview({ llm, sources: law([]), items: [{ ref: '제7조', title: 't', text: long }], intent: 'x', evidence: [], docText: DOCTEXT, profile: {} });
  assert.equal(r.fixed.size, 0); assert.match(r.remaining.join('\n'), /사업주/);
});
test('a term found only in the definition article or in compounds still counts as foreign in the amended article', async () => {
  const doc = '제2조(정의) 1. "직원"이란 공단에 근무하는 근로자를 말한다.\n2. "근무일"이란 근로자의 날을 제외한 날을 말한다.\n제7조(특별휴가) ② 공단은 직원에게 10일의 휴가를 준다.';
  const r = await detectIssues({ items: [{ ref: '제7조', title: '특별휴가', old: '② 공단은 직원에게 10일의 휴가를 준다.', text: '② 공단은 근로자에게 20일의 휴가를 준다.' }], docText: doc, profile: {}, sources: law([]) });
  assert.match(r.map((x) => x.problem).join(), /"근로자"/);
});
test('a review fix that introduces law terms or new issues is rejected', async () => {
  const items = [{ ref: '제7조', title: '특별휴가', old: '② 공단은 직원에게 10일의 휴가를 준다.', text: '② 공단은 직원에게 20일의 휴가를 준다.' }];
  const llm = llmOf({ issues: [{ ref: '제7조', problem: '용어', fixed_text: '② 공단은 근로자에게 20일의 휴가를 준다.' }] });
  const r = await selfReview({ llm, sources: law([]), items, intent: 'x', evidence: [], docText: DOCTEXT, profile: {} });
  assert.equal(r.fixed.size, 0); assert.equal(r.rejected.length, 1);
});
test('a paragraph that states its own deletion becomes the conventional "③ 삭제"', async () => {
  const { tidyDeletedParagraphs } = await import('../flows/review.mjs');
  assert.equal(tidyDeletedParagraphs('② 20일로 한다.\n③ 제2항의 휴가 기간 중 최초 5일은 유급으로 한다는 규정은 삭제한다.'), '② 20일로 한다.\n③ 삭제');
  assert.equal(tidyDeletedParagraphs('② 보존기간이 지난 기록은 삭제한다.'), '② 보존기간이 지난 기록은 삭제한다.');
});
test('a review fix that adds words found nowhere in the intent, evidence, current text or document is rejected', async () => {
  const items = [{ ref: '제5조', title: '휴무', old: '숙직 종료일에 휴무하지 못한 경우 6주 이내에 휴무일을 지정한다.', text: '숙직 종료일에 휴무하지 못한 경우 10일 이내에 휴무일을 지정한다.' }];
  const llm = llmOf({ issues: [{ ref: '제5조', problem: '기한 명확화', fixed_text: '숙직 종료일에 휴무하지 못한 경우 휴일을 제외한 10일 이내에 휴무일을 지정한다.' }] });
  const r = await selfReview({ llm, sources: law([]), items, intent: '휴무 지정 기한을 6주 이내에서 10일 이내로 줄인다.', evidence: [], docText: '제5조(휴무) 숙직 종료일에 휴무하지 못한 경우 6주 이내에 휴무일을 지정한다.', profile: {} });
  assert.equal(r.fixed.size, 0); assert.match(r.rejected[0].why, /휴일/);
});
test('a review fix that turns the institution\'s subject back into law subjects is rejected even if the regulation uses 근로자', async () => {
  const doc = '제19조(연차휴가) ① 1년간 8할 이상 출근한 근로자에게는 15일의 연차유급휴가를 준다.';
  const items = [{ ref: '제20조의2', title: '배우자 출산휴가', text: '① 창진원은 직원이 배우자의 출산을 이유로 휴가를 청구하면 20일의 유급휴가를 준다.' }];
  const llm = llmOf({ issues: [{ ref: '제20조의2', problem: '법령 주체(사업주·근로자)를 직원으로 잘못 표기', fixed_text: '① 사업주는 근로자가 배우자의 출산을 이유로 휴가를 청구하면 20일의 유급휴가를 준다.' }] });
  const r = await selfReview({ llm, sources: law([]), items, intent: '배우자 출산휴가 20일', evidence: [], docText: doc, profile: {} });
  assert.equal(r.fixed.size, 0); assert.match(r.rejected[0].why, /법률 주체/);
});
test('delegation to a presidential decree inside an internal regulation is flagged', async () => {
  const r = await detectIssues({ items: [{ ref: '제20조의2', title: 't', text: '② 신청 절차 등에 필요한 사항은 대통령령으로 정한다.' }], docText: '제1조(목적) 이 규칙은 …', profile: {}, sources: law([]) });
  assert.match(r.map((x) => x.problem).join(), /대통령령으로 정한다/);
});
test('a decree delegation sentence in a new article becomes "따로 정한다"', async () => {
  const r = await selfReview({ llm: null, sources: law([]), items: [{ ref: '제20조의2', title: 't', text: '② 신청 절차 등에 필요한 사항은 대통령령으로 정한다.' }], intent: 'x', evidence: [], docText: '제1조(목적) 이 규칙은 …', profile: {} });
  assert.equal(r.fixed.get('제20조의2'), '② 신청 절차 등에 필요한 사항은 따로 정한다.'); assert.deepEqual(r.remaining, []);
});
test('a review fix that drops paragraphs of a short new article is rejected', async () => {
  const items = [{ ref: '제36조의2', title: '배우자 출산휴가', text: '① 직원에게 20일의 휴가를 준다.\n② 50일 전부터 청구할 수 있다.\n③ 120일이 지나면 청구할 수 없다.\n④ 필요한 사항은 대통령령으로 정한다.' }];
  const llm = llmOf({ issues: [{ ref: '제36조의2', problem: '대통령령 위임 부적절', fixed_text: '④ 필요한 사항은 원장이 정한다.' }] });
  const r = await selfReview({ llm, sources: law([]), items, intent: '배우자 출산휴가 20일', evidence: [], docText: '제1조(목적) …', profile: {} });
  assert.match(r.rejected[0].why, /빠뜨림/);
  assert.equal(r.fixed.get('제36조의2'), items[0].text.replace('대통령령으로 정한다', '따로 정한다'));
});
test('"사업주" copied from the law becomes the subject the regulation actually uses, with particles fixed', async () => {
  const { subjectOf } = await import('../flows/review.mjs');
  const doc = '제20조(산전, 산후휴가) 창진원은 임신 중인 여성 근로자에게 90일의 휴가를 준다.\n제21조(경조휴가) 창진원은 경조사휴가를 준다.\n제48조(성희롱) 사업주는 성희롱 행위자를 징계한다.\n제2조 직원은 성실히 근무한다.';
  assert.equal(subjectOf(doc), '창진원');
  const r = await selfReview({ llm: null, sources: law([]), items: [{ ref: '제21조의2', title: '배우자 출산휴가', text: '④ 사업주는 배우자 출산휴가를 이유로 직원을 해고하여서는 아니 된다. 사업주가 정한다.' }], intent: 'x', evidence: [], docText: doc, profile: {} });
  assert.equal(r.fixed.get('제21조의2'), '④ 창진원은 배우자 출산휴가를 이유로 직원을 해고하여서는 아니 된다. 창진원이 정한다.');
});
test('the replacement for "사업주" follows the regulation: the head (원장) when it is used as subject often, else the institution', async () => {
  const { subjectOf } = await import('../flows/review.mjs');
  assert.equal(subjectOf('창진원은 휴가를 준다.\n창진원은 수당을 준다.\n창진원은 교육을 한다.'), '창진원');
  assert.equal(subjectOf('창진원은 휴가를 준다.\n창진원은 수당을 준다.\n원장은 휴가를 부여한다.\n원장은 승인한다.'), '원장');
  assert.equal(subjectOf('공단은 정한다.\n이사장은 승인한다.\n이사장은 임명한다.\n공단은 준다.\n공단은 둔다.'), '이사장');
  assert.equal(subjectOf('직원은 근무한다.\n직원은 따른다.'), null);
});
test('double paragraph citations and "1)" used as item marks are flagged', async () => {
  const r = await detectIssues({ items: [{ ref: '제5조', title: 't', text: '① 제4조제2항 제1항에 따라 신청한다.\n② 다음 사항을 정한다.\n1) 대상\n2) 기간' }], docText: '제1조(목적) …', profile: {}, sources: law([]) });
  const t = r.map((x) => x.problem).join('\n');
  assert.match(t, /항이 두 번/); assert.match(t, /「1\)」/);
  const ok = await detectIssues({ items: [{ ref: '제5조', title: 't', text: '① 제4조제2항 및 제3항에 따른다.\n1. 대상' }], docText: '제1조(목적) …', profile: {}, sources: law([]) });
  assert.equal(ok.length, 0);
});
