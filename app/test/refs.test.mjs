import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCitations, findCiting, renumber, corrections } from '../lib/refs.mjs';
import { parseRegulationText } from '../lib/parse.mjs';

test('extractCitations finds article, annex, form and external law citations in order', () => {
  const c = extractCitations('제5조제2항 및 별표 2, 별지 제3호서식, 「근로기준법」 제60조에 따른다.');
  assert.deepEqual(c.map((x) => x.kind), ['article', 'annex', 'form', 'external']);
  assert.equal(c[0].no, 5); assert.equal(c[0].para, 2);
  assert.equal(c[1].no, 2); assert.equal(c[2].no, 3);
  assert.equal(c[3].name, '근로기준법'); assert.equal(c[3].no, 60);
});

test('extractCitations treats bare paragraph refs as paragraph and ignores "같은 조"', () => {
  const c = extractCitations('제1항에도 불구하고 같은 조 제2호에 따른다.');
  assert.deepEqual(c.map((x) => x.kind), ['paragraph']);
});

const DOC = parseRegulationText(`가 규정
제1조(목적) 목적.
제4조(출장) 출장.
제5조(정산) 정산은 7일 이내.
제5조의2(특례) 제5조의 특례.
제9조(징계) 제5조 또는 제5조의2를 위반하면 징계한다.
부 칙
제1조(시행일) 이 규정은 공포한 날부터 시행한다. 제5조는 2026년부터 적용한다.`, { doc_id: 'A', title: '가나다공단 여비규정' });
const OTHER = parseRegulationText(`나 규정
제3조(준용) 「여비규정」 제5조를 준용한다.`, { doc_id: 'B', title: '가나다공단 복무규정' });

test('insert with renumber shifts later articles and keeps branch suffix', () => {
  const { map, inserted } = renumber(DOC, [{ op: 'insert', after: '제4조', renumber: true }]);
  assert.equal(map.get('제5조'), '제6조');
  assert.equal(map.get('제5조의2'), '제6조의2');
  assert.equal(map.get('제9조'), '제10조');
  assert.equal(map.has('제4조'), false);
  assert.deepEqual(inserted.map((x) => x.ref), ['제5조']);
});

test('insert without renumber creates a branch article and moves nothing', () => {
  const { map, inserted } = renumber(DOC, [{ op: 'insert', after: '제5조', renumber: false }]);
  assert.equal(map.size, 0);
  assert.deepEqual(inserted.map((x) => x.ref), ['제5조의3']);
});

test('delete with renumber maps deleted article to null and shifts the rest', () => {
  const { map } = renumber(DOC, [{ op: 'delete', ref: '제4조', renumber: true }]);
  assert.equal(map.get('제4조'), null);
  assert.equal(map.get('제5조'), '제4조');
  assert.equal(map.get('제9조'), '제8조');
});

test('corrections rewrite citing main articles in same and other docs, not addenda', () => {
  const { map } = renumber(DOC, [{ op: 'insert', after: '제4조', renumber: true }]);
  const rows = corrections([DOC, OTHER], 'A', map);
  const r9 = rows.find((r) => r.doc_id === 'A' && r.ref === '제9조');
  assert.equal(r9.after, '제6조 또는 제6조의2를 위반하면 징계한다.');
  const r52 = rows.find((r) => r.doc_id === 'A' && r.ref === '제5조의2');
  assert.equal(r52.after, '제6조의 특례.');
  const rb = rows.find((r) => r.doc_id === 'B');
  assert.equal(rb.after, '「여비규정」 제6조를 준용한다.');
  assert.equal(rows.some((r) => r.section === '부칙'), false);
});

test('findCiting finds citing articles across docs', () => {
  const hits = findCiting([DOC, OTHER], { doc_id: 'A', ref: '제5조' });
  assert.deepEqual(hits.map((h) => `${h.doc_id}:${h.ref}`).sort(), ['A:제5조의2', 'A:제9조', 'B:제3조']);
});

test('abbreviated references to other statutes are external, not same-document articles', () => {
  const c = extractCitations('법 제28조제1항 각 호, 규정 제13조의2, 이 규정 제5조, 영 제3조, 같은 법 제7조에 따른다.');
  assert.deepEqual(c.map((x) => `${x.kind}:${x.no}`), ['external:28', 'external:13', 'article:5', 'external:3', 'external:7']);
});
test('renumbering corrections do not rewrite abbreviated external citations', () => {
  const d = parseRegulationText('가 규정\n제4조(가) 가.\n제5조(나) 나.\n제9조(다) 법 제5조와 제5조에 따른다.', { doc_id: 'A', title: '가 규정' });
  const { map } = renumber(d, [{ op: 'insert', after: '제4조', renumber: true }]);
  assert.equal(corrections([d], 'A', map).find((r) => r.ref === '제9조').after, '법 제5조와 제6조에 따른다.');
});
