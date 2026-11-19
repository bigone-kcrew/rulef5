// 대화로 요청(F4): 요청 → 계획 → 도구 실행 기록 → 사람 확인 → 결과. 문서 세트가 나오면 절차 화면으로 이어 간다.
import { useState } from 'react'
import { ArrowRightIcon, ArrowUpIcon, CheckIcon, CircleIcon, MinusIcon, XIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Message, MessageContent } from '@/components/ui/message'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Trace, TraceLine, TraceIcon, TraceTitle } from '@/components/ui/trace'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { JobTimeline } from '@/components/job-timeline'
import { DocsetBoard } from '@/components/docset-board'
import { TargetPicker, type Picked } from '@/components/target-picker'
import { useJob } from '@/hooks/use-job'
import { openFlowWithResult } from '@/views/flow'
import { goTab } from '@/App'
import { useApp } from '@/lib/app-state'
import { Badge } from '@/components/ui/badge'

const EXAMPLES = ['대구경북첨단의료산업진흥재단 취업규칙의 배우자 출산휴가를 남녀고용평등법 개정에 맞게 20일로 고쳐야 해', '우리 공단에 직장 내 괴롭힘 예방 및 처리 지침을 새로 만들어야 해', '다른 기관들은 출장 복명서 제출 기한을 어떻게 정했는지 비교해 줘']
const TOOL_KO: Record<string, string> = { search_regulations: '규정 찾기', load_document: '원문 불러오기', get_article: '조문 보기', search_law: '법령 찾기', find_citations: '인용 조문 찾기', compare_versions: '이전 판본과 비교', find_similar: '유사 규정 조사', draft_amendment: '개정안 작성', draft_enactment: '제정안 작성', analyze_impact: '법 개정 영향 분석', build_comparison_table: '비교표 만들기', check_regulation: '규정 점검', procedure_next: '절차 안내', ask_user: '담당자에게 확인', bulk_amend: '일괄 개정', review_opinions: '의견 검토', scheduled_radar: '시행예정 법령 확인', finish: '마무리' }
export default function AgentView() {
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const job = useJob('agent')
  const plan = job.job?.plan
  const { procedures, profile } = useApp()
  // 개정·제정 요청이면 초안 다음 기관 절차도 미리 보여 준다(F2·F3 절차 화면에서 이어 감)
  const drafting = plan?.intents?.some((x: string) => x === 'amend' || x === 'enact') || plan?.steps?.some((x: any) => /^draft_/.test(x.tool))
  const nextSteps = (procedures[profile.type]?.steps || []).filter((x: any) => x.id !== 'draft' && !x.optional).map((x: any) => x.title.split(/[·(]/)[0].trim())
  const send = () => { const m = msg.trim(); if (!m) return; setSent(m); setMsg(''); job.start('agent', { message: m, doc_id: picked?.doc.doc_id, extraDocIds: picked?.uploads }) }
  const r = job.job?.status === 'done' ? job.job.result : null
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-2 rounded-md border bg-background p-2 focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea rows={3} className="border-0 bg-transparent shadow-none focus-visible:ring-0" maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }} placeholder="예: 우리 복무규정 배우자 출산휴가를 법 개정에 맞게 20일로 고쳐야 해" />
          <div className="flex items-center gap-2"><span className="font-mono text-[11px] text-muted-foreground">Ctrl + Enter</span><Button className="ml-auto" disabled={!msg.trim() || job.busy} onClick={send}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowUpIcon data-icon="inline-start" />}보내기</Button></div>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <span className="text-xs text-muted-foreground">예시를 눌러 채우기</span>
          {EXAMPLES.map((x) => <Button key={x} variant="outline" size="sm" className="h-auto max-w-full justify-start whitespace-normal py-1.5 text-left font-normal" onClick={() => setMsg(x)}>{x}</Button>)}
        </div>
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="link" size="sm" className="h-auto justify-start whitespace-normal px-0 text-left text-muted-foreground" />}>고급 옵션: 대상 규정을 미리 지정(부처·지자체 자료 올리기){picked ? ` · ${picked.doc.title || '선택됨'}` : ''}</CollapsibleTrigger>
          <CollapsibleContent><div className="pt-2"><TargetPicker onChange={setPicked} /></div></CollapsibleContent>
        </Collapsible>
      </section>
      {(sent || plan) && (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-5">
          {sent && <Message align="end"><MessageContent><Bubble align="end"><BubbleContent>{sent}</BubbleContent></Bubble></MessageContent></Message>}
          {plan && (
            <Message><MessageContent>
              <Bubble variant="ghost"><BubbleContent>{plan.reply}</BubbleContent></Bubble>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">진행 단계</span>
                {plan.provisional ? <Badge variant="outline">예상 순서 · 계획 세우는 중</Badge> : plan.finished ? <Badge variant="secondary">완료</Badge> : plan.remaining != null && <Badge variant="secondary">남은 단계 {plan.remaining}개</Badge>}
              </div>
              <Trace>
                {plan.steps.map((s: any, i: number) => {
                  const running = !plan.provisional && plan.current === i && job.busy
                  return (
                    <TraceLine key={i} status={s.done ? undefined : running ? 'running' : s.skipped ? 'error' : 'pending'} className={running ? 'font-medium text-foreground' : undefined}>
                      <TraceIcon>{s.done ? <CheckIcon /> : running ? <Spinner /> : s.failed ? <XIcon className="text-destructive" /> : s.skipped ? <MinusIcon /> : <CircleIcon />}</TraceIcon>
                      <TraceTitle>{i + 1}. {TOOL_KO[s.tool] || s.tool}{s.why ? ` — ${s.why}` : ''}{running ? (job.job?.status === 'waiting' ? ' · 확인을 기다림' : ' · 진행 중') : s.notRun ? ' · 실행 안 함(앞 단계에서 마침)' : s.failed ? ' · 실패(다음 단계로 진행)' : s.skipped ? ' · 건너뜀' : ''}</TraceTitle>
                    </TraceLine>
                  )
                })}
              </Trace>
              {drafting && nextSteps.length > 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">초안 다음 절차({procedures[profile.type]?.name}): {nextSteps.join(' → ')} — 결과가 나오면 「절차 따라 이어 가기」로 단계마다 필요한 문서를 준비합니다.</p>
              )}
            </MessageContent></Message>
          )}
          {r?.suggestions?.length > 0 && <Message><MessageContent><Bubble variant="ghost"><BubbleContent><b>다음 할 일</b><ul className="mt-1 list-disc pl-5">{r.suggestions.map((s: string) => <li key={s}>{s}</li>)}</ul></BubbleContent></Bubble></MessageContent></Message>}
        </section>
      )}
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="에이전트 실행 기록" />
      {r?.docset && (r.kind === '개정' || r.kind === '제정') && (
        <section className="flex flex-col items-start gap-3 rounded-lg border-2 border-primary bg-card p-4 sm:p-5">
          <h2 className="text-lg font-semibold">「{r.docset.title}」 {r.docset.kind}안 초안이 준비되었습니다</h2>
          <p className="text-sm text-muted-foreground">초안 검토부터 협의·심의·공포까지 절차를 따라 이어 가세요. 단계마다 필요한 문서를 보여 줍니다.</p>
          <Button size="lg" onClick={() => goTab(openFlowWithResult(r))}>절차 따라 이어 가기<ArrowRightIcon data-icon="inline-end" /></Button>
        </section>
      )}
      {r?.docset && r.kind !== '개정' && r.kind !== '제정' && <DocsetBoard result={r} />}
      {r?.table && <section className="rounded-lg border bg-card p-4"><h2 className="mb-2 font-semibold">유사 규정 비교</h2><ul className="flex flex-col gap-2 text-sm">{r.table.map((x: any, i: number) => <li key={i} className="rounded-md border p-2"><b>{x.label}</b> <span className="text-muted-foreground">({x.edition})</span><div className="text-muted-foreground">{x.excerpt}</div></li>)}</ul></section>}
    </div>
  )
}
