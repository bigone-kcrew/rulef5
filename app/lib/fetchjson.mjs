// 외부 조회 공통: 시간 제한, 실패를 source_unavailable 로 통일
export const unavailable = (source, detail) => Object.assign(new Error(`${source} 조회에 실패했습니다.`), { code: 'source_unavailable', status: 502, source, detail });
export async function fetchJson(fetchImpl, url, { source, timeoutMs = 30000, init = {}, backoffMs = 2000 } = {}) {
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { throw unavailable(source, e.name === 'TimeoutError' ? 'timeout' : 'network'); }
    if (r.status !== 429 || attempt >= 3) break;
    // 요청 한도: Retry-After(초)를 따르고, 없으면 점점 길게 기다린다
    const ra = Number(r.headers?.get?.('retry-after'));
    await new Promise((res) => setTimeout(res, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : backoffMs * (attempt + 1)));
  }
  if (r.status === 429) throw unavailable(source, 'rate_limited');
  if (r.status === 404) { const e = unavailable(source, 'not_found'); e.status = 404; e.code = 'not_found'; e.message = '자료를 찾을 수 없습니다.'; throw e; }
  if (!r.ok) throw unavailable(source, `http_${r.status}`);
  try { return await r.json(); } catch { throw unavailable(source, 'bad_json'); }
}
