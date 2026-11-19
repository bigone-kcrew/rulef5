// 신구조문대비표 · 개정문 · 문서 세트 렌더링 (결정적 처리)
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nl = (s) => s.replace(/\n/g, '<br>');
export const NOTICE = 'AI 초안입니다. 담당자가 원문과 대조·검토해야 합니다.';

function lcsMarks(a, b) {
  const n = a.length, m = b.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ka = new Array(n).fill(false), kb = new Array(m).fill(false);
  for (let i = 0, j = 0; i < n && j < m;) { if (a[i] === b[j]) { ka[i] = kb[j] = true; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return [ka, kb];
}
function render(tokens, keep) {
  let out = '', open = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], ws = /^\s+$/.test(t);
    const changed = !keep[i] && !ws;
    if (changed && !open) { out += '<u>'; open = true; }
    if (!changed && !ws && open) { out += '</u>'; open = false; }
    if (ws && open) { // 공백 뒤에 변경 단어가 이어질 때만 밑줄 안에 둔다
      let k = i + 1; while (k < tokens.length && /^\s+$/.test(tokens[k])) k++;
      if (k >= tokens.length || keep[k]) { out += '</u>'; open = false; }
    }
    out += esc(t);
  }
  return open ? out + '</u>' : out;
}
export function diffMarks(oldText, newText) {
  const a = String(oldText ?? '').split(/(\s+)/).filter(Boolean), b = String(newText ?? '').split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > 4e6) return { oldHtml: `<u>${esc(oldText)}</u>`, newHtml: `<u>${esc(newText)}</u>` };
  const [ka, kb] = lcsMarks(a, b);
  return { oldHtml: render(a, ka), newHtml: render(b, kb) };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export function splitParagraphs(body) {
  const out = [];
  for (const line of String(body ?? '').split('\n')) {
    if (!out.length || CIRCLED.includes(line.trim()[0])) out.push(line.trim()); else out[out.length - 1] += '\n' + line.trim();
  }
  return out.filter((p, i) => p || i === 0);
}
const head = (c) => `${c.ref}${c.title ? `(${c.title})` : ''}`;
const key = (p, i) => (CIRCLED.includes(p[0]) ? p[0] : `#${i}`);

export function buildComparison(changes0) {
  const rows = [];
  const changes = [...changes0].map((c, i) => [c, i]).sort((a, b) => (artNum(a[0].new_ref || a[0].ref) - artNum(b[0].new_ref || b[0].ref)) || a[1] - b[1]).map(([c]) => c);
  for (const c of changes) {
    if (c.op === 'insert') { rows.push({ ref: c.ref, oldHtml: esc('<신 설>'), newHtml: `<u>${nl(esc(`${head(c)} ${c.new}`))}</u>` }); continue; }
    if (c.op === 'delete') { rows.push({ ref: c.ref, oldHtml: `<u>${nl(esc(`${head(c)} ${c.old}`))}</u>`, newHtml: esc('<삭 제>') }); continue; }
    const op = splitParagraphs(c.old), np = splitParagraphs(c.new);
    const nmap = new Map(np.map((p, i) => [key(p, i), p])), used = new Set();
    op.forEach((p, i) => {
      const k = key(p, i), q = nmap.get(k), prefix = i === 0 ? `${head(c)} ` : '';
      if (q === undefined) { rows.push({ ref: c.ref, oldHtml: nl(esc(prefix) + `<u>${esc(p)}</u>`), newHtml: esc('<삭 제>') }); return; }
      used.add(k);
      if (q.replace(/\s+/g, ' ').trim() === p.replace(/\s+/g, ' ').trim()) rows.push({ ref: c.ref, oldHtml: nl(esc(prefix + p)), newHtml: '(현행과 같음)' });
      else { const d = diffMarks(p, q); rows.push({ ref: c.ref, oldHtml: nl(esc(prefix) + d.oldHtml), newHtml: nl(esc(prefix) + d.newHtml) }); }
    });
    np.forEach((q, i) => { if (!used.has(key(q, i))) rows.push({ ref: c.ref, oldHtml: esc('<신 설>'), newHtml: nl(`<u>${esc(q)}</u>`) }); });
  }
  return rows;
}

