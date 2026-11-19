// 결과 문서 세트: 한눈에 보는 요약 보드 + 문서별 편집기 + 내보내기
import { DocLink } from '@/components/doc-viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { animate, motion, useInView } from 'motion/react'
import { FileTextIcon, ColumnsIcon, ScrollTextIcon, StampIcon, MegaphoneIcon, LinkIcon, ListChecksIcon, LibraryIcon, DownloadIcon, PrinterIcon, SheetIcon, PencilIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApp } from '@/lib/app-state'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { JobTimeline } from '@/components/job-timeline'
import { useJob } from '@/hooks/use-job'
import { MessageSquareQuoteIcon } from 'lucide-react'
import { download, downloadHwpx, toCsv, toHtml, toMd, type DocSet, type Section } from '@/lib/export'

const ICONS: Record<string, typeof FileTextIcon> = { draft: FileTextIcon, comparison: ColumnsIcon, comparison_other: ColumnsIcon, reason: ScrollTextIcon, addenda: StampIcon, notice: MegaphoneIcon, corrections: LinkIcon, checklist: ListChecksIcon, evidence: LibraryIcon }

export function Counter({ value, label }: { value: number; label: string }) {
  const ref = useRef<HTMLSpanElement>(null); const inView = useInView(ref, { once: true })
  useEffect(() => { if (!inView || !ref.current || !value) return; const c = animate(0, value, { duration: 0.9, ease: 'easeOut', onUpdate: (v) => { if (ref.current) ref.current.textContent = String(Math.round(v)) } }); return () => c.stop() }, [inView, value])
  return <div className="rounded-lg border p-4"><span ref={ref} className="text-3xl font-semibold tabular-nums">{value}</span><div className="text-xs text-muted-foreground">{label}</div></div>
}

