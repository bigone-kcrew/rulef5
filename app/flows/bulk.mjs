// B2 일괄 개정: 여러 규정의 같은 낱말을 한꺼번에 바꾼다(지점별 사람 승인, 조사 자동 보정, 부칙·「」·고유 명칭(○○의 날)·바꿀 말의 정의 문장 제외)
import { josa, buildComparison, esc } from '../lib/table.mjs';
import { checkDocs } from './check.mjs';
import { fail, LAW_OFF } from './common.mjs';
import { clip, normalizeArticle } from '../lib/text.mjs';
import { consolidatedDoc } from './docset.mjs';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// 바뀐 낱말 뒤 조사를 받침에 맞춘다
const PAIRS = [['이란', '란'], ['이라', '라'], ['은', '는'], ['이', '가'], ['을', '를'], ['과', '와'], ['으로', '로'], ['이다', '다'], ['이며', '며'], ['이고', '고'], ['이나', '나']];
const PARTICLE = /^(으로써|으로서|으로|에게서|에게|에서|부터|까지|이라|이란|이며|이고|이나|이다|라|란|은|는|이|가|을|를|과|와|의|에|로|도|만|및|며|고|나|다)/;
export function swapWord(word, find, replace) {
  const rest = word.slice(find.length);
  const m = rest.match(PARTICLE); if (!m) return replace + rest;
  const p = m[1], tail = rest.slice(p.length);
  const pair = PAIRS.find(([a, b]) => p === a || p === b);
  if (!pair) return replace + rest;
  const last = replace.slice(-1).charCodeAt(0), jong = last >= 0xac00 && last <= 0xd7a3 ? (last - 0xac00) % 28 : 0;
  let np = jong ? pair[0] : pair[1];
  if (pair[0] === '으로' && jong === 8) np = '로'; // ㄹ 받침은 '로'
  return replace + np + tail;
}
// 조사가 이어 붙어도(「에게는」「에서도」) 조사만이면 합성어가 아니다
const PARTICLE_ONLY = new RegExp(`^(?:${PARTICLE.source.slice(2, -1)})*[,.)」\\s]*$`);
// 바꾸면 안 되는 고유 명칭(법정 기념일 등)
const FIXED = ['의 날', '의날'];

export function findPoints(doc, find, replace) {
  const out = [];
  for (const a of doc.articles) {
    if (a.section === '부칙') continue;
    const body = a.body; let i = -1;
    const quoted = []; for (const m of body.matchAll(/[「｢][^」｣]*[」｣]/g)) quoted.push([m.index, m.index + m[0].length]);
    let from = 0;
    while ((i = body.indexOf(find, from)) >= 0) {
      from = i + find.length;
      if (quoted.some(([s, e]) => i >= s && i < e)) continue;
      if (FIXED.some((f) => body.startsWith(f, i + find.length))) continue; // 「근로자의 날」
      // 바꿀 말 자체를 정의하는 문장(「"직원"이란 … 근로자를 말한다」)에서 바꾸면 순환 정의가 된다
      const sent = body.slice(Math.max(0, body.lastIndexOf('\n', i) + 1, body.lastIndexOf('. ', i) + 1), (body.indexOf('\n', i) + 1 || body.length + 1) - 1);
      if (new RegExp(`["“'‘]${replace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["”'’]\\s*(?:이)?(?:란|라 함은|이라 함은)`).test(sent)) continue;
      const wordEnd = (() => { let j = i + find.length; while (j < body.length && /[가-힣]/.test(body[j])) j++; return j; })();
      const word = body.slice(i, wordEnd), before = body[i - 1] || '';
      const compound = /[가-힣]/.test(before) || !PARTICLE_ONLY.test(word.slice(find.length));
      const paraIdx = [...body.slice(0, i)].filter((c) => CIRCLED.includes(c)).length;
      out.push({ id: `${doc.doc_id}#${a.ref || a.title}#${i}`, doc_id: doc.doc_id, ref: a.ref || a.title, section: a.section, para: paraIdx ? CIRCLED[paraIdx - 1] : '', index: i, word, newWord: compound ? replace + word.slice(find.length) : swapWord(word, find, replace), compound, context: clip(body.slice(Math.max(0, i - 20), wordEnd + 20), 60) });
    }
  }
  return out;
}

