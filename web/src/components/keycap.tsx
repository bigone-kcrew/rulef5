// 키보드 키 모양 아이콘(F5 로고와 같은 모티프): 단계 번호·작업 카드에 쓴다
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
export function Keycap({ children, className, tone = 'plain' }: { children: ReactNode; className?: string; tone?: 'plain' | 'primary' }) {
  return (
    <span aria-hidden="true" className={cn('inline-grid h-9 min-w-9 shrink-0 place-items-center rounded-md border border-b-[3px] px-2 font-mono text-sm font-semibold [&_svg]:size-4', tone === 'primary' ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground', className)}>
      {children}
    </span>
  )
}

export function StepTitle({ n, children }: { n: number | string; children: ReactNode }) {
  return <div className="flex items-center gap-2.5 text-base font-semibold leading-snug"><Keycap className="h-7 min-w-7 font-mono text-xs">{n}</Keycap>{children}</div>
}
