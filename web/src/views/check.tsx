// 규정 점검: 규정 묶음(업로드·ALIO 기관 전체)의 인용 오류·용어 혼용·수치 충돌 후보
import { DocLink } from '@/components/doc-viewer'
import { useState } from 'react'
import { ArrowRightIcon, DownloadIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { JobTimeline } from '@/components/job-timeline'
import { Counter } from '@/components/docset-board'
import { TargetPicker, type Picked } from '@/components/target-picker'
import { InstPicker } from '@/components/inst-picker'
import { useApp } from '@/lib/app-state'
import { useJob } from '@/hooks/use-job'
import { download, tableCsv } from '@/lib/export'
import { goTab } from '@/App'
import { StepTitle } from '@/components/keycap'

const TYPE: Record<string, string> = { broken_ref: '인용 오류', term: '용어 혼용', conflict: '수치 충돌 후보', missing_reg: '규정 누락 확인' }
const SEV: Record<string, string> = { high: '높음', mid: '보통', check: '확인' }
export default function CheckView() {
  const { profile } = useApp()
  const gov = profile.type !== 'public-institution', word = profile.type === 'local-gov' ? '자치법규' : profile.type === 'central-ministry' ? '행정규칙' : '내규'
  const [mode, setMode] = useState('docs'); const [inst, setInst] = useState(gov ? (/^예시 /.test(profile.name) ? '' : profile.name) : profile.alio_inst || ''); const [kw, setKw] = useState(''); const [picked, setPicked] = useState<Picked | null>(null)
  const job = useJob('check')
  const r = job.job?.status === 'done' ? job.job.result : null
  const [only, setOnly] = useState('all')
  const shown = (r?.findings || []).filter((f: any) => only === 'all' || f.type === only)
  // 다음 단계: 용어 혼용은 F9 일괄 개정(찾을 말·바꿀 말·규정을 채워서), 나머지는 F2 개정(규정·조문·고칠 내용을 채워서)
  const next = (f: any) => f.type === 'term' && f.fix
    ? goTab('bulk', { find: f.fix.find, rep: f.fix.rep, docs: [{ doc_id: f.doc_id, title: f.doc_title }] })
    : goTab('amend', { doc_id: f.doc_id, refs: String(f.ref || '').split(',').map((x) => x.trim()).filter((x) => /^제\d/.test(x)).slice(0, 5), intent: `규정 점검에서 찾은 문제를 바로잡는다: ${f.message}`.slice(0, 600) })
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><StepTitle n={1}>점검할 규정</StepTitle><CardDescription>여러 규정을 고르면 서로의 인용도 함께 봅니다. 기관 전체 모드는 {gov ? `법제처 국가법령정보의 그 기관 ${word}` : 'ALIO에 공시된 그 기관 규정'}(최대 30개)을 한꺼번에 점검합니다.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ToggleGroup value={[mode]} onValueChange={(v: string[]) => v[0] && setMode(v[0])} variant="outline"><ToggleGroupItem value="docs">규정 선택·업로드</ToggleGroupItem><ToggleGroupItem value="inst">{gov ? `우리 기관 ${word} 전체` : 'ALIO 기관 전체'}</ToggleGroupItem></ToggleGroup>
          {mode === 'docs' ? <TargetPicker onChange={setPicked} multi /> : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1"><InstPicker type={profile.type} value={inst} placeholder={gov ? (profile.type === 'local-gov' ? '지방자치단체명(예: 경기도 수원시)' : '부처명(예: 고용노동부)') : '기관명(ALIO 공시 기관명)'} onPick={(_, t) => setInst(t)} /></div>
              {gov && <Input className="sm:w-64" value={kw} onChange={(e) => setKw(e.target.value)} maxLength={30} placeholder="제명 낱말로 좁히기(예: 복무, 문서) — 선택" />}
            </div>
          )}
          <div className="flex justify-end"><Button size="lg" disabled={job.busy || (mode === 'docs' ? !picked?.uploads.length : !inst.trim())} onClick={() => job.start('check', mode === 'docs' ? { doc_ids: picked!.uploads } : { inst: inst.trim(), org_type: profile.type, keyword: kw.trim() || undefined })}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}점검 시작{mode === 'docs' && picked?.uploads.length ? ` (${picked.uploads.length}개)` : ''}</Button></div>
        </CardContent>
      </Card>
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="규정 점검" />
      {r && (
        <Card>
          <CardHeader><CardTitle>점검 결과 — 규정 {r.stats.docs}개 · 조문 {r.stats.articles}개</CardTitle><CardDescription>규칙 기반 점검 후보입니다. 확정 오류가 아니므로 원문을 확인하세요. 고칠 항목은 <b>「개정 준비」</b>(F2 개정으로) 또는 <b>「일괄 개정으로 통일」</b>(용어 혼용 → F9)로 이어 갑니다.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(TYPE).map(([k, l]) => <Counter key={k} value={r.findings.filter((f: any) => f.type === k).length} label={l} />)}</div>
            {r.findings.length > 0 && <ToggleGroup value={[only]} onValueChange={(v: string[]) => v[0] && setOnly(v[0])} variant="outline" className="flex-wrap"><ToggleGroupItem value="all">전체 {r.findings.length}</ToggleGroupItem>{Object.entries(TYPE).filter(([k]) => r.findings.some((f: any) => f.type === k)).map(([k, l]) => <ToggleGroupItem key={k} value={k}>{l} {r.findings.filter((f: any) => f.type === k).length}</ToggleGroupItem>)}</ToggleGroup>}
            <Table>
              <TableHeader><TableRow><TableHead className="w-28">유형</TableHead><TableHead className="w-48">규정·조문</TableHead><TableHead>내용</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
              <TableBody>{shown.map((f: any, i: number) => <TableRow key={i}><TableCell className="align-top"><div className="flex flex-col gap-1"><Badge variant={f.severity === 'high' ? 'default' : 'outline'}>{TYPE[f.type]}</Badge><span className="text-xs text-muted-foreground">중요도 {SEV[f.severity]}</span></div></TableCell><TableCell className="whitespace-normal align-top"><div className="font-medium">{f.doc_title}</div><div className="text-xs text-muted-foreground"><DocLink docId={f.doc_id} refName={String(f.ref || '').split(',')[0]}>{f.ref}</DocLink></div></TableCell><TableCell className="whitespace-normal align-top text-sm"><div>{f.message}</div>{f.evidence && <div className="mt-1 text-xs text-muted-foreground">{f.evidence}</div>}</TableCell><TableCell className="align-top">{f.ref !== '-' && <Button size="xs" variant="outline" onClick={() => next(f)}>{f.type === 'term' && f.fix ? '일괄 개정으로 통일' : '개정 준비'}<ArrowRightIcon data-icon="inline-end" /></Button>}</TableCell></TableRow>)}</TableBody>
            </Table>
            {!r.findings.length && <p className="text-sm text-muted-foreground">점검 규칙에 걸린 항목이 없습니다(규칙 범위 안에서).</p>}
            <div><Button variant="outline" onClick={() => download('규정점검_결과.csv', tableCsv(r.findings.map((f: any) => ({ ...f, type: TYPE[f.type], severity: SEV[f.severity] })), [['type', '유형'], ['severity', '중요도'], ['doc_title', '규정'], ['ref', '조문'], ['message', '내용'], ['evidence', '원문']]), 'text/csv')}><DownloadIcon data-icon="inline-start" />CSV</Button></div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