export async function runBulk(ctx) {
  const { sources } = ctx.deps, input = ctx.input;
  const find = String(input.find || '').trim(), replace = String(input.replace || '').trim();
  if (!find || !replace || find.length > 30 || replace.length > 30 || find === replace) throw fail('bad_input', '찾을 말과 바꿀 말(30자 이내)을 입력해 주세요.');
  const docs = await ctx.step('규정 묶음 불러오기', async (s) => {
    let ids = (Array.isArray(input.doc_ids) ? input.doc_ids : []).slice(0, 30);
    // 지자체·부처: 법제처 본문 검색으로 그 기관 자치법규·행정규칙 중 바꿀 낱말이 든 것
    const govT = input.org_type === 'local-gov' ? 'ordin' : input.org_type === 'central-ministry' ? 'admrul' : null;
    if (!ids.length && input.inst && govT) { if (!sources.gov?.enabled) throw fail('law_go_disabled', LAW_OFF, 400); ids = (await sources.gov.search({ target: govT, keyword: find, pages: 3, org: String(input.inst).slice(0, 60) })).map((x) => x.doc_id).slice(0, 30); }
    if (!ids.length && input.inst && !govT) ids = [...new Set((await sources.searchRegs({ keyword: find, inst: String(input.inst).slice(0, 60), corpus: 'bylaws', body: true, limit: 50 })).rows.map((x) => x.doc_id))].slice(0, 30);
    if (!ids.length) throw fail('bad_input', '대상 규정을 고르거나 기관명을 입력해 주세요.');
    const list = []; for (const id of ids) { try { list.push(await sources.loadDoc(id)); } catch { ctx.log(`${id} 불러오기 실패`); } }
    if (!list.length) throw fail('source_unavailable', '규정을 불러오지 못했습니다.', 502);
    s.note(`${list.length}개 규정`); return list;
  });
  const points = await ctx.step('바꿀 곳 찾기', async (s) => { const p = docs.flatMap((d) => findPoints(d, find, replace)); s.note(`${p.length}곳(합성어 의심 ${p.filter((x) => x.compound).length}곳은 기본 해제) · 부칙·「」 안·「○○의 날」·바꿀 말을 정의하는 문장 제외`); return p; });
  if (!points.length) return { kind: '일괄개정', per_doc: [], docset: null, note: `"${find}"을(를) 찾지 못했습니다(본칙·별표, 「」 밖).` };
  const title = (id) => docs.find((d) => d.doc_id === id)?.title;
  const approved = new Set(input.auto ? points.filter((p) => !p.compound).map((p) => p.id) : [].concat(await ctx.gate({ id: 'pick_points', prompt: '바꿀 곳을 확인하세요(합성어 의심은 해제되어 있습니다).', multi: true, options: points.slice(0, 200).map((p) => ({ doc_id: p.doc_id, ref: p.ref, value: p.id, label: `${title(p.doc_id)} ${p.ref}${p.para}: ${p.word} → ${p.newWord}${p.compound ? ' (합성어 의심)' : ''}`, detail: p.context, checked: !p.compound })) }) || []));
  return ctx.step('개정문·대비표', async (s) => {
    const per = [];
    for (const d of docs) {
      const pts = points.filter((p) => p.doc_id === d.doc_id && approved.has(p.id)); if (!pts.length) continue;
      const changes = [];
      for (const a of d.articles) {
        if (a.section === '부칙') continue;
        const ap = pts.filter((p) => p.ref === (a.ref || a.title) && p.section === a.section).sort((x, y) => y.index - x.index); if (!ap.length) continue;
        let body = a.body; for (const p of ap) body = body.slice(0, p.index) + p.newWord + body.slice(p.index + p.word.length);
        changes.push({ op: 'amend', ref: a.ref || a.title, section: a.section, title: a.title || '', old: a.body, new: body, points: ap.reverse() });
      }
      // 위치 특정형 개정문: 조·항별로 "…" 중 "A"를 "B"로
      const lines = changes.map((c) => { const byPara = new Map(); for (const p of c.points) { const k = p.para; if (!byPara.has(k)) byPara.set(k, new Map()); const m = byPara.get(k); m.set(`${p.word}→${p.newWord}`, (m.get(`${p.word}→${p.newWord}`) || 0) + 1); } return [...byPara].map(([para, m], i) => `${i === 0 ? `${c.ref}${para ? `제${CIRCLED.indexOf(para) + 1}항` : ''}` : `같은 조${para ? ` 제${CIRCLED.indexOf(para) + 1}항` : ''}`} 중 ${[...m].map(([k, n]) => { const [o, nw] = k.split('→'); return `"${o}"${josa(o, '을', '를')} ${n > 1 ? '각각 ' : ''}"${nw}"${josa(nw, '으로', '로')}`; }).join(', ')}`).join(' 하고, ') + ' 한다.'; });
      per.push({ doc_id: d.doc_id, title: d.title, changes, directive: `「${d.title}」 일부를 다음과 같이 개정한다.\n\n${lines.join('\n')}` });
    }
    const virtual = docs.map((d) => { const p = per.find((x) => x.doc_id === d.doc_id); return p ? { ...d, articles: d.articles.map((a) => { const c = a.section !== '부칙' && p.changes.find((x) => x.ref === (a.ref || a.title) && x.section === a.section); return c ? { ...a, body: c.new } : a; }) } : d; });
    const recheck = checkDocs(virtual, {}).filter((f) => f.type === 'term' || f.type === 'broken_ref').filter((f) => per.some((p) => p.doc_id === f.doc_id));
    const draft = per.map((p) => p.directive).join('\n\n───\n\n');
    const rows = per.flatMap((p) => buildComparison(p.changes.map((c) => ({ ...c, ref: c.ref, title: `${c.title}` }))).map((r, i) => (i === 0 ? { ...r, oldHtml: `<u>[${esc(p.title)}]</u><br>${r.oldHtml}` } : r)));
    const checks = [`"${find}" → "${replace}" ${per.reduce((n, p) => n + p.changes.reduce((m, c) => m + c.points.length, 0), 0)}곳 변경(${per.length}개 규정)`, `미승인(합성어 의심 등) ${points.length - [...approved].length}곳은 그대로 두었습니다.`, ...(points.length > 200 ? [`바꿀 곳이 ${points.length}곳이라 승인 목록에는 앞 200곳만 보였습니다. 나머지는 규정을 나눠 다시 실행하세요.`] : []), ...recheck.map((f) => `재검증: ${f.doc_title} ${f.ref} ${f.message}`), '부칙·연혁의 과거 명칭과 「」 안 법령명은 바꾸지 않았습니다.'];
    s.note(`${per.length}개 규정 · ${per.reduce((n, p) => n + p.changes.length, 0)}개 조문${recheck.length ? ` · 재검증 문제 ${recheck.length}건` : ''}`);
    // 규정별 개정 후 전문(바꾼 문구를 반영한 전체 본문, 바뀐 조문 표시)
    const fullText = per.map((p) => consolidatedDoc({ doc: virtual.find((d) => d.doc_id === p.doc_id), changes: p.changes.filter((c) => c.section === '본칙'), normalize: normalizeArticle })).join('\n\n════════\n\n');
    const sections = [{ id: 'draft', title: '일괄 개정문', body: draft }, { id: 'comparison', title: '신구조문대비표(규정별)', rows }, { id: 'full_text', title: '개정 후 전문(규정별)', body: fullText }, { id: 'checklist', title: '검토 체크리스트', body: checks.map((x) => `☐ ${x}`).join('\n') }];
    return { kind: '일괄개정', per_doc: per.map(({ changes, ...p }) => ({ ...p, n: changes.length })), docset: { kind: '일괄개정', title: `${find}→${replace} 일괄 개정`, sections, evidence: docs.map((d) => ({ label: d.title, doc_id: d.doc_id })) }, docKeys: ['draft', 'comparison', 'checklist'] };
  });
}
