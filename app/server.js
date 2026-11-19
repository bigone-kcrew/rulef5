// 규정 새로고침 — 서버 진입점
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { createApp } from './lib/app.mjs';
import { createRoutes } from './lib/routes.mjs';
import { createSources } from './lib/sources.mjs';
import { createJobs } from './lib/jobs.mjs';
import { createJobLog } from './lib/joblog.mjs';
import { createWorkspace } from './lib/workspace.mjs';
import { createDailyCounter } from './lib/llm.mjs';
import { FLOWS } from './flows/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of [join(here, '.env'), join(here, '..', '.env'), join(here, '..', '.private', 'app.env')]) loadEnv(f);
const env = process.env;
const varDir = env.REG_VAR_DIR || join(here, 'var');

const sources = createSources(env, fetch, { cacheDir: join(varDir, 'cache') });
const workspace = createWorkspace(join(varDir, 'work'));
setInterval(() => workspace.sweep(24 * 3600e3), 3600e3).unref();
const features = JSON.parse(readFileSync(join(here, 'public', 'features.json'), 'utf8'));
const routes = createRoutes({ sources, jobs: createJobs({ maxConcurrent: +env.MAX_JOBS || 4, onEnd: createJobLog(join(varDir, 'logs')) }), logDir: join(varDir, 'logs'), workspace, env, flows: FLOWS, llmCounter: createDailyCounter(+env.SERVER_LLM_DAILY || 300), features });

// 예기치 않은 오류로 서버가 내려가지 않게 기록만 남긴다
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.code || e?.message || e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e?.code || e?.message || e));

const port = Number(env.PORT || 8107);
createApp({ routes, staticRoot: join(here, 'public'), trustedProxy: env.TRUSTED_PROXY || '172.18.0.1', perMin: +env.RATE_PER_MIN || 60 })
  .listen(port, '0.0.0.0', () => console.log(`규정 새로고침: http://0.0.0.0:${port} (데이터: ${JSON.stringify(sources.status())})`));
