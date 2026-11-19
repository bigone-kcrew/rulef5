// 흐름 공통: 근거 조사, 근거 표기, 오류
import { keywords, clip, scoreArticle, lawNames } from '../lib/text.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STANDARDS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'standards.json'), 'utf8')).items;
// 주제와 키워드가 겹치는 상위 기준(정부 지침·표준안)
// 기관 유형에 맞는 상위 기준만(공공기관에 지방공무원 복무규정을 붙이지 않는다)
export const matchStandards = (query, orgType = null) => STANDARDS.filter((s) => !orgType || !s.org_types || s.org_types.includes(orgType)).map((s) => [s, s.keywords.filter((k) => String(query).includes(k)).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([s]) => s);
// 지적사항 라벨: 경로의 감사명 폴더와 공시 연도
export function auditLabel(r) {
  const parts = String(r.rel_path || '').split('/');
  const i = parts.findIndex((p) => /지적사항/.test(p) && /^B\d+/.test(p));
  const year = i >= 0 ? parts[i + 1] : '', name = i >= 0 && parts.length > i + 3 ? parts[i + 2] : (r.doc_title || '지적사항');
  return `${r.inst_name || ''} · ${name}${year ? ` (${year} 공시)` : ''}`;
}
export const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
// 같은 기관·같은 제명(괄호 속 개정 표기 제거)·같은 조문의 여러 판본 파일 중 가장 최근 것만 남긴다
const baseTitle = (t) => String(t || '').replace(/\([^)]*(개정|제정|\d{4})[^)]*\)/g, '').replace(/[_\s]+\d{8}$/, '').replace(/\s+/g, '');
const rowDate = (r) => String(r.doc_date || r.effective_from || (String(r.rel_path || '').match(/(\d{8})(?!.*\d{8})/) || [])[1] || '');
export function dedupeEditions(rows, { byArticle = true } = {}) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.inst_name || ''}|${baseTitle(r.doc_title)}|${byArticle ? r.art_ref || '' : ''}`;
    const cur = best.get(k); if (!cur || rowDate(r) > rowDate(cur)) best.set(k, r);
  }
  const keep = new Set([...best.values()]);
  return rows.filter((r) => keep.has(r));
}
export const editionLabel = (r) => {
  const s = r.edition_state || r.edition?.state;
  return { current: '현행', superseded: '구판', scheduled: '시행예정', repealed: '폐지', lineage_closed: '후속판 미확인', unknown: '올린 자료' }[s] || (s ? s : '판본 미상');
};

// 유사 규정(ALIO 내규)·관련 법령(ALIO 법령 조문 + 법제처) 조사. 실패한 출처는 errors 로 보고한다.
export async function gatherEvidence(deps, { query, excludeDocId = null, regLimit = 4, lawLimit = 3, lawTargets = ['law'], useLawGo = true, audits = true, standards = true, inst = undefined, excludeSame = null, orgType = null, govSimilar = null }) {
  const { sources } = deps, ev = [], errors = [];
  const kws = keywords(query).slice(0, 4).join(' ') || query;
  // 서로 관계없는 조회 다섯 가지(유사 내규·ALIO 법령·법제처 법령·상위 기준·지적사항)를 동시에 실행하고, 결과 순서는 그대로 합친다
  const parts = await Promise.all([
    async () => { const out = [];
  // 지자체·부처 규정이면 유사 규정도 다른 지자체·부처의 자치법규·행정규칙(법제처)에서 찾는다(공공기관 내규를 섞지 않음)
  if (govSimilar) {
    try {
      const kw = keywords(query), seen = new Set();
      const rows = (await govArticles(sources, govSimilar.target, kws, { maxDocs: 8 })).filter((x) => x.inst_name !== govSimilar.org).map((x) => [scoreArticle({ title: x.art_title, body: x.body }, kw), x]).filter(([sc]) => sc > 0).sort((p, q) => q[0] - p[0]);
      for (const [, x] of rows) { if (seen.has(x.inst_name) || out.length >= regLimit) continue; seen.add(x.inst_name); out.push({ kind: '유사 규정', label: `${x.inst_name} ${x.doc_title} ${x.art_ref}`, doc_id: x.doc_id, ref: x.art_ref, inst: x.inst_name, text: clip(x.body, 500), edition: '현행(법제처)' }); }
    } catch { errors.push('법제처 유사 규정'); }
    return out;
  }
  try {
    const r = await sources.searchRegs({ keyword: kws, corpus: 'bylaws', hybrid: true, distinct_inst: true, limit: regLimit + 2 });
    if (r.degraded) errors.push('ALIO 내규 검색 일부');
    for (const x of r.rows.filter((x) => x.doc_id !== excludeDocId && !(excludeSame && x.inst_name === excludeSame.inst && baseTitle(x.doc_title) === baseTitle(excludeSame.title))).slice(0, regLimit)) out.push({ kind: '유사 규정', label: `${x.inst_name || ''} ${x.doc_title} ${x.art_ref || ''}`.trim(), doc_id: x.doc_id, ref: x.art_ref, inst: x.inst_name, text: clip(x.body, 500), edition: editionLabel(x) });
  } catch { errors.push('ALIO 내규'); }
      return out; },
    async () => { const out = [];
  try {
    const r = await sources.rest.search({ keyword: kws, corpus: 'legal', hybrid: true, limit: lawLimit });
    if (r.degraded) errors.push('ALIO 법령 검색 일부');
    // 본문이 쪽 번호·빈칸뿐인 조각(예: 「236」)은 근거로 쓰지 않는다
    for (const x of r.rows.filter((y) => (String(y.body || '').match(/[가-힣]/g) || []).length >= 10).slice(0, lawLimit)) out.push({ kind: '관련 법령', label: `${x.doc_title} ${x.art_ref || ''}`.trim(), doc_id: x.doc_id, ref: x.art_ref, text: clip(x.body, 500), edition: editionLabel(x) });
  } catch { errors.push('ALIO 법령'); }
      return out; },
    async () => { const out = [];
  if (useLawGo && sources.lawGo?.enabled) {
    try {
      const names = lawNames(query); const r = await sources.searchLaw(names[0] || keywords(query).slice(0, 2).join(' '), { targets: names.length ? ['law'] : lawTargets, limit: 2 });
      const hit = r.rows.find((y) => y.source === '법제처');
      if (hit) {
        // 법령 본문을 받아 질의와 가장 관련 있는 조문 2개를 근거로 쓴다
        const doc = await sources.loadDoc(hit.doc_id), kw = keywords(query);
        const kind = hit.doc_id.startsWith('law:law:') ? '법령(법제처)' : hit.doc_id.startsWith('law:ordin:') ? '자치법규(법제처)' : '행정규칙(법제처)';
        const top = doc.articles.filter((a) => a.ref).map((a) => [scoreArticle(a, kw), a]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 2);
        for (const [, a] of top) out.push({ kind, label: `${doc.title} ${a.ref}(${a.title})`, doc_id: doc.doc_id, ref: a.ref, text: clip(a.body, 600), edition: `현행 · 시행 ${doc.edition.effective_from || '미상'}` });
      }
    } catch { errors.push('법제처'); }
  }
      return out; },
    async () => { const out = [];
  if (standards) {
    // 상위 기준: 등록 목록 매칭 → ALIO 법령 코퍼스(고용부지침 등) 또는 법제처에서 원문 조회
    for (const s of matchStandards(query, orgType).slice(0, 2)) {
      try {
        const kw = keywords(query).slice(0, 2).join(' ');
        if (s.target === 'alio-legal') {
          const r = await sources.rest.search({ keyword: kw, corpus: 'legal', hybrid: true, limit: 10 });
          const hit = r.rows.find((x) => /고용부지침|매뉴얼|가이드/.test(`${x.rel_path} ${x.doc_title}`));
          if (hit) out.push({ kind: '상위 기준', label: `${hit.doc_title} ${hit.art_ref || ''}`.trim(), doc_id: hit.doc_id, ref: hit.art_ref, text: clip(hit.body, 500), edition: editionLabel(hit) });
        } else if (sources.lawGo?.enabled) {
          const r = await sources.searchLaw(s.name, { targets: [s.target === 'admrul' ? 'admrul' : 'law'], limit: 2 });
          const hit = r.rows.find((x) => x.source === '법제처');
          if (hit) {
            const doc = await sources.loadDoc(hit.doc_id), kwl = keywords(query);
            const top = doc.articles.filter((a) => a.ref).map((a) => [scoreArticle(a, kwl), a]).filter(([sc]) => sc > 0).sort((a, b) => b[0] - a[0]).slice(0, 1);
            for (const [, a] of top) out.push({ kind: '상위 기준', label: `${doc.title} ${a.ref}(${a.title})`, doc_id: doc.doc_id, ref: a.ref, text: clip(a.body, 500), edition: `현행 · 시행 ${doc.edition?.effective_from || '미상'}` });
          }
        }
      } catch { errors.push('상위 기준'); }
    }
  }
      return out; },
    async () => { const out = [];
  if (audits && !govSimilar) { // 감사·국회 지적사항은 ALIO 공공기관 공시 자료
    try {
      const r = await sources.searchRegs({ keyword: `${keywords(query).slice(0, 3).join(' ')} 감사 지적`, corpus: 'disclosure', hybrid: true, limit: 30, inst });
      for (const x of r.rows.filter((y) => /지적사항/.test(y.doc_type || '')).slice(0, 3)) out.push({ kind: '지적사항', label: auditLabel(x), doc_id: x.doc_id, ref: null, text: clip(x.body, 400), edition: '공시 자료' });
    } catch { errors.push('지적사항'); }
  }
      return out; },
  ].map((f) => f()));
  ev.push(...parts.flat());
  ev.forEach((e, i) => { e.id = `E${i + 1}`; });
  return { evidence: ev, errors };
}

// 항목들을 최대 n개씩 동시에 처리하고, 결과는 입력 순서대로 돌려준다(외부 조회 한도를 넘지 않게)
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
export const LAW_OFF = '중앙행정기관·지방자치단체 규정은 법제처 국가법령정보 연결이 필요합니다. 상단 F12 설정에서 본인 법제처 OC(인증키)를 넣거나 규정 파일을 올려 주세요.';
// 법제처 자치법규(ordin)·행정규칙(admrul) 본문 검색 → 조문 행(ALIO 검색 행과 같은 모양). 규정은 maxDocs 개까지만 불러온다
export const govTarget = (orgType) => (orgType === 'local-gov' ? 'ordin' : orgType === 'central-ministry' ? 'admrul' : null);
export async function govArticles(sources, target, keyword, { org = null, maxDocs = 8, keep = () => true } = {}) {
  if (!sources.gov?.enabled) throw fail('law_go_disabled', LAW_OFF, 400);
  const out = [];
  const docs = await mapLimit((await sources.gov.search({ target, keyword, pages: org ? 3 : 1, org })).slice(0, maxDocs), 4, async (r) => { try { return [r, await sources.loadDoc(r.doc_id)]; } catch { return null; } }); // 한 규정 실패는 건너뛴다
  for (const [r, d] of docs.filter(Boolean)) for (const a of d.articles) if (a.section === '본칙' && a.ref && keep(a)) out.push({ inst_name: r.inst_name, doc_id: d.doc_id, doc_title: d.title, art_ref: a.ref, art_title: a.title, body: a.body, edition_state: 'current', effective_from: d.edition?.effective_from || null });
  return out;
}

