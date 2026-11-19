// 법령 단위 확장: 법률 조문의 위임 문구 → 시행령·시행규칙의 해당 조문 → 그 조문을 따르는 기관 규정
import { clip } from '../lib/text.mjs';
import { fail, editionLabel, dedupeEditions, govArticles, govTarget } from './common.mjs';

const DELEG = [[/대통령령으로\s*정/, '시행령'], [/(총리령|[가-힣]+부령)으로\s*정/, '시행규칙'], [/조례로\s*정/, '자치법규'], [/(규칙)으로\s*정/, '시행규칙'], [/정하여\s*고시|고시로\s*정/, '고시']];
export function findDelegations(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) for (const [re, level] of DELEG) if (re.test(line)) { out.push({ level, text: line.trim() }); break; }
  return out;
}

// 법률·시행령·시행규칙을 한 묶음(3단 체계)으로 찾는다
const nt = (s) => String(s || '').replace(/[ㆍ·\s_]/g, '');
export async function lawFamily(sources, name) {
  const q = String(name || '').trim().slice(0, 80);
  if (!q) throw fail('bad_input', '법령 이름을 입력해 주세요.');
  const r = await sources.searchLaw(q.replace(/\s*(시행령|시행규칙)$/, ''), { targets: ['law'], limit: 8 });
  if (!r.rows.length && r.errors?.length) throw fail('source_unavailable', `법령 조회에 실패했습니다(${r.errors.join('·')}). 잠시 뒤 다시 시도하세요.`, 502);
  const baseOf = (t) => nt(t).replace(/(시행령|시행규칙)$/, '');
  const bases = [...new Set(r.rows.map((x) => baseOf(x.title)))];
  const want = baseOf(q);
  const base = bases.find((b) => b === want) || bases.find((b) => b.includes(want) || want.includes(b)) || bases[0] || null;
  const pick = (suffix) => { const c = r.rows.filter((x) => nt(x.title) === base + suffix); return c.find((x) => x.source === '법제처') || c[0] || null; };
  const tiers = base ? { law: pick(''), decree: pick('시행령'), rule: pick('시행규칙') } : { law: null, decree: null, rule: null };
  // 시행령이 따로 없는 법(국가공무원법·지방공무원법 등)은 같은 이름으로 시작하는 대통령령(「지방공무원 복무규정」 등)을 하위 법령으로 찾는다
  if (base && !tiers.decree && sources.lawGo?.enabled) {
    const stem = (tiers.law?.title || q).replace(/\s*법$/, '').trim();
    try {
      const r2 = await sources.searchLaw(stem, { targets: ['law'], limit: 10 });
      const subs = r2.rows.filter((x) => x.source === '법제처' && nt(x.title).startsWith(nt(stem)) && nt(x.title) !== base && /대통령령/.test(x.kind || '') );
      if (subs.length) { tiers.decree = subs.find((x) => /복무/.test(x.title)) || subs[0]; tiers.decree_more = subs.filter((x) => x !== tiers.decree).slice(0, 5).map((x) => ({ title: x.title, doc_id: x.doc_id })); }
    } catch { /* 하위 법령을 못 찾으면 비워 둔다 */ }
  }
  const others = []; for (const x of r.rows) if (baseOf(x.title) !== base && !others.some((o) => baseOf(o.title) === baseOf(x.title))) others.push({ title: x.title.replace(/\s*(시행령|시행규칙)$/, ''), doc_id: x.doc_id });
  return { base: tiers.law?.title || (base ? r.rows.find((x) => baseOf(x.title) === base)?.title.replace(/\s*(시행령|시행규칙)$/, '') : null), tiers, others, errors: r.errors || [] };
}

