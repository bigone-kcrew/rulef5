// 개정 준비 단계 입력: 대상 규정 + 개정 의도 (고급 옵션: 조 번호 처리)
import { FastToggle, useFast } from '@/components/fast-toggle'
import { useState } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import { TargetPicker, type Picked } from '@/components/target-picker'
import { StepTitle } from '@/components/keycap'

const EXAMPLES = ['남녀고용평등법 개정에 맞춰 배우자 출산휴가를 20일로 늘리고 청구기간을 120일로 바꾼다', '출장 복명서 제출 기한을 7일에서 5일로 줄이고 전자 제출을 허용한다', '육아기 근로시간 단축 대상 자녀 연령을 만 12세 이하로 넓힌다']
export type AmendPreset = { intent?: string; doc_id?: string; refs?: string[] }
export function AmendForm({ preset, busy, onRun }: { preset?: AmendPreset | null; busy: boolean; onRun: (input: Record<string, unknown>) => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  const [intent, setIntent] = useState(preset?.intent || '')
  const [renumber, setRenumber] = useState('false')
  const [fast, setFast] = useFast()
  const [lawTarget, setLawTarget] = useState(false)
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <StepTitle n={1}>고칠 규정을 고르세요</StepTitle>
        <p className="text-sm text-muted-foreground">공공기관은 ALIO, 중앙행정기관·지방자치단체는 법제처 행정규칙·자치법규에서 찾거나 파일을 올립니다.</p>
        <TargetPicker onChange={setPicked} showArticles initialDocId={preset?.doc_id} initialRefs={preset?.refs} sources={lawTarget ? ['alio', 'upload', 'law'] : ['alio', 'upload']} />
      </section>
      <section className="flex flex-col gap-3">
        <StepTitle n={2}>무엇을 왜 바꾸나요</StepTitle>
        <FieldGroup>
          <Field>
            <Textarea rows={3} maxLength={2000} value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="예: 상위법 개정에 맞춰 배우자 출산휴가를 20일로 늘린다" />
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-xs text-muted-foreground">예시를 눌러 채우기</span>
              {EXAMPLES.map((x) => <Button key={x} variant="outline" size="sm" className="h-auto max-w-full justify-start whitespace-normal py-1.5 text-left font-normal" onClick={() => setIntent(x)}>{x}</Button>)}
            </div>
          </Field>
        </FieldGroup>
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="link" size="sm" className="px-0 text-muted-foreground" />}>고급 옵션</CollapsibleTrigger>
          <CollapsibleContent>
            <label className="flex items-center gap-2 pt-2 text-sm"><Checkbox checked={lawTarget} onCheckedChange={(c) => setLawTarget(!!c)} />법령·행정규칙·자치법규도 고칠 대상으로 고르기(법령 단위)</label>
            <Field className="pt-3">
              <FieldLabel>조문을 새로 넣을 때</FieldLabel>
              <ToggleGroup value={[renumber]} onValueChange={(v: string[]) => v[0] && setRenumber(v[0])} variant="outline" className="flex-wrap">
                <ToggleGroupItem value="false">가지조문(제7조의2) — 번호 유지</ToggleGroupItem>
                <ToggleGroupItem value="true">조 번호 다시 매김</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>번호를 다시 매기면 이 규정과 같은 기관 다른 규정의 인용 조문 정정 목록을 자동으로 만듭니다.</FieldDescription>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <FastToggle fast={fast} setFast={setFast} />
        {!picked && <span className="text-sm text-muted-foreground">먼저 규정을 고르세요</span>}
        {picked && !intent.trim() && <span className="text-sm text-muted-foreground">바꿀 내용을 적으세요</span>}
        <Button size="lg" disabled={!picked || !intent.trim() || busy} onClick={() => picked && onRun({ doc_id: picked.doc.doc_id, intent: intent.trim(), refs: picked.refs, renumber: renumber === 'true', extraDocIds: picked.uploads.filter((d) => d !== picked.doc.doc_id), auto: fast || undefined })}>
          {busy ? <Spinner data-icon="inline-start" /> : <CornerDownLeftIcon data-icon="inline-start" />}초안 만들기
        </Button>
      </div>
    </div>
  )
}
