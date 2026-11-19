// 최종 검토 지적 사항 재현 테스트
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDocs } from '../flows/check.mjs';
import { parseRegulationText } from '../lib/parse.mjs';
import { unzipEntries, hwpxToText } from '../lib/unzip.mjs';
import { zip, makeHwpx } from './fixtures/make-hwpx.mjs';
import { extractCitations, renumber, corrections } from '../lib/refs.mjs';
import { toCsv } from '../lib/table.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { runCheck } from '../flows/check.mjs';
import { runLawChain } from '../flows/lawchain.mjs';
import { assertPublicHost } from '../lib/llm.mjs';
import { createUploadQuota } from '../lib/routes.mjs';

const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };

test('C1: user term lists are escaped and validated (no ReDoS, no TypeError)', () => {
  const d = parseRegulationText('가 규정\n제1조(정의) "직원"이란 근무자를 말한다.\n제2조(가) ' + 'a'.repeat(40) + '! 내용', { doc_id: 'u', title: '가 규정' });
  const t0 = Date.now();
  checkDocs([d], { terms: { 직원: ['(a+)+$', 5, 'x'.repeat(500)], 나쁜: 5 } });
  assert.ok(Date.now() - t0 < 1000);
});

test('C2: zip bombs are rejected by a total inflate budget and unused entries are not inflated', () => {
  const big = 'A'.repeat(20 * 1024 * 1024);
  const bomb = zip([['mimetype', 'application/hwp+zip'], ['Contents/section0.xml', '<hp:p><hp:t>제1조(목적) 가</hp:t></hp:p>'], ...Array.from({ length: 4 }, (_, i) => [`BinData/x${i}.bin`, big])], { deflate: true });
  assert.match(hwpxToText(bomb), /제1조/);
  const bomb2 = zip(Array.from({ length: 4 }, (_, i) => [`Contents/section${i}.xml`, big]), { deflate: true });
  assert.throws(() => hwpxToText(bomb2), (e) => e.code === 'invalid_hwpx');
  assert.ok(unzipEntries(makeHwpx('x'), (n) => n === 'mimetype').has('mimetype'));
});

test('I1: "부칙 제N조" citations are not same-document article citations and are not renumbered', () => {
  assert.equal(extractCitations('부칙 제2조에 따른 경과조치')[0].kind, 'external');
  const d = parseRegulationText('가 규정\n제1조(가) 가.\n제2조(나) 부칙 제2조와 제2조에 따른다.', { doc_id: 'A', title: '가 규정' });
  const { map } = renumber(d, [{ op: 'insert', after: '제1조', renumber: true }]);
  assert.equal(corrections([d], 'A', map).find((r) => r.ref === '제2조').after, '부칙 제2조와 제3조에 따른다.');
});

test('I2: check fails when no document could be loaded', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('check', { doc_ids: ['bylaws:x'] }, runCheck, { deps: { sources: { loadDoc: async () => { throw new Error('down'); } }, llm: null } }));
  assert.equal(j.status, 'failed'); assert.match(j.error.message, /불러오지 못했/);
});

test('I2: law chain reports law search failure instead of asking for input', async () => {
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('lawchain', { law_name: '근로기준법', ref: '제1조' }, runLawChain, { deps: { sources: { searchLaw: async () => ({ rows: [], errors: ['ALIO', '법제처'] }) }, llm: null } }));
  assert.equal(j.status, 'failed'); assert.match(j.error.message, /조회.*실패/);
});

test('I3: hostnames that resolve to private addresses are rejected', async () => {
  await assert.rejects(assertPublicHost('https://localtest.me/v1', async () => [{ address: '127.0.0.1' }]), (e) => e.code === 'bad_llm_url');
  await assert.rejects(assertPublicHost('https://x.example/v1', async () => [{ address: '10.0.0.5' }]), (e) => e.code === 'bad_llm_url');
  await assertPublicHost('https://api.example.com/v1', async () => [{ address: '8.8.8.8' }]);
});

test('I4: upload quota rejects after the daily byte budget', () => {
  const q = createUploadQuota({ dailyBytes: 1000 });
  assert.equal(q.take(600), true); assert.equal(q.take(600), false);
});

test('M6: csv cells starting with formula characters are neutralized', () => {
  assert.match(toCsv([{ ref: '=1+1', oldHtml: '@x', newHtml: '-y' }]), /'=1\+1,'@x,'-y/);
});
