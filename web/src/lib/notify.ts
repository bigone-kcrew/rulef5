// 알림음: 사람 확인을 기다릴 때(세 음 오름)·작업이 끝났을 때(두 음 내림)·실패했을 때(낮은 두 음). 파일 없이 Web Audio 로 만든다.
// 다른 탭을 보고 있으면 탭 제목에도 표시한다. 끄고 켜기는 머리말의 종 단추(localStorage).
let ctx: AudioContext | null = null
const KEY = 'rulef5.sound'
export const soundOn = () => localStorage.getItem(KEY) !== 'off'
export const setSoundOn = (v: boolean) => localStorage.setItem(KEY, v ? 'on' : 'off')
// 브라우저는 사용자가 누른 뒤에만 소리를 허용한다 — 작업을 시작하는 클릭에서 미리 연다
export function unlockSound() { try { ctx ||= new AudioContext(); if (ctx.state === 'suspended') void ctx.resume() } catch { /* 소리 미지원 */ } }
// 부드러운 종소리: 사인파 + 옅은 옥타브 배음, 천천히 올라와 1초 남짓 잦아든다(짧게 끊기거나 날카롭지 않게)
function chime(freq: number, at: number, dur = 1.1, vol = 0.16) {
  if (!ctx) return
  const t = ctx.currentTime + at, g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  g.connect(ctx.destination)
  for (const [mul, v] of [[1, 1], [2, 0.18]] as const) { const o = ctx.createOscillator(), h = ctx.createGain(); o.type = 'sine'; o.frequency.value = freq * mul; h.gain.value = v; o.connect(h).connect(g); o.start(t); o.stop(t + dur + 0.05) }
}
let base = ''
const clearTitle = () => { if (base) { document.title = base; base = '' } }
document.addEventListener('visibilitychange', () => { if (!document.hidden) clearTitle() })
export function notify(kind: 'gate' | 'done' | 'failed') {
  if (document.hidden) { base ||= document.title; document.title = `${kind === 'gate' ? '● 확인 필요' : kind === 'done' ? '✓ 완료' : '✕ 실패'} — ${base}` }
  if (!soundOn()) return
  unlockSound()
  // 확인 필요: 도-미-솔 오름(약 1.5초) · 완료: 솔-도 내림(약 1.3초) · 실패: 낮은 두 음
  if (kind === 'gate') { chime(523, 0); chime(659, 0.22); chime(784, 0.44, 1.2) } else if (kind === 'done') { chime(784, 0); chime(523, 0.25, 1.1) } else { chime(392, 0, 1.0, 0.14); chime(311, 0.3, 1.1, 0.14) }
}
