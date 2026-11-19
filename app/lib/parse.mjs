// 규정 텍스트 → 조문 구조(Doc). ALIO 문서와 같은 모양으로 만든다.
export const refOf = (no, sub) => `제${no}조${sub ? `의${sub}` : ''}`;
export function parseRef(s) {
  const m = String(s || '').replace(/\s+/g, '').match(/^제(\d+)조(?:의(\d+))?$/);
  return m ? { no: +m[1], sub: m[2] ? +m[2] : null } : null;
}

const RE_CHAPTER = /^제\s*\d+\s*(?:편|장|절)(?:\s+.*)?$/;
// 제목이 있으면 본문이 붙어 있어도 된다(「제1조(목적)이 규칙은」), 제목이 없으면 띄어 쓴 본문만 조문으로 본다
const RE_ARTICLE = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*(?:(?:\(([^)]{0,60})\)|【([^】]{0,60})】)\s*(.*)|\s+(.*))?$/;
const RE_ADDENDA = /^부\s*칙(?:\s*[<(〈].*)?$/;
const RE_CITE_TAIL = /^(?:제\s*\d+\s*(?:항|호|조|목)|및|또는|내지|부터|까지|[,·ㆍ~]|단서|본문|전단|후단|각\s*호)/;
// 별표 머리: [별표 1] · <별표 1> · 【별표 1】 · 별표 1 · 별표 1 휴가 일수 · 별지 제1호서식
const RE_ANNEX = /^(?:[\[<〈【]\s*(?:별표|별지)[^\]>〉】]*[\]>〉】]|(?:별표|별지)\s*(?:제\s*)?\d+\s*(?:호)?\s*(?:서식)?\s*(?:\(.*\))?(?:\s+[^\s|][^|]{0,60})?$)/;

export function parseRegulationText(text, { doc_id, title, inst = null } = {}) {
  // 마크다운 제목(#)·굵게(**)는 떼고 읽는다(「## 제1조(목적)」「**제2조(정의)** 뜻」)
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '').replace(/^\s*#{1,6}\s+/, '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1'));
  const articles = []; let cur = null, section = '본칙', chapter = null, seq = 0, firstLine = null;
  const push = () => { if (cur) { cur.body = cur.body.join('\n').trim(); articles.push(cur); cur = null; } };
  // 제목이 붙은 조문 번호(뒤에 같은 번호의 제목 있는 조문이 나오면 앞의 제목 없는 줄은 인용으로 시작하는 본문이다)
  const titled = new Set(lines.map((l) => l.trim().match(RE_ARTICLE)).filter((m) => m && (m[3] !== undefined || m[4] !== undefined)).map((m) => refOf(+m[1], m[2] ? +m[2] : null)));
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) cur.body.push(''); continue; }
    if (firstLine === null) firstLine = line;
    if (RE_ADDENDA.test(line)) { push(); section = '부칙'; chapter = null; continue; }
    if (RE_ANNEX.test(line)) {
      push(); section = '별표';
      cur = { ref: null, no: null, sub: null, title: line.replace(/^[\[<〈【]|[\]>〉】]/g, '').trim(), body: [], section, chapter: null, seq: ++seq };
      continue;
    }
    if (section !== '별표' && RE_CHAPTER.test(line) && !RE_ARTICLE.test(line)) { push(); chapter = line; continue; }
    const m = section !== '별표' && line.match(RE_ARTICLE);
    // 제목 없이 인용으로 이어지는 줄(「제3조 제1항에 따라 …」「제4조 및 제5조에 따른 …」)은 앞 조문의 본문이다
    const hasTitle = m && (m[3] !== undefined || m[4] !== undefined), rest = m ? (m[5] ?? m[6]) : undefined;
    const nextNo = m && cur && cur.no && ((+m[1] === cur.no + 1 && !m[2]) || (+m[1] === cur.no && m[2]));
    // 「및·또는·부터」로 이어지면 언제나 인용, 「제N항·제N조」로 이어지면 다음 번호가 아니거나 같은 번호의 제목 있는 조문이 뒤에 있을 때만 인용
    const cites = m && !hasTitle && cur && (/^(?:및|또는|내지|부터|까지|[,·ㆍ~])/.test(rest || '') || (RE_CITE_TAIL.test(rest || '') && (!nextNo || titled.has(refOf(+m[1], m[2] ? +m[2] : null)))));
    if (m && !cites && (hasTitle || rest !== undefined)) {
      push();
      const no = +m[1], sub = m[2] ? +m[2] : null;
      cur = { ref: refOf(no, sub), no, sub, title: (m[3] ?? m[4] ?? '').trim(), body: [rest || ''], section, chapter: section === '본칙' ? chapter : null, seq: ++seq };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  push();
  return { doc_id, title: title || firstLine || '제목 없음', inst, source: 'upload', edition: { state: 'unknown', effective_from: null, effective_to: null, warning: '업로드 자료입니다. 현행 여부는 원문으로 확인하세요.' }, articles };
}
