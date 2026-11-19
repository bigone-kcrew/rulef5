// 작업 종류 → 실행 함수
import { runAmend } from './amend.mjs';
import { runEnact } from './enact.mjs';
import { runAgent } from './agent.mjs';
import { runImpact } from './impact.mjs';
import { runSimilar } from './similar.mjs';
import { runCheck } from './check.mjs';
import { runLawChain } from './lawchain.mjs';
import { runOpinions } from './opinions.mjs';
import { runRadar } from './radar.mjs';
import { runBulk } from './bulk.mjs';
export const FLOWS = { amend: runAmend, enact: runEnact, impact: runImpact, similar: runSimilar, check: runCheck, lawchain: runLawChain, opinions: runOpinions, radar: runRadar, bulk: runBulk };
FLOWS.agent = (ctx) => runAgent({ ...ctx, deps: { ...ctx.deps, flows: FLOWS } });
