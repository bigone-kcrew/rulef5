// C3 단체협약 정합성: 같은 주제에 대해 규정(안)과 우리 기관 단체협약의 수치가 다른 곳을 표시(유불리 판정 없음)
const NUM = /(\d+(?:\.\d+)?)\s*(일|주|개월|년|시간|회|%|만원|원|세)/g;
const vals = (s) => [...new Set([...String(s || '').matchAll(NUM)].map((m) => m[1] + m[2]))];
const topicSentences = (text, topic) => { const w = String(topic).split(/\s+/).filter((x) => x.length >= 2); return String(text || '').split(/(?<=[.다])\s+|\n|(?=[①②③④⑤⑥⑦⑧⑨⑩])/).filter((s) => w.length && w.every((x) => s.includes(x))).join(' '); };
const year = (r) => +((String(r.rel_path || '') + ' ' + r.doc_title).match(/(20\d{2})/g) || ['0']).sort().at(-1);

export async function caConflicts(sources, { inst, topic, items }) {
  if (!inst || !topic) return { rows: [], errors: [], searched: false };
  let rows;
  // 주제어 그대로 → 긴 낱말을 두 글자로 줄인 변형("배우자 출산휴가" → "배우자 출산") 순서로 찾는다(협약은 표·호 목록에 적힌 경우가 많다)
  const variants = [...new Set([topic, topic.split(/\s+/).map((w) => (w.length >= 4 ? w.slice(0, 2) : w)).join(' ')])];
  const own = (rs) => rs.filter((r) => r.inst_name === inst && !/대비표|근거|신구/.test(r.doc_title || ''));
  let cands = [];
  try { for (const q of variants) { rows = (await sources.searchRegs({ corpus: 'ca', inst, keyword: q, body: true, limit: 30 })).rows || []; cands = own(rows); if (cands.length) break; } } catch { return { rows: [], errors: ['단체협약 조회'], searched: false }; }
  if (!cands.length) {
    // 협약 자체가 있는지 확인해 「협약 없음」과 「협약에 이 주제 없음」을 구분한다
    let any = []; try { any = own((await sources.searchRegs({ corpus: 'ca', inst, keyword: '단체협약', limit: 10 })).rows || []); } catch { /* 확인 못 함 */ }
    const latest = any.sort((a, b) => year(b) - year(a))[0];
    return { rows: [], errors: [], searched: true, ca: null, ca_exists: latest ? { doc_id: latest.doc_id, title: latest.doc_title } : null };
  }
  const latestId = cands.sort((a, b) => year(b) - year(a))[0].doc_id;
  const ca = cands.filter((r) => r.doc_id === latestId);
  const out = [];
  for (const it of items) {
    const pv = vals(topicSentences(it.text, topic)); if (!pv.length) continue;
    for (const r of ca) {
      const cv = vals(topicSentences(r.body, topic)); if (!cv.length) continue;
      const units = new Set(pv.map((v) => v.replace(/[\d.]/g, '')));
      const diff = cv.filter((v) => units.has(v.replace(/[\d.]/g, '')) && !pv.includes(v));
      if (diff.length) out.push({ ref: it.ref, ca_doc_id: r.doc_id, ca_title: r.doc_title, ca_ref: r.art_ref, ca_excerpt: topicSentences(r.body, topic).slice(0, 220), plan_values: pv, ca_values: diff, note: '값 상이 — 단체협약 확인 필요(근로기준법 제96조: 취업규칙은 단체협약에 어긋날 수 없음). 협약 판본은 폴더 연도 기준 근사.' });
    }
  }
  return { rows: out, errors: [], searched: true, ca: { doc_id: latestId, title: ca[0].doc_title } };
}
export const caTable = (r) => r.rows.length ? r.rows.map((x) => `${x.ref} · 규정(안) ${x.plan_values.join(', ')} ↔ 협약 「${x.ca_title}」 ${x.ca_ref || ''} ${x.ca_values.join(', ')}\n  ${x.ca_excerpt}\n  ⚠ ${x.note}`).join('\n\n') : (r.errors.length ? `단체협약 조회 실패 — 다시 확인하세요.` : r.ca ? `단체협약 「${r.ca.title}」과 수치가 다른 조문을 찾지 못했습니다(같은 주제 문장 기준).` : r.ca_exists ? `단체협약 「${r.ca_exists.title}」에서 이 주제를 정한 조문을 찾지 못했습니다. 협약 원문(휴가·경조사 표 등)을 직접 확인하세요.` : '이 기관의 단체협약을 ALIO에서 찾지 못했습니다(검색 범위 내).');
