// 대화형 계획 에이전트: 요청 이해 → 도구 계획(JSON, 모델 비종속) → 도구 실행·관찰 → 막히면 다음 행동 재질문(최대 3회) → 문서 세트·다음 할 일 제안
import { TOOLS } from './tools.mjs';
import { SYS_BASE } from './prompts.mjs';
import { keywords, lawNames, fixTypos } from '../lib/text.mjs';

const MAX_STEPS = 12, MAX_REPLAN = 3;
// 실행 기록에 보일 도구 이름(화면과 같은 말)
const TOOL_KO = { search_regulations: '규정 찾기', load_document: '원문 불러오기', get_article: '조문 보기', search_law: '법령 찾기', find_citations: '인용 조문 찾기', compare_versions: '이전 판본과 비교', find_similar: '유사 규정 조사', draft_amendment: '개정안 작성', draft_enactment: '제정안 작성', analyze_impact: '법 개정 영향 분석', build_comparison_table: '비교표 만들기', check_regulation: '규정 점검', procedure_next: '절차 안내', ask_user: '담당자에게 확인', bulk_amend: '일괄 개정', review_opinions: '의견 검토', scheduled_radar: '시행예정 법령 확인', finish: '마무리' };
export function classify(msg) {
  const s = String(msg || '');
  if (/(제정|새로\s*만들|신규\s*(지침|규정)|만들어야|초안을\s*만들)/.test(s)) return 'enact';
  if (/(비교|다른\s*기관|타\s*기관|사례\s*조사)/.test(s)) return 'similar';
  if (/(점검|오류|충돌|용어|정합성)/.test(s)) return 'check';
  if (/(영향|상위법.{0,6}(바뀌|개정)|바뀌었는데|개정되었)/.test(s)) return 'impact';
  return 'amend';
}
export function defaultPlan(intent, p) {
  const topic = p.topic || p.intent || '';
  switch (intent) {
    case 'enact': return [{ tool: 'search_law', args: { query: p.law_name || topic } }, { tool: 'draft_enactment', args: { title: p.title, purpose: p.purpose || topic, kind: p.kind } }, { tool: 'procedure_next', args: {} }, { tool: 'finish', args: {} }];
    case 'impact': return [{ tool: 'analyze_impact', args: { law_name: p.law_name, after_text: p.intent, topic } }, { tool: 'procedure_next', args: {} }, { tool: 'finish', args: {} }];
    case 'similar': return [{ tool: 'find_similar', args: { topic } }, { tool: 'build_comparison_table', args: {} }, { tool: 'finish', args: {} }];
    case 'check': return [{ tool: 'search_regulations', args: { inst: p.inst, keyword: p.regulation } }, { tool: 'load_document', args: {} }, { tool: 'check_regulation', args: {} }, { tool: 'finish', args: {} }];
    default: return [{ tool: 'search_regulations', args: { inst: p.inst, keyword: p.regulation || topic } }, { tool: 'load_document', args: {} }, ...(p.law_name ? [{ tool: 'search_law', args: { query: p.law_name } }] : []), { tool: 'draft_amendment', args: { intent: p.intent } }, { tool: 'procedure_next', args: {} }, { tool: 'finish', args: {} }];
  }
}
const heuristicParams = (msg, profile) => ({ inst: profile?.alio_inst || '', regulation: (String(msg).match(/[가-힣]{1,20}(규정|규칙|지침|세칙|조례|요령)/) || [])[0] || '', intent: msg, topic: keywords(msg).slice(0, 3).join(' '), law_name: lawNames(msg)[0] || '' });

