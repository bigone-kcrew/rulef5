// 감시 법령 제안(법제처 시행일 기준 법령)과, ALIO 연혁에 없을 때 법제처 연혁으로 하는 레이더 비교
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../lib/jobs.mjs';
import { runRadar, suggestLaws } from '../flows/radar.mjs';
import { kstToday } from '../lib/law-go.mjs';

const day = (n) => { const d = new Date(Date.now() + 9 * 3600e3 + n * 86400e3); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const row = (name, eff, change = '일부개정', kind = '법률') => ({ name, mst: name.length + eff, eff, anc: eff, kind, change, dept: '', state: '' });
const until = async (jobs, id) => { for (let i = 0; i < 400; i++) { const j = jobs.get(id); if (['done', 'failed'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 5)); } throw new Error('timeout'); };

test('suggested laws follow the institution type, group decrees with their act and skip unrelated laws', async () => {
  const ahead = [row('근로기준법', day(20)), row('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률 시행령', day(5), '일부개정', '대통령령'), row('화장품법', day(3)), row('지방공무원법', day(10)), row('군인사법', day(4)), row('공무원 직제', day(4))];
  const past = [row('개인정보 보호법', day(-30), '타법개정')];
  const sources = { lawGo: { enabled: true, effective: async (from) => (from === kstToday() ? ahead : past) } };
  const pub = await suggestLaws(sources, { org_type: 'public-institution' });
  const names = pub.items.map((x) => x.law);
  assert.ok(names.includes('근로기준법')); assert.ok(names.includes('남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률'));
  assert.ok(!names.includes('화장품법') && !names.includes('군인사법') && !names.includes('지방공무원법'));
  assert.equal(pub.items.find((x) => x.law === '개인정보 보호법').state, 'recent');
  const local = await suggestLaws(sources, { org_type: 'local-gov' });
  assert.equal(local.items[0].law, '지방공무원법');
  assert.equal((await suggestLaws({ lawGo: { enabled: false } })).disabled, true);
});

test('radar uses 법제처 version history when the ALIO corpus has no scheduled version', async () => {
  const doc = (body, eff) => ({ doc_id: `law:law:${eff}`, title: '테스트법', edition: { effective_from: eff }, articles: [{ ref: '제5조', title: '배우자 출산휴가', body, section: '본칙' }] });
  const v1 = day(-200), v2 = day(40);
  const sources = {
    rest: { search: async () => ({ rows: [] }) }, loadDoc: async () => null,
    searchRegs: async () => ({ rows: [{ doc_id: 'bylaws:a', inst_name: '가공단', doc_title: '복무규정', art_ref: '제7조', art_title: '배우자 출산휴가', body: '배우자 출산휴가는 10일로 한다.' }] }),
    lawGo: { enabled: true, timeline: async (name) => (name === '테스트법' ? [{ mst: '1', eff: v1 }, { mst: '2', eff: v2 }] : []), textAt: async (mst, eff) => doc(mst === '2' ? '배우자 출산휴가는 20일로 한다.' : '배우자 출산휴가는 10일로 한다.', eff) },
  };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['테스트법'] }, runRadar, { deps: { sources, llm: null } }));
  assert.equal(j.status, 'done', JSON.stringify(j.error));
  assert.equal(j.result.items.length, 1); assert.equal(j.result.items[0].effective_from, v2);
  assert.equal(j.result.items[0].affected[0].status, 'candidate');
  assert.match(j.steps[0].note, /법제처 판본/);
});

test('radar falls back to 법제처 when ALIO has the scheduled version but nothing earlier to compare with', async () => {
  const v1 = day(-200), v2 = day(40);
  const doc = (body, eff) => ({ doc_id: `law:law:${eff}`, title: '테스트법', edition: { effective_from: eff }, articles: [{ ref: '제5조', title: '배우자 출산휴가', body, section: '본칙' }] });
  const sources = {
    rest: { search: async () => ({ rows: [{ doc_id: 'legal:v2', doc_title: '테스트법', edition_state: 'scheduled', effective_from: v2 }] }) }, loadDoc: async () => null,
    searchRegs: async () => ({ rows: [] }),
    lawGo: { enabled: true, timeline: async () => [{ mst: '1', eff: v1 }, { mst: '2', eff: v2 }], textAt: async (mst, eff) => doc(mst === '2' ? '20일로 한다.' : '10일로 한다.', eff) },
  };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['테스트법'] }, runRadar, { deps: { sources, llm: null } }));
  assert.equal(j.result.items.length, 1); assert.match(j.steps[0].note, /법제처 판본/);
});

