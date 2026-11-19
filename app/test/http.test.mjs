import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { clientIp, readJson, originOk, createRateLimiter } from '../lib/http.mjs';

const req = (o) => Object.assign(Readable.from(o.chunks || []), { headers: o.headers || {}, socket: { remoteAddress: o.peer || '10.0.0.5' } });

test('clientIp ignores X-Forwarded-For from untrusted peer', () => {
  assert.equal(clientIp(req({ peer: '10.0.0.9', headers: { 'x-forwarded-for': '1.1.1.1' } }), '172.18.0.1'), '10.0.0.9');
});
test('clientIp uses rightmost X-Forwarded-For from trusted proxy', () => {
  assert.equal(clientIp(req({ peer: '::ffff:172.18.0.1', headers: { 'x-forwarded-for': '9.9.9.9, 2.2.2.2' } }), '172.18.0.1'), '2.2.2.2');
});
test('readJson rejects bodies over the limit with status 413', async () => {
  const big = Buffer.alloc(70 * 1024, 'a');
  await assert.rejects(readJson(req({ chunks: [big] }), 64 * 1024), (e) => e.status === 413);
});
test('readJson rejects malformed JSON with 400', async () => {
  await assert.rejects(readJson(req({ chunks: [Buffer.from('{bad')] }), 1024), (e) => e.status === 400);
});
test('readJson parses JSON', async () => {
  assert.deepEqual(await readJson(req({ chunks: [Buffer.from('{"a":1}')] }), 1024), { a: 1 });
});
test('originOk rejects cross-origin and allows same host or absent origin', () => {
  assert.equal(originOk(req({ headers: { origin: 'https://evil.example', host: 'reg.k-union.kr' } })), false);
  assert.equal(originOk(req({ headers: { origin: 'https://reg.k-union.kr', host: 'reg.k-union.kr' } })), true);
  assert.equal(originOk(req({ headers: { host: 'x' } })), true);
});
test('rate limiter blocks the 31st request in a minute', () => {
  const allow = createRateLimiter({ perMin: 30 });
  for (let i = 0; i < 30; i++) assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), false);
  assert.equal(allow('other'), true);
});
