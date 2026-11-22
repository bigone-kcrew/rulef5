// 원문 보기: 근거·타 기관 조항·후보 조문 등을 누르면 해당 조항과 문서 전체를 보여 준다(ALIO·법제처·올린 자료 모두)
import { useEffect, useRef, useState } from 'react'
import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { api, EDITION, type Doc } from '@/lib/api'

// 원문 본문을 읽기 좋게: 항(①)·호(1.)·목(가.) 들여쓰기, 마크다운 표 → 표, 연혁 표기(<개정 …>)는 작고 흐리게, 빈 줄·#·** 정리
const HIST = /(<\s*(?:개정|신설|삭제|전문개정|본조신설|제목개정|종전)[^<>]{0,80}>|\[(?:개정|신설|본조신설|전문개정|제목개정|종전|본조\s*신설)[^\]]{0,80}\]|[(（]\s*(?:개정|신설|삭제)\s*[^()（）]{0,60}\d[^()（）]{0,40}[)）]|\^\([^)]*\))/g
function Hist({ text }: { text: string }) {
  const parts = text.split(HIST)
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="ml-1 text-xs text-muted-foreground">{p}</span> : p))}</>
}
const level = (l: string) => (/^[①-⑳]/.test(l) ? 0 : /^\d{1,2}\.\s/.test(l) ? 1 : /^[가-하]\.\s/.test(l) ? 2 : /^\d{1,2}\)\s/.test(l) ? 3 : -1)
// 표 줄: 「|」로 시작하거나, 칸 구분 「|」이 셋 이상(원본에서 앞 「|」가 빠진 행)
const isRow = (l: string) => /^\|/.test(l) || l.split('|').length >= 4
export function Body({ text, skipFirst = null }: { text: string; skipFirst?: string | null }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim()).filter(Boolean)
  // 제목과 같은 첫 줄(「[별표 1] <개정 …>」)은 한 번만 보이게
  if (skipFirst && lines[0] && lines[0].replace(/[#\[\]\s]/g, '').startsWith(skipFirst.replace(/[#\[\]\s]/g, '').slice(0, 6))) lines.shift()
  const out: React.ReactNode[] = []; let last = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (isRow(l)) { // 표: 이어지는 |…| 줄을 묶고 구분선(---)은 뺀다
      const rows: string[][] = []
      while (i < lines.length && isRow(lines[i])) { if (!/^\|[\s:|-]+\|?$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim())); i++ }
      i--
      out.push(<div key={i} className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{rows.map((r, k) => <tr key={k} className={k === 0 ? 'bg-muted/50 font-medium' : ''}>{r.map((c, m) => <td key={m} className="border px-2 py-1 align-top"><Hist text={c} /></td>)}</tr>)}</table></div>)
      continue
    }
    const lv = level(l); if (lv >= 0) last = lv
    const pad = lv >= 0 ? lv : last + 1 > 3 ? 3 : last // 이어지는 줄은 앞 단계에 맞춘다
    out.push(<p key={i} className="leading-7" style={{ paddingLeft: `${(lv >= 0 ? lv : pad) * 1.25}rem`, textIndent: lv >= 0 ? (lv === 0 ? '-1.1em' : '-1.3em') : 0, marginLeft: lv >= 0 ? (lv === 0 ? '1.1em' : '1.3em') : 0 }}><Hist text={l} /></p>)
  }
  return <div className="flex flex-col gap-0.5">{out}</div>
}

// 열 수 있는 문서인지(직접 입력·없는 ID 제외)
export const canView = (docId?: string | null) => !!docId && /^(bylaws|legal|ca|disclosure|law|upload):/.test(docId)
const SEC_ORDER = ['본칙', '부칙', '별표']
// 법제처 자료는 국가법령정보센터 원문 주소(이름으로 찾기)
const lawGoUrl = (doc: Doc) => { const m = doc.doc_id.match(/^law:(law|admrul|ordin):/); if (!m) return null; const kind = { law: '법령', admrul: '행정규칙', ordin: '자치법규' }[m[1]]; return `https://www.law.go.kr/${kind}/${encodeURIComponent(doc.title.replace(/\s+/g, ''))}` }

