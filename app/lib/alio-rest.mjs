// ALIO RAG 공개 REST 어댑터 (키 불필요). search · document · count_inst
import { refOf } from './parse.mjs';
import { fetchJson } from './fetchjson.mjs';

export function editionWarning(d) {
  const s = d.edition_state || d.edition_status;
  if (d.repealed || s === 'repealed') return '폐지된 자료입니다. 적용 여부를 확인하세요.';
  if (s === 'superseded') return '구판 자료입니다. 현행 판본인지 확인하세요.';
  if (s === 'scheduled') return '시행 예정 자료입니다. 현재 적용 근거로 단정하지 마세요.';
  if (s === 'lineage_closed') return '후속 판본이 확인되지 않는 자료입니다. 원문으로 확인하세요.';
  if (d.edition_basis === 'folder_year_approx') return '단체협약 판본은 폴더 연도 기반 근사 판정입니다.';
  return null;
}

// 원천 데이터가 본칙 전체를 '부칙'으로 표시한 문서를 조 번호 흐름으로 다시 나눈다.
export function normalizeSections(articles) {
  articles = articles.map((a) => { const m = !a.sub && String(a.title || '').match(/^(\d{1,2})\s*\((.+)\)\s*$/); return m ? { ...a, sub: +m[1], ref: refOf(a.no, +m[1]), title: m[2].trim() } : a; });
  if (articles.some((a) => a.section === '본칙') || !articles.some((a) => a.section === '부칙' && a.no)) return { articles, fixed: false };
  let max = 0, inAdd = false;
  const out = articles.map((a) => {
    if (a.section === '별표') return a;
    if (!a.no) return { ...a, section: inAdd ? '부칙' : '본칙' };
    if (!inAdd && max >= 3 && a.no < max && a.no <= 2) inAdd = true;
    if (!inAdd) max = Math.max(max, a.no);
    return { ...a, section: inAdd ? '부칙' : '본칙' };
  });
  // 맨 앞의 번호 없는 '부칙' 머리는 버린다
  return { articles: out.filter((a, i) => !(i === 0 && !a.no && a.title === '부칙' && !a.body)), fixed: true };
}

export function createAlioRest({ base = 'https://alio.k-union.kr/api', fetchImpl = fetch, cache = null, apiKey = null, backoffMs = 2000 } = {}) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {};
  async function get(path, params, timeoutMs = 45000) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) { if (v === undefined || v === null || v === '' || v === false) continue; qs.set(k, v === true ? '1' : String(v)); }
    const url = `${base}/${path}?${qs}`;
    const hit = cache?.get(url); if (hit !== undefined) return hit;
    const data = await fetchJson(fetchImpl, url, { source: 'ALIO', timeoutMs, init: { headers }, backoffMs });
    if (!data?.degraded) cache?.set(url, data);
    return data;
  }
  return {
    async search(params) {
      const d = await get('search', params);
      const rows = (d.rows || []).map((r) => ({ ...r, doc_id: r.doc_id || `${r.corpus}:${r.rel_path}` }));
      return { rows, degraded: d.degraded || null, has_more: !!d.has_more, next_offset: d.next_offset ?? null, count: d.count ?? rows.length };
    },
    async document(doc_id) {
      let offset = 0, meta = null; const arts = [];
      for (let guard = 0; guard < 20; guard++) {
        const d = await get('document', { doc_id, offset, max_articles: 200, max_chars: 200000 });
        meta = meta || d.document; arts.push(...(d.articles || []));
        if (d.next_offset == null || d.next_offset <= offset) break;
        offset = d.next_offset;
      }
      if (!meta) throw Object.assign(new Error('문서를 찾을 수 없습니다.'), { status: 404, code: 'not_found' });
      const mapped = normalizeSections(arts.map((a) => ({ ref: a.art_no ? refOf(a.art_no, a.art_sub) : null, no: a.art_no || null, sub: a.art_sub || null, title: a.title || '', body: a.body || '', section: a.section || '본칙', chapter: a.chapter || null, seq: a.seq })));
      const warn = [editionWarning(meta), mapped.fixed ? '원천 데이터의 본칙·부칙 구분을 조 번호 흐름으로 자동 보정했습니다.' : null].filter(Boolean).join(' ') || null;
      return {
        doc_id: meta.doc_id || doc_id, title: meta.doc_title || meta.alias || '제목 없음', inst: meta.inst_name || null, ministry: meta.ministry || null, doc_type: meta.doc_type || null, source: 'alio', corpus: meta.corpus || doc_id.split(':')[0],
        edition: { state: meta.edition_state || meta.edition_status || null, effective_from: meta.effective_from || null, effective_to: meta.effective_to || null, warning: warn },
        articles: mapped.articles,
      };
    },
    countInst: (keyword) => get('count_inst', { keyword }, 15000),
  };
}
