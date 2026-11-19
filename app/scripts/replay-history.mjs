// 개정 기능 재현(replay) 검증: ALIO 의 같은 기관·같은 규정 구판 → 다음 판 실제 개정을, 구판 + 개정 의도만으로 다시 만들어 비교한다.
// 사용:
//   node app/scripts/replay-history.mjs run <preset[:model]> [사례ID...]   (사례 생략 시 전체)  → docs/replay/runs/<사례>__<모델>.json·.md
//   node app/scripts/replay-history.mjs summarize                          → docs/replay/cases.json (runs + review.json 병합)
// 게이트는 자동 승인(auto:true), 대상 조문(refs)은 지정하지 않는다(진단용으로만 REPLAY_REFS='["제6조"]' REPLAY_TAG=refs). 키 값은 출력·기록하지 않는다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';
import { createSources } from '../lib/sources.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { resolveLlmConfig, createLlm } from '../lib/llm.mjs';
import { loadProcedures } from '../flows/procedure.mjs';
import { FLOWS } from '../flows/index.mjs';
import { renderDocSet, splitParagraphs } from '../lib/table.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, 'app', '.env'), join(root, '.env'), join(root, '.private', 'app.env')]) loadEnv(f);
process.env.ALIO_API_BASE ||= 'http://alio-rag-api:8090/api';
const OUT = join(root, 'docs', 'replay'), RUNS = join(OUT, 'runs');