const preview = (s: Section) => s.rows ? s.rows.slice(0, 2).map((r) => r.newHtml.replace(/<[^>]+>/g, '').replace(/&(quot|amp|lt|gt|#39|nbsp);/g, (_, k: string) => ({ quot: '"', amp: '&', lt: '<', gt: '>', '#39': "'", nbsp: ' ' } as Record<string, string>)[k])).join(' / ') : (s.body || '').split('\n').filter(Boolean).slice(0, 3).join(' ')

export function DocsetBoard({ result }: { result: any }) {
  const { setDocKeys, status } = useApp(); const [hw, setHw] = useState(false)
  const ds: DocSet = result.docset
  const [active, setActive] = useState(ds.sections[0]?.id)
  const editors = useRef<Record<string, HTMLElement | null>>({})
  useEffect(() => { setDocKeys(new Set(result.docKeys || ds.sections.map((s) => s.id))) }, [result, ds, setDocKeys])
  const stats = useMemo(() => {
    const cmp = ds.sections.find((s) => s.id === 'comparison')
    // 일괄 개정은 여러 규정에 같은 조 번호가 있으므로 규정별 조문 수를 더한다
    const changed = Array.isArray(result.per_doc) ? result.per_doc.reduce((n: number, p: any) => n + (p.n || 0), 0) : new Set((cmp?.rows || []).filter((r) => r.newHtml !== '(현행과 같음)').map((r) => r.ref)).size
    const checks = (ds.sections.find((s) => s.id === 'checklist')?.body || '').split('\n').filter((l) => l.startsWith('☐')).length
    return [[changed, ds.kind === '제정' ? '조문' : '변경 조문'], [cmp?.rows?.length || 0, '대비표 행'], [ds.evidence.filter((e) => !/^대상 규정/.test(e.label)).length, '근거 자료'], [checks, '검토 항목']] as [number, string][]
  }, [ds])
  // 편집된 현재 내용
  const current = (): DocSet => ({ ...ds, sections: ds.sections.map((s) => { const el = editors.current[s.id]; if (!el) return s; if (s.rows) return { ...s, rows: [...el.querySelectorAll('tbody tr')].map((tr, k) => ({ ref: s.rows![k]?.ref || '', oldHtml: (tr as HTMLTableRowElement).cells[0].innerHTML, newHtml: (tr as HTMLTableRowElement).cells[1].innerHTML })) }; return { ...s, body: el.innerText } }) })
  const fname = (ext: string) => `${ds.title}_${ds.kind}안.${ext}`.replace(/[\\/:*?"<>|\s]+/g, '_')
  const sec = ds.sections.find((s) => s.id === active)
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">결과 문서 세트 — {ds.title} <Badge>{ds.kind}안</Badge></CardTitle>
          <CardDescription>AI 초안입니다. 담당자가 원문과 대조·검토해야 합니다. 문서를 고르면 아래에서 바로 고칠 수 있고, 고친 내용으로 내보냅니다.{result.model && ` · 작성 모델 ${result.model.model}`}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{stats.map(([v, l]) => <Counter key={l} value={v} label={l} />)}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...ds.sections, { id: 'evidence', title: '근거 자료', body: ds.evidence.map((e) => e.label).join('\n') }].map((s, i) => {
              const I = ICONS[s.id] || FileTextIcon
              return (
                <motion.button key={s.id} type="button" onClick={() => setActive(s.id)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i, duration: 0.25 }}
                  className={`flex min-h-24 flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${active === s.id ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted/50'}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold"><I className="size-4" />{s.title}</span>
                  <span className={`line-clamp-2 text-xs ${active === s.id ? 'text-background/70' : 'text-muted-foreground'}`}>{preview(s as Section)}</span>
                </motion.button>
              )
            })}
          </div>
          <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border bg-background">
            <div className="flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold"><PencilIcon className="size-4 text-muted-foreground" />{active === 'evidence' ? '근거 자료' : sec?.title}<span className="ml-auto text-xs font-normal text-muted-foreground">{active === 'evidence' ? '' : '바로 편집할 수 있습니다'}</span></div>
            {ds.sections.map((s) => (
              <div key={s.id} hidden={s.id !== active} className="p-4">
                {s.rows ? (
                  <Table className="cmp table-fixed">
                    <TableHeader><TableRow><TableHead className="w-1/2 text-center">{s.heads?.[0] || '현 행'}</TableHead><TableHead className="w-1/2 text-center">{s.heads?.[1] || '개 정 안'}</TableHead></TableRow></TableHeader>
                    <TableBody ref={(el) => { editors.current[s.id] = el?.closest('table') || null }}>
                      {s.rows.map((r, k) => <TableRow key={k}><TableCell className="whitespace-normal align-top leading-7" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: r.oldHtml }} /><TableCell className="whitespace-normal align-top leading-7" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: r.newHtml }} /></TableRow>)}
                    </TableBody>
                  </Table>
                ) : (
                  <div ref={(el) => { editors.current[s.id] = el }} contentEditable suppressContentEditableWarning spellCheck={false} className="min-h-40 whitespace-pre-wrap leading-8 outline-none">{s.body}</div>
                )}
              </div>
            ))}
            <div hidden={active !== 'evidence'} className="p-4"><ol className="flex flex-col gap-2 text-sm">{ds.evidence.map((e, i) => <li key={i} className="rounded-lg border bg-muted/30 px-3 py-2"><div className="font-medium"><DocLink docId={e.doc_id} refName={e.ref}>{e.label}</DocLink></div><div className="break-all text-xs text-muted-foreground">{e.doc_id}{e.ref ? ` ${e.ref}` : ''}{e.edition ? ` · ${e.edition}` : ''}</div></li>)}</ol></div>
          </motion.div>
        </CardContent>
        {Array.isArray(result.changes) && result.changes.length > 0 && <CardContent><OpinionPanel result={result} /></CardContent>}
        <CardFooter className="flex flex-wrap gap-2">
          {status?.features?.hwpx && <Button disabled={hw} onClick={async () => { setHw(true); try { await downloadHwpx(fname('hwpx'), current()) } catch (e) { window.alert((e as Error).message) } finally { setHw(false) } }}>{hw ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}한글(hwpx)</Button>}
          <Button variant={status?.features?.hwpx ? 'outline' : 'default'} onClick={() => download(fname('md'), toMd(current()), 'text/markdown')}><DownloadIcon data-icon="inline-start" />Markdown</Button>
          <Button variant="outline" onClick={() => download(fname('html'), toHtml(current()), 'text/html')}><DownloadIcon data-icon="inline-start" />문서(HTML·인쇄용)</Button>
          {ds.sections.some((s) => s.rows) && <Button variant="outline" onClick={() => download(fname('csv'), toCsv(current().sections.filter((s) => s.rows).flatMap((s) => s.rows!)), 'text/csv')}><SheetIcon data-icon="inline-start" />대비표 CSV</Button>}
          <Button variant="ghost" onClick={() => { const w = window.open('', '_blank'); if (!w) return; w.document.write(toHtml(current())); w.document.close(); w.focus(); w.print() }}><PrinterIcon data-icon="inline-start" />인쇄</Button>
        </CardFooter>
      </Card>
    </motion.div>
  )
}

// 의견 반영: 협조·예고 기간 의견을 붙여넣으면 AI 처리안 → 담당자가 반영할 의견 선택 → 반영 대비표·의견 검토서
function OpinionPanel({ result }: { result: any }) {
  const [open, setOpen] = useState(false); const [text, setText] = useState('')
  const job = useJob()
  const r = job.job?.status === 'done' ? job.job.result : null
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><MessageSquareQuoteIcon data-icon="inline-start" />의견 반영(협조·예고 의견 검토서)</Button>
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="text-sm font-medium">수렴 의견 붙여넣기</div>
      <p className="text-xs text-muted-foreground">의견마다 [부서명] 또는 "부서명:"으로 시작하거나 빈 줄 두 개로 나눠 주세요. 한글(hwp) 회신은 내용을 복사해 붙여넣으세요. 반영 여부는 담당자가 고릅니다.</p>
      <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'[인사팀] 제79조 분할 사용 횟수를 3회로 해 주십시오.\n\n[노동조합] 청구 기한 120일 반영 바랍니다.'} />
      <div className="flex justify-end"><Button disabled={!text.trim() || job.busy} onClick={() => job.start('opinions', { title: result.docset.title, kind: result.kind === '제정' ? '제정' : '개정', changes: result.changes, moves: result.moves, opinions_text: text, doc_id: result.doc?.doc_id })}>{job.busy && <Spinner data-icon="inline-start" />}처리안 만들기</Button></div>
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} title="의견 검토" />
      {r?.docset && <DocsetBoard result={r} />}
    </div>
  )
}
