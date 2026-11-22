// 법제처 국가법령정보 Open API 어댑터(선택, OC 필요). 법령(law)·행정규칙(admrul)·자치법규(ordin)
import { refOf, parseRegulationText } from './parse.mjs';
import { fetchJson } from './fetchjson.mjs';
const BASE = 'https://www.law.go.kr/DRF';
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const flat = (x) => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(flat) : x && typeof x === 'object' ? Object.values(x).flatMap(flat) : []);

export function lawJsonToDoc(j, target, id) {
  const law = j['법령'] || {}, info = law['기본정보'] || {};
  const articles = []; let chapter = null, seq = 0;
  for (const u of arr(law['조문']?.['조문단위'])) {
    if (u['조문여부'] === '전문') { chapter = String(u['조문내용'] || '').trim().replace(/\s*<[^>]*>\s*$/, ''); continue; }
    const no = +u['조문번호'], sub = u['조문가지번호'] ? +u['조문가지번호'] : null;
    const lines = [];
    const head = String(u['조문내용'] || '').trim(), headBody = head.replace(/^제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^)]*\))?\s*/, '');
    if (headBody) lines.push(headBody);
    for (const h of arr(u['항'])) {
      if (h['항내용']) lines.push(String(h['항내용']).trim());
      for (const ho of arr(h['호'])) { if (ho['호내용']) lines.push(String(ho['호내용']).trim()); for (const mo of arr(ho['목'])) if (mo['목내용']) lines.push(String(mo['목내용']).trim()); }
    }
    articles.push({ ref: refOf(no, sub), no, sub, title: u['조문제목'] || '', body: lines.join('\n'), section: '본칙', chapter, seq: ++seq });
  }
  return { doc_id: `law:${target}:${id}`, title: info['법령명_한글'] || '법령', inst: null, doc_type: info['법종구분']?.content || '법령', source: 'law', corpus: 'legal', edition: { state: 'current', effective_from: info['시행일자'] || null, effective_to: null, warning: null }, articles };
}

// 자치법규·행정규칙 JSON → Doc. 조문 본문 문자열만 쓴다(조문번호·조문여부 같은 내부 값은 버림).
// 붙어 있는 항(…한다.② …)·호(…같다.1. …)는 줄을 바꾸고, 「제25조의2< 삭제 …>」 같은 삭제 조문은 따로 떼어 낸다
export function govJsonToDoc(d, target, id) {
  const root = Object.values(d || {})[0] || {};
  const info = root['행정규칙기본정보'] || root['자치법규기본정보'] || {};
  const title = info['행정규칙명'] || info['자치법규명'] || '규정';
  const units = target === 'ordin' ? arr(root['조문']?.['조']).map((u) => u?.['조내용']) : arr(root['조문내용']);
  const lines = units.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.replace(/　/g, ' ').trim()
    .replace(/^(제\s*\d+\s*조(?:의\s*\d+)?)\s*(?=[<〈]?\s*삭제)/, '$1 ')
    .replace(/(\S)(?=[①-⑳])/g, '$1\n')
    .replace(/([다음함]\.|[:：])\s*(?=(?:\d{1,2}|[가-하])\.\s*\S)/g, '$1\n'));
  const doc = parseRegulationText(`${title}\n${lines.join('\n')}`, { doc_id: `law:${target}:${id}`, title });
  return { ...doc, source: 'law', corpus: target, doc_type: info['행정규칙종류'] || info['자치법규종류'] || null, inst: info['소관부처명'] || info['지자체기관명'] || null, edition: { state: 'current', effective_from: info['시행일자'] || null, effective_to: null, warning: null } };
}

