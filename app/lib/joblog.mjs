// 개선용 작업 기록: var/logs/jobs-YYYY-MM-DD.jsonl 에 작업마다 한 줄(내용 없이 상태·시간·지표). 30일 지나면 지운다.
// 사용자 입력·접속 주소·키는 넣지 않는다(작업 실행기가 넘겨주는 기록만 쓴다). 보고서: node app/scripts/job-report.mjs
import { appendFileSync, mkdirSync, readdirSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
const kst = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
export function createJobLog(dir, { keepDays = 30 } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const prune = () => { const cut = kst(Date.now() - keepDays * 86400e3); for (const f of readdirSync(dir)) { const m = f.match(/^jobs-(\d{4}-\d{2}-\d{2})\.jsonl$/); if (m && m[1] < cut) rmSync(join(dir, f), { force: true }); } };
  prune(); setInterval(prune, 86400e3).unref();
  return (rec) => { const f = join(dir, `jobs-${kst()}.jsonl`); appendFileSync(f, JSON.stringify(rec) + '\n', { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* 무시 */ } };
}
