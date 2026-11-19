// 초안 자체 검토: 코드가 먼저 문제를 찾고(규정에 없던 법률 용어, 실재하지 않는 법령명, 기관 유형에 맞지 않는 법령),
// 모델이 그 결과와 함께 항끼리 모순·의도/근거 요건 누락을 검토해 고친 본문을 낸다. 고친 본문은 서버가 검증한 뒤에만 쓴다.
import { SYS_BASE } from './prompts.mjs';
import { clip, normalizeArticle } from '../lib/text.mjs';
import { josa, splitParagraphs } from '../lib/table.mjs';

const flat = (s) => String(s || '').replace(/\s+/g, '');
// 법률 문장에서 그대로 옮겨 오기 쉬운 주체 낱말 — 규정 원문에 없으면 규정의 용어(직원·공단 등)로 바꿔야 한다
const LAW_TERMS = ['사업주', '근로자', '사용자', '고용주', '피고용인'];
const CIVIL = /국가공무원법|지방공무원법|공무원\s*복무\s*규정|국가공무원\s*복무규정|지방공무원\s*복무규정/;

// 본문에 나오는 법령 이름: 「」·｢｣ 안의 이름과, 괄호 없이 쓴 "…에 관한 법률"·"…법 시행령" 꼴
export function lawNamesIn(text) {
  const t = String(text || ''), out = [];
  for (const m of t.matchAll(/[「｢]([^」｣]{2,60})[」｣]/g)) out.push(m[1].trim());
  for (const m of t.matchAll(/(?<!\S)((?:[가-힣ㆍ·]+\s){0,6}?[가-힣ㆍ·]*에\s*관한\s*법률(?:\s*시행령|\s*시행규칙)?)/g)) out.push(m[1].trim().replace(/^(및|또는|와|과|그리고)\s+/, ''));
  return [...new Set(out.map((x) => x.replace(/\s+/g, ' ')).filter((x) => /(법|법률|시행령|시행규칙)$/.test(x) && x.length >= 3))];
}

const lawCache = new Map(); // 이름 → true(있음)·false(못 찾음)·null(조회 실패)
async function lawExists(sources, name) {
  if (lawCache.has(name)) return lawCache.get(name);
  let v = null;
  try {
    const r = await sources.searchLaw(name, { targets: ['law', 'admrul'] });
    // 이름이 같아야 있는 것으로 본다(가운뎃점 차이는 무시). 앞부분만 같은 다른 법령(「근로기준법 특례법」 ≠ 「근로기준법」)은 아니다
    const dot = (x) => flat(x).replace(/[·ㆍ・]/g, '');
    const hit = (r.rows || []).some((x) => dot(x.title) === dot(name));
    v = hit ? true : (r.errors?.length ? null : false);
  } catch { v = null; }
  if (v !== null) lawCache.set(name, v);
  return v;
}

// items: [{ ref, title, text, old? }], docText: 원 규정 전체 본문(새 규정이면 빈 문자열)
// 항 삭제를 문장으로 쓴 경우(「③ … 규정은 삭제한다.」)를 법령 관행 「③ 삭제」로 바꾼다. 「기록은 삭제한다」 같은 실제 내용은 그대로 둔다
export function tidyDeletedParagraphs(text) {
  return String(text || '').split('\n').map((p) => { const m = p.match(/^\s*([①-⑳])\s*(.*)$/); return m && /(규정|조항|항|내용|문구)[은는을를]?\s*(삭제|폐지)(한다|함)\.?\s*$/.test(m[2]) ? `${m[1]} 삭제` : p; }).join('\n');
}
// 원 규정에서 그 낱말을 실제 주체로 쓰는지: 정의 조항과 「근로자의 날」「근로자대표」 같은 합성어는 빼고 본다
const usesTerm = (docText, w) => String(docText || '').split('\n').filter((l) => !/정의|"[^"]+"\s*(?:이)?란/.test(l)).join(' ').replace(new RegExp(`${w}(의\\s*날|대표|참여)`, 'g'), '').replace(/\s+/g, '').includes(w);

