// API 라우트 정의. flows 는 작업 종류 → 실행 함수.
import { readJson, sendJson, httpError } from './http.mjs';
import { parseRegulationText } from './parse.mjs';
import { hwpxToText } from './unzip.mjs';
import { resolveLlmConfig, createLlm, PRESETS, allowedModels } from './llm.mjs';
import { loadProcedures } from '../flows/procedure.mjs';
import { lawVersions } from '../flows/lawversions.mjs';
import { searchInstitutions } from '../flows/similar.mjs';
import { lawFamily } from '../flows/lawchain.mjs';
import { searchOrgs, orgsInfo } from './orgs.mjs';
import { consolidatedDoc } from '../flows/docset.mjs';
import { summarizeLogs, typicalDurations } from './joblog.mjs';
import { timingSafeEqual, createHash } from 'node:crypto';
import { normalizeArticle } from './text.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEARCH_KEYS = ['keyword', 'corpus', 'inst', 'ministry', 'type', 'hybrid', 'semantic', 'body', 'all_versions', 'as_of', 'section', 'limit', 'offset', 'distinct_inst'];

// 하루 업로드 한도: 서버 전체 + 접속 주소별(한 사용자가 전체 한도를 다 쓰지 못하게)
export function createUploadQuota({ dailyBytes = 300 * 1024 * 1024, perIpBytes = 40 * 1024 * 1024 } = {}) {
  let day = '', used = 0, byIp = new Map();
  return { take(n, ip = '') { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; byIp = new Map(); } const mine = byIp.get(ip) || 0; if (used + n > dailyBytes || mine + n > perIpBytes) return false; used += n; byIp.set(ip, mine + n); return true; } };
}

