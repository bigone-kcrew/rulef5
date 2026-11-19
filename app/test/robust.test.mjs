// 다양한 상황에서의 안정성 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { runAmend, normRef } from '../flows/amend.mjs';
const reply = (o) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(o) }, finish_reason: 'stop' }] }) });
const llmOf = (...objs) => { let i = 0; return createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(objs[Math.min(i++, objs.length - 1)]) }); };
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };
const DOC = parseRegulationText('가 규칙\n제79조(배우자 출산휴가) ① 10일의 휴가를 준다.\n② 유급으로 한다.\n③ 90일이 지나면 청구할 수 없다.', { doc_id: 'upload:eeeeeeeeeeeeeeee/0', title: '가 규칙' });
const sources = { loadDoc: async () => DOC, searchRegs: async () => ({ rows: [] }), rest: { search: async () => ({ rows: [] }) }, searchLaw: async () => ({ rows: [], errors: [] }), lawGo: { enabled: false } };

test('normRef accepts paragraph suffixes and spacing', () => {
  assert.deepEqual(normRef('제79조①'), { ref: '제79조', para: 1 });
  assert.deepEqual(normRef('제 7 조의2 제3항'), { ref: '제7조의2', para: 3 });
  assert.deepEqual(normRef('제79조'), { ref: '제79조', para: null });
});

test('paragraph-level changes from the model are merged into the whole article without losing other paragraphs', async () => {
  const llm = llmOf({ changes: [{ op: 'amend', ref: '제79조①', new_text: '① 20일의 휴가를 준다.', reason: 'a', basis_ids: [] }, { op: 'amend', ref: '제79조 제3항', new_text: '120일이 지나면 청구할 수 없다.', reason: 'b', basis_ids: [] }], reason_summary: 's', main_points: [], addenda: {}, checks: [] });
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('amend', { doc_id: DOC.doc_id, intent: '20일로', refs: ['제79조'], auto: true }, runAmend, { deps: { sources, llm } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.changes.length, 1);
  assert.equal(j.result.changes[0].new, '① 20일의 휴가를 준다.\n② 유급으로 한다.\n③ 120일이 지나면 청구할 수 없다.');
});

test('a human-confirmation gate times out instead of waiting forever', async () => {
  const jobs = createJobs({ gateTimeoutMs: 20 });
  const j = await until(jobs, jobs.start('t', {}, async (ctx) => { await ctx.gate({ id: 'g', prompt: 'p', options: [] }); }));
  assert.equal(j.status, 'failed'); assert.equal(j.error.code, 'gate_timeout');
});
