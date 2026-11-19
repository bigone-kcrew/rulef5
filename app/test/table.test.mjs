import test from 'node:test';
import assert from 'node:assert/strict';
import { diffMarks, buildComparison, amendmentText, renderDocSet, toCsv, splitParagraphs } from '../lib/table.mjs';

test('diffMarks underlines changed words only', () => {
  const r = diffMarks('배우자 출산휴가는 10일의 유급으로 한다.', '배우자 출산휴가는 20일의 유급으로 한다.');
  assert.equal(r.oldHtml, '배우자 출산휴가는 <u>10일의</u> 유급으로 한다.');
  assert.equal(r.newHtml, '배우자 출산휴가는 <u>20일의</u> 유급으로 한다.');
});

test('diffMarks escapes html', () => {
  const r = diffMarks('<script>a</script> 가', '<script>a</script> 나');
  assert.ok(!r.oldHtml.includes('<script>')); assert.match(r.newHtml, /&lt;script&gt;/);
});

test('splitParagraphs splits on circled numbers', () => {
  assert.deepEqual(splitParagraphs('① 가.\n② 나.\n1. 호\n③ 다.'), ['① 가.', '② 나.\n1. 호', '③ 다.']);
});

test('unchanged paragraphs become (현행과 같음) on the new side', () => {
  const rows = buildComparison([{ op: 'amend', ref: '제7조', title: '특별휴가', old: '① 경조사휴가를 준다.\n② 배우자 출산휴가는 10일로 한다.\n③ 최초 5일은 유급으로 한다.', new: '① 경조사휴가를 준다.\n② 배우자 출산휴가는 20일로 한다.\n③ 최초 5일은 유급으로 한다.' }]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].newHtml, '(현행과 같음)');
  assert.match(rows[1].newHtml, /<u>20일로<\/u>/);
  assert.equal(rows[2].newHtml, '(현행과 같음)');
  assert.match(rows[0].oldHtml, /^제7조\(특별휴가\) ①/);
});

test('insert shows <신 설> on old side and delete shows <삭 제> on new side', () => {
  const rows = buildComparison([{ op: 'insert', ref: '제7조의2', title: '가족돌봄', old: '', new: '가족돌봄휴가를 준다.' }, { op: 'delete', ref: '제9조', title: '승인', old: '부서장이 승인한다.', new: '' }]);
  assert.equal(rows[0].oldHtml, '&lt;신 설&gt;'); assert.match(rows[0].newHtml, /<u>제7조의2\(가족돌봄\) 가족돌봄휴가를 준다\.<\/u>/);
  assert.match(rows[1].oldHtml, /제9조\(승인\)/); assert.equal(rows[1].newHtml, '&lt;삭 제&gt;');
});

test('amendmentText writes 일부개정 directive sentences', () => {
  const t = amendmentText('가나다공단 복무규정', [{ op: 'amend', ref: '제7조', title: '특별휴가', new: '② 20일로 한다.' }, { op: 'insert', ref: '제7조의2', title: '가족돌봄', new: '돌봄휴가를 준다.' }, { op: 'delete', ref: '제9조' }], { kind: '일부개정' });
  assert.match(t, /^가나다공단 복무규정 일부를 다음과 같이 개정한다\./);
  assert.match(t, /제7조를 다음과 같이 한다\./);
  assert.match(t, /제7조의2를 다음과 같이 신설한다\./);
  assert.match(t, /제9조를 삭제한다\./);
});

test('renderDocSet markdown includes notice and evidence; csv quotes cells', () => {
  const md = renderDocSet({ kind: '개정', title: 'X 규정', sections: [{ id: 'reason', title: '개정이유', body: '이유' }, { id: 'comparison', title: '신구조문대비표', rows: [{ ref: '제1조', oldHtml: '<u>가</u>', newHtml: '나' }] }], evidence: [{ label: 'ALIO', doc_id: 'bylaws:x', ref: '제1조', edition: '현행' }] }, 'md');
  assert.match(md, /AI 초안입니다\. 담당자가 원문과 대조·검토해야 합니다\./);
  assert.match(md, /\| <u>가<\/u> \| 나 \|/);
  assert.match(md, /bylaws:x/);
  assert.equal(toCsv([{ ref: '제1조', oldHtml: '<u>a,"b"</u>', newHtml: 'c' }]), '﻿조문,현행,개정안\r\n제1조,"a,""b""",c\r\n');
});

test('amendmentText uses phrase-level directives for small in-paragraph edits', () => {
  const t = amendmentText('취업규칙', [{ op: 'amend', ref: '제79조', title: '배우자 출산휴가', old: '① 10일의 휴가를 준다.\n② 유급으로 한다.\n③ 90일이 지나면 청구할 수 없다.', new: '① 20일의 휴가를 준다.\n② 유급으로 한다.\n③ 120일이 지나면 청구할 수 없다.' }]);
  assert.match(t, /제79조제1항 중 "10일의"를 "20일의"로 하고, 같은 조 제3항 중 "90일이"를 "120일이"로 한다\./);
  assert.doesNotMatch(t, /다음과 같이 한다/);
});

test('amendmentText rewrites the whole article when structure changes', () => {
  const t = amendmentText('취업규칙', [{ op: 'amend', ref: '제5조', title: '출장', old: '① 가.\n② 나.', new: '① 가.\n② 나.\n③ 다.' }]);
  assert.match(t, /제5조를 다음과 같이 한다\./);
});

test('paragraphs differing only in whitespace count as unchanged', () => {
  const rows = buildComparison([{ op: 'amend', ref: '제1조', title: '', old: '① 가 나.\n② 다  라 ', new: '① 가 다.\n② 다 라' }]);
  assert.equal(rows[1].newHtml, '(현행과 같음)');
});
