// 대화형 에이전트가 쓰는 도구(허용 목록). 각 도구는 결정적 함수이거나 기존 흐름(개정·제정 등)을 그대로 호출한다.
import { findCiting } from '../lib/refs.mjs';
import { clip, keywords, scoreArticle, fixTypos } from '../lib/text.mjs';
import { instIn } from '../lib/orgs.mjs';
// 요청과 관련 있는 실제 조문 번호(모델이 조문 번호를 지어내지 않게 관찰에 넣는다)
const nearRefs = (doc, q, n = 5) => { const kw = keywords(q); return (doc?.articles || []).filter((x) => x.section === '본칙' && x.ref).map((x) => [scoreArticle(x, kw), x]).filter(([sc]) => sc > 0).sort((p, q2) => q2[0] - p[0]).slice(0, n).map(([, x]) => `${x.ref}(${x.title})`); };
import { gatherEvidence, editionLabel, fail } from './common.mjs';
import { nextProcedure, DOC_LABELS } from './procedure.mjs';
import { runAmend } from './amend.mjs';
import { runEnact } from './enact.mjs';
import { lawVersions } from './lawversions.mjs';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
// 모델이 준 조문 번호 중 형식이 맞고 실제 본칙에 있는 것만 남긴다
export function cleanRefs(refs, doc) {
  if (!Array.isArray(refs)) return undefined;
  const have = new Set((doc?.articles || []).filter((a) => a.section === '본칙' && a.ref).map((a) => a.ref));
  const out = refs.map((r) => String(r).replace(/\s+/g, '')).filter((r) => /^제\d+조(의\d+)?$/.test(r) && have.has(r)).slice(0, 5);
  return out.length ? out : undefined;
}
const sub = (ctx, input) => ({ ...ctx, input: { ...input, profile: ctx.input.profile } });

