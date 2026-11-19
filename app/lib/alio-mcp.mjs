// ALIO RAG MCP 어댑터(선택). 설정 시 get_related 등 REST 에 없는 도구를 쓴다. 실패하면 null → 호출자가 로컬 대체.
// timeoutMs: 응답이 없을 때 작업이 끝없이 기다리지 않게(실패하면 null → 호출자가 로컬 대체)
export function createAlioMcp({ url = null, key = null, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  let id = 0;
  async function call(name, args) {
    if (!url) return null;
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
      if (!r.ok) return null;
      let text = await r.text();
      if (text.startsWith('event:') || text.includes('\ndata:')) text = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
      const d = JSON.parse(text);
      if (d.error || d.result?.isError) return null;
      const t = d.result?.content?.find((c) => c.type === 'text')?.text;
      return t ? JSON.parse(t) : null;
    } catch { return null; }
  }
  return {
    enabled: !!url,
    call,
    async related({ doc_id, art_no, art_sub, direction = 'incoming', corpus, inst, limit = 30 }) {
      const r = await call('get_related', Object.fromEntries(Object.entries({ doc_id, art_no, art_sub, direction, corpus, inst, limit }).filter(([, v]) => v !== undefined && v !== null)));
      if (!r) return null;
      // 같은 문서 안 인용은 빼고, 문서 ID(bylaws:[부처]기관_코드/제명_날짜.md)에서 기관명·제명을 채운다
      const norm = (x) => { const m = String(x.doc_id).match(/^\w+:\[[^\]]*\]([^/]+?)_C\d+\/(.+?)(?:_\d{8})?\.md$/); return { ...x, art_title: x.art_title || x.title || '', inst_name: x.inst_name || m?.[1] || '', doc_title: x.doc_title || m?.[2] || x.doc_id, body: x.body || '' }; };
      return { ...r, incoming: (r.incoming || []).filter((x) => x.scope !== 'same_doc' && x.doc_id !== doc_id).map(norm) };
    },
    compare: (a, b) => call('compare_documents', { a, b, include_body: true, max_changes: 60 }),
  };
}