// 사례: 구판·신판 doc_id, 담당자 의도(신판 문구를 그대로 쓰지 않음), 실제 변경(사람이 원문 대조로 확정), 핵심 값(must), 실제 원인 법령(cause)
export const CASES = [
  {
    id: 'C1', topic: '휴가 일수·조문 신설(상위법)', inst: '한국공정거래조정원', title: '취업규정',
    old_doc: 'bylaws:[공정거래위원회]한국공정거래조정원_C0655/취업규정_20260219.md', new_doc: 'bylaws:[공정거래위원회]한국공정거래조정원_C0655/취업규정_20260710.md',
    intent: '남녀고용평등법 개정에 맞춰 난임치료휴가 중 유급 일수를 2일에서 4일로 늘리고, 배우자 출산휴가를 배우자 임신 중(출산예정일 50일 전)부터 쓸 수 있게 하며, 배우자가 유산·사산한 경우의 휴가(5일, 그중 3일 유급)를 새로 둔다.',
    actual: [
      { op: 'amend', ref: '제35조의2', summary: '제목 「배우자 출산전후휴가」, ①"출산"→"임신 및 출산", ③"출산예정일 50일 전부터 사용할 수 있고" 추가', must: ['임신및출산', '출산예정일50일전'] },
      { op: 'amend', ref: '제35조의3', summary: '① 최초 2일→4일 유급', must: ['최초4일은유급'] },
      { op: 'insert', ref: '제36조의2', after: '제36조', summary: '배우자 유산·사산휴가 신설(5일 범위, 최초 3일 유급, 20일 이내 청구, 급여 지급 시 면책)', must: ['5일', '3일', '유산', '사산'] },
    ],
    cause: /남녀고용평등|고용평등/,
  },
  {
    id: 'C2', topic: '휴가 확대(호 신설)·조문 신설', inst: '독립기념관', title: '휴가사용지침',
    old_doc: 'bylaws:[국가보훈부]독립기념관_C0065/휴가사용지침_20260120.md', new_doc: 'bylaws:[국가보훈부]독립기념관_C0065/휴가사용지침_20260922.md',
    intent: '장기재직휴가 대상을 5년 이상 재직자까지 넓혀 5년 이상 10년 미만은 3일을 주고, 남성 직원이 배우자 임신 검진에 동행할 수 있는 휴가(8일 범위, 1일 단위, 증빙 제출)를 새로 만든다.',
    actual: [
      { op: 'amend', ref: '제11조의2', summary: '① "10년 이상"→"5년 이상", 제1호(5년 이상 10년 미만 3일) 신설·호 번호 이동, 단서의 호 열거 수정', must: ['5년이상재직', '5년이상10년미만:3일'] },
      { op: 'insert', ref: '제14조의2', after: '제14조', summary: '임신 검진 동행휴가 신설(8일, 1일 단위, 증빙, 출산 후 사용 불가)', must: ['8일', '동행'] },
    ],
    cause: null,
  },
  {
    id: 'C3', topic: '절차 변경(단일 조문)', inst: '동남권원자력의학원', title: '전공의수련규정',
    old_doc: 'bylaws:[과학기술정보통신부]동남권원자력의학원_C0448/전공의수련규정_20260527.md', new_doc: 'bylaws:[과학기술정보통신부]동남권원자력의학원_C0448/전공의수련규정_20261001.md',
    intent: '전공의 수련 만족도 조사는 본원이 총괄하되, 우리 의학원도 파견 전공의(인턴)에 대해서는 따로 만족도 조사를 해서 본원에 보고하도록 바꾼다.',
    actual: [{ op: 'amend', ref: '제57조', summary: '"별도로 실시하지 않는다" → 본원 총괄 + 파견 전공의(인턴) 별도 조사·본원 보고', must: ['파견', '인턴', '보고'] }],
    cause: null,
  },
  {
    id: 'C4', topic: '수당·금액·조문 신설·소급 적용', inst: '한국소방산업기술원', title: '특정업무직 근로자 운영규칙',
    old_doc: 'bylaws:[소방청]한국소방산업기술원_C0217/특정업무직 근로자 운영규칙_20260406.md', new_doc: 'bylaws:[소방청]한국소방산업기술원_C0217/특정업무직 근로자 운영규칙_20260828.md',
    intent: '특정업무직 명절상여금을 정액 55만원에서 기본급 월액의 60%로 바꾸고, 부양자녀가 있는 특정업무직 근로자에게도 보수규칙에 따른 자녀수당을 주도록 한다. 올해 1월 1일부터 소급 적용한다.',
    actual: [
      { op: 'amend', ref: '제40조', summary: '①4호 기타수당에 "자녀수당" 추가', must: ['자녀수당'] },
      { op: 'amend', ref: '제47조', summary: '① "각각 55만원" → "각각 기본급 월액의 60%"', must: ['기본급월액의60%'] },
      { op: 'insert', ref: '제48조의2', after: '제48조', summary: '자녀수당 신설(보수규칙 제12조 준용)', must: ['자녀수당', '보수규칙'] },
    ],
    actual_addenda_note: '시행 2026.8.28., 2026.1.1.부터 적용(소급), 적용특례: 시행일 기준 재직자',
    cause: null,
  },
  {
    id: 'C5', topic: '복무 절차(항 신설·문구 보완)', inst: '한국농수산식품유통공사', title: '유연근무제 등 운영지침',
    old_doc: 'bylaws:[농림축산식품부]한국농수산식품유통공사_C0045/유연근무제 등 운영지침_20260209.md', new_doc: 'bylaws:[농림축산식품부]한국농수산식품유통공사_C0045/유연근무제 등 운영지침_20260811.md',
    intent: '시간선택제 근무시간을 늘려 쓰던 직원이 인사규정에 따른 휴직(육아휴직 등)에 들어가면 연장조치를 즉시 풀도록 하고, 근무시간선택형 탄력근무 중에 공가를 쓰면 탄력근무를 해제하도록 하며, 원격근무제와 다른 유연근무제를 함께 쓸 수 없다는 문구를 분명히 한다.',
    actual: [
      { op: 'amend', ref: '제6조', summary: '② 단서에 "인사규정 제35조 및 제35조의2에 따른 휴직을 시작한 경우" 추가', must: ['휴직'] },
      { op: 'amend', ref: '제15조', summary: '⑤ 신설: 근무시간선택형 탄력근무 중 공가 사용 시 탄력근무 해제', must: ['공가', '해제'] },
      { op: 'amend', ref: '제25조', summary: '⑤ 문구 정비: "원격근무제와 다른 유연근무제도는 중복 사용이 원칙적으로 불가"', must: ['원격근무제와다른유연근무제'] },
    ],
    cause: null,
  },
  {
    id: 'C6', topic: '용어 변경(직원→임직원)·항 신설', inst: '한국마약퇴치운동본부', title: '취업규칙',
    old_doc: 'bylaws:[식품의약품안전처]한국마약퇴치운동본부_C0571/취업규칙_20251219.md', new_doc: 'bylaws:[식품의약품안전처]한국마약퇴치운동본부_C0571/취업규칙_20260917.md',
    intent: '징계 대상을 직원에서 임직원으로 넓히고, 직무태만 사유를 국민의 권익을 침해한 경우로 구체화하며, 채용비위로 징계받은 사람은 일정 기간(정직 이상 3년, 정직 미만 2년) 인사·감사 업무를 맡지 못하게 한다.',
    actual: [
      { op: 'amend', ref: '제64조', summary: '본문 "직원"→"임직원", 2호 "직무태만으로 국민의 권익을 침해한 자", 3호 "재산상의 손실 등" 추가(의도 밖)', must: ['임직원에대하여', '국민의권익'] },
      { op: 'amend', ref: '제65조', summary: '② 신설: 채용비위 징계 시 정직 이상 3년·정직 미만 2년 인사·감사 업무 제한 (원천 데이터는 신판 제65조를 제64조에 붙여 파싱함 — 사람이 원문으로 확정)', must: ['3년', '2년', '인사·감사'] },
    ],
    cause: null,
  },
  {
    id: 'C7', topic: '조문 삭제', inst: '예술의전당', title: '406. 임원보수규정',
    old_doc: 'bylaws:[문화체육관광부]예술의전당_C0102/406. 임원보수규정_20190227.md', new_doc: 'bylaws:[문화체육관광부]예술의전당_C0102/406. 임원보수규정_20260224.md',
    intent: '사장에게 주던 자녀학비 보조금 조항을 폐지한다.',
    actual: [{ op: 'delete', ref: '제16조', summary: '제16조(자녀학비 보조금) 삭제("삭제" 표기)', must: [] }],
    note: 'ALIO 에 중간 판본(2020~2025)이 없어 2019 판과 2026 판을 비교. 조문 차이는 제16조뿐(원천 데이터가 부칙 시행일 목록을 본칙 제2조로 파싱).',
    cause: null,
  },
];

