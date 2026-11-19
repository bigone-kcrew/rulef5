import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLooseJson, resolveLlmConfig, createLlm, createDailyCounter, PRESETS } from '../lib/llm.mjs';

const reply = (content, finish = 'stop') => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: finish }], model: 'm' }) });
const seq = (...rs) => { const calls = []; const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return rs[Math.min(calls.length - 1, rs.length - 1)]; }; f.calls = calls; return f; };
const cfg = { preset: 'exaone', baseUrl: PRESETS.exaone.baseUrl, apiKey: 'k', model: 'k-exaone_v2.5', extra: PRESETS.exaone.extra, source: 'server' };

test('parseLooseJson strips fences, think blocks and prose', () => {
  assert.deepEqual(parseLooseJson('<think>음</think>여기 있습니다:\n```json\n{"a":{"b":"}"}}\n```\n끝'), { a: { b: '}' } });
  assert.throws(() => parseLooseJson('JSON 없음'));
});

test('exaone request carries reasoning_effort low and bearer key', async () => {
  const f = seq(reply('안녕'));
  const out = await createLlm(cfg, { fetchImpl: f }).chat([{ role: 'user', content: 'hi' }]);
  assert.equal(out, '안녕');
  assert.equal(f.calls[0].url, 'https://api.exaone.ai/v1/chat/completions');
  assert.equal(f.calls[0].body.reasoning_effort, 'low');
  assert.equal(f.calls[0].headers.authorization, 'Bearer k');
});

test('truncated response is retried once then fails as llm_truncated', async () => {
  const f = seq(reply('{"a":', 'length'));
  await assert.rejects(createLlm(cfg, { fetchImpl: f }).chatJson([{ role: 'user', content: 'x' }], (o) => o), (e) => e.code === 'llm_truncated');
  assert.equal(f.calls.length, 2);
});

test('validation failure is retried with feedback then fails as llm_invalid', async () => {
  const f = seq(reply('{"ref":"제99조"}'));
  const validate = (o) => { if (o.ref === '제99조') throw new Error('없는 조문'); return o; };
  await assert.rejects(createLlm(cfg, { fetchImpl: f }).chatJson([{ role: 'user', content: 'x' }], validate), (e) => e.code === 'llm_invalid');
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[1].body.messages.at(-1).content, /없는 조문/);
});

test('chatJson returns validated object on second attempt', async () => {
  const f = seq(reply('형식 오류'), reply('{"ok":true}'));
  assert.deepEqual(await createLlm(cfg, { fetchImpl: f }).chatJson([{ role: 'user', content: 'x' }], (o) => o), { ok: true });
});

test('server daily limit blocks calls with llm_daily_limit', async () => {
  const llm = createLlm(cfg, { fetchImpl: seq(reply('x')), counter: createDailyCounter(0) });
  await assert.rejects(llm.chat([{ role: 'user', content: 'x' }]), (e) => e.code === 'llm_daily_limit');
});

test('user header config wins over server key and is marked user', () => {
  const c = resolveLlmConfig({ EXAONE_API_KEY: 'srv' }, JSON.stringify({ preset: 'openrouter', apiKey: 'usr', model: 'openai/gpt-oss-120b' }));
  assert.equal(c.source, 'user'); assert.equal(c.apiKey, 'usr'); assert.equal(c.baseUrl, 'https://openrouter.ai/api/v1');
});

test('server key falls back from exaone to BOT_EXA_KEY and to openrouter', () => {
  assert.equal(resolveLlmConfig({ BOT_EXA_KEY: 'b' }, null).apiKey, 'b');
  const c = resolveLlmConfig({ OPENROUTER_API_KEY: 'o' }, null);
  assert.equal(c.preset, 'openrouter'); assert.equal(c.source, 'server');
  assert.equal(resolveLlmConfig({}, null), null);
});