const effRow = (x) => ({ name: x['법령명한글'] || '', mst: String(x['법령일련번호'] || ''), law_id: x['법령ID'] || '', eff: String(x['시행일자'] || ''), anc: String(x['공포일자'] || ''), kind: x['법령구분명'] || '', change: x['제개정구분명'] || '', dept: x['소관부처명'] || '', state: x['현행연혁코드'] || '' });
export const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
export function createLawGo({ oc = null, fetchImpl = fetch, cache = null } = {}) {
  // 저장 시간: 목록(검색·시행일 목록·연혁)은 12시간 — 그날 등록된 개정이 반나절 안에 보이게, 판본 원문(MST·일련번호로 고정)은 7일
  const LIST = 12 * 3600e3, WEEK = 7 * 24 * 3600e3;
  async function getAt(path, params, ttl = path === 'lawService.do' ? WEEK : LIST) {
    const url = `${BASE}/${path}?${new URLSearchParams({ OC: oc, type: 'JSON', ...params })}`;
    // 캐시 키에는 인증키(OC)를 넣지 않는다 — 공개 자료이므로 서버 키·사용자 키가 캐시를 함께 쓰고, 키가 메모리·디스크에 남지 않는다
    const key = `${BASE}/${path}?${new URLSearchParams({ type: 'JSON', ...params })}`;
    const hit = cache?.entry?.(key, ttl); if (hit !== undefined) return hit;
    const raw = await fetchJson(fetchImpl, url, { source: '법제처', timeoutMs: 30000 });
    // 응답의 상세링크에 인증키가 들어 있다(OC=…) — 캐시·화면으로 넘기기 전에 지운다
    const d = JSON.parse(JSON.stringify(raw).split(`OC=${encodeURIComponent(oc)}`).join('OC=').split(`OC=${oc}`).join('OC='));
    cache?.set(key, d); return { t: Date.now(), v: d };
  }
  const get = async (path, params) => (await getAt(path, params)).v;
  return {
    enabled: !!oc,
    // body: 본문 검색(search=2), page: 쪽 번호(1부터)
    async search(target, query, n = 10, { body = false, page = 1 } = {}) {
      if (!oc) return [];
      const d = await get('lawSearch.do', { target, query, display: n, ...(body ? { search: 2 } : {}), ...(page > 1 ? { page } : {}) });
      const root = d.LawSearch || d.AdmRulSearch || d.OrdinSearch || {};
      return arr(root.law || root.admrul).map((x) => target === 'law'
        ? { target, id: x['법령일련번호'], name: x['법령명한글'], kind: x['법령구분명'], date: x['시행일자'], dept: x['소관부처명'], state: x['현행연혁코드'] }
        : target === 'admrul'
          ? { target, id: x['행정규칙일련번호'], name: x['행정규칙명'], kind: x['행정규칙종류'], date: x['시행일자'], dept: x['소관부처명'], state: x['현행연혁구분'] }
          : { target, id: x['자치법규일련번호'], name: x['자치법규명'], kind: x['자치법규종류'], date: x['시행일자'], dept: x['지자체기관명'], state: '현행' });
    },
    // 시행일 기준 법령 목록(eflaw): from~to(YYYYMMDD) 사이에 시행되는(될) 법령 판본. 쪽마다 100건, 최대 pages 쪽
    async effective(from, to, { pages = 8, sort = 'efasc' } = {}) {
      if (!oc) return [];
      const out = []; let asOf = Date.now();
      for (let page = 1; page <= pages; page++) {
        const { t, v: d } = await getAt('lawSearch.do', { target: 'eflaw', efYd: `${from}~${to}`, display: 100, sort, ...(page > 1 ? { page } : {}) });
        asOf = Math.min(asOf, t);
        const xs = arr(d.LawSearch?.law); out.push(...xs.map(effRow));
        if (xs.length < 100) break;
      }
      // 조회 기준 시각(저장본이면 처음 받은 때) — 화면에 「법제처 자료 기준」으로 보인다
      return Object.assign(out, { asOf });
    },
    // 한 법령의 시행일별 판본 연혁(이름이 정확히 같은 것만, 오래된 순). 같은 판본(MST)이 시행일을 나눠 여러 번 나올 수 있다
    async timeline(name) {
      if (!oc) return [];
      const { t, v: d } = await getAt('lawSearch.do', { target: 'eflaw', query: name, display: 100, sort: 'efdes' });
      const key = String(name).replace(/[ㆍ·\s]/g, '');
      return Object.assign(arr(d.LawSearch?.law).map(effRow).filter((x) => x.name.replace(/[ㆍ·\s]/g, '') === key).reverse(), { asOf: t });
    },
    // 그 시행일에 적용되는(될) 법령 본문
    async textAt(mst, efYd) {
      if (!oc) throw Object.assign(new Error('법제처 연결이 설정되지 않았습니다.'), { status: 400, code: 'law_go_disabled' });
      const doc = lawJsonToDoc(await get('lawService.do', { target: 'eflaw', MST: mst, efYd }), 'law', mst);
      return { ...doc, edition: { ...doc.edition, effective_from: efYd, state: efYd > kstToday() ? 'scheduled' : 'current' } };
    },
    async text(target, id) {
      if (!oc) throw Object.assign(new Error('법제처 연결이 설정되지 않았습니다.'), { status: 400, code: 'law_go_disabled' });
      const d = await get('lawService.do', target === 'admrul' ? { target, ID: id } : { target, MST: id });
      if (target === 'law') return lawJsonToDoc(d, target, id);
      return govJsonToDoc(d, target, id);
    },
  };
}
