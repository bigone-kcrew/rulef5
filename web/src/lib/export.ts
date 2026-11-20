// 결과 문서 세트 내보내기(편집한 내용 기준)
export type Row = { ref: string; oldHtml: string; newHtml: string; doc_id?: string }
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
// 한글(hwpx): 본문 줄을 문단으로 살린 Markdown 을 서버(문서 변환 서비스)로 보내 hwpx 로 받는다
export function toMdHwpx(ds: DocSet) {
  // 한글 문서 변환기는 밑줄을 지원하지 않아, 대비표에서 바뀐 부분(<u>)은 굵게(**) 바꿔 표시한다
  const cell = (h: string) => plain(String(h || '').replace(/<u>([\s\S]*?)<\/u>/g, '\u27E6$1\u27E7')).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').replace(/\u27E6\s*([\s\S]*?)\s*\u27E7/g, (_, t: string) => (t.trim() ? `**${t.trim()}**` : ''))
  return [`# ${ds.title} (${ds.kind}안)`, `> ${NOTICE}`, ...ds.sections.flatMap((s) => [`## ${s.title}`, s.rows ? ['| 현행 | 개정안(바뀐 부분 굵게) |', '| --- | --- |', ...s.rows.map((r) => `| ${cell(r.oldHtml)} | ${cell(r.newHtml)} |`)].join('\n') : String(s.body || '').split('\n').filter((l) => l.trim()).join('\n\n')])].join('\n\n')
}
export async function downloadHwpx(name: string, ds: DocSet) {
  const r = await fetch('/api/hwpx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: toMdHwpx(ds) }) })
  if (!r.ok) { let m = `한글 변환 실패(${r.status})`; try { m = (await r.json()).error || m } catch { /* 무시 */ } throw new Error(m) }
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
// 화면에서 고친 신구조문대비표(개정안 칸)를 조문 본문으로 되돌린다 — 「개정 후 전문 다시 만들기」에 쓴다
export function changesFromRows(changes: any[], rows: Row[]) {
  const head = /^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/
  const txt = (h: string) => plain(h).trim()
  return (changes || []).map((c: any) => {
    if (c.op === 'delete') return c
    const rs = rows.filter((r) => r.ref === c.ref); if (!rs.length) return c
    const paras = rs.map((r, k) => {
      const n = txt(r.newHtml); let o = txt(r.oldHtml)
      if (k === 0) o = o.replace(/^\[[^\]\n]+\]\s*\n?/, '') // 일괄 개정 대비표의 「[규정명]」 머리 제거
      return n === '(현행과 같음)' ? o : /^<\s*삭\s*제\s*>$/.test(n) ? '' : n
    }).filter(Boolean)
    return { ...c, new: paras.map((p, i) => (i === 0 ? p.replace(head, '') : p)).join('\n') }
  })
}
