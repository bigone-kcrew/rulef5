// 규정 점검: 규정 묶음의 인용 오류·용어 혼용·수치 충돌 후보(결정적 규칙 + 선택적 AI 확인)
import { extractCitations, sameRegulation } from '../lib/refs.mjs';
import { refOf } from '../lib/parse.mjs';
import { clip } from '../lib/text.mjs';
import { josa } from '../lib/table.mjs';
import { readFileSync } from 'node:fs';
// 중앙행정기관 이름(법제처 자료에서 만든 목록)
const AGENCIES = JSON.parse(readFileSync(new URL('../orgs.json', import.meta.url), 'utf8')).central.map((x) => x.name).filter((x) => x.length >= 2);
import { SYS_BASE } from './prompts.mjs';
import { fail, LAW_OFF, mapLimit } from './common.mjs';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const SYN = [['직원', '임직원', '종업원', '근로자', '사원', '소속 직원']];
const TOPICS = ['출장비', '출장', '복명', '정산', '휴가', '연차', '병가', '육아', '출산', '휴직', '수당', '여비', '일비', '교육', '징계', '승진', '근무시간', '초과근무', '신고', '제출', '보고', '이의신청', '재심', '청구', '신청', '당직', '숙직', '일직', '휴무', '시간외근무', '비상근무', '임기', '연임', '위원'];
const NUM = /(\d+(?:\.\d+)?)\s*(일|주|개월|년|시간|회|세|%|만원|원)(?![가-힣]*간\s*근무)/g;
const REGNAME = /(규정|규칙|지침|세칙|요령|정관|기준|조례|훈령|예규|고시|강령|내규)$/;

