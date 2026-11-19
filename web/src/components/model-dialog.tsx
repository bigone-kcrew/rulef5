// 모델 설정: 모든 모델을 OpenAI 호환 방식으로 교체(모델 비종속)
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useApp } from '@/lib/app-state'
import { store, type ModelCfg } from '@/lib/api'

export function ModelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { status, refreshModel } = useApp()
  const [m, setM] = useState<ModelCfg>({})
  const [oc, setOc] = useState('')
  useEffect(() => { if (open) { setM(store.model() || {}); setOc(store.lawOc()) } }, [open])
  const ocOk = !oc || /^[A-Za-z0-9._@-]{2,60}$/.test(oc.trim())
  const serverLaw = status?.data?.law_source === 'server' || (!!status?.data?.law_go && !store.lawOc())
  const preset = m.preset || 'server'
  const presets = status?.presets || {}
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>모델 · 법제처 연결 설정</DialogTitle>
          <DialogDescription>EXAONE·GPT-OSS·Gemma 등 OpenAI 호환 API라면 무엇이든 연결됩니다. 입력한 키는 이 탭(sessionStorage)에만 보관하고 요청할 때만 서버로 보내며, 서버는 저장하지 않습니다.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>공급자</FieldLabel>
            <ToggleGroup value={[preset]} onValueChange={(v: string[]) => v[0] && setM({ ...m, preset: v[0] === 'server' ? undefined : v[0], model: undefined })} variant="outline" className="flex-wrap">
              <ToggleGroupItem value="server">서버 기본</ToggleGroupItem>
              {Object.entries(presets).map(([k, v]) => <ToggleGroupItem key={k} value={k}>{k === 'exaone' ? 'EXAONE' : k === 'openrouter' ? 'OpenRouter' : k === 'nim' ? 'NVIDIA NIM' : '사용자 지정'}{v.server_key ? ' ●' : ''}</ToggleGroupItem>)}
            </ToggleGroup>
            <FieldDescription>{preset === 'server' ? `서버에 설정된 모델: ${status?.llm?.model || '없음'}` : presets[preset]?.label}{presets[preset]?.server_key ? ' · ● 서버 키 사용 가능' : ''}</FieldDescription>
          </Field>
          {(preset === 'openrouter' || preset === 'nim') && (
            <Field>
              <FieldLabel>모델</FieldLabel>
              <ToggleGroup value={[m.model || (status as any)?.models?.[preset]?.[0] || '']} onValueChange={(v: string[]) => v[0] && setM({ ...m, model: v[0] })} variant="outline" className="flex-wrap">
                {((status as any)?.models?.[preset] || []).map((x: string) => <ToggleGroupItem key={x} value={x}>{x}</ToggleGroupItem>)}
              </ToggleGroup>
              <FieldDescription>본인 키를 넣으면 다른 모델 이름도 쓸 수 있습니다.</FieldDescription>
              {m.apiKey && <Input placeholder="다른 모델 이름(선택)" value={m.model || ''} onChange={(e) => setM({ ...m, model: e.target.value })} />}
            </Field>
          )}
          {preset === 'custom' && (
            <>
              <Field><FieldLabel htmlFor="md-url">API 주소(https, OpenAI 호환)</FieldLabel><Input id="md-url" placeholder="https://…/v1" value={m.baseUrl || ''} onChange={(e) => setM({ ...m, baseUrl: e.target.value })} /><FieldDescription>행안부 AI 공통기반·자체 vLLM 등</FieldDescription></Field>
              <Field><FieldLabel htmlFor="md-model">모델 이름</FieldLabel><Input id="md-model" value={m.model || ''} onChange={(e) => setM({ ...m, model: e.target.value })} /></Field>
            </>
          )}
          {preset !== 'server' && <Field><FieldLabel htmlFor="md-key">API 키 {presets[preset]?.server_key && <span className="text-muted-foreground">(비우면 서버 키)</span>}</FieldLabel><Input id="md-key" type="password" autoComplete="off" value={m.apiKey || ''} onChange={(e) => setM({ ...m, apiKey: e.target.value || undefined })} /></Field>}
        </FieldGroup>
        <FieldGroup className="border-t pt-4">
          <Field>
            <FieldLabel htmlFor="md-oc">법제처 Open API 인증키(OC) <span className="font-normal text-muted-foreground">(선택)</span></FieldLabel>
            <Input id="md-oc" type="password" autoComplete="off" placeholder={serverLaw ? '비우면 서버 연결 사용' : '서버 연결 없음 — 넣어야 부처·지자체 기능 사용'} value={oc} onChange={(e) => setOc(e.target.value.trim())} aria-invalid={!ocOk} />
            <FieldDescription>
              {serverLaw ? '● 지금은 공개 서버의 법제처 연결을 씁니다.' : '○ 서버에 법제처 연결이 없습니다.'} 본인 인증키를 넣으면 행정규칙·자치법규·법령 조회를 그 키로 합니다(국가법령정보 공동활용 open.law.go.kr에서 신청, 보통 가입 이메일의 아이디). 키는 이 탭에만 보관합니다.
              {!ocOk && <span className="block text-destructive">영문·숫자·.-_@ 2~60자만 넣을 수 있습니다.</span>}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { store.setModel(null); store.setLawOc(''); refreshModel(); onOpenChange(false) }}>초기화</Button>
          <Button disabled={!ocOk} onClick={() => { store.setModel(m.preset ? m : null); store.setLawOc(oc.trim()); refreshModel(); onOpenChange(false) }}>적용</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
