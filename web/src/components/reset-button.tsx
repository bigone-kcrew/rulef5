// 「처음부터」: 도구 화면의 입력·결과·진행 중 작업 기록을 지우고 빈 화면으로 되돌린다(화면을 다시 그려 상태를 비운다)
import { useState, type ComponentType } from 'react'
import { RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ResetButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return <Button variant="ghost" size="sm" className={`text-muted-foreground ${className}`} onClick={onClick} title="입력과 결과를 지우고 처음부터"><RotateCcwIcon data-icon="inline-start" />처음부터</Button>
}

// 화면 전체를 다시 그리는 껍데기: 안쪽 화면은 onReset 을 받아, 자기 작업 기록(job.reset)을 지운 뒤 부른다
export function withReset<P extends object>(Inner: ComponentType<P & { onReset: () => void }>) {
  return function Resettable(props: P & { preset?: unknown }) {
    const [k, setK] = useState(0)
    // 처음부터 하면 다른 화면에서 넘겨받은 값(preset)도 버린다
    return <Inner key={k} {...props} {...(k ? { preset: null } : {})} onReset={() => { setK((x) => x + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
  }
}
