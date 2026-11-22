// 제정 흐름: 위임 조항 → 유사 규정 → 조문 체계(LLM·사람 확인) → 조문 초안(LLM) → 검증 → 문서 세트
import { selfReview } from './review.mjs';
import { keywords, clip, scoreArticle, lawNames } from '../lib/text.mjs';
import { extractCitations } from '../lib/refs.mjs';
import { buildComparison, amendmentText } from '../lib/table.mjs';
import { refOf } from '../lib/parse.mjs';
import { limit } from '../lib/llm.mjs';
import { caConflicts, caTable } from './ca-check.mjs';
import { outlinePrompt, enactChapterPrompt, enactMetaPrompt } from './prompts.mjs';
import { gatherEvidence, fail, editionLabel, upcomingChecks } from './common.mjs';
import { reasonDoc, addendaDoc, noticeDoc, checklistDoc, procedureDocs } from './docset.mjs';

const KINDS = ['규정', '규칙', '세칙', '지침', '요령', '훈령', '예규', '고시', '조례'];
const SANCTION = /(과태료|벌칙|벌금|징수|부과한다|금지한다|제한한다|박탈|징계한다)/;

// 결정적 검증: 조 번호 연속, 내부 인용 실재, 위임 없는 제재·의무 조항
// A1 위임 범위: 규율 대상(외부인/내부) → 기관 유형별로 위임이 필요한 조항만 판정
// 조례·고시가 의무를 지우는 바깥 사람들(주민·학생·보호자·소유자·영업자 등)도 외부인이다
const EXTERNAL = /(국민|주민|시민|군민|구민|도민|이용자|이용객|신청인|신청자|사업자|사업주|영업자|협력사|계약상대자|상대방|누구든지|민원인|방문객|입주자|입주민|거주자|참가자|수혜자|보조사업자|공급자|학생|보호자|학부모|소유자|점유자|운전자|법인|단체)/;
const INTERNAL = /(직원|임직원|근로자|소속|공단|공사|재단|진흥원|원장|이사장|부서장|기관장|임원|조합원|공무원)/;
const DUTY = /(하여야 한다|해야 한다|하여서는 아니 된다|해서는 아니 된다|금지|제한한다|제한할 수 있다|징수|과태료|벌칙|부과|취소할 수 있다|정지|박탈)/;
export function classifySubject(text) {
  const s = String(text || '');
  if (EXTERNAL.test(s)) return 'external';
  if (INTERNAL.test(s)) return 'internal';
  return 'none';
}
export async function checkDelegation(articles, delegations, llm, type = 'public-institution') {
  const res = articles.map((a) => {
    const subject = classifySubject(a.text), duty = DUTY.test(a.text);
    if (!duty || subject !== 'external') return { ref: a.ref, title: a.title, subject, verdict: 'internal', reason: !duty ? '의무·제한·제재 문구 없음' : '내부(직원 등) 대상 — 취업규칙·내부 사항(근로기준법 제93·94조 절차 확인)', basis_id: null, quote: null };
    if (!delegations.length) return { ref: a.ref, title: a.title, subject, verdict: 'needs_basis', reason: `외부인 대상 의무·제한 조항입니다. ${type === 'local-gov' ? '조례로 주민의 권리 제한·의무 부과를 하려면 법률의 위임이 필요합니다(지방자치법 제28조 제1항 단서).' : type === 'central-ministry' ? '행정규칙으로 외부에 의무를 지우려면 법령의 위임이 필요합니다.' : '설립 근거법·관계 법령의 위임 또는 이용 약관·계약 등 근거를 확인하세요.'}`, basis_id: null, quote: null };
    return { ref: a.ref, title: a.title, subject, verdict: 'unverified', reason: '위임 조항과 대조 필요(AI 미확인)', basis_id: null, quote: null };
  });
  const target = res.filter((r) => r.verdict === 'unverified');
  if (llm && target.length) {
    const ids = new Map(delegations.map((d) => [d.id, d.text]));
    try {
      const o = await llm.chatJson([{ role: 'system', content: '너는 법제 심사 담당자다. JSON 하나만 출력한다.' }, { role: 'user', content: JSON.stringify({ 과제: '각 조문이 위임 조항의 범위 안인지 판정한다. within 또는 exceeds. 근거 위임 ID와 위임 조항 원문에서 그대로 옮긴 구절(quote)을 반드시 단다.', 위임조항: delegations.map((d) => ({ id: d.id, 출처: d.label, 원문: d.text })), 조문: target.map((r) => ({ ref: r.ref, 본문: articles.find((a) => a.ref === r.ref).text })), 출력형식: { results: [{ ref: '제N조', verdict: 'within|exceeds', basis_id: 'D1', quote: '위임 원문 구절', reason: '한 문장' }] } }) }], (o) => { if (!Array.isArray(o.results)) throw new Error('results 없음'); return o; }, { maxTokens: 3000 });
      for (const x of o.results) {
        const r = target.find((t) => t.ref === x.ref); if (!r) continue;
        const src = ids.get(x.basis_id), q = String(x.quote || '').replace(/\s+/g, '');
        if (!['within', 'exceeds'].includes(x.verdict) || !src || q.length < 4 || !src.replace(/\s+/g, '').includes(q)) { r.reason = 'AI 판정의 근거 인용을 확인하지 못했습니다 — 담당자 확인 필요'; continue; }
        Object.assign(r, { verdict: x.verdict, basis_id: x.basis_id, quote: x.quote, reason: x.reason || '' });
      }
    } catch { /* 판정 실패: unverified 유지 */ }
  }
  return res;
}
const VERDICT = { within: '범위 안', exceeds: '범위 초과 의심', internal: '내부 사항', needs_basis: '근거 필요', unverified: '미확인' };
export const delegationTable = (rows) => rows.map((r) => `${r.ref}(${r.title || ''}) · 대상 ${{ external: '외부인', internal: '내부', none: '-' }[r.subject]} · ${VERDICT[r.verdict]}${r.basis_id ? ` · 근거 ${r.basis_id} 「${r.quote}」` : ''}\n  ${r.reason}`).join('\n');

