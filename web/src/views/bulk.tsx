// 일괄 개정: 여러 규정의 같은 낱말을 한꺼번에(바꿀 곳마다 사람 확인, 조사 자동 보정, 부칙·「」 제외)
import { useState } from 'react'
import { ArrowRightIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { JobTimeline } from '@/components/job-timeline'
import { DocsetBoard } from '@/components/docset-board'
import { TargetPicker, type Picked } from '@/components/target-picker'
import { InstPicker } from '@/components/inst-picker'
import { useApp } from '@/lib/app-state'
import { useJob } from '@/hooks/use-job'
import { StepTitle } from '@/components/keycap'

// preset: F8 규정 점검의 「일괄 개정으로 통일」에서 찾을 말·바꿀 말·대상 규정을 넘겨받는다
export default function BulkView({ preset }: { preset?: { find?: string; rep?: string; docs?: { doc_id: string; title: string }[] } | null }) {
  const { profile } = useApp(); const gov = profile.type !== 'public-institution', word = profile.type === 'local-gov' ? '자치법규' : '행정규칙'
  const fromCheck = preset?.docs?.length ? preset.docs : null
  const [mode, setMode] = useState('docs'); const [inst, setInst] = useState(gov ? (/^예시 /.test(profile.name) ? '' : profile.name) : profile.alio_inst || ''); const [picked, setPicked] = useState<Picked | null>(fromCheck ? { doc: { doc_id: fromCheck[0].doc_id } as any, uploads: fromCheck.map((d) => d.doc_id), refs: [] } : null)
  const [usePreset, setUsePreset] = useState(!!fromCheck)
  const [find, setFind] = useState(preset?.find || ''); const [rep, setRep] = useState(preset?.rep || '')
  const job = useJob('bulk')
  const r = job.job?.status === 'done' ? job.job.result : null
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><StepTitle n={1}>대상 규정</StepTitle><CardDescription>바꿀 규정 묶음을 올리거나 ALIO 기관 전체를 고릅니다.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ToggleGroup value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0])} variant="outline"><ToggleGroupItem value="docs">규정 선택·업로드</ToggleGroupItem><ToggleGroupItem value="inst">{gov ? `우리 기관 ${word} 전체` : 'ALIO 기관 전체'}</ToggleGroupItem></ToggleGroup>
          {mode === 'docs' && usePreset && fromCheck ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm"><span className="text-muted-foreground">규정 점검에서 넘어온 규정:</span><b>{fromCheck.map((d) => d.title).join(', ')}</b><Button variant="ghost" size="xs" className="ml-auto" onClick={() => { setUsePreset(false); setPicked(null) }}>다른 규정 고르기</Button></div>
          ) : mode === 'docs' ? <TargetPicker onChange={setPicked} multi /> : <InstPicker type={profile.type} value={inst} onPick={(_, t) => setInst(t)} placeholder={gov ? (profile.type === 'local-gov' ? '지방자치단체명(예: 경기도 수원시) — 법제처 자치법규' : '부처명(예: 고용노동부) — 법제처 행정규칙') : '기관명(ALIO 공시 기관명)'} />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><StepTitle n={2}>바꿀 말</StepTitle><CardDescription>조사(은/는·이/가·을/를·과/와·으로/로)는 받침에 맞춰 자동 보정합니다. 부칙과 「」 안의 법령명은 바꾸지 않고, 정의 조항은 바꿉니다. 합성어로 보이는 곳은 기본 해제되며, 바꿀 곳마다 확인을 받습니다.</CardDescription></CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="bk-f">찾을 말</FieldLabel><Input id="bk-f" maxLength={30} value={find} onChange={(e) => setFind(e.target.value)} placeholder="예: 근로자" /></Field>
              <Field><FieldLabel htmlFor="bk-r">바꿀 말</FieldLabel><Input id="bk-r" maxLength={30} value={rep} onChange={(e) => setRep(e.target.value)} placeholder="예: 직원" /></Field>
            </div>
            <FieldDescription>결과: 규정별 위치 특정형 개정문(「제3조제1항 중 "근로자는"을 "직원은"으로 한다」), 규정별 신구조문대비표, 재검증(용어·인용).</FieldDescription>
          </FieldGroup>
          <div className="mt-4 flex justify-end"><Button size="lg" disabled={job.busy || !find.trim() || !rep.trim() || (mode === 'docs' ? !picked?.uploads.length : !inst.trim())} onClick={() => job.start('bulk', { org_type: profile.type, find: find.trim(), replace: rep.trim(), ...(mode === 'docs' ? { doc_ids: picked!.uploads } : { inst: inst.trim() }) })}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}바꿀 곳 찾기</Button></div>
        </CardContent>
      </Card>
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="일괄 개정" />
      {r && !r.docset && <p className="text-sm text-muted-foreground">{r.note}</p>}
      {r?.docset && <DocsetBoard result={r} />}
    </div>
  )
}
