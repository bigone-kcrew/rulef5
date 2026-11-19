// C2 시행예정 법령 레이더: 시행예정 판본을 바로 앞 판본과 조문 단위로 비교 → 영향받는 기관 규정 → 정비 계획서
import { numericChanges, judge } from './impact.mjs';
import { clip } from '../lib/text.mjs';
import { editionLabel } from './common.mjs';
import { govArticles } from './common.mjs';

// 기관 유형별 기본 감시 법령
const DEFAULT_LAWS = ['근로기준법', '남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률', '공공기관의 운영에 관한 법률'];
const DEFAULT_BY_TYPE = { 'local-gov': ['지방공무원법', '지방공무원 복무규정', '지방자치법'], 'central-ministry': ['국가공무원법', '국가공무원 복무규정', '행정절차법'] };
const norm = (s) => String(s || '').replace(/[ㆍ·\s_]/g, '');
const core = (s) => String(s || '').replace(/<[^>]*>|\[[^\]]*\]/g, '').replace(/\s+/g, '');
const ymd = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const minus30 = (s) => { const d = new Date(`${ymd(s)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); };

export async function runRadar(ctx) {
  const { sources } = ctx.deps, input = ctx.input;
  const laws = (Array.isArray(input.laws) && input.laws.length ? input.laws : (DEFAULT_BY_TYPE[input.org_type] || DEFAULT_LAWS)).map((x) => String(x).slice(0, 60)).slice(0, 3);
  const items = [], errors = [];
  for (const law of laws) {
    await ctx.step(`판본 비교 · ${law}`, async (s) => {
      let rows;
      try { rows = (await sources.rest.search({ keyword: law, corpus: 'legal', all_versions: true, limit: 50 })).rows; } catch { errors.push(law); s.note('조회 실패(없다는 뜻 아님)'); return; }
      const key = norm(law);
      const vers = [...new Map(rows.filter((r) => norm(r.doc_title) === key).map((r) => [r.doc_id, { doc_id: r.doc_id, eff: String(r.effective_from || ''), state: r.edition_state }])).values()].sort((a, b) => a.eff.localeCompare(b.eff));
      const sched = vers.filter((v) => v.state === 'scheduled').slice(0, 2);
      if (!sched.length) { s.note(`판본 ${vers.length}개 · 시행예정 판본 없음(검색 범위 내)`); return; }
      let found = 0;
      for (const sv of sched) {
        const prev = [...vers].reverse().find((v) => v.eff < sv.eff); if (!prev) continue;
        let nd, od;
        try { [nd, od] = [await sources.loadDoc(sv.doc_id), await sources.loadDoc(prev.doc_id)]; } catch { errors.push(`${law} 판본 원문`); s.note('판본 원문 조회 실패(없다는 뜻 아님)'); continue; }
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
          items.push({ law: nd.title || law, effective_from: sv.eff, ref: a.ref, title: a.title, before: clip(before, 400), after: clip(a.body, 400), changes: ch, kind: before ? '개정' : '신설', addenda, affected: affected.slice(0, 6) });
          found++;
        }
      }
      s.note(`시행예정 판본 ${sched.map((v) => ymd(v.eff)).join(', ')} · 바뀐 조문 ${found}개`);
    });
  }
  items.sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const plan = items.map((it) => `[${ymd(it.effective_from)} 시행] ${it.law} ${it.ref}(${it.title}) ${it.kind}${it.changes.length ? `: ${it.changes.map((c) => `${c.from}→${c.to}`).join(', ')}` : ''}\n  · 우리 규정 영향 ${it.affected.length}건(개정 후보 ${it.affected.filter((x) => x.status === 'candidate').length}) · 착수 권장일 ${minus30(it.effective_from)}`).join('\n');
  const failLine = errors.length ? `\n\n⚠ 조회 실패: ${errors.join(', ')} — 해당 법령은 확인하지 못했습니다(없다는 뜻이 아님).` : '';
  return { kind: '시행예정 레이더', laws, items, errors, plan_text: (plan || '정비할 시행예정 조문을 찾지 못했습니다(검색 범위 내).') + failLine, note: items.length ? `${laws.length}개 법령 · 시행예정 조문 ${items.length}개 · 판본 연혁 기반(전수 아님)` : '검색 범위 내 시행예정 판본 없음 또는 바뀐 조문 없음' };
}
