// 법령 체계(F10): 법률 → 시행령 → 시행규칙 3단 체계를 먼저 보여 주고, 법률 조문을 고르면 그 조문을 따르는 하위 조문과 기관 규정을 이어 보여 준다
import { DocLink } from '@/components/doc-viewer'
import { useState } from 'react'
import { ArrowRightIcon, ChevronRightIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { JobTimeline } from '@/components/job-timeline'
import { StepTitle } from '@/components/keycap'
import { useApp } from '@/lib/app-state'
import { useJob } from '@/hooks/use-job'
import { api, type Doc } from '@/lib/api'
import { goTab } from '@/App'

type Tier = { doc_id: string; title: string; source?: string; date?: string } | null
type Family = { base: string | null; tiers: { law: Tier; decree: Tier; rule: Tier; decree_more?: { title: string }[] }; others: { title: string }[] }
const TIERS: ['law' | 'decree' | 'rule', string][] = [['law', '법률'], ['decree', '시행령'], ['rule', '시행규칙']]
const Arrow = () => <><ChevronRightIcon className="hidden size-5 shrink-0 self-center text-muted-foreground md:block" /><ChevronDownIcon className="size-5 shrink-0 self-center text-muted-foreground md:hidden" /></>

export default function LawChainView() {
  const { profile } = useApp(); const gov = profile.type !== 'public-institution', named = !/^예시 /.test(profile.name)
  const [name, setName] = useState(''); const [fam, setFam] = useState<Family | null>(null); const [doc, setDoc] = useState<Doc | null>(null)
  const [ref, setRef] = useState(''); const [filter, setFilter] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false)
  const job = useJob('lawchain')
  const r = job.job?.status === 'done' ? job.job.result : null
  const find = async (q = name) => {
    if (!q.trim()) return
    setBusy(true); setMsg(''); setFam(null); setDoc(null); setRef('')
    try {
      const f = await api<Family>('/api/law-family', { method: 'POST', body: { name: q.trim() } })
      if (!f.tiers.law) { setMsg(f.others.length ? '법률을 정확히 찾지 못했습니다. 아래 후보에서 고르세요.' : '법령을 찾지 못했습니다. 이름을 확인하세요.'); setFam(f); return }
      setFam(f); setDoc(await api<Doc>('/api/doc?id=' + encodeURIComponent(f.tiers.law.doc_id)))
    } catch (e) { setMsg((e as Error).message) } finally { setBusy(false) }
  }
  const arts = (doc?.articles || []).filter((a) => a.section === '본칙' && a.ref && (!filter.trim() || `${a.ref} ${a.title}`.includes(filter.trim())))
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-6 rounded-lg border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3">
          <StepTitle n={1}>법령 찾기</StepTitle>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); find() }}>
            <Input className="min-w-48 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="법률 이름(예: 근로기준법, 남녀고용평등법)" maxLength={80} />
            <Button type="submit" disabled={busy || !name.trim()}>{busy ? <Spinner data-icon="inline-start" /> : <SearchIcon data-icon="inline-start" />}찾기</Button>
          </form>
          <div className="flex flex-wrap gap-1.5">{['근로기준법', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', '공공기관의 운영에 관한 법률'].map((x) => <Button key={x} variant="outline" size="sm" className="rounded-full" onClick={() => { setName(x); find(x) }}>{x}</Button>)}</div>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </div>
        {fam && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
              {TIERS.map(([k, label], i) => { const t = fam.tiers[k]; return (
                <div key={k} className="contents">
                  {i > 0 && <Arrow />}
                  <div className={`flex min-w-0 flex-1 flex-col gap-1 rounded-md border p-3 ${t ? (k === 'law' ? 'border-primary bg-primary/5' : 'bg-background') : 'border-dashed text-muted-foreground'}`}>
                    <span className="text-xs font-medium text-muted-foreground">{k === 'decree' && t && !/시행령$/.test(t.title) ? '하위 대통령령' : label}</span>
                    <span className="font-semibold leading-snug">{t ? t.title : '찾지 못함'}</span>
                    {t && <span className="text-xs text-muted-foreground">{t.source}{t.date ? ` · 시행 ${t.date}` : ''}</span>}
                    {k === 'decree' && (fam.tiers.decree_more?.length || 0) > 0 && <span className="text-xs text-muted-foreground">그 밖의 대통령령: {fam.tiers.decree_more!.map((x) => x.title).join(', ')}</span>}
                  </div>
                </div>) })}
            </div>
            {fam.others.length > 0 && <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-muted-foreground">다른 법령:</span>{fam.others.slice(0, 5).map((o) => <Button key={o.title} variant="ghost" size="xs" onClick={() => { setName(o.title); find(o.title) }}>{o.title}</Button>)}</div>}
          </div>
        )}
        {doc && (
          <div className="flex flex-col gap-3">
            <StepTitle n={2}>법률의 어느 조문에서 출발하나요</StepTitle>
            <Input className="max-w-sm" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="조문 번호·제목으로 거르기(예: 연차, 제60조)" />
            <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto rounded-md border bg-background p-2">{arts.map((a) => <Button key={a.ref!} size="xs" variant={ref === a.ref ? 'default' : 'outline'} onClick={() => setRef(a.ref!)}>{a.ref} {a.title}</Button>)}{!arts.length && <span className="p-1 text-sm text-muted-foreground">맞는 조문이 없습니다.</span>}</div>
            <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
              {!ref && <span className="text-sm text-muted-foreground">조문을 고르세요</span>}
              <Button size="lg" disabled={!ref || job.busy} onClick={() => job.start('lawchain', { org_type: profile.type, inst: gov && named ? profile.name : undefined, law_doc_id: fam!.tiers.law!.doc_id, decree_doc_id: fam!.tiers.decree?.doc_id, rule_doc_id: fam!.tiers.rule?.doc_id, ref })}>{job.busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}이 조문을 따라가기</Button>
            </div>
          </div>
        )}
      </section>
      <JobTimeline job={job.job} error={job.error} startedAt={job.startedAt} onAnswer={job.answer} onRetry={job.canRetry ? job.retry : undefined} title="법령 체계 따라가기" />
      {r && (
        <section className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6">
          <header><h2 className="text-xl font-semibold tracking-tight">{r.law.title} {r.law.ref}에서 이어지는 조문</h2><p className="mt-1 text-sm text-muted-foreground">{r.delegations.length ? `위임: ${r.delegations.map((d: any) => `[${d.level}] ${d.text}`).join(' · ')}` : '위임 문구는 없습니다.'}{r.errors?.length ? ` ⚠ 일부 조회 실패(${r.errors.join('·')}) — 없다는 뜻이 아닙니다.` : ''}</p></header>
          <div className="flex flex-col gap-2 md:flex-row md:items-start">
            {(['법률', '시행령', '시행규칙'] as const).map((lv, i) => { const items = r.chain.filter((c: any) => c.level === lv); return (
              <div key={lv} className="contents">
                {i > 0 && <Arrow />}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">{lv}<Badge variant="outline" className="font-mono">{items.length}</Badge></div>
                  {items.map((c: any, k: number) => <div key={k} className={`rounded-md border p-3 text-sm ${lv === '법률' ? 'border-primary bg-primary/5' : 'bg-background'}`}><div className="font-medium">{c.ref} {c.title}</div><p className="mt-1 line-clamp-5 text-xs text-muted-foreground">{c.excerpt}</p></div>)}
                  {!items.length && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">이 조문을 인용하는 {lv} 조문을 찾지 못했습니다.</p>}
                </div>
              </div>) })}
          </div>
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">이 조문과 닿아 있는 {gov ? `${named ? profile.name + ' ' : ''}${profile.type === 'local-gov' ? '자치법규' : '행정규칙'}` : '기관 규정'}<Badge variant="outline" className="font-mono">{r.chain.filter((c: any) => c.level === '기관 규정').length}</Badge><span className="font-normal text-muted-foreground">법령명·조문 제목 언급으로 찾은 근사 결과</span></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {r.chain.filter((c: any) => c.level === '기관 규정').slice(0, 30).map((c: any, k: number) => <div key={k} className="rounded-md border bg-background p-3 text-sm"><div className="font-medium"><DocLink docId={c.doc_id} refName={c.ref}>{c.doc_title} {c.ref}</DocLink></div><p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.excerpt}</p>{c.ref && <Button className="mt-1 h-auto px-0" size="xs" variant="link" onClick={() => goTab('amend', { doc_id: c.doc_id, refs: [c.ref], intent: `${r.law.title} ${r.law.ref} 개정 내용을 반영한다.` })}>이 조문 개정하기</Button>}</div>)}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
