// 에이전트 진행 타임라인: 단계가 실시간으로 펼쳐지고, 사람 확인 지점에서 멈춘다
import { DocLink } from '@/components/doc-viewer'
import { Fragment, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CheckIcon, XIcon, MinusIcon, HandIcon, FileSearchIcon, TerminalIcon, RotateCwIcon, ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { MoreTrigger } from '@/components/more-trigger'
import type { Gate, Job } from '@/lib/api'

// 끝난 작업은 서버가 잰 시간(시작~마지막 갱신)을 보여 준다 — 새로 고친 뒤에도 시간이 늘지 않게
function Elapsed({ since, stop, span }: { since: number; stop: boolean; span?: number | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (stop) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [stop])
  return <span className="tabular-nums">{Math.round((stop && span != null ? span : (stop ? now : Date.now()) - since) / 1000)}초</span>
}

function GateCard({ gate, onAnswer, onBack }: { gate: Gate; onAnswer: (v: unknown) => Promise<void>; onBack?: () => void }) {
  const [sel, setSel] = useState<string[]>(() => (gate.options || []).filter((o) => o.checked).map((o) => o.value))
  const [sending, setSending] = useState(false)
  const toggle = (v: string, c: boolean) => setSel((cur) => (gate.multi ? (c ? [...cur, v] : cur.filter((x) => x !== v)) : c ? [v] : []))
  const opts = gate.options || []
  const send = async () => { if (sending) return; setSending(true); try { await onAnswer(gate.multi ? sel : sel[0] ?? null) } catch (e) { alert((e as Error).message); setSending(false) } }
  // 키보드: Enter = 지금 선택(추천)대로 확인, 1~9 = 그 번호 선택 켜고 끄기 — 입력 중이거나 다른 창이 열려 있으면 무시
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(t.tagName) || t.isContentEditable)) || document.querySelector('[role="dialog"]')) return
      if (e.key === 'Enter') { e.preventDefault(); send(); return }
      const n = /^[1-9]$/.test(e.key) ? +e.key - 1 : -1
      if (n >= 0 && n < opts.length) { e.preventDefault(); const v = opts[n].value; toggle(v, !sel.includes(v)) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  })
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="relative rounded-lg border-2 border-primary bg-primary/5 p-4">
      <span className="absolute -top-3 left-4 flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"><HandIcon className="size-3.5" />사람 확인</span>
      <p className="mb-3 mt-1 font-semibold">{gate.prompt}</p>
      <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1">
        {opts.map((o, i) => (<Fragment key={o.value}>
          {o.group && o.group !== opts[i - 1]?.group && <div className="mt-1 text-xs font-semibold text-muted-foreground first:mt-0">{o.group}</div>}
          <motion.label initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className={`flex cursor-pointer items-start gap-3 rounded-md border p-2.5 transition-colors ${sel.includes(o.value) ? 'bg-muted/50' : 'text-muted-foreground hover:bg-muted/30'}`}>
            {i < 9 && <kbd className="mt-0.5 hidden rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline">{i + 1}</kbd>}
            <Checkbox className="mt-0.5" checked={sel.includes(o.value)} onCheckedChange={(c) => toggle(o.value, !!c)} />
            <span className="min-w-0 text-sm"><span className="font-medium">{o.doc_id ? <DocLink docId={o.doc_id} refName={o.ref}>{o.label}</DocLink> : o.label}</span>{o.detail && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{o.detail}</span>}</span>
          </motion.label>
        </Fragment>))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gate.multi && <Button variant="outline" size="sm" onClick={() => setSel((gate.options || []).map((o) => o.value))}>모두 선택</Button>}
        <span className="text-xs text-muted-foreground">{sel.length}개 선택</span>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Enter 확인 · 숫자 키 선택</span>
      </div>
      <div className="mt-3 flex flex-col-reverse gap-2 border-t border-primary/20 pt-3 sm:flex-row sm:items-center">
        {onBack && <Button variant="outline" onClick={onBack}><ArrowLeftIcon data-icon="inline-start" />입력 고치기</Button>}
        <Button size="lg" className="px-4 sm:ml-auto" disabled={sending} onClick={send}>{sending && <Spinner data-icon="inline-start" />}확인하고 계속<ArrowRightIcon data-icon="inline-end" /></Button>
      </div>
    </motion.div>
  )
}

