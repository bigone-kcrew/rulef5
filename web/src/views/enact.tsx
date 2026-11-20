// 제정 준비 단계 입력: 종류·제명·목적 + 상위법 위임 조항 (고급 옵션: 함께 정비할 기존 규정)
import { FastToggle, useFast } from '@/components/fast-toggle'
import { useState } from 'react'
import { motion } from 'motion/react'
import { PlusIcon, CornerDownLeftIcon, XIcon } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { TargetPicker, type Picked } from '@/components/target-picker'
import { StepTitle } from '@/components/keycap'
import { useApp } from '@/lib/app-state'

const KINDS: Record<string, string[]> = { 'public-institution': ['규정', '규칙', '세칙', '지침'], 'central-ministry': ['훈령', '예규', '고시', '지침'], 'local-gov': ['조례', '규칙', '훈령', '지침'] }
export function EnactForm({ busy, onRun }: { busy: boolean; onRun: (input: Record<string, unknown>) => void }) {
  const [fast, setFast] = useFast()
  const { profile } = useApp()
  const kinds = KINDS[profile.type] || KINDS['public-institution']
  const [kind, setKind] = useState(kinds[kinds.length - 1])
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [dels, setDels] = useState<{ doc_id?: string; ref?: string; text?: string; label: string }[]>([])
  const [lawDoc, setLawDoc] = useState<Picked | null>(null)
  const [pasteDel, setPasteDel] = useState('')
  const [related, setRelated] = useState<Picked | null>(null)
  const lawArts = lawDoc?.doc.articles?.filter((a) => a.section === '본칙' && a.ref) || []
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <StepTitle n={1}>무엇을 만드나요</StepTitle>
        <FieldGroup>
          <Field><FieldLabel>종류</FieldLabel><ToggleGroup value={[kind]} onValueChange={(v: string[]) => v[0] && setKind(v[0])} variant="outline" className="flex-wrap">{kinds.map((k) => <ToggleGroupItem key={k} value={k}>{k}</ToggleGroupItem>)}</ToggleGroup></Field>
          <Field><FieldLabel htmlFor="en-title">제명</FieldLabel><Input id="en-title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`예: ${profile.name} 직장 내 괴롭힘 예방 및 처리 ${kind}`} /></Field>
          <Field><FieldLabel htmlFor="en-purpose">제정 목적</FieldLabel><Textarea id="en-purpose" rows={3} maxLength={2000} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예: 직장 내 괴롭힘의 예방 교육, 신고 접수, 조사, 피해자 보호와 행위자 조치 절차를 정한다" /></Field>
        </FieldGroup>
      </section>
      <section className="flex flex-col gap-3">
        <StepTitle n={2}>상위법 위임 조항 <span className="text-sm font-normal text-muted-foreground">(없으면 비워 두세요 — 후보를 찾아 보여 줍니다)</span></StepTitle>
        <div className="flex flex-wrap gap-2">{dels.map((d, i) => <motion.span key={i} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}><Badge variant="secondary" className="h-auto gap-1 py-1">{d.label}<button type="button" aria-label="빼기" onClick={() => setDels(dels.filter((_, k) => k !== i))}><XIcon className="size-3" /></button></Badge></motion.span>)}</div>
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" />}><PlusIcon data-icon="inline-start" />위임 조항 추가</CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 flex flex-col gap-3 rounded-md border bg-card p-3">
              <TargetPicker onChange={setLawDoc} sources={['law']} />
              {lawArts.length > 0 && (
                <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2 text-sm">
                  {lawArts.map((a) => <button type="button" key={a.ref!} className="flex items-start gap-2 rounded px-2 py-1 text-left hover:bg-muted" onClick={() => setDels([...dels, { doc_id: lawDoc!.doc.doc_id, ref: a.ref!, label: `${lawDoc!.doc.title} ${a.ref}(${a.title})` }])}><PlusIcon className="mt-0.5 size-4 shrink-0" /><span><b>{a.ref}</b>({a.title}) <span className="text-muted-foreground">{a.body.slice(0, 60)}</span></span></button>)}
                </div>
              )}
              <div className="flex gap-2"><Textarea rows={2} value={pasteDel} onChange={(e) => setPasteDel(e.target.value)} placeholder="또는 위임 조항 원문 붙여넣기(예: ○○법 제12조 ③ … 필요한 사항은 조례로 정한다)" /><Button variant="secondary" disabled={!pasteDel.trim()} onClick={() => { setDels([...dels, { text: pasteDel.trim(), label: pasteDel.trim().slice(0, 24) + '…' }]); setPasteDel('') }}>추가</Button></div>
            </div>
          </CollapsibleContent>
        </Collapsible>
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="link" size="sm" className="px-0 text-muted-foreground" />}>고급 옵션: 함께 정비할 기존 규정{related?.uploads.length ? ` · ${related.uploads.length}개` : ''}</CollapsibleTrigger>
          <CollapsibleContent><div className="mt-2 rounded-md border bg-card p-3"><p className="mb-2 text-sm text-muted-foreground">새 규정 때문에 고쳐야 할 기존 규정을 고르면 부칙의 다른 규정 정비 대비표를 만듭니다.</p><TargetPicker onChange={setRelated} multi /></div></CollapsibleContent>
        </Collapsible>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
        <FastToggle fast={fast} setFast={setFast} />
        {(!title.trim() || !purpose.trim()) && <span className="text-sm text-muted-foreground">제명과 제정 목적을 적으세요</span>}
        <Button size="lg" disabled={!title.trim() || !purpose.trim() || busy} onClick={() => onRun({ kind, title: title.trim(), purpose: purpose.trim(), delegations: dels.map(({ label, ...d }) => (d.text ? { text: d.text, label } : d)), related_doc_ids: related?.uploads || [], auto: fast || undefined })}>
          {busy ? <Spinner data-icon="inline-start" /> : <CornerDownLeftIcon data-icon="inline-start" />}초안 만들기
        </Button>
      </div>
    </div>
  )
}
