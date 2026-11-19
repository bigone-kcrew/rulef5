// 규정 새로고침 — 화면 셸. 메뉴는 키보드 기능키 줄(F1~F12)이고 F5(브랜드 키)가 시작 화면이다.
import { SearchDialog } from '@/components/search-dialog'
import { SearchIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { BellIcon, BellOffIcon, MoonIcon, SunIcon } from 'lucide-react'
import { notify, setSoundOn, soundOn } from '@/lib/notify'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ProfileDialog } from '@/components/profile-dialog'
import { ModelDialog } from '@/components/model-dialog'
import { Keycap } from '@/components/keycap'
import { useTheme } from '@/components/theme-provider'
import { AppStateProvider, useApp } from '@/lib/app-state'
import { store, TYPE_LABEL } from '@/lib/api'

const Flow = lazy(() => import('@/views/flow'))
const VIEWS: Record<string, { el: any; title: string; desc: string; wide?: boolean }> = {
  home: { el: lazy(() => import('@/views/home')), title: '', desc: '' },
  amend: { el: Flow, title: '', desc: '', wide: true },
  enact: { el: Flow, title: '', desc: '', wide: true },
  agent: { el: lazy(() => import('@/views/agent')), title: '대화로 요청', desc: '하고 싶은 일을 문장으로 적으면 에이전트가 계획을 세우고 필요한 도구를 골라 실행합니다.' },
  impact: { el: lazy(() => import('@/views/impact')), title: '법 개정 영향', desc: '상위 법령이 바뀌었거나 곧 바뀔 때, 고쳐야 할 기관 규정 조문을 찾습니다.' },
  similar: { el: lazy(() => import('@/views/similar')), title: '기관 비교', desc: '같은 주제를 다른 기관은 어떻게 정했는지 비교표와 분포로 봅니다.' },
  check: { el: lazy(() => import('@/views/check')), title: '규정 점검', desc: '규정 묶음의 인용 오류·용어 혼용·수치 충돌 후보를 찾습니다.' },
  bulk: { el: lazy(() => import('@/views/bulk')), title: '일괄 개정', desc: '직제 개편·용어 통일을 여러 규정에 한꺼번에 적용합니다(바꿀 곳마다 확인).' },
  lawchain: { el: lazy(() => import('@/views/lawchain')), title: '법령 체계', desc: '법률 → 시행령 → 시행규칙 → 기관 규정으로 이어지는 위임 관계를 따라갑니다.' },
}
// 기능키 줄: 네 개씩 세 묶음. view 가 있으면 화면 전환, action 이면 대화상자.
export const FKEYS: { f: string; label: string; view?: string; action?: 'help' | 'profile' | 'model'; hint: string }[] = [
  { f: 'F1', label: '도움말', action: 'help', hint: '처음 쓰는 분을 위한 안내' },
  { f: 'F2', label: '개정', view: 'amend', hint: '있는 규정을 고칩니다 — 절차를 따라 안내' },
  { f: 'F3', label: '제정', view: 'enact', hint: '규정을 새로 만듭니다 — 절차를 따라 안내' },
  { f: 'F4', label: '대화로 요청', view: 'agent', hint: '문장으로 요청하면 에이전트가 실행' },
  { f: 'F5', label: '시작', view: 'home', hint: '처음 화면' },
  { f: 'F6', label: '법 개정 영향', view: 'impact', hint: '상위법이 바뀌었을 때 고칠 조문 찾기' },
  { f: 'F7', label: '기관 비교', view: 'similar', hint: '다른 기관 규정과 비교' },
  { f: 'F8', label: '규정 점검', view: 'check', hint: '인용·용어·충돌 점검' },
  { f: 'F9', label: '일괄 개정', view: 'bulk', hint: '여러 규정을 한꺼번에' },
  { f: 'F10', label: '법령 체계', view: 'lawchain', hint: '법률·시행령·규정 위임 관계' },
  { f: 'F11', label: '기관 설정', action: 'profile', hint: '기관 유형·명칭' },
  { f: 'F12', label: '모델 설정', action: 'model', hint: 'AI 모델 바꾸기' },
]

