// 기관 고르기(자동완성): 이름 일부를 치면 기관 유형에 맞는 목록에서 후보를 보여 준다.
// 공공기관 = ALIO 공시 목록(유형·주무부처), 중앙행정기관·지방자치단체 = 법제처 자료의 기관명. 목록에 없으면 입력한 이름을 그대로 쓴다.
import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { api, type Profile } from '@/lib/api'
export type Inst = { name: string; type: string; ministry: string; sub?: string; head?: string }
// lazy: 칠 때마다 반영하지 않고, 목록에서 고르거나 입력을 마칠 때(포커스 이동·Enter)만 반영한다. Esc 는 원래 값으로 되돌린다
type Props = { value: string; onPick: (i: Inst | null, text: string) => void; placeholder?: string; id?: string; type?: Profile['type']; lazy?: boolean }
export function InstPicker({ value, onPick, placeholder = '기관명을 입력하세요', id, type = 'public-institution', lazy = false }: Props) {
  const [q, setQ] = useState(value); const [items, setItems] = useState<Inst[]>([]); const [open, setOpen] = useState(false); const [at, setAt] = useState(-1)
  useEffect(() => { setQ(value) }, [value])
  useEffect(() => {
    if (!open) { setItems([]); return }
    let live = true
    const t = setTimeout(() => { api<{ items: Inst[] }>(`/api/orgs?type=${type}&q=${encodeURIComponent(q.trim())}`).then((r) => { if (live) { setItems(r.items.map((x) => ({ ...x, type: x.type || '', ministry: x.ministry || '' }))); setAt(-1) } }).catch(() => live && setItems([])) }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q, open, type])
  const choose = (x: Inst) => { setQ(x.name); setOpen(false); onPick(x, x.name) }
  // 입력을 마쳤을 때: 목록에 이름이 정확히 같은 기관이 있으면 그것을 고른 것으로 본다
  const commit = () => { if (!lazy || q === value) return; const hit = items.find((x) => x.name.replace(/\s+/g, '') === q.trim().replace(/\s+/g, '')); if (hit) choose(hit); else onPick(null, q.trim()) }
  return (
    <div className="relative">
      <Input id={id} value={q} placeholder={placeholder} maxLength={60} autoComplete="off" role="combobox" aria-expanded={open && items.length > 0} aria-autocomplete="list"
        onFocus={() => setOpen(true)} onBlur={() => { setTimeout(() => setOpen(false), 150); commit() }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); if (!lazy) onPick(null, e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) e.stopPropagation() // 목록만 닫고 바깥 창(검색·설정)은 닫지 않는다
          if (e.key === 'Escape' && lazy) { setQ(value); setOpen(false); return }
          if (e.key === 'Enter' && lazy && (at < 0 || !open)) { e.preventDefault(); commit(); return }
          if (!open || !items.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((at + 1) % items.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((at - 1 + items.length) % items.length) }
          else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); choose(items[at]) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {items.map((x, i) => <li key={x.name} role="option" aria-selected={i === at}><button type="button" tabIndex={-1} className={`flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-muted ${i === at ? 'bg-muted' : ''}`} onMouseDown={(e) => { e.preventDefault(); choose(x) }}><span className="font-medium">{x.name}</span><span className="text-xs text-muted-foreground">{x.sub || `${x.type} · ${x.ministry}`}</span></button></li>)}
        </ul>
      )}
    </div>
  )
}
