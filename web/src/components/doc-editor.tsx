// 문서 한 건 편집기(본문 또는 신구조문대비표)와 내려받기. 고친 내용은 포커스를 벗어날 때 상위 상태에 저장한다.
import { toast } from 'sonner'
import { DownloadIcon, PrinterIcon, SheetIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cleanHtml, download, downloadHwpx, toCsv, toHtml, toMd, type DocSet, type Section } from '@/lib/export'
import { useApp } from '@/lib/app-state'
import { useState } from 'react'
import { Spinner } from '@/components/ui/spinner'

export function DocEditor({ section, onChange }: { section: Section; onChange: (s: Section) => void }) {
  if (section.rows) {
    return (
      <div className="overflow-x-auto">
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
