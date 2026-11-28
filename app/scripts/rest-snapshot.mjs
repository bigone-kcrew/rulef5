// ALIO REST 전환 점검: rulef5 가 실제로 부르는 search·document 호출을 같은 인자로 불러 응답 모양을 저장하고, 두 저장본을 비교한다.
// 사용: node app/scripts/rest-snapshot.mjs save <파일>   |   node app/scripts/rest-snapshot.mjs diff <전> <후>
// 저장 내용: 상태(성공/오류), 응답 최상위 키, 행 수, 행 키 합집합, 앞 15개 doc_id 순서, score 타입, has_more·next_offset (본문은 저장하지 않음)
import { writeFileSync, readFileSync } from 'node:fs';
import { createAlioRest } from '../lib/alio-rest.mjs';

const base = process.env.ALIO_API_BASE || 'https://alio.k-union.kr/api';
const INST = '창업진흥원';
// rulef5 의 흐름별 호출(인자 그대로) — 이름은 화면/흐름
const SEARCHES = [
  ['F2 규정 찾기(기관+규정명)', { keyword: '복무규정', inst: INST, corpus: 'bylaws', limit: 50, hybrid: true }],
  ['F2 규정 찾기(기관만)', { keyword: '목적', inst: INST, corpus: 'bylaws', limit: 50 }],
  ['F2 근거: 유사 내규(distinct_inst)', { keyword: '배우자 출산휴가', corpus: 'bylaws', hybrid: true, distinct_inst: true, limit: 6 }],
  ['F2 근거: 법령(hybrid)', { keyword: '배우자 출산휴가', corpus: 'legal', hybrid: true, limit: 3 }],
  ['F2 근거: 지적사항(disclosure)', { keyword: '배우자 출산휴가 감사 지적', corpus: 'disclosure', hybrid: true, limit: 30, inst: INST }],
  ['F2 같은 기관 다른 규정', { keyword: '난임치료휴가', corpus: 'bylaws', inst: INST, hybrid: true, limit: 8 }],
  ['F2 단체협약(ca)', { corpus: 'ca', inst: '한국전력공사', keyword: '휴직', body: true, limit: 30 }],
  ['F6 영향: 우리 기관 본문 검색', { keyword: '난임치료휴가', corpus: 'bylaws', body: true, inst: INST, limit: 30 }],
  ['F6 판본 연혁(all_versions)', { keyword: '근로기준법', corpus: 'legal', all_versions: true, limit: 50 }],
  ['F6 판본 연혁(all_versions+body)', { keyword: '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', corpus: 'legal', all_versions: true, body: true, limit: 50 }],
  ['F7 기관 비교(같은 주무부처)', { keyword: '병가 일수', corpus: 'bylaws', hybrid: true, distinct_inst: true, ministry: '중소벤처기업부', limit: 30 }],
  ['F7 기관 비교(전체, offset)', { keyword: '병가 일수', corpus: 'bylaws', hybrid: true, distinct_inst: true, limit: 50, offset: 50 }],
  ['F8 기관 전체 규정 목록', { keyword: '목적', inst: INST, corpus: 'bylaws', limit: 50 }],
  ['F10 법령 체계: 기관 규정', { keyword: '연차 유급휴가', corpus: 'bylaws', body: true, inst: INST, limit: 40 }],
  ['키워드에 기관명(구판 도배 사례)', { keyword: '한국전력공사 휴직 규정', corpus: 'bylaws', hybrid: true, limit: 15 }],
  ['원문 검색(기본)', { keyword: '배우자 출산휴가', corpus: 'bylaws', hybrid: true, limit: 30 }],
];
const DOC = ['F2 원문 불러오기', 'bylaws:[중소벤처기업부]창업진흥원_C0451/복무규정_20260326.md'];

