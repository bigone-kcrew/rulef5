// 제·개정 절차 템플릿(기관 유형별) 로드와 '다음 할 일' 계산
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'procedures');

export function loadProcedures(dir = DIR) {
  const out = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) { const t = JSON.parse(readFileSync(join(dir, f), 'utf8')); out[t.type] = t; }
  return out;
}
export function nextProcedure(template, done, availableDocs) {
  const steps = template.steps || [], i = steps.findIndex((s) => !done.has(s.id));
  if (i < 0) return { current: null, next: null, missingDocs: [] };
  const current = steps[i];
  return { current, next: steps[i + 1] || null, missingDocs: (current.docs || []).filter((d) => !availableDocs.has(d)) };
}
export const DOC_LABELS = { draft: '제·개정안', comparison: '신구조문대비표', full_text: '개정 후 전문', reason: '제·개정 이유서', addenda: '부칙', notice: '입법(행정)예고문', corrections: '인용 정정 목록', checklist: '검토 체크리스트', evidence: '근거 자료 목록', consult_letter: '협조 요청 공문', labor_opinion: '근로자 의견 청취서', legal_review: '법무 검토 의뢰서', council_agenda: '심의 안건', board_agenda: '이사회 부의안', assembly_bill: '의회 제출안', promulgation: '공포·발령문' };
