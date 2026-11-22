// 인용 추출 · 조 번호 재배열 · 인용 정정 산출 (결정적 처리, LLM 미사용)
import { refOf } from './parse.mjs';

const RE = /[「｢]([^」｣]{1,80})[」｣]\s*(?:제\s*(\d+)\s*조(?:의(\d+)(?!\s*항))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?)?|(같은\s*조|이\s*조|같은\s*항)?\s*제\s*(\d+)\s*조(?:의(\d+)(?!\s*항))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?|(같은\s*조\s*|이\s*조\s*)?제\s*(\d+)\s*항(?:\s*제\s*(\d+)\s*호)?|별표\s*(\d+)|별지\s*(?:제\s*)?(\d+)\s*호\s*서식/g;

export function extractCitations(body) {
  const out = []; const s = String(body || ''); let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(s))) {
    const index = m.index, text = m[0];
    if (m[1] !== undefined) out.push({ kind: 'external', text, index, name: m[1].trim(), no: m[2] ? +m[2] : null, sub: m[3] ? +m[3] : null, para: m[4] ? +m[4] : null, item: m[5] ? +m[5] : null, artText: m[2] ? text.slice(text.indexOf('제')) : null });
    else if (m[7] !== undefined) {
      if (m[6]) continue;
      const art = { text, index, no: +m[7], sub: m[8] ? +m[8] : null, para: m[9] ? +m[9] : null, item: m[10] ? +m[10] : null };
      const before = s.slice(Math.max(0, index - 90), index);
      // ① 붙여 쓴 법령·규정명("민법 제777조", "인사규정 제34조", "근로기준법 제84조") — "이 규정"은 같은 규정
      // 작은따옴표·큰따옴표로 묶은 규정명 뒤, 또는 「법령」(괄호 설명) 뒤의 조문도 외부 인용
      const quotedName = before.match(/[’”]\s*$/) || before.match(/[」｣]\s*\([^)]{0,60}\)\s*$/);
      // 약칭 정의(이하 "영"이라 한다)가 붙은 이름 뒤의 조문, 띄어 쓴 「…에 관한 법률」, 「법률」
      const aliasNamed = before.match(/((?:같은|이)\s*법\s*시행령|(?:같은|이)\s*법\s*시행규칙|시행령|시행규칙|[가-힣ㆍ·]{1,30}(?:법률|법|령|규정|규칙))\s*\(이하[^)]{0,30}\)\s*$/);
      const spacedLaw = before.match(/((?:[가-힣ㆍ·]+\s){0,6}[가-힣ㆍ·]*에\s*관한\s*법률(?:\s*시행령|\s*시행규칙)?)\s*$/);
      const named = before.match(/([가-힣ㆍ·]{1,30}(?:법률|법|령|규정|규칙|지침|세칙|요령|정관|예규|조례|협약))\s*$/);
      const generic = before.match(/(?:^|[^가-힣])((?:같은|동)\s*(?:법\s*시행령|법\s*시행규칙|시행령|시행규칙|령|영|규칙|법률)|(?:같은|이)\s*법|법률|법|영|시행령|시행규칙|규칙|정관|규정|조례|지침|부칙)\s*$/);
      const prev = out[out.length - 1];
      const between = prev ? s.slice(prev.index + prev.text.length, index) : '';
      // 같은 조문을 앞에서 외부 규정으로 인용했으면 그 조문의 항·호 인용도 외부다(「…」 제11조 … (제11조제4항 및 제5항은 제외))
      const sameExt = art.para ? [...out].reverse().find((x) => x.kind === 'external' && x.no === art.no && (x.sub || null) === art.sub && index - x.index < 120 && /\(/.test(s.slice(x.index + x.text.length, index))) : null;
      if (quotedName) { const lastQ = (before.match(/[「｢]([^」｣]{1,80})[」｣](?:(?![「｢])[\s\S])*$/) || [])[1]; out.push({ kind: 'external', name: lastQ || (before.match(/[‘“]([^’”]{1,60})[’”][^’”]*$/) || [])[1] || prev?.name || '인용 규정', abbr: false, artText: text, ...art }); }
      else if (aliasNamed) out.push({ kind: 'external', name: aliasNamed[1].replace(/\s+/g, ' '), abbr: /^(같은|이|시행)/.test(aliasNamed[1]), artText: text, ...art });
      else if (spacedLaw) out.push({ kind: 'external', name: spacedLaw[1].replace(/\s+/g, ' ').trim(), abbr: false, artText: text, ...art });
      else if (sameExt) out.push({ kind: 'external', name: sameExt.name, abbr: sameExt.abbr, artText: text, ...art });
      else if (/(?:^|[^가-힣])(이|본|당해|동)\s*(규정|규칙|지침|조례|정관|세칙|요령)\s*$/.test(before)) out.push({ kind: 'article', ...art });
      else if (named && !/^(이|본|당해|동)(규정|규칙|지침|조례|정관|세칙|요령)$/.test(named[1]) && !(generic && named[1] === generic[1])) out.push({ kind: 'external', name: named[1], abbr: false, artText: text, ...art });
      else if (generic) out.push({ kind: 'external', name: generic[1].replace(/\s+/g, ' '), abbr: true, artText: text, ...art });
      // ② 연속 인용("제76조의2, 제93조", "제129조부터 제131조까지")은 앞 인용의 종류를 따른다
      else if (prev && prev.kind === 'external' && (prev.no || prev.para) && (/^\s*\(/.test(between) ? /^\s*\(/.test(s.slice(index + text.length)) : true) && /^\s*(?:\([^)]{0,40}\)\s*)?(?:제\s*\d+\s*[항호]\s*)?(?:[가-힣]{1,6}(?<![에의을를은는이가와과로도])\s*)?(?:,|및|또는|부터|ㆍ|·)\s*$/.test(between) && !/(따른|의한|관한|정한)/.test(between)) out.push({ kind: 'external', name: prev.name, abbr: prev.abbr, artText: text, ...art });
      else out.push({ kind: 'article', ...art });
    }
    else if (m[12] !== undefined) {
      if (m[11]) continue;
      const prev = out[out.length - 1], between = prev ? s.slice(prev.index + prev.text.length, index) : '';
      if (prev && prev.kind === 'external' && /^\s*(?:,|및|또는|부터|ㆍ|·)\s*$/.test(between)) out.push({ kind: 'external', name: prev.name, abbr: prev.abbr, text, index, no: null, para: +m[12], item: m[13] ? +m[13] : null });
      // 「제3조제4항부터 제8항까지」: 앞 인용이 조+항이면 단독 항은 그 조의 항이다
      else if (prev && prev.kind === 'article' && prev.no && prev.para && /^\s*(?:,|및|또는|부터|ㆍ|·)\s*$/.test(between)) out.push({ kind: 'article', text, index, no: prev.no, sub: prev.sub, para: +m[12], item: m[13] ? +m[13] : null });
      else out.push({ kind: 'paragraph', text, index, para: +m[12], item: m[13] ? +m[13] : null });
    }
    else if (m[14] !== undefined) { const b = s.slice(Math.max(0, index - 30), index); if (/[가-힣ㆍ·]{1,30}(?:법률|법|령|규정|규칙|지침|세칙|요령|조례)\s*$/.test(b) && !/이\s*(규정|규칙|지침|조례)\s*$/.test(b)) out.push({ kind: 'external_annex', text, index, no: +m[14] }); else out.push({ kind: 'annex', text, index, no: +m[14] }); }
    else if (m[15] !== undefined) out.push({ kind: 'form', text, index, no: +m[15] });
  }
  return out;
}

