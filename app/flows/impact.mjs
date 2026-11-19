// 상위법 영향: 개정 전·후 조문 → 변경점 → 영향받는 기관 규정 조문 탐색 → 판정(반영됨/개정 후보/확인 필요) → 개정 흐름으로 넘김
import { keywords, clip, lawNames } from '../lib/text.mjs';
import { diffMarks } from '../lib/table.mjs';
import { SYS_BASE } from './prompts.mjs';
import { fail, editionLabel, dedupeEditions, LAW_OFF, mapLimit } from './common.mjs';

const NUM = /(\d+(?:\.\d+)?)\s*(일|개월|년|시간|회|세|퍼센트|%|원|명|주)/g;
// 수치 정규화: 날짜 제거, 쉼표 제거, 만·천원 → 원, "N년 M개월"·"N년" → 개월
const WON = { 억: 1e8, 천만: 1e7, 백만: 1e6, 십만: 1e5, 만: 1e4, 천: 1e3, 백: 100 };
export function normNums(s) {
  return String(s || '')
    .replace(/\d{4}\s*년\s*\d{1,2}\s*월(\s*\d{1,2}\s*일)?|\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ')
    .replace(/(\d),(?=\d{3})/g, '$1')
    // 금액: 1억 5천만원·1천만원·5백만원·2만5천원 → 원 단위 숫자
    .replace(/((?:\d+(?:\.\d+)?\s*(?:억|천만|백만|십만|만|천|백)\s*)+)(\d+)?\s*원/g, (m, parts, rest) => `${Math.round([...parts.matchAll(/(\d+(?:\.\d+)?)\s*(억|천만|백만|십만|만|천|백)/g)].reduce((sum, [, n, u]) => sum + (+n) * WON[u], +(rest || 0)))}원`)
    .replace(/(\d+)\s*년\s*(\d+)\s*개월/g, (m, a, b) => `${(+a) * 12 + (+b)}개월`)
    .replace(/(\d+)\s*년(?!\s*\d)(?=\s*(이내|이상|이하|간|동안|까지|범위|의|을|를|으로|로|에|\s|$|[,.]))/g, (m, a) => `${(+a) * 12}개월`);
}
const nums = (s) => [...normNums(s).matchAll(NUM)].map((m) => m[1] + m[2]);
// 순서대로 짝지어 바뀐 수치만 뽑는다
export function numericChanges(before, after) {
  const a = nums(before), b = nums(after), out = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i] && a[i].replace(/[\d.]/g, '') === b[i].replace(/[\d.]/g, '')) out.push({ from: a[i], to: b[i] });
  return out.filter((x, i) => out.findIndex((y) => y.from === x.from && y.to === x.to) === i);
}
export function judge(fullBody, changes, topic = '', title = '') {
  // 주제어가 모두 들어 있는 문장만 본다(다른 휴가·제도의 같은 숫자 오탐 방지)
  const words = String(topic).split(/\s+/).filter((w) => w.length >= 2);
  // 띄어쓰기 무시 + 4자 이상 낱말은 앞 두 글자·뒤 글자 사이에 다른 말이 끼어도 인정("연차휴가" ≈ "연차 유급휴가")
  const ex = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = (w) => new RegExp(w.length >= 4 ? `${ex(w.slice(0, 2))}.{0,6}${ex(w.slice(2))}` : ex(w));
  const has = (s, w) => re(w).test(s.replace(/\s+/g, '')) || re(w).test(String(title).replace(/\s+/g, ''));
  const body = words.length ? normNums(fullBody).split(/(?<=[.다])\s+|\n|(?=[①②③④⑤⑥⑦⑧⑨⑩])/).filter((s) => words.every((w) => has(s, w))).join('\n') : normNums(fullBody);
  if (words.length && !body) return { status: 'check', reason: `'${topic}'을(를) 직접 정한 문장이 없습니다. 관련 여부를 확인하세요.` };
  const hasV = (v) => new RegExp(`(^|[^\\d.])${v.replace('.', '\\.')}`).test(body);
  const old = changes.filter((c) => hasV(c.from)), nu = changes.filter((c) => hasV(c.to));
  if (old.length && !nu.length) return { status: 'candidate', reason: `개정 전 값(${old.map((c) => c.from).join(', ')})이 남아 있습니다.` };
  if (nu.length && !old.length) return { status: 'reflected', reason: `개정 후 값(${nu.map((c) => c.to).join(', ')})이 반영되어 있습니다.` };
  if (old.length && nu.length) return { status: 'check', reason: '개정 전·후 값이 함께 있습니다. 조문을 확인하세요.' };
  return { status: 'check', reason: '수치로 판단할 수 없습니다. 내용을 확인하세요.' };
}
const ORDER = { candidate: 0, check: 1, reflected: 2 };

