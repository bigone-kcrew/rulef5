// 시작 화면(F5): 기관 유형 고르기 → 할 일 고르기(개정·제정 절차 / 대화로 요청). 보조 도구(F6~F10)는 머리글 기능키
import { useState } from 'react'
import { ArrowRightIcon, Building2Icon, LandmarkIcon, MapPinnedIcon } from 'lucide-react'
import { Keycap } from '@/components/keycap'
import { useApp } from '@/lib/app-state'
import { store, TYPE_LABEL, applyOrg, ORG_HINT, type Profile } from '@/lib/api'
import { InstPicker } from '@/components/inst-picker'
import { goTab } from '@/App'

const TYPES: [Profile['type'], string, typeof Building2Icon][] = [['public-institution', '공기업·준정부기관·기타공공기관', Building2Icon], ['central-ministry', '부·처·청(훈령·예규·고시)', LandmarkIcon], ['local-gov', '시·도·시·군·구(조례·규칙)', MapPinnedIcon]]
export default function HomeView({ onOpenDialog }: { onOpenDialog: (d: 'help' | 'profile' | 'model') => void }) {
  const { profile, setProfile, profiles, procedures, status } = useApp()
  // 처음 들어와도 공공기관이 선택된 상태로 시작한다(기본 프로필이 공공기관)
  const [chosen, setChosen] = useState(true)
  const pick = (type: Profile['type']) => { const d = profiles.find((p) => p.type === type); if (d && (type !== profile.type || !store.profile())) setProfile({ ...d, id: 'custom' }); setChosen(true) }
  const named = !/^예시 /.test(profile.name)
  const steps = procedures[profile.type]?.steps || []
  return (
    <div className="flex flex-col gap-6 py-2 sm:py-3">
      <section>
        <p className="text-sm text-muted-foreground"><span className="font-mono">F5</span> — 새로(제정) + 고침(개정)</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">규정, 절차대로 <span className="text-primary">새로 만들고 고칩니다</span></h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">유사 규정과 상위 법령을 조사해 <b className="font-semibold text-foreground">조문 초안</b>과 <b className="font-semibold text-foreground">신구조문대비표</b>를 만들고,<br className="hidden sm:inline" /> <b className="font-semibold text-primary">협의·심의·공포</b>까지 단계마다 필요한 문서를 준비합니다.</p>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="flex items-center gap-2.5 font-semibold"><Keycap className="h-7 min-w-7 text-xs">1</Keycap>어느 기관에서 쓰시나요? {chosen && <button type="button" className="text-sm font-normal text-muted-foreground underline underline-offset-4" onClick={() => onOpenDialog('profile')}>기관명·세부 설정</button>}</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map(([type, sub, I]) => (
            <button key={type} type="button" data-on={chosen && profile.type === type} onClick={() => pick(type)} className="key flex items-center gap-3 p-3 text-left">
              <I className="size-5 shrink-0" /><span><span className="block font-semibold">{TYPE_LABEL[type]}</span><span className="block text-xs opacity-75">{sub}</span></span>
            </button>
          ))}
        </div>
        {chosen && (
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <label htmlFor="home-org" className="shrink-0 text-sm font-medium">기관명 <span className="font-normal text-muted-foreground">(선택)</span></label>
            <div className="min-w-0 flex-1 sm:max-w-md"><InstPicker lazy id="home-org" type={profile.type} value={named ? profile.name : ''} placeholder={ORG_HINT[profile.type][0]} onPick={(x, text) => { const d = profiles.find((p) => p.type === profile.type); setProfile(applyOrg(profile, x, text.trim() ? text : d?.name || profile.name)) }} /></div>
            {profile.type === 'public-institution' && profile.inst_type && <span className="text-xs text-muted-foreground">{profile.inst_type} · 주무부처 {profile.ministry}</span>}
            {profile.type !== 'public-institution' && named && profile.approver && <span className="text-xs text-muted-foreground">결재·공포권자 {profile.approver}</span>}
          </div>
        )}
        <p className="text-sm leading-relaxed text-muted-foreground">기관 유형에 따라 <b className="font-semibold text-foreground">절차(준비·초안 작성 뒤 {steps.length}단계)</b>와 예고문·심의 안건·공포문 서식이 달라집니다. 기관명은 일부만 쳐도 목록에서 고를 수 있습니다.</p>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="flex items-center gap-2.5 font-semibold"><Keycap className="h-7 min-w-7 text-xs">2</Keycap>무엇을 하시겠어요?</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {[['F2', 'amend', '규정 고치기 (개정)', '고칠 규정과 바꿀 내용을 적으면 수정안과 신구조문대비표를 만듭니다.'], ['F3', 'enact', '규정 새로 만들기 (제정)', '제명·목적·상위법 조항을 적으면 조문 체계와 조문 초안을 만듭니다.']].map(([f, view, t, dsc]) => (
            <button key={view} type="button" onClick={() => goTab(view)} className="key group flex flex-col gap-2 p-4 text-left">
              <span className="flex items-center justify-between"><Keycap tone="primary" className="h-10 min-w-12 text-base">{f}</Keycap><ArrowRightIcon className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" /></span>
              <span><span className="block text-lg font-semibold">{t}</span><span className="mt-1 block text-sm text-muted-foreground">{dsc}</span></span>
              <span className="flex flex-wrap gap-x-1.5 gap-y-1 text-xs text-muted-foreground">{['준비', '초안', '검토', ...steps.filter((s) => s.id !== 'draft' && !s.optional).map((s) => s.title.split(/[·(]/)[0].trim())].map((s, i, a) => <span key={i}>{s}{i < a.length - 1 ? ' →' : ''}</span>)}</span>
            </button>
          ))}
        </div>
        {status?.features?.agent && (
          <button type="button" onClick={() => goTab('agent')} className="key flex items-center gap-3 p-3 text-left sm:p-4">
            <Keycap className="h-9 min-w-11">F4</Keycap><span className="min-w-0"><span className="block font-semibold">대화로 요청</span><span className="block text-sm text-muted-foreground">"우리 복무규정 배우자 출산휴가를 법 개정에 맞게 고쳐야 해"처럼 문장으로 적으면 에이전트가 알아서 진행합니다.</span></span>
          </button>
        )}
      </section>

    </div>
  )
}