import { checkLawsLive, upcomingChecks } from '../flows/common.mjs';
test('law evidence is checked against the current 법제처 text and flags an upcoming change', async () => {
  const today = '20261122';
  const doc = (body) => ({ articles: [{ ref: '제18조의2', section: '본칙', title: '배우자 출산휴가', body }] });
  const texts = { '1': '사업주는 10일의 휴가를 주어야 한다.', '2': '사업주는 20일의 휴가를 주어야 한다.', '3': '사업주는 25일의 휴가를 주어야 한다.' };
  const sources = { lawGo: { enabled: true, timeline: async () => [{ mst: '1', eff: '20250101' }, { mst: '2', eff: '20260918' }, { mst: '3', eff: '20270101' }], textAt: async (mst) => doc(texts[mst]) } };
  const ev = [{ id: 'E1', kind: '관련 법령', law: '남녀고용평등법', label: '남녀고용평등법 제18조의2', ref: '제18조의2', doc_id: 'legal:old', text: '사업주는 10일의 휴가를 주어야 한다.', edition: '현행' }, { id: 'E2', kind: '유사 규정', label: 'x', text: 'y' }];
  await checkLawsLive(sources, ev, { today });
  assert.match(ev[0].text, /^사업주는 20일/); assert.equal(ev[0].doc_id, 'law:law:2');
  assert.match(ev[0].edition, /법제처 확인 — 옛 사본을 현행으로 바꿈/); assert.match(ev[0].edition, /2027-01-01 개정 시행예정/);
  assert.equal(ev[0].upcoming.eff, '20270101'); assert.match(ev[0].text, /아직 시행 전\] 사업주는 25일/);
  assert.equal(ev[1].upcoming, undefined);
  assert.match(upcomingChecks(ev)[0], /\[E1\].*2027-01-01부터 바뀔 예정/);
  const broken = [{ ...ev[0], text: '그대로', upcoming: undefined }];
  await checkLawsLive({ lawGo: { enabled: true, timeline: async () => { throw new Error('down'); } } }, broken, { today });
  assert.equal(broken[0].text, '그대로');
});

test('with our institution set, wording-only changes still find our same-topic articles and every hit carries an amendment preset', async () => {
  const v1 = day(-200), v2 = day(40);
  const doc = (body, eff, extra = []) => ({ doc_id: `law:law:${eff}`, title: '테스트법', edition: { effective_from: eff }, articles: [{ ref: '제5조', title: '난임치료휴가', body, section: '본칙' }, { ref: '제2조', title: '정의', body: eff === v2 ? '바뀐 정의' : '옛 정의', section: '본칙' }, ...extra] });
  const calls = [];
  const sources = {
    rest: { search: async () => ({ rows: [] }) }, loadDoc: async () => null,
    searchRegs: async (q) => { calls.push(q); return { rows: [{ doc_id: 'bylaws:ours', inst_name: '가공단', doc_title: '복무규정', art_ref: '제22조', art_title: '난임치료휴가', body: '난임치료휴가를 청구하면 휴가를 준다.' }] }; },
    lawGo: { enabled: true, timeline: async () => [{ mst: '1', eff: v1 }, { mst: '2', eff: v2 }], textAt: async (mst, eff) => doc(mst === '2' ? '난임치료를 받는 근로자에게 휴가를 주어야 하며 분할 사용할 수 있다.' : '난임치료를 받는 근로자에게 휴가를 주어야 한다.', eff) },
  };
  const jobs = createJobs();
  const j = await until(jobs, jobs.start('radar', { laws: ['테스트법'], inst: '가공단' }, runRadar, { deps: { sources, llm: null } }));
  const it = j.result.items.find((x) => x.ref === '제5조');
  assert.equal(it.affected.length, 1); assert.equal(it.affected[0].status, 'check');
  assert.deepEqual(it.affected[0].amend.refs, ['제22조']); assert.equal(it.affected[0].amend.doc_id, 'bylaws:ours');
  assert.match(it.affected[0].amend.intent, /테스트법 제5조\(난임치료휴가\) 개정/);
  assert.ok(calls.every((q) => q.inst === '가공단')); assert.ok(!calls.some((q) => q.keyword === '정의'));
  const all = createJobs();
  const j2 = await until(all, all.start('radar', { laws: ['테스트법'] }, runRadar, { deps: { sources, llm: null } }));
  assert.equal(j2.result.items.find((x) => x.ref === '제5조').affected.length, 0);
});

import { renumber } from '../lib/refs.mjs';
test('a new branch article goes after the existing branches and reports where it really sits', () => {
  const doc = { articles: [{ ref: '제45조', no: 45, sub: null, section: '본칙' }, { ref: '제45조의4', no: 45, sub: 4, section: '본칙' }, { ref: '제45조의5', no: 45, sub: 5, section: '본칙' }, { ref: '제46조', no: 46, sub: null, section: '본칙' }] };
  const r = renumber(doc, [{ op: 'insert', after: '제45조의4', renumber: false }]);
  assert.deepEqual(r.inserted.map((x) => [x.ref, x.after]), [['제45조의6', '제45조의5']]);
  const r2 = renumber(doc, [{ op: 'insert', after: '제45조의4', renumber: true }]);
  assert.equal(r2.inserted[0].after, '제45조의4');
});
