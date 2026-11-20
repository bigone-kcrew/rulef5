// 작업 실행기: 단계(step)·사람 확인(gate)·기록(log) 상태를 보관하고 화면이 폴링한다.
import { randomBytes } from 'node:crypto';
const busy = () => Object.assign(new Error('지금 처리 중인 작업이 많습니다. 잠시 후 다시 시도해 주세요.'), { status: 429, code: 'busy' });

// onEnd(record): 작업이 끝날 때 개선용 기록(내용 없이 상태·시간·지표)을 넘긴다 — 사용자 입력·접속 주소는 넣지 않는다
export function createJobs({ maxConcurrent = 4, ttlMs = 3600e3, gateTimeoutMs = 30 * 60e3, maxWaiting = 30, maxWaitingPerOwner = 6, maxRunningPerOwner = 3, onEnd = null, maxRunMs = 15 * 60e3 } = {}) {
  const jobs = new Map();
  const running = () => [...jobs.values()].filter((j) => j.status === 'running').length;
  const sweep = () => { const t = Date.now() - ttlMs; for (const [k, j] of jobs) if (j.updated < t) jobs.delete(k); };

  function start(type, input, runner, extras = {}) {
    sweep();
    if (running() >= maxConcurrent || [...jobs.values()].filter((j) => j.status === 'waiting').length >= maxWaiting) throw busy();
    // 한 사용자(접속 주소)가 대기열을 다 차지하지 못하게 한다
    const owner = extras.owner || null;
    if (owner) { const mine = [...jobs.values()].filter((j) => j.owner === owner); if (mine.filter((j) => j.status === 'waiting').length >= maxWaitingPerOwner || mine.filter((j) => j.status === 'running').length >= maxRunningPerOwner) throw busy(); }
    const id = randomBytes(9).toString('base64url');
    const job = { id, type, owner, status: 'running', steps: [], logs: [], gate: null, result: null, error: null, plan: null, created: Date.now(), updated: Date.now(), waiter: null, gates: [], metrics: {} };
    jobs.set(id, job);
    const touch = () => { job.updated = Date.now(); };
    const ctx = {
      id, input, ...extras,
      async step(name, fn) {
        const s = { name, state: 'running', note: null, evidence: [], started: Date.now(), ms: null }; job.steps.push(s); touch();
        const h = { note: (t) => { s.note = t; touch(); }, evidence: (e) => { s.evidence.push(...[].concat(e)); touch(); } };
        try { const r = await fn(h); s.state = 'done'; s.ms = Date.now() - s.started; touch(); return r; } catch (e) { s.state = 'failed'; s.ms = Date.now() - s.started; s.note = e.message; touch(); throw e; }
      },
      skip(name, reason) { job.steps.push({ name, state: 'skipped', note: reason, evidence: [] }); touch(); },
      log(text, evidence) { job.logs.push({ t: Date.now(), text, evidence: evidence || null }); if (job.logs.length > 300) job.logs.shift(); touch(); },
      setPlan(plan) { job.plan = plan; touch(); },
      // 개선용 지표(개수·참거짓·짧은 코드만)
      metric(k, v) { job.metrics[k] = v; },
      gate(g) {
        job.gates.push({ id: String(g.id).replace(/_\d{6,}$/, ''), at: Date.now(), waited: null });
        job.status = 'waiting'; job.gate = { id: g.id, prompt: g.prompt, options: g.options || null, multi: !!g.multi, schema: g.schema || null, data: g.data || null }; touch();
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { if (job.waiter?.id === g.id) { job.waiter = null; reject(Object.assign(new Error('확인을 기다리다 시간이 지났습니다(30분). 다시 실행해 주세요.'), { code: 'gate_timeout', status: 408 })); } }, gateTimeoutMs);
          timer.unref?.();
          job.waiter = { id: g.id, resolve: (v) => { clearTimeout(timer); resolve(v); } };
        });
      },
    };
    // 실제 작업 시간(담당자 확인 대기 제외)이 maxRunMs 를 넘으면 실패로 끝낸다 — 외부 서비스가 매우 느릴 때 작업이 한없이 남지 않게
    let over = false;
    const waited = () => job.gates.reduce((t, g) => t + (g.waited ?? (job.status === 'waiting' ? Date.now() - g.at : 0)), 0);
    const watch = setInterval(() => {
      if (job.status !== 'running' || Date.now() - job.created - waited() < maxRunMs) return;
      over = true; clearInterval(watch);
      job.status = 'failed'; job.error = { code: 'job_timeout', message: `작업이 ${Math.round(maxRunMs / 60e3)}분을 넘어 중단했습니다. 서버나 외부 서비스가 붐빌 수 있으니 잠시 뒤 다시 실행해 주세요.` }; touch();
      end();
    }, Math.min(30e3, Math.max(20, maxRunMs / 4)));
    watch.unref?.();
    let ended = false;
    const end = () => {
      if (ended) return; ended = true; clearInterval(watch);
      job.gate = null; job.waiter = null; touch();
      if (onEnd) { try { const m = extras.deps?.llm?.config; onEnd({ t: new Date(job.created).toISOString(), id: job.id.slice(0, 6), type, status: job.status, ms: Date.now() - job.created, model: m ? `${m.preset}:${m.model}${m.source === 'user' ? '(user)' : ''}` : null, error: job.error ? { code: job.error.code, message: String(job.error.message).slice(0, 200) } : null, failed_step: job.steps.find((s) => s.state === 'failed')?.name || null, steps: job.steps.map((s) => [s.name, s.state, s.ms ?? null]), gates: job.gates.map((g) => [g.id, g.waited]), metrics: job.metrics }); } catch { /* 기록 실패는 무시 */ } }
    };
    Promise.resolve().then(() => runner(ctx)).then((r) => { if (over) return; job.result = r ?? null; job.status = 'done'; }, (e) => {
      if (over) return;
      job.status = 'failed'; job.error = { code: e.code || 'error', message: (e.status && e.status < 500) || (e.code && !/^(E[A-Z]+|ERR_)/.test(String(e.code))) ? e.message : '처리 중 오류가 발생했습니다.' };
      if ((!e.code && !e.status) || /^(E[A-Z]+|ERR_)/.test(String(e.code || ''))) console.error('[job]', type, e);
    }).finally(end);
    return id;
  }

  function get(id) {
    const j = jobs.get(id); if (!j) return null;
    j.polled = Date.now(); // 화면이 지켜보고 있는지(확인 대기 작업이 버려졌는지) 판단용
    const { waiter, owner, gates, metrics, polled, ...view } = j; return JSON.parse(JSON.stringify(view));
  }
  function answer(id, gateId, value) {
    const j = jobs.get(id);
    if (!j || !j.waiter || j.waiter.id !== gateId) return false;
    const w = j.waiter; j.waiter = null; j.gate = null; j.status = 'running'; j.updated = Date.now();
    const g = j.gates.at(-1); if (g && g.waited == null) g.waited = Date.now() - g.at;
    w.resolve(value); return true;
  }
  // 진행 중(실행·확인 대기) 작업 수 — 서버를 다시 띄우기 전에 확인한다(작업은 메모리에만 있다)
  // 실행 중 작업 + 최근 5분 안에 화면이 확인한 확인 대기 작업(창을 닫아 버려진 확인 대기는 세지 않는다 — 30분 뒤 자동 종료)
  const active = () => [...jobs.values()].filter((j) => j.status === 'running' || (j.status === 'waiting' && Date.now() - (j.polled || j.updated) < 5 * 60e3)).length;
  return { start, get, answer, active };
}
