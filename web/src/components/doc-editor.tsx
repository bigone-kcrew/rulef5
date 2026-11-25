// 문서 한 건 편집기(본문 또는 신구조문대비표)와 내려받기. 고친 내용은 포커스를 벗어날 때 상위 상태에 저장한다.
import { toast } from 'sonner'
import { DownloadIcon, PencilIcon, PrinterIcon, SheetIcon, EyeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cleanHtml, download, downloadHwpx, fullTextBlocks, TAG_RE, toCsv, toHtml, toMd, type DocSet, type Section } from '@/lib/export'
import { useApp } from '@/lib/app-state'
import { useState } from 'react'
import { Spinner } from '@/components/ui/spinner'

// 개정 후 전문: 바뀐 조문 덩어리를 노란 칸으로 보여 주고, 「고치기」를 누르면 글자로 고친다
// marks: 바뀐 낱말(대비표의 개정안 밑줄) — 노란 칸 안에서 한 번 더 강조한다
const markWords = (t: string, words: string[]) => { const ws = [...new Set(words.filter((w) => w && w.length >= 2))].sort((a, b) => b.length - a.length); if (!ws.length) return [t]; const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`); return t.split(re).map((x, i) => (ws.includes(x) ? <mark key={i} className="mk-new">{x}</mark> : x)) }
function FullText({ section, onChange, marks = [] }: { section: Section; onChange: (s: Section) => void; marks?: string[] }) {
  const [edit, setEdit] = useState(false)
  const blocks = fullTextBlocks(section.body || ''), n = blocks.filter((b) => b.tag).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span><mark className="mk-new">노란 칸</mark> 이번에 바뀐 조문 {n}곳</span><Button variant="outline" size="xs" className="ml-auto" onClick={() => setEdit(!edit)}>{edit ? <><EyeIcon data-icon="inline-start" />바뀐 곳 보기</> : <><PencilIcon data-icon="inline-start" />글자 고치기</>}</Button></div>
      {edit ? <div className="doc-body text-[15px]" contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => onChange({ ...section, body: e.currentTarget.innerText })}>{section.body}</div>
        : <div className="doc-body text-[15px]">{blocks.map((b, i) => b.tag
          ? <div key={i} className="my-1 whitespace-pre-wrap rounded-r-md border-l-4 border-amber-400 bg-amber-50 py-1 pl-3 pr-2 dark:bg-amber-500/10">{b.text.split(new RegExp(`(${TAG_RE.source})`)).filter((x) => x !== undefined && !/^(개정|신설|삭제|조 번호 이동|이번 개정)$/.test(x)).map((x, k) => TAG_RE.test(x) ? <span key={k} className="mx-1 rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">{x.replace(/[〈〉]/g, '')}</span> : <span key={k}>{markWords(x, marks)}</span>)}</div>
          : <div key={i} className="whitespace-pre-wrap">{b.text}</div>)}</div>}
    </div>
  )
}

export function DocEditor({ section, onChange, marks }: { section: Section; onChange: (s: Section) => void; marks?: string[] }) {
  if (section.id === 'full_text' && section.body) return <FullText section={section} onChange={onChange} marks={marks} />
  if (section.rows) {
    return (
      <div className="overflow-x-auto">
        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span><u className="rounded bg-red-500/20 px-1 decoration-red-600 decoration-2 underline-offset-4">빨강</u> 현행에서 바뀌는 부분</span><span><u className="rounded bg-yellow-400/45 px-1 font-semibold decoration-yellow-600 decoration-2 underline-offset-4">노랑·굵게</u> 개정안에서 새로 들어간 부분</span><span>칸을 눌러 바로 고칠 수 있습니다</span></p>
        <p className="mb-1 text-xs text-muted-foreground sm:hidden">표를 옆으로 밀면 {section.heads?.[1] || '개 정 안'} 열이 보입니다 →</p>
        <Table className="cmp min-w-[560px] table-fixed">
          <TableHeader><TableRow><TableHead className="w-1/2 text-center">{section.heads?.[0] || '현 행'}</TableHead><TableHead className="w-1/2 text-center">{section.heads?.[1] || '개 정 안'}</TableHead></TableRow></TableHeader>
          <TableBody onBlur={(e) => { const trs = [...e.currentTarget.querySelectorAll('tr')]; onChange({ ...section, rows: trs.map((tr, k) => ({ ref: section.rows![k]?.ref || '', oldHtml: cleanHtml((tr as HTMLTableRowElement).cells[0].innerHTML), newHtml: cleanHtml((tr as HTMLTableRowElement).cells[1].innerHTML) })) }) }}>
            {section.rows.map((r, k) => <TableRow key={k}><TableCell className="whitespace-normal align-top leading-7" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: r.oldHtml }} /><TableCell className="whitespace-normal align-top leading-7" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: r.newHtml }} /></TableRow>)}
          </TableBody>
        </Table>
      </div>
    )
  }
  return <div className="doc-body text-[15px]" contentEditable suppressContentEditableWarning spellCheck={false} onBlur={(e) => onChange({ ...section, body: e.currentTarget.innerText })}>{section.body}</div>
}

export function DocActions({ ds, name }: { ds: DocSet; name: string }) {
  const fname = (ext: string) => `${name}.${ext}`.replace(/[\\/:*?"<>|\s]+/g, '_')
  const rows = ds.sections.filter((s) => s.rows).flatMap((s) => s.rows!)
  const { status } = useApp(); const [hw, setHw] = useState(false)
  return (
    <div className="flex flex-wrap gap-2">
      {status?.features?.hwpx && <Button variant="outline" size="sm" disabled={hw} onClick={async () => { setHw(true); try { await downloadHwpx(fname('hwpx'), ds) } catch (e) { toast.error(`한글(hwpx) 파일을 만들지 못했습니다: ${(e as Error).message}`) } finally { setHw(false) } }}>{hw ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}한글(hwpx)</Button>}
      <Button variant="outline" size="sm" onClick={() => download(fname('html'), toHtml(ds), 'text/html')}><DownloadIcon data-icon="inline-start" />문서(HTML·인쇄용)</Button>
      <Button variant="outline" size="sm" onClick={() => download(fname('md'), toMd(ds), 'text/markdown')}><DownloadIcon data-icon="inline-start" />Markdown</Button>
      {rows.length > 0 && <Button variant="outline" size="sm" onClick={() => download(fname('csv'), toCsv(rows), 'text/csv')}><SheetIcon data-icon="inline-start" />대비표 CSV</Button>}
      <Button variant="outline" size="sm" onClick={() => { const w = window.open('', '_blank'); if (!w) return; w.document.write(toHtml(ds)); w.document.close(); w.focus(); w.print() }}><PrinterIcon data-icon="inline-start" />인쇄</Button>
    </div>
  )
}
