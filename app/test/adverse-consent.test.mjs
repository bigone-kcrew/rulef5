// 불리한 변경: 담당자가 고른다 — 유리한 내용 유지(자체 검토가 되살림) / 불리한 변경으로 진행(동의 절차를 문서에 넣음)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRegulationText } from '../lib/parse.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { createLlm } from '../lib/llm.mjs';
import { runAmend } from '../flows/amend.mjs';

const SAMPLE = parseRegulationText(readFileSync(new URL('./fixtures/복무규정_예시.md', import.meta.url), 'utf8'), { doc_id: 'upload:aaaaaaaaaaaaaaaa/0' });
const sources = { loadDoc: async () => SAMPLE, searchRegs: async () => ({ rows: [] }), searchLaw: async () => ({ rows: [], errors: [] }), rest: { search: async () => ({ rows: [{ doc_id: 'legal:x', doc_title: '테스트법', art_ref: '제1조', art_title: '휴가', body: '사업주는 근로자에게 5일 이상의 휴가를 주어야 한다는 기준을 정한다.' }] }) }, lawGo: { enabled: false } };
const reply = (obj) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: 'stop' }] }) });
const CUT = { changes: [{ op: 'amend', ref: '제7조', title: '특별휴가', new_text: '① 공단은 직원에게 별표 1의 경조사휴가를 준다.\n② 공단은 배우자가 출산한 직원에게 5일의 배우자 출산휴가를 주어야 한다. 이 경우 출산한 날부터 90일 이내에 청구하여야 하며, 1회에 한하여 나누어 사용할 수 있다.\n③ 제2항의 휴가 기간 중 최초 5일은 유급으로 한다.', reason: '조정', basis_ids: ['E1'] }], reason_summary: '배우자 출산휴가를 조정한다.', main_points: ['제7조'], addenda: { effective: '이 규정은 발령한 날부터 시행한다.', transition: '' }, checks: [] };
const llm = () => createLlm({ preset: 'custom', baseUrl: 'https://m.example/v1', apiKey: 'k', model: 'm', extra: {}, source: 'user' }, { fetchImpl: async () => reply(CUT) });
async function run(input, choice) {
  const jobs = createJobs(); const id = jobs.start('amend', { doc_id: SAMPLE.doc_id, refs: ['제7조'], profile: { type: 'public-institution', name: '가나다공단' }, ...input }, runAmend, { deps: { sources, llm: llm() } });
  const seen = [];
  for (let i = 0; i < 600; i++) {
    const j = jobs.get(id);
    if (['done', 'failed'].includes(j.status)) return { j, seen };
    if (j.status === 'waiting' && j.gate && !seen.includes(j.gate.id)) { seen.push(j.gate.id); const g = j.gate; await jobs.answer(id, g.id, g.id === 'adverse_choice' ? choice : g.multi ? g.options.filter((o) => o.checked).map((o) => o.value) : g.options[0].value); }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout');
}

test('choosing to proceed with a less favorable change keeps it and adds the consent procedure', async () => {
  const { j, seen } = await run({ intent: '배우자 출산휴가를 법 기준에 맞춘다' }, 'cut');
  assert.equal(j.status, 'done', JSON.stringify(j.error)); assert.ok(seen.includes('adverse_choice'));
  assert.equal(j.result.consent.required, true); assert.equal(j.result.consent.items[0].ref, '제7조');
  const sec = Object.fromEntries(j.result.docset.sections.map((s) => [s.id, s]));
  assert.match(sec.checklist.body, /【동의 필요】.*근로기준법 제94조제1항/);
  assert.equal(sec.labor_opinion.title, '근로자 동의서(불리한 변경)'); assert.match(sec.labor_opinion.body, /■ 해당\(동의 필요\)/); assert.match(sec.labor_opinion.body, /동의 여부/);
});

test('choosing to keep favorable provisions does not ask for consent', async () => {
  const { j } = await run({ intent: '배우자 출산휴가를 법 기준에 맞춘다' }, 'keep');
  assert.equal(j.status, 'done', JSON.stringify(j.error)); assert.equal(j.result.consent, null);
  assert.doesNotMatch(j.result.docset.sections.find((s) => s.id === 'checklist').body, /【동의 필요】/);
});

test('in follow-recommendation mode an explicit reduction proceeds with consent, otherwise favorable provisions are kept', async () => {
  const cut = await run({ intent: '배우자 출산휴가를 5일로 줄인다', auto: true });
  assert.equal(cut.j.result.consent?.required, true); assert.ok(!cut.seen.includes('adverse_choice'));
  const keep = await run({ intent: '배우자 출산휴가를 법 기준에 맞춘다', auto: true });
  assert.equal(keep.j.result.consent, null);
});