test('server openrouter key only allows allowlisted models', () => {
  const env = { OPENROUTER_API_KEY: 'o' };
  assert.equal(resolveLlmConfig(env, JSON.stringify({ preset: 'openrouter', model: 'google/gemma-4-31b-it' })).model, 'google/gemma-4-31b-it');
  assert.throws(() => resolveLlmConfig(env, JSON.stringify({ preset: 'openrouter', model: 'anthropic/claude-opus' })), (e) => e.code === 'model_not_allowed');
});

test('custom endpoint must be https and not a private address', () => {
  for (const u of ['http://api.example.com/v1', 'https://127.0.0.1/v1', 'https://localhost:8090', 'https://10.1.2.3/v1', 'https://alio-rag-api:8090/v1', 'https://[::1]/v1'])
    assert.throws(() => resolveLlmConfig({}, JSON.stringify({ preset: 'custom', baseUrl: u, apiKey: 'x', model: 'm' })), (e) => e.code === 'bad_llm_url', u);
  assert.equal(resolveLlmConfig({}, JSON.stringify({ preset: 'custom', baseUrl: 'https://llm.example.go.kr/v1', apiKey: 'x', model: 'm' })).baseUrl, 'https://llm.example.go.kr/v1');
});

test('403 key-limit and 402 responses are reported as quota, not bad key', async () => {
  const limited = { ok: false, status: 403, json: async () => ({}), text: async () => '{"error":{"message":"Key limit exceeded (daily limit)."}}' };
  await assert.rejects(createLlm(cfg, { fetchImpl: seq(limited) }).chat([{ role: 'user', content: 'x' }]), (e) => e.code === 'llm_quota');
  const pay = { ok: false, status: 402, json: async () => ({}), text: async () => 'Payment Required' };
  await assert.rejects(createLlm(cfg, { fetchImpl: seq(pay) }).chat([{ role: 'user', content: 'x' }]), (e) => e.code === 'llm_quota');
});

test('timeouts are not retried (avoid doubling the wait)', async () => {
  let n = 0;
  const f = async () => { n++; throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  await assert.rejects(createLlm(cfg, { fetchImpl: f }).chatJson([{ role: 'user', content: 'x' }], (o) => o), (e) => e.code === 'llm_timeout');
  assert.equal(n, 1);
});

test('rate-limited responses are retried after a backoff', async () => {
  let n = 0;
  const f = async () => (++n < 3 ? { ok: false, status: 429, json: async () => ({}), text: async () => '' } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }] }) });
  const out = await createLlm(cfg, { fetchImpl: f, backoffMs: 1 }).chatJson([{ role: 'user', content: 'x' }], (o) => o);
  assert.deepEqual(out, { a: 1 }); assert.equal(n, 3);
});

test('limit() runs at most N tasks at once', async () => {
  const { limit } = await import('../lib/llm.mjs');
  let active = 0, peak = 0;
  const run = limit(2);
  await Promise.all([1, 2, 3, 4, 5].map(() => run(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; })));
  assert.equal(peak, 2);
});

test('nim preset uses server key and allows its own model allowlist', () => {
  const c = resolveLlmConfig({ NIM_API_KEY: 'n' }, JSON.stringify({ preset: 'nim', model: 'openai/gpt-oss-20b' }));
  assert.equal(c.baseUrl, 'https://integrate.api.nvidia.com/v1'); assert.equal(c.model, 'openai/gpt-oss-20b'); assert.equal(c.source, 'server');
  assert.throws(() => resolveLlmConfig({ NIM_API_KEY: 'n' }, JSON.stringify({ preset: 'nim', model: 'meta/llama-x' })), (e) => e.code === 'model_not_allowed');
});

test('nemotron models on nim disable thinking via chat_template_kwargs', async () => {
  const f = seq(reply('{"a":1}'));
  await createLlm({ preset: 'nim', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: 'k', model: 'nvidia/nemotron-3-ultra-550b-a55b', extra: {}, source: 'server' }, { fetchImpl: f }).chat([{ role: 'user', content: 'x' }]);
  assert.deepEqual(f.calls[0].body.chat_template_kwargs, { enable_thinking: false });
});
