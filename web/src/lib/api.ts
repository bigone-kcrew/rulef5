// 서버 API·브라우저 저장소(기관 프로필 localStorage, 모델 설정 sessionStorage)
export type Profile = { id?: string; name: string; type: 'public-institution' | 'central-ministry' | 'local-gov'; alio_inst?: string; inst_type?: string; ministry?: string; council?: string; approver?: string; effective_default?: string; reg_kinds?: string[]; terms?: Record<string, string[]> }
export type ModelCfg = { preset?: string; model?: string; baseUrl?: string; apiKey?: string }
export type Article = { ref: string | null; no: number | null; sub: number | null; title: string; body: string; section: string; chapter?: string | null }
export type Doc = { doc_id: string; title: string; inst?: string | null; source: string; edition?: { state?: string | null; effective_from?: string | null; warning?: string | null }; articles: Article[] }
export type Step = { name: string; state: 'running' | 'done' | 'failed' | 'skipped'; note: string | null; ms?: number | null; evidence: { label?: string; doc_id?: string; ref?: string; edition?: string }[] }
export type GateOpt = { value: string; label: string; detail?: string; checked?: boolean; doc_id?: string | null; ref?: string | null }
export type Gate = { id: string; prompt: string; options: GateOpt[] | null; multi: boolean; data?: unknown }
export type Job = { id: string; type: string; status: 'running' | 'waiting' | 'done' | 'failed'; steps: Step[]; logs: { t: number; text: string }[]; gate: Gate | null; result: any; error: { code: string; message: string } | null; plan?: any; created?: number; updated?: number }
export type Status = { data: { alio_rest: boolean; alio_mcp: boolean; law_go: boolean; law_source?: 'server' | 'user' | null }; llm: { preset: string; model: string } | null; presets: Record<string, { label: string; model: string; server_key: boolean }>; openrouter_models: string[]; features: Record<string, boolean> }

// 기관명 입력 결과를 프로필에 반영한다. 목록에서 고르면 공공기관은 ALIO 기관명·유형·주무부처, 부처·지자체는 결재·공포권자 직함이 채워진다
export function applyOrg(p: Profile, picked: { name: string; type?: string; ministry?: string; head?: string } | null, text: string): Profile {
  const base = { ...p, id: 'custom', name: text }
  if (p.type === 'public-institution') return picked ? { ...base, alio_inst: picked.name, inst_type: picked.type, ministry: picked.ministry } : { ...base, alio_inst: '', inst_type: undefined, ministry: undefined }
  return picked?.head ? { ...base, alio_inst: '', inst_type: undefined, ministry: undefined, approver: picked.head } : { ...base, alio_inst: '', inst_type: undefined, ministry: undefined }
}
export const ORG_HINT: Record<Profile['type'], [string, string]> = {
  'public-institution': ['예: 소상공인시장진흥공단', 'ALIO 공시 공공기관 목록에서 고릅니다. 고르면 기관 유형·주무부처가 채워지고 기관 비교(F7)·규정 찾기의 「우리 기관」으로 쓰입니다.'],
  'central-ministry': ['예: 고용노동부, 국토지리정보원', '부·처·청·위원회와 소속기관 이름을 법제처 행정규칙 자료에서 찾습니다. 고르면 결재권자 직함이 채워집니다.'],
  'local-gov': ['예: 수원, 중구, 경기도교육청', '시·도와 시·군·구, 교육청 이름을 법제처 자치법규 자료에서 찾습니다(시·군·구 이름만 쳐도 됩니다). 고르면 공포권자 직함이 채워집니다.'],
}

const ls = { get<T>(k: string, d: T): T { try { return (JSON.parse(localStorage.getItem(k) || 'null') as T) ?? d } catch { return d } }, set(k: string, v: unknown) { localStorage.setItem(k, JSON.stringify(v)) } }
export const store = {
  profile: (): Profile | null => ls.get<Profile | null>('regitda.profile', null),
  setProfile: (p: Profile) => ls.set('regitda.profile', p),
  model: (): ModelCfg | null => { try { return JSON.parse(sessionStorage.getItem('regitda.model') || 'null') } catch { return null } },
  // 법제처 Open API 인증키(OC): 이 탭에만 보관, 요청 헤더로만 보낸다. 없으면 서버 연결을 쓴다
  lawOc: (): string => sessionStorage.getItem('regitda.lawoc') || '',
  setLawOc: (v: string) => (v ? sessionStorage.setItem('regitda.lawoc', v) : sessionStorage.removeItem('regitda.lawoc')),
  setModel: (m: ModelCfg | null) => (m ? sessionStorage.setItem('regitda.model', JSON.stringify(m)) : sessionStorage.removeItem('regitda.model')),
  procDone: (type: string): string[] => ls.get<string[]>(`regitda.proc.${type}`, []),
  setProcDone: (type: string, v: string[]) => ls.set(`regitda.proc.${type}`, v),
}

export class ApiError extends Error { status: number; code?: string; constructor(m: string, s: number, c?: string) { super(m); this.status = s; this.code = c } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const m = store.model()
  if (m && (m.apiKey || m.preset)) headers['x-llm-config'] = JSON.stringify(m)
  const oc = store.lawOc(); if (oc) headers['x-law-oc'] = oc
  const r = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ApiError(j.error || `요청 실패(${r.status})`, r.status, j.code)
  return j as T
}
export async function fileToB64(file: File) { const buf = new Uint8Array(await file.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s) }
export const TYPE_LABEL: Record<string, string> = { 'public-institution': '공공기관', 'central-ministry': '중앙행정기관', 'local-gov': '지방자치단체' }
export const DOC_LABELS: Record<string, string> = { draft: '제·개정안', comparison: '신구조문대비표', reason: '이유서', addenda: '부칙', notice: '예고문', corrections: '인용 정정', checklist: '체크리스트', evidence: '근거 목록', consult_letter: '협조 공문', labor_opinion: '근로자 의견 청취서', legal_review: '법무 검토 의뢰서', council_agenda: '심의 안건', board_agenda: '이사회 부의안', assembly_bill: '의회 제출안', promulgation: '공포·발령문' }
export const EDITION: Record<string, string> = { current: '현행', superseded: '구판', scheduled: '시행예정', repealed: '폐지', unknown: '올린 자료' }
