// 원문 검색(모델 없이): ALIO RAG 키워드·의미·통합 검색과 법제처 행정규칙·자치법규 검색. 결과를 누르면 원문을 연다
import { useEffect, useRef, useState } from 'react'
import { DownloadIcon, SearchIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DocViewer } from '@/components/doc-viewer'
import { InstPicker } from '@/components/inst-picker'
import { api, EDITION } from '@/lib/api'
import { useApp } from '@/lib/app-state'
import { download, tableCsv } from '@/lib/export'

type Row = { doc_id: string; inst_name?: string; ministry?: string; doc_title: string; doc_type?: string; corpus?: string; art_ref?: string; art_title?: string; section?: string; body?: string; effective_from?: string; doc_date?: string; edition_state?: string }
const CORPUS: [string, string][] = [['bylaws', '기관 내규'], ['legal', '법령'], ['ca', '단체협약'], ['disclosure', '공시자료'], ['all', '전체(ALIO)']]
const MODES: [string, string, string][] = [['keyword', '키워드', '낱말이 그대로 들어간 곳'], ['semantic', '의미', '뜻이 비슷한 곳(낱말이 달라도)'], ['hybrid', '통합', '키워드와 의미를 함께']]
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
// 본문에서 검색어 주변을 잘라 낱말을 굵게 표시
function snippet(body: string, q: string) {
  const t = String(body || '').replace(/\s+/g, ' '), words = q.split(/\s+/).filter((w) => w.length >= 2)
  const i = Math.max(0, Math.min(...words.map((w) => { const k = t.indexOf(w); return k < 0 ? Infinity : k }).concat([Infinity])))
  const start = Number.isFinite(i) ? Math.max(0, i - 60) : 0, part = t.slice(start, start + 220)
  let html = esc(part); for (const w of words) html = html.split(esc(w)).join(`<mark>${esc(w)}</mark>`)
  return (start > 0 ? '…' : '') + html + (start + 220 < t.length ? '…' : '')
}

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profile, status } = useApp()
  const gov = profile.type !== 'public-institution', govCorpus: [string, string] | null = profile.type === 'local-gov' ? ['ordin', '자치법규(법제처)'] : profile.type === 'central-ministry' ? ['admrul', '행정규칙(법제처)'] : null
  const corpora = govCorpus && (status?.data?.law_go || sessionStorage.getItem('regitda.lawoc')) ? [govCorpus, ...CORPUS] : CORPUS
  const [q, setQ] = useState(''); const [mode, setMode] = useState('hybrid'); const [corpus, setCorpus] = useState('bylaws')
  const [inst, setInst] = useState(''); const [ministry, setMinistry] = useState(''); const [body, setBody] = useState(true); const [group, setGroup] = useState(false)
  const [limit, setLimit] = useState(30); const [sort, setSort] = useState('relevance')
  const [rows, setRows] = useState<Row[] | null>(null); const [more, setMore] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ms, setMs] = useState<number | null>(null)
  const [view, setView] = useState<Row | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50) }, [open])
  useEffect(() => { if (gov && govCorpus && corpus === 'bylaws' && rows === null) setCorpus(govCorpus[0]) }, [gov]) // eslint-disable-line react-hooks/exhaustive-deps
  const isGov = corpus === 'ordin' || corpus === 'admrul'
  const run = async (offset = 0) => {
    if (!q.trim()) return
    setBusy(true); setErr(''); const t0 = Date.now()
    try {
      const r = await api<{ rows: Row[]; has_more?: boolean }>('/api/search', { method: 'POST', body: isGov
        ? { keyword: q.trim(), corpus, inst: inst.trim() || undefined, body, limit }
        : { keyword: q.trim(), corpus, inst: inst.trim() || undefined, ministry: ministry.trim() || undefined, hybrid: mode === 'hybrid' || undefined, semantic: mode === 'semantic' || undefined, body: body || undefined, distinct_inst: group || undefined, limit, offset: offset || undefined } })
      setRows(offset ? [...(rows || []), ...r.rows] : r.rows); setMore(!isGov && (!!r.has_more || r.rows.length >= limit)); setMs(Date.now() - t0)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const shown = rows ? (sort === 'recent' ? [...rows].sort((a, b) => String(b.effective_from || b.doc_date || '').localeCompare(String(a.effective_from || a.doc_date || ''))) : rows) : null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SearchIcon className="size-5" />원문 검색</DialogTitle>
          <DialogDescription>AI 모델 없이 ALIO RAG(공공기관 공시 내규·법령·단체협약·공시자료){govCorpus ? '와 법제처 국가법령정보' : ''}에서 바로 찾습니다. 결과를 누르면 원문이 열립니다.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(0) }}>
          <div className="flex gap-2"><Input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} placeholder="예: 배우자 출산휴가 · 육아휴직 대체인력 · 당직 휴무" /><Button type="submit" disabled={!q.trim() || busy}>{busy ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}검색</Button></div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="자료 범위" value={corpus} onChange={(e) => { const v = e.target.value; if ((v === 'ordin' || v === 'admrul') !== isGov) setInst(''); setCorpus(v); setRows(null) }} className="h-8 rounded-md border bg-background px-2 text-sm">{corpora.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {!isGov && <ToggleGroup value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0])} variant="outline" size="sm">{MODES.map(([v, l, t]) => <ToggleGroupItem key={v} value={v} title={t}>{l}</ToggleGroupItem>)}</ToggleGroup>}
            <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={body} onCheckedChange={(c) => setBody(!!c)} />본문까지</label>
            {!isGov && <label className="flex items-center gap-1.5 text-sm" title="기관마다 가장 관련 높은 1건만 — 여러 기관 사례를 비교할 때"><Checkbox checked={group} onCheckedChange={(c) => setGroup(!!c)} />기관별 1건</label>}
            <select aria-label="결과 수" value={limit} onChange={(e) => setLimit(+e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm">{[15, 30, 50, 100].map((n) => <option key={n} value={n}>{n}건</option>)}</select>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <InstPicker lazy type={isGov ? profile.type : 'public-institution'} value={inst} onPick={(_, t) => setInst(t)} placeholder={isGov ? (profile.type === 'local-gov' ? '지자체(선택) 예: 경기도 수원시' : '부처(선택) 예: 고용노동부') : '기관(선택) 예: 근로복지공단'} />
            {!isGov && <Input value={ministry} onChange={(e) => setMinistry(e.target.value)} maxLength={30} placeholder="주무부처(선택) 예: 고용노동부" />}
          </div>
        </form>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {shown && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{shown.length}건{ms != null ? ` · ${(ms / 1000).toFixed(1)}초` : ''}{isGov ? ' · 법제처(문서 단위)' : ''}</span>
              <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value)} className="ml-auto h-7 rounded-md border bg-background px-2 text-xs"><option value="relevance">관련도순</option><option value="recent">최신순</option></select>
              {shown.length > 0 && <Button variant="outline" size="xs" onClick={() => download(`원문검색_${q.trim().slice(0, 20)}.csv`, tableCsv(shown.map((r) => ({ ...r, excerpt: String(r.body || '').replace(/\s+/g, ' ').slice(0, 300) })), [['inst_name', '기관'], ['doc_title', '문서'], ['art_ref', '조문'], ['art_title', '제목'], ['corpus', '자료'], ['effective_from', '시행일'], ['excerpt', '발췌']]), 'text/csv')}><DownloadIcon data-icon="inline-start" />CSV</Button>}
            </div>
            {!shown.length && <p className="text-sm text-muted-foreground">{isGov ? `결과가 없습니다. 낱말을 줄이거나 ${inst ? '기관 이름을 비워' : '「본문까지」를 켜'} 보세요.` : '결과가 없습니다. 검색 방식을 「의미」나 「통합」으로 바꾸거나 낱말을 줄여 보세요.'}</p>}
            <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
              {shown.map((r, i) => (
                <li key={`${r.doc_id}#${r.art_ref}#${i}`}>
                  <button type="button" onClick={() => setView(r)} className="flex w-full flex-col items-start gap-0.5 rounded-md border bg-card px-3 py-2 text-left hover:bg-muted/60">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{r.inst_name && <span>{r.inst_name}</span>}<span>「{r.doc_title}」</span>{r.art_ref && <span>{r.section === '부칙' ? '부칙 ' : ''}{r.art_ref}{r.art_title ? `(${r.art_title})` : ''}</span>}{r.edition_state && r.edition_state !== 'current' && <Badge variant="destructive">{EDITION[r.edition_state] || r.edition_state}</Badge>}{r.corpus && corpus === 'all' && <Badge variant="outline">{CORPUS.find(([v]) => v === r.corpus)?.[1] || r.corpus}</Badge>}</span>
                    {r.body && <span className="text-xs leading-relaxed text-muted-foreground [&_mark]:bg-primary/15 [&_mark]:text-foreground" dangerouslySetInnerHTML={{ __html: snippet(r.body, q) }} />}
                    {!r.body && <span className="text-xs text-muted-foreground">{r.doc_type || ''}{r.effective_from ? ` · 시행 ${r.effective_from}` : ''}</span>}
                  </button>
                </li>
              ))}
              {more && <li className="flex justify-center py-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => run(rows!.length)}>{busy ? <Spinner data-icon="inline-start" /> : null}더 보기</Button></li>}
            </ol>
          </div>
        )}
        {view && <DocViewer docId={view.doc_id} refName={view.art_ref} section={view.section} open={!!view} onOpenChange={(v) => !v && setView(null)} />}
      </DialogContent>
    </Dialog>
  )
}
