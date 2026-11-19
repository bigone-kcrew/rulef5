import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runImpact, numericChanges, judge } from '../flows/impact.mjs';
import { runSimilar } from '../flows/similar.mjs';

const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmOf = (o) => createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(o) });
const row = (inst, ref, body) => ({ doc_id: `bylaws:${inst}`, inst_name: inst, doc_title: '복무규정', art_ref: ref, art_title: '배우자 출산휴가', body, edition_state: 'current' });
const sources = { searchRegs: async () => ({ rows: [row('가공단', '제7조', '배우자 출산휴가는 10일로 한다.'), row('나공단', '제9조', '배우자 출산휴가는 20일로 한다.'), row('다공단', '제3조', '배우자가 출산하면 휴가를 준다.')] }), related: async () => null, mcp: { enabled: false } };

test('numericChanges pairs number+unit values that changed', () => {
  assert.deepEqual(numericChanges('10일의 휴가, 90일 이내', '20일의 휴가, 120일 이내'), [{ from: '10일', to: '20일' }, { from: '90일', to: '120일' }]);
  assert.deepEqual(numericChanges('5일', '5일'), []);
});

test('judge marks old values as candidates and new values as reflected', () => {
  const ch = [{ from: '10일', to: '20일' }];
  assert.equal(judge('10일로 한다', ch).status, 'candidate');
  assert.equal(judge('20일로 한다', ch).status, 'reflected');
  assert.equal(judge('휴가를 준다', ch).status, 'check');
});

test('impact flow classifies candidate regulations without a model', async () => {
  const jobs = createJobs();
  const id = jobs.start('impact', { law_name: '남녀고용평등법', before: { text: '배우자 출산휴가는 10일로 한다.' }, after: { text: '배우자 출산휴가는 20일로 한다.' }, topic: '배우자 출산휴가', auto: true }, runImpact, { deps: { sources, llm: null } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  const by = Object.fromEntries(j.result.candidates.map((c) => [c.inst, c.status]));
  assert.deepEqual(by, { 가공단: 'candidate', 나공단: 'reflected', 다공단: 'check' });
  assert.equal(j.result.candidates[0].status, 'candidate');
  assert.match(j.result.candidates[0].amend.intent, /20일/);
});

test('similar flow drops extracted values that are not in the source text', async () => {
  const llm = llmOf({ columns: ['일수'], rows: [{ key: '0', values: { 일수: '10일' } }, { key: '1', values: { 일수: '30일' } }] });
  const jobs = createJobs();
  const id = jobs.start('similar', { topic: '배우자 출산휴가', extract: true, auto: true }, runSimilar, { deps: { sources, llm } });
  const j = await until(jobs, id);
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.table[0].values.일수, '10일');
  assert.equal(j.result.table[1].values.일수, undefined);
});

test('judge only looks at sentences about the topic (no false positive from other leave types)', () => {
  const ch = [{ from: '10일', to: '20일' }];
  const body = '① 가족돌봄휴가는 연간 10일 이내로 한다. ② 배우자 출산휴가는 20일로 한다.';
  assert.equal(judge(body, ch, '배우자 출산휴가').status, 'reflected');
  assert.equal(judge('① 가족돌봄휴가는 연간 10일 이내로 한다.', ch, '배우자 출산휴가').status, 'check');
  assert.equal(judge('② 배우자 출산휴가는 10일로 한다.', ch, '배우자 출산휴가').status, 'candidate');
});

test('similar rejects placeholder column names and retries', async () => {
  let n = 0;
  const llm = createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(++n === 1 ? { columns: ['항목'], rows: [] } : { columns: ['일수'], rows: [{ key: '0', values: { 일수: '10일' } }] }) });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('similar', { topic: '배우자 출산휴가', auto: true }, runSimilar, { deps: { sources, llm } }));
  assert.equal(n, 2); assert.deepEqual(j.result.columns, ['일수']);
});

test('impact AI judging skips articles without topic sentences and keeps "판단 불가" as check', async () => {
  const llm = llmOf({ results: [{ key: 'bylaws:다공단#제3조', status: 'candidate', reason: '판단 불가' }] });
  const src = { ...sources, searchRegs: async () => ({ rows: [row('라공단', '제1조', '이 규정은 목적을 정한다.'), row('다공단', '제3조', '배우자 출산휴가를 준다.')] }) };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('impact', { law_name: '법', before: { text: '배우자 출산휴가 10일' }, after: { text: '배우자 출산휴가 20일' }, topic: '배우자 출산휴가', auto: true }, runImpact, { deps: { sources: src, llm } }));
  const by = Object.fromEntries(j.result.candidates.map((c) => [c.inst, c.status]));
  assert.deepEqual(by, { 라공단: 'check', 다공단: 'check' });
});

test('judge uses the article title as topic context', () => {
  const ch = [{ from: '10일', to: '20일' }];
  assert.equal(judge('① 재단은 직원이 배우자의 출산을 이유로 휴가를 청구하는 경우 10일의 휴가를 주어야 한다.', ch, '배우자 출산휴가', '배우자 출산휴가').status, 'candidate');
});

test('impact searches shortened topic variants and keeps rows with old values first', async () => {
  const qs = [];
  const many = Array.from({ length: 70 }, (_, i) => row(`기관${i}`, '제1조', '배우자 출산휴가는 20일로 한다.'));
  const src = { ...sources, searchRegs: async (q) => { qs.push(q.keyword); return { rows: q.keyword === '배우자 출산' ? [...many, row('대구재단', '제79조', '배우자의 출산을 이유로 10일의 휴가를 준다.')] : many }; } };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('impact', { law_name: '법', before: { text: '10일' }, after: { text: '20일' }, topic: '배우자 출산휴가', auto: true }, runImpact, { deps: { sources: src, llm: null } }));
  assert.ok(qs.includes('배우자 출산'));
  assert.equal(j.result.candidates.find((c) => c.inst === '대구재단')?.status, 'candidate');
});
