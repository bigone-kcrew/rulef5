// C2 시행예정 법령 레이더: 시행예정 판본을 바로 앞 판본과 조문 단위로 비교 → 영향받는 기관 규정 → 정비 계획서
import { numericChanges, judge } from './impact.mjs';
import { clip } from '../lib/text.mjs';
import { editionLabel } from './common.mjs';
import { govArticles } from './common.mjs';
import { kstToday } from '../lib/law-go.mjs';

// 기관 유형별 기본 감시 법령
const DEFAULT_LAWS = ['근로기준법', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', '공공기관의 운영에 관한 법률'];
const DEFAULT_BY_TYPE = { 'local-gov': ['지방공무원법', '지방공무원 복무규정', '지방자치법'], 'central-ministry': ['국가공무원법', '국가공무원 복무규정', '행정절차법'] };
const norm = (s) => String(s || '').replace(/[ㆍ·\s_]/g, '');
const core = (s) => String(s || '').replace(/<[^>]*>|\[[^\]]*\]/g, '').replace(/\s+/g, '');
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const shift = (s, days) => { const d = new Date(`${ymd(s)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const minus30 = (s) => { const d = new Date(`${ymd(s)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };

export async function runRadar(ctx) {
  const { sources } = ctx.deps, input = ctx.input;
  // 법령을 고르지 않았으면 법제처에서 곧(최근) 시행되는 관련 법령 3개를 골라 쓰고, 그것도 안 되면 기관 유형별 기본 법령
  let picked = Array.isArray(input.laws) && input.laws.length ? input.laws : null;
  if (!picked && sources.lawGo?.enabled) { try { const sg = await suggestLaws(sources, { org_type: input.org_type, limit: 3 }); if (sg.items.length) { picked = sg.items.map((x) => x.law); ctx.log(`감시 법령 자동 선택(법제처 시행일 기준): ${picked.join(', ')}`); } } catch { /* 기본 법령으로 */ } }
  const laws = (picked || DEFAULT_BY_TYPE[input.org_type] || DEFAULT_LAWS).map((x) => String(x).slice(0, 60)).slice(0, 3);
  const items = [], errors = []; let lawAsOf = null;
  for (const law of laws) {
    await ctx.step(`판본 비교 · ${law}`, async (s) => {
      let rows;
      try { rows = (await sources.rest.search({ keyword: law, corpus: 'legal', all_versions: true, limit: 50 })).rows; } catch { errors.push(law); s.note('조회 실패(없다는 뜻 아님)'); return; }
      const key = norm(law);
      const vers = [...new Map(rows.filter((r) => norm(r.doc_title) === key).map((r) => [r.doc_id, { doc_id: r.doc_id, eff: String(r.effective_from || ''), state: r.edition_state }])).values()].sort((a, b) => a.eff.localeCompare(b.eff));
      const sched = vers.filter((v) => v.state === 'scheduled').slice(0, 2);
      // ALIO 판본 연혁에 시행예정 판본이 없으면 법제처 「시행일 기준 법령」 연혁에서 최근 90일~앞으로 180일 판본을 찾는다(시행령까지)
      let pairs = [], via = 'ALIO';
      if (sched.length) pairs = sched.map((sv) => ({ sv, prev: [...vers].reverse().find((v) => v.eff < sv.eff) })).filter((x) => x.prev).map(({ sv, prev }) => ({ eff: sv.eff, load: () => Promise.all([sources.loadDoc(sv.doc_id), sources.loadDoc(prev.doc_id)]) }));
      // 시행예정 판본은 있어도 비교할 앞 판본이 없으면(ALIO 연혁이 짧음) 법제처로 넘어간다
      if (!pairs.length && sources.lawGo?.enabled) {
        const today = kstToday(), lo = shift(today, -90), hi = shift(today, 180);
        for (const name of [law, `${law.replace(/\s*(시행령|시행규칙)$/, '')} 시행령`]) {
          let tl; try { tl = await sources.lawGo.timeline(name); } catch { errors.push(`${name} 연혁(법제처)`); continue; }
          if (tl.asOf) lawAsOf = Math.min(lawAsOf ?? tl.asOf, tl.asOf);
          const tgt = tl.filter((v) => v.eff >= lo && v.eff <= hi).slice(-2);
          pairs = tgt.map((v) => ({ v, prev: [...tl].reverse().find((p) => p.eff < v.eff) })).filter((x) => x.prev).map(({ v, prev }) => ({ eff: v.eff, load: () => Promise.all([sources.lawGo.textAt(v.mst, v.eff), sources.lawGo.textAt(prev.mst, prev.eff)]) }));
          if (pairs.length) { via = '법제처'; break; }
        }
      }
      if (!pairs.length) { s.note(`판본 ${vers.length}개 · 시행예정 판본 없음(검색 범위 내${sources.lawGo?.enabled ? ', 법제처 연혁 포함' : ''})`); return; }
      let found = 0;
      for (const { eff, load } of pairs) {
        const sv = { eff };
        let nd, od;
        try { [nd, od] = await load(); } catch { errors.push(`${law} 판본 원문`); s.note('판본 원문 조회 실패(없다는 뜻 아님)'); continue; }
        const oldBy = new Map(od.articles.filter((a) => a.section === '본칙' && a.ref).map((a) => [a.ref, a]));
        const addenda = nd.articles.filter((a) => a.section === '부칙').slice(0, 2).map((a) => `${a.ref || ''}(${a.title || ''}) ${clip(a.body, 160)}`).join(' / ');
        const changed = nd.articles.filter((a) => a.section === '본칙' && a.ref && core(oldBy.get(a.ref)?.body) !== core(a.body)).slice(0, 5);
        for (const a of changed) {
          const before = oldBy.get(a.ref)?.body || '', ch = numericChanges(before, a.body);
          const affected = [];
          // 지자체·부처는 자치법규·행정규칙(법제처) 본문에서 같은 주제를 찾는다
          const govT = input.org_type === 'local-gov' ? 'ordin' : input.org_type === 'central-ministry' ? 'admrul' : null;
          if (ch.length) {
            try {
              const r = govT ? { rows: await govArticles(sources, govT, a.title, { org: input.inst || null, keep: (x) => x.body.replace(/\s+/g, '').includes(a.title.replace(/\s+/g, '').slice(0, 4)) }) } : await sources.searchRegs({ keyword: a.title, corpus: 'bylaws', body: true, inst: input.inst || undefined, limit: 30 });
              for (const x of r.rows) { const jd = judge(x.body, ch, a.title, x.art_title || ''); if (jd.status !== 'reflected' && !/직접 정한 문장이 없습니다/.test(jd.reason)) affected.push({ inst: x.inst_name, doc_id: x.doc_id, doc_title: x.doc_title, ref: x.art_ref, title: x.art_title, status: jd.status, reason: jd.reason, excerpt: clip(x.body, 200), edition: editionLabel(x) }); }
            } catch { errors.push(`${law} ${a.ref} 영향 검색`); }
          }
          affected.sort((p, q) => (p.status === 'candidate' ? 0 : 1) - (q.status === 'candidate' ? 0 : 1));
          items.push({ via, law: nd.title || law, effective_from: sv.eff, ref: a.ref, title: a.title, before: clip(before, 400), after: clip(a.body, 400), changes: ch, kind: before ? '개정' : '신설', addenda, affected: affected.slice(0, 6) });
          found++;
        }
      }
      s.note(`${via} 판본 ${pairs.map((p) => ymd(p.eff)).join(', ')} 시행 · 바뀐 조문 ${found}개`);
    });
  }
  // 같은 날 시행되는 판본이 둘이면(같은 조문 같은 내용) 한 번만 적는다
  const seenIt = new Set(); for (let i = items.length - 1; i >= 0; i--) { const k = `${core(items[i].law)}|${items[i].ref}|${items[i].effective_from}|${core(items[i].after)}`; if (seenIt.has(k)) items.splice(i, 1); else seenIt.add(k); }
  items.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const plan = items.map((it) => `[${ymd(it.effective_from)} 시행] ${it.law} ${it.ref}(${it.title}) ${it.kind}${it.changes.length ? `: ${it.changes.map((c) => `${c.from}→${c.to}`).join(', ')}` : ''}\n  · 우리 규정 영향 ${it.affected.length}건(개정 후보 ${it.affected.filter((x) => x.status === 'candidate').length}) · ${it.effective_from <= kstToday() ? '이미 시행 중 — 바로 정비' : `착수 권장일 ${minus30(it.effective_from)}`}`).join('\n');
  const failLine = errors.length ? `\n\n⚠ 조회 실패: ${errors.join(', ')} — 해당 법령은 확인하지 못했습니다(없다는 뜻이 아님).` : '';
  return { kind: '시행예정 레이더', laws, items, errors, as_of: { law_go: lawAsOf, checked: Date.now() }, plan_text: (plan || '정비할 시행예정 조문을 찾지 못했습니다(검색 범위 내).') + failLine, note: items.length ? `${laws.length}개 법령 · 시행예정 조문 ${items.length}개 · 판본 연혁 기반(전수 아님)` : '검색 범위 내 시행예정 판본 없음 또는 바뀐 조문 없음' };
}

// 감시할 법령 제안: 법제처 「시행일 기준 법령」에서 최근 90일~앞으로 180일 사이에 시행되는(될) 판본을 모아,
// 기관 유형별로 기관 규정(복무·인사·보수·계약·정보공개 등)에 자주 영향을 주는 법령 순으로 고른다. 시행령·시행규칙은 모법으로 묶는다
const COMMON = [[/^근로기준법/, 9, '근로조건(취업규칙·복무)'], [/개인정보 보호법/, 5, '개인정보 처리'], [/공공기관의 정보공개/, 5, '정보공개'], [/청탁금지|부정청탁/, 5, '청탁금지'], [/이해충돌 방지/, 5, '이해충돌'], [/공직자윤리/, 4, '공직윤리'], [/행정절차법|행정기본법/, 4, '행정 절차'], [/공익신고자|부패방지/, 3, '신고·부패방지'], [/양성평등기본법|성희롱/, 3, '양성평등'], [/장애인고용촉진/, 3, '장애인 고용'], [/중대재해|산업안전보건법/, 4, '안전보건']];
const BY_TYPE = {
  'public-institution': [[/남녀고용평등/, 9, '휴가·육아(복무규정)'], [/기간제 및 단시간/, 7, '비정규직 근로조건'], [/최저임금법/, 6, '보수'], [/근로자퇴직급여/, 6, '퇴직급여'], [/공공기관의 운영/, 8, '공공기관 운영'], [/고용보험법/, 5, '육아휴직 급여 등'], [/노동조합 및 노동관계/, 5, '노사관계'], [/국가를 당사자로 하는 계약/, 5, '계약'], [/임금채권/, 3, '임금'], [/근로자참여/, 4, '노사협의회']],
  'central-ministry': [[/^국가공무원법/, 9, '공무원 인사'], [/^국가공무원 복무규정/, 9, '복무'], [/^공무원보수규정|공무원수당/, 7, '보수·수당'], [/공무원임용령/, 6, '임용'], [/공무원 여비/, 5, '여비'], [/공무원연금/, 4, '연금'], [/정부조직법|행정기관의 조직과 정원/, 6, '조직·정원'], [/국가재정법/, 5, '예산'], [/국가를 당사자로 하는 계약/, 5, '계약'], [/민원 처리/, 4, '민원'], [/전자정부법/, 3, '전자정부'], [/남녀고용평등/, 4, '공무직 휴가·육아'], [/공무원 인재개발/, 3, '교육훈련']],
  'local-gov': [[/^지방공무원법/, 9, '공무원 인사'], [/지방공무원 복무규정/, 9, '복무'], [/지방공무원 보수규정|지방공무원 수당/, 7, '보수·수당'], [/지방공무원 임용령/, 6, '임용'], [/^지방자치법/, 8, '조례·규칙 제정'], [/지방재정법|지방회계법/, 5, '재정·회계'], [/지방자치단체를 당사자로 하는 계약/, 5, '계약'], [/지방자치분권/, 4, '자치분권'], [/지방공기업법/, 3, '지방공기업'], [/민원 처리/, 4, '민원'], [/공무원 여비/, 4, '여비'], [/남녀고용평등/, 4, '공무직 휴가·육아']],
};
const SKIP = /직제|군인|군무원|병역|법원|선거관리|소방|경찰|해양경찰|교육공무원|특수교육|국회|헌법재판|감사원/;
const baseName = (n) => String(n).replace(/\s*(시행령|시행규칙)$/, '');
export async function suggestLaws(sources, { org_type = 'public-institution', today = kstToday(), limit = 12 } = {}) {
  if (!sources.lawGo?.enabled) return { items: [], note: '법제처 연결이 없어 제안할 수 없습니다. 법령명을 직접 넣어 주세요.', disabled: true };
  const rules = [...(BY_TYPE[org_type] || BY_TYPE['public-institution']), ...COMMON];
  // 앞으로 시행될 것은 모두, 최근 시행된 것은 가까운 순으로(쪽 수 제한) 모은다
  const [ahead, past] = await Promise.all([sources.lawGo.effective(today, shift(today, 180), { pages: 12 }), sources.lawGo.effective(shift(today, -90), shift(today, -1), { pages: 8, sort: 'efdes' })]);
  const rows = [...ahead, ...past];
  const other = org_type === 'local-gov' ? /^국가공무원|^공무원(보수|수당|임용)/ : org_type === 'central-ministry' ? /^지방/ : null;
  const by = new Map();
  for (const r of rows) {
    if (!r.name || SKIP.test(r.name) || (other && other.test(r.name)) || /^(총리령|.*부령|.*규칙)$/.test(r.kind) && !/시행규칙$/.test(r.name)) continue;
    const base = baseName(r.name), hit = rules.find(([re]) => re.test(base)); if (!hit) continue;
    const g = by.get(base) || { law: base, weight: hit[1], why: hit[2], versions: [] };
    if (!g.versions.some((v) => v.name === r.name && v.eff === r.eff)) g.versions.push({ name: r.name, kind: r.kind, eff: r.eff, anc: r.anc, change: r.change, dept: r.dept });
    by.set(base, g);
  }
  const items = [...by.values()].map((g) => {
    g.versions.sort((a, b) => a.eff.localeCompare(b.eff));
    const next = g.versions.find((v) => v.eff >= today), last = [...g.versions].reverse().find((v) => v.eff < today);
    const pick = next || last;
    // 직접 개정(일부·전부개정)이 타법개정보다, 곧 시행되는 것이 오래 전 시행된 것보다 우선
    const direct = g.versions.some((v) => /일부개정|전부개정|제정/.test(v.change));
    const score = g.weight + (direct ? 2 : 0) + (next ? 1 : 0);
    return { law: g.law, why: g.why, eff: pick.eff, state: next ? 'scheduled' : 'recent', change: pick.change, kinds: [...new Set(g.versions.map((v) => v.kind))], versions: g.versions.slice(0, 6), score };
  }).sort((a, b) => b.score - a.score || a.eff.localeCompare(b.eff)).slice(0, limit);
  return { items, as_of: Math.min(ahead.asOf ?? Date.now(), past.asOf ?? Date.now()), note: `법제처 시행일 기준 법령 ${rows.length}건(${ymd(shift(today, -90))}~${ymd(shift(today, 180))}) 중 기관 규정과 관련이 큰 법령 ${items.length}개` };
}