async function save(file) {
  // 캐시 없이(매번 실제 호출), 원본 응답 모양을 보려고 fetch 를 감싸 최상위 키를 함께 남긴다
  let lastRaw = null;
  const fetchImpl = async (url, init) => { const r = await fetch(url, init); const c = r.clone(); try { lastRaw = { status: r.status, keys: Object.keys(await c.json()) }; } catch { lastRaw = { status: r.status, keys: [] }; } return r; };
  const rest = createAlioRest({ base, fetchImpl, backoffMs: 1500 });
  const out = { at: new Date().toISOString(), base, searches: [], document: null };
  for (const [name, params] of SEARCHES) {
    const t0 = Date.now();
    try {
      const r = await rest.search(params);
      const keys = [...new Set(r.rows.flatMap((x) => Object.keys(x)))].sort();
      out.searches.push({ name, params, ok: true, ms: Date.now() - t0, http: lastRaw?.status, top_keys: (lastRaw?.keys || []).sort(), n: r.rows.length, row_keys: keys, order: r.rows.slice(0, 15).map((x) => `${x.doc_id}#${x.art_ref || ''}`), insts: [...new Set(r.rows.slice(0, 15).map((x) => x.inst_name))], score_type: [...new Set(r.rows.map((x) => typeof x.score))], has_more: r.has_more, next_offset: r.next_offset, degraded: r.degraded });
    } catch (e) { out.searches.push({ name, params, ok: false, ms: Date.now() - t0, error: e.code, detail: e.detail, status: e.status }); }
  }
  try {
    const t0 = Date.now(); const d = await rest.document(DOC[1]);
    out.document = { name: DOC[0], doc_id: DOC[1], ok: true, ms: Date.now() - t0, keys: Object.keys(d).sort(), title: d.title, inst: d.inst, edition: d.edition, n: d.articles.length, main: d.articles.filter((a) => a.section === '본칙').length, first: d.articles.slice(0, 5).map((a) => `${a.section}:${a.ref}(${a.title})`), art_keys: [...new Set(d.articles.flatMap((a) => Object.keys(a)))].sort() };
  } catch (e) { out.document = { name: DOC[0], ok: false, error: e.code, detail: e.detail, status: e.status }; }
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`저장: ${file} · 검색 ${out.searches.filter((x) => x.ok).length}/${out.searches.length} 성공 · 원문 ${out.document.ok ? '성공' : '실패'}`);
}

function diff(a, b) {
  const A = JSON.parse(readFileSync(a, 'utf8')), B = JSON.parse(readFileSync(b, 'utf8'));
  console.log(`전 ${A.at} → 후 ${B.at}`);
  for (const x of A.searches) {
    const y = B.searches.find((s) => s.name === x.name); if (!y) { console.log(`✗ ${x.name}: 후 결과 없음`); continue; }
    const lost = (x.row_keys || []).filter((k) => !(y.row_keys || []).includes(k)), added = (y.row_keys || []).filter((k) => !(x.row_keys || []).includes(k));
    const lostTop = (x.top_keys || []).filter((k) => !(y.top_keys || []).includes(k));
    const same = (x.order || []).filter((k, i) => (y.order || [])[i] === k).length, common = (x.order || []).filter((k) => (y.order || []).includes(k)).length;
    const bad = !y.ok || lost.length || lostTop.length || (x.ok && x.n > 0 && y.n === 0);
    console.log(`${bad ? '✗' : '·'} ${x.name}: ${x.ok ? x.n : 'ERR'}행 → ${y.ok ? y.n : `ERR(${y.error}/${y.detail})`}행 · 순서 같음 ${same}/${(x.order || []).length} · 겹침 ${common} · ${x.ms}ms→${y.ms}ms${lost.length ? ` · 사라진 키 ${lost.join(',')}` : ''}${lostTop.length ? ` · 사라진 최상위 키 ${lostTop.join(',')}` : ''}${added.length ? ` · 새 키 ${added.join(',')}` : ''}${JSON.stringify(x.score_type) !== JSON.stringify(y.score_type) ? ` · score ${x.score_type}→${y.score_type}` : ''}`);
  }
  const d1 = A.document, d2 = B.document;
  console.log(`${!d2?.ok || d1.n !== d2.n || d1.main !== d2.main ? '✗' : '·'} 원문: 조문 ${d1.n}(본칙 ${d1.main}) → ${d2?.ok ? `${d2.n}(본칙 ${d2.main})` : `ERR(${d2?.error})`} · 키 ${JSON.stringify(d1.art_keys) === JSON.stringify(d2?.art_keys) ? '같음' : `${d1.art_keys} → ${d2?.art_keys}`} · 제목 ${d1.title} → ${d2?.title}`);
}

const [cmd, f1, f2] = process.argv.slice(2);
if (cmd === 'save' && f1) await save(f1); else if (cmd === 'diff' && f1 && f2) diff(f1, f2); else console.log('사용: save <파일> | diff <전> <후>');
