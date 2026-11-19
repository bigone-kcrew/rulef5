import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegulationText, refOf, parseRef } from '../lib/parse.mjs';
import { hwpxToText } from '../lib/unzip.mjs';
import { makeHwpx } from './fixtures/make-hwpx.mjs';

const TEXT = `○○공단 복무규정
제1장 총칙
제1조(목적) 이 규정은 직원의 복무에 관한 사항을 정한다.
제10조의2(정의) 이 규정에서 사용하는 용어의 뜻은 다음과 같다.
1. "직원"이란 공단에 근무하는 자를 말한다.
제3장 휴가
제11조(특별휴가) ① 공단은 직원에게 다음 각 호의 특별휴가를 준다.
② 배우자 출산휴가는 10일로 한다.
부 칙
제1조(시행일) 이 규정은 2026년 1월 1일부터 시행한다.
[별표 1] 경조사 휴가 일수
별표 1에 따른 휴가는 유급으로 한다.
본인 결혼 5일`;

test('refOf and parseRef round-trip branch articles', () => {
  assert.equal(refOf(10, 2), '제10조의2');
  assert.equal(refOf(3, null), '제3조');
  assert.deepEqual(parseRef('제10조의2'), { no: 10, sub: 2 });
  assert.equal(parseRef('제조'), null);
});

test('parser separates main articles, addenda and annex', () => {
  const d = parseRegulationText(TEXT, { doc_id: 'upload:t/1', title: '○○공단 복무규정' });
  const main = d.articles.filter((a) => a.section === '본칙');
  assert.deepEqual(main.map((a) => a.ref), ['제1조', '제10조의2', '제11조']);
  assert.equal(main[1].title, '정의');
  assert.equal(main[2].chapter, '제3장 휴가');
  assert.match(main[2].body, /② 배우자 출산휴가는 10일/);
  const add = d.articles.filter((a) => a.section === '부칙');
  assert.equal(add.length, 1); assert.equal(add[0].ref, '제1조'); assert.equal(add[0].title, '시행일');
  const annex = d.articles.filter((a) => a.section === '별표');
  assert.equal(annex.length, 1); assert.match(annex[0].title, /별표 1/); assert.match(annex[0].body, /본인 결혼 5일/);
});

test('text without article pattern yields no articles', () => {
  assert.equal(parseRegulationText('그냥 메모입니다.\n둘째 줄', { doc_id: 'u', title: 't' }).articles.length, 0);
});

test('hwpxToText extracts paragraphs from deflated and stored hwpx', () => {
  for (const deflate of [true, false]) {
    const t = hwpxToText(makeHwpx('제1조(목적) A &amp; B\n제2조(정의) <C>', { deflate }));
    assert.match(t, /제1조\(목적\) A &amp; B\n제2조\(정의\) <C>/);
  }
});

test('hwpxToText rejects non-zip input', () => {
  assert.throws(() => hwpxToText(Buffer.from('not a zip')), (e) => e.code === 'invalid_hwpx');
  assert.throws(() => hwpxToText(Buffer.alloc(0)), (e) => e.code === 'invalid_hwpx');
});

test('sample hwpx regulation parses into main articles, addenda and annex', async () => {
  const { readFileSync } = await import('node:fs');
  const d = parseRegulationText(hwpxToText(readFileSync(new URL('./fixtures/인용오류_예시규정.hwpx', import.meta.url))), { doc_id: 'x' });
  assert.equal(d.title, '라마바재단 여비 및 복무 규정');
  assert.equal(d.articles.filter((a) => a.section === '본칙').length, 8);
  assert.equal(d.articles.filter((a) => a.section === '부칙').length, 1);
});