import { govTarget } from './common.mjs';
export const TOOLS = {
  search_regulations: {
    desc: '기관 내규(ALIO) 검색. 기관명·규정명/주제로 문서 후보를 찾는다.', args: { inst: '기관명 일부', keyword: '규정명 또는 주제' },
    async run(a, deps, st, ctx) {
      // 모델이 기관명과 규정명을 한 칸(query)에 넣어도 기관을 갈라 낸다(「창업진흥원 취업규칙」→ 기관 창업진흥원·규정명 취업규칙)
      const q = str(a.keyword || a.query || a.topic, 100), found = !str(a.inst, 60) && (instIn(q) || instIn(ctx?.input?.message || ''));
      const inst = str(a.inst, 60) || found || deps.profile?.alio_inst || undefined;
      const keyword = found ? q.replace(found, '').trim() || q : q;
      // 지자체·부처: 법제처 자치법규·행정규칙에서 우리 기관 규정을 찾는다
      const gt = govTarget(deps.profile?.type);
      if (gt && deps.sources.gov?.enabled) {
        const org = str(a.inst, 60) || (/^예시 /.test(deps.profile?.name || '') ? '' : deps.profile?.name) || '';
        const rows = org ? await deps.sources.gov.orgDocs({ target: gt, org, pages: 1, extra: keyword }) : await deps.sources.gov.search({ target: gt, keyword: keyword || '복무', body: false, pages: 1 });
        st.candidates = rows.slice(0, 8);
        if (!st.candidates.length) return { summary: `법제처 ${gt === 'ordin' ? '자치법규' : '행정규칙'}에서 결과 없음` };
        return { summary: `${st.candidates.length}개 문서(법제처): ${st.candidates.slice(0, 4).map((x) => `${x.inst_name} 「${x.doc_title}」`).join(', ')}` };
      }
      const r = await deps.sources.searchRegs({ keyword: keyword || '목적', inst, corpus: 'bylaws', limit: 40, hybrid: !!keyword || undefined });
      const seen = new Map(); for (const x of r.rows) if (!seen.has(x.doc_id)) seen.set(x.doc_id, x);
      // 제명에 규정명이 든 문서를 앞으로(「취업규칙」을 찾는데 본문만 맞은 다른 규정이 1순위가 되지 않게)
      // 요청에 적힌 규정 이름(「취업규칙」「여비규정」 등)과 제명이 맞는 문서를 맨 앞에 — 주제어가 섞여도 다른 규정으로 바뀌지 않게
      const fl = (t) => String(t || '').replace(/\s+/g, ''), names = [...new Set(`${keyword} ${ctx?.input?.message || ''}`.match(/[가-힣·]{2,30}(?:규정|규칙|지침|세칙|요령|내규|기준|준칙)/g) || [])].map((n) => fl(n).replace(new RegExp(`^${fl(inst || '')}`), '')).filter((n) => n.length >= 3);
      const fq = fl(keyword), hit = (x) => { const t = fl(x.doc_title); return names.some((n) => t === n || t.endsWith(n)) ? 0 : fq && t.includes(fq) ? 1 : 2; };
      st.candidates = [...seen.values()].sort((x, y) => hit(x) - hit(y)).slice(0, 8);
      if (!st.candidates.length) return { summary: r.degraded ? '검색 일부 실패로 결과 없음(없다는 뜻 아님)' : '결과 없음' };
      return { summary: `${st.candidates.length}개 문서: ${st.candidates.slice(0, 4).map((x) => `${x.inst_name} 「${x.doc_title}」`).join(', ')}` };
    },
  },
  load_document: {
    desc: '규정 원문 전체를 불러온다. doc_id 를 주거나 pick:"top"(검색 1순위) 또는 pick:"ask"(사용자 선택).', args: { doc_id: '문서 ID(선택)', pick: 'top|ask' },
    async run(a, deps, st, ctx) {
      let id = str(a.doc_id, 1500) || ctx.input.doc_id || null;
      if (!id && st.candidates?.length) {
        if (st.candidates.length > 1 && a.pick !== 'top' && !ctx.input.auto) {
          id = await ctx.gate({ id: 'pick_doc', prompt: '어느 규정을 대상으로 할까요?', options: st.candidates.slice(0, 6).map((x, i) => ({ doc_id: x.doc_id, ref: x.art_ref || null, value: x.doc_id, label: `${x.inst_name} 「${x.doc_title}」`, detail: `${x.doc_type || ''} · ${x.effective_from || ''} · 일치: ${x.art_ref || ''} ${x.art_title || ''}`, checked: i === 0 })) });
        } else id = st.candidates[0].doc_id;
      }
      if (!id) throw fail('no_doc', '대상 규정을 찾지 못했습니다. 기관명·규정명을 알려 주세요.');
      st.doc = await deps.sources.loadDoc(id);
      const n = st.doc.articles.filter((x) => x.section === '본칙' && x.ref).length;
      const near = nearRefs(st.doc, `${st.params?.topic || ''} ${ctx?.input?.message || ''}`);
      return { summary: `${st.doc.inst ? st.doc.inst + ' ' : ''}「${st.doc.title}」 본칙 ${n}개 조문 (${editionLabel(st.doc)})${st.doc.edition?.warning ? ' ⚠ ' + st.doc.edition.warning : ''} · 요청과 관련 있는 조문: ${near.join(', ') || '없음(이 규정에 해당 주제 조문이 없을 수 있음)'}` };
    },
  },
  get_article: {
    desc: '불러온 규정의 특정 조문 전문을 본다.', args: { ref: '제N조' },
    async run(a, deps, st, ctx) {
      const art = st.doc?.articles.find((x) => x.ref === str(a.ref, 20) && x.section === '본칙');
      if (!art) return { summary: `${a.ref || '?'} 조문은 이 규정에 없습니다. 요청과 관련 있는 실제 조문: ${nearRefs(st.doc, `${st.params?.topic || ''} ${ctx?.input?.message || ''}`).join(', ') || '없음'}` };
      return { summary: `${art.ref}(${art.title}) ${clip(art.body, 300)}` };
    },
  },
  search_law: {
    desc: '상위 법령·행정규칙·자치법규 검색(ALIO 법령 + 법제처).', args: { query: '법령명 또는 주제', targets: '["law","admrul","ordin"] 중' },
    async run(a, deps, st) {
      const targets = Array.isArray(a.targets) ? a.targets.filter((t) => ['law', 'admrul', 'ordin'].includes(t)) : ['law'];
      const r = await deps.sources.searchLaw(fixTypos(str(a.query, 100)) || '법', { targets: targets.length ? targets : ['law'], limit: 5 });
      st.laws = r.rows;
      return { summary: r.rows.length ? r.rows.slice(0, 5).map((x) => `${x.source} ${x.title}`).join(', ') : `결과 없음${r.errors.length ? `(${r.errors.join('·')} 조회 실패)` : ''}` };
    },
  },
  find_citations: {
    desc: '불러온 규정에서 특정 조문을 인용하는 다른 조문을 찾는다.', args: { ref: '제N조' },
    async run(a, deps, st) {
      if (!st.doc) return { summary: '먼저 규정을 불러와야 합니다.' };
      const hits = findCiting([st.doc], { doc_id: st.doc.doc_id, ref: str(a.ref, 20) });
      return { summary: hits.length ? `${a.ref}를 인용하는 조문: ${hits.map((h) => h.ref).join(', ')}` : `${a.ref}를 인용하는 조문 없음(이 규정 안)` };
    },
  },
  compare_versions: {
    desc: '불러온 규정의 이전 판본과 조문 수·변경 조문을 비교한다.', args: {},
    async run(a, deps, st) {
      if (!st.doc?.inst) return { summary: 'ALIO 규정을 불러와야 판본을 비교할 수 있습니다.' };
      const r = await deps.sources.searchRegs({ keyword: '목적', inst: st.doc.inst, corpus: 'bylaws', all_versions: true, limit: 50 });
      const prev = r.rows.filter((x) => x.doc_title === st.doc.title && x.doc_id !== st.doc.doc_id).sort((x, y) => String(y.doc_date).localeCompare(String(x.doc_date)))[0];
      if (!prev) return { summary: '비교할 이전 판본이 없습니다.' };
      const old = await deps.sources.loadDoc(prev.doc_id), body = new Map(old.articles.filter((x) => x.section === '본칙').map((x) => [x.ref, x.body]));
      const changed = st.doc.articles.filter((x) => x.section === '본칙' && x.ref && body.get(x.ref) !== x.body).map((x) => x.ref);
      return { summary: `이전 판본(${prev.doc_date}) 대비 바뀌거나 새로 생긴 조문 ${changed.length}개: ${changed.slice(0, 10).join(', ')}` };
    },
  },
  find_similar: {
    desc: '같은 주제의 다른 기관 규정과 관련 법령을 찾는다.', args: { topic: '주제' },
    async run(a, deps, st) {
      const r = await gatherEvidence(deps, { query: str(a.topic, 200) || st.params?.topic || '규정', excludeDocId: st.doc?.doc_id, regLimit: 5, lawLimit: 2 });
      st.similar = r.evidence;
      return { summary: `${r.evidence.length}건: ${r.evidence.slice(0, 4).map((e) => e.label).join(', ')}${r.errors.length ? ` · ⚠ ${r.errors.join('·')} 조회 실패` : ''}` };
    },
  },
  draft_amendment: {
    desc: '불러온 규정에 대해 개정 의도로 수정안·대비표·이유서·부칙·예고문을 만든다(사람 확인 포함).', args: { intent: '개정 의도', refs: '불러온 규정에 실제로 있는 조문 번호 배열(load_document·get_article 결과에 나온 번호만, 모르면 생략 — 개정 흐름이 찾음)' },
    async run(a, deps, st, ctx) {
      const doc_id = st.doc?.doc_id || ctx.input.doc_id;
      if (!doc_id) throw fail('no_doc', '개정할 규정을 먼저 불러와야 합니다.');
      st.result = await runAmend(sub(ctx, { doc_id, intent: str(a.intent, 2000) || st.params?.intent || ctx.input.message, refs: cleanRefs(a.refs, st.doc), extraDocIds: ctx.input.extraDocIds, auto: ctx.input.auto }));
      const sib = st.result.sibling;
      return { summary: `개정 문서 세트 완성: 변경 ${st.result.changes.length}건, 인용 정정 ${st.result.corrections.length}건${sib ? ` · ⚠ 이 규정에는 해당 조문이 없어 새로 만들었고, 같은 기관 「${sib.title}」 ${sib.ref}(${sib.art_title})에 이미 같은 주제가 있음 — 사용자에게 알릴 것` : ''}` };
    },
  },
  draft_enactment: {
    desc: '새 규정의 조문 체계와 표준 조문 초안, 제정 문서 세트를 만든다(사람 확인 포함).', args: { title: '제명', purpose: '제정 목적', kind: '규정|지침|조례 등' },
    async run(a, deps, st, ctx) {
      const title = str(a.title, 80) || st.params?.title, purpose = str(a.purpose, 2000) || st.params?.purpose || ctx.input.message;
      if (!title) throw fail('no_title', '제정할 규정의 제명이 필요합니다.');
      st.result = await runEnact(sub(ctx, { title, purpose, kind: str(a.kind, 10) || st.params?.kind || '지침', delegations: [], auto: ctx.input.auto }));
      return { summary: `제정 문서 세트 완성: ${st.result.articles.length}개 조` };
    },
  },
  analyze_impact: {
    desc: '상위 법령 개정으로 영향받는 기관 규정 조문을 찾아 개정 후보를 판정한다. 법령명과 조문 번호(ref)를 주면 판본 연혁에서 개정 전·후를 자동으로 가져온다.', args: { law_name: '법령명', ref: '제N조(선택)', before_text: '개정 전 문구(선택)', after_text: '개정 후 문구(선택)', topic: '주제', inst: '기관명(선택)' },
    async run(a, deps, st, ctx) {
      const run = deps.flows?.impact;
      if (!run) return { summary: '상위법 영향 기능이 연결되어 있지 않습니다.' };
      let before = str(a.before_text, 3000), after = str(a.after_text, 3000), note = '';
      const ref = str(a.ref, 20).replace(/\s/g, '');
      if ((!before || !after) && ref && (a.law_name || st.params?.law_name)) {
        const v = await lawVersions(deps.sources, { name: str(a.law_name, 80) || st.params.law_name, ref, topic: str(a.topic, 60) });
        if (v.before && v.after) { before = v.before.text; after = v.after.text; note = ` (판본 ${v.before.effective_from} → ${v.after.effective_from})`; }
      }
      const r = await run(sub(ctx, { law_name: str(a.law_name, 80) || st.params?.law_name, before: { text: before || '-' }, after: { text: after || str(ctx.input.message, 2000) }, topic: str(a.topic, 100) || st.params?.topic, org_type: deps.profile?.type, scope: { inst: str(a.inst, 60) || undefined }, auto: true }));
      st.impact = r;
      const c = r.candidates.filter((x) => x.status === 'candidate');
      return { summary: `개정 후보 ${c.length}건${note}: ${c.slice(0, 4).map((x) => `${x.inst} ${x.ref}`).join(', ')}` };
    },
  },
  build_comparison_table: {
    desc: '찾은 유사 규정을 기관별 비교표로 정리한다.', args: {},
    async run(a, deps, st) {
      if (st.result?.docset) return { summary: '신구조문대비표는 문서 세트에 포함되어 있습니다.' };
      if (!st.similar?.length) return { summary: '먼저 유사 규정을 찾아야 합니다.' };
      st.table = st.similar.filter((e) => e.kind === '유사 규정').map((e) => ({ inst: e.inst, label: e.label, excerpt: clip(e.text, 200), edition: e.edition }));
      return { summary: `비교표 ${st.table.length}행` };
    },
  },
  check_regulation: {
    desc: '불러온 규정의 인용 오류·용어 혼용·충돌 후보를 점검한다.', args: {},
    async run(a, deps, st, ctx) {
      const run = deps.flows?.check;
      if (!run) return { summary: '규정 점검 기능이 연결되어 있지 않습니다.' };
      if (!st.doc) throw fail('no_doc', '점검할 규정을 먼저 불러와야 합니다.');
      st.check = await run(sub(ctx, { doc_ids: [st.doc.doc_id], auto: true }));
      return { summary: `점검 후보 ${st.check.findings.length}건` };
    },
  },
  procedure_next: {
    desc: '기관 유형별 제·개정 절차에서 지금 단계와 다음 할 일, 준비된 문서를 알려 준다.', args: {},
    async run(a, deps, st) {
      const t = deps.procedures?.[deps.profile?.type || 'public-institution'];
      if (!t) return { summary: '절차 템플릿이 없습니다.' };
      const docs = new Set(st.result?.docKeys || []);
      const done = new Set(docs.has('draft') ? ['draft'] : []);
      const n = nextProcedure(t, done, docs);
      const s = n.current ? `다음 단계: ${n.current.title} — ${n.current.todo.slice(0, 2).join(', ')}${n.missingDocs.length ? ` · 준비할 문서: ${n.missingDocs.map((d) => DOC_LABELS[d]).join(', ')}` : ' · 필요한 문서 준비됨'}` : '모든 단계 완료';
      st.suggestions.push(s);
      return { summary: s };
    },
  },
  ask_user: {
    desc: '판단이 필요할 때 사용자에게 묻는다(선택지 2~6개).', args: { question: '질문', options: '["선택지"]' },
    async run(a, deps, st, ctx) {
      // 규정을 불러온 뒤 「조문 번호를 알려 달라」는 질문은 묻지 않는다 — 개정 흐름이 조문을 찾고 없으면 새 조문으로 둔다
      if (st.doc && /조문\s*번호|몇\s*조|어느\s*조|해당\s*조(?:문|항)/.test(String(a.question || ''))) return { summary: '조문 번호는 묻지 않습니다. draft_amendment 를 refs 없이 실행하면 개정 흐름이 대상 조문을 찾고, 없으면 새 조문으로 둡니다.' };
      const opts = (Array.isArray(a.options) ? a.options : []).map((o) => str(String(o), 100)).filter(Boolean).slice(0, 6);
      const v = await ctx.gate({ id: `ask_${Date.now()}`, prompt: str(a.question, 200) || '확인해 주세요.', options: (opts.length ? opts : ['예', '아니요']).map((o, i) => ({ value: o, label: o, checked: i === 0 })) });
      st.answers.push(v);
      return { summary: `사용자 답: ${v}` };
    },
  },
  bulk_amend: {
    desc: '기관 여러 규정의 같은 낱말을 한꺼번에 바꾼다(직제 개편·용어 통일). 바꿀 곳마다 사람 확인을 받는다.', args: { find: '찾을 말', replace: '바꿀 말', inst: '기관명(선택)' },
    async run(a, deps, st, ctx) {
      const run = deps.flows?.bulk; if (!run) return { summary: '일괄 개정 기능이 연결되어 있지 않습니다.' };
      const r = await run(sub(ctx, { find: str(a.find, 30), replace: str(a.replace, 30), inst: str(a.inst, 60) || deps.profile?.alio_inst || undefined, doc_ids: st.doc ? [st.doc.doc_id] : undefined, auto: ctx.input.auto }));
      if (r.docset) st.result = r;
      return { summary: r.docset ? `${r.per_doc.length}개 규정 일괄 개정안` : r.note };
    },
  },
  review_opinions: {
    desc: '만든 개정안에 대해 수렴한 의견을 검토해 처리안을 만들고 담당자가 고른 의견을 반영한다.', args: { opinions_text: '의견 원문' },
    async run(a, deps, st, ctx) {
      const run = deps.flows?.opinions; if (!run || !st.result?.changes) return { summary: '먼저 개정안을 만들어야 합니다.' };
      st.result = await run(sub(ctx, { title: st.result.docset?.title, kind: '개정', changes: st.result.changes, moves: st.result.moves, opinions_text: str(a.opinions_text, 8000), doc_id: st.doc?.doc_id, auto: ctx.input.auto }));
      return { summary: `의견 ${st.result.items.length}건 검토 · 반영 ${st.result.items.filter((x) => x.applied).length}건` };
    },
  },
  scheduled_radar: {
    desc: '곧 시행될 법령 판본을 직전 판본과 비교해 미리 정비할 기관 규정을 찾는다.', args: { laws: '["법령명"] 최대 3개(선택)', inst: '기관명(선택)' },
    async run(a, deps, st, ctx) {
      const run = deps.flows?.radar; if (!run) return { summary: '레이더 기능이 연결되어 있지 않습니다.' };
      const r = await run(sub(ctx, { laws: Array.isArray(a.laws) ? a.laws.slice(0, 3) : undefined, inst: str(a.inst, 60) || undefined, auto: true }));
      st.radar = r;
      return { summary: `${r.note} · 시행예정 조문 ${r.items.length}개` };
    },
  },
  finish: { desc: '작업을 마치고 결과를 요약한다.', args: { summary: '요약' }, async run(a) { return { summary: str(a.summary, 500) || '완료', final: true }; } },
};
