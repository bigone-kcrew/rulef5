// 법제처 Open API 인증키(OC): 기본은 서버 키, 사용자가 넣으면 그 요청에만 사용(저장·기록하지 않음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSources } from '../lib/sources.mjs';
import { parseLawOc } from '../lib/routes.mjs';
const ordinJson = { OrdinSearch: { totalCnt: '1', law: [{ 자치법규일련번호: '7', 자치법규명: '가시 복무 조례', 지자체기관명: '경기도 가시', 자치법규종류: '조례' }] } };
const fakeFetch = (seen) => async (url) => { seen.push(String(url)); return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ordinJson, text: async () => JSON.stringify(ordinJson) }; };

test('server OC is the default; a user OC replaces it only for that view and shares the cache', async () => {
  const seen = [];
  const s = createSources({ LAW_API_OC: 'serverkey', ALIO_API_BASE: 'https://alio.example/api' }, fakeFetch(seen));
  assert.equal(s.status().law_go, true); assert.equal(s.status().law_source, 'server');
  await s.gov.search({ target: 'ordin', keyword: '복무', pages: 1 });
  assert.match(seen.at(-1), /OC=serverkey/);
  const u = s.withLawOc('mykey');
  assert.equal(u.status().law_source, 'user');
  await u.gov.search({ target: 'ordin', keyword: '인사', pages: 1 });
  assert.match(seen.at(-1), /OC=mykey/);
  const n = seen.length; await u.gov.search({ target: 'ordin', keyword: '복무', pages: 1 }); // 서버 키로 받은 같은 자료는 캐시를 함께 쓴다
  assert.equal(seen.length, n);
  // 업로드 자료는 함께 본다
  s.registerUpload({ doc_id: 'upload:aaaaaaaaaaaaaaaa/0', title: 'x', articles: [] });
  assert.equal((await u.loadDoc('upload:aaaaaaaaaaaaaaaa/0')).title, 'x');
});
test('without a server OC the 법제처 features are off until a user provides one', () => {
  const s = createSources({ ALIO_API_BASE: 'https://alio.example/api' }, fakeFetch([]));
  assert.equal(s.status().law_go, false); assert.equal(s.gov.enabled, false);
  assert.equal(s.withLawOc('mykey').gov.enabled, true);
});
test('the OC header is validated', () => {
  assert.equal(parseLawOc(undefined), null); assert.equal(parseLawOc(''), null);
  assert.equal(parseLawOc('my.key_1'), 'my.key_1');
  assert.throws(() => parseLawOc('a b'), /OC/); assert.throws(() => parseLawOc('x'.repeat(80)), /OC/); assert.throws(() => parseLawOc('a&b=c'), /OC/);
});
test('the OC is removed from 법제처 responses before they are cached or returned', async () => {
  const cacheStore = new Map();
  const cache = { get: (k) => cacheStore.get(k), set: (k, v) => cacheStore.set(k, v) };
  const { createLawGo } = await import('../lib/law-go.mjs');
  const g = createLawGo({ oc: 'secretoc', cache, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ OrdinSearch: { totalCnt: '1', law: [{ 자치법규일련번호: '7', 자치법규명: '가', 지자체기관명: '나', 자치법규상세링크: '/DRF/lawService.do?OC=secretoc&target=ordin&MST=7' }] } }), text: async () => '' }) });
  await g.search('ordin', '가');
  const dump = JSON.stringify([...cacheStore]);
  assert.doesNotMatch(dump, /secretoc/); assert.match(dump, /OC=&target/);
});
