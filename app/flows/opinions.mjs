// B1 의견 검토: 수렴한 의견을 나눠 AI 처리안을 만들고, 담당자가 고른 의견만 수정안에 반영한 뒤 대비표·재검증
import { buildComparison, amendmentText } from '../lib/table.mjs';
import { checkDocs } from './check.mjs';
import { clip, normalizeArticle } from '../lib/text.mjs';
import { consolidatedDoc } from './docset.mjs';
import { SYS_BASE } from './prompts.mjs';
import { fail } from './common.mjs';
import { normRef } from './amend.mjs';

// 의견 머리: [부서] / 부서: / 공문 회신식 「○ 총무과 :」「- 인사과:」「1. 기획팀:」「• 법무팀:」
const HEAD = /^\s*(?:[○◦•·\-–]\s*|\d{1,2}[.)]\s*)?(?:\[([^\]]{1,30})\]|([가-힣A-Za-z0-9·()\s]{1,20}?)\s*[:：])\s*/;
// 의견 경계: 「[부서]」·「부서:」로 시작하는 줄 또는 빈 줄 2개 이상. 의견 안의 번호 목록은 유지한다.
export function splitOpinions(text) {
  const out = []; let cur = null;
  const flush = () => { if (cur && cur.text.trim()) out.push({ ...cur, text: cur.text.trim() }); cur = null; };
  const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n\s*\n+/);
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const m = line.match(HEAD);
      if (m && !/^\s*\d+\.\s*[^:：]*$/.test(line) && (m[1] || /[과팀실국부처청단원회소]$|노동조합|노조$/.test((m[2] || '').trim()))) { flush(); cur = { from: (m[1] || m[2]).trim(), text: line.slice(m[0].length) + '\n' }; }
      else if (!line.trim() && cur && /\n\s*$/.test(cur.text) && cur.text.trim()) cur.text += '\n';
      else { if (!cur) cur = { from: '미상', text: '' }; cur.text += line + '\n'; }
    }
    flush();
  }
  return out.slice(0, 30).map((o, i) => ({ id: `O${i + 1}`, ...o }));
}

