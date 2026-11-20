// 운영 요약 화면(관리 키 필요)
const $ = (id) => document.getElementById(id), esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sec = (ms) => (ms == null ? '-' : (ms / 1000).toFixed(1) + '초');
const table = (cols, rows) => rows.length ? `<table><tr>${cols.map(([, h]) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cols.map(([k]) => `<td>${esc(typeof k === 'function' ? k(r) : r[k])}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted">없음</p>';
$('k').value = sessionStorage.getItem('rulef5.admin') || '';
$('f').onsubmit = async (e) => {
  e.preventDefault(); const key = $('k').value.trim(); sessionStorage.setItem('rulef5.admin', key); $('out').textContent = '불러오는 중…';
  try {
    const r = await fetch('/api/admin/report?days=' + $('d').value, { headers: { authorization: 'Bearer ' + key } });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status);
    const fail = j.byType.reduce((n, t) => n + t.failed, 0);
    $('out').innerHTML = `<div class="cards"><div class="card">작업<b>${j.total}</b></div><div class="card">실패<b>${fail}</b></div><div class="card">성공률<b>${j.total ? Math.round(((j.total - fail) / j.total) * 100) + '%' : '-'}</b></div></div>`
      + '<h2>기능별</h2>' + table([['type', '기능'], ['n', '건수'], ['done', '성공'], ['failed', '실패'], [(r) => sec(r.median_ms), '중앙 소요']], j.byType)
      + '<h2>실패 원인</h2>' + table([['n', '건수'], ['type', '기능'], ['code', '오류 코드'], ['step', '실패 단계'], ['model', '모델'], ['example', '예']], j.failures)
      + '<h2>느린 단계(중앙값)</h2>' + table([['step', '단계'], ['n', '건수'], [(r) => sec(r.median_ms), '중앙 소요']], j.slowSteps)
      + '<h2>담당자 확인 대기</h2>' + table([['id', '확인 단계'], ['n', '횟수'], [(r) => sec(r.median_ms), '중앙 대기'], [(r) => (r.known ? `${r.changed}/${r.known}` : '-'), '추천을 바꾼 횟수']], j.gates)
      + (j.amend ? '<h2>개정 품질 지표(해당 작업 수)</h2>' + table([['k', '지표'], ['v', '건']], Object.entries({ '개정 작업': j.amend.n, '주제 없는 규정→새 조문': j.amend.absent_topic, '다른 규정에 이미 있음': j.amend.sibling, '자체 검토가 고침': j.amend.review_applied, '검토 수정 거절': j.amend.review_rejected, '검토 후 남은 문제': j.amend.review_remaining, '형식 오류로 뺀 변경': j.amend.dropped, '반영 못 한 요청': j.amend.not_reflected, '근거 조회 실패': j.amend.evidence_errors, '기관 불일치': j.amend.org_mismatch, 'AI 조문 추천 실패': j.amend.picker_fallback }).map(([k, v]) => ({ k, v }))) : '')
      + (j.agent ? `<h2>대화로 요청</h2><p>${j.agent.n}건 · 다시 계획 ${j.agent.replans}건 · 마무리 못 함 ${j.agent.unfinished}건</p>` : '');
  } catch (err) { $('out').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
};
