// 작업 시작·폴링·사람 확인 응답. 탭을 새로 고쳐도 진행 중이던 작업을 이어받고, 폴링 실패는 몇 번 다시 시도한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, store, type Job } from '@/lib/api'
import { current } from '@/lib/app-state'
import { notify, unlockSound } from '@/lib/notify'
type Last = { type: string; input: Record<string, unknown> }
export function useJob(resumeKey?: string) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const alive = useRef(0)
  const last = useRef<Last | null>(null)
  const key = resumeKey ? `rulef5.job.${resumeKey}` : null
  // resumed: 이전에 저장해 둔 작업을 다시 붙는 경우(서버에 없으면 조용히 비운다)
  const poll = useCallback(async (id: string, run: number, resumed = false) => {
    // 알림음: 이 화면에서 진행을 지켜보던 작업이 확인을 기다리거나 끝날 때만(이미 끝난 작업을 다시 붙을 때는 울리지 않음)
    let fails = 0, seenLive = false, lastGate = ''
    while (alive.current === run) {
      try {
        const j = await api<Job>('/api/jobs/' + id); fails = 0
        if (alive.current !== run) return
        setJob(j)
        if (j.status === 'waiting' && j.gate?.id && j.gate.id !== lastGate) { lastGate = j.gate.id; notify('gate') }
        if (j.status === 'running' || j.status === 'waiting') seenLive = true
        else if (seenLive) notify(j.status === 'done' ? 'done' : 'failed')
        if (j.status === 'done' || j.status === 'failed') return // 결과는 다른 화면에 다녀와도 다시 볼 수 있게 저장해 둔다(서버 보관 1시간)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) { if (key) sessionStorage.removeItem(key); if (resumed) { setStartedAt(null); return } setError('작업을 찾을 수 없습니다. 서버가 다시 시작되었을 수 있습니다. 「다시 시도」를 눌러 주세요.'); return }
        if (++fails >= 6) { setError(`진행 상태를 불러오지 못했습니다(${(e as Error).message}). 네트워크를 확인한 뒤 「다시 시도」를 눌러 주세요.`); return }
      }
      await new Promise((r) => setTimeout(r, fails ? 2500 : 1200))
    }
  }, [key])
  const start = useCallback(async (type: string, input: Record<string, unknown>) => {
    const run = ++alive.current
    unlockSound()
    last.current = { type, input }
    setError(null); setJob(null); setStartedAt(Date.now())
    let id: string
    try { id = (await api<{ id: string }>('/api/jobs', { method: 'POST', body: { type, input: { ...input, profile: store.profile() || current.profile || undefined } } })).id } catch (e) { setError((e as Error).message); return }
    if (key) sessionStorage.setItem(key, JSON.stringify({ id, t: Date.now(), type, input }))
    poll(id, run)
  }, [key, poll])
  const answer = useCallback(async (gate: string, value: unknown) => { if (!job) return; await api(`/api/jobs/${job.id}/answer`, { method: 'POST', body: { gate, value } }) }, [job])
  const reset = useCallback(() => { alive.current++; if (key) sessionStorage.removeItem(key); setJob(null); setError(null); setStartedAt(null) }, [key])
  const retry = useCallback(() => { if (last.current) start(last.current.type, last.current.input) }, [start])
  // 이어받기: 같은 탭에서 진행 중이던 작업이 있으면 다시 붙는다
  useEffect(() => {
    if (key) { try { const s = JSON.parse(sessionStorage.getItem(key) || 'null'); if (s?.id && Date.now() - s.t < 3600e3) { last.current = { type: s.type, input: s.input }; const run = ++alive.current; setStartedAt(s.t); poll(s.id, run, true) } } catch { /* 무시 */ } }
    return () => { alive.current++ }
  }, [key, poll])
  const busy = !!startedAt && !error && (!job || job.status === 'running' || job.status === 'waiting')
  // 진행 중 페이지를 떠나려 하면 확인
  useEffect(() => { if (!busy) return; const h = (e: BeforeUnloadEvent) => { e.preventDefault() }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h) }, [busy])
  return { job, error, start, answer, reset, retry, canRetry: !!last.current, startedAt, busy }
}