const norm = (s) => String(s || '').replace(/[\s·ㆍ・‧∙]+/g, '');
// 「규정명」이 대상 문서 제명과 같은 규정인지(기관명 접두 허용)
// 인용 이름이 더 길면 앞에 남는 부분이 우리 기관명일 때만 같은 규정으로 본다(「국가공무원 복무규정」 ≠ 「복무규정」)
const GOVWIDE = /(공무원|국가|정부|공공기관|지방|대통령|총리)$/;
export const sameRegulation = (name, title, inst = null) => {
  const a = norm(name), b = norm(title);
  if (!a || !b) return false;
  if (a === b || b.endsWith(a)) return true;
  if (!a.endsWith(b)) return false;
  const rest = a.slice(0, a.length - b.length);
  return inst ? rest === norm(inst) || norm(inst).endsWith(rest) : !GOVWIDE.test(rest);
};

const citingSections = (a) => a.section !== '부칙';

export function findCiting(docs, { doc_id, ref }) {
  const target = docs.find((d) => d.doc_id === doc_id), hits = [];
  for (const d of docs) for (const a of d.articles) {
    if (!citingSections(a)) continue;
    for (const c of extractCitations(a.body)) {
      const cref = c.no ? refOf(c.no, c.sub) : null;
      if (cref !== ref) continue;
      if ((d.doc_id === doc_id && c.kind === 'article') || (c.kind === 'external' && !c.abbr && target && sameRegulation(c.name, target.title, target.inst))) { hits.push({ doc_id: d.doc_id, ref: a.ref || a.title, section: a.section, citation: c }); break; }
    }
  }
  return hits;
}

