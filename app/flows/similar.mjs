// 유사 규정 비교: 주제 → 기관별 대표 조문 → 비교표(+AI 핵심 값 추출, 원문에 없는 값은 버림)
import { clip } from '../lib/text.mjs';
import { SYS_BASE } from './prompts.mjs';
import { fail, editionLabel, dedupeEditions, LAW_OFF, mapLimit } from './common.mjs';
import { normNums } from './impact.mjs';
import { orgMeta } from '../lib/orgs.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// C1 분포: 첫 항목 열의 원문 구절에서 수치를 정규화해 값별 기관 수를 센다(참고 자료, 전수 아님)
export function distribution(table, columns, myInst) {
  const col = columns[0]; const by = new Map(); let failed = 0, mine = null;
  for (const r of table) {
    const key = numKey(r.values?.[col], col);
    if (!key) { failed++; continue; }
    if (!by.has(key)) by.set(key, []); by.get(key).push(r.inst);
    if (r.mine || (myInst && String(r.inst || '').includes(myInst))) mine = { inst: r.inst, value: key };
  }
  const buckets = [...by].map(([value, insts]) => ({ value, count: insts.length, insts })).sort((a, b) => b.count - a.count);
  return { column: col || null, buckets, failed, sample: table.length, mine };
}

// 기관 목록(유형·주무부처)과 비교 대상 묶음
const INSTS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'institutions.json'), 'utf8')).items;
export const searchInstitutions = (q, limit = 20) => { const s = String(q || '').replace(/\s+/g, ''); return (s ? INSTS.filter((x) => x.name.replace(/\s+/g, '').includes(s)) : INSTS).slice(0, limit); };
// 이름이 정확히 같거나, 일부만 쳤을 때 후보가 하나뿐일 때만 그 기관으로 본다(「한국」→ 모호하므로 없음)
export const findInstitution = (name) => { const s = String(name || '').replace(/\s+/g, ''); if (!s) return null; const exact = INSTS.find((x) => x.name.replace(/\s+/g, '') === s); if (exact) return exact; const part = INSTS.filter((x) => x.name.replace(/\s+/g, '').includes(s)); return part.length === 1 ? part[0] : null; };
export const peerGroup = (me, by) => INSTS.filter((x) => x.name !== me.name && (by === 'type' ? x.type === me.type : x.ministry === me.ministry));
// 주제어(대상 낱말)가 실제로 들어 있는 항만 골라 낸다. '일수·기한'처럼 속성을 가리키는 낱말은 조문에 그대로 안 나오므로 빼고,
// 4자 이상 복합어는 2자씩 나눠 같은 항에 모두 있으면 일치로 본다(「배우자의 출산을 이유로 휴가」 = 배우자 출산휴가).
const ATTR = /^(일수|기한|기간|기준|한도|금액|요건|시효|절차|방법|범위|대상|제출|지급|사용|관련|규정|조항|조문|내용|비교|횟수|상한|하한|액수|수준|현황)$/;
const pieces = (t) => { if (t.length < 4) return [t]; const out = t.match(/.{2}/g); if (t.length % 2) out[out.length - 1] += t.slice(-1); return out; };
const subjects = (topic) => String(topic).split(/[\s·,/]+/).map((x) => x.replace(/[^가-힣A-Za-z0-9]/g, '')).filter((x) => x.length >= 2 && !ATTR.test(x));
const has = (p, toks) => { const c = p.replace(/\s+/g, ''); return toks.every((t) => c.includes(t) || pieces(t).every((x) => c.includes(x))); };
// level 2: 한 항이 주제어를 모두 담음(그 항만 발췌) · 1: 조문 전체로는 담음 · 0: 주제와 무관
export function topicFocus(text, topic) {
  const toks = subjects(topic), body = String(text || '');
  if (!toks.length) return { level: 2, text: clip(body, 700) };
  const paras = body.split(/\n+|(?=[①-⑳])/).map((p) => p.trim()).filter(Boolean);
  const hit = paras.filter((p) => has(p, toks));
  if (hit.length) return { level: 2, text: clip(hit.join('\n'), 700) };
  return has(`${body}`, toks) ? { level: 1, text: clip(body, 700) } : { level: 0, text: clip(body, 300) };
}
// 목적·정의·적용범위 조문은 주제어를 담아도 실제 기준이 없으므로 한 단계 낮춘다
const rank = (x, topic) => topicFocus(`${x.art_title || ''} ${x.body || ''}`, topic).level * 2 - (/^(목적|정의|적용\s*범위)$/.test(String(x.art_title || '').trim()) ? 1 : 0) - (/적용례|경과조치|시행일/.test(x.art_title || '') || (x.section === '부칙' && /시행\s*(당시|전|일\s*현재)|개정\s*시행일|종전의\s*규정/.test(x.body || '')) ? 3 : 0);
// 별표의 마크다운 표를 읽기 쉬운 한 줄로(구분선 제거, 칸은 「·」)
const plainTable = (t) => String(t || '').split('\n').filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*/g, ' · ')).join(' / ').replace(/#+\s*/g, '');
// 주제어가 들어 있는 문장의 첫 수치(모델이 없을 때의 비교 값)
function topicValue(text, topic) {
  const w = String(topic).split(/\s+/).filter((x) => x.length >= 2);
  const sent = normNums(text).split(/(?<=[.다])\s+|\n|(?=[①-⑳])/).filter((s) => w.some((x) => s.replace(/\s+/g, '').includes(x.replace(/\s+/g, '').slice(0, 4)))).join(' ');
  const m = sent.match(/(\d+(?:\.\d+)?)\s*(일|개월|년|시간|회|%|원|세)/);
  return m ? m[1] + m[2] : '';
}
// 값의 첫 수치+단위. 표(별표)에서 옮긴 값처럼 단위가 없으면 항목 이름(일수·횟수 등)에서 단위를 가져온다
const UNIT = [[/일수|휴가|병가/, '일'], [/개월/, '개월'], [/횟수/, '회'], [/연령|정년/, '세'], [/시간/, '시간']];
const canon = (n, u) => { if (u === '년' || u === '개월') { const mo = u === '년' ? n * 12 : n; return mo % 12 === 0 ? `${mo / 12}년` : `${mo}개월`; } return `${n}${u}`; };
export const numKey = (v, col = '') => { const t = String(v || ''); const m = t.match(/(\d+(?:\.\d+)?)\s*(일|주|개월|년|시간|회|%|만원|원|세)/); if (m) return canon(+m[1], m[2]); const n = t.match(/^\s*(\d+(?:\.\d+)?)(?![\d.])/), u = UNIT.find(([re]) => re.test(col)); return n && u ? canon(+n[1], u[1]) : ''; };
const family = (k) => (/년|개월$/.test(k) ? 'time' : (k.match(/[^\d.]+$/) || [''])[0]);

export async function runSimilar(ctx) {
  const { sources, llm } = ctx.deps, input = ctx.input;
  const topic = String(input.topic || '').trim().slice(0, 100);
  if (!topic) throw fail('bad_input', '비교할 주제를 입력해 주세요.');
  if (!subjects(topic).length) throw fail('bad_input', `'${topic}'만으로는 무엇을 비교할지 정할 수 없습니다. 대상 낱말을 함께 적어 주세요(예: 병가 일수, 육아휴직 기간).`);
  const n = Math.min(20, Math.max(3, +input.n || 10));
  const mineName = String(input.mine || '').trim().slice(0, 60);
  // 기관 유형: 공공기관은 ALIO 내규, 지자체는 자치법규·부처는 행정규칙(법제처)으로 비교한다. 부처는 산하 공공기관(ALIO)과도 비교할 수 있다
  const orgType = ['local-gov', 'central-ministry'].includes(input.org_type) ? input.org_type : 'public-institution';
  const govMode = orgType !== 'public-institution' && input.scope !== 'subsidiaries';
  if (orgType !== 'public-institution' && (govMode || mineName) && !sources.gov?.enabled) throw fail('law_go_disabled', LAW_OFF, 400);
  const target = orgType === 'local-gov' ? 'ordin' : 'admrul';
  const me = mineName ? (orgType === 'public-institution' ? (findInstitution(mineName) || { name: mineName, type: '', ministry: '' }) : { ...orgMeta(orgType, mineName), ministry: orgType === 'central-ministry' ? mineName : '' }) : null;
  if (orgType === 'central-ministry' && input.scope === 'subsidiaries') input.ministry = mineName;
  let scope = (govMode ? ['region', 'level', 'picked', 'all'] : ['ministry', 'type', 'picked', 'all']).includes(input.scope) ? input.scope : input.scope === 'subsidiaries' ? 'ministry' : (input.ministry ? 'ministry' : 'all');
  let scopeNote = '';
  if (govMode && ['region', 'level'].includes(scope) && !me) { scopeNote = '(우리 기관을 고르지 않아 전체에서 찾음)'; scope = 'all'; }
  if (!govMode && (scope === 'type' && !me?.type) || (scope === 'ministry' && !me?.ministry && !input.ministry)) { scopeNote = `(우리 기관의 ${scope === 'type' ? '유형' : '주무부처'}을 알 수 없어 전체에서 찾음)`; scope = 'all'; }
  let scopeLabel = '', offTopic = []; const notFound = [];
  const rows = await ctx.step('기관별 규정 검색', async (s) => {
    const errors = []; const toRow = (x, mine = false) => { const meta = findInstitution(x.inst_name) || {}; return { inst: x.inst_name, mine, type: meta.type || '', ministry: x.ministry || meta.ministry || '', doc_id: x.doc_id, doc_title: x.doc_title, ref: x.art_ref || (x.section === '별표' || /별표/.test(x.art_title || '') ? '별표' : ''), title: x.art_title || '', text: x.body || '', focus: topicFocus(x.body, topic).text, rank: rank(x, topic), excerpt: clip(plainTable(topicFocus(x.body, topic).text), 300), edition: editionLabel(x), date: x.effective_from || x.doc_date || '', values: {} }; };
    const base = { keyword: topic, corpus: 'bylaws', hybrid: true, as_of: input.as_of || undefined };
    // 기관 한 곳: 후보 조문 가운데 주제어가 든 본칙 조문을 먼저 고른다(검색 순위는 동점일 때만)
    const one = async (inst) => { try { const r = await sources.searchRegs({ ...base, inst, limit: 10 }); const own = dedupeEditions(r.rows, { byArticle: true }).filter((x) => x.inst_name === inst); if (!own.length) return null; return own.map((x, i) => [rank(x, topic), -i, x]).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0]?.[2] || null; } catch { errors.push(inst); return null; } };
    // ── 법제처(자치법규·행정규칙) ──
    const HR = /복무|인사|취업|근무|휴가|보수|여비|공무직|근로자|직원|운영규정|운영규칙/;
    const titleScore = (t) => (HR.test(t) ? 2 : 0) + subjects(topic).filter((w) => String(t).includes(w.slice(0, 2))).length * 2;
    // 의회 규정(회의규칙·의회 복무 조례 등)은 우리 기관이 의회일 때만 비교한다 — 집행기관끼리 비교
    const council = /의회/.test(me?.name || '') || /의회/.test(String(input.insts || ''));
    const usable = (r) => council || !/의회|회의규칙/.test(r.doc_title || '');
    const govRow = (x, mine = false) => { const m = orgMeta(orgType, x.inst_name); return { inst: x.inst_name, mine, gov: true, type: m.label, ministry: m.kind === '광역' || orgType === 'central-ministry' ? '' : m.region, doc_id: x.doc_id, doc_title: x.doc_title, ref: x.art_ref, title: x.art_title || '', text: x.body || '', focus: topicFocus(x.body, topic).text, rank: rank(x, topic), excerpt: clip(plainTable(topicFocus(x.body, topic).text), 300), edition: '현행(법제처)', date: x.effective_from || '', values: {} }; };
    let cand = null; const byOrg = new Map();
    const candidates = async () => { if (cand) return; cand = []; try { cand = await sources.gov.search({ target, keyword: topic }); } catch { errors.push('법제처 검색'); } for (const r of cand) { if (!byOrg.has(r.inst_name)) byOrg.set(r.inst_name, []); byOrg.get(r.inst_name).push(r); } };
    // 한 기관: 후보 규정(제명으로 우선순위) 2개까지 불러와 주제 항이 있는 본칙 조문을 고른다
    const loadBest = async (docsOfOrg) => {
      let best = null;
      for (const r of [...docsOfOrg].filter(usable).sort((a, b) => titleScore(b.doc_title) - titleScore(a.doc_title)).slice(0, 2)) {
        try { const d = await sources.loadDoc(r.doc_id); for (const a of (d?.articles || []).filter((y) => y.section === '본칙' && y.ref)) { const x = { doc_id: d.doc_id, inst_name: r.inst_name, doc_title: d.title, art_ref: a.ref, art_title: a.title, body: a.body, section: '본칙', effective_from: d.edition?.effective_from }; const k = rank(x, topic); if (!best || k > best.k) best = { k, x }; } } catch { errors.push(r.inst_name); }
        if (best?.k >= 2) break;
      }
      return best && best.k >= 2 ? best.x : null;
    };
    const govFind = async (name) => {
      await candidates();
      let rs = byOrg.get(name) || [];
      // 제명에 주제 낱말이 든 그 기관 규정(예: 「수원시 공무원 당직 및 비상근무 규칙」)도 함께 본다 — 본문 검색 상위 결과에 없을 수 있다
      try { const word = subjects(topic)[0]; if (word) { const more = await sources.gov.orgDocs({ target, org: name, pages: 1, extra: word.slice(0, 4) }); const have = new Set(rs.map((r) => r.doc_id)); rs = [...more.filter((r) => !have.has(r.doc_id)), ...rs]; } } catch { /* 제명 검색 실패는 본문 검색 결과로 */ }
      if (!rs.length) for (const extra of ['복무', '인사', '공무직']) { try { rs = (await sources.gov.orgDocs({ target, org: name, pages: 1, extra })).filter((r) => HR.test(r.doc_title)); } catch { errors.push(name); } if (rs.length) break; }
      return rs.length ? loadBest(rs) : null;
    };
    async function govFill(list) {
      await candidates();
      if (me) { const hit = await govFind(me.name); if (hit) list.push(govRow(hit, true)); else ctx.log(`우리 기관(${me.name}) ${target === 'ordin' ? '자치법규' : '행정규칙'}에서 '${topic}'을(를) 정한 조문을 찾지 못했습니다.`); }
      const inScope = (name) => { if (name === me?.name) return false; const m = orgMeta(orgType, name); if (scope === 'region') return me.kind === '광역' ? name.startsWith(me.name + ' ') : m.kind.startsWith('기초') && m.region === me.region; if (scope === 'level') return m.kind === me.kind; return true; };
      if (scope === 'picked') {
        const names = [...new Set((Array.isArray(input.insts) ? input.insts : []).map((x) => String(x).trim().slice(0, 60)).filter((x) => x && x !== me?.name))].slice(0, 10);
        for (const [nm, hit] of await mapLimit(names, 4, async (nm) => [nm, await govFind(nm)])) { if (hit) list.push(govRow(hit)); else notFound.push(nm); }
        scopeLabel = `직접 고른 기관 ${names.length}곳`;
      } else {
        const orgs = [...byOrg.keys()].filter(inScope);
        let tried = 0;
        // 4곳씩 동시에 불러오며 n곳을 채우면 멈춘다(최대 2n곳 시도)
        for (let k = 0; k < orgs.length && list.filter((x) => !x.mine).length < n && tried < n * 2; k += 4) { const batch = orgs.slice(k, k + 4); tried += batch.length; for (const [nm, hit] of await Promise.all(batch.map(async (nm) => [nm, await loadBest(byOrg.get(nm))]))) { if (hit && list.filter((x) => !x.mine).length < n) list.push(govRow(hit)); else if (!hit) notFound.push(nm); } }
        scopeLabel = scope === 'region' ? (me.kind === '광역' ? `${me.name} 안 시·군·구` : `같은 시·도(${me.region}) 안 시·군·구`) : scope === 'level' ? `같은 종류(${me.kind})` : `전체 ${target === 'ordin' ? '지방자치단체' : '중앙행정기관'}${scopeNote}`;
      }
      scopeLabel += ` · ${target === 'ordin' ? '자치법규' : '행정규칙'}(법제처)`;
    }
    const list = [];
    if (govMode) await govFill(list);
    else {
    // 부처의 산하 공공기관 비교: 우리 부처 행정규칙을 맨 위에 둔다
    if (orgType === 'central-ministry' && me) { const hit = await govFind(me.name); if (hit) list.push(govRow(hit, true)); else ctx.log(`우리 부처(${me.name}) 행정규칙에서 '${topic}' 조문을 찾지 못했습니다.`); }
    if (me && orgType === 'public-institution') { const hit = await one(me.name); if (hit) list.push(toRow(hit, true)); else if (!errors.includes(me.name)) ctx.log(`우리 기관(${me.name}) 규정에서 '${topic}' 조문을 찾지 못했습니다.`); }
    const uniq = (rs) => { const seen = new Set(list.map((x) => x.inst)); return dedupeEditions(rs, { byArticle: false }).filter((x) => { if (!x.inst_name || seen.has(x.inst_name)) return false; seen.add(x.inst_name); return true; }); };
    try {
      if (scope === 'picked') {
        const names = [...new Set((Array.isArray(input.insts) ? input.insts : []).map((x) => String(x).trim().slice(0, 60)).filter((x) => x && x !== me?.name))].slice(0, 10);
        for (const [nm, hit] of await mapLimit(names, 4, async (nm) => [nm, await one(nm)])) { if (hit) list.push(toRow(hit)); else if (!errors.includes(nm)) notFound.push(nm); }
        scopeLabel = `직접 고른 기관 ${names.length}곳`;
      } else if (scope === 'ministry' && (me?.ministry || input.ministry)) {
        const ministry = me?.ministry || input.ministry;
        const r = await sources.searchRegs({ ...base, distinct_inst: true, ministry, limit: Math.min(50, n * 3) });
        if (r.degraded) errors.push('검색 일부');
        list.push(...uniq(r.rows).filter((x) => !x.ministry || x.ministry === ministry).slice(0, n).map((x) => toRow(x)));
        scopeLabel = orgType === 'central-ministry' ? `${ministry} 산하 공공기관` : `같은 주무부처(${ministry})`;
      } else if (scope === 'type' && me?.type) {
        const peers = new Set(peerGroup(me, 'type').map((x) => x.name));
        for (const offset of [0, 50]) { const r = await sources.searchRegs({ ...base, distinct_inst: true, limit: 50, offset: offset || undefined }); if (r.degraded) errors.push('검색 일부'); list.push(...uniq(r.rows).filter((x) => peers.has(x.inst_name)).map((x) => toRow(x))); if (list.length > n || !r.has_more) break; }
        // 넓은 검색에 같은 유형 기관이 모자라면 기관을 하나씩 찾아 채운다(최대 12곳 조회)
        const have = new Set(list.map((x) => x.inst)); let asked = 0;
        const todo = [...peers].filter((nm) => !have.has(nm));
        for (let k = 0; k < todo.length && list.length < n + (list[0]?.mine ? 1 : 0) && asked < 12; k += 4) { const batch = todo.slice(k, k + 4); asked += batch.length; for (const hit of await Promise.all(batch.map((nm) => one(nm)))) if (hit && rank(hit, topic) >= 2 && list.length < n + (list[0]?.mine ? 1 : 0)) list.push({ ...toRow(hit), retried: true }); }
        list.splice(n + (list[0]?.mine ? 1 : 0));
        scopeLabel = `같은 기관 유형(${me.type})`;
      } else {
        const r = await sources.searchRegs({ ...base, distinct_inst: true, limit: Math.min(50, n * 3) });
        if (r.degraded) errors.push('검색 일부');
        list.push(...uniq(r.rows).slice(0, n).map((x) => toRow(x)));
        scopeLabel = `전체 공공기관${scopeNote}`;
      }
    } catch { errors.push('비교 대상 검색'); }
    // 묶음 검색은 기관마다 1순위 조문만 주므로, 주제와 맞지 않으면 그 기관만 다시 찾아 본다(최대 8곳)
    let redo = 0;
    const again = list.map((x, i) => i).filter((i) => !(list[i].rank >= 2 || list[i].retried || list[i].gov)).slice(0, 8); redo = again.length;
    await mapLimit(again, 4, async (i) => { const hit = await one(list[i].inst); if (hit) list[i] = { ...toRow(hit, list[i].mine), retried: true }; });
    }
    const off = list.filter((x) => x.rank < 2);
    offTopic = [...new Set([...notFound, ...off.filter((x) => !x.mine).map((x) => x.inst)])];
    if (off.some((x) => x.mine)) ctx.log(`우리 기관(${me.name}) 규정에서 '${topic}'을(를) 정한 조문을 찾지 못했습니다.`);
    list.splice(0, list.length, ...list.filter((x) => x.rank >= 2));
    list.forEach((x, i) => { x.key = String(i); delete x.rank; delete x.retried; });
    s.note(`${scopeLabel} · ${list.length}개 기관${me ? (list[0]?.mine ? ` · 우리 기관 ${me.name} 포함` : ` · 우리 기관(${me.name}) 조문 없음`) : ''}${offTopic.length ? ` · 주제 조문을 찾지 못한 기관 ${offTopic.length}곳 제외` : ''}${errors.length ? ` · ⚠ ${[...new Set(errors)].join('·')} 조회 실패(없다는 뜻 아님)` : ''}`);
    if (!list.length && errors.length) throw fail('source_unavailable', '기관 규정을 조회하지 못했습니다. 잠시 뒤 다시 시도해 주세요.', 502);
    return list;
  });
  let columns = [];
  if (llm && input.extract !== false && rows.length) {
    await ctx.step('핵심 값 추출', async (s) => {
      try {
        // 한 번에 모든 기관 값을 뽑는다(EXAONE 은 나눠 보내도 빨라지지 않아 실측 후 되돌림). 응답이 잘리지 않도록 한도를 넉넉히 둔다
        const TASK = `주제 '${topic}'에 대해 기관별로 비교할 핵심 항목 2~4개의 이름을 직접 정하고(예: "휴가 일수", "청구 기한" — 기관명·규정명 제외), 각 조문에서 그 값을 원문에 있는 그대로의 짧은 구절로 옮긴다(예: "20일의 휴가", "출산한 날부터 120일"). 숫자만 뽑거나 요약하지 않는다. 주제와 다른 대상의 값(예: 주제가 배우자 출산휴가인데 본인 출산휴가 90일)은 넣지 않는다. 한 조문에 경우별 값이 여럿이면(예: 업무상 180일, 그 밖 60일) 다른 기관과 같은 경우끼리 비교되도록 일반적인 경우의 값을 고른다. 원문에 없으면 빈 문자열. 항목마다 뜻이 겹치지 않게 정하고(예: "휴무 시점"과 "휴무 지정 기한"), 한 구절을 뜻이 다른 항목에 넣지 않는다 — 「○일 이내에」 같은 기한 구절은 기한 항목에만 넣는다. 한 조문에 여러 항목의 값이 함께 있으면 항목마다 나눠 옮긴다.`;
        const placeholder = (c) => /^(항목|항목\d*|column|이름)$|[<>]|항목명/i.test(String(c).trim());
        const ask = (sub, cols) => llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: cols ? `${TASK} 비교 항목은 이미 정해져 있다: ${cols.join(', ')} — 이 이름 그대로 쓴다.` : TASK, 조문: sub.map((r) => ({ key: r.key, 기관: r.inst, 본문: r.focus })), 출력형식: cols ? { rows: [{ key: '0', values: Object.fromEntries(cols.map((c) => [c, '<원문 구절>'])) }] } : { columns: ['<주제에 맞는 항목명1>', '<항목명2>'], rows: [{ key: '0', values: { '<주제에 맞는 항목명1>': '<원문 구절>', '<항목명2>': '' } }] } }) }], (o) => { if (!Array.isArray(o.rows)) throw new Error('rows 없음'); if (!cols && (!Array.isArray(o.columns) || !o.columns.length || o.columns.some(placeholder))) throw new Error('항목 이름을 예시 그대로 쓰지 말고 주제에 맞게 직접 정하세요.'); return o; }, { maxTokens: cols ? 3000 : 5000 });
        const o = await ask(rows, null);
        columns = o.columns.map(String).filter((c) => !/^(기관|기관명|규정|규정명|조문)$/.test(c.trim())).slice(0, 4);
        const batches = [];
        let failedBatches = 0;
        const more = await mapLimit(batches, 3, (sub) => ask(sub, columns).catch(() => { failedBatches++; return { rows: [] }; }));
        let dropped = 0;
        for (const r of [...o.rows, ...more.flatMap((x) => x.rows || [])]) { const t = rows.find((x) => x.key === String(r.key)); if (!t) continue; for (const c of columns) { const v = String(r.values?.[c] ?? '').trim(); if (!v || t.values[c]) continue; if (t.text.replace(/\s+/g, '').includes(v.replace(/\s+/g, ''))) t.values[c] = v.replace(/\s+/g, ' '); else dropped++; } }
        if (failedBatches) ctx.log(`값 추출 일부 실패(${failedBatches}묶음) — 해당 기관은 원문 발췌만 표시합니다.`);
        s.note(`항목: ${columns.join(', ')}${dropped ? ` · 원문에서 확인되지 않은 값 ${dropped}개 제외` : ''}`);
      } catch (e) { s.note(`AI 추출 실패(${e.code || 'error'}) — 원문 발췌만 표시합니다.`); }
    });
  } else ctx.skip('핵심 값 추출', llm ? '추출 안 함' : '모델 미설정 — 수치만 규칙으로 뽑습니다');
  if (!columns.length) { // 모델이 없거나 실패: 주제 문장의 첫 수치를 비교 값으로
    for (const r of rows) { const v = topicValue(r.focus, topic) || topicValue(r.text, topic); if (v) r.values['수치'] = v; }
    if (rows.some((r) => r.values['수치'])) columns = ['수치'];
  }
  const mineRow = rows.find((r) => r.mine);
  // 공무원의 휴가·근무 등은 대통령령(국가·지방공무원 복무규정)이 정하는 경우가 많아 조례·훈령에 조문이 없을 수 있다
  const civilNote = govMode && /휴가|휴직|근무시간|병가|연가|출산|육아/.test(topic) ? ` · 공무원의 휴가 등은 「${orgType === 'local-gov' ? '지방공무원 복무규정' : '국가공무원 복무규정'}」(대통령령)이 정하는 경우가 많아 ${orgType === 'local-gov' ? '조례·규칙' : '훈령·예규'}에 조문이 없을 수 있습니다(공무직 등 별도 규정 확인)` : '';
  if (mineRow && columns.length) { const mk = numKey(mineRow.values[columns[0]], columns[0]); const nums = (t) => new Set([...String(t || '').matchAll(/(\d+(?:\.\d+)?)\s*(일|주|개월|년|시간|회|%|만원|원|세)/g)].map((m) => canon(+m[1], m[2]))); const mine = nums(mineRow.focus);
    // 조문에 경우별 값이 여럿일 수 있다(업무상 180일·그 밖 60일). 상대 값이 우리 조문에도 있으면 '다름'이 아니라 '경우별 값'으로 표시한다
    for (const r of rows) if (!r.mine) { const k = numKey(r.values[columns[0]], columns[0]); const diff = !!mk && !!k && k !== mk && family(k) === family(mk); /* 단위가 다르면(12세·12개월) 비교하지 않는다 */ r.mixed = diff && (mine.has(k) || nums(r.focus).has(mk)); r.differs = diff && !r.mixed; } }
  for (const r of rows) { delete r.text; delete r.focus; }
  const dist = columns.length ? distribution(rows, columns, mineRow?.inst) : null;
  return { kind: '유사 규정 비교', topic, columns, table: rows, distribution: dist, mine: me, scope, scope_label: scopeLabel, off_topic: offTopic, note: `${scopeLabel}에서 검색으로 찾은 ${rows.length}개 기관 기준(전수 아님) · 참고 자료${civilNote}${columns[0] === '수치' ? ' · 값은 주제 문장의 첫 수치를 규칙으로 뽑은 근사값이므로 원문으로 확인하세요' : ''}` };
}
