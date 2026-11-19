// LLM 어댑터: 모든 공급자를 OpenAI 호환 chat completions 하나로 다룬다(모델 비종속).
export const PRESETS = {
  exaone: { label: 'EXAONE (LG AI연구원)', baseUrl: 'https://api.exaone.ai/v1', model: 'k-exaone_v2.5', extra: { reasoning_effort: 'low' }, envKeys: ['EXAONE_API_KEY', 'BOT_EXA_KEY'] },
  openrouter: { label: 'OpenRouter (GPT-OSS·Gemma 등)', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b', extra: {}, envKeys: ['OPENROUTER_API_KEY', 'BOT_LLM_KEY'] },
  nim: { label: 'NVIDIA NIM (Nemotron 등)', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-ultra-550b-a55b', extra: {}, envKeys: ['NIM_API_KEY', 'BOT_NIM_KEY'] },
  custom: { label: '사용자 지정 (OpenAI 호환: 행안부 AI 공통기반·vLLM 등)', baseUrl: '', model: '', extra: {}, envKeys: [] },
};
const DEFAULT_OR_MODELS = 'openai/gpt-oss-120b,google/gemma-4-31b-it,google/gemma-4-26b-a4b-it,openai/gpt-oss-20b';
const DEFAULT_NIM_MODELS = 'nvidia/nemotron-3-ultra-550b-a55b,mistralai/mistral-large-4-1t-a52b,google/gemma-4-31b-it,openai/gpt-oss-20b';
export const allowedModels = (env, p) => (p === 'openrouter' ? env.OPENROUTER_MODELS || DEFAULT_OR_MODELS : p === 'nim' ? env.NIM_MODELS || DEFAULT_NIM_MODELS : '').split(',').map((s) => s.trim()).filter(Boolean);
const err = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

export function parseLooseJson(text) {
  let s = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = s.search(/[{[]/);
  if (start < 0) throw err('llm_invalid', 'JSON을 찾지 못했습니다.');
  const open = s[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === open) depth++; else if (c === close && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw err('llm_invalid', 'JSON이 닫히지 않았습니다.');
}

function checkUrl(u) {
  let url; try { url = new URL(u); } catch { throw err('bad_llm_url', 'LLM 주소가 올바르지 않습니다.'); }
  const h = url.hostname.replace(/^\[|\]$/g, '');
  const priv = /^(localhost|.*\.local|.*\.internal)$/i.test(h) || !h.includes('.') || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^(::1?|f[cd][0-9a-f]{2}:.*|fe80:.*)$/i.test(h) || /^\d+$/.test(h);
  if (url.protocol !== 'https:' || priv) throw err('bad_llm_url', 'LLM 주소는 외부 https 주소만 사용할 수 있습니다.');
  return url.toString().replace(/\/$/, '');
}

const PRIVATE_IP = (ip) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) || /^(::1?|f[cd][0-9a-f]{2}:|fe80:|::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);
// 사용자 지정 주소는 DNS로 해석한 IP까지 확인한다(사설망·내부 서비스 접근 차단)
export async function assertPublicHost(baseUrl, lookup) {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try { addrs = await (lookup || (async (h) => (await import('node:dns')).promises.lookup(h, { all: true })))(host); } catch { throw err('bad_llm_url', 'LLM 주소를 찾을 수 없습니다.'); }
  if (!addrs.length || addrs.some((a) => PRIVATE_IP(a.address))) throw err('bad_llm_url', 'LLM 주소는 외부 https 주소만 사용할 수 있습니다.');
}

export function resolveLlmConfig(env, header) {
  let h = null;
  if (header) { try { h = typeof header === 'string' ? JSON.parse(header) : header; } catch { throw err('bad_llm_config', '모델 설정 형식이 올바르지 않습니다.'); } }
  const serverKey = (p) => PRESETS[p]?.envKeys.map((k) => env[k]).find(Boolean) || null;
  if (h && h.apiKey) {
    const p = PRESETS[h.preset] ? h.preset : 'custom';
    const baseUrl = p === 'custom' ? checkUrl(h.baseUrl) : PRESETS[p].baseUrl;
    const model = String(h.model || PRESETS[p].model || '').slice(0, 120);
    if (!model) throw err('bad_llm_config', '모델 이름을 입력해 주세요.');
    return { preset: p, baseUrl, apiKey: String(h.apiKey), model, extra: PRESETS[p].extra, source: 'user' };
  }
  if (h && h.preset === 'custom') throw err('bad_llm_config', '사용자 지정 모델은 API 키가 필요합니다.');
  let p = h?.preset && PRESETS[h.preset] ? h.preset : (env.LLM_PRESET || 'exaone');
  if (!serverKey(p) && !h?.preset) p = ['exaone', 'openrouter'].find(serverKey) || p;
  const key = serverKey(p);
  if (!key) return null;
  let model = PRESETS[p].model;
  if (h?.model && h.model !== model) {
    if (!allowedModels(env, p).includes(h.model)) throw err('model_not_allowed', '서버 키로는 허용된 모델만 쓸 수 있습니다. 다른 모델은 본인 키를 입력하세요.');
    model = h.model;
  }
  return { preset: p, baseUrl: PRESETS[p].baseUrl, apiKey: key, model, extra: PRESETS[p].extra, source: 'server' };
}

export function createDailyCounter(limit) {
  let day = '', used = 0;
  return { take() { const d = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; } if (used >= limit) return false; used++; return true; }, get used() { return used; } };
}

// 동시 실행 제한기
export function limit(n) {
  let active = 0; const q = [];
  const next = () => { if (active >= n || !q.length) return; active++; const { fn, res, rej } = q.shift(); Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}

export function createLlm(config, { lookup = null, fetchImpl = fetch, counter = null, timeoutMs = +(globalThis.process?.env?.LLM_TIMEOUT_MS) || 150000, backoffMs = 5000, retryDelayMs = 800 } = {}) {
  async function once(messages, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      try { return await call(messages, opts); } catch (e) { if (e.code !== 'llm_rate' || attempt >= 2) throw e; await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1))); }
    }
  }
  let checked = false;
  async function call(messages, { maxTokens = 6000, temperature = 0.2 } = {}) {
    if (config.preset === 'custom' && !checked && (lookup || fetchImpl === globalThis.fetch)) { await assertPublicHost(config.baseUrl, lookup); checked = true; }
    if (config.source === 'server' && counter && !counter.take()) throw err('llm_daily_limit', '서버 모델의 오늘 사용 한도를 넘었습니다. 모델 설정에서 본인 API 키를 입력해 주세요.', 429);
    const body = { model: config.model, messages, max_tokens: maxTokens, temperature, stream: false, ...config.extra };
    if (/gpt-oss/.test(config.model) && config.preset === 'openrouter') body.reasoning = { effort: 'low' };
    if (/nemotron/.test(config.model) && config.preset === 'nim') body.chat_template_kwargs = { enable_thinking: false };
    let r;
    // 연결 오류(끊긴 연결 재사용 등)는 잠깐 쉬었다가 두 번까지 다시 시도한다(시간 초과는 다시 시도하지 않음)
    const send = async (left) => { try { return await fetchImpl(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); } catch (e) { if (e.name === 'TimeoutError' || !left) throw e; await new Promise((res) => setTimeout(res, retryDelayMs * (3 - left))); return send(left - 1); } };
    try { r = await send(2); } catch (e) { throw err(e.name === 'TimeoutError' ? 'llm_timeout' : 'llm_unavailable', e.name === 'TimeoutError' ? '모델 응답 시간이 초과되었습니다.' : '모델 서버에 연결하지 못했습니다.', 502); }
    if (r.status === 402 || r.status === 403) { const b = await r.text().catch(() => ''); if (r.status === 402 || /limit|credit|quota|balance/i.test(b)) throw err('llm_quota', '모델 계정의 사용 한도 또는 잔액이 부족합니다. 키의 한도를 확인하세요.', 502); }
    if (r.status === 401 || r.status === 403) throw err('llm_auth', '모델 API 키가 올바르지 않습니다.', 502);
    if (r.status === 429) throw err('llm_rate', '모델 서비스 호출 한도에 걸렸습니다. 잠시 후 다시 시도하세요.', 502);
    if (!r.ok) throw err('llm_unavailable', config.source === 'user' && config.preset === 'custom' ? '모델 서비스 오류입니다.' : `모델 서비스 오류(${r.status})입니다.`, 502);
    const d = await r.json().catch(() => null);
    const ch = d?.choices?.[0];
    if (!ch) throw err('llm_unavailable', '모델 응답 형식이 올바르지 않습니다.', 502);
    if (ch.finish_reason === 'length') throw err('llm_truncated', '모델 응답이 길이 한도에서 잘렸습니다.', 502);
    return String(ch.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
  return {
    config: { preset: config.preset, model: config.model, source: config.source },
    async chat(messages, opts) {
      try { return await once(messages, opts); } catch (e) { if (['llm_truncated', 'llm_unavailable'].includes(e.code)) return once(messages, opts); throw e; }
    },
    async chatJson(messages, validate, opts) {
      let last, msgs = messages;
      for (let attempt = 0; attempt < 2; attempt++) {
        let text;
        try { text = await once(msgs, opts); } catch (e) { if (['llm_truncated', 'llm_unavailable'].includes(e.code)) { last = e; continue; } throw e; }
        try { return validate(parseLooseJson(text)); } catch (e) {
          last = err('llm_invalid', `모델 응답을 검증하지 못했습니다: ${e.message}`, 502);
          msgs = [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `앞 응답에 문제가 있습니다: ${e.message}\n같은 JSON 형식으로 다시 답하세요. JSON 외의 글은 쓰지 마세요.` }];
        }
      }
      throw last;
    },
  };
}
