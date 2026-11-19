// 한국어 질의에서 검색용 핵심어를 뽑는다(형태소 분석기 없이 조사·불용어 제거)
// 여러 글자 조사와, 명사 끝 글자와 헷갈리지 않는 한 글자 조사(은·는·을·를·께)만 뗀다. '휴가·제도·직무태만'처럼 조사 같은 글자로 끝나는 명사를 지키기 위해 이·가·과·와·의·에·로·도·만은 떼지 않고, 점수 계산에서 끝 글자를 뗀 형태도 함께 본다.
const JOSA = /(으로써|으로서|에서는|에게서|으로는|이라는|라는|에서|에게|으로|부터|까지|처럼|보다|이나|이며|이고|하고|은|는|을|를|께)$/;
const STOP = new Set(['우리', '규정', '조문', '개정', '제정', '개정안', '해야', '고쳐야', '고쳐', '바꿔야', '바꿔', '맞게', '맞춰', '내용', '경우', '관련', '위해', '대한', '대하여', '따라', '따른', '하는', '한다', '해줘', '해주세요', '싶어', '필요', '있는', '없는', '그리고', '또는', '및', '등', '것', '수', '때', '법', '이번', '새로', '새', '현행', '기관', '우리기관', '수정', '변경', '반영', '늘린다', '늘려', '줄인다', '신설', '삭제', '만들어', '만들기', '작성']);
// 자주 틀리는 법령 약칭 바로잡기(「남여고용평등법」→「남녀고용평등법」) — 검색·근거 조회가 빈손이 되지 않게
export const fixTypos = (s) => String(s || '').replace(/남여(\s*고용\s*평등)/g, '남녀$1');
export function keywords(text, max = 12) {
  const out = [];
  for (let w of String(text || '').split(/[^\p{L}\p{N}]+/u)) {
    if (!w) continue;
    { const s = w.replace(JOSA, ''); if (s.length >= 2) w = s; }
    if (/^제?\d+조(의\d+)?$|^\d+$/.test(w)) continue;
    if (w.length < 2 || STOP.has(w) || /^(해|하|되|된|할|함)/.test(w) && w.length <= 3) continue;
    if (/(해야|해줘|하자|한다|합니다|해요|하려|하고|싶다|싶어)$/.test(w)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out.slice(0, max);
}
export const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
export function scoreArticle(a, kws) {
  let s = 0; const t = a.title || '', b = a.body || '';
  for (const k0 of kws) {
    // 조사가 붙은 채 남은 낱말(배우자가)은 끝 글자를 뗀 형태로도 찾는다
    const k = t.includes(k0) || b.includes(k0) || k0.length < 3 ? k0 : k0.slice(0, -1);
    if (t.includes(k)) s += 3; s += Math.min(3, b.split(k).length - 1);
  }
  return s;
}

// 의도문에서 법령명(「」 안 또는 ~법·~법률·~시행령·~시행규칙으로 끝나는 말)을 뽑는다
export function lawNames(text) {
  const s = String(text || ''), out = [];
  for (const m of s.matchAll(/「([^」]{2,60})」/g)) if (/(법|법률|령|규칙|조례|규정)$/.test(m[1].trim())) out.push(m[1].trim());
  const rest = s.replace(/「[^」]*」/g, ' ');
  for (const m of rest.matchAll(/([가-힣ㆍ·]{2,30}(?:법률|법)(?:\s*시행령|\s*시행규칙)?)(?=[^가-힣]|[은는이가을를의에과와도]|$)/g)) {
    const n = m[1].replace(/(으로|에|의)$/, '');
    if (!/^(방법|불법|위법|적법|입법|헌법상|문법|해법|기법|용법|편법|수법|화법|필법|어법|요법|사법|비법|공법|세법|처법)$/.test(n) && n.length >= 3) out.push(n);
  }
  return [...new Set(out)];
}

// 연혁 표기(<개정 …>, [본조신설 …], ^([개정 …]))와 취소선을 뗀다. 규범 문장이 아니라 편집 표기이므로 대비표·수정안 입력에서 제외한다.
export function stripHistory(s) {
  return String(s ?? '')
    .replace(/\^\((?:\[[^\]]*\])+\)/g, '')
    .replace(/[<〈＜]\s*(?:개정|신설|전문개정|본조신설|본항신설|제목개정|삭제|종전)?[^<>〈〉＜＞]*?\d{2,4}\s*\.\s*\d{1,2}\s*\.[^<>〈〉＜＞]*[>〉＞]/g, '')
    .replace(/\[(?:개정|신설|전문개정|본조신설|본항신설|제목개정|종전)[^\]]*\]/g, '')
    .replace(/[(（]\s*(?:개정|신설|전문개정|본조신설|본항신설|제목개정|삭제)\s*[^()（）]*?\d{2,4}\s*\.\s*\d{1,2}[^()（）]*[)）]/g, '')
    // 날짜가 앞에 오는 연혁 표기: (‘12.9.13. 개정) (2015.3.1. 신설) <'12.9.13 개정>
    .replace(/[(（<〈]\s*[‘'’]?\d{2,4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.?\s*(?:,\s*[‘'’]?\d{2,4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\.?\s*)*(?:개정|신설|전문개정|삭제|일부개정)\s*[)）>〉]/g, '')
    .replace(/~~[^~]*~~/g, '')
    .replace(/[ \t]+$/gm, '').replace(/[ \t]{2,}/g, ' ').trim();
}
// 원천 데이터의 빈 줄·제목 기호(#)·백틱·목록 기호를 정리해 원문과 수정안을 같은 모양으로 맞춘다
export function cleanBody(s) {
  return String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/^\s*#{1,6}\s*/, '').replace(/`/g, '').replace(/^\s*[-*]\s+(?=[①-⑳]|\d+\.|[가-하]\.)/, '').replace(/\s+$/, '').replace(/^\s+/, '')).filter((l) => l).join('\n');
}
export const normalizeArticle = (s) => cleanBody(stripHistory(s));