// 받침 여부로 조사 선택(숫자는 읽는 소리 기준)
const DIGIT_BATCHIM = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
// 「으로/로」는 ㄹ 받침 뒤에도 「로」(10일로, 1로)
const DIGIT_RIEUL = { 1: true, 7: true, 8: true };
export function josa(word, withB, without) {
  const ch = String(word).trim().replace(/["'”’」』)\]]+$/, '').slice(-1);
  const ro = withB === '으로';
  if (/\d/.test(ch)) return DIGIT_BATCHIM[ch] && !(ro && DIGIT_RIEUL[ch]) ? withB : without;
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) { const b = (c - 0xac00) % 28; return b && !(ro && b === 8) ? withB : without; }
  return without;
}
// 문단 안의 바뀐 어절 구간들(연속 구간은 하나로)
export function changedSpans(oldText, newText) {
  const a = String(oldText).split(/(\s+)/).filter(Boolean), b = String(newText).split(/(\s+)/).filter(Boolean);
  const [ka, kb] = lcsMarks(a, b);
  const spans = (toks, keep) => { const out = []; let cur = null; toks.forEach((t, i) => { if (!keep[i] && !/^\s+$/.test(t)) { if (!cur) { cur = { s: i, e: i }; out.push(cur); } else cur.e = i; } else if (keep[i]) cur = null; }); return out.map((x) => toks.slice(x.s, x.e + 1).join('')); };
  return { removed: spans(a, ka), added: spans(b, kb) };
}
function phraseDirective(c) {
  const op = splitParagraphs(c.old), np = splitParagraphs(c.new);
  if (op.length !== np.length || op.length === 0) return null;
  const parts = [];
  for (let i = 0; i < op.length; i++) {
    if (op[i] === np[i]) continue;
    const { removed, added } = changedSpans(op[i], np[i]);
    if (removed.length !== added.length || !removed.length || removed.length > 3 || removed.some((r) => r.length > 40) || added.some((r) => r.length > 60)) return null;
    const pno = CIRCLED.includes(op[i][0]) ? `제${CIRCLED.indexOf(op[i][0]) + 1}항` : '';
    const edits = removed.map((r, k) => `"${r}"${josa(r, '을', '를')} "${added[k]}"${josa(added[k], '으로', '로')}`).join(', ');
    parts.push({ pno, edits });
  }
  if (!parts.length) return null;
  return parts.map((p, i) => `${i === 0 ? c.ref + p.pno : `같은 조${p.pno ? ' ' + p.pno : ''}`} 중 ${p.edits}`).join(' 하고, ') + ' 한다.';
}

// 조문 번호 뒤 조사: '제35조의3'은 숫자 읽기(삼→을), '제16조'는 '조'(를)
function refJosa(ref) { const r = String(ref).replace(/\(.*$/, ''); return /\d$/.test(r) ? josa(r, '을', '를') : '를'; }
function artNum(r) { const m = String(r || '').match(/제(\d+)조(?:의(\d+))?/); return m ? +m[1] + (+(m[2] || 0)) / 100 : 1e9; }
export function amendmentText(title, changes, { kind = '일부개정', moves = [] } = {}) {
  if (kind === '제정') return [title, '', ...changes.map((c) => `${head(c)} ${c.new}`)].join('\n');
  const lines = [`${title} 일부를 다음과 같이 개정한다.`, ''];
  if (moves.length) lines.push(moves.map((m) => m.from === m.to ? `${m.from}를 ${m.fromNew}로` : `${m.from}부터 ${m.to}까지를 각각 ${m.fromNew}부터 ${m.toNew}까지로`).join(' 하고, ') + ' 하고,', '');
  const sorted = [...changes].sort((a, b) => artNum(a.new_ref || a.ref) - artNum(b.new_ref || b.ref));
  for (const c0 of sorted) {
    const c = c0.new_ref && c0.new_ref !== c0.ref ? { ...c0, ref: `${c0.new_ref}(종전의 ${c0.ref})` } : c0;
    const phrase = c.op === 'amend' && c.old ? phraseDirective(c) : null;
    if (phrase) lines.push(phrase, '');
    else if (c.op === 'delete') lines.push(`${c.ref}${refJosa(c.ref)} 삭제한다.`, '');
    else lines.push(`${c.ref}${refJosa(c.ref)} 다음과 같이 ${c.op === 'insert' ? '신설한다' : '한다'}.`, `${head(c)} ${c.new}`, '');
  }
  return lines.join('\n').trim();
}

const strip = (h) => String(h ?? '').replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
export function toCsv(rows) {
  const q = (v) => { const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿조문,현행,개정안\r\n' + rows.map((r) => [r.ref, strip(r.oldHtml), strip(r.newHtml)].map(q).join(',') + '\r\n').join('');
}

export function renderDocSet(set, format = 'md') {
  const ev = (set.evidence || []).map((e, i) => `${i + 1}. ${e.label || ''} — ${e.doc_id}${e.ref ? ` ${e.ref}` : ''}${e.edition ? ` (${e.edition})` : ''}`);
  if (format === 'md') {
    const parts = [`# ${set.title}${set.kind ? ` (${set.kind}안)` : ''}`, `> ${NOTICE}`];
    for (const s of set.sections || []) {
      parts.push(`## ${s.title}`);
      if (s.rows) parts.push(['| 현행 | 개정안 |', '| --- | --- |', ...s.rows.map((r) => `| ${r.oldHtml.replace(/\|/g, '\\|')} | ${r.newHtml.replace(/\|/g, '\\|')} |`)].join('\n'));
      else parts.push(String(s.body ?? ''));
    }
    parts.push('## 근거 자료', ev.length ? ev.join('\n') : '(없음)', `---\n${NOTICE}`);
    return parts.join('\n\n') + '\n';
  }
  const body = (set.sections || []).map((s) => `<section><h2>${esc(s.title)}</h2>${s.rows ? `<table><thead><tr><th>${esc(s.heads?.[0] || '현 행')}</th><th>${esc(s.heads?.[1] || '개 정 안')}</th></tr></thead><tbody>${s.rows.map((r) => `<tr><td>${r.oldHtml}</td><td>${r.newHtml}</td></tr>`).join('')}</tbody></table>` : `<div class="pre">${nl(esc(s.body))}</div>`}</section>`).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(set.title)}</title><style>body{font-family:"Malgun Gothic","Noto Sans KR",sans-serif;max-width:900px;margin:24px auto;line-height:1.7;color:#111}h1{font-size:22px;text-align:center}h2{font-size:17px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:28px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #444;padding:6px 8px;vertical-align:top;font-size:14px}th{background:#eee}.pre{white-space:normal}.notice{border:1px solid #c33;color:#900;padding:6px 10px;font-size:13px}u{text-decoration-thickness:2px}@media print{.notice{break-inside:avoid}}</style></head><body><h1>${esc(set.title)}${set.kind ? ` (${esc(set.kind)}안)` : ''}</h1><p class="notice">${NOTICE}</p>${body}<section><h2>근거 자료</h2><ol>${(set.evidence || []).map((e) => `<li>${esc(e.label || '')} — ${esc(e.doc_id)} ${esc(e.ref || '')} ${e.edition ? `(${esc(e.edition)})` : ''}</li>`).join('')}</ol></section></body></html>`;
}