const nz = (s) => String(s ?? '').replace(/\s+/g, '');
// 개정 표기(<개정 …>, [본조신설 …], (개정'26.9.22.) 등) 제거 후 비교
const strip = (s) => nz(s).replace(/[<\[(（][^<>\[\]()（）]{0,80}?(개정|신설|삭제|시행|전문개정)[^<>\[\]()（）]{0,80}?[>\])）]/g, '').replace(/[“”"'‘’`]/g, '');
const paraKey = (p, i) => ('①②③④⑤⑥⑦⑧⑨⑩'.includes(p.trim()[0]) ? p.trim()[0] : `#${i}`);

function paraDiff(oldBody, newBody) {
  const o = splitParagraphs(oldBody), n = splitParagraphs(newBody);
  const om = new Map(o.map((p, i) => [paraKey(p, i), strip(p)])), nm = new Map(n.map((p, i) => [paraKey(p, i), strip(p)]));
  const keys = new Set([...om.keys(), ...nm.keys()]);
  return new Set([...keys].filter((k) => om.get(k) !== nm.get(k)));
}

async function loadMain(sources, id) { const d = await sources.loadDoc(id); return { d, byRef: new Map(d.articles.filter((a) => a.section === '본칙' && a.ref).map((a) => [a.ref, a])) }; }

function score(c, res, oldDoc, newDoc) {
  const tool = (res?.changes || []).filter((x) => x.reason !== '조 번호 이동에 따른 인용 정정');
  const used = new Set(), per = [];
  for (const a of c.actual) {
    let i = tool.findIndex((t, k) => !used.has(k) && t.ref === a.ref && (t.op === a.op || (a.op === 'amend' && t.op === 'amend')));
    let loose = false;
    if (i < 0 && a.op === 'insert') { i = tool.findIndex((t, k) => !used.has(k) && t.op === 'insert'); loose = i >= 0; }
    if (i < 0) { per.push({ ref: a.ref, op: a.op, hit: false }); continue; }
    used.add(i); const t = tool[i];
    const mustHit = a.must.filter((m) => nz(t.new).includes(m));
    const row = { ref: a.ref, op: a.op, hit: true, tool_ref: t.ref, tool_op: t.op, loose_insert: loose, must: a.must, must_hit: mustHit, value_ok: a.must.length ? mustHit.length / a.must.length : (t.op === a.op ? 1 : 0) };
    if (a.op === 'amend' && t.op === 'amend') {
      const realNew = newDoc.byRef.get(a.ref)?.body ?? '';
      const real = paraDiff(t.old, realNew), mine = paraDiff(t.old, t.new);
      row.paras_old = splitParagraphs(t.old).length; row.paras_tool = splitParagraphs(t.new).length; row.paras_real = splitParagraphs(realNew).length;
      row.para_changed_real = [...real]; row.para_changed_tool = [...mine];
      row.para_extra = [...mine].filter((k) => !real.has(k)); row.para_missed = [...real].filter((k) => !mine.has(k));
      row.annotations_dropped = (t.old.match(/<개정[^>]*>|\[(개정|신설|본조신설)[^\]]*\]/g) || []).length - (t.new.match(/<개정[^>]*>|\[(개정|신설|본조신설)[^\]]*\]/g) || []).length;
    }
    per.push(row);
  }
  const extra = tool.filter((_, k) => !used.has(k)).map((t) => ({ ref: t.ref, op: t.op, title: t.title }));
  const hits = per.filter((p) => p.hit).length;
  return { recall: +(hits / c.actual.length).toFixed(2), precision: tool.length ? +(hits / tool.length).toFixed(2) : 0, value_accuracy: hits ? +(per.filter((p) => p.hit).reduce((s, p) => s + p.value_ok, 0) / hits).toFixed(2) : 0, per, extra };
}

