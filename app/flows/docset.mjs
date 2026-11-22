// 제·개정 문서 세트 구성(이유서·부칙·예고문·체크리스트)
import { josa } from '../lib/table.mjs';
// 기관장 명칭: 지자체는 이름 끝(구·시·군·도·교육청)으로 단체장 명칭을 만든다
// 결재·공포권자: 부처·지자체는 「수원시장」「고용노동부장관」처럼 기관명을 붙인 직함으로 쓴다(직함만 적어 둔 경우 포함)
const BARE = /^(시장|군수|구청장|도지사|지사|교육감|단체장|장관|처장|청장|위원장|본부장|실장|원장)$/;
export function headTitle(profile = {}) {
  if (profile.approver && !(profile.type !== 'public-institution' && BARE.test(String(profile.approver).trim()) && profile.name && !/^예시 /.test(profile.name))) return profile.approver;
  const last = String(profile.name || '').trim().split(/\s+/).pop() || '';
  if (profile.type === 'local-gov') {
    if (/교육청$/.test(last)) return last.replace(/청$/, '감');
    if (/(특별시|광역시)$/.test(last) || /시$/.test(last)) return `${last}장`;
    if (/구$/.test(last)) return `${last}청장`;
    if (/군$/.test(last)) return `${last}수`;
    if (/도$/.test(last)) return `${last}지사`;
    return `${last}장`;
  }
  if (profile.type === 'central-ministry') {
    if (!last) return '장관';
    if (/본부$/.test(last)) return `${last}장`;
    if (/위원회$/.test(last)) return `${last} 위원장`;
    if (/부$/.test(last)) return `${last}장관`;
    return `${last}장`; // ○○처장·○○청장·○○실장·○○원장
  }
  return '기관장';
}
const KIND_RE = '조례|규칙|훈령|예규|고시|지침|세칙|요령|규정|정관|강령|내규|기준';
// 규정 종류: 문서 종류(법제처 doc_type: 훈령·예규·고시·조례·규칙)를 먼저, 없으면 제명 끝말
export const regKindOf = (title, fallback = '규정', docType = null) => (String(docType || '').match(new RegExp(`^(${KIND_RE})$`)) || [])[1] || (String(title).match(new RegExp(`(${KIND_RE})\\s*$`)) || [])[1] || fallback;
// 조례·규칙은 공포, 그 밖(훈령·예규·고시·내규)은 발령 — 교육청·지자체 훈령도 발령이다
export const promulgates = (type, kind) => type === 'local-gov' && /^(조례|규칙)$/.test(kind || '조례');
const NOTICE_NAME = { 'public-institution': '사전 예고', 'central-ministry': '행정예고', 'local-gov': '입법예고' };
const NOTICE_DAYS = { 'public-institution': '기관 규정에서 정한 기간', 'central-ministry': '20일 이상(행정절차법 제46조)', 'local-gov': '20일 이상(행정절차법 제43조)' };

