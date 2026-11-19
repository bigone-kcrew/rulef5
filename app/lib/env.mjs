// .env 로더: KEY=VALUE 줄만 읽고, 이미 설정된 환경변수는 덮어쓰지 않는다.
import { readFileSync, existsSync } from 'node:fs';
export function loadEnv(file) {
  const p = file;
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