const ICON = { running: Spinner, done: CheckIcon, failed: XIcon, skipped: MinusIcon }
export function JobTimeline({ job, error, startedAt, onAnswer, onRetry, onBack, title = '에이전트 작업' }: { job: Job | null; error: string | null; startedAt: number | null; onAnswer: (gate: string, v: unknown) => Promise<void>; onRetry?: () => void; onBack?: () => void; title?: string }) {
  if (!startedAt) return null
  const status = error ? 'failed' : job?.status || 'running'
  const done = job?.steps.filter((s) => s.state === 'done').length || 0
  return (
    <Card className="overflow-hidden">
      <div className="h-1 w-full bg-muted"><motion.div className={`h-full ${status === 'failed' ? 'bg-destructive' : 'bg-primary'}`} initial={{ width: '4%' }} animate={{ width: status === 'done' ? '100%' : `${Math.min(92, 6 + done * 15)}%` }} transition={{ type: 'spring', stiffness: 60 }} /></div>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status === 'running' && <Spinner />}{title}
          <Badge variant={status === 'done' ? 'secondary' : status === 'failed' ? 'destructive' : 'outline'}>{{ running: '진행 중', waiting: '확인 대기', done: '완료', failed: '중단' }[status]}</Badge>
        </CardTitle>
        <CardDescription>{status === 'running' ? '모델 응답에 단계마다 20~90초 걸릴 수 있습니다. 진행 상황이 실시간으로 표시됩니다.' : status === 'waiting' ? '에이전트가 판단이 필요한 지점에서 멈췄습니다. 확인하면 이어서 진행합니다.' : status === 'done' ? '끝났습니다. 아래 결과를 확인하세요.' : '중단된 단계와 사유를 확인하세요.'}</CardDescription>
        <CardAction className="text-sm text-muted-foreground"><Elapsed since={startedAt} stop={status === 'done' || status === 'failed'} span={job?.created && job?.updated ? job.updated - job.created : null} /></CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert variant="destructive"><AlertTitle>요청 실패</AlertTitle><AlertDescription>{error}</AlertDescription>{onRetry && <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}><RotateCwIcon data-icon="inline-start" />다시 시도</Button>}</Alert>}
        {!job && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />작업을 시작합니다…</div>}
        <ol className="relative flex flex-col gap-0">
          <AnimatePresence initial={false}>
            {job?.steps.map((s, i) => {
              const I = ICON[s.state]
              return (
                <motion.li key={i} layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < job.steps.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-border" />}
                  <motion.span layout className={`z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs ${s.state === 'done' ? 'bg-foreground text-background' : s.state === 'failed' ? 'bg-destructive text-white' : s.state === 'running' ? 'border-2 border-primary bg-background text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <I className="size-4" />
                  </motion.span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="font-medium">{s.name}{(s as any).ms != null && <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{((s as any).ms / 1000).toFixed(1)}초</span>}</div>
                    {s.note && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`mt-0.5 whitespace-pre-wrap text-sm ${s.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{s.note}</motion.p>}
                    {s.evidence?.length > 0 && (
                      <Collapsible className="mt-1.5">
                        <MoreTrigger icon={<FileSearchIcon data-icon="inline-start" />}>근거·출처 {s.evidence.length}건</MoreTrigger>
                        <CollapsibleContent>
                          <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                            {s.evidence.map((e, k) => <motion.div key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.04 }} className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"><div className="font-medium"><DocLink docId={e.doc_id} refName={e.ref}>{e.label}</DocLink></div><div className="truncate text-muted-foreground">{e.doc_id}{e.edition ? ` · ${e.edition}` : ''}</div></motion.div>)}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ol>
        <AnimatePresence>{job?.status === 'waiting' && job.gate && <GateCard key={job.gate.id} gate={job.gate} onBack={onBack} onAnswer={(v) => onAnswer(job.gate!.id, v)} />}</AnimatePresence>
        {job?.status === 'failed' && <Alert variant="destructive"><AlertTitle>작업이 중단되었습니다</AlertTitle><AlertDescription>{job.error?.message}{/llm_(timeout|truncated|rate|unavailable)/.test(job.error?.code || '') ? ' 모델 응답이 늦거나 끊겼습니다. 다시 시도하거나 상단 「모델」에서 빠른 모델(GPT-OSS 등)로 바꿔 보세요.' : ''}</AlertDescription>{onRetry && <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}><RotateCwIcon data-icon="inline-start" />다시 시도</Button>}</Alert>}
        {!!job?.logs?.length && (
          <Collapsible>
            <MoreTrigger icon={<TerminalIcon data-icon="inline-start" />}>실행 기록 {job.logs.length}건</MoreTrigger>
            <CollapsibleContent><pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">{job.logs.map((l) => l.text).join('\n')}</pre></CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  )
}