const planPrompt = (input, tools) => [
  { role: 'system', content: SYS_BASE },
  { role: 'user', content: JSON.stringify({
    과제: '규정 제·개정 업무 요청을 이해하고, 아래 도구만으로 실행 계획을 세운다. 개정이면 규정을 찾아 불러온 뒤 draft_amendment, 제정이면 관련 법령을 찾고 draft_enactment 를 쓴다. 상위법 확인·유사 규정 조사·절차 안내를 필요한 만큼 넣고 finish 로 끝낸다. 12단계 이내. 사용자의 기관 정보가 없고 대상 규정을 특정할 수 없으면 ask_user 로 묻는다.',
    사용자요청: input.message, 이전대화: (input.history || []).slice(-6), 기관프로필: { 이름: input.profile?.name, 유형: input.profile?.type, ALIO기관명: input.profile?.alio_inst || null },
    이미선택된규정: input.doc_id || null,
    도구: Object.entries(tools).map(([name, t]) => ({ name, 설명: t.desc, 인자: t.args })),
    출력형식: { reply: '사용자에게 할 첫 대답(무엇을 어떻게 할지 1~2문장)', intents: ['amend|enact|impact|similar|check'], params: { inst: '', regulation: '', intent: '', topic: '', law_name: '', title: '', purpose: '', kind: '' }, plan: [{ tool: '도구명', args: {}, why: '이유' }] },
  }) },
];
const nextPrompt = (input, tools, obs) => [
  { role: 'system', content: SYS_BASE },
  { role: 'user', content: JSON.stringify({ 과제: '지금까지의 관찰을 보고 다음 행동 하나를 고른다. 목표를 이뤘으면 finish.', 사용자요청: input.message, 관찰: obs.slice(-8), 도구: Object.keys(tools), 출력형식: { thought: '판단 한 문장', tool: '도구명', args: {} } }) },
];