export async function runLawChain(ctx) {
  const { sources } = ctx.deps, input = ctx.input;
  const { law, art } = await ctx.step('법령 조문 확인', async (s) => {
    let id = input.law_doc_id;
    if (!id && input.law_name) { const r = await sources.searchLaw(String(input.law_name).slice(0, 80), { targets: ['law'], limit: 3 }); id = (r.rows.find((x) => x.source === '법제처') || r.rows[0])?.doc_id; if (!id && r.errors?.length) throw fail('source_unavailable', `법령 조회에 실패했습니다(${r.errors.join('·')}). 잠시 후 다시 시도하세요.`, 502); if (!id) throw fail('not_found', `'${input.law_name}' 법령을 찾지 못했습니다.`, 404); }
    if (!id) throw fail('bad_input', '법령을 선택하거나 법령명을 입력해 주세요.');
    const law = await sources.loadDoc(id), art = law.articles.find((a) => a.ref === input.ref && a.section === '본칙');
    if (!art) throw fail('unknown_ref', `${law.title}에서 ${input.ref || '조문'}을 찾지 못했습니다.`);
    s.note(`${law.title} ${art.ref}(${art.title})`); s.evidence({ label: `${law.title} ${art.ref}`, doc_id: law.doc_id, ref: art.ref, edition: editionLabel(law) });
    return { law, art };
  });
  const dels = await ctx.step('위임 문구 탐지', async (s) => { const d = findDelegations(art.body); s.note(d.length ? d.map((x) => `[${x.level}] ${x.text}`).join('\n') : '위임 문구 없음 — 하위 법령은 조 번호 인용으로만 찾습니다.'); return d; });
  const chainErrors = [];
  const chain = [{ level: '법률', doc_id: law.doc_id, doc_title: law.title, ref: art.ref, title: art.title, excerpt: clip(art.body, 300) }];
  const base = law.title.replace(/\s*(시행령|시행규칙)$/, '');
  await ctx.step('하위 법령 탐색', async (s) => {
    const failed = [];
    const want = [...new Set(['시행령', '시행규칙', ...dels.map((d) => d.level).filter((l) => ['시행령', '시행규칙'].includes(l))])];
    const cite = new RegExp(`법\\s*${art.ref.replace(/의/, '\\s*의\\s*')}(?![의\\d])`);
    for (const level of want) {
      try {
        const given = level === '시행령' ? input.decree_doc_id : input.rule_doc_id;
        const r = given ? { rows: [{ doc_id: given, title: `${base} ${level}` }], errors: [] } : await sources.searchLaw(`${base} ${level}`, { targets: ['law'], limit: 3 });
        const hit = r.rows.find((x) => x.title?.replace(/\s+/g, '') === base.replace(/\s+/g, '') + level); // 정확히 「법령명 + 시행령/시행규칙」만
        if (!hit) { ctx.log(r.errors?.length ? `${level} 조회 실패(${r.errors.join('·')}) — 없다는 뜻이 아닙니다.` : `${level}을(를) 찾지 못했습니다.`); if (r.errors?.length) failed.push(level); continue; }
        const d = await sources.loadDoc(hit.doc_id);
        for (const a of d.articles.filter((x) => x.section === '본칙' && x.ref && cite.test(x.body))) chain.push({ level, doc_id: d.doc_id, doc_title: d.title, ref: a.ref, title: a.title, excerpt: clip(a.body, 300) });
      } catch (e) { ctx.log(`${level} 조회 실패: ${e.message}`); }
    }
    if (failed.length) chainErrors.push(...failed);
    s.note(`${failed.length ? `⚠ ${failed.join('·')} 조회 실패 · ` : ''}시행령 ${chain.filter((c) => c.level === '시행령').length}개 · 시행규칙 ${chain.filter((c) => c.level === '시행규칙').length}개 조문이 ${art.ref}를 인용`);
  });
  await ctx.step('기관 규정 영향', async (s) => {
    const norm = (x) => String(x || '').replace(/[ㆍ·]/g, '·');
    const head = norm(base).slice(0, 6), titleCore = art.title.replace(/\s+/g, '').slice(0, 5);
    const seen = new Set();
    const queries = [norm(base).slice(0, 10), base.replace(/[ㆍ·]/g, 'ㆍ').slice(0, 10), art.title];
    for (const q of [...new Set(queries)]) {
      try {
        // 지자체는 자치법규, 부처는 행정규칙(법제처)에서 찾는다
        const r = govTarget(input.org_type) ? { rows: await govArticles(sources, govTarget(input.org_type), q, { org: input.inst || null, maxDocs: 6 }) } : await sources.searchRegs({ keyword: q, corpus: 'bylaws', body: true, inst: input.inst || undefined, limit: 40 });
        for (const x of r.rows) {
          const body = norm(x.body), k = x.doc_id + x.art_ref;
          // 이 조문과 직접 닿는 것만: 법령명과 조 번호를 함께 적었거나, 조문 제목(예: 연차 유급휴가)을 다루는 조문
          const flat = body.replace(/\s+/g, ''), refFlat = art.ref;
          const strong = (body.includes(head) && new RegExp(`${refFlat}(?![의\\d])`).test(flat)) || flat.includes(titleCore) || norm(x.art_title).replace(/\s+/g, '').includes(titleCore.slice(0, 4));
          if (seen.has(k) || !strong) continue;
          seen.add(k); chain.push({ level: '기관 규정', doc_id: x.doc_id, doc_title: `${x.inst_name} ${x.doc_title}`, ref: x.art_ref, title: x.art_title || '', excerpt: clip(x.body, 300), edition: editionLabel(x) });
        }
      } catch { ctx.log(`기관 규정 검색 실패: ${q}`); chainErrors.push('기관 규정 검색'); }
    }
    if (!govTarget(input.org_type) && sources.mcp?.enabled && /^legal:/.test(law.doc_id) && input.inst) {
      const rel = await sources.related({ doc_id: law.doc_id, art_no: art.no, art_sub: art.sub || undefined, direction: 'incoming', corpus: 'bylaws', inst: input.inst, limit: 30 });
      for (const x of (rel?.incoming || []).filter((y) => y.art_ref)) { const k = x.doc_id + (x.art_ref || ''); if (!seen.has(k)) { seen.add(k); chain.push({ level: '기관 규정', doc_id: x.doc_id, doc_title: x.doc_title || x.doc_id, ref: x.art_ref, title: x.art_title || '', excerpt: clip(x.body || '', 300), via: 'MCP' }); } }
    }
    // 같은 규정의 옛 판본을 뺀 뒤 개수를 적는다(진행 표시와 목록 수가 같게)
    { const kept = new Set(dedupeEditions(chain.filter((c) => c.level === '기관 규정').map((c) => ({ ...c, inst_name: c.doc_title.split(' ')[0], doc_title: c.doc_title, art_ref: c.ref, doc_date: (String(c.doc_id).match(/(\d{8})\.md$/) || [])[1] })), {}).map((c) => c.doc_id + c.ref)); for (let i = chain.length - 1; i >= 0; i--) if (chain[i].level === '기관 규정' && (!chain[i].ref || !kept.has(chain[i].doc_id + chain[i].ref))) chain.splice(i, 1); }
    s.note(`기관 규정 ${chain.filter((c) => c.level === '기관 규정').length}개 조문(법령명·조문 제목 언급으로 찾은 근사 결과)`);
  });
  return { kind: '법령 단위 확장', errors: [...new Set(chainErrors)], law: { doc_id: law.doc_id, title: law.title, ref: art.ref }, delegations: dels, chain };
}
