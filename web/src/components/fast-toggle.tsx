// 「추천대로 진행」: 켜면 담당자 확인 단계를 건너뛰고 추천대로 끝까지 만든다(기본 꺼짐, 이 브라우저에 기억)
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
const KEY = 'rulef5.fast'
export function useFast() {
  const [fast, setFastS] = useState(() => localStorage.getItem(KEY) === '1')
  const setFast = (v: boolean) => { localStorage.setItem(KEY, v ? '1' : '0'); setFastS(v) }
  return [fast, setFast] as const
}
export function FastToggle({ fast, setFast }: { fast: boolean; setFast: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground" title="켜면 조문·근거 확인 없이 AI 추천대로 끝까지 만듭니다. 결과의 검토 체크리스트와 대비표로 확인하세요.">
      <Checkbox checked={fast} onCheckedChange={(c) => setFast(!!c)} />추천대로 진행(확인 생략)
    </label>
  )
}
