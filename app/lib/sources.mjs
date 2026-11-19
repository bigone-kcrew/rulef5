// 데이터 연결 묶음: ALIO REST(기본) + ALIO MCP(선택) + 법제처(선택) + 업로드 자료
import { createAlioRest } from './alio-rest.mjs';
import { createAlioMcp } from './alio-mcp.mjs';
import { createLawGo } from './law-go.mjs';
import { createCache } from './cache.mjs';

export function createSources(env = process.env, fetchImpl = fetch, { cacheDir = null } = {}) {
  const cache = createCache({ dir: cacheDir, ttlMs: 24 * 3600 * 1000, max: 800 });
  const rest = createAlioRest({ base: env.ALIO_API_BASE || 'https://alio.k-union.kr/api', fetchImpl, cache, apiKey: env.ALIO_API_KEY || null });
  const mcp = createAlioMcp({ url: env.ALIO_MCP_URL || null, key: env.ALIO_MCP_KEY || null, fetchImpl });
  const uploads = new Map();
  // 법제처 연결은 인증키(OC)마다 따로 만든다: 기본은 서버 키(LAW_API_OC), 사용자가 넣은 키는 withLawOc 로 그 요청에만
  const build = (oc, lawSource) => {
  const lawGo = createLawGo({ oc: oc || null, fetchImpl, cache });
  const notFound = () => Object.assign(new Error('문서를 찾을 수 없습니다.'), { status: 404, code: 'not_found' });

  async function loadDoc(doc_id) {
    if (typeof doc_id !== 'string' || !doc_id || doc_id.length > 1500 || /[\r\n\0]/.test(doc_id)) throw Object.assign(new Error('문서 ID가 올바르지 않습니다.'), { status: 400 });
    if (doc_id.startsWith('upload:')) { const d = uploads.get(doc_id); if (!d) throw notFound(); return d; }
    if (doc_id.startsWith('law:')) { const [, target, id] = doc_id.split(':'); if (!['law', 'admrul', 'ordin'].includes(target) || !/^\d+$/.test(id || '')) throw notFound(); return lawGo.text(target, id); }
    if (!/^(bylaws|legal|ca|disclosure):/.test(doc_id)) throw notFound();
    return rest.document(doc_id);
  }

  // 법령 찾기: ALIO legal 코퍼스(문서 단위) + 법제처(법령·행정규칙·자치법규)
  async function searchLaw(query, { targets = ['law'], limit = 8 } = {}) {
    const out = [], errors = [];
    try {
      const r = await rest.search({ keyword: query, corpus: 'legal', limit: 20 });
      const seen = new Set();
      for (const row of r.rows) { if (seen.has(row.doc_id)) continue; seen.add(row.doc_id); out.push({ doc_id: row.doc_id, title: row.doc_title, kind: row.doc_type, source: 'ALIO', date: row.effective_from, ref: row.art_ref, excerpt: (row.body || '').slice(0, 160) }); }
    } catch (e) { errors.push('ALIO'); }
    if (lawGo.enabled) for (const t of targets) {
      try { for (const x of await lawGo.search(t, query, limit)) out.push({ doc_id: `law:${t}:${x.id}`, title: x.name, kind: x.kind, source: '법제처', date: x.date, dept: x.dept }); } catch { errors.push('법제처'); }
    }
    return { rows: out.slice(0, limit * (1 + targets.length)), errors };
  }

  // 중앙행정기관 행정규칙(admrul)·지방자치단체 자치법규(ordin) — 법제처. 결과는 ALIO 검색 행과 같은 모양으로 맞춘다
  const govRow = (target) => (x) => ({ doc_id: `law:${target}:${x.id}`, inst_name: x.dept || '', doc_title: x.name, doc_type: x.kind || null, effective_from: x.date || null, corpus: target });
  const gov = {
    enabled: lawGo.enabled,
    // 본문에 주제어가 있는 규정(여러 쪽), 기관 이름으로 거른다(org 가 있으면 정확히 같은 기관만)
    async search({ target, keyword, body = true, pages = 3, org = null }) {
      const out = [], seen = new Set();
      for (let p = 1; p <= pages; p++) { const rows = await lawGo.search(target, keyword, 100, { body, page: p }); for (const x of rows) if (!seen.has(x.id) && (!org || x.dept === org)) { seen.add(x.id); out.push(govRow(target)(x)); } if (rows.length < 100) break; }
      return out;
    },
    // 한 기관의 규정 목록: 제명에 기관 이름이 들어간 규정을 찾아 기관명이 정확히 같은 것만(지자체 「수원시 …조례」, 부처 「고용노동부 …규정」)
    async orgDocs({ target, org, pages = 3, extra = '' }) {
      const short = target === 'ordin' ? String(org).trim().split(/\s+/).pop() : String(org).trim();
      // 교육청 규정 제명은 「경기도교육감 소속 …」「경기도교육청 …」으로 시작한다. 그래도 없으면 제명 낱말만으로 찾고 기관명으로 거른다
      const heads = [...new Set([short, short.replace(/교육청$/, '교육감'), short.replace(/교육청$/, '교육')])];
      for (const h of heads) { const rows = await gov.search({ target, keyword: `${h} ${extra}`.trim(), body: false, pages, org }); if (rows.length) return rows; }
      return extra ? gov.search({ target, keyword: extra, body: false, pages, org }) : [];
    },
  };

  return {
    rest, mcp, lawGo, loadDoc, searchLaw, gov,
    status: () => ({ alio_rest: true, alio_mcp: mcp.enabled, law_go: lawGo.enabled, law_source: lawGo.enabled ? lawSource : null }),
    searchRegs: (q) => rest.search(q),
    countInst: (k) => rest.countInst(k),
    related: (args) => (mcp.enabled ? mcp.related(args) : Promise.resolve(null)),
    registerUpload(doc) { uploads.set(doc.doc_id, doc); if (uploads.size > 2000) uploads.delete(uploads.keys().next().value); return doc; },
    dropUploads(prefix) { for (const k of [...uploads.keys()]) if (k.startsWith(prefix)) uploads.delete(k); },
    withLawOc: (userOc) => (userOc ? userView(userOc) : base),
  };
  };
  // 사용자 키별 연결은 잠깐만 보관(메모리, 최대 50개). 키는 기록하지 않는다
  const views = new Map();
  const userView = (userOc) => { let v = views.get(userOc); if (!v) { v = build(userOc, 'user'); views.set(userOc, v); if (views.size > 50) views.delete(views.keys().next().value); } return v; };
  const base = build(env.LAW_API_OC || null, 'server');
  return base;
}