export async function detectIssues({ items, docText = '', profile = {}, sources }) {
  const issues = [], orig = flat(docText);
  for (const it of items) {
    const t = String(it.text || '');
    const terms = LAW_TERMS.filter((w) => t.includes(w) && orig && !usesTerm(docText, w) && !String(it.old || '').includes(w));
    if (terms.length) issues.push({ ref: it.ref, kind: 'term', problem: `${it.ref}: 이 규정에 없는 법률 용어 ${terms.map((w) => `"${w}"`).join('·')}를 썼습니다. 규정의 용어(직원·기관명 등)로 바꿔야 합니다.` });
    // 기관 유형에 맞지 않는 공무원 법령: 공공기관은 공무원 법령 전반, 지자체는 국가공무원 법령, 부처는 지방공무원 법령
    const wrong = { 'public-institution': [CIVIL, '공공기관 직원은 공무원이 아니므로 근로기준법 등 적용 법령을 확인해야 합니다.'], 'local-gov': [/국가공무원법|국가공무원\s*복무\s*규정/, '지방자치단체 공무원은 지방공무원법·지방공무원 복무규정을 따릅니다.'], 'central-ministry': [/지방공무원법|지방공무원\s*복무\s*규정/, '중앙행정기관 공무원은 국가공무원법·국가공무원 복무규정을 따릅니다.'] }[profile.type || 'public-institution'];
    if (wrong && wrong[0].test(t) && !wrong[0].test(docText)) { const hit = t.match(wrong[0])[0]; issues.push({ ref: it.ref, kind: 'civil', problem: `${it.ref}: ${hit}${josa(hit, '을', '를')} 인용했습니다. ${wrong[1]}` }); }
    // 내규·훈령은 대통령령·부령에 위임할 수 없다(법률 조문을 그대로 옮긴 흔적) — 기관이 따로 정하게 써야 한다
    const deleg = t.match(/(대통령령|총리령|[가-힣]{2,10}부령)으로\s*정한다/);
    if (deleg && !flat(docText).includes(flat(deleg[0])) && !String(it.old || '').includes(deleg[1])) issues.push({ ref: it.ref, kind: 'deleg', problem: `${it.ref}: 「${deleg[0]}」는 법령 문장입니다. 규정에서는 기관이 따로 정하도록(예: "필요한 사항은 ○○이 따로 정한다") 써야 합니다.` });
    // 인용 표기 오류: 「제4조제2항 제1항」처럼 항을 두 번 쓴 경우
    const dbl = t.match(/제\s*\d+\s*조(?:의\s*\d+)?\s*제\s*\d+\s*항\s+제\s*\d+\s*항(?!\s*(?:및|또는|부터|ㆍ|·|,))/);
    if (dbl && !flat(docText).includes(flat(dbl[0]))) issues.push({ ref: it.ref, kind: 'cite', problem: `${it.ref}: 인용 「${dbl[0]}」에 항이 두 번 들어 있습니다. 바른 조·항으로 고쳐야 합니다.` });
    // 호 표기: 규정의 호는 「1.」 「2.」 — 줄 첫머리 「1)」은 목 아래 단계이므로 호 자리에 쓰면 체계가 어긋난다
    if (/(^|\n)\s*1\)\s/.test(t) && !/(^|\n)\s*[가-하]\.\s/.test(t) && !/(^|\n)\s*1\)\s/.test(String(it.old || ''))) issues.push({ ref: it.ref, kind: 'item', problem: `${it.ref}: 호를 「1)」로 적었습니다. 호는 「1.」 「2.」로 쓰고, 「1)」은 목(가.) 아래에서만 씁니다.` });
    for (const n of lawNamesIn(t)) {
      if (orig.includes(flat(n))) continue; // 원 규정이 이미 인용하던 이름은 건너뛴다
      if (await lawExists(sources, n) === false) issues.push({ ref: it.ref, kind: 'law', problem: `${it.ref}: 「${n}」${josa(n, '을', '를')} 법령 검색에서 찾지 못했습니다. 법령명이 맞는지 확인하세요(없는 법령이면 빼거나 바른 이름으로).` });
    }
  }
  return issues;
}

