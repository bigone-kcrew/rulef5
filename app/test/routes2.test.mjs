// 2026-11-20 추가 기능 경로 테스트: 개정 후 전문 다시 만들기, 한글(hwpx) 변환, 운영 요약(관리 키), 큰 파일 범위 요청
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createApp } from '../lib/app.mjs';
import { createRoutes } from '../lib/routes.mjs';
import { createSources } from '../lib/sources.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { createWorkspace } from '../lib/workspace.mjs';

async function boot({ env = {}, logDir = null, staticRoot = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'r2-'));
  const sources = createSources({}, async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }));
  const server = createApp({ routes: createRoutes({ sources, jobs: createJobs(), workspace: createWorkspace(dir), env, flows: {}, logDir }), staticRoot: staticRoot || dir });
  await new Promise((r) => server.listen(0, r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('full text rebuild applies edited articles to the uploaded regulation', async () => {
  const s = await boot();
  try {
    const up = await (await post(s.base + '/api/upload', { files: [{ name: 'a.txt', text: '가 규정\n제1조(목적) 목적이다.\n제2조(휴가) 10일을 준다.' }] })).json();
    const r = await post(s.base + '/api/fulltext', { doc_id: up.docs[0].doc_id, changes: [{ op: 'amend', ref: '제2조', title: '휴가', new: '20일을 준다.' }], addenda: '부 칙\n이 규정은 발령한 날부터 시행한다.' });
    assert.equal(r.status, 200);
    const { body } = await r.json();
    assert.match(body, /제2조\(휴가\) 〈개정〉 20일을 준다\./); assert.match(body, /제1조\(목적\) 목적이다\./); assert.match(body, /〈이번 개정〉/);
    assert.equal((await post(s.base + '/api/fulltext', { doc_id: '', changes: [] })).status, 400);
  } finally { await s.close(); }
});

test('hwpx download is off without KORDOC_URL, converts through the service, and rejects bad output', async () => {
  const off = await boot();
  try {
    assert.equal((await (await fetch(off.base + '/api/status')).json()).features.hwpx, false);
    assert.equal((await post(off.base + '/api/hwpx', { markdown: '# 가' })).status, 404);
  } finally { await off.close(); }
  let mode = 'ok', seen = null;
  const kordoc = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { seen = JSON.parse(b); if (mode === 'ok') { res.writeHead(200, { 'content-type': 'application/hwp+zip' }); res.end(Buffer.from('PK\x03\x04hwpx')); } else { res.writeHead(200); res.end('not a zip'); } }); });
  await new Promise((r) => kordoc.listen(0, r));
  const on = await boot({ env: { KORDOC_URL: `http://127.0.0.1:${kordoc.address().port}` } });
  try {
    assert.equal((await (await fetch(on.base + '/api/status')).json()).features.hwpx, true);
    const r = await post(on.base + '/api/hwpx', { markdown: '# 가 규정\n\n제1조(목적) 목적이다.' });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/hwp+zip');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString(), 'PK'); assert.match(seen.markdown, /제1조/);
    assert.equal((await post(on.base + '/api/hwpx', { markdown: '' })).status, 400);
    mode = 'bad'; assert.equal((await post(on.base + '/api/hwpx', { markdown: '# 가' })).status, 502);
  } finally { await on.close(); await new Promise((r) => kordoc.close(r)); }
});

test('ops summary needs the admin token and summarizes job logs without user input', async () => {
  const logDir = mkdtempSync(join(tmpdir(), 'logs-'));
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  writeFileSync(join(logDir, `jobs-${day}.jsonl`), [
    { type: 'amend', status: 'done', ms: 20000, steps: [['수정안 작성', 'done', 9000]], gates: [['pick_articles', 3000]], metrics: { amend: { sibling: true } } },
    { type: 'amend', status: 'failed', ms: 5000, error: { code: 'llm_timeout', message: '시간 초과' }, failed_step: '수정안 작성', model: 'x', steps: [['수정안 작성', 'failed', 5000]], gates: [], metrics: {} },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const none = await boot({ logDir });
  try { assert.equal((await fetch(none.base + '/api/admin/report')).status, 404); } finally { await none.close(); }
  const s = await boot({ env: { RULEF5_ADMIN_TOKEN: 'abcdefghijklmnopqrstuvwxyz' }, logDir });
  try {
    assert.equal((await fetch(s.base + '/api/admin/report', { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const r = await fetch(s.base + '/api/admin/report?days=7', { headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.total, 2); assert.deepEqual(j.byType.map((t) => [t.type, t.n, t.failed]), [['amend', 2, 1]]);
    assert.equal(j.failures[0].code, 'llm_timeout'); assert.equal(j.amend.sibling, 1);
  } finally { await s.close(); }
});

test('large static files are served with byte ranges so video seeking works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'st-')); mkdirSync(join(root, 'media'));
  const big = Buffer.alloc(5 * 1024 * 1024, 7); big[0] = 1; big[big.length - 1] = 9;
  writeFileSync(join(root, 'media', 'v.mp4'), big);
  const s = await boot({ staticRoot: root });
  try {
    const full = await fetch(s.base + '/media/v.mp4');
    assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal((await full.arrayBuffer()).byteLength, big.length);
    const part = await fetch(s.base + '/media/v.mp4', { headers: { range: 'bytes=0-9' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 0-9/${big.length}`);
    const pb = Buffer.from(await part.arrayBuffer()); assert.equal(pb.length, 10); assert.equal(pb[0], 1);
    const tail = await fetch(s.base + '/media/v.mp4', { headers: { range: 'bytes=-1' } });
    assert.equal(tail.status, 206); assert.equal(Buffer.from(await tail.arrayBuffer())[0], 9);
    assert.equal((await fetch(s.base + '/media/v.mp4', { headers: { range: `bytes=${big.length}-` } })).status, 416);
  } finally { await s.close(); }
});
