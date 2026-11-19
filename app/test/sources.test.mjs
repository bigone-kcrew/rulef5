import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlioRest } from '../lib/alio-rest.mjs';
import { createAlioMcp } from '../lib/alio-mcp.mjs';
import { createLawGo, lawJsonToDoc } from '../lib/law-go.mjs';
import { createCache } from '../lib/cache.mjs';
import { createSources } from '../lib/sources.mjs';

const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const recorder = (handler) => { const calls = []; const f = async (url, init) => { calls.push(String(url)); return handler(String(url), init); }; f.calls = calls; return f; };

test('rest search serializes booleans and fills doc_id', async () => {
  const f = recorder(() => json({ rows: [{ corpus: 'bylaws', rel_path: 'a/b.md', art_ref: '제1조' }], count: 1, has_more: false, degraded: ['semantic'] }));
  const rest = createAlioRest({ base: 'https://x/api', fetchImpl: f });
  const r = await rest.search({ keyword: '출장', corpus: 'bylaws', hybrid: true, all_versions: true, inst: undefined });
  const u = new URL(f.calls[0]);
  assert.equal(u.pathname, '/api/search'); assert.equal(u.searchParams.get('hybrid'), '1'); assert.equal(u.searchParams.get('all_versions'), '1'); assert.equal(u.searchParams.has('inst'), false);
  assert.equal(r.rows[0].doc_id, 'bylaws:a/b.md');
  assert.deepEqual(r.degraded, ['semantic']);
});

test('rest document merges pages and maps articles', async () => {
  const page = (offset, n, total) => ({ document: { doc_id: 'bylaws:d', doc_title: '복무규정', inst_name: '가공단', edition_state: 'superseded', effective_from: '20240101' }, articles: Array.from({ length: n }, (_, i) => ({ seq: offset + i + 1, section: '본칙', art_no: offset + i + 1, art_sub: null, title: 't', body: 'b', chapter: null })), total_articles: total, next_offset: offset + n < total ? offset + n : null });
  const f = recorder((url) => { const off = +new URL(url).searchParams.get('offset'); return json(off === 0 ? page(0, 200, 250) : page(200, 50, 250)); });
  const doc = await createAlioRest({ base: 'https://x/api', fetchImpl: f }).document('bylaws:d');
  assert.equal(f.calls.length, 2); assert.equal(doc.articles.length, 250);
  assert.equal(doc.articles[249].ref, '제250조'); assert.equal(doc.title, '복무규정'); assert.equal(doc.inst, '가공단');
  assert.match(doc.edition.warning, /구판/);
});

test('rest maps 5xx and network errors to source_unavailable', async () => {
  const rest = createAlioRest({ base: 'https://x/api', fetchImpl: async () => json({}, 503) });
  await assert.rejects(rest.search({ keyword: 'a' }), (e) => e.code === 'source_unavailable');
  const rest2 = createAlioRest({ base: 'https://x/api', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(rest2.search({ keyword: 'a' }), (e) => e.code === 'source_unavailable');
});

test('cache hit avoids second fetch', async () => {
  const f = recorder(() => json({ rows: [] }));
  const rest = createAlioRest({ base: 'https://x/api', fetchImpl: f, cache: createCache({ max: 10, ttlMs: 60000 }) });
  await rest.search({ keyword: 'a' }); await rest.search({ keyword: 'a' });
  assert.equal(f.calls.length, 1);
});

test('mcp disabled without url; parses tool result text', async () => {
  assert.equal(createAlioMcp({}).enabled, false);
  const f = async () => json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: '{"incoming":[{"doc_id":"bylaws:x","art_ref":"제3조"}]}' }] } });
  const mcp = createAlioMcp({ url: 'http://m/mcp', fetchImpl: f });
  const r = await mcp.related({ doc_id: 'legal:a', art_no: 18, direction: 'incoming' });
  assert.equal(r.incoming[0].art_ref, '제3조');
  const bad = createAlioMcp({ url: 'http://m/mcp', fetchImpl: async () => json({ error: { message: 'x' } }) });
  assert.equal(await bad.related({ doc_id: 'legal:a', art_no: 1 }), null);
});

