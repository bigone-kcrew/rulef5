// 개정 흐름: 원문 → 대상 조문 → 근거 → 수정안(LLM) → 인용 정정(코드) → 문서 세트
import { keywords, scoreArticle, clip, normalizeArticle, fixTypos } from '../lib/text.mjs';
import { renumber, corrections, findCiting, extractCitations, sameRegulation, moveRanges } from '../lib/refs.mjs';
import { buildComparison, amendmentText, splitParagraphs, josa } from '../lib/table.mjs';
import { pickArticlesPrompt, amendPrompt, SYS_BASE } from './prompts.mjs';
import { selfReview, tidyDeletedParagraphs, subjectOf, judgeAdverse } from './review.mjs';
import { gatherEvidence, fail, editionLabel, upcomingChecks } from './common.mjs';
import { reasonDoc, addendaDoc, noticeDoc, checklistDoc, procedureDocs, regKindOf, consolidatedDoc } from './docset.mjs';
import { parseRef } from '../lib/parse.mjs';
import { caConflicts, caTable } from './ca-check.mjs';

const LABOR = /(복무|휴가|휴직|근무|보수|임금|수당|징계|해고|취업|인사|근로)/;
const CUT_INTENT = /줄이|줄인|축소|감축|폐지|삭제|없앤|없애|하향|낮추|낮춘|강화|의무화|승인을\s*받|허가를\s*받|제한(하|을|한)/;

// A3 불이익 변경 가능성(규칙): 혜택 수치 감소, 부담 수치 증가, '할 수 있다'→'하여야 한다', 혜택 조문 삭제
const BENEFIT = /(휴가|수당|임금|보수|휴직|급여|상여|포상|지원금|일수|연가|보상)/, BURDEN = /(징계|정직|감봉|근무시간|근로시간|시간외|당직|대기)/;
// 규칙 판정과 AI 판정을 조문별로 합친다(AI 이유는 「AI:」로 구분)
export function mergeAdverse(rule, ai) {
  const by = new Map(rule.map((a) => [a.ref, { ref: a.ref, reasons: [...a.reasons] }]));
  for (const a of ai || []) { const g = by.get(a.ref) || { ref: a.ref, reasons: [] }; for (const r of a.reasons) g.reasons.push(`AI: ${r}`); by.set(a.ref, g); }
  return [...by.values()].filter((a) => a.reasons.length);
}
export function adverseChanges(changes) {
  const out = [];
  for (const c of changes) {
    const reasons = [], ctx = `${c.title || ''} ${c.old || ''}`;
    if (c.op === 'delete' && BENEFIT.test(ctx)) reasons.push('혜택 관련 조문 삭제');
    if (c.op === 'amend') {
      // 같은 항 안에서, 수치 뒤 문맥(단위 다음 4글자)이 같은 것끼리만 짝지어 비교한다
      const occ = (s) => [...String(s).matchAll(/(\d+(?:\.\d+)?)\s*(일|개월|년|시간|회|%|만원|원)([^\d]{0,6})/g)].map((m) => ({ v: +m[1], u: m[2], k: m[3].replace(/\s+/g, '').slice(0, 4) }));
      const paras = (s) => String(s).split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/);
      const po = paras(c.old), pn = paras(c.new);
      for (let p = 0; p < Math.min(po.length, pn.length); p++) {
        const a = occ(po[p]), b = occ(pn[p]);
        for (const x of a) { const y = b.find((z) => z.u === x.u && z.k === x.k); if (!y || y.v === x.v) continue;
          if (BENEFIT.test(ctx) && !BURDEN.test(ctx) && y.v < x.v) reasons.push(`${x.v}${x.u} → ${y.v}${y.u}(혜택 감소)`);
          if (BURDEN.test(ctx) && y.v > x.v) reasons.push(`${x.v}${x.u} → ${y.v}${y.u}(부담 증가)`); }
      }
      // 유급이던 혜택에 「무급」이 새로 생기면(일부를 무급으로 돌림) 불리한 변경일 수 있다
      if (BENEFIT.test(ctx) && /유급/.test(c.old || '') && /무급/.test(c.new || '') && !/무급/.test(c.old || '')) reasons.push('유급 → 일부 무급 전환');
      // 전부 유급이던 것이 「최초 N일은 유급」처럼 일부만 유급으로 바뀌면 혜택 축소일 수 있다
      if (BENEFIT.test(ctx) && /유급/.test(c.old || '') && !/최초\s*\d+\s*일/.test(c.old || '') && /최초\s*\d+\s*일[^.]{0,8}유급/.test(c.new || '')) reasons.push('전부 유급 → 일부만 유급');
      // 호·목(1. 가. …)이 줄면 대상·기간을 정한 세부 기준이 빠진 것일 수 있다
      const items = (t) => String(t || '').split('\n').filter((l) => /^\s*(\d+\.|[가-하]\.)\s/.test(l)).length;
      if (BENEFIT.test(ctx) && items(c.new) < items(c.old)) reasons.push(`세부 호·목 ${items(c.old)}개 → ${items(c.new)}개`);
      if (/수 있다/.test(c.old) && /(여야|해야|아야|어야) 한다/.test(c.new) && !/수 있다/.test(c.new)) reasons.push('재량 → 의무');
    }
    if (reasons.length) out.push({ ref: c.ref, reasons });
  }
  return out;
}

// 모델이 준 조문 번호 정리: 띄어쓰기·항 표기("제79조①", "제 7 조의2 제3항")를 받아들인다
const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// 「본 조는 폐지한다」「(삭제)」처럼 조문을 없앤다는 말만 남은 본문인지(조 번호·제목 줄은 떼고 본다)
export function isAbolish(text, titles = []) {
  let t = String(text || '').replace(/[()\[\]<>〈〉.\s]/g, '').replace(/^제\d+조(의\d+)?/, '');
  for (const ti of titles) { const c = String(ti || '').replace(/[()\[\]<>〈〉.\s]/g, ''); if (c && t.startsWith(c)) { t = t.slice(c.length); break; } }
  return /^((이|본|동)조(문)?[은는을를]?)?(삭제|폐지)(한다|함|됨)?$/.test(t);
}
export function normRef(raw) {
  const s = String(raw ?? '').replace(/\s+/g, ''), m = s.match(/^제(\d+)조(?:의(\d+))?/);
  if (!m) return { ref: s, para: null };
  const pm = s.slice(m[0].length).match(/^(?:제(\d+)항|([①-⑳]))/);
  const rest = s.slice(m[0].length + (pm ? pm[0].length : 0));
  return { ref: `제${+m[1]}조${m[2] ? `의${+m[2]}` : ''}`, para: pm ? (pm[1] ? +pm[1] : CIRC.indexOf(pm[2]) + 1) : null, ...(/^제?\d+호|^[가-하]목/.test(rest) ? { item: true } : {}) };
}
// 항 단위로 온 수정을 조문 전체 본문에 합친다(다른 항은 원문 유지)
export function mergeParagraphChanges(changes, bodyOf) {
  const out = [];
  for (const c of changes) {
    const whole = [...String(c.new_text || '')].filter((ch) => CIRC.includes(ch)).length >= 2;
    if (c.op !== 'amend' || !c.para || whole) { out.push(c); continue; }
    const prev = out.find((x) => x.op === 'amend' && x.ref === c.ref && x.merged);
    const paras = splitParagraphs(prev ? prev.new_text : bodyOf(c.ref)), mark = CIRC[c.para - 1];
    let nt = c.new_text.trim().replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').replace(/^제\s*\d+\s*항\s*/, '');
    if (!nt.startsWith(mark)) nt = `${mark} ${nt}`;
    const i = paras.findIndex((p) => p.startsWith(mark));
    if (i >= 0 && c.insertPara && !/^[①-⑳]\s*삭제\s*$/.test(paras[i])) {
      // 항 삽입: 그 자리에 넣고 뒤 항 번호를 하나씩 민다
      paras.splice(i, 0, nt);
      for (let k = i + 1; k < paras.length; k++) { const cur = CIRC.indexOf(paras[k][0]); if (cur >= 0 && cur + 1 < CIRC.length) paras[k] = CIRC[cur + 1] + paras[k].slice(1); }
    } else if (i >= 0) paras[i] = nt; else paras.push(nt);
    if (prev) { prev.new_text = paras.join('\n'); prev.reason = [prev.reason, c.reason].filter(Boolean).join(' / '); prev.basis_ids = [...new Set([...(prev.basis_ids || []), ...(c.basis_ids || [])])]; }
    else out.push({ ...c, new_text: paras.join('\n'), merged: true });
  }
  return out;
}

