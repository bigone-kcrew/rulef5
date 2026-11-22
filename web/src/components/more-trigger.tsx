// 접고 펴는 단추(고급 옵션·조문 직접 지정 등): 테두리와 화살표로 펼칠 수 있다는 것을 보인다
import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function MoreTrigger({ children, icon, className }: { children: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <CollapsibleTrigger render={<Button variant="outline" size="sm" className={cn('h-auto min-h-8 max-w-full justify-start whitespace-normal py-1 text-left font-normal text-muted-foreground', className)} />}>
      {icon}{children}<ChevronDownIcon data-icon="inline-end" className="transition-transform group-data-[panel-open]/button:rotate-180" />
    </CollapsibleTrigger>
  )
}
