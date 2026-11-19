// 법령 조문의 판본 연혁(ALIO 법령 코퍼스)에서 현행과 직전 변경본을 찾아 개정 전·후 조문을 돌려준다
const norm = (s) => String(s || '').replace(/[ㆍ·\s_]/g, '');
const core = (s) => String(s || '').replace(/<[^>]*>|\[[^\]]*\]/g, '').replace(/\s+/g, '');

export async function lawVersions(sources, { name, ref, topic = '' }) {
  if (!name || !/^제\d+조(의\d+)?$/.test(String(ref || '').replace(/\s/g, ''))) throw Object.assign(new Error('법령명과 조문 번호(예: 제18조의2)를 입력해 주세요.'), { status: 400, code: 'bad_input' });
  const key = norm(name).replace(/(법률|법)$/, '');
  // 조문이 많은 법은 법령명만으로는 해당 조문이 상위 50건에 들지 않으므로 조문 번호·주제를 함께 넣어 차례로 검색한다
  const seen = new Map(); let r = { rows: [], degraded: false };
  for (const q of [...new Set([`${name} ${ref}`, topic ? `${topic}` : null, `${ref} ${name.slice(0, 8)}`].filter(Boolean))]) {
    r = await sources.rest.search({ keyword: q, corpus: 'legal', all_versions: true, body: true, limit: 50 });
  for (const x of r.rows) if (x.art_ref === ref && norm(x.doc_title).replace(/(법률|법)$/, '') === key /* 이름이 같은 법령만(「국가공무원법」에 「국가공무원 복무규정」을 섞지 않음) */) if (!seen.has(x.doc_id)) seen.set(x.doc_id, x);
    if (seen.size >= 2) break;
  }
  const versions = [...seen.values()].map((x) => ({ doc_id: x.doc_id, title: x.doc_title, effective_from: x.effective_from || '', effective_to: x.effective_to || null, state: x.edition_state || null })).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  if (!versions.length) return { versions, before: null, after: null, degraded: !!r.degraded };
  const text = async (v) => { const d = await sources.loadDoc(v.doc_id); return d.articles.find((a) => a.ref === ref && a.section === '본칙')?.body || ''; };
  const afterV = versions.find((v) => v.state === 'current') || versions.find((v) => v.state !== 'scheduled') || versions[0];
  const after = { ...afterV, text: await text(afterV) };
  let before = null;
  for (const v of versions.filter((x) => x.effective_from < afterV.effective_from).slice(0, 8)) { const t = await text(v); if (t && core(t) !== core(after.text)) { before = { ...v, text: t }; break; } }
  return { versions, before, after, degraded: !!r.degraded };
}
