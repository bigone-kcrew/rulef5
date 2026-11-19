// 결과 문서 세트 내보내기(편집한 내용 기준)
export type Row = { ref: string; oldHtml: string; newHtml: string }
export type Section = { id: string; title: string; body?: string; rows?: Row[]; heads?: [string, string] }
export type DocSet = { kind: string; title: string; sections: Section[]; evidence: { label: string; doc_id: string; ref?: string; edition?: string }[] }
export const NOTICE = 'AI 초안입니다. 담당자가 원문과 대조·검토해야 합니다.'
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 표 셀은 <u>·<br>만 남긴다(붙여넣기 등으로 들어온 다른 태그 제거)
export function cleanHtml(html: string) {
  const d = document.createElement('div'); d.innerHTML = html
  const walk = (n: Node) => { for (const c of [...n.childNodes]) { if (c.nodeType === 1) { const el = c as Element; if (!['U', 'BR'].includes(el.tagName)) { walk(el); el.replaceWith(...el.childNodes) } else { [...el.attributes].forEach((a) => el.removeAttribute(a.name)); walk(el) } } } }
  walk(d); return d.innerHTML
}
const plain = (html: string) => { const d = document.createElement('div'); d.innerHTML = String(html).replace(/<br\s*\/?>/g, '\n'); return d.textContent || '' }
const ev = (ds: DocSet) => ds.evidence.map((e, i) => `${i + 1}. ${e.label} — ${e.doc_id}${e.ref ? ' ' + e.ref : ''}${e.edition ? ` (${e.edition})` : ''}`)
export function toMd(ds: DocSet) {
  return [`# ${ds.title} (${ds.kind}안)`, `> ${NOTICE}`, ...ds.sections.flatMap((s) => [`## ${s.title}`, s.rows ? ['| 현행 | 개정안 |', '| --- | --- |', ...s.rows.map((r) => `| ${cleanHtml(r.oldHtml).replace(/\|/g, '\\|')} | ${cleanHtml(r.newHtml).replace(/\|/g, '\\|')} |`)].join('\n') : s.body || '']), '## 근거 자료', ...ev(ds), `---\n${NOTICE}`].join('\n\n') + '\n'
}
export function toHtml(ds: DocSet) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(ds.title)}</title><style>body{font-family:"Malgun Gothic","Noto Sans KR",sans-serif;max-width:900px;margin:24px auto;line-height:1.7}h1{text-align:center;font-size:22px}h2{font-size:17px;border-bottom:2px solid #333;margin-top:28px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #444;padding:6px 8px;vertical-align:top;font-size:14px}th{background:#eee}.pre{white-space:pre-wrap}.n{border:1px solid #c33;color:#900;padding:6px 10px;font-size:13px}u{text-decoration-thickness:2px}</style></head><body><h1>${esc(ds.title)} (${esc(ds.kind)}안)</h1><p class="n">${NOTICE}</p>${ds.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.rows ? `<table><thead><tr><th>${esc(s.heads?.[0] || '현 행')}</th><th>${esc(s.heads?.[1] || '개 정 안')}</th></tr></thead><tbody>${s.rows.map((r) => `<tr><td>${cleanHtml(r.oldHtml)}</td><td>${cleanHtml(r.newHtml)}</td></tr>`).join('')}</tbody></table>` : `<div class="pre">${esc(s.body)}</div>`}`).join('')}<h2>근거 자료</h2><ol>${ds.evidence.map((e) => `<li>${esc(e.label)} — ${esc(e.doc_id)} ${esc(e.ref || '')} ${e.edition ? `(${esc(e.edition)})` : ''}</li>`).join('')}</ol></body></html>`
}
export function toCsv(rows: Row[]) { const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s); return '﻿조문,현행,개정안\r\n' + rows.map((r) => [r.ref, plain(r.oldHtml), plain(r.newHtml)].map(q).join(',') + '\r\n').join('') }
export function download(name: string, text: string, type: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` })); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000) }
export function tableCsv(rows: Record<string, unknown>[], cols: [string, string][]) { const q = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s); return '﻿' + cols.map((c) => c[1]).join(',') + '\r\n' + rows.map((r) => cols.map(([k]) => q(String(r[k] ?? ''))).join(',') + '\r\n').join('') }