export function DocViewer({ docId, refName, section, open, onOpenChange, hint }: { docId: string; refName?: string | null; section?: string | null; open: boolean; onOpenChange: (v: boolean) => void; hint?: string }) {
  const [doc, setDoc] = useState<Doc | null>(null); const [err, setErr] = useState(''); const [tab, setTab] = useState('article')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!open || doc?.doc_id === docId) return; setErr(''); setDoc(null); api<Doc>('/api/doc?id=' + encodeURIComponent(docId)).then(setDoc).catch((e) => setErr((e as Error).message)) }, [open, docId]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = String(refName || '').replace(/\s+/g, '').match(/^제\d+조(의\d+)?/)?.[0] || null
  const sec = section || '본칙'
  const art = doc && ref ? doc.articles.find((a) => a.ref === ref && a.section === sec) || doc.articles.find((a) => a.ref === ref) : null
  useEffect(() => { setTab(art ? 'article' : 'all') }, [art?.ref, doc?.doc_id]) // eslint-disable-line react-hooks/exhaustive-deps
  // 전체 문서 탭을 열면 해당 조문 위치로 스크롤
  useEffect(() => { if (tab === 'all' && ref) setTimeout(() => box.current?.querySelector(`[data-ref="${ref}"]`)?.scrollIntoView({ block: 'start' }), 50) }, [tab, ref])
  const link = doc ? lawGoUrl(doc) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">{doc ? <>{doc.inst ? `${doc.inst} ` : ''}「{doc.title}」{ref && <Badge variant="secondary">{sec === '부칙' ? '부칙 ' : ''}{ref}</Badge>}</> : '원문 불러오는 중'}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {doc?.edition?.state && doc.edition.state !== 'unknown' && <Badge variant={doc.edition.state === 'current' ? 'outline' : 'destructive'}>{EDITION[doc.edition.state] || doc.edition.state}</Badge>}
            {doc?.edition?.effective_from && <span>시행 {doc.edition.effective_from}</span>}
            <span>{doc ? (doc.source === 'law' ? '법제처 국가법령정보' : doc.doc_id.startsWith('upload:') ? '올린 자료' : 'ALIO 공시') : ''}</span>
            {link && <a href={link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline underline-offset-4">국가법령정보센터에서 보기<ExternalLinkIcon className="size-3" /></a>}
            {hint && <span className="text-muted-foreground">· {hint}</span>}
          </DialogDescription>
        </DialogHeader>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!doc && !err && <div className="flex justify-center p-8"><Spinner /></div>}
        {doc && (
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col">
            <TabsList>{art && <TabsTrigger value="article">해당 조항</TabsTrigger>}<TabsTrigger value="all">문서 전체({doc.articles.filter((a) => a.section === '본칙').length}개 조문)</TabsTrigger></TabsList>
            {art && <TabsContent value="article" className="min-h-0 overflow-y-auto"><div className="rounded-md border bg-muted/30 p-4"><div className="mb-2 font-semibold">{art.ref}{art.title ? `(${art.title})` : ''}</div><div className="text-sm"><Body text={art.body} /></div></div></TabsContent>}
            <TabsContent value="all" className="min-h-0 overflow-y-auto">
              <div ref={box} className="flex flex-col gap-3 text-sm leading-7">
                {SEC_ORDER.map((sec) => { const list = doc.articles.filter((a) => a.section === sec); if (!list.length) return null; return (
                  <section key={sec} className="flex flex-col gap-2">
                    {sec !== '본칙' && <h3 className="mt-2 font-semibold">{sec === '부칙' ? '부 칙' : '별 표'}</h3>}
                    {list.map((a, i) => { const head = !a.ref && /^\s*#*\s*부\s*칙/.test(a.body || '') ; return head ? <div key={i} className="mt-3 border-t pt-2 text-sm font-semibold">{String(a.body).replace(/^\s*#+\s*/, '').split('\n')[0]}</div> : <div key={i} data-ref={a.section === '본칙' ? a.ref || undefined : undefined} className={`rounded-md px-3 py-2 ${a.section === '본칙' && a.ref === ref ? 'border border-primary bg-primary/5' : ''}`}>{(a.ref || a.title) && <div className="font-medium">{a.ref ? `${a.ref}${a.title ? `(${a.title})` : ''}` : String(a.title).replace(/^#+\s*/, '')}</div>}<Body text={a.body} skipFirst={a.section === '별표' ? String(a.title || '') : null} /></div> })}
                  </section>) })}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

// 누르면 원문 창을 여는 글자 단추. docId 가 열 수 없는 값이면 그냥 글자만 보인다
export function DocLink({ docId, refName, section, children, className = '', hint }: { docId?: string | null; refName?: string | null; section?: string | null; children: React.ReactNode; className?: string; hint?: string }) {
  const [open, setOpen] = useState(false)
  if (!canView(docId)) return <>{children}</>
  return (
    <>
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }} className={`inline-flex items-baseline gap-1 text-left underline decoration-dotted underline-offset-4 hover:text-primary ${className}`} title="원문 보기">
        {children}<FileTextIcon className="size-3 shrink-0 self-center opacity-60" />
      </button>
      {open && <DocViewer docId={docId!} refName={refName} section={section} open={open} onOpenChange={setOpen} hint={hint} />}
    </>
  )
}