const LABEL = { accept: '반영', partial: '일부 반영', reject: '미반영' };
export async function runOpinions(ctx) {
  const { llm, sources } = ctx.deps, input = ctx.input;
  const changes = (Array.isArray(input.changes) ? input.changes : []).slice(0, 30).map((c) => ({ ...c }));
  if (!changes.length || !String(input.opinions_text || '').trim()) throw fail('bad_input', '수정안과 의견을 입력해 주세요.');
  const refs = new Set(changes.map((c) => c.ref));
  const ops = await ctx.step('의견 나누기', async (s) => { const o = splitOpinions(input.opinions_text); s.note(`${o.length}건 · 제출: ${[...new Set(o.map((x) => x.from))].join(', ')}`); return o; });
  const plan = await ctx.step('처리안 작성', async (s) => {
    if (!llm) throw fail('llm_missing', '모델이 설정되지 않아 처리안을 만들 수 없습니다.');
    const ids = new Set(ops.map((o) => o.id));
    const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({
      과제: '수렴한 의견마다 이 의견을 수정안에 받아들일지 판단해 처리안(accept 반영·partial 일부 반영·reject 미반영)과 사유를 쓴다. 의견은 수정안에 없는 내용을 넣거나 바꿔 달라는 요청이므로 「수정안에 포함되지 않았다·상충한다」는 미반영 사유가 아니다. 미반영은 상위 법령에 어긋나거나, 개정 의도와 반대되거나, 근거·예산 등 구체적 이유가 있을 때만 하고 그 이유를 쓴다. 반영(일부 반영 포함)하면 수정안에 의견을 더한 대상 조문의 본문 전체(revised_text, 조문 제목 제외)를 준다. 부칙(시행일·경과조치)에 관한 의견은 target_ref 를 가장 관련 있는 조문으로 두되 revised_text 는 비우고 사유에 부칙 반영안을 쓴다. 대상 조문은 아래 수정안 조문 번호 중에서만 고른다. 최종 결정은 담당자가 한다.',
      수정안: changes.map((c) => ({ ref: c.ref, 제목: c.title, 현행: clip(c.old, 800), 수정안: clip(c.new, 800) })), 의견: ops.map((x) => ({ id: x.id, 제출: x.from, 내용: clip(x.text, 600) })),
      출력형식: { items: [{ id: 'O1', target_ref: '제N조', proposal: 'accept|partial|reject', reason: '사유', revised_text: '반영 시 고친 본문 전체' }] } }) }], (o) => {
      if (!Array.isArray(o.items)) throw new Error('items 없음');
      for (const x of o.items) {
        if (x.target_ref) x.target_ref = normRef(x.target_ref).ref;
        if (!ids.has(x.id)) throw new Error(`의견 ID ${x.id} 는 없습니다.`);
        if (!refs.has(x.target_ref)) throw new Error(`${x.target_ref} 는 수정안에 없는 조문입니다. 수정안 조문 번호 중에서 고르세요.`);
        if (!LABEL[x.proposal]) throw new Error(`proposal ${x.proposal} 이 올바르지 않습니다.`);
        // 「수정안에 없다」는 이유의 미반영은 판단을 하지 않은 것이다 — 다시 판단하게 한다
        if (x.proposal === 'reject' && /(포함되(어 있)?지 않|들어 있지 않|반영되어 있지 않|명시되어 있지 않|상충|충돌)/.test(String(x.reason || '')) && !/법|위반|예산|의도|근거/.test(String(x.reason || ''))) throw new Error(`${x.id}: 수정안에 없다는 것은 미반영 사유가 아닙니다. 의견을 받아들일지 판단하고, 미반영이면 법령 위반·의도와 반대·근거 부족 등 구체적 이유를 쓰세요.`);
      }
      return o;
    }, { maxTokens: 4000 });
    s.note(o.items.map((x) => `${x.id} → ${LABEL[x.proposal]}(${x.target_ref})`).join(' · '));
    return o.items;
  });
  const opts = ops.map((o) => { const p = plan.find((x) => x.id === o.id); return { value: o.id, label: `${o.id} [${o.from}] ${clip(o.text.replace(/\s+/g, ' '), 60)}`, detail: p ? `처리안: ${LABEL[p.proposal]}(${p.target_ref}) — ${p.reason}` : '처리안 없음', checked: !!p && p.proposal !== 'reject' }; });
  const picked = new Set(input.auto ? opts.filter((o) => o.checked).map((o) => o.value) : [].concat(await ctx.gate({ id: 'pick_opinions', prompt: '반영할 의견을 고르세요. 처리 결정은 담당자가 합니다.', multi: true, options: opts }) || []));
  return ctx.step('반영·재검증', async (s) => {
    const used = new Set();
    const decided = ops.map((o) => { const p = plan.find((x) => x.id === o.id) || {}; let apply = picked.has(o.id) && !!p.revised_text; let conflict = false; if (apply && used.has(p.target_ref)) { apply = false; conflict = true; } if (apply) used.add(p.target_ref); // 부칙(시행일·경과조치) 의견처럼 조문 본문이 없는 반영은 사유의 반영안을 담당자가 부칙에 옮긴다
      const outside = picked.has(o.id) && !p.revised_text && p.proposal && p.proposal !== 'reject';
      return { ...o, ...p, decision: apply || outside ? (p.proposal === 'partial' ? 'partial' : 'accept') : 'reject', applied: apply, outside, conflict }; });
    for (const d of decided.filter((x) => x.applied)) { const c = changes.find((x) => x.ref === d.target_ref); if (c) c.new = String(d.revised_text).replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').trim(); }
    // 같은 조문을 고르는 의견이 둘 이상이면 모델에 합친 본문을 받아 모두 반영한다(실패하면 담당자가 합치도록 표시)
    for (const ref of [...new Set(decided.filter((d) => d.conflict).map((d) => d.target_ref))]) {
      const group = decided.filter((d) => d.target_ref === ref && (d.applied || d.conflict)), c = changes.find((x) => x.ref === ref);
      if (!llm || !c || group.length < 2) continue;
      try {
        const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: '같은 조문에 대한 여러 의견의 반영안을 하나의 조문 본문으로 합친다. 각 반영안이 바꾼 부분을 모두 살리고, 서로 부딪치면 뒤 의견을 따르되 conflicts 에 적는다. 조문 제목은 빼고 본문 전체를 쓴다.', 원래수정안: c.new, 반영안: group.map((d) => ({ id: d.id, 의견: clip(d.text, 300), 반영본문: d.revised_text })), 출력형식: { text: '합친 본문 전체', conflicts: ['부딪친 점(없으면 빈 배열)'] } }) }], (x) => { if (typeof x.text !== 'string' || !x.text.trim() || x.text.length > 8000) throw new Error('text 가 비어 있습니다.'); return x; }, { maxTokens: 3000 });
        c.new = o.text.replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '').trim();
        for (const d of group) Object.assign(d, { applied: true, conflict: false, merged: true, decision: d.proposal === 'partial' ? 'partial' : 'accept', reason: `${d.reason || ''} (같은 조문의 ${group.filter((x) => x !== d).map((x) => x.id).join('·')} 의견과 합쳐 반영${Array.isArray(o.conflicts) && o.conflicts.length ? ` — 확인: ${o.conflicts.join('; ')}` : ''})`.trim() });
      } catch { /* 합치지 못하면 기존처럼 담당자 작성 필요로 남긴다 */ }
    }
    // V1 재검증: 원문이 있으면 바뀐 조문을 적용한 가상 문서로 인용·용어·수치 점검(바뀐 조문 관련만)
    let recheck = [], orig = null;
    if (input.doc_id && sources?.loadDoc) {
      try { const d = await sources.loadDoc(input.doc_id); orig = d; const v = { ...d, articles: d.articles.map((a) => { const c = changes.find((x) => x.ref === a.ref && a.section === '본칙'); return c ? { ...a, body: c.new } : a; }) }; recheck = checkDocs([v], {}).filter((f) => changes.some((c) => String(f.ref).includes(c.ref))); } catch { recheck = [{ message: '재검증용 원문을 불러오지 못했습니다.' }]; }
    }
    // 담당자가 읽고 고치기 쉽게 의견마다 한 덩어리(번호·제출·처리·대상, 의견 요지, 사유)
    const why = (d) => d.conflict ? '같은 조문에 앞 의견이 이미 반영됨 — 담당자가 두 의견을 합쳐 작성 필요' : d.outside ? `${d.reason || ''} — 조문 밖(부칙 등) 반영: 담당자가 부칙에 옮겨 적음`.trim() : d.applied ? (d.reason || '') : picked.has(d.id) ? '반영 문안 없음 — 담당자 작성 필요' : (d.reason || '담당자 미선택');
    const review = [`의견 ${decided.length}건 — 반영 ${decided.filter((d) => d.decision !== 'reject').length}건 · 미반영 ${decided.filter((d) => d.decision === 'reject').length}건 (처리는 담당자 결정)`, '',
      ...decided.flatMap((d) => [`${d.id}. ${d.from} — ${LABEL[d.decision]}${d.target_ref ? ` · ${d.outside ? '부칙' : d.target_ref}` : ''}`, `  의견: ${clip(d.text.replace(/\s+/g, ' '), 160)}`, `  사유: ${why(d)}`, ''])].join('\n').trim();
    s.note(`반영 ${decided.filter((d) => d.decision !== 'reject').length}건 · 미반영 ${decided.filter((d) => d.decision === 'reject').length}건${recheck.length ? ` · 재검증 문제 ${recheck.length}건` : ''}`);
    const sections = [
      { id: 'opinion_review', title: '의견 검토서', body: review },
      { id: 'comparison', title: '신구조문대비표(의견 반영)', rows: buildComparison(changes) },
      { id: 'draft', title: '개정문(의견 반영)', body: amendmentText(input.title || '규정', changes.filter((c) => c.op !== 'insert' || c.ref), { kind: input.kind === '제정' ? '제정' : '일부개정', moves: Array.isArray(input.moves) ? input.moves.slice(0, 20) : [] }) },
      // 의견을 반영한 개정 후 전문(개정일 때, 원문을 불러온 경우)
      ...(orig && input.kind !== '제정' ? [{ id: 'full_text', title: '개정 후 전문(의견 반영)', body: consolidatedDoc({ doc: orig, changes, addendaText: typeof input.addenda === 'string' ? input.addenda.slice(0, 5000) : '', normalize: normalizeArticle }) }] : []),
      ...(recheck.length ? [{ id: 'checklist', title: '재검증', body: recheck.map((f) => `☐ ${f.ref || ''} ${f.message}`).join('\n') }] : []),
    ];
    return { kind: '의견 반영', docset: { kind: '의견 반영', title: input.title || '규정', sections, evidence: [] }, changes, items: decided, docKeys: ['opinion_review', 'comparison', 'draft', 'full_text'] };
  });
}
