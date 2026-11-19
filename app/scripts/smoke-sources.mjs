// 실데이터 연결 확인: node app/scripts/smoke-sources.mjs (LAW_API_OC 있으면 법제처도)
import { createSources } from '../lib/sources.mjs';
const s = createSources(process.env);
const t0 = Date.now();
const r = await s.searchRegs({ keyword: '배우자 출산휴가', corpus: 'bylaws', body: true, limit: 3 });
console.log('ALIO search', r.rows.length, r.rows.map((x) => `${x.inst_name} ${x.doc_title} ${x.art_ref}`), Date.now() - t0, 'ms');
const d = await s.loadDoc(r.rows[0].doc_id);
console.log('ALIO document', d.title, d.articles.length, '조문', d.edition);
const l = await s.searchLaw('남녀고용평등', { targets: ['law', 'admrul', 'ordin'] });
console.log('law search', l.rows.slice(0, 4).map((x) => `${x.source} ${x.title}`), l.errors);
if (s.lawGo.enabled) {
  const law = l.rows.find((x) => x.doc_id.startsWith('law:law:'));
  const ld = await s.loadDoc(law.doc_id);
  console.log('법제처 law', ld.title, ld.articles.length, ld.articles.find((a) => a.ref === '제18조의2')?.body.slice(0, 80));
  const ad = await s.lawGo.search('admrul', '복무', 1); const at = await s.lawGo.text('admrul', ad[0].id);
  console.log('법제처 admrul', at.title, at.articles.length);
  const od = await s.lawGo.search('ordin', '복무 조례', 1); if (od[0]) { const ot = await s.lawGo.text('ordin', od[0].id); console.log('법제처 ordin', ot.title, ot.articles.length, ot.articles[0]?.ref); }
}