// 알림음 켜고 끄기(켤 때 한 번 들려준다)
function SoundToggle() {
  const [on, setOn] = useState(soundOn())
  const label = on ? '알림음 끄기(확인 필요·완료 시 울림)' : '알림음 켜기'
  return <button type="button" className="key grid size-8 place-items-center" aria-label={label} title={label} onClick={() => { setSoundOn(!on); setOn(!on); if (!on) notify('gate') }}>{on ? <BellIcon className="size-4" /> : <BellOffIcon className="size-4" />}</button>
}

function ThemeKey() {
  const { setTheme } = useTheme()
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => { const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark'))); o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); return () => o.disconnect() }, [])
  return <button type="button" className="key grid size-8 place-items-center" aria-label={dark ? '밝은 화면으로' : '어두운 화면으로'} title={dark ? '밝은 화면으로' : '어두운 화면으로'} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}</button>
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>도움말</DialogTitle><DialogDescription>규정 새로고침은 규정을 새로 만들거나(제정) 고칠 때(개정) 조사·초안·문서 작성을 돕습니다.</DialogDescription></DialogHeader>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3"><Keycap>F2</Keycap><span><b>개정</b> 또는 <b>F3 제정</b>을 누르면 절차를 따라 한 단계씩 안내합니다. 규정을 고르고, 바꿀 내용을 적고, 초안을 검토한 뒤 협의·심의·공포 문서를 받습니다.</span></li>
          <li className="flex gap-3"><Keycap>F4</Keycap><span>무엇을 눌러야 할지 모르겠으면 <b>대화로 요청</b>에 하고 싶은 일을 문장으로 적으세요.</span></li>
          <li className="flex gap-3"><Keycap>키보드</Keycap><span>키보드 <b>F1~F10</b>으로도 메뉴를 엽니다. F5·F11·F12는 브라우저 기능(새로 고침·전체 화면·개발자 도구) 그대로입니다.</span></li>
          <li className="flex gap-3"><Keycap>F6–10</Keycap><span>필요할 때 쓰는 도구입니다: <b>법 개정 영향</b>·<b>기관 비교</b>·<b>규정 점검</b>·<b>일괄 개정</b>·<b>법령 체계</b>.</span></li>
          <li className="flex gap-3"><Keycap>F11</Keycap><span><b>기관 설정</b>에서 기관 유형(공공기관·중앙행정기관·지방자치단체)과 기관명을 고르면 절차·문서 서식과 자료가 맞춰집니다(공공기관은 ALIO 내규, 부처·지자체는 법제처 행정규칙·자치법규). <b>F12</b>에서 AI 모델과 법제처 인증키를 바꿀 수 있습니다.</span></li>
          <li className="flex gap-3"><Keycap>알림</Keycap><span>AI가 작업하는 동안 화면을 지켜보지 않아도 됩니다.<br /><b>담당자 확인</b>이 필요하면 부드러운 알림음(세 음)이, 끝나면 두 음이 울리고 다른 탭에 있으면 탭 제목에도 표시됩니다. 머리글의 종 단추로 끌 수 있습니다(기본: 켜짐).</span></li>
          <li className="flex gap-3"><Keycap>검색</Keycap><span>머리글의 <b>검색</b>(Ctrl+K)은 AI 없이 내규·법령·단체협약·공시자료를 바로 찾습니다.<br />밑줄 친 문서 이름을 누르면 <b>원문</b>(해당 조항·문서 전체)이 열립니다.</span></li>
        </ol>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>모든 결과는 AI 초안입니다. 담당자가 원문과 대조해 확정하세요.</li>
          <li>민감정보·개인정보는 입력하지 마세요. 올린 파일은 24시간 뒤 삭제됩니다.</li>
          <li>초안 작성은 모델에 따라 10초~5분이 걸립니다. 진행 중 새로 고쳐도 작업이 이어집니다.</li>
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function Shell() {
  const { status, error, profile, modelTick } = useApp()
  const [tab, setTab] = useState<string>(() => (VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'home'))
  const [arg, setArg] = useState<any>(null)
  const [dlg, setDlg] = useState<null | 'help' | 'profile' | 'model' | 'search'>(null)
  // 키보드 기능키: 브라우저 기능과 겹치는 F5(새로 고침)·F11(전체 화면)·F12(개발자 도구)는 그대로 두고, 나머지 F1~F10 은 메뉴로 이동(입력 중이거나 창이 열려 있으면 무시)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^F([1-9]|10)$/.test(e.key) || e.key === 'F5') return
      const t = e.target as HTMLElement | null
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) || document.querySelector('[role="dialog"]')) return
      const k = FKEYS.find((x) => x.f === e.key); if (!k || (k.view && !enabled(k.view))) return
      e.preventDefault(); k.action ? setDlg(k.action) : go(k.view!)
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  // 원문 검색: Ctrl+K(맥 ⌘K) 또는 머리글 단추 — 메뉴(F키)를 늘리지 않고 어디서나 연다
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setDlg('search') } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [])
  const row = useRef<HTMLDivElement>(null)
  void modelTick
  const go = (view: string, a: any = null) => { setArg(a); setTab(view); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  useEffect(() => { const h = (e: Event) => { const d = (e as CustomEvent).detail; go(d.tab, d.arg) }; window.addEventListener('rulef5:go', h); return () => window.removeEventListener('rulef5:go', h) }, [])
  useEffect(() => { const h = () => { const v = location.hash.slice(1); if (VIEWS[v]) { setArg(null); setTab(v) } }; window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  useEffect(() => { // 기능키로 화면을 옮기면 방문 기록에 남겨 브라우저 「뒤로」가 앞 화면으로 돌아오게 한다(첫 화면만 기록을 바꿔 쓴다)
    if (location.hash.slice(1) !== tab) { if (location.hash) history.pushState(null, '', '#' + tab); else history.replaceState(null, '', '#' + tab) } row.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }) }, [tab])
  const enabled = (v?: string) => !v || v === 'home' || !!status?.features?.[v]
  const V = VIEWS[enabled(tab) ? tab : 'home']
  const m = store.model()
  const modelLabel = m?.preset ? `${m.preset === 'exaone' ? 'EXAONE' : m.model || m.preset}${m.apiKey ? '(내 키)' : ''}` : status?.llm ? status.llm.model : '모델 없음'
  const d = status?.data
  const leds: [string, boolean][] = [['ALIO', !!d?.alio_rest], [store.lawOc() ? '법제처(내 키)' : '법제처', !!d?.law_go || !!store.lawOc()], ['MCP', !!d?.alio_mcp], ['모델', !!(status?.llm || m?.apiKey)]]
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 pt-2.5 sm:px-4">
          <button type="button" onClick={() => go('home')} className="flex min-w-0 items-baseline gap-2 text-left" aria-label="시작 화면으로">
            <span className="truncate text-lg font-bold tracking-tight">규정 새로고침</span>
            <span className="hidden text-xs text-muted-foreground sm:inline"><span className="font-mono">Rule F5</span> · 새로(제정) + 고침(개정)</span>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" className="hidden max-w-64 truncate text-xs text-muted-foreground hover:text-foreground md:block" onClick={() => setDlg('profile')} title="기관 설정(F11)">{profile.name} · {TYPE_LABEL[profile.type]} · {modelLabel}</button>
            <div className="hidden items-center gap-2.5 sm:flex" aria-label="연결 상태">{leds.map(([k, on]) => <span key={k} className="flex items-center gap-1 text-[11px] text-muted-foreground" title={`${k} ${on ? '연결됨' : '미설정'}`}><span className="led" data-on={on} />{k}</span>)}</div>
            <button type="button" onClick={() => setDlg('search')} className="key flex h-9 items-center gap-1.5 px-2.5 text-sm" title="원문 검색(AI 없이) · Ctrl+K" aria-label="원문 검색"><SearchIcon className="size-4" /><span className="hidden sm:inline">검색</span><span className="hidden font-mono text-[10px] text-muted-foreground lg:inline">Ctrl K</span></button>
            <SoundToggle />
            <ThemeKey />
          </div>
        </div>
        <div ref={row} className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-2.5 sm:px-4" role="navigation" aria-label="기능키 메뉴">
          {FKEYS.map((k, i) => {
            const on = !!k.view && k.view === tab, ok = enabled(k.view)
            return (
              <button key={k.f} type="button" disabled={!ok} title={`${k.f} ${k.label} — ${k.hint}`} data-on={on} aria-current={on ? 'page' : undefined}
                onClick={() => (k.action ? setDlg(k.action) : go(k.view!))}
                className={`key flex h-12 min-w-[4.6rem] shrink-0 flex-col items-start justify-between px-2 py-1 text-left disabled:opacity-40 lg:flex-1 ${i % 4 === 0 && i ? 'ml-2 sm:ml-3' : ''} ${k.f === 'F5' && !on ? 'border-primary text-primary' : ''}`}>
                <span className="font-mono text-[10px] leading-none opacity-70">{k.f}</span>
                <span className="whitespace-nowrap text-[13px] font-semibold leading-none">{k.label}</span>
              </button>
            )
          })}
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-3 sm:p-4">
        {error && <Alert variant={/기다리는 중/.test(error) ? 'default' : 'destructive'} className="mb-4"><AlertTitle>{/기다리는 중/.test(error) ? '잠시만 기다려 주세요' : '서버에 연결하지 못했습니다'}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {status && !status.llm && !m?.apiKey && <Alert className="mb-4"><AlertTitle>AI 모델이 연결되지 않았습니다</AlertTitle><AlertDescription>검색·점검·대비표는 그대로 쓸 수 있고, 초안 작성은 <button type="button" className="underline underline-offset-4" onClick={() => setDlg('model')}>모델 설정(F12)</button>에서 키를 넣으면 됩니다.</AlertDescription></Alert>}
        {!status && !error && <div className="flex flex-col gap-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}
        <AnimatePresence mode="wait">
          {status && (
            <motion.div key={tab === 'home' ? tab : `${tab}:${profile.type}:${profile.name}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {V.title && <div className="mb-4"><h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight"><Keycap className="h-7 text-xs">{FKEYS.find((k) => k.view === tab)?.f}</Keycap>{V.title}</h1><p className="mt-1 text-sm text-muted-foreground">{V.desc}</p></div>}
              <Suspense fallback={<Skeleton className="h-64" />}>
                {tab === 'amend' || tab === 'enact' ? <Flow key={`${tab}:${arg ? JSON.stringify(arg) : ''}`} mode={tab} preset={arg} /> : <V.el preset={arg} onOpenDialog={setDlg} />}
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-5 pt-2 text-xs leading-relaxed text-muted-foreground">
        데이터: ALIO RAG(공공기관 공시 내규·법령) · 법제처 국가법령정보 Open API · 올린 자료는 24시간 뒤 자동 삭제 · <b>민감정보·개인정보는 입력하지 마세요.</b> 모든 결과는 AI 초안이며 담당자가 원문과 대조해야 합니다.
      </footer>
      <SearchDialog open={dlg === 'search'} onOpenChange={(v) => setDlg(v ? 'search' : null)} />
      <HelpDialog open={dlg === 'help'} onOpenChange={(v) => setDlg(v ? 'help' : null)} />
      <ProfileDialog open={dlg === 'profile'} onOpenChange={(v) => setDlg(v ? 'profile' : null)} />
      <ModelDialog open={dlg === 'model'} onOpenChange={(v) => setDlg(v ? 'model' : null)} />
    </div>
  )
}
export function goTab(tab: string, arg?: unknown) { window.dispatchEvent(new CustomEvent('rulef5:go', { detail: { tab, arg } })) }
export default function App() {
  return <AppStateProvider><TooltipProvider><Shell /><Toaster richColors /></TooltipProvider></AppStateProvider>
}
