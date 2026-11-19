import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runAgent, classify, defaultPlan } from '../flows/agent.mjs';

const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmSeq = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const until = async (jobs, id, st = ['done', 'failed']) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (st.includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const calls = [];
const tools = {
  search_regulations: { desc: 'd', run: async (a) => { calls.push(['search', a]); return { summary: '3건: 가공단 복무규정 …', data: { rows: [{ doc_id: 'bylaws:x' }] } }; } },
  load_document: { desc: 'd', run: async (a, deps, st) => { calls.push(['load', a]); st.doc = { doc_id: 'bylaws:x', title: '복무규정' }; return { summary: '복무규정 60개 조문' }; } },
  procedure_next: { desc: 'd', run: async () => ({ summary: '다음: 관계 부서 협의' }) },
  ask_user: { desc: 'd', run: async (a, deps, st, ctx) => { const v = await ctx.gate({ id: 'ask', prompt: a.question, options: (a.options || []).map((o) => ({ value: o, label: o })) }); return { summary: `사용자 답: ${v}` }; } },
  finish: { desc: 'd', run: async (a) => ({ summary: a.summary || '끝', final: true }) },
};
const PLAN = { reply: '복무규정을 찾아 개정안을 만들겠습니다.', intents: ['amend'], params: { inst: '가공단', regulation: '복무규정', intent: '출산휴가 20일' }, plan: [{ tool: 'search_regulations', args: { inst: '가공단', keyword: '복무규정' } }, { tool: 'load_document', args: { pick: 'top' } }, { tool: 'procedure_next', args: {} }, { tool: 'finish', args: { summary: '완료' } }] };

test('classify picks the intent from wording', () => {
  assert.equal(classify('새로 재택근무 지침을 만들어야 해'), 'enact');
  assert.equal(classify('기관들 출장비 규정을 비교해줘'), 'similar');
  assert.equal(classify('우리 규정 인용 오류 점검해줘'), 'check');
  assert.equal(classify('남녀고용평등법이 바뀌었는데 영향 받는 조문 찾아줘'), 'impact');
  assert.equal(classify('배우자 출산휴가를 20일로 고쳐야 해'), 'amend');
  assert.ok(defaultPlan('amend', {}).some((s) => s.tool === 'draft_amendment'));
});

test('agent plans once, runs tools in order, records trace and plan progress', async () => {
  calls.length = 0;
  const jobs = createJobs();
  const id = jobs.start('agent', { message: '가공단 복무규정 출산휴가 20일로' }, runAgent, { deps: { llm: llmSeq(PLAN), tools } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.deepEqual(calls.map((c) => c[0]), ['search', 'load']);
  assert.ok(j.plan.steps.every((s) => s.done));
  assert.match(j.logs.map((l) => l.text).join('\n'), /search_regulations/);
  assert.equal(j.result.reply, PLAN.reply);
});

test('identical repeated tool calls are blocked', async () => {
  calls.length = 0;
  const p = { ...PLAN, plan: [PLAN.plan[0], PLAN.plan[0], PLAN.plan[3]] };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('agent', { message: 'x' }, runAgent, { deps: { llm: llmSeq(p), tools } }));
  assert.equal(calls.filter((c) => c[0] === 'search').length, 1);
  assert.match(j.logs.map((l) => l.text).join('\n'), /반복/);
});

test('unknown tools are skipped and plans longer than 12 steps are cut', async () => {
  const p = { ...PLAN, plan: [{ tool: 'rm_rf', args: {} }, ...Array.from({ length: 14 }, (_, i) => ({ tool: 'procedure_next', args: { i } }))] };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('agent', { message: 'x' }, runAgent, { deps: { llm: llmSeq(p), tools } }));
  const log = j.logs.map((l) => l.text).join('\n');
  assert.match(log, /알 수 없는 도구/); assert.match(log, /단계 상한/);
  assert.ok(j.steps.filter((s) => /^\d+\. /.test(s.name)).length <= 12);
});

test('invalid plan JSON twice falls back to the default flow', async () => {
  let fell = null;
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('agent', { message: '배우자 출산휴가를 20일로 고쳐야 해' }, runAgent, { deps: { llm: llmSeq('계획 없음', '여전히 없음'), tools, fallback: async (intent) => { fell = intent; return { kind: '개정' }; } } }));
  assert.equal(j.status, 'done'); assert.equal(fell, 'amend');
  assert.match(j.logs.map((l) => l.text).join('\n'), /기본 흐름으로 전환/);
});

