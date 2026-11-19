// 기관 프로필(기관별 설정): 유형에 따라 절차·예고문·부칙 문구가 바뀐다
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useApp } from '@/lib/app-state'
import { download } from '@/lib/export'
import { applyOrg, ORG_HINT, type Profile } from '@/lib/api'
import { InstPicker } from '@/components/inst-picker'
import { Badge } from '@/components/ui/badge'

export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { profile, setProfile, profiles, procedures } = useApp()
  const [p, setP] = useState<Profile>(profile)
  useEffect(() => { if (open) setP(profile) }, [open, profile])
  // 유형을 바꾸면 그 유형의 기본값으로 되돌리고 기관명은 다시 고르게 한다
  const setType = (type: Profile['type']) => { if (type === p.type) return; const d = profiles.find((x) => x.type === type); setP({ ...(d || { type }), id: 'custom', name: '', type, alio_inst: '', inst_type: undefined, ministry: undefined } as Profile) }
  const f = (k: keyof Profile) => ({ value: (p[k] as string) || '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value }) })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>기관 설정</DialogTitle>
          <DialogDescription>기관 유형에 맞춰 절차 안내·예고문·부칙 문구가 바뀝니다. 이 브라우저에만 저장됩니다.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>기관 유형</FieldLabel>
            <ToggleGroup value={[p.type]} onValueChange={(v: string[]) => v[0] && setType(v[0] as Profile['type'])} variant="outline">
              <ToggleGroupItem value="public-institution">공공기관</ToggleGroupItem>
              <ToggleGroupItem value="central-ministry">중앙행정기관</ToggleGroupItem>
              <ToggleGroupItem value="local-gov">지방자치단체</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{procedures[p.type]?.name}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="pf-name">기관명</FieldLabel>
            <InstPicker id="pf-name" type={p.type} value={/^예시 /.test(p.name) ? '' : p.name} placeholder={ORG_HINT[p.type][0]} onPick={(x, text) => setP(applyOrg(p, x, text))} />
            {p.type === 'public-institution' && p.inst_type && <div className="flex flex-wrap gap-1.5"><Badge variant="secondary">{p.inst_type}</Badge><Badge variant="outline">주무부처 {p.ministry}</Badge></div>}
            <FieldDescription>{ORG_HINT[p.type][1]} 목록에 없으면 입력한 이름을 그대로 씁니다.</FieldDescription>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="pf-c">규정 심의 기구</FieldLabel><Input id="pf-c" maxLength={40} {...f('council')} /></Field>
            <Field><FieldLabel htmlFor="pf-a">결재·공포권자</FieldLabel><Input id="pf-a" maxLength={40} {...f('approver')} /></Field>
          </div>
          <Field><FieldLabel htmlFor="pf-e">시행일 기본 문구</FieldLabel><Input id="pf-e" maxLength={120} {...f('effective_default')} /></Field>
        </FieldGroup>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => download('기관프로필.json', JSON.stringify(p, null, 2), 'application/json')}>내보내기</Button>
            <Button variant="ghost" size="sm" render={<label />}>가져오기<input type="file" accept="application/json" hidden onChange={async (e) => { try { const x = JSON.parse(await e.target.files![0].text()); if (!x.name || !procedures[x.type]) throw 0; setP(x) } catch { alert('프로필 JSON 형식이 올바르지 않습니다.') } }} /></Button>
          </div>
          <Button onClick={() => { const name = p.name?.trim() || profiles.find((x) => x.type === p.type)?.name || '예시 기관'; setProfile({ ...p, name, id: 'custom' }); onOpenChange(false) }}>저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
