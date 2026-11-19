// 기관 자동완성 목록(app/orgs.json) 만들기: node app/scripts/build-orgs.mjs   (LAW_API_OC 필요, 키 값은 출력·기록하지 않는다)
// 중앙행정기관·소속기관 = 법제처 행정규칙 검색 결과의 「소관부처명」, 지방자치단체·교육청 = 자치법규 검색 결과의 「지자체기관명」.
// 모든 기관이 두는 규정 이름(위임전결·복무 등)으로 검색해 기관명을 모은다. 이름을 손으로 적지 않으므로 조직 개편이 그대로 반영된다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../lib/env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, 'app', '.env'), join(root, '.env'), join(root, '.private', 'app.env')]) loadEnv(f);
const oc = process.env.LAW_API_OC;
if (!oc) { console.error('LAW_API_OC 가 없습니다.'); process.exit(1); }

async function names(target, queries, listKey, rowKey, field) {
  const out = new Set();
  for (const q of queries) {
    for (let page = 1, got = 0; page <= 10; page++) {
      const r = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${target}&type=JSON&display=100&page=${page}&query=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(`${target} ${q} HTTP ${r.status}`);
      const j = (await r.json())[listKey] || {}; const rows = [].concat(j[rowKey] || []);
      for (const x of rows) { const n = String(x[field] || '').trim(); if (n && !n.startsWith('(구)')) out.add(n); }
      got += rows.length; if (!rows.length || got >= +j.totalCnt) break;
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'ko'));
}

const insts = JSON.parse(readFileSync(join(root, 'app', 'institutions.json'), 'utf8')).items;
const under = {}; for (const x of insts) under[x.ministry] = (under[x.ministry] || 0) + 1;
const central = new Set(await names('admrul', ['위임전결', '보안업무', '공무원 행동강령', '당직', '복무'], 'AdmRulSearch', 'admrul', '소관부처명'));
for (const m of Object.keys(under)) central.add(m); // ALIO 주무부처는 빠짐없이 포함
const local = await names('ordin', ['공무원 복무 조례', '행정기구 설치 조례', '지방공무원 정원 조례'], 'OrdinSearch', 'law', '지자체기관명');
const level = (n) => (/교육청$/.test(n) ? '교육청' : n.includes(' ') ? '기초' : /연합$/.test(n) ? '특별지방자치단체' : '광역');
const data = {
  asof: new Date().toISOString().slice(0, 10),
  source: '법제처 국가법령정보 Open API — 행정규칙 「소관부처명」, 자치법규 「지자체기관명」 / 주무부처별 공공기관 수는 ALIO 공시 기준',
  central: [...central].sort((a, b) => a.localeCompare(b, 'ko')).map((name) => ({ name, insts: under[name] || 0 })),
  local: local.map((name) => ({ name, level: level(name) })),
};
writeFileSync(join(root, 'app', 'orgs.json'), JSON.stringify(data, null, 1) + '\n');
console.log(`central ${data.central.length} · local ${data.local.length} (광역 ${data.local.filter((x) => x.level === '광역').length} · 기초 ${data.local.filter((x) => x.level === '기초').length} · 교육청 ${data.local.filter((x) => x.level === '교육청').length})`);