export async function loadRelatedDocs(sources, doc, limit = 5) {
  // 같은 기관의 다른 규정 중 이 규정 제명을 인용하는 문서를 찾는다(ALIO 문서만)
  if (!doc.inst || !/^bylaws:/.test(doc.doc_id)) return [];
  try {
    const core = doc.title.replace(/\s+/g, '');
    const r = await sources.searchRegs({ keyword: core, corpus: 'bylaws', inst: doc.inst, body: true, limit: 30 });
    const ids = [...new Set(r.rows.map((x) => x.doc_id).filter((id) => id !== doc.doc_id))].slice(0, limit);
    return (await Promise.all(ids.map((id) => sources.loadDoc(id).catch(() => null)))).filter(Boolean); // 개별 실패는 무시
  } catch { return null; }
}

export async function runAmend(ctx) {
  const { sources, llm } = ctx.deps, input = ctx.input;
  const intent = fixTypos(String(input.intent || '').trim());
  if (!input.doc_id || !intent || intent.length > 2000) throw fail('bad_input', '대상 규정과 개정 의도(2,000자 이내)를 입력해 주세요.');
  // 수정안은 모델이 있어야 만들 수 있다. 조회·사람 확인을 다 거친 뒤에 실패하지 않도록 처음에 알린다
  if (!llm) throw fail('llm_missing', '모델이 설정되지 않아 수정안을 만들 수 없습니다. 상단 「모델 설정」(F12)에서 모델과 API 키를 지정하세요.');

  const doc = await ctx.step('원문 불러오기', async (s) => {
    const d = await sources.loadDoc(input.doc_id);
    const main = d.articles.filter((a) => a.section === '본칙' && a.ref);
    if (!main.length) throw fail('no_articles', '본칙 조문을 찾지 못했습니다. 원문을 확인해 주세요.');
    s.note(`${d.inst ? d.inst + ' ' : ''}「${d.title}」 본칙 ${main.length}개 조문${d.edition?.warning ? ` · ⚠ ${d.edition.warning}` : ''}`);
    s.evidence({ label: `대상 규정: ${d.title}`, doc_id: d.doc_id, edition: editionLabel(d) });
    return d;
  });
  // 연혁 표기(<개정 …>)와 빈 줄·기호를 정리한 본문으로 작업한다(대비표에 가짜 변경이 생기지 않게)
  // 같은 기관의 관련 규정은 미리 불러 둔다(수정안을 쓰는 동안 함께 진행)
  const relatedP = loadRelatedDocs(sources, doc).catch(() => null);
  const main = doc.articles.filter((a) => a.section === '본칙' && a.ref).map((a) => ({ ...a, body: normalizeArticle(a.body) }));
  const byRef = new Map(main.map((a) => [a.ref, a]));

  // 의도의 주제(예: 배우자 출산휴가)를 정한 조문이 이 규정에 아예 없으면 기존 조문에 끼워 넣지 말고 새 조문으로 둔다
  let absentTopic = null, pickTopic = '';
  // 규정에 그 주제 조문이 있는지(코드 판단): 조 제목에 주제 낱말이 있거나, 한 조문 본문에 주제 낱말이 모두 있으면 있는 것으로 본다
  const hasTopic = (topic) => { const ws = topic.split(/\s+/).filter((w) => w.length >= 2); if (!ws.length) return true; return doc.articles.some((a) => ws.some((w) => String(a.title || '').includes(w)) || ws.every((w) => String(a.body || '').includes(w))); };
  const pick = await ctx.step('대상 조문 찾기', async (s) => {
    if (Array.isArray(input.refs) && input.refs.length) {
      const bad = input.refs.filter((r) => !byRef.has(r));
      if (bad.length) throw fail('unknown_ref', `${bad.join(', ')} 조문을 찾지 못했습니다.`);
      s.note(`지정 조문: ${input.refs.join(', ')}`); return { suggested: input.refs.slice(0, 5), pool: [], why: '지정', fixed: true };
    }
    const kws = keywords(intent);
    const ranked = main.map((a) => [scoreArticle(a, kws), a]).sort((x, y) => y[0] - x[0]);
    const cands = ranked.filter(([sc]) => sc > 0).slice(0, 12).map(([, a]) => a);
    const pool = cands.length ? cands : main.slice(0, 12);
    let suggested = cands.slice(0, 2).map((a) => a.ref), why = '핵심어 일치';
    if (llm) {
      try {
        // 후보마다 의도와 맞는 항을 골라 보여 준다(조문 첫머리만 보이면 뒤쪽 항의 내용을 놓친다)
        const snip = (a) => { const ps = splitParagraphs(a.body).map((p) => [scoreArticle({ title: '', body: p }, kws), p]); const top = ps.filter(([sc]) => sc > 0).sort((x, y) => y[0] - x[0]).slice(0, 2).map(([, p]) => p); return top.length ? ps.filter(([, p]) => top.includes(p)).map(([, p]) => clip(p, 220)).join(' … ') : a.body.slice(0, 220); };
        const o = await llm.chatJson(pickArticlesPrompt(doc, intent, pool.map((a) => ({ ...a, body: snip(a) }))), (o) => { o.refs = [...new Set((Array.isArray(o.refs) ? o.refs : []).map((r) => normRef(r).ref))].filter((r) => byRef.has(r)); if (!o.refs.length) throw new Error('refs 는 후보 조문 번호여야 합니다.'); return o; }, { maxTokens: 2000 });
        suggested = o.refs.slice(0, 4); why = o.why || 'AI 추천';
        const topic = typeof o.topic === 'string' ? o.topic.replace(/[「」"']/g, '').trim().slice(0, 30) : '';
        pickTopic = topic;
        // 모델도 「없다」고 하고(exists=false) 코드로도 어느 조문에도 주제 낱말이 절반 이상 함께 나오지 않을 때만
        if (topic.length >= 2 && !hasTopic(topic)) { absentTopic = topic; why = `이 규정에는 「${topic}」 조문이 없어 새 조문으로 둡니다(아래는 새 조문을 둘 자리 후보) — ${why}`; }
      } catch (e) { ctx.log(`AI 조문 추천 실패(${e.code || 'error'}) — 핵심어 일치 결과를 씁니다.`); ctx.metric?.('picker_fallback', e.code || 'error'); }
    }
    s.note(`추천: ${suggested.join(', ') || '없음'} (${why})`);
    return { suggested, pool, why, fixed: false };
  });
  // 근거 조사: 고른 조문 제목과 의도로 유사 규정·상위 법령을 찾는다
    const govT = (doc.doc_id.match(/^law:(ordin|admrul):/) || [])[1] || { 'local-gov': 'ordin', 'central-ministry': 'admrul' }[input.profile?.type] || null;
    const orgType = govT ? (govT === 'ordin' ? 'local-gov' : 'central-ministry') : (input.profile?.type || null);
  const collect = async (refsX) => { const targets = refsX.map((r) => byRef.get(r)).filter(Boolean); const q = `${intent} ${targets.map((a) => a.title).join(' ')}`; return gatherEvidence(ctx.deps, { query: q, excludeDocId: doc.doc_id, excludeSame: doc.inst ? { inst: doc.inst, title: doc.title } : null, orgType, govSimilar: govT && sources.gov?.enabled ? { target: govT, org: doc.inst || input.profile?.name || null } : null }); };
  // 확인 화면 전에 정할 조문: 추천(없으면 낱말이 가장 맞는 후보로 근거만 찾는다)
  let refs = pick.suggested.length ? pick.suggested : pick.pool.slice(0, 1).map((a) => a.ref);
  if (!refs.length) throw fail('no_target', '개정할 조문을 찾지 못했습니다.');
  let { evidence, errors } = await ctx.step('근거 조사', async (s) => {
    const r = await collect(refs);
    s.note(`근거 ${r.evidence.length}건${r.errors.length ? ` · ⚠ ${r.errors.join('·')} 조회 실패(0건이 '없음'을 뜻하지 않음)` : ''}`);
    s.evidence(r.evidence.map((e) => ({ label: `[${e.id}] ${e.kind} · ${e.label}`, doc_id: e.doc_id, ref: e.ref, edition: e.edition })));
    return r;
  });

  // 수정안 작성(모델): 확인 화면을 보는 동안 추천대로 미리 쓸 수 있게 함수로 둔다(단계 기록은 하지 않음)
  const makeDraft = async (targets, evidence) => {
    const ids = new Set(evidence.map((e) => e.id));
    let attempt = 0; const dropped = [], dupTitle = new Set(), titleClash = [];
    const validate = (o) => {
      attempt++;
      if (!Array.isArray(o.changes) || !o.changes.length || o.changes.length > 12) throw new Error('changes 는 1~12개여야 합니다.');
      if (typeof o.reason_summary !== 'string') throw new Error('reason_summary 가 없습니다.');
      for (const k of ['checks', 'main_points', 'not_reflected']) o[k] = (Array.isArray(o[k]) ? o[k] : o[k] ? [o[k]] : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 12);
      const seen = new Set();
      const bad = [], good = [];
      for (const c of o.changes) {
        const label = `${c.op || '?'} ${c.ref || c.after || ''}`.trim();
        try {
          if (c.ref !== undefined && c.ref !== null) { const n = normRef(c.ref); if (n.item) throw new Error(`${c.ref}: 호·목 단위로는 고칠 수 없습니다. 그 조문 전체 본문을 op=amend 로 쓰세요`); c.ref = n.ref; c.para = n.para; }
          if (c.after !== undefined && c.after !== null) { const n = normRef(c.after); c.after = n.ref; c.afterPara = n.para; }
          // 항을 새로 넣는 요청(insert + 항 표기)은 그 조문의 항 추가로 바꾼다
          if (c.op === 'insert' && ((c.afterPara && byRef.has(c.after)) || (c.para && byRef.has(c.ref)))) Object.assign(c, { op: 'amend', ref: c.afterPara && byRef.has(c.after) ? c.after : c.ref, para: c.afterPara && byRef.has(c.after) ? c.afterPara + 1 : c.para, insertPara: true });
          // 기존 조문을 고친 것을 신설로 낸 경우(본문이 앞 조문의 번호·제목으로 시작): 그 조문의 개정으로 바꾼다
          if (c.op === 'insert' && byRef.has(c.after) && typeof c.new_text === 'string') { const h = c.new_text.trim().match(/^(제\s*\d+\s*조(?:의\s*\d+)?)\s*[(\[]?\s*([^)\]\n①]{0,40}?)\s*[)\]]?\s*(?:\n|(?=①))/); const prev = byRef.get(c.after); if (h && normRef(h[1]).ref === c.after && (!h[2] || !prev.title || h[2].replace(/\s+/g, '') === prev.title.replace(/\s+/g, ''))) Object.assign(c, { op: 'amend', ref: c.after, after: undefined, title: prev.title, new_text: c.new_text.trim().slice(h[0].length) }); }
          // 이미 있는 조문과 제목이 같은 신설은 그 조문을 고친 것으로 본다(같은 제목의 조문이 둘 생기는 것을 막는다)
          if (typeof c.title === 'string') c.title = c.title.replace(/^\s*제\s*\d+\s*조(?:의\s*\d+)?\s*/, '').replace(/^[(\[]\s*|\s*[)\]]$/g, '').trim();
          if (c.op === 'insert' && typeof c.title === 'string' && c.title.replace(/\s+/g, '').length >= 2) {
            const same = main.find((a) => a.title && a.title.replace(/\s+/g, '') === c.title.replace(/\s+/g, ''));
            const at = main.findIndex((a) => a.ref === c.after), si = same ? main.indexOf(same) : -1;
            // 바로 앞·뒤 조문과 제목이 같으면 그 조문을 고친 것으로 보고, 떨어진 조문이면 신설을 두고 경고만 한다
            if (same && at >= 0 && Math.abs(si - at) <= 1) { Object.assign(c, { op: 'amend', ref: same.ref, after: undefined }); dupTitle.add(same.ref); }
            else if (same) titleClash.push(`${c.title}: 새 조문이 ${same.ref}(${same.title})${josa(same.title, '과', '와')} 제목이 같습니다. 제목을 구분하거나 ${same.ref}${josa(same.ref, '을', '를')} 고치는 것이 맞는지 확인하세요.`);
          }
          // 「본 조는 폐지한다」처럼 삭제를 문장으로 쓴 수정은 조 삭제로 바꾼다
          if (c.op === 'amend' && typeof c.new_text === 'string' && isAbolish(c.new_text, [c.title, byRef.get(c.ref)?.title])) c.op = 'delete';
          const key = c.op === 'insert' ? null : `${c.ref}#${c.para || ''}`;
          if (key && seen.has(key)) throw new Error(`${c.ref} 에 대한 변경이 둘 이상입니다. 한 조문의 변경은 하나로 합쳐 쓰세요`);
          if (key) seen.add(key);
          if (!['amend', 'insert', 'delete'].includes(c.op)) throw new Error(`op 값 ${c.op} 이 올바르지 않습니다`);
          if (c.op !== 'insert' && !byRef.has(c.ref)) throw new Error(`${c.ref} 는 규정에 없는 조문입니다`);
          if (c.op === 'insert' && !byRef.has(c.after)) throw new Error(`신설 조문의 after(${c.after}) 가 규정에 없습니다`);
          if (c.op !== 'delete' && (typeof c.new_text !== 'string' || !c.new_text.trim() || c.new_text.length > 8000)) throw new Error(`${c.ref || c.after} 의 new_text 가 비어 있거나 너무 깁니다`);
          // 주제가 없는 규정의 새 조문은 제목 끝말이 같은 조문(「…휴가」) 무리의 맨 뒤에 둔다(예: 배우자 출산휴가 → 경조휴가 다음)
          if (absentTopic && c.op === 'insert') { const tails = absentTopic.split(/\s+/).filter((w) => w.length >= 2).map((w) => w.slice(-2)); const near = main.filter((x) => tails.some((t) => String(x.title || '').includes(t))); if (near.length && !tails.some((t) => String(byRef.get(c.after)?.title || '').includes(t))) c.after = near.at(-1).ref; }
          // 주제가 없는 규정에서 관계없는 기존 조문(예: 고충처리)에 그 주제를 끼워 넣은 수정은 새 조문으로 다시 쓰게 한다
          if (absentTopic && c.op === 'amend') { const w = absentTopic.split(/\s+/).filter((x) => x.length >= 2); const into = w.some((x) => c.new_text.includes(x) && !byRef.get(c.ref).body.includes(x)); if (into && attempt === 1) throw new Error(`${c.ref}: 이 규정에 없는 「${absentTopic}」을 관계없는 기존 조문에 넣었습니다. op=insert 로 새 조문을 만들고 after=${c.ref} 로 두세요`); if (into) titleClash.push(`${c.ref}: 이 규정에 없던 「${absentTopic}」을 기존 조문(${byRef.get(c.ref).title})에 넣었습니다. 새 조문으로 두는 것이 맞는지 확인하세요.`); }
          if (!Array.isArray(c.basis_ids)) c.basis_ids = [];
          c.basis_ids = c.basis_ids.filter((x) => ids.has(x));
          if (c.new_text) c.new_text = tidyDeletedParagraphs(normalizeArticle(c.new_text));
          good.push(c);
        } catch (e) { bad.push(`${label}: ${e.message}`); }
      }
      if (bad.length && (attempt === 1 || !good.length)) throw new Error(`${bad.join(' / ')}. 조문 번호는 '제6조'처럼 규정에 있는 조 번호만 쓰고, 항·호를 추가·삭제·수정할 때는 op=amend 로 그 조문의 본문 전체를 new_text 에 쓰세요. 새 조문만 op=insert(after=앞 조문 번호)로 쓰세요.`);
      dropped.push(...bad); o.changes = good;
      return o;
    };
    const o = await llm.chatJson(amendPrompt({ doc, intent, targets, evidence, toc: main.slice(0, 400).map((a) => `${a.ref} ${a.title}`), profile: input.profile, absent: absentTopic, subject: subjectOf(main.map((a) => a.body).join('\n')) }), validate);
    o.changes = mergeParagraphChanges(o.changes, (ref) => byRef.get(ref).body);
    o.dropped = dropped; o.dupTitle = [...dupTitle].filter((r) => o.changes.some((c) => c.ref === r)); o.titleClash = [...new Set(titleClash)];
    return o;
  };

  // 담당자 확인 — 조문과 근거를 한 화면에서 고른다. 그동안 추천대로 수정안을 미리 쓰고, 추천을 그대로 받으면 그 결과를 바로 쓴다
  let reuse = null, gateSkipped = null;
  if (!input.auto) {
    const kwT = keywords(intent).filter((w) => w.length >= 2);
    const titledT = main.filter((a) => kwT.some((w) => String(a.title || '').includes(w)));
    // 대상이 분명하면(추천 1개 = 제목이 주제와 맞는 유일한 조문, 근거 3건 이하) 묻지 않고 진행한다
    const clear = !pick.fixed && pick.why !== '핵심어 일치' && !absentTopic && refs.length === 1 && titledT.length === 1 && titledT[0].ref === refs[0] && evidence.length <= 3 && !errors.length;
    const opts = [
      // 추천 조문이 낱말 후보 목록 밖에 있어도 반드시 보여 준다(추천을 앞에)
      ...(pick.fixed ? [] : [...new Map([...refs.map((r) => byRef.get(r)).filter(Boolean), ...pick.pool].map((a) => [a.ref, a])).values()].map((a) => ({ group: '개정할 조문', doc_id: doc.doc_id, ref: a.ref, value: `A:${a.ref}`, label: `${a.ref}(${a.title})`, detail: clip(a.body, 160), checked: pick.why !== '핵심어 일치' && refs.includes(a.ref) }))),
      ...evidence.map((e) => ({ group: '참고할 근거 — 우리 기관에 맞지 않는 사례는 빼세요', doc_id: e.doc_id, ref: e.ref, value: `E:${e.id}`, label: `[${e.id}] ${e.kind} · ${e.label}`, detail: clip(e.text, 160), checked: true })),
    ];
    if (clear) { gateSkipped = `대상 조문(${refs[0]})이 분명해 확인 없이 진행했습니다. 다른 조문이었다면 「입력 고치기」에서 조문을 지정해 다시 만드세요.`; ctx.log(`· ${gateSkipped}`); }
    else if (opts.length) {
      const preset = pick.why !== '핵심어 일치';
      const spec = llm && preset ? makeDraft(refs.map((r) => byRef.get(r)), evidence).catch(() => null) : null;
      // 추천 조문 제목에 주제 낱말이 없으면, 같은 기관 다른 규정에 그 주제 조문이 있는지 확인 전에 알려 준다(예: 복무규정이 아니라 인사규정)
      let elsewhere = '';
      const tw = (pickTopic || absentTopic || '').split(/\s+/).filter((w) => w.length >= 2 && !/^(휴가|규정|운영|관리|기준|절차|사항|지원|기한|신청)$/.test(w));
      if (tw.length && !pick.fixed && doc.inst && /^bylaws:/.test(doc.doc_id) && !refs.some((r) => tw.some((w) => String(byRef.get(r)?.title || '').includes(w)))) {
        try {
          const r0 = await sources.searchRegs({ keyword: tw.join(' '), corpus: 'bylaws', inst: doc.inst, hybrid: true, limit: 8 });
          const x = r0.rows.find((y) => y.doc_id !== doc.doc_id && y.art_ref && tw.some((w) => String(y.art_title || '').includes(w)));
          if (x) elsewhere = ` 참고: 이 규정의 추천 조문 제목에는 「${tw.join(' ')}」이(가) 없고, 같은 기관 「${x.doc_title}」 ${x.art_ref}(${x.art_title})에 있습니다. 그 규정을 고쳐야 하면 「입력 고치기」에서 규정을 바꾸세요.`;
        } catch { /* 참고 안내는 빠져도 된다 */ }
      }
      const prompt = (absentTopic ? `이 규정에는 「${absentTopic}」 조문이 없습니다. 새 조문을 둘 자리(바로 앞 조문)와 참고할 근거를 확인해 주세요.` : !preset ? 'AI 추천을 받지 못해 낱말이 맞는 조문을 보여 드립니다. 개정할 조문과 참고할 근거를 골라 주세요.' : '개정할 조문과 참고할 근거를 확인해 주세요. 추천대로면 바로 확인을 누르세요(그동안 초안을 미리 쓰고 있습니다).') + elsewhere;
      const picked = [].concat(await ctx.gate({ id: 'pick_targets', prompt, multi: true, options: opts }) || []).map(String);
      const newRefs = pick.fixed ? refs : picked.filter((v) => v.startsWith('A:')).map((v) => v.slice(2)).filter((r) => byRef.has(r)).slice(0, 5);
      if (!newRefs.length) throw fail('no_target', '개정할 조문이 선택되지 않았습니다.');
      const evIds = new Set(picked.filter((v) => v.startsWith('E:')).map((v) => v.slice(2)));
      const sameRefs = newRefs.length === refs.length && newRefs.every((r) => refs.includes(r));
      if (!sameRefs) {
        refs = newRefs;
        const r = await ctx.step('근거 다시 조사', async (s) => { const x = await collect(refs); s.note(`고른 조문으로 근거 ${x.evidence.length}건`); s.evidence(x.evidence.map((e) => ({ label: `[${e.id}] ${e.kind} · ${e.label}`, doc_id: e.doc_id, ref: e.ref, edition: e.edition }))); return x; });
        evidence = r.evidence; errors = r.errors;
      } else {
        const all = evidence.length; evidence = evidence.filter((e) => evIds.has(e.id));
        if (preset && evidence.length === all) reuse = spec;
      }
    }
  }
  const targets = refs.map((r) => byRef.get(r));

  const draft = await ctx.step('수정안 작성', async (s) => {
    if (!llm) throw fail('llm_missing', '모델이 설정되지 않아 수정안을 만들 수 없습니다. 상단 「모델 설정」에서 모델과 API 키를 지정하세요.');
    const t0 = Date.now();
    let o = reuse ? await reuse : null; const reused = !!o;
    if (!o) o = await makeDraft(targets, evidence);
    s.note(`변경 ${o.changes.length}건 · ${llm.config.model} · ${((Date.now() - t0) / 1000).toFixed(1)}초${reused ? ' · 확인하는 동안 미리 작성한 초안' : ''}`);
    try { ctx.metric?.('gate', { reused, skipped: !!gateSkipped }); } catch { /* 지표는 작업을 막지 않는다 */ }
    return o;
  });

  let consentChosen = false, aiAdverse = [], chosenCut = [];
  // 자체 검토: 규정에 없던 법률 용어, 없는 법령명, 공무원 법령 인용, 항끼리 모순, 의도·근거 요건 누락을 찾아 고친다
  const review = await ctx.step('자체 검토', async (s) => {
    const live = draft.changes.filter((c) => c.op !== 'delete');
    const key = (c, i) => (c.op === 'insert' ? `신설${i + 1}` : c.ref);
    const items = live.map((c, i) => ({ ref: key(c, i), title: c.op === 'insert' ? c.title || '' : byRef.get(c.ref)?.title || '', old: c.op === 'insert' ? '' : byRef.get(c.ref)?.body || '', text: c.new_text }));
    const cited = evidence.filter((e) => live.some((c) => (c.basis_ids || []).includes(e.id)));
    // 현행보다 불리해진 변경(혜택 감소·유급 축소·세부 기준 삭제)은 의도가 줄이라는 것이 아니면 되살리게 한다
    // 현행보다 불리해진 변경(혜택 감소·유급 축소·세부 기준 삭제)이 있으면 담당자가 정한다:
    //  · 유리한 내용 유지 → 자체 검토가 되살린다  · 불리한 변경으로 진행 → 되살리지 않고 근로자 동의 절차를 문서에 넣는다
    // 「추천대로 진행」이면 의도가 줄이라는 것일 때만 불리한 변경으로, 아니면 유리한 내용 유지
    const amended = live.filter((c) => c.op === 'amend').map((c) => ({ op: 'amend', ref: c.ref, title: byRef.get(c.ref)?.title || '', old: byRef.get(c.ref)?.body || '', new: c.new_text }));
    // 규칙(수치·유급 범위·호목 수) + AI 판정(대상 축소·요건 강화 등 문장으로 바뀐 불리함)을 합친다
    try { aiAdverse = await judgeAdverse({ llm, items: amended, intent }); } catch (e) { ctx.log(`AI 불리 판정 실패(${e.code || 'error'}) — 규칙 판정만 씁니다.`); }
    const cut = mergeAdverse(adverseChanges(amended), aiAdverse);
    // 의도 자체가 줄이거나 강화하는 것이면(승인제·의무화·제한 등) 「불리한 변경으로 진행」을 기본으로 둔다
    const wantsCut = CUT_INTENT.test(intent);
    let keepFavorable = false;
    if (cut.length) {
      const list = cut.map((a) => `${a.ref}(${a.reasons.join(', ')})`).join('; ');
      if (input.auto) keepFavorable = !wantsCut;
      else {
        const v = await ctx.gate({ id: 'adverse_choice', prompt: `수정안이 현행보다 직원에게 불리합니다: ${list}. 어느 쪽으로 할까요?`, multi: false, options: [
          { value: 'keep', label: '현행보다 유리한 내용은 그대로 두고, 법 기준에 못 미치는 부분만 고치기', detail: '불리한 변경이 없으면 근로자 동의 없이 의견 청취로 진행할 수 있습니다.', checked: !wantsCut },
          { value: 'cut', label: '불리한 변경으로 진행하기 — 근로자 동의 절차를 문서에 넣기', detail: '근로기준법 제94조제1항: 근로자 과반수로 조직된 노동조합(없으면 근로자 과반수)의 동의가 필요합니다(취업규칙·근로조건 규정인 경우).', checked: wantsCut },
        ] });
        keepFavorable = String([].concat(v)[0] || (wantsCut ? 'cut' : 'keep')) === 'keep';
      }
      consentChosen = !keepFavorable; if (consentChosen) chosenCut = cut;
      ctx.log(`· 불리한 변경 후보 ${cut.length}건 — ${keepFavorable ? '유리한 내용 유지(자체 검토가 되살림)' : '불리한 변경으로 진행(동의 절차 안내)'}`);
    }
    const extraIssues = keepFavorable ? cut.map((a) => ({ ref: a.ref, kind: 'adverse', problem: `${a.ref}: 현행보다 직원에게 불리해졌습니다(${a.reasons.join(', ')}). 현행 규정이 법령보다 유리한 내용(세부 호·목, 유급 범위, 일수)은 그대로 두고, 법령 기준에 못 미치는 부분만 고친 본문을 쓰세요.` })) : [];
    const r = await selfReview({ llm, sources, items, intent, extraIssues, evidence: [...new Set([...(cited.length ? cited : evidence.slice(0, 4)), ...evidence.filter((e) => e.upcoming)])], docText: main.map((a) => `${a.ref}(${a.title}) ${a.body}`).join('\n'), profile: input.profile || {}, kind: '개정' });
    live.forEach((c, i) => { const t = r.fixed.get(key(c, i)); if (t) c.new_text = t; });
    const label = (ref) => { const i = live.findIndex((c, k) => key(c, k) === ref); return i >= 0 && live[i].op === 'insert' ? (live[i].title ? `신설 조문(${live[i].title})` : '신설 조문') : ref; };
    s.note(`코드가 찾은 문제 ${r.found.length}건 · 모델 검토로 고친 조문 ${r.applied.length}개${r.remaining.length ? ` · 남은 문제 ${r.remaining.length}건(체크리스트)` : ''}`);
    // 검토로 본문이 바뀌었으면 개정 이유서·주요 내용을 최종 본문에 맞춰 한 번 다시 쓴다(이유서와 본문이 어긋나지 않게)
    if (r.applied.length && llm) {
      try {
        const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: '최종 수정안에 맞춰 개정 이유(2~3문장)와 주요 내용(조문 번호 포함)을 다시 쓴다. 수정안 본문에 없는 수치·내용은 쓰지 않는다.', 개정의도: intent, 수정안: live.map((c, i) => ({ 조문: c.op === 'insert' ? `신설(${c.title || ''})` : c.ref, 현행: c.op === 'insert' ? '' : clip(byRef.get(c.ref)?.body || '', 1200), 개정안: clip(c.new_text, 1500) })), 출력형식: { reason_summary: '', main_points: [''] } }) }], (x) => { if (typeof x.reason_summary !== 'string' || !Array.isArray(x.main_points)) throw new Error('형식'); return x; }, { maxTokens: 1500 });
        draft.reason_summary = o.reason_summary; draft.main_points = o.main_points.map(String).slice(0, 8);
      } catch (e) { ctx.log(`개정 이유서 다시 쓰기 실패(${e.code || 'error'}) — 처음 이유서를 씁니다.`); }
    }
    return { applied: r.applied.map((x) => `${label(x.ref)}: ${x.problem}`), remaining: r.remaining.map((x) => x.replace(/^신설\d+/, (m) => label(m))) };
  });

  const fix = await ctx.step('인용 정정·영향 확인', async (s) => {
    const ops = draft.changes.filter((c) => c.op !== 'amend').map((c) => (c.op === 'insert' ? { op: 'insert', after: c.after, renumber: !!input.renumber } : { op: 'delete', ref: c.ref, renumber: !!input.renumber }));
    const { map, inserted } = renumber(doc, ops);
    const relatedRes = await relatedP, related = relatedRes || [];
    if (!relatedRes) ctx.log('같은 기관 다른 규정 조회 실패 — 다른 규정의 인용 정정은 확인하지 못했습니다.');
    const docs = [doc, ...related];
    const corr = corrections(docs, doc.doc_id, map);
    const changedRefs = draft.changes.filter((c) => c.op !== 'insert').map((c) => c.ref);
    const citing = changedRefs.flatMap((r) => findCiting(docs, { doc_id: doc.doc_id, ref: r }).map((h) => ({ target: r, ...h, doc_title: docs.find((d) => d.doc_id === h.doc_id)?.title })));
    const annexes = [...new Set(draft.changes.flatMap((c) => extractCitations(c.new_text || '').filter((x) => x.kind === 'annex' || x.kind === 'form').map((x) => x.text)))];
    s.note(`조 번호 이동 ${map.size}건 · 인용 정정 ${corr.length}건 · 변경 조문을 인용하는 조문 ${citing.length}건 · 함께 볼 다른 규정 ${related.length}개`);
    return { map, inserted, corr, citing, annexes, related, relatedFailed: !relatedRes };
  });

  return ctx.step('문서 세트 작성', async (s) => {
    if (doc.inst && (!input.profile?.name || /^예시 /.test(input.profile.name))) input.profile = { ...(input.profile || {}), name: doc.inst };
    let ins = 0;
    const changes = draft.changes.map((c) => {
      if (c.op === 'insert') { const it = fix.inserted[ins++]; const ref = it?.ref; return { op: 'insert', ref, after: it?.after || it?.op?.after || c.after, asked_after: c.after, title: c.title || '', old: '', new: c.new_text.replace(/\n{2,}/g, '\n').trim(), reason: c.reason, basis_ids: c.basis_ids }; }
      const a = byRef.get(c.ref);
      return { op: c.op, ref: c.ref, title: a.title || c.title, old: a.body, new: c.op === 'delete' ? '' : c.new_text.replace(/\n{2,}/g, '\n').replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').trim(), reason: c.reason, basis_ids: c.basis_ids };
    });
    // 모델이 신설 조문에 붙인 번호(추측)를 코드가 매긴 번호로 바꾼다 — 「제N조의M(신설 조문 제목)」 형태만 고친다
    let fixRef = (t) => typeof t !== 'string' ? t : changes.filter((c) => c.op === 'insert' && c.title && c.ref).reduce((acc, c) => acc.replace(new RegExp(`제\\s*\\d+\\s*조(?:의\\s*\\d+)?(?=\\s*\\(\\s*${c.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')}\\s*\\))`, 'g'), c.ref), t);
    // 신설 조문이 하나뿐이면, 이유서·주요 내용에 쓴 원문에 없는 조 번호(모델 추측)를 코드가 매긴 번호로 맞춘다
    const ins1 = changes.filter((c) => c.op === 'insert' && c.ref);
    if (ins1.length === 1) { const known = new Set([...byRef.keys(), ...changes.map((c) => c.ref)]); const f0 = fixRef; fixRef = (t) => typeof t !== 'string' ? t : f0(t).replace(/제\s*\d+\s*조(?:의\s*\d+)?/g, (m) => (known.has(m.replace(/\s+/g, '')) ? m : ins1[0].ref)).replace(/(제\s*\d+\s*조(?:의\s*\d+)?)(?!\s*(?:뒤|다음|앞|와|과|사이))(?=[^.\n]{0,60}신설)/g, (m) => (changes.some((c) => c.ref === m.replace(/\s+/g, '')) ? m : ins1[0].ref)); }
    // 모델이 쓴 「제45조의4 뒤에 신설」 같은 위치 문구를 실제 자리(가지 번호 순서에 맞춘 자리)로 맞춘다
    { const f1 = fixRef; const moved = changes.filter((c) => c.op === 'insert' && c.asked_after && c.after && c.asked_after !== c.after); if (moved.length) fixRef = (t) => typeof t !== 'string' ? t : moved.reduce((acc, c) => acc.replace(new RegExp(`${c.asked_after.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/(\d+)/g, '\\s*$1\\s*')}(?!\\d|의)\\s*(뒤|다음)에`, 'g'), `${c.after} 다음에`), f1(t)); }
    draft.reason_summary = fixRef(draft.reason_summary); draft.main_points = (draft.main_points || []).map(fixRef); draft.checks = (draft.checks || []).map(fixRef);
    if (draft.addenda && typeof draft.addenda === 'object') for (const k of Object.keys(draft.addenda)) draft.addenda[k] = fixRef(draft.addenda[k]);
    const sameDocCorr = fix.corr.filter((c) => c.doc_id === doc.doc_id && !changes.some((x) => x.ref === c.ref));
    const allChanges = [...changes.map((c) => (c.op === 'amend' && fix.map.get(c.ref) ? { ...c, new_ref: fix.map.get(c.ref) } : c)), ...sameDocCorr.map((c) => ({ op: 'amend', ref: c.ref, new_ref: fix.map.get(c.ref) || undefined, title: byRef.get(c.ref)?.title || '', old: c.before, new: c.after, reason: '조 번호 이동에 따른 인용 정정', basis_ids: [] }))];
    const regKind = regKindOf(doc.title, '규정', doc.doc_type);
    const otherCorr = fix.corr.filter((c) => c.doc_id !== doc.doc_id);
    const shortWarn = changes.filter((c) => c.op === 'amend' && c.old.length >= 400 && c.new.length < c.old.length * 0.6).map((c) => `${c.ref}: 수정안이 원문보다 크게 짧습니다. 항·호 누락 여부를 대조하세요.`);
    const paraLoss = changes.filter((c) => c.op === 'amend' && splitParagraphs(c.new).length < splitParagraphs(c.old).length).map((c) => `${c.ref}: 항 수가 줄었습니다(${splitParagraphs(c.old).length}→${splitParagraphs(c.new).length}). 의도한 삭제인지 확인하세요.`);
    // 자체 검토로 본문이 바뀐 조문은 AI 판정을 최종 본문으로 다시 받는다(바뀐 본문에 옛 판정을 쓰지 않음)
    const sameText = (a) => changes.some((c) => c.ref === a.ref && c.op === 'amend' && c.new.replace(/\s+/g, '') === String(a.new || '').replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').replace(/\n{2,}/g, '\n').replace(/\s+/g, ''));
    const redo = changes.filter((c) => c.op === 'amend' && aiAdverse.some((a) => a.ref === c.ref && !sameText(a)));
    if (redo.length && llm) { try { const again = await judgeAdverse({ llm, items: redo.map((c) => ({ ref: c.ref, title: c.title, old: c.old, new: c.new })), intent }); aiAdverse = [...aiAdverse.filter(sameText), ...again.map((a) => ({ ...a, new: a.new }))]; } catch { aiAdverse = aiAdverse.filter(sameText); } }
    const adverse = mergeAdverse(adverseChanges(changes), aiAdverse.filter((a) => changes.some((c) => c.ref === a.ref && c.op === 'amend' && c.new.replace(/\s+/g, '') === String(a.new || '').replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').replace(/\n{2,}/g, '\n').replace(/\s+/g, ''))));
    // 담당자가 「불리한 변경으로 진행」을 골랐고(또는 줄이라는 의도) 최종안에도 불리한 변경이 남아 있으면 동의 절차가 필요하다
    // 담당자가 불리한 변경으로 진행하기로 했으면, 자체 검토가 문구를 조금 바꿨어도 그때 확인한 불리한 점으로 동의 절차를 안내한다
    const consentItems = adverse.length ? adverse : consentChosen ? chosenCut : [];
    const consent = (consentChosen || (input.auto && CUT_INTENT.test(intent))) && consentItems.length ? { required: true, items: consentItems.map((a) => ({ ref: a.ref, reasons: a.reasons })) } : null;
    // 근거 없는 수치: 수정안의 「N일·N개월·N회…」가 현행 조문·개정 의도·근거 어디에도 없으면 AI가 정한 값으로 알린다
    const numTok = (t) => [...String(t || '').matchAll(/(\d+(?:\.\d+)?)\s*(일|개월|년|시간|회|퍼센트|%|만원|원|명|세)(?![가-힣]*조)/g)].map((m) => `${m[1]}${m[2]}`);
    const known = new Set([...numTok(intent), ...evidence.flatMap((e) => numTok(e.text)), ...changes.flatMap((c) => numTok(c.old)), ...main.flatMap((a) => numTok(a.body))]);
    const invented = changes.filter((c) => c.op !== 'delete').map((c) => [c, [...new Set(numTok(c.new).filter((x) => !known.has(x)))]]).filter(([, xs]) => xs.length).map(([c, xs]) => `${c.ref}: ${xs.join(', ')} — 개정 의도·현행 규정·근거에서 찾지 못한 값입니다(AI가 정함). 맞는 값인지 정하세요.`);
    // 수정안이 현행과 글자까지 같으면(요청이 이미 반영된 경우 등) 「바꿀 곳 없음」으로 알린다 — 빈 초안을 완료처럼 보이지 않게
    const flatW = (t) => String(t || '').replace(/\s+/g, '');
    const same = changes.filter((c) => c.op === 'amend' && flatW(c.new) === flatW(c.old));
    const noChange = changes.length && same.length === changes.length ? { refs: same.map((c) => c.ref) } : null;
    // C3 단체협약 정합성(같은 기관 협약, 바뀐 조문 제목을 주제로)
    let ca = null;
    // 단체협약은 공공기관(ALIO)만 — 부처·지자체 규정(법제처)과 업로드 자료는 대상 아님
    const isGovDoc = /^law:(ordin|admrul):/.test(doc.doc_id) || ['local-gov', 'central-ministry'].includes(input.profile?.type);
    if (doc.inst && !isGovDoc) { const topics = [...new Set(changes.filter((c) => c.op !== 'delete' && c.title).map((c) => c.title))].slice(0, 3); ca = { rows: [], errors: [], searched: false, ca: null }; for (const r of await Promise.all(topics.map((tp) => caConflicts(sources, { inst: doc.inst, topic: tp, items: changes.filter((c) => c.title === tp).map((c) => ({ ref: c.ref, text: c.new })) })))) { ca.rows.push(...r.rows); ca.errors.push(...r.errors); ca.searched ||= r.searched; ca.ca ||= r.ca; ca.ca_exists ||= r.ca_exists; } }
    const delOver = changes.filter((c) => c.op === 'amend').flatMap((c) => { const np = splitParagraphs(c.new); return splitParagraphs(c.old).filter((p) => /^[①-⑳]\s*삭제\s*$/.test(p) && !np.includes(p)).map((p) => `${c.ref}: 삭제된 항(${p[0]}) 자리에 새 내용이 들어갔습니다. 항 번호를 새로 붙일지(예: 맨 뒤 항) 확인하세요.`); });
    // 새 조문의 주제가 이미 별표(표)에 있으면 별표를 고쳐야 할 수 있다(별표는 수정안 대상이 아니므로 사람이 확인)
    const annexDocs = doc.articles.filter((a) => a.section === '별표');
    const flatT = (t) => String(t || '').replace(/[\s|]+/g, '');
    const annexOverlap = changes.filter((c) => c.op === 'insert' && c.title).flatMap((c) => { const words = c.title.split(/\s+/).filter((w) => w.length >= 2); const pieces = words.flatMap((w) => (w.length >= 4 ? w.match(/.{2}/g) : [w])); const hit = annexDocs.find((a) => words.length && pieces.every((p) => flatT(`${a.title} ${a.body}`).includes(p))); return hit ? [`${c.ref}(${c.title}): 같은 내용이 ${hit.title ? `별표 「${clip(hit.title.replace(/^\s*\[?\s*별표\s*\d*\s*\]?\s*/, ""), 40)}」` : '별표'}에 있습니다. 새 조문 대신 별표를 고쳐야 하는지, 둘이 어긋나지 않는지 확인하세요.`] : []; });
    // 규정의 기관과 설정한 기관이 다르면(수원시로 설정하고 누리시 규칙을 올림 등) 서식의 결재권자·공포 문구가 설정 기관 기준으로 나온다
    const docOrg = doc.inst || (String(doc.title).trim().match(/^(\S+(?:시|군|구|도|부|처|청|공단|공사|진흥원|재단|위원회))\s/) || [])[1] || null;
    const myOrg = input.profile?.name && !/^예시 /.test(input.profile.name) ? input.profile.name : null;
    const sq = (t) => String(t).replace(/\s+/g, '');
    const orgMismatch = docOrg && myOrg && !sq(myOrg).includes(sq(docOrg)) && !sq(docOrg).includes(sq(myOrg).replace(/^.*(?:도|특별시|광역시)(?=.)/, '')) ? `규정의 기관(${docOrg})과 설정한 기관(${myOrg})이 다릅니다. 서식의 결재권자·시행 문구가 ${myOrg} 기준으로 나왔으니 F11 기관 설정을 확인하세요.` : null;
    // 고칠 조문이 없어 새로 만든 경우: 같은 기관의 다른 규정에 이미 그 주제 조문이 있으면 알린다(예: 취업규칙에 없고 복무규정에 있음)
    let sibling = null;
    if (changes.length && changes.every((c) => c.op === 'insert') && doc.inst && /^bylaws:/.test(doc.doc_id)) {
      try {
        const words = changes.flatMap((c) => String(c.title || '').split(/\s+/)).filter((w) => w.length >= 2 && !/^(휴가|규정|운영|관리|기준|절차|사항|지원)$/.test(w));
        const r = await sources.searchRegs({ keyword: keywords(`${changes.map((c) => c.title).join(' ')} ${intent}`).slice(0, 4).join(' '), corpus: 'bylaws', inst: doc.inst, hybrid: true, limit: 8 });
        const x = r.rows.find((y) => y.doc_id !== doc.doc_id && y.art_ref && words.some((w) => String(y.art_title || '').includes(w)));
        if (x) sibling = { doc_id: x.doc_id, title: x.doc_title, ref: x.art_ref, art_title: x.art_title };
      } catch { /* 조회 실패는 건너뛴다 */ }
    }
    // 주제 조문이 따로 있는데 다른 조문을 고친 경우(예: 휴무를 정한 제5조가 있는데 제15조를 고침) — 대상 조문을 다시 보라고 알린다
    const topicWords = keywords(intent).filter((w) => w.length >= 2 && !/^(개정|규정|조문|맞게|따라|법률|시행|변경|수정)$/.test(w));
    const titled = main.filter((a) => topicWords.some((w) => String(a.title || '').includes(w)));
    const offTopic = absentTopic ? [] : changes.filter((c) => c.op === 'amend' && titled.length && !titled.some((a) => a.ref === c.ref) && !topicWords.some((w) => String(c.title || '').includes(w))).map((c) => `${c.ref}(${c.title}): 요청 주제와 제목이 맞는 조문(${titled.slice(0, 3).map((a) => `${a.ref} ${a.title}`).join(', ')})이 따로 있습니다. 고칠 조문이 맞는지 확인하세요.`);
    const checks = [
      consent ? `【동의 필요】 근로자에게 불리한 변경입니다(${consent.items.map((a) => `${a.ref}: ${a.reasons.join(', ')}`).join('; ')}). 취업규칙(근로조건 규정)이면 시행 전에 근로자 과반수로 조직된 노동조합(없으면 근로자 과반수)의 동의를 받아야 합니다(근로기준법 제94조제1항). 동의 없이 불리하게 바꾸면 기존 근로자에게 효력이 없을 수 있습니다. 「근로자 의견 청취서·동의서」를 쓰세요.` : null,
      noChange ? `수정안이 현행과 같습니다(${noChange.refs.join(', ')}). 요청한 내용이 이미 규정에 들어 있는지 원문을 확인하고, 다른 내용을 바꾸려면 개정 의도를 고쳐 다시 만드세요.` : null,
      ...(noChange ? [] : same.map((c) => `${c.ref}: 수정안이 현행과 같습니다. 고칠 내용이 빠졌는지 확인하세요.`)),
      gateSkipped,
      ...upcomingChecks(evidence),
      orgMismatch,
      ...offTopic,
      sibling ? `이 규정에는 해당 주제 조문이 없어 새 조문을 만들었습니다. 같은 기관 「${sibling.title}」 ${sibling.ref}(${sibling.art_title})에 이미 같은 주제가 있습니다 — 그 규정을 고치는 것이 맞는지, 이 규정은 그 규정을 따르도록 할지 확인하세요.` : null,
      ...review.remaining.map((x) => `자체 검토 후 남은 문제 — ${x}`),
      ...review.applied.map((x) => `자체 검토로 고친 점(대조 확인) — ${x}`),
      ...delOver,
      ...(draft.titleClash || []),
      ...(draft.dupTitle || []).map((r) => `${r}: 모델이 같은 제목의 조문을 새로 만들려 해서 기존 조문의 개정으로 바꿨습니다. 원문의 항·호가 빠지지 않았는지 대조하세요.`),
      ...(draft.dropped || []).map((x) => `모델이 낸 변경 중 형식이 맞지 않아 뺀 것 — ${x}`),
      ...(ca?.rows || []).map((x) => `${x.ref}: 단체협약(${x.ca_values.join(', ')})과 값이 다릅니다 — 근로기준법 제96조 확인`),
      ...(ca?.errors.length ? ['단체협약 조회 실패 — 협약과의 정합성을 확인하지 못했습니다.'] : []),
      ...invented,
      // 개정 이유서·주요 내용에 적힌 값이 수정안 본문에 없으면(문서끼리 어긋남) 알린다
      ...(() => { const body = changes.map((c) => c.new).join(' '); const said = [...new Set([draft.reason_summary, ...(draft.main_points || [])].flatMap((t) => numTok(t)))].filter((x) => !numTok(body).includes(x) && !numTok(changes.map((c) => c.old).join(' ')).includes(x)); return said.length ? [`개정 이유서·주요 내용에 적힌 값(${said.join(', ')})이 수정안 본문에 없습니다. 본문과 이유서 중 어느 쪽이 맞는지 맞추세요.`] : []; })(),
      ...(consent ? [] : adverse).map((a) => `${a.ref}: 근로자에게 불리한 변경 가능성(${a.reasons.join(', ')}) — 근로기준법 제94조 동의 절차 확인`),
      ...shortWarn, ...paraLoss,
      doc.edition?.warning ? `대상 규정 판본: ${doc.edition.warning}` : null,
      evidence.length ? null : '근거 자료가 없습니다. 상위 법령·유사 규정을 직접 확인하세요.',
      errors.length ? `근거 조사 일부 실패(${errors.join('·')}) — 해당 출처를 다시 조회하세요.` : null,
      ...changes.filter((c) => !c.basis_ids?.length).map((c) => `${c.ref}: 근거 ID가 없는 변경입니다. 근거를 확인하세요.`),
      fix.map.size ? `조 번호가 이동했습니다(${[...fix.map].map(([a, b]) => `${a}→${b ?? '삭제'}`).join(', ')}). 인용 정정 목록을 확인하세요.` : null,
      ...fix.citing.filter((c) => c.doc_id !== doc.doc_id || !changes.some((x) => x.ref === c.ref)).map((c) => `${c.doc_title || c.doc_id} ${c.ref}${josa(c.ref, '이', '가')} 변경 조문 ${c.target}${josa(c.target, '을', '를')} 인용합니다. 내용 정합성을 확인하세요.`),
      ...fix.annexes.map((a) => `수정안이 ${a}${josa(a, '을', '를')} 인용합니다. 별표·서식 개정 필요 여부를 확인하세요.`),
      ...annexOverlap,
      fix.relatedFailed ? '같은 기관의 다른 규정을 조회하지 못해, 다른 규정의 인용 정정은 확인하지 않았습니다.' : null,
      LABOR.test(`${doc.title} ${intent}`) && (!isGovDoc || /공무직|근로자|기간제|청원경찰|환경관리원/.test(`${doc.title} ${intent}`)) ? '근로조건 관련 개정입니다. 취업규칙 해당 여부와 근로자 의견 청취·불이익 변경 동의(근로기준법 제94조), 단체협약상 협의 사항을 확인하세요.' : null,
      ...draft.not_reflected.slice(0, 6).map((x) => `반영하지 못한 요청: ${clip(x, 200)} — 대상 조문을 추가로 골라 다시 작성하세요.`),
      ...(draft.checks || []).map((x) => `AI 확인 요청: ${x}`),
      '상위 법령의 현행 조문과 시행일을 원문으로 다시 확인하세요.',
    ];
    const corrText = [...fix.corr.map((c) => `[${c.doc_title}] ${c.ref}${c.new_ref && c.new_ref !== c.ref ? `(→${c.new_ref})` : ''}\n  현행: ${c.before}\n  정정: ${c.after}${c.note ? `\n  ⚠ ${c.note}` : ''}`), ...fix.citing.map((c) => `[${c.doc_title || c.doc_id}] ${c.ref} — ${c.target} 인용(내용 확인)`)].join('\n\n') || '조 번호 이동·인용 정정 대상이 없습니다(같은 규정과 함께 조회한 규정 범위).';
    const title = doc.title;
    const sections = [
      { id: 'draft', title: '개정문', body: amendmentText(title, allChanges, { kind: '일부개정', moves: moveRanges(fix.map) }) },
      { id: 'comparison', title: '신구조문대비표', rows: buildComparison(allChanges) },
      // 개정 후 전문: 원 규정 전체에 수정안·인용 정정·조 번호 이동·이번 부칙을 반영
      { id: 'full_text', title: '개정 후 전문', body: consolidatedDoc({ doc, changes: allChanges, map: fix.map, addendaText: addendaDoc(draft.addenda, input.profile, regKind), normalize: normalizeArticle }) },
      ...(otherCorr.length ? [{ id: 'comparison_other', title: '다른 규정 정비 대비표(인용 정정)', rows: buildComparison(otherCorr.map((c) => ({ op: 'amend', ref: `${c.doc_title} ${c.ref}`, title: '', old: c.before, new: c.after }))) }] : []),
      { id: 'reason', title: '개정 이유서', body: reasonDoc('개정', draft.reason_summary, draft.main_points) },
      { id: 'addenda', title: '부칙', body: addendaDoc(draft.addenda, input.profile, regKind) },
      { id: 'notice', title: '예고문', body: noticeDoc({ profile: input.profile, regKind: regKind, title, kind: '일부개정', reasonSummary: draft.reason_summary, points: draft.main_points }) },
      { id: 'corrections', title: '인용 정정·영향 목록', body: corrText },
      ...(ca ? [{ id: 'ca_check', title: '단체협약 정합성', body: caTable(ca) }] : []),
      { id: 'checklist', title: '검토 체크리스트', body: checklistDoc(checks) },
      ...procedureDocs({ profile: input.profile, title, regKind, kind: '개정', reasonSummary: draft.reason_summary, points: draft.main_points, labor: !!consent || (LABOR.test(`${doc.title} ${intent}`) && (!isGovDoc || /공무직|근로자|기간제|청원경찰|환경관리원/.test(`${doc.title} ${intent}`))), adverse, consent: !!consent }),
    ];
    const ev = [{ label: `대상 규정 ${doc.inst || ''} ${title}`.trim(), doc_id: doc.doc_id, edition: editionLabel(doc) }, ...evidence.map((e) => ({ label: `[${e.id}] ${e.kind} ${e.label}`, doc_id: e.doc_id, ref: e.ref, edition: e.edition }))];
    s.note(`문서 ${sections.length}종 · 대비표 ${sections[1].rows.length}행`);
    try { ctx.metric?.('amend', { ops: changes.map((c) => c.op).join(','), absent_topic: !!absentTopic, sibling: !!sibling, evidence: evidence?.length ?? null, evidence_errors: errors?.length ?? null, review_applied: review?.applied?.length ?? null, review_rejected: review?.rejected?.length ?? null, review_remaining: review?.remaining?.length ?? null, dropped: draft.dropped?.length ?? 0, not_reflected: draft.not_reflected?.length ?? 0, checklist: checks.filter(Boolean).length, org_mismatch: !!orgMismatch, no_change: !!noChange, adverse_rule: adverseChanges(changes).length, adverse_ai: aiAdverse.length, consent: !!consent }); } catch { /* 지표는 작업을 막지 않는다 */ }
    return { sibling, no_change: noChange, consent, kind: '개정', moves: moveRanges(fix.map), docset: { kind: '일부개정', title, sections, evidence: ev }, changes: allChanges, corrections: fix.corr, citing: fix.citing, model: llm.config, doc: { doc_id: doc.doc_id, title, inst: doc.inst }, docKeys: [...sections.map((x) => x.id), 'evidence'] };
  });
}