export function checkDocs(docs, { wholeInstitution = false, terms = null, orgType = null, org = null } = {}) {
  // 올린 묶음이 한 기관 규정이면(제명 첫 낱말이 같음) 그 기관 이름으로 시작하는 다른 규정 인용도 묶음에 있는지 본다
  // 제명 첫 낱말이 기관 이름처럼 보일 때만(가나다공단·누리시·가람부) — 「공무원 여비 규정」의 「공무원」은 기관명이 아니다
  const orgWords = new Set(docs.map((x) => String(x.title || '').trim().split(/\s+/)[0]).filter((w) => w && w.length >= 2 && /(공단|공사|재단|진흥원|연구원|센터|위원회|협회|은행|기금|원|시|군|구|도|청|부|처|교육청)$/.test(w) && !/^(공무원|국가|지방|정부|공공기관|직원|임직원)/.test(w)));
  // 지자체·부처 기관명(「경기도 누리시」→ 누리시)도 우리 기관 접두어로 본다
  if (org) for (const w of [String(org).trim(), String(org).trim().split(/\s+/).pop()]) if (w && w.length >= 2) orgWords.add(w);
  const sameOrg = (name) => [...orgWords].some((w) => String(name).startsWith(w));
  // 상위 지자체(경기도 누리시 → 경기도) 조례는 우리 기관 규정이 아니다
  const upper = orgType === 'local-gov' && String(org || '').trim().includes(' ') ? String(org).trim().split(/\s+/)[0] : null;
  if (upper) orgWords.delete(upper); // 「서울특별시 강남구 …」 제명의 첫 낱말(서울특별시)은 우리 기관이 아니다
  const out = [];
  const add = (type, severity, d, ref, message, evidence, at = null, fix = null) => out.some((x) => x.type === type && x.doc_id === d.doc_id && x.ref === ref && x.message === message) || out.push({ type, severity, doc_id: d.doc_id, doc_title: d.title, ref, message, evidence: evidence ? (at === null ? clip(evidence, 220) : `…${evidence.slice(Math.max(0, at - 60), at + 90)}…`) : null, ...(fix ? { fix } : {}) });
  const GOV = /(공무원|국가|정부|대통령|총리|부령|공공기관의|공기업|준정부기관|에 관한 지침|운영에 관한|혁신에 관한|법$|령$|^공공기관)/;
  // 다른 기관(중앙행정기관)의 규정·기준은 우리 기관 규정 누락이 아니다(예: 「조달청 평가위원 통합관리규정」)
  const otherAgency = (name) => AGENCIES.some((g) => String(name).startsWith(g) && !orgWords.has(g));
  const clean = (s) => (typeof s === 'string' && s.trim() && s.length <= 20 ? s.trim() : null);
  // 기준어를 품은 말(「소속 공무원」⊃「공무원」)은 혼용이 아니므로 대체어에서 뺀다
  const user = terms && typeof terms === 'object' ? Object.entries(terms).slice(0, 20).map(([k, v]) => [clean(k), ...(Array.isArray(v) ? v.slice(0, 10).map(clean).filter((x) => x && !(clean(k) && x.includes(clean(k)))) : [])].filter(Boolean)).filter((g) => g.length > 1) : [];
  const groups = [...SYN, ...user];
  for (const d of docs) {
    const main = d.articles.filter((a) => a.section === '본칙' && a.ref);
    const refs = new Set(main.map((a) => a.ref));
    // 2단 표로 변환된 원문처럼 다른 조문이 표 칸 안에 들어간 경우: 본문 안의 「제N조(」 머리는 있는 조문으로 보고 구조 손상만 한 번 알린다
    const inner = new Set(main.flatMap((a) => [...a.body.matchAll(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*\((?!\s*이하)[^)]{1,30}\)/g)].map((m) => refOf(+m[1], m[2] ? +m[2] : null))));
    let damaged = 0;
    // 조 번호가 절반 넘게 비어 있으면(2단 편집이 섞여 변환된 원문 등) 조문 인용 오류를 개별로 내지 않는다
    const maxNo = Math.max(0, ...main.map((a) => a.no || 0)), sparse = maxNo >= 10 && new Set(main.map((a) => a.no)).size / maxNo < 0.5;
    const annexTitles = d.articles.filter((a) => a.section === '별표').map((a) => a.title.replace(/\s+/g, ''));
    for (const a of main) {
      const paras = [...a.body].filter((ch) => CIRCLED.includes(ch)).length;
      for (const c of extractCitations(a.body)) {
        if (c.kind === 'article' && !refs.has(refOf(c.no, c.sub)) && (inner.has(refOf(c.no, c.sub)) || (sparse && c.no <= maxNo))) damaged++;
        else if (c.kind === 'article' && !refs.has(refOf(c.no, c.sub))) add('broken_ref', 'high', d, a.ref, `${a.ref}가 이 규정에 없는 ${refOf(c.no, c.sub)}를 인용합니다.`, a.body, c.index);
        else if (c.kind === 'paragraph' && paras && c.para > paras) add('broken_ref', 'mid', d, a.ref, `${a.ref}가 없는 제${c.para}항을 인용합니다(항 ${paras}개).`, a.body);
        else if (c.kind === 'article' && c.para) { const t = main.find((x) => x.ref === refOf(c.no, c.sub)); const n = t ? [...t.body].filter((ch) => CIRCLED.includes(ch)).length : 0; if (t && n && c.para > n) add('broken_ref', 'mid', d, a.ref, `${a.ref}가 인용한 ${refOf(c.no, c.sub)}제${c.para}항이 없습니다(항 ${n}개).`, a.body); }
        else if (c.kind === 'annex' && annexTitles.some((t) => /별표\d/.test(t)) && !annexTitles.some((t) => new RegExp(`별표${c.no}(?!\\d)`).test(t))) add('broken_ref', 'high', d, a.ref, `${a.ref}가 이 규정에 없는 별표 ${c.no}${josa(String(c.no), '을', '를')} 인용합니다(있는 별표: ${annexTitles.map((t) => (t.match(/별표\d+/) || [])[0]).filter(Boolean).join(', ') || '없음'}).`, a.body);
        else if (c.kind === 'form' && annexTitles.length && annexTitles.some((t) => t.includes('별지')) && !annexTitles.some((t) => new RegExp(`별지(제)?${c.no}호`).test(t))) add('broken_ref', 'check', d, a.ref, `${a.ref}가 인용한 별지 제${c.no}호 서식을 이 자료에서 찾지 못했습니다(원천 자료에 서식이 빠졌을 수 있음).`, a.body, c.index);
        else if (c.kind === 'external' && !c.abbr && (wholeInstitution || sameOrg(c.name)) && REGNAME.test(c.name) && (sameOrg(c.name) || !GOV.test(c.name)) && !otherAgency(c.name) && !(upper && String(c.name).startsWith(upper) && !sameOrg(c.name)) && !docs.some((x) => sameRegulation(c.name, x.title, x.inst))) add('missing_reg', 'check', d, a.ref, `「${c.name}」을(를) 기관 규정 묶음에서 찾지 못했습니다(폐지·명칭 변경 여부 확인).`, a.body, c.index);
      }
    }
    if (damaged) add('broken_ref', 'check', d, '-', sparse ? `원문 구조가 손상된 것으로 보입니다(제${maxNo}조까지 중 ${main.length}개 조문만 읽힘 — 다단 편집이 섞여 변환된 원문일 수 있음). 이 규정의 조문 인용 ${damaged}건은 오류로 보지 않았습니다. 원문을 확인하세요.` : `원문 구조가 손상된 것으로 보입니다(표 안에 다른 조문 ${inner.size}개가 들어 있음). 인용 ${damaged}건은 표 안의 조문을 가리키므로 오류로 보지 않았습니다. 원문을 확인하세요.`, null);
    // 용어: 정의한 용어와 같은 뜻의 다른 표기 혼용
    const defined = new Set(); for (const a of main) for (const m of a.body.matchAll(/["“]([^"”]{1,15})["”]\s*(?:이)?(?:란|라 한다|이라 한다)/g)) defined.add(m[1].trim());
    for (const g of groups) {
      const def = g.find((t) => defined.has(t)); if (!def) continue;
      for (const other of g.filter((t) => t !== def)) {
        const used = main.filter((a) => !/정의/.test(a.title) && new RegExp(`(^|[^가-힣])${other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(a.body.replace(/["“][^"”]*["”]/g, '')));
        if (used.length) add('term', 'mid', d, used.map((a) => a.ref).join(', '), `정의한 용어 "${def}" 대신 "${other}"${josa(other, "을", "를")} 씁니다(${used.map((a) => a.ref).join(', ')}).`, used[0].body, null, { find: other, rep: def });
      }
    }
    // 수치 충돌: 같은 주제어 묶음·같은 단위에서 다른 값을 정한 조문 쌍
    const facts = [];
    for (const a of main) for (const sent of a.body.split(/(?<=[.다])\s+|\n/)) {
      const topics = TOPICS.filter((t) => sent.includes(t)); if (topics.length < 2) continue;
      for (const m of sent.matchAll(NUM)) facts.push({ a, key: topics.sort().join('+') + '|' + m[2], val: m[1] + m[2], sent });
    }
    const byKey = new Map(); for (const f of facts) byKey.set(f.key, [...(byKey.get(f.key) || []), f]);
    for (const [key, fs] of byKey) {
      const vals = [...new Set(fs.map((f) => f.val))], arts = [...new Set(fs.map((f) => f.a.ref))];
      if (vals.length > 1 && arts.length > 1) add('conflict', 'check', d, arts.join(', '), `같은 사항(${key.split('|')[0].replace(/\+/g, '·')})에 서로 다른 값(${vals.join(' / ')})을 정한 조문이 있습니다: ${arts.join(', ')}. 특례인지 충돌인지 확인하세요.`, fs.map((f) => `${f.a.ref}: ${f.sent}`).join(' | '));
    }
  }
  // 규정 누락 확인은 규정·이름마다 한 건으로 묶고 인용한 조문을 함께 적는다
  const seenReg = new Map();
  for (let i = 0; i < out.length; i++) { const f = out[i]; if (f.type !== 'missing_reg') continue; const n = f.message.match(/「([^」]+)」/)?.[1], key = `${f.doc_id}|${n}`; const first = seenReg.get(key); if (!first) { seenReg.set(key, f); continue; } if (!String(first.ref).split(', ').includes(f.ref)) first.ref = `${first.ref}, ${f.ref}`; out.splice(i--, 1); }
  return out;
}

export async function runCheck(ctx) {
  const { sources, llm } = ctx.deps, input = ctx.input;
  const docs = await ctx.step('규정 묶음 불러오기', async (s) => {
    let ids = (Array.isArray(input.doc_ids) ? input.doc_ids : []).slice(0, 30);
    // 기관 전체: 공공기관은 ALIO 공시 내규, 지자체는 자치법규·부처는 행정규칙(법제처). keyword 가 있으면 제명에 그 말이 든 규정만
    const govType = ['local-gov', 'central-ministry'].includes(input.org_type) ? input.org_type : null;
    let srcLabel = '';
    if (!ids.length && input.inst && govType) {
      if (!sources.gov?.enabled) throw fail('law_go_disabled', LAW_OFF, 400);
      const target = govType === 'local-gov' ? 'ordin' : 'admrul';
      const rows = await sources.gov.orgDocs({ target, org: String(input.inst).slice(0, 60), pages: 3, extra: String(input.keyword || '').slice(0, 30) });
      ids = rows.map((x) => x.doc_id).slice(0, 30); srcLabel = target === 'ordin' ? '자치법규(법제처)' : '행정규칙(법제처)';
      if (!ids.length) throw fail('not_found', `${input.inst}의 ${srcLabel}에서 ${input.keyword ? `제명에 '${input.keyword}'가 든 ` : ''}규정을 찾지 못했습니다.`, 404);
    } else if (!ids.length && input.inst) {
      const r = await sources.searchRegs({ keyword: '목적', inst: String(input.inst).slice(0, 60), corpus: 'bylaws', limit: 50 });
      ids = [...new Set(r.rows.map((x) => x.doc_id))].slice(0, 30); srcLabel = 'ALIO 공시 내규';
    }
    if (!ids.length) throw fail('bad_input', '점검할 규정을 선택하거나 기관명을 입력해 주세요.');
    const list = []; const errors = [];
    // 규정을 4개씩 동시에 불러온다(순서 유지)
    for (const d of await mapLimit(ids, 4, async (id) => { try { return await sources.loadDoc(id); } catch { errors.push(id); return null; } })) if (d) list.push(d);
    if (!list.length) throw fail('source_unavailable', `규정을 하나도 불러오지 못했습니다(${errors.length}개 실패). 잠시 후 다시 시도하세요.`, 502);
    s.note(`${srcLabel ? `${input.inst} ${srcLabel} · ` : ''}${list.length}개 규정 · 본칙 ${list.reduce((n, d) => n + d.articles.filter((a) => a.section === '본칙').length, 0)}개 조문${errors.length ? ` · ⚠ ${errors.length}개 불러오기 실패` : ''}`);
    return list;
  });
  const findings = await ctx.step('인용·용어·수치 규칙 점검', async (s) => {
    const f = checkDocs(docs, { wholeInstitution: !!input.inst, terms: input.profile?.terms || null, orgType: ['local-gov', 'central-ministry'].includes(input.org_type) ? input.org_type : (input.profile?.type || null), org: input.inst || (/^예시 /.test(input.profile?.name || '') ? null : input.profile?.name) || null });
    const c = (t) => f.filter((x) => x.type === t).length;
    s.note(`인용 오류 ${c('broken_ref')} · 용어 혼용 ${c('term')} · 수치 충돌 후보 ${c('conflict')} · 규정 누락 후보 ${c('missing_reg')}${c('missing_reg') && input.inst ? '(다음 단계에서 실제로 없는지 확인)' : ''}`);
    return f;
  });
  // 묶음에 없는 규정 인용은 ALIO에서 그 기관 규정을 검색해 실제로 없을 때만 남긴다
  const missing = findings.filter((x) => x.type === 'missing_reg');
  const govT = input.org_type === 'local-gov' ? 'ordin' : input.org_type === 'central-ministry' ? 'admrul' : null;
  if (missing.length && input.inst && (!govT || sources.gov?.enabled)) {
    await ctx.step('누락 규정 확인', async (s) => {
      const names = [...new Set(missing.map((x) => x.message.match(/「([^」]+)」/)?.[1]).filter(Boolean))].slice(0, 40), found = new Set();
      // 규정명마다 기관 규정에 있는지 4개씩 동시에 확인한다
      // 지자체·부처: 전체 제명으로 먼저 찾고, 못 찾으면 줄인 이름으로 다시 찾는다(띄어 쓴 「…에 관한 조례」를 두 어절로 자르면 못 찾음)
      const short = (n) => n.replace(/^.*?(?=[가-힣]+\s*(규정|규칙|지침|세칙|요령|조례|훈령|예규|기준|강령|내규)$)/, '');
      await mapLimit(names, 4, async (n) => {
        try {
          if (govT) {
            const org = String(input.inst).slice(0, 60);
            for (const kw of [...new Set([n, short(n)])]) { const rows = await sources.gov.search({ target: govT, keyword: kw, body: false, pages: 1, org }); if (rows.some((x) => sameRegulation(n, x.doc_title, org))) { found.add(n); return; } }
            return;
          }
          const r = await sources.searchRegs({ keyword: n.replace(/^.*?(?=[가-힣]+(규정|규칙|지침|세칙|요령|정관|기준)$)/, ''), inst: String(input.inst).slice(0, 60), corpus: 'bylaws', limit: 10 });
          if (r.rows.some((x) => sameRegulation(n, x.doc_title, input.inst))) found.add(n);
        } catch { /* 확인 실패는 남겨 둔다 */ }
      });
      // 법제처에 법령·행정규칙으로 있으면 범정부 규정이므로 기관 규정 누락이 아니다(예: 「관공서 공휴일에 관한 규정」 「계약예규」)
      let gov = 0;
      if (sources.lawGo?.enabled) await mapLimit(names.filter((x) => !found.has(x)), 4, async (n) => { try { const r = await sources.searchLaw(n, { targets: ['law', 'admrul'], limit: 5 }); if ((r.rows || []).some((x) => x.source === '법제처' && sameRegulation(n, x.title))) { found.add(n); gov++; } } catch { /* 확인 실패는 남겨 둔다 */ } });
      for (let i = findings.length - 1; i >= 0; i--) { const n = findings[i].type === 'missing_reg' && findings[i].message.match(/「([^」]+)」/)?.[1]; if (n && found.has(n)) findings.splice(i, 1); }
      s.note(`${names.length}개 규정명 확인 · ${found.size - gov}개는 ${govT ? '법제처 자치법규·행정규칙' : 'ALIO'}에 있음 · ${gov}개는 범정부 법령·행정규칙(목록에서 제외)`);
    });
  }
  const conflicts = findings.filter((x) => x.type === 'conflict').slice(0, 10);
  if (llm && conflicts.length) {
    await ctx.step('충돌 후보 AI 확인', async (s) => {
      try {
        const o = await llm.chatJson([{ role: 'system', content: SYS_BASE }, { role: 'user', content: JSON.stringify({ 과제: '같은 규정 안에서 서로 다른 값을 정한 조문 쌍이 실제 충돌인지, 적용 대상이 다른 특례·예외인지 판단한다. 직원·임직원·종업원·근로자·출장자처럼 같은 사람들을 다른 말로 부른 것(용어 혼용)은 적용 대상이 다른 것으로 보지 않는다. 한쪽에 「다만」「~의 경우에는」처럼 대상·상황을 좁히는 문구가 있을 때만 특례로 본다.', 후보: conflicts.map((c, i) => ({ id: String(i), 내용: c.evidence })), 출력형식: { results: [{ id: '0', conflict: true, reason: '한 문장' }] } }) }], (o) => { if (!Array.isArray(o.results)) throw new Error('results 없음'); return o; }, { maxTokens: 2500 });
        for (const r of o.results) { const c = conflicts[+r.id]; if (c) { c.severity = r.conflict ? 'mid' : 'check'; if (!r.conflict) c.ai_ok = true; c.message += ` AI 판단: ${r.conflict ? '충돌 가능성 높음' : '특례·예외일 수 있음'} — ${r.reason || ''}`; } }
        s.note(`${o.results.length}건 판단`);
      } catch (e) { s.note(`AI 확인 실패(${e.code || 'error'}) — 규칙 결과만 표시`); }
    });
  }
  const order = { high: 0, mid: 1, check: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { kind: '규정 점검', findings, stats: { docs: docs.length, articles: docs.reduce((n, d) => n + d.articles.filter((a) => a.section === '본칙').length, 0) }, docs: docs.map((d) => ({ doc_id: d.doc_id, title: d.title, inst: d.inst })) };
}
