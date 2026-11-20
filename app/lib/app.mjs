// 라우터 + 정적 파일 + 보안 헤더 + 요청 한도
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { sendJson, clientIp, originOk, createRateLimiter } from './http.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.srt': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.hwpx': 'application/octet-stream' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'" };

export function createApp({ routes, staticRoot, trustedProxy = '172.18.0.1', perMin = 30 }) {
  const root = resolve(staticRoot), allow = createRateLimiter({ perMin });
  const compiled = routes.map(([method, pattern, handler]) => {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    return { method, re, keys, handler };
  });
  return createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SEC)) res.setHeader(k, v);
    let url;
    try { url = new URL(req.url, 'http://x'); decodeURIComponent(url.pathname); } catch { return res.writeHead(400).end(); }
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && !originOk(req)) return sendJson(res, 403, { error: '허용되지 않은 출처입니다.' });
        // 작업 상태 폴링(GET /api/jobs/:id)은 한도에서 제외
        // 가벼운 조회(작업 상태·서버 상태·절차·기관 목록)는 한도에서 제외 — 같은 사무실 주소를 여러 명이 쓰는 경우를 고려
        const polling = req.method === 'GET' && /^\/api\/(jobs\/[^/]+|status|procedures|profiles|orgs|institutions)$/.test(url.pathname);
        if (!polling && !allow(clientIp(req, trustedProxy))) return sendJson(res, 429, { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' });
        for (const r of compiled) {
          const m = url.pathname.match(r.re);
          if (!m) continue;
          if (r.method !== req.method) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          return await r.handler(req, res, { params, query: url.searchParams, ip: clientIp(req, trustedProxy) });
        }
        return sendJson(res, 404, { error: '없는 경로입니다.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
      let p = decodeURIComponent(url.pathname); if (p.endsWith('/')) p += 'index.html';
      const file = resolve(root, '.' + p);
      if (file !== root && !file.startsWith(root + sep)) return res.writeHead(403).end();
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('없는 페이지입니다.');
      const type = MIME[extname(file)] || 'application/octet-stream';
      // 동영상 등 큰 파일: 일부 범위 요청(Range)으로 보내 재생 중 넘겨 보기가 되게 하고, 통째로 메모리에 읽지 않는다
      if (st.size > 4 * 1024 * 1024) {
        const m = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
        if (m && (m[1] || m[2])) {
          let a = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), b = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
          if (a > b || a >= st.size) return res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
          res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1, 'Cache-Control': 'no-cache' });
          return req.method === 'HEAD' ? res.end() : createReadStream(file, { start: a, end: b }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
        return req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[error]', req.method, url.pathname, e.code || e.message);
      if (!res.headersSent) sendJson(res, status, { error: status >= 500 ? '처리 중 오류가 발생했습니다.' : e.message, code: e.code });
    }
  });
}
