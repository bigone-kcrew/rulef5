// 앱 전역 상태: 서버 상태·절차 템플릿·기본 프로필·현재 프로필·결과 문서 키
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, store, type Profile, type Status } from '@/lib/api'
type Proc = { type: string; name: string; note: string; steps: { id: string; title: string; todo: string[]; docs: string[]; basis: string; optional?: boolean }[] }
type Ctx = { status: Status | null; procedures: Record<string, Proc>; profiles: Profile[]; profile: Profile; setProfile: (p: Profile) => void; docKeys: Set<string>; setDocKeys: (k: Set<string>) => void; error: string | null; refreshModel: () => void; modelTick: number }
const C = createContext<Ctx>(null as unknown as Ctx)
// 작업 요청에 실어 보낼 현재 기관 프로필(기본 프로필 포함)
export const current: { profile: Profile | null } = { profile: null }
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [procedures, setProcedures] = useState<Record<string, Proc>>({})
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profile, setP] = useState<Profile>(store.profile() || { name: '예시 공공기관', type: 'public-institution' })
  const [docKeys, setDocKeys] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [modelTick, setTick] = useState(0)
  // 처음 불러오기: 요청이 많거나(429) 연결이 잠시 끊기면 몇 초 뒤 다시 시도하고, 그동안 이유를 알린다
  useEffect(() => {
    let alive = true
    const load = (n: number) => Promise.all([api<Status>('/api/status'), api('/api/procedures'), api<Profile[]>('/api/profiles')]).then(([s, p, ps]) => { if (!alive) return; setError(null); setStatus(s); setProcedures(p); setProfiles(ps); if (!store.profile()) { const d = ps.find((x) => x.type === 'public-institution'); if (d) setP(d) } }).catch((e: any) => {
      if (!alive) return
      const busy = e?.status === 429
      setError(busy ? `요청이 많아 잠시 기다리는 중입니다${n < 4 ? '(자동으로 다시 시도합니다)' : ' — 잠시 뒤 새로 고쳐 주세요'}.` : e.message)
      if (n < 4) setTimeout(() => load(n + 1), busy ? 8000 : 3000)
    })
    load(1)
    return () => { alive = false }
  }, [])
  useEffect(() => { current.profile = profile }, [profile])
  // 기관(유형·이름)을 바꾸면 앞 기관의 진행 중 화면(개정·제정 절차, 비교·점검 결과)을 이어 쓰지 않는다 — 다른 기관 문안이 섞이지 않게
  const setProfile = (p: Profile) => {
    if (p.type !== profile.type || p.name !== profile.name) for (const k of Object.keys(sessionStorage)) if (/^rulef5\.(flow|job)\./.test(k)) sessionStorage.removeItem(k)
    store.setProfile(p); setP(p)
  }
  return <C.Provider value={{ status, procedures, profiles, profile, setProfile, docKeys, setDocKeys, error, refreshModel: () => setTick((t) => t + 1), modelTick }}>{children}</C.Provider>
}
export const useApp = () => useContext(C)
