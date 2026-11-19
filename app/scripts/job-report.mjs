// 개선용 작업 기록 요약: node app/scripts/job-report.mjs [일수=7] [--fails]
// var/logs/jobs-*.jsonl(작업마다 한 줄, 사용자 입력 없음)을 읽어 기능별 성공률·실패 원인·느린 단계·품질 지표를 보여 준다.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = process.env.REG_VAR_DIR ? join(process.env.REG_VAR_DIR, 'logs') : join(dirname(fileURLToPath(import.meta.url)), '..', 'var', 'logs');
const days = +(process.argv.find((a) => /^\d+$/.test(a)) || 7), showFails = process.argv.includes('--fails');
const cut = new Date(Date.now() + 9 * 3600e3 - days * 86400e3).toISOString().slice(0, 10);
if (!existsSync(dir)) { console.log(`기록 없음: ${dir}`); process.exit(0); }
const recs = readdirSync(dir).filter((f) => /^jobs-(\d{4}-\d{2}-\d{2})\.jsonl$/.test(f) && f.slice(5, 15) >= cut).sort().flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
console.log(`최근 ${days}일 작업 ${recs.length}건 (${dir})\n`);
const by = (xs, k) => xs.reduce((m, x) => ((m[k(x)] ||= []).push(x), m), {});
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const sec = (ms) => (ms == null ? '-' : `${(ms / 1000).toFixed(1)}s`);
console.log('기능 | 건수 | 성공 | 실패 | 중앙 소요');
for (const [t, xs] of Object.entries(by(recs, (r) => r.type))) console.log(`${t} | ${xs.length} | ${pct(xs.filter((r) => r.status === 'done').length, xs.length)} | ${xs.filter((r) => r.status === 'failed').length} | ${sec(med(xs.map((r) => r.ms)))}`);
const fails = recs.filter((r) => r.status === 'failed');
if (fails.length) {
  console.log('\n실패 원인(오류 코드 · 실패 단계 · 모델)');
  for (const [k, xs] of Object.entries(by(fails, (r) => `${r.type} · ${r.error?.code} · ${r.failed_step || '-'} · ${r.model || '-'}`)).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${xs.length}건  ${k}  예: ${xs[0].error?.message || ''}`);
}
console.log('\n느린 단계(중앙값, 5건 이상)');
const steps = recs.flatMap((r) => (r.steps || []).map(([n, st, ms]) => ({ n: `${r.type}:${String(n).replace(/^\d+\.\s*/, '')}`, ms })));
for (const [n, xs] of Object.entries(by(steps, (s) => s.n)).filter(([, xs]) => xs.length >= 5).map(([n, xs]) => [n, med(xs.map((x) => x.ms))]).sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${sec(xs)}  ${n}`);
const am = recs.map((r) => r.metrics?.amend).filter(Boolean);
if (am.length) {
  const n = (k) => am.filter((m) => m[k]).length;
  console.log(`\n개정 품질 지표(${am.length}건): 주제 없는 규정 ${n('absent_topic')} · 다른 규정에 이미 있음 ${n('sibling')} · 자체 검토 수정 ${n('review_applied')} · 검토 수정 거절 ${n('review_rejected')} · 검토 후 남은 문제 ${n('review_remaining')} · 형식 오류로 뺀 변경 ${n('dropped')} · 반영 못 한 요청 ${n('not_reflected')} · 근거 조회 실패 ${n('evidence_errors')} · 기관 불일치 ${n('org_mismatch')}`);
}
const pf = recs.filter((r) => r.metrics?.picker_fallback).length; if (pf) console.log(`AI 조문 추천 실패→핵심어 대체: ${pf}건`);
const ag = recs.map((r) => r.metrics?.agent).filter(Boolean);
if (ag.length) console.log(`대화로 요청(${ag.length}건): 다시 계획 ${ag.filter((a) => a.replans).length}건 · 마무리 못 함 ${ag.filter((a) => !a.finished).length}건`);
const gw = recs.flatMap((r) => (r.gates || []).map(([id, w]) => ({ id, w })));
if (gw.length) { console.log('\n담당자 확인 대기(중앙값)'); for (const [id, xs] of Object.entries(by(gw, (g) => g.id))) console.log(`  ${id}: ${xs.length}회 · ${sec(med(xs.map((x) => x.w)))}`); }
if (showFails) { console.log('\n실패 작업 상세'); for (const r of fails.slice(-20)) console.log(JSON.stringify({ t: r.t, type: r.type, model: r.model, error: r.error, failed_step: r.failed_step, steps: r.steps })); }
