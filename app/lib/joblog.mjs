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

// 기록 요약(관리용): 기능별 건수·성공·실패, 실패 원인, 느린 단계, 품질 지표. 입력 내용은 원래 없다
import { readFileSync as rf, existsSync } from 'node:fs';
export function summarizeLogs(dir, days = 7) {
  if (!existsSync(dir)) return { days, total: 0, byType: [], failures: [], slowSteps: [], amend: null, agent: null, gates: [] };
  const cut = new Date(Date.now() + 9 * 3600e3 - days * 86400e3).toISOString().slice(0, 10);
  const recs = readdirSync(dir).filter((f) => /^jobs-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(5, 15) >= cut).sort().flatMap((f) => rf(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  const by = (xs, k) => xs.reduce((m, x) => ((m[k(x)] ||= []).push(x), m), {});
  const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const byType = Object.entries(by(recs, (r) => r.type)).map(([type, xs]) => ({ type, n: xs.length, done: xs.filter((r) => r.status === 'done').length, failed: xs.filter((r) => r.status === 'failed').length, median_ms: med(xs.map((r) => r.ms)) }));
  const fails = recs.filter((r) => r.status === 'failed');
  const failures = Object.entries(by(fails, (r) => `${r.type}|${r.error?.code}|${r.failed_step || '-'}|${r.model || '-'}`)).map(([k, xs]) => { const [type, code, step, model] = k.split('|'); return { type, code, step, model, n: xs.length, example: xs[0].error?.message || '' }; }).sort((a, b) => b.n - a.n);
  const steps = recs.flatMap((r) => (r.steps || []).map(([n, , ms]) => ({ n: `${r.type}:${String(n).replace(/^\d+\.\s*/, '')}`, ms })));
  const slowSteps = Object.entries(by(steps, (s) => s.n)).filter(([, xs]) => xs.length >= 3).map(([step, xs]) => ({ step, n: xs.length, median_ms: med(xs.map((x) => x.ms)) })).sort((a, b) => b.median_ms - a.median_ms).slice(0, 10);
  const am = recs.map((r) => r.metrics?.amend).filter(Boolean), cnt = (k) => am.filter((m) => m[k]).length;
  const amend = am.length ? { n: am.length, absent_topic: cnt('absent_topic'), sibling: cnt('sibling'), review_applied: cnt('review_applied'), review_rejected: cnt('review_rejected'), review_remaining: cnt('review_remaining'), dropped: cnt('dropped'), not_reflected: cnt('not_reflected'), evidence_errors: cnt('evidence_errors'), org_mismatch: cnt('org_mismatch'), picker_fallback: recs.filter((r) => r.metrics?.picker_fallback).length } : null;
  const ag = recs.map((r) => r.metrics?.agent).filter(Boolean);
  const agent = ag.length ? { n: ag.length, replans: ag.filter((a) => a.replans).length, unfinished: ag.filter((a) => !a.finished).length } : null;
  // 확인 단계별 대기 시간과 「추천을 바꾼 비율」(늘 그대로 받는 단계는 건너뛰어도 된다는 근거)
  const gates = Object.entries(by(recs.flatMap((r) => (r.gates || []).map(([id, w, c]) => ({ id, w, c }))), (g) => g.id)).map(([id, xs]) => { const known = xs.filter((x) => typeof x.c === 'boolean'); return { id, n: xs.length, median_ms: med(xs.map((x) => x.w)), changed: known.filter((x) => x.c).length, known: known.length }; });
  return { days, total: recs.length, byType, failures, slowSteps, amend, agent, gates };
}