export function renumber(doc, ops) {
  const items = doc.articles.filter((a) => a.section === '본칙' && a.no).map((a) => ({ no: a.no, sub: a.sub, orig: a.ref, deleted: false }));
  const find = (ref) => { const i = items.findIndex((x) => refOf(x.no, x.sub) === ref && !x.deleted); if (i < 0) throw Object.assign(new Error(`${ref}를 찾을 수 없습니다.`), { code: 'unknown_ref' }); return i; };
  const inserted = [];
  for (const op of ops || []) {
    if (op.op === 'insert') {
      const i = find(op.after), x = items[i];
      if (op.renumber) {
        for (let j = i + 1; j < items.length; j++) items[j].no += 1;
        const n = { no: x.no + 1, sub: null, orig: null, new: true, op, at: refOf(x.no, x.sub) }; items.splice(i + 1, 0, n); inserted.push(n);
      } else {
        let last = i; for (let j = i + 1; j < items.length; j++) if (items[j].no === x.no) last = j;
        const maxSub = Math.max(1, ...items.filter((y) => y.no === x.no).map((y) => y.sub || 0));
        // 가지 번호는 이미 있는 가지 조문(제45조의5 등) 뒤에 붙인다 — 실제 자리를 at 에 남겨 문서마다 같은 위치를 쓰게 한다
        const n = { no: x.no, sub: maxSub + 1, orig: null, new: true, op, at: refOf(items[last].no, items[last].sub) }; items.splice(last + 1, 0, n); inserted.push(n);
      }
    } else if (op.op === 'delete') {
      const i = find(op.ref), x = items[i];
      if (op.renumber) {
        items.splice(i, 1); x.deleted = true; x.gone = true;
        if (!x.sub) for (let j = i; j < items.length; j++) if (items[j].no > x.no) items[j].no -= 1;
        items.removed = (items.removed || []).concat(x);
      } else x.deleted = true;
    }
  }
  const map = new Map();
  for (const x of items) if (x.orig && refOf(x.no, x.sub) !== x.orig) map.set(x.orig, refOf(x.no, x.sub));
  for (const x of items.removed || []) map.set(x.orig, null);
  return { map, inserted: inserted.map((x) => ({ ref: refOf(x.no, x.sub), op: x.op, after: x.at })) };
}

export function corrections(docs, targetDocId, map) {
  const target = docs.find((d) => d.doc_id === targetDocId), rows = [];
  if (!map.size) return rows;
  for (const d of docs) for (const a of d.articles) {
    if (a.section !== '본칙') continue;
    const edits = []; const notes = [];
    for (const c of extractCitations(a.body)) {
      if (!c.no) continue;
      const old = refOf(c.no, c.sub);
      if (!map.has(old)) continue;
      const local = d.doc_id === targetDocId && c.kind === 'article';
      const ext = c.kind === 'external' && !c.abbr && target && sameRegulation(c.name, target.title, target.inst);
      if (!local && !ext) continue;
      const nu = map.get(old);
      if (nu === null) { notes.push(`${old}이(가) 삭제되어 인용을 확인해야 합니다.`); continue; }
      // 인용 문자열 안에서 "제N조(의M)" 부분만 바꾼다
      const start = c.index + c.text.search(/제\s*\d+\s*조/);
      const len = c.text.slice(c.text.search(/제\s*\d+\s*조/)).match(/^제\s*\d+\s*조(?:\s*의\s*\d+)?/)[0].length;
      edits.push({ start, len, nu });
    }
    if (!edits.length && !notes.length) continue;
    let after = a.body;
    for (const e of edits.sort((x, y) => y.start - x.start)) after = after.slice(0, e.start) + e.nu + after.slice(e.start + e.len);
    rows.push({ doc_id: d.doc_id, doc_title: d.title, ref: a.ref, new_ref: d.doc_id === targetDocId ? (map.get(a.ref) ?? a.ref) : a.ref, section: a.section, before: a.body, after, note: notes.join(' ') || null });
  }
  return rows;
}

// 연속으로 한 칸씩 밀린 조 번호를 "제A조부터 제B조까지를 각각 제A'조부터 제B'조까지로" 구간으로 묶는다
export function moveRanges(map) {
  const moved = [...map].filter(([o, n]) => n && !/의/.test(o) && !/의/.test(n)).map(([o, n]) => [+o.match(/\d+/)[0], +n.match(/\d+/)[0]]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [o, n] of moved) {
    const last = out[out.length - 1];
    if (last && o === last.to + 1 && n - o === last.shift) last.to = o; else out.push({ fromN: o, to: o, shift: n - o });
  }
  return out.map((r) => ({ from: `제${r.fromN}조`, to: `제${r.to}조`, fromNew: `제${r.fromN + r.shift}조`, toNew: `제${r.to + r.shift}조` }));
}