export function reasonDoc(kind, reasonSummary, points) {
  return [`1. ${kind} 이유`, reasonSummary || '(작성 필요)', '', '2. 주요 내용', ...(points?.length ? points.map((p, i) => `  ${i + 1}) ${p}`) : ['  (작성 필요)'])].join('\n');
}
export function addendaDoc(addenda, profile, regKind = null) {
  const kind = regKind || '규정', subj = `이 ${kind}${josa(kind, '은', '는')}`;
  const word = promulgates(profile?.type, kind) ? '공포한' : '발령한';
  const dflt = `${subj} ${word} 날부터 시행한다.`;
  let eff = String(addenda?.effective || profile?.effective_default || dflt).replace(/^제1조\(시행일\)\s*/, '').trim();
  // 주어 통일("본 개정규정은", "이 개정 규정은", 주어 없음 → "이 {종류}은")
  eff = eff.replace(new RegExp(`^(본|이)\\s*(개정\\s*)?(${KIND_RE})(은|는)\\s*`), '');
  eff = `${subj} ${eff.replace(/^(은|는)\s*/, '')}`;
  // 이미 지난 날짜는 모델이 지어낸 것으로 보고 기본 문구로 바꾼다
  const m = eff.match(/(\d{4})\s*[년.]\s*(\d{1,2})\s*[월.]\s*(\d{1,2})/);
  if (m && new Date(+m[1], +m[2] - 1, +m[3]) < new Date(new Date().toDateString())) eff = dflt;
  if (!/시행한다/.test(eff)) eff = dflt;
  // 조례·규칙은 공포, 공공기관·부처 내규는 발령
  eff = promulgates(profile?.type, kind) ? eff.replace(/발령한 날/g, '공포한 날') : eff.replace(/공포한 날/g, '발령한 날');
  const raw = String(addenda?.transition || '').trim();
  const lab = raw.match(/^제\d+조\(([^)]+)\)\s*/), label = lab ? lab[1] : '경과조치', tr = lab ? raw.slice(lab[0].length) : raw;
  return [`부 칙 <제    호, ${new Date().getFullYear()}.  .  .>`, tr ? `제1조(시행일) ${eff}` : eff, tr ? `제2조(${label}) ${tr}` : null].filter(Boolean).join('\n');
}
// 지자체 약칭: 도 소속 시·군은 「수원시」, 특별시·광역시의 자치구·군은 「서울특별시 강남구」처럼 전체 이름
export const localShort = (org) => { const n = String(org || '').trim(), [up] = n.split(/\s+/); return n.includes(' ') && /(특별시|광역시|특별자치시|통합특별시)$/.test(up) ? n : n.split(/\s+/).pop(); };
export function noticeDoc({ profile, title, kind, reasonSummary, points, regKind = null }) {
  const type0 = profile?.type || 'public-institution', org = profile?.name || '○○기관';
  // 지자체라도 훈령·예규는 입법예고가 아니라 행정예고다
  const type = type0 === 'local-gov' && regKind && !promulgates(type0, regKind) ? 'central-ministry' : type0;
  const issuer = type0 === 'local-gov' ? localShort(org) : org, signer = type0 === 'public-institution' ? `${org}${profile?.approver ? ` ${profile.approver}` : ''}` : headTitle(profile);
  return [
    `${issuer} 공고 제    호`, '', `「${title}」 ${kind}안 ${NOTICE_NAME[type]}`, '',
    `「${title}」${josa(title, "을", "를")} ${kind}하면서 그 취지와 주요 내용을 미리 알려 의견을 듣고자 다음과 같이 공고합니다.`, '',
    `                    ${new Date().getFullYear()}년  월  일`, `                    ${signer}`, '',
    `1. ${kind} 이유`, `  ${reasonSummary || '(작성 필요)'}`, '', '2. 주요 내용', ...(points || []).map((p, i) => `  ${i + 1}) ${p}`), '',
    '3. 의견 제출', `  가. 제출 기간: 공고일부터 ${NOTICE_DAYS[type]}`, '  나. 제출 방법: 의견서(찬반 여부와 이유, 성명·연락처)를 담당 부서에 제출', `  다. 제출처: ${org} (담당 부서·연락처 기재)`,
  ].join('\n');
}
export function checklistDoc(items) {
  // 같은 문구가 여러 번 나오면(모델이 같은 변경을 여러 번 낸 경우 등) 한 번만 적는다
  return [...new Set(items.filter(Boolean))].map((x) => `☐ ${x}`).join('\n');
}

