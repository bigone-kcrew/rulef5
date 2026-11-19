# 규정 새로고침(Rule F5) 아키텍처 — 정식활용(정보화사업) 이관을 위한 안내

## 1. 구성

```
[브라우저: React + shadcn/ui 빌드본(app/public)]
        │  /api/* (JSON)            x-llm-config 헤더(사용자 모델 설정, 선택)
        ▼
[app/server.js — Node.js 표준 라이브러리만 사용]
  ├─ lib/app.mjs        보안 헤더(CSP)·Origin 검사·IP별 요청 한도·정적 파일
  ├─ lib/routes.mjs     /api/status · search · doc · upload · jobs · procedures · profiles
  ├─ lib/jobs.mjs       작업 실행기(단계·사람 확인 게이트·기록, 폴링)
  ├─ flows/*            업무 흐름(개정·제정·에이전트·상위법 영향·유사 비교·점검·법령 확장)
  ├─ lib/sources.mjs    데이터 어댑터 묶음 ─┬─ alio-rest.mjs (ALIO RAG REST, 기본)
  │                                       ├─ alio-mcp.mjs  (ALIO RAG MCP, 선택)
  │                                       ├─ law-go.mjs    (법제처 Open API, 선택)
  │                                       └─ 업로드 문서(parse.mjs·unzip.mjs: hwpx/txt/md)
  ├─ lib/llm.mjs        LLM 어댑터(OpenAI 호환 하나로: EXAONE·OpenRouter·NIM·사용자 지정)
  ├─ lib/refs.mjs       인용 추출·조 번호 재배열·인용 정정(결정적)
  ├─ lib/table.mjs      신구조문대비표·개정문·문서 세트 렌더링(결정적)
  └─ lib/workspace.mjs  업로드 원본 보호(읽기 전용·해시), 산출물 분리
```

## 2. 설계 원칙

- **결정적 처리와 AI 초안을 분리**: 원문 조회, 대비표, 개정문 형식, 조 번호 이동·인용 정정, 규칙 점검은 코드가 처리합니다. 모델은 조문 문안·이유서·요약·판단 보조에만 쓰고, 모델 출력은 JSON 스키마·조문 실재·근거 ID 검증을 통과해야 결과로 쓰입니다(실패 시 1회 재시도 후 실패 표시).
- **모델 비종속**: 모든 공급자를 OpenAI 호환 chat completions 하나로 호출합니다. 모델 고유 기능(function calling 등)에 의존하지 않습니다. 대화형 에이전트도 "허용 도구 목록 중 계획을 JSON으로" 받는 방식입니다.
- <b>사람 확인(게이트)</b>: 대상 조문, 참고 근거, 조문 체계, 대상 규정 선택 등 판단이 필요한 지점에서 작업이 멈추고 담당자가 고릅니다.
- **근거 표기**: 모든 문서 세트에 근거 목록(문서 ID·조문·판본)을 붙이고, 판본 경고(구판·시행예정·폐지·근사 판정)를 표시합니다.

## 3. 확장 지점(이관 시 바꿀 곳)

| 바꿀 것 | 위치 | 방법 |
|---|---|---|
| 모델(행안부 AI 공통기반 등) | `lib/llm.mjs` `PRESETS` 또는 화면 「사용자 지정」 | OpenAI 호환 주소·모델·키만 설정. 내부망 주소를 허용하려면 `checkUrl`의 사설망 차단 규칙을 운영 정책에 맞게 조정 |
| 기관 문서관리·규정관리 시스템 연계 | `lib/sources.mjs` | `loadDoc(doc_id)`·`searchRegs(q)`와 같은 모양(`Doc = {doc_id,title,articles[{ref,no,sub,title,body,section}]}`)을 돌려주는 어댑터를 추가하고 doc_id 접두사로 연결 |
| 법령 데이터 | `lib/law-go.mjs` | 법제처 OC만 바꾸면 됨. 다른 법령 DB면 같은 인터페이스로 교체 |
| 절차 | `app/procedures/*.json` | 기관 규정관리 규정에 맞게 단계·할 일·필요 문서·근거를 편집 |
| 기관 기본값 | `app/profiles/*.json` · 화면 기관 프로필 | 심의기구·결재권자·시행일 문구·용어 사전 |
| 문서 서식 | `lib/table.mjs`·`flows/docset.mjs` | 예고문·이유서·부칙 문안 틀 |
| 인증·권한 | `lib/app.mjs` | 현재는 로그인 없는 공개(기본 인증은 배포 계층). 운영 시 기관 SSO·권한을 앞단에 둠 |
| 영구 저장·이력 | `lib/jobs.mjs` | 현재 메모리(1시간)·작업 폴더(24시간). 운영 시 DB 저장으로 교체 |

## 4. API

| 메서드·경로 | 설명 |
|---|---|
| `GET /api/status` | 데이터 연결·모델·기능 플래그 |
| `POST /api/search` | `{keyword, corpus, inst, hybrid, body, all_versions, as_of, section, limit}` 또는 `{mode:"law", keyword, targets}` |
| `GET /api/doc?id=` | 문서 전문(`bylaws:`·`legal:`·`ca:` ALIO, `law:<target>:<id>` 법제처, `upload:<work>/<n>` 업로드) |
| `POST /api/upload` | `{files:[{name, base64}|{name, text}]}` → 문서 ID·조문 수·SHA-256 |
| `POST /api/jobs` | `{type: amend|enact|agent|impact|similar|check|lawchain, input}` → `{id}` |
| `GET /api/jobs/:id` | 상태·단계·게이트·기록·결과 |
| `POST /api/jobs/:id/answer` | `{gate, value}` 사람 확인 응답 |
| `GET /api/procedures` · `GET /api/profiles` | 절차 템플릿·기본 프로필 |

## 5. 보안

CSP(`default-src 'self'`), Origin 검사, IP별 분당 요청 한도, 요청 크기 제한(JSON 64KB, 업로드 30MB·파일당 5MB·20개), 동시 작업 4개, 신뢰 프록시에서만 X-Forwarded-For 사용, 사용자 지정 모델 주소는 외부 https만 허용(사설망 차단), 서버 키 일일 사용 한도, 비밀값은 환경변수·`.private/`만(저장소 제외), 오류 응답에 공급자 원문을 싣지 않음.
