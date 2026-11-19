// 대상 규정 선택: ALIO 기관 규정 검색 · 파일/붙여넣기(부처·지자체) · 법령·행정규칙·자치법규
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileUpIcon, LandmarkIcon, SearchIcon, BookOpenIcon, CheckCircle2Icon, TriangleAlertIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { api, fileToB64, EDITION, type Doc } from '@/lib/api'
import { useApp } from '@/lib/app-state'

type Item = { doc_id: string; title: string; sub: string; badge?: string; state?: string | null }
export type Picked = { doc: Doc; uploads: string[]; refs: string[] }

export function TargetPicker({ onChange, showArticles = false, multi = false, initialDocId, initialRefs, sources: wanted = ['alio', 'upload'] }: { onChange: (p: Picked | null) => void; showArticles?: boolean; multi?: boolean; initialDocId?: string; initialRefs?: string[]; sources?: ('alio' | 'upload' | 'law')[] }) {
  const { profile } = useApp()
  // 중앙행정기관·지방자치단체는 ALIO(공공기관 내규) 대신 우리 기관 행정규칙·자치법규(법제처)를 고른다
  const govType = profile.type !== 'public-institution'
  const sources = wanted.map((x) => (x === 'alio' && govType ? 'gov' : x)) as ('alio' | 'gov' | 'upload' | 'law')[]
  const govWord = profile.type === 'local-gov' ? '자치법규' : '행정규칙'
  const [org, setOrg] = useState(/^예시 /.test(profile.name) ? '' : profile.name)
  const [tab, setTab] = useState<string>(sources[0])
  useEffect(() => { if (!sources.includes(tab as any)) setTab(sources[0]) }, [sources.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const [inst, setInst] = useState(profile.alio_inst || '')
  const [kw, setKw] = useState('')
  const inst0 = inst, kw0 = kw, org0 = org
  const [lawq, setLawq] = useState('')
  const [targets, setTargets] = useState<string[]>(['law'])
  const [paste, setPaste] = useState('')
  const [items, setItems] = useState<Record<string, Item[]>>({})
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [uploads, setUploads] = useState<string[]>([])
  const [refs, setRefs] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])

  useEffect(() => {
    if (!initialDocId) return
    setLoading('doc')
    api<Doc>('/api/doc?id=' + encodeURIComponent(initialDocId)).then((d) => { setDoc(d); setRefs(initialRefs || []); onChange({ doc: d, uploads: [], refs: initialRefs || [] }) }).catch((e) => setMsg({ alio: e.message })).finally(() => setLoading(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocId])
  const choose = async (id: string) => {
    if (multi) { const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; setPicked(next); onChange(next.length ? { doc: { doc_id: next[0] } as Doc, uploads: next, refs: [] } : null); return }
    setLoading('doc'); setRefs([])
    try { const d = await api<Doc>('/api/doc?id=' + encodeURIComponent(id)); setDoc(d); onChange({ doc: d, uploads, refs: [] }) } catch (e) { setMsg({ ...msg, [tab]: (e as Error).message }) } finally { setLoading(null) }
  }
  const searchAlio = async (i0?: string, k0?: string) => {
    const inst = i0 ?? inst0, kw = k0 ?? kw0
    if (!kw.trim() && !inst.trim()) return setMsg({ ...msg, alio: '기관명이나 규정명을 입력하세요.' })
    setLoading('alio'); setMsg({ ...msg, alio: '' })
    try {
      const r = await api('/api/search', { method: 'POST', body: { keyword: kw.trim() || '목적', inst: inst.trim() || undefined, corpus: 'bylaws', limit: 50, hybrid: !!kw.trim() || undefined } })
      const seen = new Map<string, any>(); for (const x of r.rows) if (!seen.has(x.doc_id)) seen.set(x.doc_id, x)
      setItems({ ...items, alio: [...seen.values()].map((x) => ({ doc_id: x.doc_id, title: x.doc_title, sub: `${x.inst_name || ''} · ${x.doc_type || ''} · ${x.effective_from || x.doc_date || ''}${kw ? ` · ${x.art_ref || ''} ${x.art_title || ''}` : ''}`, state: x.edition_state })) })
      if (!seen.size) setMsg({ ...msg, alio: r.degraded ? '검색 일부가 실패했습니다. 다시 시도하세요(0건이 없음을 뜻하지 않습니다).' : '결과가 없습니다.' })
    } catch (e) { setMsg({ ...msg, alio: (e as Error).message }) } finally { setLoading(null) }
  }
  const upload = async (files: { name: string; base64?: string; text?: string }[]) => {
    setLoading('upload'); setMsg({ ...msg, upload: '' })
    try {
      const r = await api('/api/upload', { method: 'POST', body: { files } })
      const ids = [...uploads, ...r.docs.map((d: any) => d.doc_id)]; setUploads(ids)
      setItems({ ...items, upload: [...(items.upload || []), ...r.docs.map((d: any) => ({ doc_id: d.doc_id, title: d.title, sub: `${d.file} · 조문 ${d.n_articles}개(부칙·별표 포함) · 원본 SHA-256 ${d.sha256.slice(0, 10)}… 읽기 전용 보관`, badge: '업로드' }))] })
      if (r.errors?.length) setMsg({ ...msg, upload: r.errors.map((e: any) => `${e.file}: ${e.error}`).join(' / ') })
      if (r.docs.length && multi) { const next = [...picked, ...r.docs.map((d: any) => d.doc_id)]; setPicked(next); onChange({ doc: { doc_id: next[0] } as Doc, uploads: next, refs: [] }) }
      if (r.docs.length && !multi) { const d = await api<Doc>('/api/doc?id=' + encodeURIComponent(r.docs[0].doc_id)); setDoc(d); onChange({ doc: d, uploads: ids, refs: [] }) }
    } catch (e) { setMsg({ ...msg, upload: (e as Error).message }) } finally { setLoading(null) }
  }
  const searchGov = async (o0?: string, k0?: string) => {
    const org = o0 ?? org0, kw = k0 ?? kw0
    if (!kw.trim() && !org.trim()) return setMsg({ ...msg, gov: '기관명이나 규정명을 입력하세요.' })
    setLoading('gov'); setMsg({ ...msg, gov: '' })
    try {
      const r = await api(`/api/gov-regs?type=${profile.type}&org=${encodeURIComponent(org.trim())}&q=${encodeURIComponent(kw.trim())}`)
      setItems({ ...items, gov: r.rows.map((x: any) => ({ doc_id: x.doc_id, title: x.doc_title, sub: `${x.inst_name || ''} · ${x.doc_type || ''}${x.effective_from ? ' · 시행 ' + x.effective_from : ''}`, badge: '법제처' })) })
      if (!r.rows.length) setMsg({ ...msg, gov: `결과가 없습니다. ${org.trim() ? '기관명을 목록의 정식 이름(예: 경기도 수원시)으로 쓰거나 ' : ''}규정명 낱말을 바꿔 보세요.` })
    } catch (e) { setMsg({ ...msg, gov: (e as Error).message }) } finally { setLoading(null) }
  }
  const searchLaw = async () => {
    if (!lawq.trim()) return
    setLoading('law'); setMsg({ ...msg, law: '' })
    try {
      const r = await api('/api/search', { method: 'POST', body: { mode: 'law', keyword: lawq.trim(), targets } })
      setItems({ ...items, law: r.rows.map((x: any) => ({ doc_id: x.doc_id, title: x.title, sub: `${x.kind || ''}${x.dept ? ' · ' + x.dept : ''}${x.date ? ' · 시행 ' + x.date : ''}`, badge: x.source })) })
      if (!r.rows.length) setMsg({ ...msg, law: r.errors?.length ? `${r.errors.join('·')} 조회 실패` : '결과가 없습니다.' })
    } catch (e) { setMsg({ ...msg, law: (e as Error).message }) } finally { setLoading(null) }
  }
  const list = (src: string) => (
    <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
      {msg[src] && <p className="text-sm text-muted-foreground">{msg[src]}</p>}
      <AnimatePresence initial={false}>
        {(items[src] || []).map((x, i) => {
          const on = multi ? picked.includes(x.doc_id) : doc?.doc_id === x.doc_id
          return (
            <motion.button type="button" key={x.doc_id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i * 0.025, 0.3) }}
              onClick={() => choose(x.doc_id)} className={`group flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${on ? 'border-foreground bg-muted/60' : 'bg-card'}`}>
              <BookOpenIcon className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">{x.title}{x.state && <Badge variant={x.state === 'current' ? 'secondary' : 'destructive'}>{EDITION[x.state] || '판본 미상'}</Badge>}{x.badge && <Badge variant="outline">{x.badge}</Badge>}</div>
                <div className="truncate text-xs text-muted-foreground">{x.sub}</div>
              </div>
              {on && <CheckCircle2Icon className="shrink-0" />}
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
  const main = doc?.articles.filter((a) => a.section === '본칙' && a.ref) || []
  return (
    <div className="flex flex-col gap-4">
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        {sources.length > 1 && (
          <TabsList className="h-auto w-full flex-wrap justify-start">
            {sources.includes('alio') && <TabsTrigger value="alio"><LandmarkIcon data-icon="inline-start" />기관 규정(ALIO)</TabsTrigger>}
            {sources.includes('gov') && <TabsTrigger value="gov"><LandmarkIcon data-icon="inline-start" />우리 기관 {govWord}(법제처)</TabsTrigger>}
            {sources.includes('upload') && <TabsTrigger value="upload"><FileUpIcon data-icon="inline-start" />파일·붙여넣기</TabsTrigger>}
            {sources.includes('law') && <TabsTrigger value="law"><BookOpenIcon data-icon="inline-start" />법령·자치법규</TabsTrigger>}
          </TabsList>
        )}
        <TabsContent value="alio" className="pt-2">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); searchAlio() }}>
            <Input className="w-56" placeholder="기관명 일부" value={inst} onChange={(e) => setInst(e.target.value)} maxLength={60} />
            <Input className="min-w-40 flex-1" placeholder="규정명·주제(예: 취업규칙, 출산휴가)" value={kw} onChange={(e) => setKw(e.target.value)} maxLength={100} />
            <Button type="submit" disabled={loading === 'alio'}>{loading === 'alio' ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}찾기</Button>
          </form>
          {!items.alio?.length && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>처음이라면 실제 공시 규정으로 해 보세요:</span>{[['창업진흥원', '복무규정'], ['한국전력공사', '취업규칙'], ['소상공인시장진흥공단', '복무규정']].map(([i, k]) => <button key={i} type="button" className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { setInst(i); setKw(k); searchAlio(i, k) }}>{i} · {k}</button>)}</div>}
          {list('alio')}
        </TabsContent>
        <TabsContent value="gov" className="pt-2">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); searchGov() }}>
            <Input className="w-56" placeholder={profile.type === 'local-gov' ? '지방자치단체명(예: 경기도 수원시)' : '부처명(예: 고용노동부)'} value={org} onChange={(e) => setOrg(e.target.value)} maxLength={60} />
            <Input className="min-w-40 flex-1" placeholder={profile.type === 'local-gov' ? '조례·규칙 제명 낱말(예: 복무, 문서)' : '훈령·예규·고시 제명 낱말(예: 공무직, 감사)'} value={kw} onChange={(e) => setKw(e.target.value)} maxLength={60} />
            <Button type="submit" disabled={loading === 'gov'}>{loading === 'gov' ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}찾기</Button>
          </form>
          <p className="mt-1 text-xs text-muted-foreground">법제처 국가법령정보의 현행 {govWord}를 제명으로 찾습니다. 기관명을 비우면 모든 기관에서 찾습니다.</p>
          {!items.gov?.length && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>처음이라면 이렇게 찾아 보세요:</span>{(profile.type === 'local-gov' ? [['경기도 수원시', '당직'], ['서울특별시', '복무']] : [['고용노동부', '당직'], ['행정안전부', '공무직']]).map(([o, k]) => <button key={o} type="button" className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => { setOrg(o); setKw(k); searchGov(o, k) }}>{o} · {k}</button>)}</div>}
          {list('gov')}
        </TabsContent>
        <TabsContent value="upload" className="flex flex-col gap-2 pt-2">
          <p className="text-sm text-muted-foreground">hwpx·txt·md(여러 개 가능) 또는 원문 붙여넣기. 원본은 읽기 전용으로 보관(SHA-256 기록)하고 결과는 별도로 만듭니다. 한글(hwp)은 hwpx로 저장해 올려 주세요.</p>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50">
            {loading === 'upload' ? <Spinner /> : <FileUpIcon />}
            <span>여기를 눌러 파일 선택</span>
            <input type="file" multiple accept=".hwpx,.txt,.md" hidden onChange={async (e) => { const fs = [...(e.target.files || [])].slice(0, 20); if (fs.length) upload(await Promise.all(fs.map(async (f) => ({ name: f.name, base64: await fileToB64(f) })))); e.target.value = '' }} />
          </label>
          <Textarea rows={4} placeholder="규정 원문 붙여넣기 — 첫 줄은 제목, 이어서 제1조(목적) … 형식" value={paste} onChange={(e) => setPaste(e.target.value)} />
          <div className="flex justify-end"><Button variant="secondary" disabled={!paste.trim() || loading === 'upload'} onClick={() => upload([{ name: '붙여넣기.txt', text: paste }])}>붙여넣은 원문 사용</Button></div>
          {list('upload')}
        </TabsContent>
        <TabsContent value="law" className="pt-2">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); searchLaw() }}>
            <Input className="min-w-40 flex-1" placeholder="법령명(예: 근로기준법, 남녀고용평등법, 복무 조례)" value={lawq} onChange={(e) => setLawq(e.target.value)} maxLength={100} />
            <Button type="submit" disabled={loading === 'law'}>{loading === 'law' ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}찾기</Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {[['law', '법령'], ['admrul', '행정규칙(부처)'], ['ordin', '자치법규(지방자치단체)']].map(([v, l]) => <label key={v} className="flex items-center gap-2"><Checkbox checked={targets.includes(v)} onCheckedChange={(c) => setTargets(c ? [...targets, v] : targets.filter((x) => x !== v))} />{l}</label>)}
          </div>
          {list('law')}
        </TabsContent>
      </Tabs>
      <AnimatePresence>
        {(doc || loading === 'doc') && !multi && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-lg border bg-muted/40 p-4">
              {loading === 'doc' ? <div className="flex items-center gap-2 text-sm"><Spinner />원문 불러오는 중…</div> : doc && (
                <>
                  <div className="flex flex-wrap items-center gap-2 font-semibold"><CheckCircle2Icon />{doc.inst ? `${doc.inst} · ` : ''}{doc.title}<Badge variant="secondary">{EDITION[doc.edition?.state || ''] || '판본 미상'}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">본칙 {main.length}개 조문{doc.edition?.effective_from ? ` · 시행 ${doc.edition.effective_from}` : ''}</p>
                  {doc.edition?.warning && <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><TriangleAlertIcon className="size-4" />{doc.edition.warning}</p>}
                  {showArticles && (
                    <Collapsible className="mt-2">
                      <CollapsibleTrigger render={<Button variant="link" size="sm" className="px-0" />}>조문 직접 지정(선택 — 비우면 에이전트가 찾습니다){refs.length ? ` · ${refs.length}개 선택` : ''}</CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border bg-background p-2 text-sm">
                          {main.map((a) => <label key={a.ref!} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-muted"><Checkbox checked={refs.includes(a.ref!)} onCheckedChange={(c) => { const n = c ? [...refs, a.ref!] : refs.filter((x) => x !== a.ref); setRefs(n); onChange({ doc, uploads, refs: n }) }} /><span><b>{a.ref}</b>({a.title}) <span className="text-muted-foreground">{a.body.slice(0, 50)}</span></span></label>)}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