// 사용자가 넣은 법제처 Open API 인증키(OC, 헤더 x-law-oc). 영문·숫자·._-@ 2~60자만 받는다
export function parseLawOc(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9._@-]{2,60}$/.test(s)) throw httpError(400, '법제처 OC(인증키) 형식이 올바르지 않습니다. 영문·숫자만 넣어 주세요.');
  return s;
}
export function createRoutes({ sources: baseSources, jobs, workspace, env, flows, llmCounter = null, features = {}, logDir = null }) {
  let typicalCache = null;
  const srcFor = (req) => baseSources.withLawOc(parseLawOc(req.headers['x-law-oc']));
  const procedures = loadProcedures();
  const quota = createUploadQuota({ dailyBytes: (+env.UPLOAD_DAILY_MB || 300) * 1024 * 1024 });
  const profiles = readdirSync(join(HERE, '..', 'profiles')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(HERE, '..', 'profiles', f), 'utf8')));
  const llmFor = (req) => { const c = resolveLlmConfig(env, req.headers['x-llm-config'] || null); return c ? createLlm(c, { counter: llmCounter }) : null; };

  return [
    ['GET', '/api/status', (req, res) => {
      const sources = srcFor(req);
      let llm = null; try { const c = resolveLlmConfig(env, null); llm = c ? { preset: c.preset, model: c.model } : null; } catch { /* 무시 */ }
      sendJson(res, 200, { data: sources.status(), llm, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, model: v.model, server_key: v.envKeys.some((e) => env[e]) }])), openrouter_models: allowedModels(env, 'openrouter'), models: { openrouter: allowedModels(env, 'openrouter'), nim: allowedModels(env, 'nim') }, features: { ...features, hwpx: !!env.KORDOC_URL }, active_jobs: jobs.active?.() ?? 0 });
    }],
    // 기능별 보통 걸리는 시간(진행 화면 안내): 작업 기록에서 10분마다 다시 계산한다(건수·시간만, 내용 없음)
    ['GET', '/api/typical', (req, res) => {
      if (!typicalCache || Date.now() - typicalCache.t > 600e3) { let v = {}; try { v = typicalDurations(logDir || join(dirname(fileURLToPath(import.meta.url)), '..', 'var', 'logs')); } catch { /* 기록이 없거나 깨져도 안내만 빠진다 */ } typicalCache = { t: Date.now(), v }; }
      sendJson(res, 200, typicalCache.v);
    }],
    ['GET', '/api/procedures', (req, res) => sendJson(res, 200, procedures)],
    ['GET', '/api/profiles', (req, res) => sendJson(res, 200, profiles)],
    // 운영 요약(작업 기록): 서버에 RULEF5_ADMIN_TOKEN 이 있을 때만, Authorization: Bearer 로 확인. 없으면 경로 자체가 없다
    ['GET', '/api/admin/report', (req, res) => {
      const want = env.RULEF5_ADMIN_TOKEN;
      if (!want || want.length < 16) throw httpError(404, '없는 경로입니다.');
      const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const h = (x) => createHash('sha256').update(String(x)).digest();
      if (!got || !timingSafeEqual(h(got), h(want))) throw httpError(401, '관리 키가 맞지 않습니다.');
      const days = Math.min(90, Math.max(1, +(new URL(req.url, 'http://x').searchParams.get('days')) || 7));
      sendJson(res, 200, summarizeLogs(logDir || join(dirname(fileURLToPath(import.meta.url)), '..', 'var', 'logs'), days));
    }],
    // 한글(hwpx) 내려받기: 문서 변환 서비스(kordoc, KORDOC_URL)가 설정된 서버에서만. Markdown → hwpx
    ['POST', '/api/hwpx', async (req, res) => {
      if (!env.KORDOC_URL) throw httpError(404, '이 서버에서는 한글(hwpx) 내려받기를 쓸 수 없습니다.');
      const b = await readJson(req, 1024 * 1024);
      if (typeof b.markdown !== 'string' || !b.markdown.trim() || b.markdown.length > 800000) throw httpError(400, '문서 내용을 확인해 주세요.');
      let r;
      try { r = await fetch(`${String(env.KORDOC_URL).replace(/\/$/, '')}/v1/document/generate/hwpx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ markdown: b.markdown }), signal: AbortSignal.timeout(120000) }); } catch { throw httpError(502, '한글 문서 변환 서비스에 연결하지 못했습니다.'); }
      if (!r.ok) throw httpError(502, `한글 문서 변환에 실패했습니다(${r.status}).`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.subarray(0, 2).toString() !== 'PK') throw httpError(502, '한글 문서 변환 결과가 올바르지 않습니다.');
      res.writeHead(200, { 'content-type': 'application/hwp+zip', 'content-length': buf.length, 'cache-control': 'no-store' }); res.end(buf);
    }],
    // 개정 후 전문 다시 만들기(모델 없이): 화면에서 고친 조문들을 원 규정 전체에 다시 반영한다
    ['POST', '/api/fulltext', async (req, res) => {
      const b = await readJson(req);
      if (typeof b.doc_id !== 'string' || !b.doc_id || b.doc_id.length > 1500 || !Array.isArray(b.changes) || b.changes.length > 300) throw httpError(400, '규정과 변경 조문을 확인해 주세요.');
      const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
      const changes = b.changes.filter((c) => c && ['amend', 'insert', 'delete'].includes(c.op)).map((c) => ({ op: c.op, ref: str(c.ref, 40), after: str(c.after, 40) || undefined, new_ref: str(c.new_ref, 40) || undefined, title: str(c.title, 100), new: str(c.new, 20000) }));
      const doc = await srcFor(req).loadDoc(b.doc_id);
      sendJson(res, 200, { body: consolidatedDoc({ doc, changes, addendaText: str(b.addenda, 5000), normalize: normalizeArticle }) });
    }],
    ['POST', '/api/search', async (req, res) => {
      const sources = srcFor(req);
      const b = await readJson(req);
      if (typeof b.keyword !== 'string' || b.keyword.length > 200) throw httpError(400, '검색어를 확인해 주세요.');
      // 법제처 행정규칙·자치법규 검색(제명 또는 본문, 기관명으로 거르기) — 모델을 쓰지 않는 원문 검색
      if (b.corpus === 'ordin' || b.corpus === 'admrul') {
        if (!sources.gov?.enabled) throw httpError(400, '법제처 국가법령정보 연결이 없습니다. F12 설정에서 법제처 OC(인증키)를 넣어 주세요.');
        const kw = String(b.keyword).trim(), org = typeof b.inst === 'string' && b.inst.trim() ? b.inst.trim().slice(0, 60) : null;
        // 기관을 지정하면 그 기관 규정의 제명 검색을 먼저 하고(본문 검색은 전국 결과가 많아 앞쪽에 안 나올 수 있음) 본문 검색 결과를 합친다
        const seen = new Set(), rows = [];
        const push = (rs) => { for (const r of rs) if (!seen.has(r.doc_id)) { seen.add(r.doc_id); rows.push(r); } };
        if (org) push(await sources.gov.orgDocs({ target: b.corpus, org, pages: 1, extra: kw }).catch(() => []));
        // 본문 검색은 가나다순이라 관련 없는 규정이 앞에 온다 — 제명에 검색어가 든 규정을 먼저
        else push(await sources.gov.search({ target: b.corpus, keyword: kw, body: false, pages: 1 }).catch(() => []));
        push(await sources.gov.search({ target: b.corpus, keyword: kw, body: b.body !== false, pages: org ? 3 : 1, org }));
        return sendJson(res, 200, { rows: rows.slice(0, Math.min(100, +b.limit || 30)), source: '법제처' });
      }
      if (b.mode === 'law') return sendJson(res, 200, await sources.searchLaw(b.keyword, { targets: Array.isArray(b.targets) ? b.targets.filter((t) => ['law', 'admrul', 'ordin'].includes(t)) : ['law'] }));
      const q = Object.fromEntries(SEARCH_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
      q.limit = Math.min(50, Math.max(1, +q.limit || 10));
      const r = await sources.searchRegs(q);
      if (q.corpus === 'bylaws' && !q.all_versions) { const { dedupeEditions } = await import('../flows/common.mjs'); r.rows = dedupeEditions(r.rows, { byArticle: true }); }
      sendJson(res, 200, r);
    }],
    ['POST', '/api/law-versions', async (req, res) => { const sources = srcFor(req); const b = await readJson(req); sendJson(res, 200, await lawVersions(sources, { name: String(b.name || '').slice(0, 80), ref: String(b.ref || '').replace(/\s/g, ''), topic: String(b.topic || '').slice(0, 60) })); }],
    // 중앙행정기관 행정규칙·지방자치단체 자치법규 목록(법제처): org 가 있으면 그 기관 것만, q 는 제명 낱말
    ['GET', '/api/gov-regs', async (req, res, { query }) => {
      const sources = srcFor(req);
      const type = query.get('type'), org = String(query.get('org') || '').trim().slice(0, 60), q = String(query.get('q') || '').trim().slice(0, 60);
      if (!['local-gov', 'central-ministry'].includes(type)) throw httpError(400, '기관 유형이 올바르지 않습니다.');
      if (!sources.gov?.enabled) throw httpError(400, '법제처 국가법령정보 연결이 없습니다. F12 설정에서 법제처 OC(인증키)를 넣거나 규정 파일을 올려 주세요.');
      if (!org && !q) throw httpError(400, '기관명이나 규정명을 입력하세요.');
      const target = type === 'local-gov' ? 'ordin' : 'admrul';
      const rows = org ? await sources.gov.orgDocs({ target, org, pages: q ? 1 : 2, extra: q }) : await sources.gov.search({ target, keyword: q, body: false, pages: 1 });
      sendJson(res, 200, { rows: rows.slice(0, 100), source: target === 'ordin' ? '자치법규(법제처)' : '행정규칙(법제처)' });
    }],
    ['GET', '/api/orgs', (req, res, { query }) => sendJson(res, 200, { items: searchOrgs(String(query.get('type') || ''), String(query.get('q') || ''), 20), ...orgsInfo() })],
    ['GET', '/api/institutions', (req, res, { query }) => sendJson(res, 200, searchInstitutions(String(query.get('q') || '').slice(0, 40), 20))],
    ['POST', '/api/law-family', async (req, res) => { const sources = srcFor(req); const b = await readJson(req); sendJson(res, 200, await lawFamily(sources, b.name)); }],
    ['GET', '/api/doc', async (req, res, { query }) => sendJson(res, 200, await srcFor(req).loadDoc(query.get('id') || ''))],
    ['POST', '/api/upload', async (req, res, { ip }) => {
      const b = await readJson(req, 30 * 1024 * 1024);
      const files = Array.isArray(b.files) ? b.files : [];
      if (files.some((f) => !f || typeof f !== 'object' || (f.text !== undefined && typeof f.text !== 'string') || (f.base64 !== undefined && typeof f.base64 !== 'string'))) throw httpError(400, '파일 형식이 올바르지 않습니다.');
      if (!files.length || files.length > 20) throw httpError(400, '파일은 1~20개까지 올릴 수 있습니다.');
      const size = files.reduce((n, f) => n + String(f.text || f.base64 || '').length, 0);
      if (!quota.take(size, ip)) throw httpError(429, '오늘 업로드 한도를 넘었습니다. 내일 다시 시도하거나 직접 설치해 실행하세요.');
      const workId = workspace.create(), docs = [], errors = [];
      files.forEach((f, i) => {
        const name = (typeof f.name === 'string' && f.name.trim() ? f.name : `붙여넣기${i + 1}.txt`).slice(0, 120);
        try {
          const buf = typeof f.text === 'string' ? Buffer.from(f.text, 'utf8') : Buffer.from(String(f.base64 || ''), 'base64');
          if (!buf.length) throw httpError(400, '빈 파일입니다.');
          if (buf.length > 5 * 1024 * 1024) throw httpError(400, '파일당 5MB까지 올릴 수 있습니다.');
          const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase() || 'txt';
          if (!['hwpx', 'txt', 'md'].includes(ext)) throw httpError(400, 'hwpx·txt·md 파일만 지원합니다(한글 hwp는 hwpx로 저장해 올려 주세요).');
          const text = ext === 'hwpx' ? hwpxToText(buf) : buf.toString('utf8');
          const rec = workspace.addFile(workId, name, buf);
          const doc = parseRegulationText(text, { doc_id: `upload:${workId}/${i}`, title: undefined });
          if (!doc.articles.length) throw httpError(400, '조문(제N조)을 찾지 못했습니다. 규정 원문인지 확인해 주세요.');
          if (doc.articles.length > 1500) throw httpError(400, `조문이 너무 많습니다(${doc.articles.length}개). 규정 하나씩 나눠 올려 주세요.`);
          baseSources.registerUpload({ ...doc, file: rec.name, sha256: rec.sha256 });
          docs.push({ doc_id: doc.doc_id, title: doc.title, file: rec.name, n_articles: doc.articles.length, sha256: rec.sha256 });
        } catch (e) { errors.push({ file: name, error: e.status && e.status < 500 ? e.message : '파일을 읽지 못했습니다.' }); }
      });
      if (!docs.length) return sendJson(res, 400, { error: errors.map((e) => `${e.file}: ${e.error}`).join(' / '), errors });
      sendJson(res, 200, { workId, docs, errors, original_intact: workspace.verify(workId) });
    }],
    ['POST', '/api/jobs', async (req, res, { ip }) => {
      const b = await readJson(req, 256 * 1024);
      const runner = Object.hasOwn(flows, b.type) ? flows[b.type] : null;
      if (!runner) throw httpError(400, '지원하지 않는 작업입니다.');
      let llm; try { llm = llmFor(req); } catch (e) { throw httpError(400, e.message, e.code); }
      const id = jobs.start(b.type, b.input || {}, runner, { owner: ip, deps: { sources: srcFor(req), llm, env, procedures, workspace } });
      sendJson(res, 200, { id });
    }],
    ['GET', '/api/jobs/:id', (req, res, { params }) => { const j = jobs.get(params.id); return j ? sendJson(res, 200, j) : sendJson(res, 404, { error: '작업을 찾을 수 없습니다.' }); }],
    ['POST', '/api/jobs/:id/answer', async (req, res, { params }) => {
      const b = await readJson(req);
      const ok = jobs.answer(params.id, b.gate, b.value); sendJson(res, ok ? 200 : 409, ok ? { ok: true } : { ok: false, error: '이미 처리했거나 지금 기다리는 확인이 아닙니다. 화면을 새로 고쳐 주세요.' });
    }],
  ];
}