export function checkDraft(articles, delegations) {
  const w = [], refs = new Set(articles.map((a) => a.ref));
  articles.forEach((a, i) => { if (a.ref !== refOf(i + 1, null)) w.push(`조 번호가 연속되지 않습니다: ${i + 1}번째 조문이 ${a.ref}입니다.`); });
  for (const a of articles) {
    for (const c of extractCitations(a.text)) if (c.kind === 'article' && !refs.has(refOf(c.no, c.sub))) w.push(`${a.ref}가 이 규정에 없는 ${refOf(c.no, c.sub)}를 인용합니다.`);
    if (SANCTION.test(a.text) && !delegations.length) w.push(`${a.ref}에 의무 부과·제재 문구가 있습니다. 상위 법령의 위임 근거를 확인하세요.`);
  }
  return [...new Set(w)];
}

export async function runEnact(ctx) {
  const { sources, llm } = ctx.deps, input = ctx.input, profile = input.profile || {};
  const kind = KINDS.includes(input.kind) ? input.kind : '규정';
  const title = String(input.title || '').trim(), purpose = String(input.purpose || '').trim();
  if (!title || title.length > 80 || !purpose || purpose.length > 2000) throw fail('bad_input', '제명(80자 이내)과 제정 목적(2,000자 이내)을 입력해 주세요.');
  if (!llm) throw fail('llm_missing', '모델이 설정되지 않아 조문 초안을 만들 수 없습니다. 상단 「모델 설정」(F12)에서 모델과 API 키를 지정하세요.');

  const delegations = await ctx.step('위임 조항 확인', async (s) => {
    const out = [];
    for (const d of (input.delegations || []).slice(0, 5)) {
      if (d.text) { out.push({ label: d.label || '직접 입력한 위임 조항', text: clip(d.text, 1500) }); continue; }
      const doc = await sources.loadDoc(d.doc_id);
      const a = doc.articles.find((x) => x.ref === d.ref && x.section === '본칙');
      if (!a) throw fail('unknown_ref', `${doc.title}에서 ${d.ref}를 찾지 못했습니다.`);
      out.push({ label: `${doc.title} ${a.ref}(${a.title})`, text: clip(a.body, 1500), doc_id: doc.doc_id, ref: a.ref, edition: editionLabel(doc) });
      const def = doc.articles.find((x) => x.section === '본칙' && /정의/.test(x.title));
      if (def && def.ref !== a.ref) out.push({ label: `${doc.title} ${def.ref}(${def.title})`, text: clip(def.body, 900), doc_id: doc.doc_id, ref: def.ref, edition: editionLabel(doc) });
    }
    if (!out.length && !input.auto) {
      // 위임 조항을 모르면 후보를 찾아 고르게 한다
      const names = lawNames(purpose); let cands = [];
      try {
        const r = await sources.rest.search({ keyword: keywords(purpose).slice(0, 3).join(' '), corpus: 'legal', hybrid: true, limit: 6 });
        cands = r.rows.map((x) => ({ label: `${x.doc_title} ${x.art_ref}(${x.art_title || ''})`, text: clip(x.body, 1500), doc_id: x.doc_id, ref: x.art_ref, edition: editionLabel(x) }));
      } catch { ctx.log('ALIO 법령 검색 실패'); }
      if (names.length && sources.lawGo?.enabled) {
        try { const r = await sources.searchLaw(names[0], { targets: ['law'], limit: 1 }); const hit = r.rows.find((x) => x.source === '법제처'); if (hit) { const doc = await sources.loadDoc(hit.doc_id); const kw = keywords(purpose); doc.articles.map((a) => [scoreArticle(a, kw), a]).filter(([sc]) => sc > 0).sort((a, b) => b[0] - a[0]).slice(0, 4).forEach(([, a]) => cands.push({ label: `${doc.title} ${a.ref}(${a.title})`, text: clip(a.body, 1500), doc_id: doc.doc_id, ref: a.ref, edition: '현행' })); } } catch { ctx.log('법제처 조회 실패'); }
      }
      if (cands.length) {
        const pick = await ctx.gate({ id: 'pick_delegation', prompt: '위임 근거가 되는 상위 법령 조항을 고르세요(없으면 모두 해제).', multi: true, options: cands.map((c, i) => ({ doc_id: c.doc_id, ref: c.ref, value: String(i), label: c.label, detail: clip(c.text, 200), checked: false })) });
        for (const i of [].concat(pick || [])) if (cands[+i]) out.push(cands[+i]);
      }
    }
    out.forEach((d, i) => { d.id = `D${i + 1}`; });
    s.note(out.length ? out.map((d) => `[${d.id}] ${d.label}`).join('\n') : '위임 조항 없음 — 기관 내부 사항으로 작성합니다(의무 부과·제재 조항은 경고).');
    s.evidence(out.map((d) => ({ label: `[${d.id}] ${d.label}`, doc_id: d.doc_id || '직접 입력', ref: d.ref, edition: d.edition })));
    return out;
  });

  const { evidence, errors, tocs } = await ctx.step('유사 규정 조사', async (s) => {
    const targets = profile.type === 'local-gov' ? ['ordin'] : profile.type === 'central-ministry' ? ['admrul'] : ['law'];
    const r = await gatherEvidence(ctx.deps, { orgType: profile.type || null, query: `${title} ${purpose}`, regLimit: 5, lawLimit: 2, lawTargets: targets, useLawGo: profile.type === 'local-gov' || profile.type === 'central-ministry' });
    let ev = r.evidence;
    if (!input.auto && ev.length) {
      const keep = await ctx.gate({ id: 'pick_similar', prompt: '참고할 유사 규정·법령을 확인하세요.', multi: true, options: ev.map((e) => ({ doc_id: e.doc_id, ref: e.ref, value: e.id, label: `[${e.id}] ${e.kind} · ${e.label}`, detail: clip(e.text, 200), checked: true })) });
      const set = new Set([].concat(keep || [])); ev = ev.filter((e) => set.has(e.id));
    }
    // 유사 규정 문서의 목차(최대 3개)를 조문 체계 참고로 쓴다
    const tocs = [];
    for (const id of [...new Set(ev.filter((e) => /^(bylaws|law):/.test(e.doc_id)).map((e) => e.doc_id))].slice(0, 3)) {
      try { const d = await sources.loadDoc(id); tocs.push({ 출처: `${d.inst || ''} ${d.title}`.trim(), 목차: d.articles.filter((a) => a.section === '본칙' && a.ref).slice(0, 40).map((a) => `${a.ref} ${a.title}`) }); } catch { /* 개별 실패 무시 */ }
    }
    s.note(`근거 ${ev.length}건 · 참고 목차 ${tocs.length}개${r.errors.length ? ` · ⚠ ${r.errors.join('·')} 조회 실패` : ''}`);
    s.evidence(ev.map((e) => ({ label: `[${e.id}] ${e.kind} · ${e.label}`, doc_id: e.doc_id, ref: e.ref, edition: e.edition })));
    return { evidence: ev, errors: r.errors, tocs };
  });
  const basisIds = new Set([...delegations.map((d) => d.id), ...evidence.map((e) => e.id)]);
  const checkIds = (ids, where) => { const bad = (ids || []).filter((x) => !basisIds.has(x)); if (bad.length) throw new Error(`${where}의 근거 ID ${bad.join(',')} 는 제공된 근거에 없습니다.`); };

  let outline = await ctx.step('조문 체계 설계', async (s) => {
    if (!llm) throw fail('llm_missing', '모델이 설정되지 않아 조문 체계를 만들 수 없습니다. 상단 「모델 설정」에서 모델과 API 키를 지정하세요.');
    const t0 = Date.now();
    const o = await llm.chatJson(outlinePrompt({ kind, title, purpose, delegations, evidence, similarTocs: tocs, profile }), (o) => {
      if (!Array.isArray(o.chapters) || !o.chapters.length) throw new Error('chapters 가 비었습니다.');
      if (o.chapters.some((c) => !c || !Array.isArray(c.articles) || !c.articles.length)) throw new Error('각 장에는 articles 배열이 있어야 합니다.');
      const arts = o.chapters.flatMap((c) => c.articles);
      if (arts.length < 2 || arts.length > 40) throw new Error('조문 수는 2~40개여야 합니다.');
      // 시행일·경과조치·적용례는 부칙 사항이므로 본칙 체계에서 뺀다
      for (const c of o.chapters) c.articles = c.articles.filter((a) => !/^(시행일|경과조치|적용례|유효기간|시행일\s*및\s*경과조치)$/.test(String(a.title || '').trim()));
      o.chapters = o.chapters.filter((c) => c.articles.length);
      let n = 0; for (const c of o.chapters) for (const a of c.articles) { a.ref = refOf(++n, null); if (!a.title) throw new Error(`${a.ref} 제목이 없습니다.`); if (!Array.isArray(a.basis_ids)) a.basis_ids = []; a.basis_ids = a.basis_ids.filter((x) => basisIds.has(x)); }
      if (n < 2) throw new Error('본칙 조문이 2개 이상이어야 합니다.');
      return o;
    }, { maxTokens: 4000 });
    const n = o.chapters.reduce((k, c) => k + c.articles.length, 0);
    s.note(`${o.chapters.length}개 장 · ${n}개 조 · ${llm.config.model} · ${((Date.now() - t0) / 1000).toFixed(1)}초\n${o.chapters.map((c) => `${c.title}: ${c.articles.map((a) => `${a.ref} ${a.title}`).join(', ')}`).join('\n')}`);
    return o;
  });
  if (!input.auto) {
    const all = outline.chapters.flatMap((c) => c.articles.map((a) => ({ ...a, chapter: c.title })));
    const keep = await ctx.gate({ id: 'edit_outline', prompt: '조문 체계를 확인하세요. 뺄 조문은 체크를 해제하세요(번호는 다시 매깁니다).', multi: true, options: all.map((a) => ({ value: a.ref, label: `${a.chapter} · ${a.ref}(${a.title})`, detail: a.summary || '', checked: true })) });
    const set = new Set([].concat(keep || [])); let n = 0;
    outline = { chapters: outline.chapters.map((c) => ({ title: c.title, articles: c.articles.filter((a) => set.has(a.ref)).map((a) => ({ ...a, ref: refOf(++n, null) })) })).filter((c) => c.articles.length) };
    if (!n) throw fail('empty_outline', '남은 조문이 없습니다.');
  }
  const planned = outline.chapters.flatMap((c) => c.articles.map((a) => ({ ...a, chapter: c.title })));

  const related = [];
  for (const id of (input.related_doc_ids || []).slice(0, 3)) { try { related.push(await sources.loadDoc(id)); } catch { ctx.log(`기존 규정 ${id} 를 불러오지 못했습니다.`); } }

  const draft = await ctx.step('조문 초안 작성', async (s) => {
    if (!llm) throw fail('llm_missing', '모델이 설정되지 않았습니다.');
    const relRefs = new Map(related.map((d) => [d.doc_id, new Set(d.articles.filter((a) => a.section === '본칙').map((a) => a.ref))]));
    const t0 = Date.now(); let doneCh = 0;
    // 장별로 동시에 작성하고(대기 시간 단축), 이유·부칙은 별도 짧은 호출로 동시에 만든다
    const run = limit(+(ctx.deps.env?.LLM_PARALLEL) || 2);
    const chapterJobs = outline.chapters.map((ch) => run(() => llm.chatJson(enactChapterPrompt({ kind, title, purpose, delegations, evidence, outline, chapter: ch, profile }), (o) => {
      if (!Array.isArray(o.articles) || o.articles.length !== ch.articles.length) throw new Error(`이 장의 articles 는 ${ch.articles.length}개여야 합니다.`);
      o.articles.forEach((a, i) => {
        a.ref = ch.articles[i].ref; // 장별 응답의 번호는 쓰지 않고 체계의 번호를 붙인다
        if (typeof a.text !== 'string' || !a.text.trim()) { a.text = '(본문 작성 필요 — 모델이 비워 둔 조문입니다)'; a.empty = true; }
        a.title = a.title || ch.articles[i].title; if (!Array.isArray(a.basis_ids)) a.basis_ids = []; checkIds(a.basis_ids, a.ref);
      });
      return o;
    }, { maxTokens: 5000 })).then((o) => { s.note(`장별 작성 ${++doneCh}/${outline.chapters.length} · ${((Date.now() - t0) / 1000).toFixed(0)}초`); return o; }));
    const metaJob = run(() => llm.chatJson(enactMetaPrompt({ kind, title, purpose, delegations, outline, related, profile }), (o) => {
      if (typeof o.reason_summary !== 'string') throw new Error('reason_summary 가 없습니다.');
      o.other_amendments = (Array.isArray(o.other_amendments) ? o.other_amendments : []).filter((x) => relRefs.get(x.doc_id)?.has(x.ref) && typeof x.new_text === 'string' && x.new_text.trim());
      return o;
    }, { maxTokens: 3000 }));
    const [chapters, meta] = await Promise.all([Promise.all(chapterJobs), metaJob]);
    const o = { ...meta, articles: chapters.flatMap((c) => c.articles) };
    s.note(`${o.articles.length}개 조(${outline.chapters.length}개 장 동시 작성) · 기존 규정 정비 ${o.other_amendments.length}건 · ${llm.config.model} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
    return o;
  });

  // 자체 검토: 없는 법령명·기관 유형에 맞지 않는 법령, 조문끼리 모순·중복, 목적·위임 범위 밖 내용을 찾아 고친다
  const review = await ctx.step('자체 검토', async (s) => {
    const items = draft.articles.filter((a) => !a.empty).map((a) => ({ ref: a.ref, title: a.title, text: a.text }));
    const r = await selfReview({ llm, sources, items, intent: `제명: ${title}\n제정 목적: ${purpose}`, evidence: [...delegations.map((d) => ({ id: d.id, label: d.label, text: d.text })), ...evidence].slice(0, 6), docText: '', profile, kind: '제정' });
    for (const a of draft.articles) { const t = r.fixed.get(a.ref); if (t) a.text = t; }
    s.note(`코드가 찾은 문제 ${r.found.length}건 · 모델 검토로 고친 조문 ${r.applied.length}개${r.remaining.length ? ` · 남은 문제 ${r.remaining.length}건(체크리스트)` : ''}`);
    return r;
  });

  const { warnings, deleg } = await ctx.step('검증', async (s) => {
    const w = checkDraft(draft.articles, delegations).filter((x) => !/상위 법령의 위임 근거를 확인하세요/.test(x));
    const deleg = await checkDelegation(draft.articles, delegations, llm, profile.type || 'public-institution');
    const c = (v) => deleg.filter((d) => d.verdict === v).length;
    s.note(`${w.length ? w.join('\n') + '\n' : '조 번호 연속·내부 인용 검사 통과\n'}위임 범위: 범위 안 ${c('within')} · 초과 의심 ${c('exceeds')} · 근거 필요 ${c('needs_basis')} · 미확인 ${c('unverified')} · 내부 사항 ${c('internal')}`);
    return { warnings: w, deleg };
  });

  return ctx.step('문서 세트 작성', async (s) => {
    const arts = draft.articles.map((a, i) => ({ op: 'insert', ref: a.ref, title: a.title, old: '', new: a.text.replace(/\n{2,}/g, '\n').trim(), chapter: planned[i].chapter }));
    let lastCh = null; const lines = [title, ''];
    for (const a of arts) { if (a.chapter && a.chapter !== lastCh) { lines.push(a.chapter); lastCh = a.chapter; } lines.push(`${a.ref}(${a.title}) ${a.new}`); }
    lines.push('', addendaDoc(draft.addenda, profile, kind));
    const other = draft.other_amendments.map((x) => { const d = related.find((r) => r.doc_id === x.doc_id), a = d.articles.find((y) => y.ref === x.ref && y.section === '본칙'); return { op: 'amend', ref: `${d.title} ${x.ref}`, title: a.title, old: a.body, new: x.new_text.trim(), doc: d, aref: x.ref }; });
    const otherText = other.length ? ['', '제2조(다른 규정의 개정) ' + other.map((o) => amendmentText(o.doc.title, [{ ...o, ref: o.aref }]).replace(/\n+/g, ' ')).join(' ')] : [];
    let ca = null;
    if (profile.alio_inst) { ca = { rows: [], errors: [], searched: false, ca: null }; for (const a of draft.articles.filter((x) => /\d+\s*(일|개월|시간|%|원)/.test(x.text)).slice(0, 3)) { const r = await caConflicts(sources, { inst: profile.alio_inst, topic: a.title, items: [{ ref: a.ref, text: a.text }] }); ca.rows.push(...r.rows); ca.errors.push(...r.errors); ca.searched ||= r.searched; ca.ca ||= r.ca; ca.ca_exists ||= r.ca_exists; } }
    const checks = [
      ...upcomingChecks(evidence),
      ...review.remaining.map((x) => `자체 검토 후 남은 문제 — ${x}`),
      ...review.applied.map((x) => `자체 검토로 고친 점(대조 확인) — ${x.ref}: ${x.problem}`),
      ...draft.articles.filter((a) => a.empty).map((a) => `${a.ref}(${a.title}): 모델이 본문을 비워 두었습니다. 직접 작성하세요.`),
      ...(ca?.rows || []).map((x) => `${x.ref}: 단체협약(${x.ca_values.join(', ')})과 값이 다릅니다 — 근로기준법 제96조 확인`),
      ...warnings,
      ...deleg.filter((d) => ['exceeds', 'needs_basis', 'unverified'].includes(d.verdict)).map((d) => `${d.ref}: 위임 범위 ${VERDICT[d.verdict]} — ${d.reason}`),
      delegations.length ? null : '위임 근거 없이 작성했습니다. 기관 내부 사항인지, 상위 법령 위임이 필요한지 확인하세요.',
      errors.length ? `근거 조사 일부 실패(${errors.join('·')}) — 다시 조회하세요.` : null,
      ...draft.articles.filter((a) => !a.basis_ids?.length).map((a) => `${a.ref}(${a.title}): 근거 ID가 없습니다. 기관 실정에 맞는지 검토하세요.`),
      ...(draft.checks || []).map((x) => `AI 확인 요청: ${x}`),
      '유사 기관 규정은 참고 사례이며 우리 기관 적용 근거가 아닙니다.',
      '정의 조항의 용어가 본문 전체에 일관되게 쓰였는지 확인하세요.',
    ];
    const sections = [
      { id: 'draft', title: `${kind} 제정안`, body: [...lines, ...otherText].join('\n') },
      { id: 'comparison', title: '제정안 조문표', heads: ['현 행', '제 정 안'], rows: buildComparison(arts) },
      ...(other.length ? [{ id: 'comparison_other', title: '다른 규정 정비 대비표(부칙)', rows: buildComparison(other) }] : []),
      { id: 'delegation_review', title: '위임 범위 검토표', body: `조문별 규율 대상과 상위법 위임 범위 판정입니다(외부인 대상 의무·제한 조항만 판정, AI 판정은 위임 원문 인용을 서버가 확인).\n\n${delegationTable(deleg)}` },
      { id: 'reason', title: '제정 이유서', body: reasonDoc('제정', draft.reason_summary, draft.main_points) },
      { id: 'addenda', title: '부칙', body: addendaDoc(draft.addenda, profile, kind) + (other.length ? `\n${otherText.join('\n').trim()}` : '') },
      { id: 'notice', title: '예고문', body: noticeDoc({ profile, regKind: kind, title, kind: '제정', reasonSummary: draft.reason_summary, points: draft.main_points }) },
      ...(ca ? [{ id: 'ca_check', title: '단체협약 정합성', body: caTable(ca) }] : []),
      { id: 'checklist', title: '검토 체크리스트', body: checklistDoc(checks) },
      ...procedureDocs({ profile, title, regKind: kind, kind: '제정', reasonSummary: draft.reason_summary, points: draft.main_points, labor: /(복무|휴가|근무|보수|임금|징계|취업|인사|근로|괴롭힘)/.test(`${title} ${purpose}`) }),
    ];
    const ev = [...delegations.map((d) => ({ label: `[${d.id}] 위임 조항 ${d.label}`, doc_id: d.doc_id || '직접 입력', ref: d.ref, edition: d.edition })), ...evidence.map((e) => ({ label: `[${e.id}] ${e.kind} ${e.label}`, doc_id: e.doc_id, ref: e.ref, edition: e.edition }))];
    s.note(`문서 ${sections.length}종 · ${arts.length}개 조`);
    return { kind: '제정', docset: { kind: '제정', title, sections, evidence: ev }, articles: arts, changes: arts, model: llm.config, docKeys: [...sections.map((x) => x.id), 'evidence'] };
  });
}