async function runCase(c, spec, sources, counter) {
  const [preset, model] = spec.split(/:(.+)/);
  const cfg = resolveLlmConfig(process.env, { preset, model });
  if (!cfg) throw new Error(`${spec}: 서버 키가 없습니다.`);
  const llm = createLlm(cfg, { fetchImpl: (...a) => { counter.n++; if (counter.n > counter.max) throw new Error('LLM 호출 예산 초과'); return fetch(...a); } });
  const before = counter.n;
  const [oldDoc, newDoc] = [await loadMain(sources, c.old_doc), await loadMain(sources, c.new_doc)];
  const oldAdd = new Set(oldDoc.d.articles.filter((a) => a.section === '부칙').map((a) => nz(a.body)));
  const realAddenda = newDoc.d.articles.filter((a) => a.section === '부칙' && !oldAdd.has(nz(a.body)) && nz(a.body)).map((a) => `${a.title || ''} ${a.body}`.trim()).join('\n').slice(0, 800);
  // 시간 차단: 검색 결과에서 같은 기관·같은 제명의 다른 판본(=정답인 신판 포함)을 뺀다
  const leak = (x) => x.inst_name === c.inst && String(x.doc_title || '').replace(/\s+/g, '') === c.title.replace(/\s+/g, '') && x.doc_id !== c.old_doc;
  const fence = async (p) => { const r = await p; const rows = r.rows.filter((x) => !leak(x)); fenced += r.rows.length - rows.length; return { ...r, rows }; };
  let fenced = 0;
  const fencedSources = { ...sources, searchRegs: (q) => fence(sources.searchRegs(q)), rest: { ...sources.rest, search: (q) => fence(sources.rest.search(q)) } };
  const jobs = createJobs(), t0 = Date.now();
  const profile = { type: 'public-institution', name: c.inst };
  const id = jobs.start('amend', { doc_id: c.old_doc, intent: c.intent, auto: true, profile, ...(process.env.REPLAY_REFS ? { refs: JSON.parse(process.env.REPLAY_REFS) } : {}) }, FLOWS.amend, { deps: { sources: fencedSources, llm, env: process.env, procedures: loadProcedures() } });
  let j; for (;;) { j = jobs.get(id); if (['done', 'failed'].includes(j.status)) break; if (j.status === 'waiting') jobs.answer(id, j.gate.id, (j.gate.options || []).filter((o) => o.checked).map((o) => o.value)); await new Promise((r) => setTimeout(r, 400)); }
  const res = j.result, sec = (k) => res?.docset?.sections?.find((s) => s.id === k);
  const ev = j.steps.find((s) => s.name === '근거 조사')?.evidence || [];
  const out = {
    case: c.id, tag: process.env.REPLAY_TAG || null, model: cfg.model, preset: cfg.preset, date: new Date().toISOString(), status: j.status, error: j.error, seconds: +((Date.now() - t0) / 1000).toFixed(1), llm_calls: counter.n - before,
    steps: j.steps.map((s) => `${s.state} ${s.name}: ${(s.note || '').split('\n')[0].slice(0, 200)}`), logs: j.logs.map((l) => l.text),
    evidence: ev.map((e) => `${e.label} — ${e.doc_id || ''}`), fenced_rows: fenced, cause_found: c.cause ? ev.some((e) => c.cause.test(e.label)) : null,
    real_addenda: realAddenda,
    tool: res ? {
      changes: res.changes.map((x) => ({ op: x.op, ref: x.ref, new_ref: x.new_ref, title: x.title, old: x.old, new: x.new, reason: x.reason, basis_ids: x.basis_ids })),
      draft: sec('draft')?.body, comparison: sec('comparison')?.rows, addenda: sec('addenda')?.body, reason: sec('reason')?.body, checklist: sec('checklist')?.body,
    } : null,
    real_new: Object.fromEntries(c.actual.map((a) => [a.ref, newDoc.byRef.get(a.ref)?.body ?? null])),
    score: res ? score(c, res, oldDoc, newDoc) : null,
  };
  mkdirSync(RUNS, { recursive: true });
  const base = `${c.id}__${spec.replace(/[^a-z0-9]+/gi, '_')}${process.env.REPLAY_TAG ? `__${process.env.REPLAY_TAG}` : ''}`;
  writeFileSync(join(RUNS, `${base}.json`), JSON.stringify(out, null, 1));
  if (res?.docset) writeFileSync(join(RUNS, `${base}.md`), renderDocSet(res.docset, 'md'));
  console.log(c.id, spec, j.status, `${out.seconds}s`, `LLM ${out.llm_calls}회`, out.score ? `재현율 ${out.score.recall} 정밀도 ${out.score.precision} 값 ${out.score.value_accuracy}` : j.error?.message);
  return out;
}

