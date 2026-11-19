// HTTP 공통: 본문 읽기·응답·접속자 IP·Origin 검사·요청 한도
export const httpError = (status, message, code) => Object.assign(new Error(message), { status, code: code || message });

export async function readBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, '요청이 너무 큽니다.', 'too_large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 64 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw httpError(400, 'JSON 형식이 올바르지 않습니다.', 'bad_json'); }
}

export function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// 프록시 주소에서 온 접속만 X-Forwarded-For(최우측)를 믿는다.
export function clientIp(req, trustedProxy) {
  const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (peer !== trustedProxy) return peer;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.at(-1) || peer;
}

export function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function createRateLimiter({ perMin = 30 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(), arr = (hits.get(key) || []).filter((t) => t > now - 60000);
    if (arr.length >= perMin) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > now - 60000)) hits.delete(k);
    return true;
  };
}