// 절차 단계별 서식: 기관 유형에 맞춰 협조 공문·의견 청취서·검토 의뢰서·심의 안건·부의안·의회 제출안·공포(발령)문을 만든다
export function procedureDocs({ profile = {}, title, kind, reasonSummary, points = [], labor = false, adverse = null, regKind = null, consent = false }) {
  const type = profile.type || 'public-institution', org = profile.name || '○○기관', boss = headTitle(profile);
  const rk = regKind || regKindOf(title, type === 'local-gov' ? '조례' : type === 'central-ministry' ? '훈령' : '규정'), shortOrg = localShort(org);
  const year = new Date().getFullYear(), pts = points.length ? points.map((p, i) => `  ${i + 1}) ${p}`) : ['  (주요 내용 작성)'];
  const kindWord = kind === '제정' ? '제정' : '개정';
  const out = [];
  out.push({ id: 'consult_letter', title: '협조 요청 공문', body: [
    `수신  수신자 참조`, `(경유)`, `제목  「${title}」 ${kindWord}안 의견 조회`, '',
    '1. 관련: (근거 문서 번호·일자)',
    `2. 「${title}」${josa(title, "을", "를")} ${kindWord}하고자 하오니 검토 의견을 ${year}.  .  .까지 회신하여 주시기 바랍니다.`,
    `  가. ${kindWord} 이유: ${reasonSummary || '(작성)'}`, '  나. 주요 내용', ...pts.map((p) => '  ' + p),
    '  다. 회신 방법: 의견이 없는 경우에도 "의견 없음"으로 회신', '',
    '붙임  1. ' + `${kindWord}안 1부.`, '      2. 신구조문대비표 1부.', `      3. ${kindWord} 이유서 1부.  끝.`, '', type === 'public-institution' ? `${org}${profile.approver ? ' ' + boss : ''}` : boss, '수신자  관계 부서(팀)장',
  ].join('\n') });
  if (labor) out.push({ id: 'labor_opinion', title: consent ? '근로자 동의서(불리한 변경)' : '근로자 의견 청취서·동의서', body: [
    consent ? `「${title}」 ${kindWord}에 관한 근로자 동의서(근로자에게 불리한 변경)` : `「${title}」 ${kindWord}에 관한 근로자 의견 청취서`, '',
    `「근로기준법」 제94조에 따라 취업규칙(복무·보수 등 근로조건에 관한 규정 포함)을 작성·변경할 때에는 근로자 과반수로 조직된 노동조합(없으면 근로자 과반수)의 의견을 들어야 하며, 근로자에게 불리하게 변경하는 경우에는 동의를 받아야 합니다.`, '',
    `1. ${kindWord} 내용: ${reasonSummary || '(작성)'}`, ...pts,
    consent ? '2. 근로자에게 불리한 변경 여부: □ 해당 없음  ■ 해당(동의 필요) — 담당자가 불리한 변경으로 진행하기로 정함' : '2. 근로자에게 불리한 변경 여부: □ 해당 없음  □ 해당(동의 필요) — 담당자 판단',
    adverse?.length ? `   ※ 불리한 변경 후보: ${adverse.map((a) => `${a.ref}(${a.reasons.join(', ')})`).join('; ')} — 자동 탐지 결과이며 확정이 아닙니다.` : adverse ? '   ※ 자동 탐지된 불리한 변경 후보 없음(담당자 확인 필요)' : null,
    ...(consent ? ['3. 동의 여부: □ 동의함  □ 동의하지 않음', '   동의 방식: □ 근로자 과반수로 조직된 노동조합 대표의 동의  □ 근로자 과반수의 집단적 의사결정(회의 방식 등)', '   대상 근로자 수:     명 / 동의 근로자 수:     명', '4. 의견:', '', ''] : ['3. 의견:', '', '']),
    `${year}년  월  일`, '노동조합(근로자 과반수 대표)                (서명 또는 인)', '', '※ 불리한 변경 동의는 근로자 과반수로 조직된 노동조합 또는 근로자 과반수의 집단적 의사결정(회의 방식 등)으로 받아야 합니다.',
  ].filter((x) => x !== null).join('\n') });
  out.push({ id: 'legal_review', title: '법무 검토 의뢰서', body: [
    `「${title}」 ${kindWord}안 법무 검토 의뢰`, '', '1. 검토 요청 사항',
    '  가. 상위 법령의 위임 범위를 벗어나거나 저촉되는 조항이 있는지', '  나. 인용 조문·별표·서식과 용어가 정확한지(인용 정정 목록 참조)', '  다. 부칙(시행일·경과조치)이 적정한지',
    type === 'central-ministry' ? '  라. 규제 신설·강화 해당 여부와 행정예고·법제처 사전검토 대상 여부' : type === 'local-gov' ? '  라. 상위 법령 위임 근거 및 다른 자치법규와의 관계' : '  라. 단체협약·취업규칙과 충돌 여부',
    `2. ${kindWord} 이유: ${reasonSummary || '(작성)'}`, '3. 붙임: 제·개정안, 신구조문대비표, 근거 자료 목록, AI 검토 체크리스트',
  ].join('\n') });
  const council = profile.council || (type === 'local-gov' ? '조례·규칙심의회' : '규정심의위원회');
  if (type !== 'central-ministry') out.push({ id: 'council_agenda', title: `${council} 심의 안건`, body: [
    `${council} 심의 안건`, `의안번호  제    호`, `심의일  ${year}.  .  .`, '', `「${title}」 ${kindWord}안`, '',
    `제출자  ${org} (담당 부서)`, '', '1. 의결 주문', `  「${title}」 ${kindWord}안을 별지와 같이 의결한다.`, '',
    `2. 제안 이유`, `  ${reasonSummary || '(작성)'}`, '', '3. 주요 내용', ...pts, '',
    '4. 참고 사항', '  가. 관계 부서 협의 결과: (작성)', '  나. 근로자 의견 청취·노동조합 협의 결과: (해당 시 작성)', '  다. 예고 결과: (해당 시 작성)', '', '별지  신구조문대비표',
  ].join('\n') });
  if (type === 'public-institution') out.push({ id: 'board_agenda', title: '이사회 부의안', body: [
    `제   차 이사회 부의안건`, '', `「${title}」 ${kindWord}(안)`, '',
    '1. 의결 사항', `  「${title}」 ${kindWord}(안)을 원안대로 의결함`, '', '2. 제안 이유', `  ${reasonSummary || '(작성)'}`, '', '3. 주요 내용', ...pts, '',
    '4. 관련 근거', '  「공공기관의 운영에 관한 법률」 제17조(이사회의 심의·의결 사항) 및 정관 — 이사회 의결 대상 여부 확인 필요', '', '5. 붙임: 신구조문대비표, 규정심의위원회 심의 결과',
  ].join('\n') });
  if (type === 'local-gov' && rk === '조례') out.push({ id: 'assembly_bill', title: '의회 제출 조례안', body: [
    `의안번호  제    호`, '', kindWord === '제정' ? `${title}안` : `${title} 일부개정조례안`, '', `제출연월일  ${year}.  .  .`, `제 출 자  ${boss}`, '',
    '1. 제안 이유', `  ${reasonSummary || '(작성)'}`, '', '2. 주요 내용', ...pts, '',
    '3. 참고 사항', '  가. 관계 법령: (작성)', '  나. 예산 조치: 별도 조치 필요 없음 / 비용추계서 첨부', '  다. 합의 사항: 관계 부서 협의 완료', '  라. 입법예고 결과: (작성)', '', '붙임  신구조문대비표',
  ].join('\n') });
  const lead = kindWord === '제정' ? `「${title}」${josa(title, '을', '를')} 다음과 같이 제정한다.` : `「${title}」 일부를 다음과 같이 개정한다.`;
  const pub = promulgates(type, rk);
  out.push({ id: 'promulgation', title: pub || type === 'public-institution' ? '공포문' : '발령문', body: pub
    ? [`${title}${kindWord === '개정' ? ` 일부개정${rk}` : ''}${josa(kindWord === '개정' ? rk : title, '을', '를')} 이에 공포한다.`, '', `${year}년  월  일`, '', `${boss}            (직인)`, '', `${shortOrg} ${rk} 제    호`, '', kindWord === '개정' ? `${title} 일부개정${rk}` : title, '', lead].join('\n')
    : type !== 'public-institution'
      ? [`${type === 'local-gov' ? localShort(org) : org} ${rk} 제    호`, '', lead, '', `${year}년  월  일`, '', `${boss}            (직인)`].join('\n')
      : [`${org} ${rk} 제    호`, '', lead, '', `${year}년  월  일`, '', `${org} ${boss}            (직인)`, '', '※ 공포 후 ALIO 내부규정 공시(공시 기한 확인)'].join('\n') });
  return out;
}