test('ask_user pauses the agent for a human answer', async () => {
  const p = { ...PLAN, plan: [{ tool: 'ask_user', args: { question: '어느 규정인가요?', options: ['복무규정', '취업규칙'] } }, { tool: 'finish', args: {} }] };
  const jobs = createJobs();
  const id = jobs.start('agent', { message: 'x' }, runAgent, { deps: { llm: llmSeq(p), tools } });
  await until(jobs, id, ['waiting']);
  assert.equal(jobs.get(id).gate.prompt, '어느 규정인가요?');
  jobs.answer(id, 'ask', '취업규칙');
  const j = await until(jobs, id);
  assert.match(j.logs.map((l) => l.text).join('\n'), /사용자 답: 취업규칙/);
});

test('cleanRefs keeps only article numbers that exist in the document', async () => {
  const { cleanRefs } = await import('../flows/tools.mjs');
  const doc = { articles: [{ ref: '제79조', section: '본칙' }, { ref: '제1조', section: '부칙' }] };
  assert.deepEqual(cleanRefs(['배우자 출산휴가 조항', '제79조', '제1조', '제99조'], doc), ['제79조']);
  assert.equal(cleanRefs('제79조', doc), undefined);
});

test('a failed drafting tool without result fails the job instead of reporting done', async () => {
  const t2 = { ...tools, draft_amendment: { desc: 'd', run: async () => { throw Object.assign(new Error('조문을 찾지 못했습니다.'), { code: 'unknown_ref' }); } } };
  const p = { ...PLAN, plan: [{ tool: 'draft_amendment', args: {} }, { tool: 'finish', args: {} }] };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('agent', { message: 'x' }, runAgent, { deps: { llm: llmSeq(p, { thought: 't', tool: 'finish', args: {} }), tools: t2 } }));
  assert.equal(j.status, 'failed');
  assert.match(j.error.message, /조문을 찾지 못했습니다/);
});

test('agent shows a provisional plan right away, marks the running step, and closes unexecuted steps at the end', async () => {
  const { createJobs } = await import('../lib/jobs.mjs');
  const { runAgent } = await import('../flows/agent.mjs');
  const plans = [];
  let release;
  const tools = { find_similar: { desc: 'x', args: {}, run: () => new Promise((r) => { release = () => r({ summary: 'ok', final: true }); }) }, build_comparison_table: { desc: 'x', args: {}, run: async () => ({ summary: 'ok' }) }, finish: { desc: 'x', args: {}, run: async () => ({ summary: 'done', final: true }) } };
  const jobs = createJobs();
  const id = jobs.start('agent', { message: '다른 기관 출장비 규정을 비교해줘' }, async (ctx) => { const orig = ctx.setPlan; ctx.setPlan = (p) => { plans.push(JSON.parse(JSON.stringify(p))); orig(p); }; return runAgent(ctx); }, { deps: { llm: null, tools, sources: {} } });
  for (let i = 0; i < 100 && !release; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(plans[0].provisional); assert.ok(plans[0].steps.length >= 2);
  const running = jobs.get(id).plan; assert.equal(running.current, 0); assert.equal(running.remaining, running.steps.length);
  release();
  for (let i = 0; i < 100 && jobs.get(id).status === 'running'; i++) await new Promise((r) => setTimeout(r, 5));
  const fin = jobs.get(id).plan;
  assert.equal(fin.finished, true); assert.equal(fin.current, null); assert.equal(fin.remaining, 0);
  assert.ok(fin.steps.slice(1).every((s) => s.notRun));
});

test('a plan without the main action for the request is sent back; if it stays incomplete the default plan is used', async () => {
  const { createJobs } = await import('../lib/jobs.mjs');
  const { runAgent } = await import('../flows/agent.mjs');
  const { createLlm } = await import('../lib/llm.mjs');
  const replyOf = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
  let n = 0;
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => replyOf({ reply: '규정명을 알려 주세요', intents: ['amend'], plan: [{ tool: 'ask_user', args: { question: '규정?' } }] }, n++) });
  const ran = [];
  const tool = (name) => ({ desc: name, args: {}, run: async () => { ran.push(name); return { summary: name, final: name === 'finish' }; } });
  const tools = Object.fromEntries(['search_regulations', 'load_document', 'draft_amendment', 'procedure_next', 'finish', 'ask_user'].map((k) => [k, tool(k)]));
  const jobs = createJobs();
  const id = jobs.start('agent', { message: '가공단 복무규정의 배우자 출산휴가를 20일로 고쳐야 해' }, runAgent, { deps: { llm, tools, sources: {} } });
  for (let i = 0; i < 200 && ['running', 'waiting'].includes(jobs.get(id).status); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(n >= 2, 'plan was retried');
  assert.ok(ran.includes('draft_amendment'), JSON.stringify(ran));
});