async function resolveText(sources, side, label) {
  if (side?.text) return { text: String(side.text).slice(0, 6000), label: `${label}(직접 입력)` };
  if (side?.doc_id) { const d = await sources.loadDoc(side.doc_id); const a = d.articles.find((x) => x.ref === side.ref); if (!a) throw fail('unknown_ref', `${d.title}에서 ${side.ref}를 찾지 못했습니다.`); return { text: a.body, label: `${d.title} ${a.ref}(${d.edition?.effective_from || ''})`, doc: d, art: a }; }
  throw fail('bad_input', `${label} 조문을 입력해 주세요.`);
}

// 규정 본문이 그 법령을 실제로 인용하는지: 정식 이름 또는 약칭(「남녀고용평등법」)으로 쓰고, 뒤에 다른 이름(복무규정·시행령)이 이어지지 않아야 한다
const ABBR = { '남녀고용평등과일ㆍ가정양립지원에관한법률': '남녀고용평등법', '공공기관의운영에관한법률': '공공기관운영법', '근로자퇴직급여보장법': '퇴직급여법' };
export function citesLaw(body, lawName) {
  const flat = (s) => String(s || '').replace(/\s+/g, '').replace(/[·・]/g, 'ㆍ');
  const b = flat(body), full = flat(lawName).replace(/^「|」$/g, '');
  const names = [full, ABBR[full], full.endsWith('법') || full.endsWith('법률') ? null : null].filter(Boolean);
  return names.some((n) => { let i = b.indexOf(n); while (i >= 0) { const after = b.slice(i + n.length, i + n.length + 4); if (!/^(시행령|시행규칙)/.test(after) && !/^[가-힣]*(규정|규칙|령)/.test(after.replace(/^」/, '')) ) return true; i = b.indexOf(n, i + 1); } return false; });
}
export async function runImpact(ctx) {
  const { sources, llm } = ctx.deps, input = ctx.input;
  const lawName = String(input.law_name || '').trim().slice(0, 80);
  const before = await resolveText(sources, input.before, '개정 전'), after = await resolveText(sources, input.after, '개정 후');
  const change = await ctx.step('변경점 파악', async (s) => {
    const changes = numericChanges(before.text, after.text);
    let summary = changes.map((c) => `${c.from} → ${c.to}`).join(', '), topic = String(input.topic || '').trim();
    if (llm) {
      try {
        const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: '상위 법령 조문의 개정 전·후를 비교해 무엇이 바뀌었는지 짧게 정리하고, 기관 규정에서 같은 사항을 찾을 검색어(주제 명사 2~4개)를 뽑는다.', 법령: lawName, 개정전: before.text, 개정후: after.text, 출력형식: { summary: '한두 문장', topic: '검색어 공백 구분' } }) }], (o) => { if (typeof o.summary !== 'string') throw new Error('summary 없음'); return o; }, { maxTokens: 1500 });
        summary = o.summary || summary; topic = topic || o.topic || '';
      } catch (e) { ctx.log(`AI 요약 실패(${e.code || 'error'}) — 수치 비교 결과를 씁니다.`); }
    }
    topic = topic || keywords(after.text).slice(0, 3).join(' ');
    s.note(`${summary || '수치 변화 없음 — 문구 변경'}\n검색 주제: ${topic}`);
    s.evidence([{ label: `개정 전: ${before.label}` , doc_id: before.doc?.doc_id || '직접 입력', ref: before.art?.ref }, { label: `개정 후: ${after.label}`, doc_id: after.doc?.doc_id || '직접 입력', ref: after.art?.ref }]);
    return { changes, summary, topic, diff: diffMarks(before.text, after.text) };
  });

  const searchErrors = [];
  const cands = await ctx.step('영향 조문 탐색', async (s) => {
    const found = new Map(), errors = [];
    const seenRows = [];
    // 별표(표)에 주제가 있는 경우도 후보로 둔다(조 번호가 없으므로 '별표'로 표시하고 사람이 확인)
    const add = (r, via) => { if (!r.art_ref && (r.section === '별표' || /별표/.test(r.art_title || '')) && change.topic.split(/\s+/).some((w) => w.length >= 2 && String(r.body || '').replace(/\s+/g, '').includes(w.slice(0, 2)))) r = { ...r, art_ref: '별표', annex: true }; seenRows.push([r, via]); const key = `${r.doc_id}#${r.section === '부칙' ? '부칙 ' : ''}${r.art_ref}`; if (!r.art_ref || found.has(key)) return; found.set(key, { key, doc_id: r.doc_id, doc_title: r.doc_title, inst: r.inst_name, ref: r.art_ref, section: r.section || null, title: r.art_title || '', body: r.body || '', edition: editionLabel(r), via, annex: !!r.annex }); };
    const inst = input.scope?.inst || undefined;
    const short = (lawNames(lawName)[0] || lawName).replace(/(에 관한 법률|법률|법)$/, '').slice(0, 20);
    // 지자체는 자치법규, 부처는 행정규칙(법제처)에서 찾는다: 본문에 법령명·주제어가 든 규정을 불러와 주제 조문을 후보로
    const govType = ['local-gov', 'central-ministry'].includes(input.org_type) ? input.org_type : null;
    if (govType) {
      if (!sources.gov?.enabled) throw fail('law_go_disabled', LAW_OFF, 400);
      const target = govType === 'local-gov' ? 'ordin' : 'admrul', docsSeen = new Map();
      for (const q of [short, change.topic].filter(Boolean)) { try { for (const r of await sources.gov.search({ target, keyword: q, pages: inst ? 3 : 1, org: inst || null })) if (!docsSeen.has(r.doc_id)) docsSeen.set(r.doc_id, r); } catch { errors.push('법제처 검색'); } }
      const kw = change.topic.split(/\s+/).filter((w) => w.length >= 2);
      const loaded = await mapLimit([...docsSeen.values()].slice(0, 12), 4, async (r) => { try { return [r, await sources.loadDoc(r.doc_id)]; } catch { errors.push(r.inst_name || '규정 불러오기'); return null; } });
      for (const [r, d] of loaded.filter(Boolean)) {
        try { for (const a of d.articles) if (a.section === '본칙' && a.ref && (citesLaw(a.body, lawNames(lawName)[0] || lawName) || kw.every((k) => a.body.replace(/\s+/g, '').includes(k.slice(0, 2))))) add({ doc_id: d.doc_id, doc_title: d.title, inst_name: r.inst_name, art_ref: a.ref, art_title: a.title, body: a.body, edition_state: 'current', effective_from: d.edition?.effective_from }, citesLaw(a.body, lawNames(lawName)[0] || lawName) ? '법령명 인용' : '같은 주제'); } catch { errors.push(r.inst_name || '규정 불러오기'); }
      }
    }
    if (!govType) try { if (short) { const res = await sources.searchRegs({ keyword: short, corpus: 'bylaws', body: true, inst, limit: 50 }); if (res.degraded) errors.push('법령명 검색 일부'); for (const r of res.rows) add(r, '법령명 인용'); } } catch { errors.push('법령명 검색'); }
    // 주제어 그대로 + 긴 낱말을 앞 두 글자로 줄인 변형("배우자 출산휴가" → "배우자 출산")
    const variants = [...new Set([change.topic, change.topic.split(/\s+/).map((w) => (w.length >= 4 ? w.slice(0, 2) : w)).join(' ')])].filter(Boolean);
    if (!govType) for (const q of variants) { try { const res = await sources.searchRegs({ keyword: q, corpus: 'bylaws', body: true, inst, limit: 50 }); if (res.degraded) errors.push('주제 검색 일부'); for (const r of res.rows) add(r, '같은 주제'); } catch { errors.push('주제 검색'); } }
    if (!govType && after.doc && /^legal:/.test(after.doc.doc_id) && sources.mcp?.enabled) {
      const rel = await sources.related({ doc_id: after.doc.doc_id, art_no: after.art.no, art_sub: after.art.sub || undefined, direction: 'incoming', corpus: 'bylaws', inst, limit: 30 });
      for (const r of rel?.incoming || []) add({ ...r, art_ref: r.art_ref || r.ref }, 'MCP 인용관계');
    }
    for (const id of (input.scope?.doc_ids || []).slice(0, 10)) {
      try { const d = await sources.loadDoc(id); const kw = change.topic.split(/\s+/).filter(Boolean); for (const a of d.articles) if (a.section === '본칙' && a.ref && (a.body.includes(short) || kw.some((k) => a.body.includes(k) || a.title.includes(k)))) add({ doc_id: d.doc_id, doc_title: d.title, inst_name: d.inst || '업로드 자료', art_ref: a.ref, art_title: a.title, body: a.body, edition_state: d.edition?.state }, '업로드 규정'); } catch { errors.push(id); }
    }
    { const keep = new Set(dedupeEditions(seenRows.map(([r]) => r))); for (const [k, v] of [...found]) if (![...keep].some((r) => `${r.doc_id}#${r.art_ref}` === k)) found.delete(k); }
    // 개정 전 값이 남아 있는 조문을 먼저 본다
    const olds = change.changes.map((c) => c.from);
    const list = [...found.values()].sort((a, b) => Number(olds.some((v) => b.body.includes(v))) - Number(olds.some((v) => a.body.includes(v)))).slice(0, 80);
    searchErrors.push(...errors);
    s.note(`후보 조문 ${list.length}개(${new Set(list.map((x) => x.inst)).size}개 기관)${list.length ? '' : ` · ${inst ? `${inst} 규정` : '검색 범위'}에서 '${change.topic}'을(를) 정한 조문을 찾지 못했습니다(규정이 없다는 뜻은 아님 — 주제어를 규정에 쓰인 낱말로 바꿔 보세요)`}${errors.length ? ` · ⚠ ${errors.join('·')} 실패(0건이 '없음'을 뜻하지 않음)` : ''}`);
    return list;
  });

  return ctx.step('판정', async (s) => {
    for (const c of cands) Object.assign(c, c.annex ? { status: 'check', reason: '별표(표)에 같은 주제가 있습니다. 표의 값이 상위 법령 개정에 맞는지 직접 확인하세요(별표는 자동 판정하지 않음).' } : judge(c.body, change.changes, change.topic, c.title));
    // 주제 문장이 있는데 수치로 판단하지 못한 조문만 AI에게 묻는다
    const unsure = cands.filter((c) => c.status === 'check' && !c.annex && !/직접 정한 문장이 없습니다/.test(c.reason)).slice(0, 12);
    if (llm && unsure.length) {
      try {
        const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: '상위 법령 변경에 비추어 각 기관 규정 조문이 이미 반영됐는지(reflected), 개정이 필요한지(candidate), 관련 없거나 판단 불가인지(check) 판정한다. 기관 규정이 상위 법령 기준과 같거나 근로자·이용자에게 더 유리하면 reflected 다. candidate 로 판정하면 그 판단의 근거가 된 조문 본문 구절을 quote 에 그대로 옮긴다.', 변경: change.summary, 개정후: after.text.slice(0, 1500), 조문: unsure.map((c) => ({ key: c.key, 본문: clip(c.body, 400) })), 출력형식: { results: [{ key: '', status: 'reflected|candidate|check', reason: '한 문장', quote: 'candidate 일 때 조문 구절' }] } }) }], (o) => { if (!Array.isArray(o.results)) throw new Error('results 없음'); return o; }, { maxTokens: 3000 });
        for (const r of o.results) { const c = unsure.find((x) => x.key === r.key); if (c && ORDER[r.status] !== undefined) { const quoted = r.quote && String(c.body).replace(/\s+/g, '').includes(String(r.quote).replace(/\s+/g, '')); c.status = /판단\s*불가|알 수 없|무관/.test(r.reason || '') || (r.status === 'candidate' && !quoted) ? 'check' : r.status; c.reason = `AI 판단: ${r.reason || ''}${r.status === 'candidate' && !quoted ? ' (근거 구절 확인 안 됨 — 확인 필요)' : ''}`; } }
      } catch (e) { ctx.log(`AI 판정 실패(${e.code || 'error'}) — 규칙 판정만 사용합니다.`); }
    }
    cands.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const changeText = change.changes.map((c) => `${c.from}→${c.to}`).join(', ');
    // 발췌는 읽기 쉽게: 마크다운 제목·굵게·표 구분선을 빼고 표 칸은 「·」로 잇는다(별표 표가 기호째 보이지 않게)
    const plain = (t) => String(t || '').split('\n').filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map((l) => l.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/^\s*\||\|\s*$/g, '').split('|').map((x) => x.trim()).filter(Boolean).join(' · ')).filter(Boolean).join(' ');
    for (const c of cands) { c.excerpt = clip(plain(c.body), 260); c.amend = { doc_id: c.doc_id, refs: c.annex ? [] : [c.ref], intent: `${lawName || '상위 법령'} 개정(${changeText || change.summary})에 맞춰 ${c.ref}(${c.title})를 개정한다. ${change.summary}`.slice(0, 600) }; delete c.body; }
    const cnt = (st) => cands.filter((c) => c.status === st).length;
    s.note(`개정 후보 ${cnt('candidate')} · 확인 필요 ${cnt('check')} · 반영됨 ${cnt('reflected')} — 위반 판정이 아니라 검토 우선순위입니다.`);
    return { kind: '상위법 영향', errors: searchErrors, law_name: lawName, summary: change.summary, changes: change.changes, diff: change.diff, candidates: cands };
  });
}
