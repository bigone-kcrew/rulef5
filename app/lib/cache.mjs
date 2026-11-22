// 메모리 LRU 캐시(+선택 디스크). 외부 데이터 부하·한도 보호용.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
export function createCache({ dir = null, ttlMs = 24 * 3600 * 1000, max = 500 } = {}) {
  const mem = new Map();
  if (dir) mkdirSync(dir, { recursive: true });
  const file = (k) => join(dir, createHash('sha256').update(k).digest('hex').slice(0, 32) + '.json');
  return {
    // ttl 을 주면 그 항목만 다른 유효 시간으로 본다(자주 바뀌는 목록은 짧게, 바뀌지 않는 판본 원문은 길게)
    entry(k, ttl = ttlMs) {
      const e = mem.get(k);
      if (e && e.t > Date.now() - ttl) { mem.delete(k); mem.set(k, e); return e; }
      if (dir && existsSync(file(k))) { try { const d = JSON.parse(readFileSync(file(k), 'utf8')); if (d.t > Date.now() - ttl) { mem.set(k, d); return d; } } catch { /* 손상 캐시는 무시 */ } }
      return undefined;
    },
    get(k, ttl) { return this.entry(k, ttl)?.v; },
    set(k, v) {
      const e = { t: Date.now(), v }; mem.set(k, e);
      while (mem.size > max) mem.delete(mem.keys().next().value);
      if (dir) { try { writeFileSync(file(k), JSON.stringify(e)); } catch { /* 디스크 실패는 무시 */ } }
    },
  };
}