export async function runAgent(ctx) {
  const deps = { ...ctx.deps, profile: ctx.input.profile };
  const tools = ctx.deps.tools || TOOLS, llm = ctx.deps.llm, input = ctx.input;
  if (!String(input.message || '').trim() || String(input.message).length > 2000) throw Object.assign(new Error('요청을 2,000자 이내로 입력해 주세요.'), { code: 'bad_input', status: 400 });
  input.message = fixTypos(input.message);
  const st = { suggestions: [], answers: [], params: null };
  // 요청 유형마다 계획에 꼭 있어야 하는 핵심 단계(없으면 확인만 하고 끝나는 계획이 된다)
  const MAIN = { amend: 'draft_amendment', enact: 'draft_enactment', similar: 'find_similar', check: 'check_regulation', impact: 'analyze_impact' };
  const need = MAIN[classify(input.message)];
  const validPlan = (o) => {
    if (!Array.isArray(o.plan) || !o.plan.length) throw new Error('plan 이 비었습니다.');
    if (need && Object.hasOwn(tools, need) && !o.plan.some((x) => x && (x.tool === need || Object.values(MAIN).includes(x.tool)))) throw new Error(`계획에 핵심 단계(${need})가 없습니다. 담당자 확인(ask_user)만으로 끝내지 말고, 요청에 나온 기관·규정으로 먼저 찾아 보고(search_regulations·load_document) ${need} 까지 이어지게 계획하세요. 정말 모르는 것만 ask_user 로 묻습니다.`);
    if (typeof o.reply !== 'string') throw new Error('reply 가 없습니다.');
    o.plan = o.plan.filter((s) => s && typeof s.tool === 'string').map((s) => ({ tool: s.tool, args: s.args && typeof s.args === 'object' ? s.args : {}, why: s.why || '' }));
    return o;
  };

  const plan = await ctx.step('요청 이해·계획', async (s) => {
    const intent = classify(input.message);
    // 모델 계획을 기다리는 동안에도 보통의 진행 순서를 먼저 보여 준다(모델 계획이 나오면 바뀐다)
    ctx.setPlan({ reply: '요청을 살펴보고 계획을 세우는 중입니다. 보통 아래 순서로 진행합니다.', intents: [intent], provisional: true, current: null, remaining: null, steps: defaultPlan(intent, heuristicParams(input.message, input.profile)).map((x) => ({ tool: x.tool, why: '', done: false, skipped: false })) });
    if (!llm) {
      st.params = heuristicParams(input.message, input.profile);
      s.note(`모델 없이 규칙으로 분류: ${intent} · 기본 계획 사용`);
      return { reply: '요청을 규칙으로 분류해 기본 절차로 진행합니다.', intents: [intent], steps: defaultPlan(intent, st.params), fallback: true };
    }
    try {
      const t0 = Date.now();
      const o = await llm.chatJson(planPrompt(input, tools), validPlan, { maxTokens: 2500 });
      st.params = { ...heuristicParams(input.message, input.profile), ...Object.fromEntries(Object.entries(o.params || {}).filter(([, v]) => typeof v === 'string' && v.trim())) };
      s.note(`${o.reply}\n계획 ${o.plan.length}단계 · ${llm.config.model} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
      return { reply: o.reply, intents: o.intents || [intent], steps: o.plan };
    } catch (e) {
      ctx.log(`계획 수립 실패(${e.code || 'error'}) — 기본 흐름으로 전환합니다.`);
      s.note(`계획 수립 실패 → 기본 흐름(${intent})으로 전환`);
      st.params = heuristicParams(input.message, input.profile);
      return { reply: '계획을 세우지 못해 기본 절차로 진행합니다.', intents: [intent], steps: null, fallback: true, intent };
    }
  });

  if (!plan.steps && ctx.deps.fallback) { const r = await ctx.deps.fallback(plan.intent, st.params); return { reply: plan.reply, fallback: true, ...r }; }
  const queue = (plan.steps || defaultPlan(plan.intent, st.params)).map((x) => ({ ...x, done: false }));
  if (queue.length > MAX_STEPS) { ctx.log(`단계 상한(${MAX_STEPS})을 넘는 계획 ${queue.length - MAX_STEPS}단계는 실행하지 않습니다.`); queue.length = MAX_STEPS; }
  // current: 지금 실행 중인 단계(없으면 null), remaining: 아직 끝나지 않은 단계 수, finished: 실행을 마침(남은 단계는 notRun)
  let ended = false;
  const view = () => {
    const cur = ended ? -1 : queue.findIndex((x) => !x.done && !x.skipped);
    ctx.setPlan({ reply: plan.reply, intents: plan.intents, provisional: false, finished: ended, current: cur >= 0 ? cur : null, remaining: ended ? 0 : queue.filter((x) => !x.done && !x.skipped).length, steps: queue.map((x) => ({ tool: x.tool, why: x.why || '', done: x.done, skipped: !!x.skipped, failed: !!x.failed, notRun: ended && !x.done && !x.skipped })) });
  };
  view();

  const seen = new Set(), obs = []; let executed = 0, replans = 0, finished = false, finalSummary = '';
  for (let i = 0; i < queue.length && executed < MAX_STEPS && !finished; i++) {
    const item = queue[i], tool = Object.hasOwn(tools, item.tool) ? tools[item.tool] : null;
    if (!tool) { ctx.log(`✗ 알 수 없는 도구 '${item.tool}' — 건너뜁니다.`); item.skipped = true; view(); continue; }
    // 조문 번호를 모르는 채(「제X조」「제○조」) 조문 보기를 부르는 단계는 계획에서 뺀다 — 개정 흐름이 대상 조문을 스스로 찾는다
    if (item.tool === 'get_article' && !/^제\s*\d+\s*조(의\s*\d+)?$/.test(String(item.args?.ref || '').trim())) { ctx.log('· 조문 번호가 정해지지 않아 조문 보기는 건너뜁니다.'); queue.splice(i, 1); i--; view(); continue; }
    const key = item.tool + JSON.stringify(item.args);
    if (seen.has(key)) { ctx.log(`✗ 같은 호출 반복 차단: ${item.tool}`); item.skipped = true; view(); continue; }
    seen.add(key); executed++;
    ctx.log(`▶ ${item.tool}(${JSON.stringify(item.args).slice(0, 160)})`);
    try {
      const out = await ctx.step(`${executed}. ${TOOL_KO[item.tool] || item.tool}`, async (s) => { const r = await tool.run(item.args, deps, st, ctx); s.note(r.summary); return r; });
      ctx.log(`  → ${out.summary}`); obs.push({ tool: item.tool, 결과: out.summary }); item.done = true; view();
      if (out.final) { finished = true; finalSummary = out.summary; }
    } catch (e) {
      ctx.log(`  ✗ ${e.message}`); obs.push({ tool: item.tool, 오류: e.message }); item.skipped = true; item.failed = true; view();
      if (['llm_missing', 'llm_daily_limit', 'llm_auth', 'llm_quota'].includes(e.code)) throw e;
      if (llm && replans < MAX_REPLAN) {
        replans++;
        try {
          const n = await llm.chatJson(nextPrompt(input, tools, obs), (o) => { if (!Object.hasOwn(tools, o.tool)) throw new Error(`도구 ${o.tool} 는 없습니다.`); return o; }, { maxTokens: 1200 });
          // 화면에 보이는 이유 문장에서 영문 도구 이름은 우리말로 바꾸고, 이미 뒤에 잡혀 있는 단계는 다시 넣지 않는다(같은 단계 두 번 실행 방지)
          const why = String(n.thought || '').replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (k) => TOOL_KO[k] || k).replace(/\s*도구를\s*(사용|실행|호출)한다/g, '을(를) 진행한다');
          const later = queue.slice(i + 1).some((x) => x.tool === n.tool && !x.done && !x.skipped);
          ctx.log(`↻ 다시 계획: ${why} → ${TOOL_KO[n.tool] || n.tool}${later ? '(이미 계획에 있어 그대로 진행)' : ''}`);
          if (!later) queue.splice(i + 1, 0, { tool: n.tool, args: n.args || {}, why, done: false }); view();
        } catch { ctx.log('↻ 다시 계획 실패'); }
      } else if (['draft_amendment', 'draft_enactment'].includes(item.tool)) throw e;
    }
  }
  if (executed >= MAX_STEPS && !finished) ctx.log(`단계 상한(${MAX_STEPS})에 도달해 멈춥니다.`);
  ended = true; view();
  const draftErr = obs.find((o) => ['draft_amendment', 'draft_enactment'].includes(o.tool) && o.오류);
  if (draftErr && !st.result) throw Object.assign(new Error(`문서 작성 단계가 실패했습니다: ${draftErr.오류}`), { code: 'draft_failed', status: 502 });
  const sugg = [...st.suggestions];
  if (st.result?.corrections?.length) sugg.unshift(`조 번호 이동으로 인용 정정 ${st.result.corrections.length}건이 필요합니다(문서 세트의 인용 정정 목록).`);
  if (st.result?.citing?.length) sugg.unshift(`변경 조문을 인용하는 조문 ${st.result.citing.length}건의 내용 정합성을 확인하세요.`);
  try { ctx.metric?.('agent', { intent: classify(input.message), tools: queue.filter((x) => x.done).map((x) => x.tool).join('>'), executed, replans, finished }); } catch { /* 지표는 작업을 막지 않는다 */ }
  // 개정·제정 요청인데 문서를 만들지 못했으면, 모델 요약이 「완료」라고 해도 사실대로 알린다
  if ((need === 'draft_amendment' || need === 'draft_enactment') && !st.result?.docset) finalSummary = `요청한 ${need === 'draft_amendment' ? '개정안' : '제정안'}을 만들지 못했습니다. ${st.doc ? '' : '대상 규정을 찾지 못했습니다. 기관명과 규정명을 정확히 적거나 F2에서 규정을 직접 골라 주세요.'}`.trim();
  // 도구가 「사용자에게 알릴 것」으로 표시한 경고는 모델 요약에 빠져도 마지막 요약에 붙인다
  const warn = st.result?.sibling ? `참고: 이 규정에는 해당 조문이 없어 새 조문을 만들었습니다. 같은 기관 「${st.result.sibling.title}」 ${st.result.sibling.ref}(${st.result.sibling.art_title})에 이미 같은 주제가 있으니, 그 규정을 고치는 것이 맞는지 확인하세요.` : '';
  if (warn && !String(finalSummary).includes(st.result.sibling.title)) finalSummary = [finalSummary, warn].filter(Boolean).join(' ');
  return { ...(st.result || {}), radar: st.radar || null, reply: plan.reply, summary: finalSummary, suggestions: sugg, table: st.table || null, check: st.check || null, impact: st.impact || null, agent: true };
}
