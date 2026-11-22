// 기관 비교(F7): 우리 기관(A)과 비교 대상(B: 같은 주무부처 / 같은 기관 유형 / 직접 고른 기관 / 전체)을 같은 주제로 견준다
import { DocLink } from '@/components/doc-viewer'
import { useEffect, useState } from 'react'
import { ArrowRightIcon, DownloadIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { JobTimeline } from '@/components/job-timeline'
import { InstPicker, type Inst } from '@/components/inst-picker'
import { StepTitle } from '@/components/keycap'
import { useJob } from '@/hooks/use-job'
import { useApp } from '@/lib/app-state'
import { api } from '@/lib/api'
import { download, tableCsv } from '@/lib/export'
import { goTab } from '@/App'

// 예시 주제: 그 유형의 규정이 실제로 정하는 사항(공무원 휴가 일수 등은 대통령령이 정하므로 조례·훈령 예시에서 뺀다)
const TOPICS: Record<string, string[]> = { 'public-institution': ['배우자 출산휴가', '육아휴직 기간', '출장 복명서 제출 기한', '병가 일수', '징계 시효'], 'local-gov': ['당직 근무', '공무직 배우자 출산휴가', '시간외근무', '출장 복명', '포상 추천'], 'central-ministry': ['공무직 배우자 출산휴가', '당직 근무', '재택근무', '출장 복명', '보안 점검'] }
// 기관 유형마다 비교 대상이 다르다: 공공기관은 ALIO 내규, 지자체는 자치법규, 부처는 행정규칙(법제처) 또는 산하 공공기관(ALIO)
type Scope = [value: string, label: string, help: (m: Inst | null) => string, needMine: boolean]
const SCOPES: Record<string, Scope[]> = {
  'public-institution': [
    ['ministry', '같은 주무부처', (m) => (m ? `${m.ministry} 산하 기관의 규정과 비교합니다.` : '우리 기관을 고르면 같은 주무부처 산하 기관과 비교합니다.'), true],
    ['type', '같은 기관 유형', (m) => (m ? `${m.type}끼리 비교합니다.` : '우리 기관을 고르면 같은 유형(공기업·준정부기관·기타공공기관) 기관과 비교합니다.'), true],
    ['picked', '직접 고르기', () => '', false],
    ['all', '전체', () => '전체 공공기관에서 주제에 맞는 규정을 찾아 비교합니다.', false],
  ],
  'local-gov': [
    ['region', '같은 시·도', (m) => (m ? (m.sub === '광역자치단체' ? `${m.name} 안 시·군·구의 자치법규와 비교합니다.` : `${m.name.split(' ')[0]} 안 다른 시·군·구의 자치법규와 비교합니다.`) : '우리 지방자치단체를 고르면 같은 시·도 안 시·군·구와 비교합니다.'), true],
    ['level', '같은 종류', (m) => (m ? `${m.sub === '기초자치단체' ? `같은 기초자치단체(${(m.name.match(/(시|군|구)$/) || ['', ''])[1]})` : m.sub}끼리 비교합니다.` : '우리 지방자치단체를 고르면 시는 시끼리, 군은 군끼리, 구는 구끼리 비교합니다.'), true],
    ['picked', '직접 고르기', () => '', false],
    ['all', '전체', () => '모든 지방자치단체의 자치법규에서 주제에 맞는 조문을 찾아 비교합니다.', false],
  ],
  'central-ministry': [
    ['subsidiaries', '산하 공공기관', (m) => (m ? `${m.name} 산하 공공기관 내규(ALIO)와 우리 부처 행정규칙을 비교합니다 — 감독·지침 시달 관점.` : '우리 부처를 고르면 산하 공공기관 내규와 비교합니다.'), true],
    ['level', '같은 종류 부처', (m) => (m ? `${/위원회$/.test(m.name) ? '위원회' : /부$/.test(m.name) ? '부' : /처$/.test(m.name) ? '처' : '청'}끼리 행정규칙을 비교합니다.` : '우리 부처를 고르면 부·처·청·위원회 가운데 같은 종류끼리 비교합니다.'), true],
    ['picked', '직접 고르기', () => '', false],
    ['all', '전체', () => '모든 중앙행정기관의 행정규칙에서 주제에 맞는 조문을 찾아 비교합니다.', false],
  ],
}
export default function SimilarView() {
  const { profile } = useApp()
  const scopes = SCOPES[profile.type] || SCOPES['public-institution']
  const [mineText, setMineText] = useState(profile.type === 'public-institution' ? profile.alio_inst || '' : /^예시 /.test(profile.name) ? '' : profile.name)
  const [mine, setMine] = useState<Inst | null>(null)
  const [scope, setScope] = useState(scopes[0][0])
  useEffect(() => { setScope(scopes[0][0]); setPicked([]) }, [profile.type]) // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string[]>([])
  const [addText, setAddText] = useState('')
  const [topic, setTopic] = useState('')
  const job = useJob('similar')
  const r = job.job?.status === 'done' ? job.job.result : null
  // 저장된 기관을 목록에서 찾아 우리 기관으로 둔다
  useEffect(() => { const name = profile.type === 'public-institution' ? profile.alio_inst : /^예시 /.test(profile.name) ? '' : profile.name; if (!name) { setMine(null); setMineText(''); return } api<{ items: Inst[] }>(`/api/orgs?type=${profile.type}&q=${encodeURIComponent(name)}`).then((r) => { const x = r.items.find((i) => i.name === name); setMine(x || null); setMineText(name) }).catch(() => {}) }, [profile.type, profile.alio_inst, profile.name])
  const cur = scopes.find((x) => x[0] === scope) || scopes[0]
  const needMine = cur[3]
  const ready = !!topic.trim() && (!needMine || !!mine) && (scope !== 'picked' || picked.length > 0)
  const why = !topic.trim() ? '비교할 주제를 적으세요' : needMine && !mine ? '우리 기관을 목록에서 고르세요' : scope === 'picked' && !picked.length ? '비교할 기관을 추가하세요' : ''
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-6 rounded-lg border bg-card p-4 sm:p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <StepTitle n="A">우리 기관</StepTitle>
            <InstPicker type={profile.type} value={mineText} placeholder={profile.type === 'local-gov' ? '예: 경기도 수원시' : profile.type === 'central-ministry' ? '예: 고용노동부' : '예: 소상공인시장진흥공단'} onPick={(i, text) => { setMine(i); setMineText(text) }} />
            {mine ? <div className="flex flex-wrap gap-1.5 text-sm">{profile.type === 'public-institution' ? <><Badge variant="secondary">{mine.type}</Badge><Badge variant="outline">주무부처 {mine.ministry}</Badge></> : <Badge variant="secondary">{mine.sub}</Badge>}</div> : <p className="text-sm text-muted-foreground">목록에서 고르면 비교 기준이 정해집니다. 비워 두고 전체·직접 고른 기관만 비교할 수도 있습니다.</p>}
            <p className="text-xs text-muted-foreground">{profile.type === 'public-institution' ? '자료: ALIO 공시 공공기관 내규' : profile.type === 'local-gov' ? '자료: 법제처 국가법령정보 자치법규(조례·규칙)' : '자료: 법제처 국가법령정보 행정규칙(훈령·예규·고시) · 산하 공공기관은 ALIO'} · 기관 유형은 F11 기관 설정에서 바꿉니다.</p>
          </div>
          <div className="flex flex-col gap-3">
            <StepTitle n="B">누구와 비교하나요</StepTitle>
            <ToggleGroup value={[scope]} onValueChange={(v: string[]) => v[0] && setScope(v[0])} variant="outline" className="flex-wrap">
              {scopes.map(([v, l]) => <ToggleGroupItem key={v} value={v}>{l}</ToggleGroupItem>)}
            </ToggleGroup>
            {cur[2](mine) && <p className="text-sm text-muted-foreground">{cur[2](mine)}</p>}
            {scope === 'picked' && (
              <div className="flex flex-col gap-2">
                <InstPicker type={profile.type} value={addText} placeholder="비교할 기관 이름(최대 10곳)" onPick={(i, text) => { if (i && !picked.includes(i.name) && picked.length < 10) { setPicked([...picked, i.name]); setAddText('') } else setAddText(text) }} />
                <div className="flex flex-wrap gap-1.5">{picked.map((p) => <Badge key={p} variant="secondary" className="h-auto gap-1 py-1">{p}<button type="button" aria-label={`${p} 빼기`} onClick={() => setPicked(picked.filter((x) => x !== p))}><XIcon className="size-3" /></button></Badge>)}</div>
              </div>
            )}
          </div>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="sim-topic">무엇을 비교하나요</FieldLabel>
            <Input id="sim-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예: 배우자 출산휴가" maxLength={100} onKeyDown={(e) => { if (e.key === 'Enter' && ready) job.start('similar', { topic: topic.trim(), mine: mine?.name || mineText.trim() || undefined, org_type: profile.type, scope, insts: picked, n: 10, auto: true }) }} />
            <div className="flex flex-wrap gap-1.5">{(TOPICS[profile.type] || TOPICS['public-institution']).map((x) => <Button key={x} variant="outline" size="sm" className="rounded-full" onClick={() => setTopic(x)}>{x}</Button>)}</div>
            <FieldDescription>같은 주제를 정한 조문을 기관마다 하나씩 찾아 값(일수·기한 등)을 나란히 놓습니다.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
          {why && <span className="text-sm text-muted-foreground">{why}</span>}
          <Button size="lg" disabled={!ready || job.busy} onClick={() => job.start('similar', { topic: topic.trim(), mine: mine?.name || mineText.trim() || undefined, org_type: profile.type, scope, insts: picked, n: 10, auto: true })}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}비교하기</Button>
        </div>
      </section>
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="기관 비교" />
      {r && (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
          <header><h2 className="text-xl font-semibold tracking-tight">{r.topic} — {r.scope_label}</h2><p className="mt-1 text-sm text-muted-foreground">{r.note}. 다른 기관 규정은 참고 사례이며 우리 기관 적용 근거가 아닙니다. 판본·적용 대상을 원문으로 확인하세요.</p></header>
          {(() => {
            // 다음 단계: 우리 값이 비교 기관에서 가장 흔한 값과 다르면 바로 개정 준비, 우리 규정에 조문이 없으면 신설 검토
            const me = r.table.find((x: any) => x.mine), d = r.distribution, top = d?.buckets?.length ? [...d.buckets].sort((a: any, b: any) => b.count - a.count)[0] : null
            const myVal = d?.mine?.value || (me && d ? me.values?.[d.column] : null)
            if (!r.mine) return null
            if (!me) return (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 sm:flex-row sm:items-center">
                <p className="flex-1 text-sm">우리 기관({r.mine.name}) 규정에서 이 주제를 정한 조문을 찾지 못했습니다{top ? ` — 비교 기관은 ${d.column} ${top.value}로 정한 곳이 가장 많습니다(${top.count}/${d.sample}곳)` : ''}. 주제어를 규정에 쓰인 낱말로 바꿔 다시 찾거나, 새 조문을 넣는 개정을 준비하세요.</p>
                <Button size="sm" onClick={() => goTab('amend', { intent: `${r.topic}에 관한 조문을 새로 넣는다.${top ? ` 비교 기관(${r.scope_label}) 가운데 ${top.count}곳이 ${d.column}을(를) ${top.value}로 정한다.` : ''}` })}>새 조문 넣기 — 개정 준비<ArrowRightIcon data-icon="inline-end" /></Button>
              </div>)
            if (top && myVal && top.value !== myVal) return (
              <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 sm:flex-row sm:items-center">
                <p className="flex-1 text-sm">우리 기관 {d.column} <b>{myVal}</b> · 비교 기관에서 가장 많은 값 <b>{top.value}</b>({top.count}/{d.sample}곳). 바꿀지 검토하려면 개정을 준비하세요(다른 기관 규정은 참고 사례이며 적용 근거가 아닙니다).</p>
                <Button size="sm" onClick={() => goTab('amend', { doc_id: me.doc_id, refs: me.ref ? [me.ref] : [], intent: `기관 비교(${r.scope_label}, ${d.sample}곳)에서 ${r.topic}의 ${d.column}을(를) ${top.value}로 정한 기관이 가장 많다(${top.count}곳). 우리 ${me.ref || '조문'}(현재 ${myVal})을(를) ${top.value}로 바꾸는 것을 검토한다.` })}>개정 준비<ArrowRightIcon data-icon="inline-end" /></Button>
              </div>)
            if (top && myVal) return <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">우리 기관 {d.column} <b className="text-foreground">{myVal}</b> — 비교 기관에서 가장 많은 값과 같습니다({top.count}/{d.sample}곳). 지금 바꿀 필요는 없어 보입니다.</p>
            return null
          })()}
          {r.off_topic?.length > 0 && <p className="text-sm text-muted-foreground">주제 조문을 찾지 못해 뺀 기관 {r.off_topic.length}곳: {r.off_topic.join(', ')} <span className="whitespace-nowrap">(검색 범위에서 못 찾았다는 뜻이며 규정이 없다는 뜻은 아닙니다)</span></p>}
          {r.distribution?.buckets?.length > 0 && (
            <div className="rounded-md border bg-background p-3 sm:p-4">
              <div className="mb-2 text-sm font-medium">분포 — {r.distribution.column} <span className="font-normal text-muted-foreground">(조사 {r.distribution.sample}곳 · 값을 못 찾은 곳 {r.distribution.failed}곳)</span></div>
              <div className="flex flex-col gap-1.5">
                {r.distribution.buckets.map((b: any) => { const me = r.distribution.mine?.value === b.value; return (
                  <div key={b.value} className="flex items-center gap-2 text-sm">
                    <span className={`w-20 shrink-0 text-right font-mono tabular-nums ${me ? 'font-semibold text-primary' : ''}`}>{b.value}</span>
                    <div className="h-5 flex-1 rounded-sm bg-muted"><div className={`h-5 rounded-sm ${me ? 'bg-primary' : 'bg-foreground/70'}`} style={{ width: `${r.distribution.sample ? (b.count / r.distribution.sample) * 100 : 0}%` }} /></div>
                    <span className="w-24 shrink-0 text-muted-foreground"><span className="font-mono tabular-nums">{b.count}</span>곳{me ? ' · 우리 기관' : ''}</span>
                  </div>) })}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[640px]">
              <TableHeader><TableRow><TableHead className="w-52">기관·규정</TableHead>{r.columns.map((c: string) => <TableHead key={c}>{c}</TableHead>)}<TableHead>원문 발췌</TableHead></TableRow></TableHeader>
              <TableBody>{r.table.map((x: any) => (
                <TableRow key={x.key} className={x.mine ? 'bg-primary/5' : ''}>
                  <TableCell className="whitespace-normal align-top"><div className="flex flex-wrap items-center gap-1.5 font-medium">{x.inst}{x.mine && <Badge>우리 기관</Badge>}</div><div className="text-xs text-muted-foreground"><DocLink docId={x.doc_id} refName={x.ref}>{x.doc_title} {x.ref}</DocLink> · {x.edition}</div><div className="text-xs text-muted-foreground">{x.type}{x.ministry ? ` · ${x.ministry}` : ''}</div>{x.mine && <Button variant="link" size="xs" className="h-auto px-0" onClick={() => goTab('amend', { doc_id: x.doc_id, refs: x.ref ? [x.ref] : [], intent: `기관 비교(${r.scope_label}) 결과를 참고해 ${x.ref || ''}(${r.topic})를 검토한다.` })}>이 조문 개정하기</Button>}</TableCell>
                  {r.columns.map((c: string, ci: number) => <TableCell key={c} className="whitespace-normal align-top font-medium">{x.values[c] || <span className="text-muted-foreground">—</span>}{ci === 0 && x.differs && <Badge variant="outline" className="ml-1.5">우리와 다름</Badge>}{ci === 0 && x.mixed && <Badge variant="outline" className="ml-1.5 font-normal text-muted-foreground">경우별 값 · 원문 확인</Badge>}</TableCell>)}
                  <TableCell className="whitespace-normal align-top text-sm text-muted-foreground">{x.excerpt}</TableCell>
                </TableRow>))}
              </TableBody>
            </Table>
          </div>
          <div><Button variant="outline" size="sm" onClick={() => download(`기관비교_${r.topic}.csv`, tableCsv(r.table.map((x: any) => ({ ...x, ...x.values, mine: x.mine ? '우리 기관' : '' })), [['mine', '구분'], ['inst', '기관'], ['type', '유형'], ['ministry', '주무부처'], ['doc_title', '규정'], ['ref', '조문'], ...r.columns.map((c: string) => [c, c] as [string, string]), ['excerpt', '발췌'], ['edition', '판본']]), 'text/csv')}><DownloadIcon data-icon="inline-start" />CSV</Button></div>
        </section>
      )}
    </div>
  )
}
