// 상위법 영향: 개정 전·후 조문 → 영향 조문 후보 → 개정으로 보내기
import { DocLink } from '@/components/doc-viewer'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { HistoryIcon, CheckIcon, SparklesIcon } from 'lucide-react'
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
  useEffect(() => {
    let live = true; setSbusy(true)
    api('/api/radar/suggest', { method: 'POST', body: { org_type: profile.type } }).then((v) => { if (!live) return; setSugg(v); if (!edited && v.items?.length) setRlaws(v.items.slice(0, 3).map((x: Sugg) => x.law).join(', ')) }).catch(() => live && setSugg(null)).finally(() => live && setSbusy(false))
    return () => { live = false }
  }, [profile.type]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = rlaws.split(',').map((x) => x.trim()).filter(Boolean)
  const toggleLaw = (law: string) => { setEdited(true); if (chosen.includes(law)) setRlaws(chosen.filter((x) => x !== law).join(', ')); else if (chosen.length >= 3) toast.info('한 번에 3개까지 비교합니다. 다른 법령을 먼저 빼 주세요.'); else setRlaws([...chosen, law].join(', ')) }
  const md = (s: string) => `${s.slice(0, 4) === String(new Date().getFullYear()) ? '' : `${s.slice(0, 4)}. `}${+s.slice(4, 6)}. ${+s.slice(6, 8)}.`
  const rows = (r?.candidates || []).filter((c: any) => filter === 'all' || c.status === filter)
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>시행예정 레이더</CardTitle><CardDescription>최근·곧 시행되는 법령 판본을 바로 앞 판본과 조문 단위로 비교해, 미리 정비할 기관 규정과 착수 권장일(시행 30일 전)을 정리합니다. 아래 제안은 법제처 자료로 자동으로 고르며, 법령명을 직접 넣어도 됩니다(3개까지).</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium"><SparklesIcon className="size-4 text-primary" />최근·곧 시행되는 관련 법령<span className="font-normal text-muted-foreground">— 눌러서 고르기(최대 3개)</span></div>
            {sbusy && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />법제처에서 시행일 기준 법령을 찾는 중…</div>}
            {sugg?.items?.length ? (
              <div className="flex flex-wrap gap-1.5">{sugg.items.map((x) => { const on = chosen.includes(x.law); return (
                <button key={x.law} type="button" aria-pressed={on} onClick={() => toggleLaw(x.law)} title={`${x.law} · ${x.kinds.join('·')} ${x.change} · 관련: ${x.why}`}
                  className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-left text-xs transition-colors pointer-coarse:min-h-10 ${on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
                  {on && <CheckIcon className="size-3.5 shrink-0" />}<span className="font-medium">{x.law}</span>
                  <span className={on ? 'opacity-80' : 'text-muted-foreground'}>{x.state === 'scheduled' ? `${md(x.eff)} 시행` : `${md(x.eff)} 시행됨`} · {x.why}{/타법/.test(x.change) ? ' · 타법개정' : ''}</span>
                </button>) })}</div>
            ) : !sbusy && <p className="text-xs text-muted-foreground">{sugg?.note || '제안을 불러오지 못했습니다. 법령명을 직접 넣어 주세요.'}</p>}
            {sugg?.items?.length ? <p className="text-xs text-muted-foreground">{sugg.note}. 기관 유형(F11)에 맞춰 복무·인사·보수·계약·정보공개 등에 영향을 주는 법령을 골랐습니다(전수 아님).</p> : null}
          </div>
          <div className="flex flex-wrap gap-2"><Input className="min-w-64 flex-1" value={rlaws} onChange={(e) => { setEdited(true); setRlaws(e.target.value) }} placeholder="법령명(쉼표로 구분, 최대 3개)" /><Button disabled={radar.busy} onClick={() => radar.start('radar', { org_type: profile.type, inst: inst || undefined, laws: rlaws.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3) })}>{radar.busy ? <Spinner data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}레이더 실행</Button></div>
          <JobTimeline job={radar.job} error={radar.error} startedAt={radar.startedAt} onAnswer={radar.answer} onRetry={radar.canRetry ? radar.retry : undefined} title="시행예정 레이더" />
          {rr && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{rr.note}{rr.errors?.length ? ` ⚠ 조회 실패: ${rr.errors.join(', ')}` : ''}</p>
              {rr.items.map((it: any, i: number) => (
                <div key={i} className="rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium"><Badge variant="outline">{it.effective_from.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')} 시행</Badge>{it.law} {it.ref}({it.title}) <span className="font-normal text-muted-foreground">{it.changes.map((c: any) => `${c.from}→${c.to}`).join(', ')}</span></div>
                  {it.affected.length > 0 ? <ul className="mt-1 flex flex-col gap-1">{it.affected.map((a: any, k: number) => <li key={k} className="flex flex-wrap items-center gap-2"><Badge variant={a.status === 'candidate' ? 'default' : 'outline'}>{LABEL[a.status]}</Badge><DocLink docId={a.doc_id} refName={a.ref}>{a.inst} {a.doc_title} {a.ref}</DocLink><Button size="xs" variant="link" onClick={() => goTab('amend', { doc_id: a.doc_id, refs: [a.ref], intent: `${it.law} ${it.ref} 개정(${ymdDot(it.effective_from)} 시행)에 맞춰 ${a.ref}를 개정한다.` })}>개정안 만들기</Button></li>)}</ul> : <p className="mt-1 text-xs text-muted-foreground">수치 변경이 없거나 영향 조문을 찾지 못했습니다(검색 범위 내).</p>}
                </div>
              ))}
              <Button variant="outline" className="self-start" onClick={() => download('시행예정_정비계획.txt', rr.plan_text, 'text/plain')}><DownloadIcon data-icon="inline-start" />정비 계획서</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><StepTitle n={1}>판본에서 불러오기(선택)</StepTitle><CardDescription>법령명과 조문 번호를 넣으면 ALIO 법령 코퍼스의 판본 연혁에서 현행과 직전 변경본을 찾아 아래 개정 전·후 칸을 채웁니다.</CardDescription></CardHeader>
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
        <CardHeader><StepTitle n={2}>상위 법령의 개정 전·후 조문</StepTitle><CardDescription>바뀐 조문을 넣으면 같은 사항을 정한 기관 규정 조문을 찾아 아직 반영되지 않은 곳을 개정 후보로 표시합니다. <Button variant="outline" size="xs" className="ml-1" onClick={() => { setLaw(EX.law); setBefore(EX.before); setAfter(EX.after); setTopic(EX.topic) }}>예시 채우기</Button></CardDescription></CardHeader>
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