test('law.go.kr disabled without OC; law JSON becomes Doc with branch articles', () => {
  assert.equal(createLawGo({}).enabled, false);
  const doc = lawJsonToDoc({ 법령: { 기본정보: { 법령명_한글: '테스트법', 시행일자: '20260918', 법종구분: { content: '법률' } }, 조문: { 조문단위: [
    { 조문번호: '1', 조문여부: '전문', 조문내용: '제1장 총칙', 조문키: '0001000' },
    { 조문번호: '18', 조문가지번호: '2', 조문여부: '조문', 조문제목: '배우자 출산휴가', 조문키: '0018021', 조문내용: '제18조의2(배우자 출산휴가)', 항: [{ 항번호: '①', 항내용: '① 20일의 휴가를 주어야 한다.' }, { 항번호: '②', 항내용: '② 대통령령으로 정한다.', 호: [{ 호내용: '1. 첫째' }] }] },
  ] } } }, 'law', '123');
  assert.equal(doc.doc_id, 'law:law:123'); assert.equal(doc.title, '테스트법');
  assert.equal(doc.articles.length, 1); assert.equal(doc.articles[0].ref, '제18조의2');
  assert.match(doc.articles[0].body, /① 20일의 휴가를 주어야 한다\.\n② 대통령령으로 정한다\.\n1\. 첫째/);
  assert.equal(doc.articles[0].chapter, '제1장 총칙');
});

test('sources routes upload doc ids to registry and reports status', async () => {
  const s = createSources({ ALIO_API_BASE: 'https://x/api' }, async () => json({ rows: [] }));
  s.registerUpload({ doc_id: 'upload:w1/0', title: 't', articles: [] });
  assert.equal((await s.loadDoc('upload:w1/0')).title, 't');
  await assert.rejects(s.loadDoc('upload:nope/0'), (e) => e.status === 404);
  assert.deepEqual(s.status(), { alio_rest: true, alio_mcp: false, law_go: false, law_source: null });
});

test('document re-derives 본칙 when source mislabels every article as 부칙', async () => {
  const arts = [{ seq: 1, section: '부칙', art_no: null, title: '부칙', body: '' }, ...[1, 2, 3, 4].map((n) => ({ seq: n + 1, section: '부칙', art_no: n, art_sub: null, title: `t${n}`, body: 'b' })), { seq: 6, section: '부칙', art_no: 1, art_sub: null, title: '시행일', body: '시행한다.' }, { seq: 7, section: '별표', art_no: null, title: '별표 1', body: 'x' }];
  const f = async () => json({ document: { doc_id: 'bylaws:d', doc_title: '취업규칙' }, articles: arts, total_articles: 7, next_offset: null });
  const doc = await createAlioRest({ base: 'https://x/api', fetchImpl: f }).document('bylaws:d');
  assert.deepEqual(doc.articles.map((a) => a.section), ['본칙', '본칙', '본칙', '본칙', '부칙', '별표']);
  assert.match(doc.edition.warning, /자동 보정/);
});

test('429 from ALIO is retried with backoff', async () => {
  let n = 0;
  const f = async () => (++n < 3 ? { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: 'many' }) } : json({ rows: [{ corpus: 'bylaws', rel_path: 'a.md' }] }));
  const rest = createAlioRest({ base: 'https://x/api', fetchImpl: f, backoffMs: 1 });
  const r = await rest.search({ keyword: 'a' });
  assert.equal(r.rows.length, 1); assert.equal(n, 3);
});

test('mcp related incoming rows are normalized with institution and title from doc_id', async () => {
  const f = async () => json({ result: { content: [{ type: 'text', text: JSON.stringify({ incoming: [{ doc_id: 'legal:a.md', art_ref: '제109조', title: '벌칙', scope: 'same_doc' }, { doc_id: 'bylaws:[중소벤처기업부]소상공인시장진흥공단_C0903/복무규정_20260225.md', art_ref: '제23조', title: '휴가' }] }) }] } });
  const r = await createAlioMcp({ url: 'http://m/mcp', fetchImpl: f }).related({ doc_id: 'legal:a.md', art_no: 1 });
  assert.equal(r.incoming.length, 1);
  assert.deepEqual({ inst: r.incoming[0].inst_name, title: r.incoming[0].doc_title, art: r.incoming[0].art_title }, { inst: '소상공인시장진흥공단', title: '복무규정', art: '휴가' });
});
