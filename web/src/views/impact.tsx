// 상위법 영향: 개정 전·후 조문 → 영향 조문 후보 → 개정으로 보내기
import { DocLink } from '@/components/doc-viewer'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HistoryIcon, CheckIcon, SparklesIcon, XIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { MoreTrigger } from '@/components/more-trigger'
import { api } from '@/lib/api'
import { motion } from 'motion/react'
import { ArrowRightIcon, DownloadIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { JobTimeline } from '@/components/job-timeline'
import { Counter } from '@/components/docset-board'
import { InstPicker } from '@/components/inst-picker'
import { useApp } from '@/lib/app-state'
import { useJob } from '@/hooks/use-job'
import { goTab } from '@/App'
import { download, tableCsv } from '@/lib/export'
import { StepTitle } from '@/components/keycap'

const EX = { law: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률 제18조의2', before: '① 사업주는 근로자가 배우자의 출산을 이유로 휴가를 청구하는 경우에 10일의 휴가를 주어야 한다. 이 경우 사용한 휴가기간은 유급으로 한다.\n③ 배우자 출산휴가는 근로자의 배우자가 출산한 날부터 90일이 지나면 청구할 수 없다.', after: '① 사업주는 근로자가 배우자의 출산을 이유로 휴가를 청구하는 경우에 20일의 휴가를 주어야 한다. 이 경우 사용한 휴가기간은 유급으로 한다.\n③ 배우자 출산휴가는 근로자의 배우자가 출산한 날부터 120일이 지나면 청구할 수 없다.', topic: '배우자 출산휴가' }
const ymdDot = (s: string) => s.replace(/(\d{4})(\d{2})(\d{2})/, '$1. $2. $3.')
const LABEL: Record<string, string> = { candidate: '개정 후보', check: '확인 필요', reflected: '반영됨' }
export default function ImpactView() {
  const [law, setLaw] = useState(''); const [before, setBefore] = useState(''); const [after, setAfter] = useState(''); const [topic, setTopic] = useState('')
  const { profile } = useApp(); const gov = profile.type !== 'public-institution'
  const [inst, setInst] = useState(gov ? (/^예시 /.test(profile.name) ? '' : profile.name) : profile.alio_inst || '')
  const [filter, setFilter] = useState('all')
  const [vq, setVq] = useState({ name: '', ref: '', topic: '' })
  const [vers, setVers] = useState<any[] | null>(null)
  const [pick, setPick] = useState<{ before?: string; after?: string }>({})
  const [vmsg, setVmsg] = useState('')
  const [vbusy, setVbusy] = useState(false)
  const articleText = async (docId: string, ref: string) => { const d = await api('/api/doc?id=' + encodeURIComponent(docId)); return (d.articles.find((a: any) => a.ref === ref && a.section === '본칙')?.body || '') as string }
  const loadVersions = async () => {
    setVbusy(true); setVmsg('')
    try {
      const r = await api('/api/law-versions', { method: 'POST', body: vq })
      if (!r.versions.length) { setVers(null); setVmsg(r.degraded ? '조회 일부가 실패했습니다. 다시 시도하세요.' : '판본을 찾지 못했습니다. 법령명·조문 번호를 확인하세요(ALIO 법령 코퍼스에 있는 법령만).'); return }
      setVers(r.versions); setPick({ before: r.before?.doc_id, after: r.after?.doc_id })
      setLaw(`${vq.name} ${vq.ref}`); if (r.before) setBefore(r.before.text); if (r.after) setAfter(r.after.text); if (vq.topic) setTopic(vq.topic)
      setVmsg(`판본 ${r.versions.length}개 · 개정 전 ${r.before?.effective_from || '없음'} / 개정 후 ${r.after?.effective_from}(${r.after?.state === 'current' ? '현행' : r.after?.state}) 조문을 채웠습니다. 다른 판본을 고를 수 있습니다.`)
    } catch (e) { setVmsg((e as Error).message) } finally { setVbusy(false) }
  }
  const choose = async (side: 'before' | 'after', docId: string) => { setPick({ ...pick, [side]: docId }); const t = await articleText(docId, vq.ref.replace(/\s/g, '')); side === 'before' ? setBefore(t) : setAfter(t) }
  const job = useJob('impact')
  const r = job.job?.status === 'done' ? job.job.result : null
  const radar = useJob('radar')
  const rr = radar.job?.status === 'done' ? radar.job.result : null
  // 기관 유형별 기본 감시 법령(공공기관: 노동법, 지자체: 지방공무원 법령, 부처: 국가공무원 법령)
  const [rlaws, setRlaws] = useState(profile.type === 'local-gov' ? '지방공무원법, 지방공무원 복무규정' : profile.type === 'central-ministry' ? '국가공무원법, 국가공무원 복무규정' : '근로기준법, 남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률')
  // 감시할 법령 제안: 법제처 「시행일 기준 법령」에서 최근·곧 시행되는 관련 법령(기관 유형별). 입력을 고치지 않았으면 상위 3개를 채운다
  type Sugg = { law: string; why: string; eff: string; state: 'scheduled' | 'recent'; change: string; kinds: string[] }
  const [sugg, setSugg] = useState<{ items: Sugg[]; note: string; disabled?: boolean } | null>(null)
  const [sbusy, setSbusy] = useState(false)
  const [edited, setEdited] = useState(false)
  const [extra, setExtra] = useState('')
  const [showDocs, setShowDocs] = useState(6)
  const [adv, setAdv] = useState(false)
  const [openG, setOpenG] = useState<string[]>([]); const [closedG, setClosedG] = useState<string[]>([])
  // 시행일까지 남은 날(오늘 0)
  const dday = (s: string) => Math.round((Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400e3)
  useEffect(() => {
    let live = true; setSbusy(true)
    api('/api/radar/suggest', { method: 'POST', body: { org_type: profile.type } }).then((v) => { if (!live) return; setSugg(v); if (!edited && v.items?.length) setRlaws(v.items.slice(0, 3).map((x: Sugg) => x.law).join(', ')) }).catch(() => live && setSugg(null)).finally(() => live && setSbusy(false))
    return () => { live = false }
  }, [profile.type]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = rlaws.split(',').map((x) => x.trim()).filter(Boolean)
  const toggleLaw = (law: string) => { setEdited(true); if (chosen.includes(law)) setRlaws(chosen.filter((x) => x !== law).join(', ')); else if (chosen.length >= 3) toast.info('한 번에 3개까지 비교합니다. 다른 법령을 먼저 빼 주세요.'); else setRlaws([...chosen, law].join(', ')) }
  // 자료 기준 시각(법제처에서 받은 때)
  const at = (ms?: number | null) => (ms ? new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
  const rows = (r?.candidates || []).filter((c: any) => filter === 'all' || c.status === filter)
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><StepTitle n={1}>바뀌는 법령 고르기</StepTitle><CardDescription>최근·곧 시행되는 법령 가운데 우리 기관 유형에 영향이 큰 것을 골라 두었습니다. 그대로 두거나 바꾸세요.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* 감시할 법령: 시행일 순 목록(곧 시행 · 시행 예정 · 최근 시행), 고른 것은 아래 실행 줄에 칩으로 */}
          <section className="overflow-hidden rounded-lg border">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold"><SparklesIcon className="size-4 text-primary" />살펴볼 법령</span>
              <span className="text-xs text-muted-foreground">우리 기관 유형에 영향이 큰 법령 · 눌러서 최대 3개</span>
              {(sugg as any)?.as_of && <span className="ml-auto text-xs text-muted-foreground">법제처 · {at((sugg as any).as_of)} 기준</span>}
            </div>
            {sbusy && <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Spinner />법제처에서 시행일 기준 법령을 찾는 중…</div>}
            {!sbusy && !sugg?.items?.length && <p className="p-4 text-sm text-muted-foreground">{sugg?.note || '제안을 불러오지 못했습니다. 아래에 법령명을 직접 넣어 주세요.'}</p>}
            {sugg?.items?.length ? (() => {
              const top = new Set(sugg.items.slice(0, 3).map((x) => x.law))
              const groups: [string, Sugg[]][] = [['30일 안에 시행', sugg.items.filter((x) => x.state === 'scheduled' && dday(x.eff) <= 30)], ['시행 예정', sugg.items.filter((x) => x.state === 'scheduled' && dday(x.eff) > 30)], ['최근 시행', sugg.items.filter((x) => x.state === 'recent')]]
              const shown = groups.filter(([, xs]) => xs.length)
              return shown.map(([g, xs], gi) => { const open = !closedG.includes(g) && (openG.includes(g) || gi === 0 || xs.some((x) => chosen.includes(x.law))); return (
                <div key={g} className="border-b last:border-b-0">
                  <button type="button" aria-expanded={open} onClick={() => { if (open) { setClosedG([...closedG, g]); setOpenG(openG.filter((x) => x !== g)) } else { setOpenG([...openG, g]); setClosedG(closedG.filter((x) => x !== g)) } }} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:text-foreground">
                    <ChevronDownIcon className={`size-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} /><span className="shrink-0 whitespace-nowrap">{g} <span className="font-normal">{xs.length}</span></span>
                    {!open && <span className="min-w-0 truncate font-normal">· {xs.map((x) => x.law).slice(0, 2).join(', ')}{xs.length > 2 ? ` 외 ${xs.length - 2}개` : ''}</span>}
                  </button>
                  {open && <ul className="grid grid-cols-1 gap-1 px-2 pb-2 md:grid-cols-2">
                    {[...xs].sort((a, b) => a.eff.localeCompare(b.eff)).map((x) => { const on = chosen.includes(x.law), d = dday(x.eff); return (
                      <li key={x.law} className="min-w-0"><button type="button" aria-pressed={on} onClick={() => toggleLaw(x.law)} title={`${x.law} · ${x.kinds.join('·')} ${x.change}`}
                        className={`group flex w-full items-center gap-3 rounded-md border px-2 py-1.5 text-left transition-colors ${on ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/50'}`}>
                        <span className="w-12 shrink-0 text-center leading-tight">
                          <span className={`block font-mono text-sm font-semibold tabular-nums ${x.state === 'recent' ? 'text-muted-foreground' : 'text-foreground'}`}>{x.eff.slice(4, 6)}.{x.eff.slice(6, 8)}</span>
                          <span className={`block text-xs ${x.state === 'recent' ? 'text-muted-foreground' : d <= 30 ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>{x.state === 'recent' ? '시행 중' : x.eff.slice(0, 4) !== String(new Date().getFullYear()) ? x.eff.slice(0, 4) : `D-${d}`}</span>
                        </span>
                        <span aria-hidden="true" className="h-8 w-px shrink-0 bg-border" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium md:line-clamp-1">{x.law}</span>
                          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">{x.why}{/타법/.test(x.change) && <span className="rounded border px-1 text-[11px]">타법개정</span>}{top.has(x.law) && <span className="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">추천</span>}</span>
                        </span>
                        <span className={`grid size-5 shrink-0 place-items-center rounded-full border ${on ? 'border-primary bg-primary text-primary-foreground' : 'text-transparent group-hover:border-primary/60'}`}><CheckIcon className="size-3.5" /></span>
                      </button></li>) })}
                  </ul>}
                </div>) })
            })() : null}
          </section>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">고른 법령 {chosen.length}/3</span>
            {chosen.map((x) => <span key={x} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-background py-0.5 pl-2.5 pr-1 text-xs"><span className="truncate">{x}</span><button type="button" aria-label={`${x} 빼기`} onClick={() => toggleLaw(x)} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><XIcon className="size-3" /></button></span>)}
            {chosen.length < 3 && <form className="min-w-40 flex-1" onSubmit={(e) => { e.preventDefault(); const v = extra.trim(); if (v) { toggleLaw(v); setExtra('') } }}><Input className="h-8 text-sm" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="직접 추가: 법령명 입력 후 Enter" /></form>}
          </div>
          <div className="flex flex-col gap-3 border-t pt-4">
            <StepTitle n={2}>우리 기관 규정에서 찾기</StepTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="rd-inst" className="text-sm font-medium">우리 기관</label>
                <InstPicker id="rd-inst" type={profile.type} value={inst} onPick={(_, t) => setInst(t)} placeholder={gov ? (profile.type === 'local-gov' ? '지방자치단체명' : '부처명') : '기관명(예: 창업진흥원)'} />
              </div>
              <Button size="lg" className="px-4" disabled={radar.busy || !chosen.length} onClick={() => radar.start('radar', { org_type: profile.type, inst: inst || undefined, laws: chosen.slice(0, 3) })}>{radar.busy ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}고칠 곳 찾기</Button>
            </div>
            <p className="text-xs text-muted-foreground">{inst ? `바뀐 법령 조문마다 ${inst} 규정에서 같은 사항을 정한 조문을 찾아, 고칠 곳을 개정 후보로 보여 줍니다.` : '우리 기관을 비워 두면 모든 기관 규정에서 사례를 찾습니다. 우리 기관을 고르면 우리 규정만 봅니다.'}</p>
          </div>
          <JobTimeline job={radar.job} error={radar.error} startedAt={radar.startedAt} onAnswer={radar.answer} onRetry={radar.canRetry ? radar.retry : undefined} title="시행예정 레이더" />
          {rr && (() => {
            // 고칠 곳을 규정별로 모은다(개정 후보가 있는 규정 먼저) — 규정 하나에서 여러 조문을 한 번에 개정 준비
            const hits = rr.items.flatMap((it: any) => it.affected.map((a: any) => ({ ...a, eff: it.effective_from })))
            const docs = [...hits.reduce((m: Map<string, any>, a: any) => { const g = m.get(a.doc_id) || { doc_id: a.doc_id, inst: a.inst, title: a.doc_title, rows: [] as any[] }; if (!g.rows.some((x: any) => x.ref === a.ref && x.law_line === a.law_line)) g.rows.push(a); m.set(a.doc_id, g); return m }, new Map()).values()]
              .sort((p: any, q: any) => q.rows.filter((x: any) => x.status === 'candidate').length - p.rows.filter((x: any) => x.status === 'candidate').length || q.rows.length - p.rows.length)
            const prep = (g: any, rows: any[]) => goTab('amend', { doc_id: g.doc_id, refs: [...new Set(rows.map((x: any) => x.ref))], intent: `${[...new Set(rows.map((x: any) => x.law_line))].join(', ')}에 맞춰 ${[...new Set(rows.map((x: any) => `${x.ref}(${x.title || ''})`))].join(', ')}를 고친다.`.slice(0, 1000) })
            return (
              <div className="flex flex-col gap-3 border-t pt-4">
                <StepTitle n={3}>고칠 곳 확인하고 개정 준비</StepTitle>
                <p className="text-xs text-muted-foreground">{rr.note}{rr.as_of?.law_go ? ` · 법제처 자료 기준 ${at(rr.as_of.law_go)}` : ''}{rr.items?.some((x: any) => x.via === 'ALIO') ? ' · 일부는 ALIO 법령 사본 기준' : ''}{rr.errors?.length ? ` ⚠ 조회 실패: ${rr.errors.join(', ')}(없다는 뜻이 아님)` : ''} · 위반 판정이 아니라 검토 우선순위입니다.</p>
                {!rr.inst && docs.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">우리 기관을 정하지 않아 다른 기관 규정의 사례입니다. 위에서 우리 기관을 고르고 다시 찾으면 우리 규정만 봅니다.</p>}
                {docs.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{rr.items.length ? `${inst || '검색 범위'} 규정에서 바뀐 법령 조문과 같은 사항을 정한 조문을 찾지 못했습니다(규정이 없다는 뜻은 아님). 아래 「바뀐 법령 조문」에서 조문별로 자세히 분석해 보세요.` : '고른 법령에서 최근·곧 시행되는 바뀐 조문을 찾지 못했습니다.'}</p>}
                {docs.slice(0, showDocs).map((g: any) => (
                  <div key={g.doc_id} className="overflow-hidden rounded-lg border">
                    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold"><DocLink docId={g.doc_id}>{g.inst ? `${g.inst} · ` : ''}{g.title}</DocLink> <span className="font-normal text-muted-foreground">고칠 곳 {g.rows.length}</span></span>
                      <Button size="sm" onClick={() => prep(g, g.rows)}>개정 준비<ArrowRightIcon data-icon="inline-end" /></Button>
                    </div>
                    <ul className="divide-y">
                      {g.rows.map((a: any, k: number) => (
                        <li key={k} className="flex flex-col gap-1 px-3 py-2.5 text-sm sm:flex-row sm:items-start sm:gap-3">
                          <Badge className="shrink-0" variant={a.status === 'candidate' ? 'default' : 'outline'}>{LABEL[a.status]}</Badge>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium"><DocLink docId={a.doc_id} refName={a.ref}>{a.ref}({a.title})</DocLink> <span className="font-normal text-muted-foreground">← {a.law_line}</span></div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.excerpt}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">{a.reason}</div>
                          </div>
                          {g.rows.length > 1 && <Button size="xs" variant="ghost" className="self-start" onClick={() => prep(g, [a])}>이 조문만</Button>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {docs.length > showDocs && <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowDocs(docs.length)}><ChevronDownIcon data-icon="inline-start" />규정 {docs.length - showDocs}개 더 보기</Button>}
                <Collapsible>
                  <MoreTrigger>바뀐 법령 조문 {rr.items.length}개 — 조문별로 자세히 분석</MoreTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 flex flex-col gap-1.5">{rr.items.map((it: any, i: number) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
                        <Badge variant="outline">{ymdDot(it.effective_from)} 시행</Badge><span className="min-w-0 flex-1">{it.law} {it.ref}({it.title}) <span className="text-muted-foreground">{it.kind}{it.changes.length ? ` · ${it.changes.map((c: any) => `${c.from}→${c.to}`).join(', ')}` : ''}</span></span>
                        <Button size="xs" variant="outline" disabled={job.busy} onClick={() => { const nm = `${it.law} ${it.ref}`; setLaw(nm); setBefore(it.before); setAfter(it.after); setTopic(it.title); job.start('impact', { law_name: nm, before: { text: it.before || '(신설)' }, after: { text: it.after }, topic: it.title, org_type: profile.type, scope: { inst: inst || undefined }, auto: true }); setTimeout(() => document.getElementById('impact-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300) }}>자세히 분석</Button>
                      </li>))}</ul>
                  </CollapsibleContent>
                </Collapsible>
                <Button variant="outline" size="sm" className="self-start" onClick={() => download('법개정_정비계획.txt', rr.plan_text, 'text/plain')}><DownloadIcon data-icon="inline-start" />정비 계획서 내려받기</Button>
              </div>
            )
          })()}
        </CardContent>
      </Card>
      {/* 고급: 법령 조문을 직접 넣거나 판본 연혁에서 불러와 영향을 찾는다(위 3단계로 찾지 못했을 때) */}
      <Collapsible open={adv} onOpenChange={setAdv}>
        <MoreTrigger>직접 입력해서 찾기 — 법령 조문을 붙여 넣거나 판본 연혁에서 불러오기</MoreTrigger>
        <CollapsibleContent>
          <div className="mt-3 flex flex-col gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">판본 연혁에서 불러오기</CardTitle><CardDescription>법령명과 조문 번호를 넣으면 ALIO 법령 코퍼스의 판본 연혁에서 현행과 직전 변경본을 찾아 아래 개정 전·후 칸을 채웁니다.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (vq.name.trim() && vq.ref.trim()) loadVersions() }}>
                <Input className="min-w-56 flex-1" placeholder="법령명(예: 남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률)" value={vq.name} onChange={(e) => setVq({ ...vq, name: e.target.value })} />
                <Input className="w-32" placeholder="제18조의2" value={vq.ref} onChange={(e) => setVq({ ...vq, ref: e.target.value })} />
                <Input className="w-40" placeholder="주제(예: 배우자 출산)" value={vq.topic} onChange={(e) => setVq({ ...vq, topic: e.target.value })} />
                <Button type="submit" disabled={vbusy || !vq.name.trim() || !vq.ref.trim()}>{vbusy ? <Spinner data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}판본 불러오기</Button>
              </form>
              {vmsg && <p className="text-sm text-muted-foreground">{vmsg}</p>}
              {vers && (
                <div className="grid gap-3 md:grid-cols-2">
                  {(['before', 'after'] as const).map((side) => (
                    <div key={side} className="flex flex-col gap-1">
                      <div className="text-sm font-medium">{side === 'before' ? '개정 전 판본' : '개정 후 판본'}</div>
                      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                        {vers.map((v: any) => <button type="button" key={v.doc_id} onClick={() => choose(side, v.doc_id)} className={`flex items-center justify-between rounded px-2 py-1 text-left text-sm ${pick[side] === v.doc_id ? 'bg-foreground text-background' : 'hover:bg-muted'}`}><span>시행 {v.effective_from}</span><span className="text-xs opacity-70">{v.state === 'current' ? '현행' : v.state === 'scheduled' ? '시행예정' : '구판'}</span></button>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">법령 조문 개정 전·후</CardTitle><CardDescription>바뀐 조문을 넣으면 같은 사항을 정한 기관 규정 조문을 찾아 아직 반영되지 않은 곳을 개정 후보로 표시합니다. <Button variant="outline" size="xs" className="ml-1" onClick={() => { setLaw(EX.law); setBefore(EX.before); setAfter(EX.after); setTopic(EX.topic) }}>예시 채우기</Button></CardDescription></CardHeader>
            <CardContent>
              <FieldGroup>
                <Field><FieldLabel htmlFor="im-law">법령명·조문</FieldLabel><Input id="im-law" maxLength={80} value={law} onChange={(e) => setLaw(e.target.value)} placeholder="예: 남녀고용평등법 제18조의2" /></Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field><FieldLabel htmlFor="im-b">개정 전</FieldLabel><Textarea id="im-b" rows={6} value={before} onChange={(e) => setBefore(e.target.value)} /></Field>
                  <Field><FieldLabel htmlFor="im-a">개정 후</FieldLabel><Textarea id="im-a" rows={6} value={after} onChange={(e) => setAfter(e.target.value)} /></Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field><FieldLabel htmlFor="im-t">주제(선택)</FieldLabel><Input id="im-t" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 배우자 출산휴가" /><FieldDescription>비우면 개정 후 문구에서 뽑습니다.</FieldDescription></Field>
                  <Field><FieldLabel htmlFor="im-i">기관 범위(선택)</FieldLabel><InstPicker lazy id="im-i" type={profile.type} value={inst} onPick={(_, t) => setInst(t)} placeholder={gov ? `${profile.type === 'local-gov' ? '지방자치단체명' : '부처명'} — 비우면 전체 ${profile.type === 'local-gov' ? '자치법규' : '행정규칙'}` : '기관명 — 비우면 전체 공공기관'} /><FieldDescription>{gov ? `법제처 ${profile.type === 'local-gov' ? '자치법규' : '행정규칙'}에서 찾습니다.` : 'ALIO 공시 공공기관 내규에서 찾습니다.'}</FieldDescription></Field>
                </div>
              </FieldGroup>
              <div className="mt-4 flex justify-end"><Button size="lg" disabled={!before.trim() || !after.trim() || job.busy} onClick={() => job.start('impact', { law_name: law, before: { text: before }, after: { text: after }, topic, org_type: profile.type, scope: { inst: inst || undefined }, auto: true })}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}영향 조문 찾기</Button></div>
            </CardContent>
          </Card>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <div id="impact-result" className="scroll-mt-4 sm:scroll-mt-32" />
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="상위법 영향 분석" />
      {r && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card>
            <CardHeader><CardTitle>영향받는 조문 — {r.law_name || '상위 법령'}</CardTitle><CardDescription>{r.summary} · 위반 판정이 아니라 검토 우선순위입니다. 원문과 적용 대상을 확인하세요.{r.errors?.length ? ` ⚠ 일부 조회 실패(${r.errors.join('·')}) — 결과가 빠졌을 수 있습니다.` : ''}</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">{(['candidate', 'check', 'reflected'] as const).map((k) => <Counter key={k} value={r.candidates.filter((c: any) => c.status === k).length} label={LABEL[k]} />)}</div>
              <ToggleGroup value={[filter]} onValueChange={(v: string[]) => v[0] && setFilter(v[0])} variant="outline"><ToggleGroupItem value="all">전체</ToggleGroupItem>{Object.entries(LABEL).map(([k, l]) => <ToggleGroupItem key={k} value={k}>{l}</ToggleGroupItem>)}</ToggleGroup>
              <Table>
                <TableHeader><TableRow><TableHead className="w-28">판정</TableHead><TableHead className="w-56">기관·규정</TableHead><TableHead>조문</TableHead><TableHead className="w-28" /></TableRow></TableHeader>
                <TableBody>
                  {rows.map((c: any) => (
                    <TableRow key={c.key}>
                      <TableCell className="align-top"><Badge variant={c.status === 'candidate' ? 'default' : c.status === 'check' ? 'outline' : 'secondary'}>{LABEL[c.status]}</Badge></TableCell>
                      <TableCell className="whitespace-normal align-top"><div className="font-medium">{c.inst}</div><div className="text-xs text-muted-foreground"><DocLink docId={c.doc_id} refName={c.annex ? null : c.ref} section={c.section}>{c.doc_title} {c.section === '부칙' ? '부칙 ' : ''}{c.ref}</DocLink> · {c.edition} · {c.via}</div></TableCell>
                      <TableCell className="whitespace-normal align-top text-sm"><div>{c.excerpt}</div><div className="mt-1 text-xs text-muted-foreground">{c.reason}</div></TableCell>
                      <TableCell className="align-top">{c.status !== 'reflected' && <Button size="xs" variant="outline" onClick={() => goTab('amend', c.amend)}>개정안 만들기</Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div><Button variant="outline" onClick={() => download('상위법_영향_후보.csv', tableCsv(r.candidates, [['status', '판정'], ['inst', '기관'], ['doc_title', '규정'], ['ref', '조문'], ['excerpt', '발췌'], ['reason', '사유'], ['edition', '판본']]), 'text/csv')}><DownloadIcon data-icon="inline-start" />CSV</Button></div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