// 낱말 줄기(끝 조사·어미를 뗀 2글자 이상) — 자체 검토가 근거 없이 새 말을 넣었는지 보는 데 쓴다
const stems = (t) => new Set((String(t || '').match(/[가-힣]{2,}/g) || []).map((w) => w.replace(/(에서는|에게는|으로서|으로|에서|에게|하는|하여|하고|되는|이나|이며|이고|을|를|이|가|은|는|의|에|로|와|과|도|만|한|된|할|함)$/, '')).filter((w) => w.length >= 2));
// 규정이 「사업주」 자리에 쓰는 주어: 기관장 직함(원장·이사장 등)과 기관 약칭(창진원·공단 등) 가운데 이 규정이 실제로 쓰는 것.
// 법적으로 사업주는 기관(법인)이지만, 내규는 권한을 행사하는 기관장을 주어로 쓰는 경우가 많다 — 기관장을 기관 약칭의 절반 이상 쓰면 기관장으로
const NOT_ORG = /^(직원|위원|회원|인원|임원|교원|동원|지원|복원|사원|요원|의원|병원|정원|결원|증원|감원|충원|청원|자원|기원|민원)$/;
const HEADS = /^(원장|이사장|사장|기관장|본부장|단장|센터장|총장|회장|청장|시장|군수|구청장|장관|처장|위원장|교육감|도지사)$/;
export function subjectOf(docText) {
  const org = new Map(), head = new Map();
  for (const m of String(docText || '').matchAll(/(?:^|[\s(①-⑳])([가-힣]{2,8})(?:은|는|이|가)\s/gm)) {
    const w = m[1];
    if (HEADS.test(w)) head.set(w, (head.get(w) || 0) + 1);
    else if (/(원|공단|공사|재단|센터|진흥회|협회)$/.test(w) && !NOT_ORG.test(w)) org.set(w, (org.get(w) || 0) + 1);
  }
  const top = (m) => [...m].sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const [o, on] = top(org), [h, hn] = top(head);
  if (hn >= 2 && hn * 2 >= on) return h;
  return on >= 2 ? o : null;
}
// 「사업주」를 규정의 주어(기관장 또는 기관 약칭)로 바꾸고 조사를 맞춘다
const swapSubject = (t, to) => String(t).replace(/사업주(는|가|를|와|로|에게|의|도)?/g, (_, j) => to + (j ? ({ 는: josa(to, '은', '는'), 가: josa(to, '이', '가'), 를: josa(to, '을', '를'), 와: josa(to, '과', '와'), 로: josa(to, '으로', '로') }[j] || j) : ''));
export async function selfReview({ llm, sources, items, intent = '', evidence = [], docText = '', profile = {}, kind = '개정' }) {
  const found = await detectIssues({ items, docText, profile, sources });
  const fixed = new Map(), applied = [], rejected = [];
  if (llm && items.length) {
    try {
      const refs = new Set(items.map((x) => x.ref));
      const count = async (ref, text) => (await detectIssues({ items: [{ ...items.find((x) => x.ref === ref), text }], docText, profile, sources })).length;
      const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({
        과제: `아래 ${kind} 조문안을 검토한다. 다음 문제만 찾는다: ① 같은 조문 안에서 항·호끼리 모순(예: 고친 항과 어긋나게 남은 항) ② 의도나 근거에 있는 요건(일수·기한·유급 여부·횟수 등)이 빠지거나 다름 ③ 법률 문장의 주체(사업주·근로자)를 그대로 옮겨 씀 — 이 경우 이 규정이 쓰는 말(직원·공단 등 현행 조문의 주체)로 되돌린다. 현행 조문이 쓰는 말을 법률 용어로 바꾸지 않는다 ④ 코드가 찾은 문제. 문제가 있는 조문만 issues 에 넣고, 고친 조문 본문 전체(조문 제목 제외, 고칠 필요 없는 항도 그대로 포함)를 fixed_text 로 준다. 의도에 없는 내용을 새로 넣지 않는다. 문제가 없으면 issues 는 빈 배열.`,
        의도: clip(intent, 1500), 기관유형: profile.type || null,
        조문안: items.map((x) => ({ ref: x.ref, 제목: x.title, ...(x.old ? { 현행: clip(x.old, 1500) } : {}), 조문안: clip(x.text, 2500) })),
        근거: evidence.slice(0, 6).map((e) => ({ id: e.id, 출처: e.label, 내용: clip(e.text, 400) })),
        코드가찾은문제: found.map((x) => x.problem),
        출력형식: { issues: [{ ref: '제N조', problem: '한 문장', fixed_text: '고친 본문 전체(고칠 수 없으면 빈 문자열)' }] },
      }) }], (x) => { if (!Array.isArray(x.issues)) throw new Error('issues 배열이 없습니다.'); return x; }, { maxTokens: 4000 });
      for (const is of o.issues.slice(0, 20)) {
        const ref = String(is.ref || '').replace(/\s+/g, ''), it = items.find((x) => x.ref === ref);
        if (!refs.has(ref) || !it || typeof is.fixed_text !== 'string' || !is.fixed_text.trim() || is.fixed_text.length > 8000) continue;
        const nt = tidyDeletedParagraphs(normalizeArticle(is.fixed_text.replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '')));
        const base = fixed.get(ref) ?? it.text;
        if (flat(nt) === flat(base)) continue;
        if (base.length >= 400 && nt.length < base.length * 0.5) { rejected.push({ ref, problem: is.problem, why: '조문 대부분을 잃음' }); continue; } // 조문 대부분을 잃는 수정은 쓰지 않는다
        // 항이 줄거나(①~④를 빼고 ⑤만 남김 등) 본문이 크게 줄어드는 수정도 쓰지 않는다 — 검토는 고칠 곳만 고친다
        const bp = splitParagraphs(base).length, np = splitParagraphs(nt).length; // 어긋난 항 하나를 지우는 것은 허용
        if (np < bp - 1 || (np < bp && np * 2 < bp) || (base.length >= 80 && nt.length < base.length * 0.5)) { rejected.push({ ref, problem: is.problem, why: '항이나 내용을 빠뜨림' }); continue; }
        // 기관 용어(직원·창진원 등)를 법률 주체(사업주·근로자)로 되돌리는 수정은 쓰지 않는다 — 규정이 근로자를 쓰더라도 초안보다 늘리지 않는다
        const more = LAW_TERMS.filter((w) => nt.split(w).length > base.split(w).length);
        if (more.length) { rejected.push({ ref, problem: is.problem, why: `법률 주체 낱말을 늘림(${more.join('·')})` }); continue; }
        // 의도·근거·현행·원문 어디에도 없는 말을 새로 넣은 수정(「휴일을 제외한」 등)은 쓰지 않는다
        const pool = [intent, docText, it.old, ...evidence.map((e) => e.text)].join(' '), had = stems(base);
        const extra = [...stems(nt)].filter((w) => !had.has(w) && !pool.includes(w));
        if (extra.length) { rejected.push({ ref, problem: is.problem, why: `근거 없는 말을 넣음(${extra.slice(0, 3).join('·')})` }); continue; }
        // 고친 결과가 새 문제(법률 용어·없는 법령명 등)를 만들면 쓰지 않는다
        if (await count(ref, nt) > await count(ref, base)) { rejected.push({ ref, problem: is.problem, why: '새 문제를 만듦' }); continue; }
        fixed.set(ref, nt); applied.push({ ref, problem: String(is.problem || '').slice(0, 300) });
      }
    } catch { /* 검토 실패: 초안을 그대로 두고 탐지 결과만 넘긴다 */ }
  }
  // 법령 위임 문장(「…대통령령으로 정한다」)은 내규에서 쓸 수 없으므로 「따로 정한다」로 바꾼다(원 규정이 쓰던 표현은 둔다)
  for (const x of items) {
    const t = fixed.get(x.ref) ?? x.text, m = String(t).match(/(대통령령|총리령|[가-힣]{2,10}부령)으로\s*정한다/);
    if (m && !flat(docText).includes(flat(m[0])) && !String(x.old || '').includes(m[1])) { fixed.set(x.ref, t.replace(new RegExp(`${m[1]}으로\\s*정한다`, 'g'), '따로 정한다')); applied.push({ ref: x.ref, problem: `법령 위임 문장 「${m[0]}」를 「따로 정한다」로 바꿈(담당자가 정할 주체를 확인)` }); }
  }
  // 「사업주」는 내규의 주어가 아니다(법률 문장을 옮긴 흔적) — 원 규정이 두 곳 넘게 주어로 쓰지 않으면 규정이 쓰는 주어(기관장·기관 약칭)로 바꾼다
  const subj = subjectOf(docText), bossUse = String(docText || '').split('\n').filter((l) => l.includes('사업주')).length;
  for (const x of items) {
    const t = fixed.get(x.ref) ?? x.text;
    if (subj && bossUse < 2 && t.includes('사업주') && !String(x.old || '').includes('사업주')) { fixed.set(x.ref, swapSubject(t, subj)); applied.push({ ref: x.ref, problem: `법률 주체 「사업주」를 이 규정이 쓰는 주어 「${subj}」${josa(subj, '으로', '로')} 바꿈(기관장·기관 중 맞는지 확인)` }); }
  }
  // 고친 뒤에도 남은 결정적 문제
  const after = items.map((x) => ({ ...x, text: fixed.get(x.ref) ?? x.text }));
  const remaining = (await detectIssues({ items: after, docText, profile, sources })).map((x) => x.problem);
  return { found: found.map((x) => x.problem), fixed, applied, rejected, remaining };
}
