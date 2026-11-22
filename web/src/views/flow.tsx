// 절차 따라가기(마법사): 준비 → 초안 만들기 → 초안 검토 → 기관 유형별 절차 단계(협의·검토·심의·공포)
// 각 단계에는 그 단계의 할 일과 필요한 문서만 보여 준다. 진행 상태와 고친 문서는 탭(sessionStorage)에 보관한다.
import { toast } from 'sonner'
import { DocLink } from '@/components/doc-viewer'
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ListChecksIcon, MessageSquareQuoteIcon, RotateCcwIcon, PaperclipIcon, PartyPopperIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Keycap } from '@/components/keycap'
import { JobTimeline } from '@/components/job-timeline'
import { DocActions, DocEditor } from '@/components/doc-editor'
import { AmendForm, type AmendPreset } from '@/views/amend'
import { EnactForm } from '@/views/enact'
import { useJob } from '@/hooks/use-job'
import { useApp } from '@/lib/app-state'
import { DOC_LABELS, api } from '@/lib/api'
import { changesFromRows, type DocSet, type Section } from '@/lib/export'

type Mode = 'amend' | 'enact'
type Flow = { step: string; done: string[]; result: any | null; sections: Section[] | null; jobId?: string; opinionJob?: string }
const EMPTY: Flow = { step: 'prepare', done: [], result: null, sections: null }
const FORMS = ['consult_letter', 'labor_opinion', 'opinion_review', 'notice', 'legal_review', 'council_agenda', 'board_agenda', 'assembly_bill', 'promulgation']
const CORE = ['comparison', 'draft', 'full_text', 'reason', 'addenda']
const CHECKS = ['checklist', 'corrections', 'ca_check', 'delegation_review', 'comparison_other']
const key = (mode: Mode) => `rulef5.flow.${mode}`
const load = (mode: Mode): Flow => { try { return { ...EMPTY, ...(JSON.parse(sessionStorage.getItem(key(mode)) || 'null') || {}) } } catch { return EMPTY } }
// 대화형 에이전트 등 다른 화면에서 만든 결과를 절차 화면으로 넘긴다
export function openFlowWithResult(result: any) {
  const mode: Mode = result?.kind === '제정' ? 'enact' : 'amend'
  // 이 절차 화면이 이어받던 이전 초안·의견 작업은 지운다(그대로 두면 열리자마자 이전 결과로 덮어씀)
  sessionStorage.removeItem(`rulef5.job.flow-${mode}`); sessionStorage.removeItem(`rulef5.job.flow-op-${mode}`)
  sessionStorage.setItem(key(mode), JSON.stringify({ step: 'review', done: ['prepare', 'draft'], result, sections: result.docset.sections, jobId: result.jobId || 'handoff' }))
  return mode
}

function StepPanel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="rounded-lg border bg-card p-4 sm:p-6">
      <header className="mb-5 border-b pb-4"><h2 className="text-xl font-semibold tracking-tight">{title}</h2>{hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}</header>
      {children}
    </motion.section>
  )
}