// 개정 후 전문: 원 규정 전체에 수정안을 반영한 본문(바뀐 조문 표시). changes: { op, ref(원래 번호, 신설은 새 번호), after(신설 위치), new_ref(옮긴 번호), title, new }
// map: 조 번호 이동(원래 → 새 번호, null 이면 조문째 삭제). 없으면 changes 의 new_ref 로 만든다
export function consolidatedDoc({ doc, changes = [], map = null, addendaText = '', normalize = (t) => t }) {
  const mv = map instanceof Map ? map : new Map(changes.filter((c) => c.op !== 'insert' && c.new_ref && c.new_ref !== c.ref).map((c) => [c.ref, c.new_ref]));
  const byRef = new Map(changes.filter((c) => c.op !== 'insert' && c.ref).map((c) => [c.ref, c]));
  const ins = changes.filter((c) => c.op === 'insert' && c.ref);
  const placed = new Set();
  // 표시는 조 제목 바로 뒤에(긴 조문에서도 바로 보이게)
  const line = (ref, title, body, tag) => `${ref}${title ? `(${title})` : ''}${tag ? ` 〈${tag}〉` : ''} ${String(body || '').trim()}`;
  const out = [`${doc.title || '규정'} — 개정 후 전문(안)`, '※ AI 초안을 반영한 전문입니다. 〈개정〉〈신설〉〈삭제〉〈조 번호 이동〉 표시를 원문과 대조하세요.', ''];
  let chapter = null, sec = '본칙', addDone = false;
  const placedRest = () => { const rest = ins.filter((n) => !placed.has(n)); if (rest.length) { out.push('', '(위치 미정 신설 조문 — 들어갈 자리를 정하세요)'); for (const n of rest) { out.push(line(n.ref, n.title, n.new, '신설')); placed.add(n); } } };
  // 이번 개정의 부칙은 기존 부칙 뒤, 별표 앞에 둔다
  const addNew = () => { if (addDone) return; addDone = true; const t = String(addendaText || '').trim(); if (!t) return; const [h, ...r] = t.split('\n'); out.push('', ...(/^\s*부\s*칙/.test(h) ? [`${h} 〈이번 개정〉`, ...r] : ['부 칙 〈이번 개정〉', t])); };
  for (const a of doc.articles || []) {
    if (a.section !== sec) { if (sec === '본칙') placedRest(); if (a.section === '별표') addNew(); sec = a.section; const ownHead = sec === '부칙' && !a.ref && /^\s*#*\s*부\s*칙/.test(a.body || ''); out.push('', ...(ownHead ? [] : [sec === '부칙' ? '부 칙' : sec === '별표' ? '별 표' : sec]), ''); }
    if (a.section !== '본칙' || !a.ref) { out.push(a.section === '별표' && a.title ? `${a.title}\n${normalize(a.body)}` : (a.ref ? line(a.ref, a.title, normalize(a.body)) : normalize(a.body))); continue; }
    if (a.chapter && a.chapter !== chapter) { chapter = a.chapter; out.push('', chapter); }
    const c = byRef.get(a.ref), to = mv.has(a.ref) ? mv.get(a.ref) : a.ref;
    if (to === null) { /* 번호까지 지운 조문 */ }
    else if (c?.op === 'delete') out.push(`${to} 삭제 〈삭제〉`);
    else if (c) out.push(line(to, c.title || a.title, c.new, to !== a.ref ? `개정 · 조 번호 이동 ${a.ref}→${to}` : '개정'));
    else out.push(line(to, a.title, normalize(a.body), to !== a.ref ? `조 번호 이동 ${a.ref}→${to}` : ''));
    for (const n of ins.filter((x) => x.after === a.ref)) { out.push(line(n.ref, n.title, n.new, '신설')); placed.add(n); }
  }
  // 위치를 모르는 신설 조문은 본칙 끝에 둔다
  placedRest(); addNew();
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
