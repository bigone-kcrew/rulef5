// 기관 자동완성: 공공기관(ALIO 공시 목록) · 중앙행정기관과 소속기관 · 지방자치단체와 교육청(법제처 자료, scripts/build-orgs.mjs 로 갱신)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const INSTS = load('institutions.json').items, ORGS = load('orgs.json');
const flat = (s) => String(s || '').replace(/\s+/g, '');
const ORDER = { 광역: 0, 특별지방자치단체: 1, 기초: 2, 교육청: 3 };
// 결재·공포권자 직함(이름 끝말로 정한다. 맞지 않으면 화면에서 고친다)
export const headOf = (type, name) => {
  const n = flat(name);
  if (type === 'local-gov') return /교육청$/.test(n) ? '교육감' : /(특별시|광역시|특별자치시|통합특별시)$/.test(n) ? '시장' : /도$/.test(n) ? '도지사' : /시$/.test(n) ? '시장' : /군$/.test(n) ? '군수' : /구$/.test(n) ? '구청장' : '단체장';
  if (type === 'central-ministry') return /본부$/.test(n) ? '본부장' : /위원회$/.test(n) ? '위원장' : /부$/.test(n) ? '장관' : /처$/.test(n) ? '처장' : /청$/.test(n) ? '청장' : /실$/.test(n) ? '실장' : '기관장';
  return '기관장';
};
export function searchOrgs(type, q, limit = 20) {
  const s = flat(q).slice(0, 40);
  const pick = (list, key) => list.filter((x) => !s || flat(x.name).includes(s)).sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name, 'ko')).slice(0, limit);
  // 앞에서부터 맞는 이름, 그다음 끝말이 맞는 이름(「수원」→ 경기도 수원시, 「중구」→ 여러 시의 중구)을 먼저 보여 준다
  const near = (x) => (!s ? 0 : flat(x.name).startsWith(s) ? 0 : flat(x.name.split(' ').pop()).startsWith(s) ? 1 : 2);
  if (type === 'central-ministry') return pick(ORGS.central, (x) => near(x) * 2 + (x.insts ? 0 : 1)).map((x) => ({ name: x.name, sub: x.insts ? `산하 공공기관 ${x.insts}곳` : '중앙행정기관·소속기관', head: headOf(type, x.name) }));
  if (type === 'local-gov') return pick(ORGS.local, (x) => near(x) * 4 + ORDER[x.level]).map((x) => ({ name: x.name, sub: x.level === '기초' ? '기초자치단체' : x.level === '광역' ? '광역자치단체' : x.level, head: headOf(type, x.name) }));
  return pick(INSTS, near).map((x) => ({ name: x.name, sub: `${x.type} · ${x.ministry}`, type: x.type, ministry: x.ministry, head: '기관장' }));
}
// 문장 안의 공공기관 이름(가장 긴 것) — 「창업진흥원 취업규칙」에서 창업진흥원
export const instIn = (text) => { const t = flat(text); return INSTS.filter((x) => x.name.length >= 3 && t.includes(flat(x.name))).sort((a, b) => b.name.length - a.name.length)[0]?.name || null; };
export const orgsInfo = () => ({ asof: ORGS.asof, source: ORGS.source, counts: { 'public-institution': INSTS.length, 'central-ministry': ORGS.central.length, 'local-gov': ORGS.local.length } });
// 비교용 기관 정보: 지자체는 종류(광역·시·군·구·교육청)와 소속 시·도, 부처는 종류(부·처·청·위원회)
export function orgMeta(type, name) {
  const n = String(name || '').trim();
  if (type === 'local-gov') {
    const x = ORGS.local.find((o) => o.name === n);
    const level = x?.level || (/교육청$/.test(n) ? '교육청' : n.includes(' ') ? '기초' : '광역');
    const kind = level === '기초' ? `기초(${(n.match(/(시|군|구)$/) || ['', '기타'])[1]})` : level;
    return { name: n, kind, region: level === '기초' ? n.split(/\s+/)[0] : n.replace(/교육청$/, ''), label: level === '기초' ? '기초자치단체' : level === '광역' ? '광역자치단체' : level, known: !!x };
  }
  const kind = /위원회$/.test(n) ? '위원회' : /부$/.test(n) ? '부' : /처$/.test(n) ? '처' : /청$/.test(n) ? '청' : '소속기관 등';
  return { name: n, kind, region: '', label: '중앙행정기관', known: ORGS.central.some((o) => o.name === n) };
}

