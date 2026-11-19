import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobs } from '../lib/jobs.mjs';
import { createWorkspace } from '../lib/workspace.mjs';
import { nextProcedure, loadProcedures } from '../flows/procedure.mjs';
import { createApp } from '../lib/app.mjs';
import { createRoutes } from '../lib/routes.mjs';
import { createSources } from '../lib/sources.mjs';

const tick = () => new Promise((r) => setTimeout(r, 5));
const until = async (f) => { for (let i = 0; i < 200; i++) { if (f()) return; await tick(); } throw new Error('timeout'); };

test('gate waits for an answer and job completes with result', async () => {
  const jobs = createJobs();
  const id = jobs.start('t', { a: 1 }, async (ctx) => {
    await ctx.step('조회', async (s) => { s.note('3건'); });
    const v = await ctx.gate({ id: 'pick', prompt: '고르세요', options: ['가', '나'] });
    return { picked: v };
  });
  await until(() => jobs.get(id).status === 'waiting');
  assert.equal(jobs.get(id).gate.id, 'pick');
  assert.equal(jobs.answer(id, 'wrong', '가'), false);
  assert.equal(jobs.answer(id, 'pick', '나'), true);
  await until(() => jobs.get(id).status === 'done');
  const v = jobs.get(id);
  assert.deepEqual(v.result, { picked: '나' });
  assert.equal(v.steps[0].state, 'done'); assert.equal(v.steps[0].note, '3건');
});

test('failing step marks job failed with step state', async () => {
  const jobs = createJobs();
  const id = jobs.start('t', {}, async (ctx) => { await ctx.step('작성', async () => { throw Object.assign(new Error('모델 미설정'), { code: 'llm_missing' }); }); });
  await until(() => jobs.get(id).status === 'failed');
  const v = jobs.get(id);
  assert.equal(v.steps[0].state, 'failed'); assert.equal(v.error.code, 'llm_missing');
});

test('fifth concurrent job is rejected as busy', async () => {
  const jobs = createJobs({ maxConcurrent: 4 }); const hold = new Promise(() => {});
  for (let i = 0; i < 4; i++) jobs.start('t', {}, () => hold);
  assert.throws(() => jobs.start('t', {}, () => hold), (e) => e.code === 'busy' && e.status === 429);
});

test('workspace stores originals read-only with hashes and outputs separately', () => {
  const ws = createWorkspace(mkdtempSync(join(tmpdir(), 'ws-')));
  const id = ws.create();
  const f = ws.addFile(id, '../../evil name.txt', Buffer.from('제1조(목적) 가'));
  assert.ok(!f.path.includes('..')); assert.equal(statSync(f.path).mode & 0o777, 0o444);
  assert.equal(f.sha256.length, 64);
  assert.ok(ws.outPath(id, 'r.md').includes(`${id}/out/`));
  assert.equal(ws.verify(id), true);
});

test('nextProcedure returns current step and missing documents', () => {
  const t = { steps: [{ id: 'a', title: '기안', docs: ['draft', 'reason'] }, { id: 'b', title: '협의', docs: ['comparison'] }, { id: 'c', title: '심의', docs: [] }] };
  const r = nextProcedure(t, new Set(['a']), new Set(['comparison']));
  assert.equal(r.current.id, 'b'); assert.equal(r.next.id, 'c'); assert.deepEqual(r.missingDocs, []);
  assert.deepEqual(nextProcedure(t, new Set(), new Set(['draft'])).missingDocs, ['reason']);
  assert.equal(nextProcedure(t, new Set(['a', 'b', 'c']), new Set()).current, null);
});

test('bundled procedure templates cover three institution types with valid doc keys', () => {
  const all = loadProcedures();
  assert.deepEqual(Object.keys(all).sort(), ['central-ministry', 'local-gov', 'public-institution']);
  const keys = new Set(['draft', 'comparison', 'full_text', 'reason', 'addenda', 'notice', 'corrections', 'checklist', 'evidence', 'consult_letter', 'labor_opinion', 'legal_review', 'council_agenda', 'board_agenda', 'assembly_bill', 'promulgation']);
  for (const t of Object.values(all)) for (const s of t.steps) for (const d of s.docs) assert.ok(keys.has(d), `${t.type}:${s.id}:${d}`);
});

test('upload route rejects broken hwpx with 400 and server keeps serving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const sources = createSources({}, async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) }));
  const server = createApp({ routes: createRoutes({ sources, jobs: createJobs(), workspace: createWorkspace(dir), env: {}, flows: {} }), staticRoot: dir });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(base + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'x.hwpx', base64: Buffer.from('nope').toString('base64') }] }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(base + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ name: '붙여넣기.txt', text: '가 규정\n제1조(목적) 목적이다.\n제2조(정의) 정의이다.' }] }) });
    const j = await ok.json();
    assert.equal(ok.status, 200); assert.equal(j.docs[0].n_articles, 2); assert.match(j.docs[0].doc_id, /^upload:/);
    const doc = await (await fetch(base + '/api/doc?id=' + encodeURIComponent(j.docs[0].doc_id))).json();
    assert.equal(doc.articles[1].ref, '제2조');
    const wsDirs = readdirSync(dir); assert.ok(wsDirs.length >= 1);
    const st = await fetch(base + '/api/status'); assert.equal(st.status, 200);
    const unknown = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'nope', input: {} }) });
    assert.equal(unknown.status, 400);
  } finally { server.close(); }
});