function summarize() {
  const review = existsSync(join(OUT, 'review.json')) ? JSON.parse(readFileSync(join(OUT, 'review.json'), 'utf8')) : {};
  const runs = readdirSync(RUNS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(RUNS, f), 'utf8')));
  const cases = CASES.map((c) => ({
    id: c.id, topic: c.topic, inst: c.inst, title: c.title, old_doc: c.old_doc, new_doc: c.new_doc, note: c.note || null,
    editions: `${c.old_doc.match(/_(\d{8})\.md$/)[1]} → ${c.new_doc.match(/_(\d{8})\.md$/)[1]}`, intent: c.intent,
    actual_changes: c.actual.map(({ op, ref, summary }) => ({ op, ref, summary })), actual_addenda_note: c.actual_addenda_note || null,
    runs: runs.filter((r) => r.case === c.id).map((r) => ({
      model: r.model, tag: r.tag || null, status: r.status, error: r.error?.message || null, seconds: r.seconds, llm_calls: r.llm_calls, picked: (r.steps.find((s) => s.includes('대상 조문 찾기')) || '').replace(/^done 대상 조문 찾기: /, ''),
      tool_changes: (r.tool?.changes || []).map((x) => `${x.op} ${x.ref}${x.new_ref ? `→${x.new_ref}` : ''}${x.reason === '조 번호 이동에 따른 인용 정정' ? '(인용 정정)' : ''}`),
      score: r.score && { recall: r.score.recall, precision: r.score.precision, value_accuracy: r.score.value_accuracy, extra: r.score.extra, per: r.score.per.map(({ ref, op, hit, tool_ref, tool_op, must_hit, must, para_extra, para_missed, paras_old, paras_tool, paras_real, annotations_dropped }) => ({ ref, op, hit, tool_ref, tool_op, must_hit: must_hit && `${must_hit.length}/${must.length}`, para_extra, para_missed, paras: paras_old != null ? `${paras_old}→도구 ${paras_tool} / 실제 ${paras_real}` : undefined, annotations_dropped })) },
      cause_found: r.cause_found, tool_addenda: r.tool?.addenda, real_addenda: r.real_addenda,
      review: review[`${c.id}|${r.model}${r.tag ? `|${r.tag}` : ''}`] || null,
    })),
  }));
  const all = cases.flatMap((c) => c.runs.map((r) => ({ c, r })));
  // 집계: 실패한 실행도 분모(실제 변경 수)에 넣는다. primary = 태그 없는 첫 실행(재시도·진단 실행 제외)
  const agg = (pred) => {
    const xs = all.filter(pred), done = xs.filter((x) => x.r.score);
    const n = xs.reduce((s, x) => s + x.c.actual_changes.length, 0), hit = done.reduce((s, x) => s + x.r.score.per.filter((p) => p.hit).length, 0);
    const tool = done.reduce((s, x) => s + x.r.tool_changes.filter((t) => !t.includes('인용 정정')).length, 0);
    const rv = xs.map((x) => x.r.review?.scores).filter(Boolean), keys = rv.length ? Object.keys(rv[0]) : [];
    return { runs: xs.length, completed: done.length, actual_changes: n, hit, tool_changes: tool, recall_incl_failed: n ? +(hit / n).toFixed(2) : null, precision: tool ? +(hit / tool).toFixed(2) : null, must_value_accuracy_completed: done.length ? +(done.reduce((s, x) => s + x.r.score.value_accuracy, 0) / done.length).toFixed(2) : null, review_avg_0to2: Object.fromEntries(keys.map((k) => [k, +(rv.reduce((s, r) => s + r[k], 0) / rv.length).toFixed(2)])), llm_calls: xs.reduce((s, x) => s + (x.r.llm_calls || 0), 0) };
  };
  const models = [...new Set(all.map((x) => x.r.model))];
  const summary = { primary: Object.fromEntries(models.map((m) => [m, agg((x) => x.r.model === m && !x.r.tag)])), all_runs: Object.fromEntries(models.map((m) => [m, agg((x) => x.r.model === m)])), llm_calls_total: all.reduce((s, x) => s + (x.r.llm_calls || 0), 0) };
  writeFileSync(join(OUT, 'cases.json'), JSON.stringify({ generated: new Date().toISOString(), method: 'docs/replay/README.md', summary, review_rubric: review._rubric || null, cases }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

const [cmd, spec, ...ids] = process.argv.slice(2);
if (cmd === 'run') {
  const sources = createSources(process.env, fetch, { cacheDir: join(root, 'app', 'var', 'cache') });
  const counter = { n: 0, max: +(process.env.REPLAY_LLM_MAX || 20) };
  for (const c of CASES.filter((x) => !ids.length || ids.includes(x.id))) {
    try { await runCase(c, spec, sources, counter); } catch (e) { console.log(c.id, spec, '오류', e.message); }
  }
  console.log('LLM 호출 합계', counter.n);
} else if (cmd === 'summarize') summarize();
else console.log('사용: replay-history.mjs run <preset[:model]> [사례ID...] | summarize');