export default function FlowView({ mode, preset }: { mode: Mode; preset?: AmendPreset | null }) {
  const { profile, procedures } = useApp()
  const [flow, setFlow] = useState<Flow>(() => (preset ? EMPTY : load(mode)))
  const job = useJob(`flow-${mode}`)
  const opinions = useJob(`flow-op-${mode}`)
  const [opText, setOpText] = useState('')
  const [formKey, setFormKey] = useState(0)
  const proc = procedures[profile.type]
  const steps = useMemo(() => [
    { id: 'prepare', title: mode === 'amend' ? '규정과 개정 의도' : '제명·목적·위임 조항', hint: mode === 'amend' ? '고칠 규정을 고르고, 무엇을 왜 바꾸는지 적습니다.' : '만들 규정의 제명과 목적, 근거가 되는 상위법 조항을 정합니다.', optional: false, proc: null as any },
    { id: 'draft', title: '초안 만들기', hint: '에이전트가 조문을 찾고 근거를 조사해 초안을 씁니다. 판단이 필요한 곳에서 멈추고 확인을 받습니다.', optional: false, proc: null as any },
    { id: 'review', title: '초안 검토', hint: '신구조문대비표와 확인할 점을 보고 문안을 고칩니다.', optional: false, proc: null as any },
    ...(proc?.steps || []).filter((s) => s.id !== 'draft').map((s) => ({ id: `p:${s.id}`, title: s.title, hint: `근거: ${s.basis}`, optional: !!s.optional, proc: s })),
  ], [mode, proc])
  useEffect(() => { sessionStorage.setItem(key(mode), JSON.stringify(flow)) }, [flow, mode])
  // 초안이 있으면 탭을 닫거나 다른 주소로 갈 때 한 번 묻는다(초안은 이 탭에만 보관되어 닫으면 사라진다)
  const hasDraft = !!flow.result
  useEffect(() => { if (!hasDraft) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault() }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [hasDraft])
  // 초안 작업이 끝나면 결과를 받아 검토 단계로 넘어간다
  useEffect(() => {
    const j = job.job
    // 초안 단계에서 시작한 작업의 결과만 받는다(넘겨받은 결과·검토 중인 결과를 다른 작업이 덮어쓰지 않게)
    if (j?.status === 'done' && j.result?.docset && flow.jobId !== j.id && (!flow.result || flow.step === 'draft' || flow.step === 'prepare')) setFlow((f) => ({ ...f, jobId: j.id, result: j.result, sections: j.result.docset.sections, step: 'review', done: [...new Set([...f.done, 'prepare', 'draft'])] }))
  }, [job.job, flow.jobId, flow.result, flow.step])
  // 의견 반영 결과를 문서에 합친다
  useEffect(() => {
    const j = opinions.job
    if (j?.status !== 'done' || !j.result?.docset || flow.opinionJob === j.id) return
    setFlow((f) => {
      if (!f.sections || !f.result) return f
      const get = (id: string) => j.result.docset.sections.find((s: Section) => s.id === id)
      const prev: any[] = f.result.changes || []
      let sections = f.sections.map((s) => {
        if (s.id === 'comparison' && get('comparison')) return { ...s, rows: get('comparison').rows }
        if (s.id === 'full_text' && get('full_text')) return { ...s, body: get('full_text').body }
        if (s.id === 'draft') {
          if (mode === 'amend' && get('draft')) return { ...s, body: get('draft').body }
          let body = s.body || ''
          for (const c of j.result.changes) { const old = prev.find((x) => x.ref === c.ref)?.new; if (old && old !== c.new && body.includes(old)) body = body.replace(old, c.new) }
          return { ...s, body }
        }
        return s
      })
      const rev = { ...get('opinion_review'), title: '의견 검토서' }
      sections = sections.some((s) => s.id === 'opinion_review') ? sections.map((s) => (s.id === 'opinion_review' ? rev : s)) : [...sections, rev]
      return { ...f, opinionJob: j.id, sections, result: { ...f.result, changes: j.result.changes } }
    })
  }, [opinions.job, flow.opinionJob, mode])

  const idx = steps.findIndex((s) => s.id === flow.step)
  const cur = steps[Math.max(0, idx)]
  // 초안을 만들기 전에는 「초안 검토」까지만 보이고 협의·심의·공포 단계는 접어 둔다(펼치기 가능)
  const [showAll, setShowAll] = useState(false)
  const reviewAt = steps.findIndex((s) => s.id === 'review')
  const folded = !showAll && !flow.result && reviewAt >= 0 && reviewAt < steps.length - 1
  const reachable = (id: string) => id === 'prepare' || (id === 'draft' ? !!job.startedAt || !!flow.result : !!flow.result)
  const go = (id: string) => { if (reachable(id)) { setFlow((f) => ({ ...f, step: id })); window.scrollTo({ top: 0, behavior: 'smooth' }) } }
  const complete = () => { const next = steps[idx + 1]; setFlow((f) => ({ ...f, done: [...new Set([...f.done, cur.id])], step: next ? next.id : 'finished' })); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  // 새로 시작: 초안이 있으면 앱 확인창으로 한 번 더 묻는다(지운 초안은 되돌릴 수 없다)
  const [askRestart, setAskRestart] = useState(false)
  const doRestart = () => { setAskRestart(false); job.reset(); opinions.reset(); setOpText(''); setFlow(EMPTY); setFormKey((k) => k + 1) }
  const restart = () => (flow.result ? setAskRestart(true) : doRestart())
  const sec = (id: string) => flow.sections?.find((s) => s.id === id)
  const update = (s: Section) => setFlow((f) => ({ ...f, sections: (f.sections || []).map((x) => (x.id === s.id ? s : x)) }))
  // 개정 후 전문 다시 만들기: 화면에서 고친 신구조문대비표(개정안 칸)를 조문 본문으로 되돌려 원 규정 전체에 다시 반영한다(모델 없이)
  const [rebuilding, setRebuilding] = useState(false)
  // 검토 화면 위 숫자 칸을 누르면 해당 문서·목록으로 이동한다
  const [revTab, setRevTab] = useState<string | null>(null)
  const [evOpen, setEvOpen] = useState(false)
  const jump = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  const rebuildFull = async () => {
    const rows = sec('comparison')?.rows || [], cur = sec('full_text'); if (!cur || !flow.result?.doc?.doc_id) return
    const changes = changesFromRows(flow.result.changes || [], rows)
    setRebuilding(true)
    try { const r = await api<{ body: string }>('/api/fulltext', { method: 'POST', body: { doc_id: flow.result.doc.doc_id, changes, addenda: sec('addenda')?.body || '' } }); update({ ...cur, body: r.body }) } catch (e) { toast.error(`전문을 다시 만들지 못했습니다: ${(e as Error).message}`) } finally { setRebuilding(false) }
  }
  const ds = (ids: string[]): DocSet => ({ kind: flow.result?.docset.kind || '', title: flow.result?.docset.title || '', evidence: flow.result?.docset.evidence || [], sections: ids.map(sec).filter(Boolean) as Section[] })
  const title = flow.result?.docset.title
  const run = (input: Record<string, unknown>) => { setFlow({ ...EMPTY, step: 'draft', done: ['prepare'] }); opinions.reset(); job.start(mode, input) }

  if (!proc) return null
  const doneAll = flow.step === 'finished'
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* 단계 표시: PC는 왼쪽 세로, 모바일은 위쪽 가로 */}
      <nav aria-label="절차 단계" className="min-w-0 lg:sticky lg:top-32 lg:self-start">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="min-w-0 text-sm"><span className="font-semibold">{mode === 'amend' ? '개정' : '제정'} 절차</span> <span className="text-muted-foreground">· {proc.name.replace(/ 제·개정 절차$/, '')}</span></div>
          <Button variant="ghost" size="sm" onClick={restart}><RotateCcwIcon data-icon="inline-start" />새로 시작</Button>
        </div>
        <ol className="flex gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {steps.map((s, i) => {
            if (folded && i > reviewAt) return null
            const on = s.id === flow.step, done = flow.done.includes(s.id), can = reachable(s.id)
            return (
              <li key={s.id} className="shrink-0">
                <button type="button" disabled={!can} onClick={() => go(s.id)} aria-current={on ? 'step' : undefined} className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${on ? 'bg-card font-semibold shadow-xs ring-1 ring-border' : can ? 'hover:bg-card/70' : 'cursor-not-allowed opacity-45'}`}>
                  <Keycap tone={on ? 'primary' : 'plain'} className="h-7 min-w-7 text-xs">{done && !on ? <CheckIcon /> : i + 1}</Keycap>
                  <span className={`max-w-40 truncate lg:max-w-none lg:whitespace-normal ${on ? '' : 'hidden lg:inline'}`}>{s.title}{s.optional && <span className="ml-1 text-xs font-normal text-muted-foreground">(해당 시)</span>}</span>
                </button>
              </li>
            )
          })}
          {folded && <li className="shrink-0"><button type="button" onClick={() => setShowAll(true)} className="flex h-full min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-card/70 hover:text-foreground"><ChevronDownIcon className="size-4" /><span className="whitespace-nowrap">이후 절차 {steps.length - reviewAt - 1}단계<span className="hidden lg:inline"> 보기</span></span></button></li>}
        </ol>
        {title && <p className="mt-3 hidden border-t px-1 pt-3 text-xs text-muted-foreground lg:block">진행 중: {title}</p>}
      </nav>

      <div className="min-w-0">
        <AnimatePresence mode="wait">
          {doneAll ? (
            <StepPanel key="fin" title="절차를 모두 마쳤습니다" hint="각 단계에서 고친 문서를 한 묶음으로 내려받을 수 있습니다.">
              <div className="flex flex-col items-start gap-4">
                <div className="flex items-center gap-3 text-sm"><Keycap tone="primary"><PartyPopperIcon /></Keycap>「{title}」 {mode === 'amend' ? '개정' : '제정'} 문서 {flow.sections?.length}종</div>
                <DocActions ds={ds((flow.sections || []).map((s) => s.id))} name={`${title}_전체문서`} />
                <div className="flex gap-2"><Button variant="outline" onClick={() => go(steps[steps.length - 1].id)}><ArrowLeftIcon data-icon="inline-start" />마지막 단계로</Button><Button onClick={restart}>새 작업 시작</Button></div>
              </div>
            </StepPanel>
          ) : cur.id === 'prepare' ? (
            <StepPanel key="prepare" title={`${idx + 1}. ${cur.title}`} hint={cur.hint}>
              {flow.result && <Alert className="mb-5"><AlertTitle>이미 만든 초안이 있습니다</AlertTitle><AlertDescription>여기서 다시 「초안 만들기」를 누르면 새 초안으로 바뀝니다. <Button variant="link" size="xs" className="px-1" onClick={() => go('review')}>초안 검토로 가기</Button></AlertDescription></Alert>}
              {mode === 'amend' ? <AmendForm key={formKey} preset={preset} busy={job.busy} onRun={run} /> : <EnactForm key={formKey} busy={job.busy} onRun={run} />}
            </StepPanel>
          ) : cur.id === 'draft' ? (
            <StepPanel key="draft" title={`${idx + 1}. ${cur.title}`} hint={cur.hint}>
              <div className="flex flex-col gap-4">
                <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} onBack={() => go('prepare')} title={mode === 'amend' ? '개정 초안 작업' : '제정 초안 작업'} />
                {!job.startedAt && !flow.result && <p className="text-sm text-muted-foreground">아직 시작하지 않았습니다. 이전 단계에서 「초안 만들기」를 누르세요.</p>}
                <div className="flex flex-wrap gap-2">{job.job?.status !== 'waiting' && <Button variant="outline" onClick={() => go('prepare')}><ArrowLeftIcon data-icon="inline-start" />입력 고치기</Button>}{flow.result && <Button onClick={() => go('review')}>초안 검토로<ArrowRightIcon data-icon="inline-end" /></Button>}</div>
              </div>
            </StepPanel>
          ) : cur.id === 'review' ? (
            <StepPanel key="review" title={`${idx + 1}. ${cur.title}`} hint={`「${title}」 ${flow.result?.docset.kind}안 — AI 초안입니다. 원문과 대조해 고치세요. 표와 본문은 눌러서 바로 고칠 수 있습니다.`}>
              <div className="flex flex-col gap-6">
                {flow.result?.no_change && <Alert><TriangleAlertIcon /><AlertTitle>바꿀 곳이 없습니다</AlertTitle><AlertDescription><p>{flow.result.no_change.refs.join(', ')}의 수정안이 현행과 같습니다. 요청한 내용이 이미 규정에 들어 있을 수 있으니 원문을 확인하세요.</p><Button variant="outline" size="sm" className="mt-2" onClick={() => go('prepare')}><ArrowLeftIcon data-icon="inline-start" />개정 의도 고쳐 다시 만들기</Button></AlertDescription></Alert>}
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border text-sm sm:grid-cols-4">
                  {([[mode === 'amend' ? '바뀌는 조문' : '조문', new Set((sec('comparison')?.rows || []).filter((r) => r.newHtml !== '(현행과 같음)').map((r) => r.ref)).size], ['대비표 행', sec('comparison')?.rows?.length || 0], ['근거 자료', (flow.result?.docset.evidence || []).filter((e: any) => !/^대상 규정/.test(e.label)).length], ['확인할 점', (sec('checklist')?.body || '').split('\n').filter((l) => l.startsWith('☐')).length]] as [string, number][]).map(([l, v], i) => <button type="button" key={l} title="눌러서 보기" onClick={() => { if (i < 2) { setRevTab('comparison'); jump('rv-docs') } else if (i === 2) { setEvOpen(true); jump('rv-ev') } else jump('rv-checks') }} className="group bg-card p-3 text-left transition-colors hover:bg-muted/60"><span className="flex items-center justify-between text-xs text-muted-foreground">{l}<ArrowRightIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" /></span><span className="block font-mono text-2xl font-semibold tabular-nums">{v}</span></button>)}
                </div>
                <Tabs id="rv-docs" className="scroll-mt-4 sm:scroll-mt-32" value={revTab ?? CORE.find((id) => sec(id))} onValueChange={(v) => setRevTab(String(v))}>
                  <TabsList>{CORE.filter((id) => sec(id)).map((id) => <TabsTrigger key={id} value={id}>{sec(id)!.title}</TabsTrigger>)}</TabsList>
                  {CORE.filter((id) => sec(id)).map((id) => <TabsContent key={id} value={id} className="rounded-md border bg-background p-3 sm:p-4"><DocEditor section={sec(id)!} onChange={update} /></TabsContent>)}
                </Tabs>
                {sec('full_text') && flow.result?.doc?.doc_id && <div className="-mt-3 flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground"><span>신구조문대비표·부칙을 고쳤다면(개정문만 고쳤다면 대비표에도 같게 고친 뒤)</span><Button variant="outline" size="sm" disabled={rebuilding} onClick={rebuildFull}>{rebuilding ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}개정 후 전문 다시 만들기</Button></div>}
                <section id="rv-checks" className="flex scroll-mt-4 sm:scroll-mt-32 flex-col gap-2">
                  <h3 className="flex items-center gap-2 font-semibold"><ListChecksIcon className="size-4" />확인할 점</h3>
                  {CHECKS.filter((id) => sec(id)).map((id, i) => (
                    <Collapsible key={id} defaultOpen={i === 0} className="rounded-md border bg-background">
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium">{sec(id)!.title}<ChevronDownIcon className="size-4 text-muted-foreground" /></CollapsibleTrigger>
                      <CollapsibleContent><div className="border-t p-3 sm:p-4"><DocEditor section={sec(id)!} onChange={update} /></div></CollapsibleContent>
                    </Collapsible>
                  ))}
                  <Collapsible id="rv-ev" open={evOpen} onOpenChange={setEvOpen} className="scroll-mt-4 sm:scroll-mt-32 rounded-md border bg-background">
                    <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium">근거 자료 {(flow.result?.docset.evidence || []).filter((e: any) => !/^대상 규정/.test(e.label)).length}건<ChevronDownIcon className="size-4 text-muted-foreground" /></CollapsibleTrigger>
                    <CollapsibleContent><ol className="flex flex-col gap-1.5 border-t p-3 text-sm">{(flow.result?.docset.evidence || []).map((e: any, i: number) => <li key={i}><span className="font-medium"><DocLink docId={e.doc_id} refName={e.ref}>{e.label}</DocLink></span> <span className="break-all text-xs text-muted-foreground">{e.doc_id}{e.ref ? ` ${e.ref}` : ''}{e.edition ? ` · ${e.edition}` : ''}</span></li>)}</ol></CollapsibleContent>
                  </Collapsible>
                </section>
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <DocActions ds={ds([...CORE, ...CHECKS])} name={`${title}_${flow.result?.docset.kind}안`} />
                  <Button size="lg" onClick={complete}>검토 완료 · 다음 단계<ArrowRightIcon data-icon="inline-end" /></Button>
                </div>
              </div>
            </StepPanel>
          ) : (
            <StepPanel key={cur.id} title={`${idx + 1}. ${cur.title}`} hint={cur.hint}>
              {!flow.sections ? <p className="text-sm text-muted-foreground">먼저 초안을 만들어야 합니다.</p> : (() => {
                const p = cur.proc
                const forms = [...p.docs.filter((d: string) => FORMS.includes(d)), ...(p.id === 'consult' && sec('opinion_review') ? ['opinion_review'] : [])].filter((d: string) => sec(d))
                const attach = p.docs.filter((d: string) => !FORMS.includes(d) && (sec(d) || d === 'evidence'))
                return (
                  <div className="flex flex-col gap-6">
                    <section><h3 className="mb-2 font-semibold">이 단계에서 할 일</h3><ul className="flex flex-col gap-1.5 text-sm">{p.todo.map((t: string) => <li key={t} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />{t}</li>)}</ul></section>
                    {forms.length > 0 && (
                      <section className="flex flex-col gap-2">
                        <h3 className="font-semibold">이 단계 문서 <span className="text-sm font-normal text-muted-foreground">— 빈칸(번호·날짜·담당 부서)을 채워 쓰세요</span></h3>
                        <Tabs defaultValue={forms[0]} key={forms.join()}>
                          {forms.length > 1 && <TabsList>{forms.map((d: string) => <TabsTrigger key={d} value={d}>{sec(d)!.title}</TabsTrigger>)}</TabsList>}
                          {forms.map((d: string) => <TabsContent key={d} value={d} className="rounded-md border bg-background p-3 sm:p-4">{forms.length === 1 && <div className="mb-2 text-sm font-medium text-muted-foreground">{sec(d)!.title}</div>}<DocEditor section={sec(d)!} onChange={update} /></TabsContent>)}
                        </Tabs>
                      </section>
                    )}
                    {attach.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-sm"><PaperclipIcon className="size-4 text-muted-foreground" /><span className="text-muted-foreground">붙임으로 쓸 문서</span>{attach.map((d: string) => <Badge key={d} variant="outline">{DOC_LABELS[d] || d}</Badge>)}</div>}
                    {(forms.length > 0 || attach.length > 0) && <DocActions ds={ds([...forms, ...attach.filter((d: string) => d !== 'evidence')])} name={`${title}_${cur.title}`} />}
                    {p.id === 'consult' && (
                      <section className="flex flex-col gap-3 rounded-md border bg-background p-3 sm:p-4">
                        <h3 className="flex items-center gap-2 font-semibold"><MessageSquareQuoteIcon className="size-4" />받은 의견 반영하기 <span className="text-sm font-normal text-muted-foreground">(선택)</span></h3>
                        <p className="text-sm text-muted-foreground">회신받은 의견을 붙여넣으면 의견별 처리안을 만들고, 반영할 의견은 직접 고릅니다. 의견마다 [부서명]으로 시작하거나 빈 줄 두 개로 나눠 주세요.</p>
                        <Textarea rows={5} value={opText} onChange={(e) => setOpText(e.target.value)} placeholder={'[인사팀] 분할 사용 횟수를 3회로 해 주십시오.\n\n\n[노동조합] 청구 기한 120일 반영 바랍니다.'} />
                        <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={!opText.trim() || opinions.busy} onClick={() => opinions.start('opinions', { title, kind: mode === 'enact' ? '제정' : '개정', changes: flow.result.changes, moves: flow.result.moves, opinions_text: opText, doc_id: flow.result.doc?.doc_id, addenda: sec('addenda')?.body })}>{opinions.busy && <Spinner data-icon="inline-start" />}처리안 만들기</Button></div>
                        <JobTimeline job={opinions.job} error={opinions.error} startedAt={opinions.startedAt} onAnswer={opinions.answer} onRetry={opinions.canRetry ? opinions.retry : undefined} title="의견 검토" />
                        {flow.opinionJob && opinions.job?.id === flow.opinionJob && <Alert><AlertTitle>의견을 반영했습니다</AlertTitle><AlertDescription>신구조문대비표와 {mode === 'amend' ? '개정문' : '제정안'}을 고쳤고, 「의견 검토서」를 이 단계 문서에 추가했습니다.</AlertDescription></Alert>}
                      </section>
                    )}
                    <p className="text-xs text-muted-foreground">{proc.note}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                      <Button variant="outline" onClick={() => go(steps[idx - 1].id)}><ArrowLeftIcon data-icon="inline-start" />이전</Button>
                      <div className="flex flex-wrap gap-2">
                        {cur.optional && <Button variant="ghost" onClick={complete}>해당 없음 · 건너뛰기</Button>}
                        <Button size="lg" onClick={complete}>{idx === steps.length - 1 ? '절차 마치기' : '완료 · 다음 단계'}<ArrowRightIcon data-icon="inline-end" /></Button>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </StepPanel>
          )}
        </AnimatePresence>
      </div>
      <Dialog open={askRestart} onOpenChange={setAskRestart}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>새로 시작할까요?</DialogTitle><DialogDescription>지금까지 만든 초안과 화면에서 고친 내용이 지워지며 되돌릴 수 없습니다. 필요하면 먼저 문서를 내려받으세요.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setAskRestart(false)}>취소</Button><Button variant="destructive" onClick={doRestart}><RotateCcwIcon data-icon="inline-start" />지우고 새로 시작</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
