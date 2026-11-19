// 흐름 실측: node app/scripts/run-flow.mjs <type> '<input JSON>' [preset[:model]]  (게이트는 auto, 키 출력 안 함)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { createSources } from '../lib/sources.mjs';
import { createJobs } from '../lib/jobs.mjs';
import { resolveLlmConfig, createLlm } from '../lib/llm.mjs';
import { loadProcedures } from '../flows/procedure.mjs';
import { FLOWS } from '../flows/index.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, 'app', '.env'), join(root, '.env'), join(root, '.private', 'app.env')]) loadEnv(f);
const [type, inputJson, spec = 'exaone'] = process.argv.slice(2);
const [preset, model] = spec.split(/:(.+)/);
// 'none' 이면 모델 없이(규칙만) 실행한다
const cfg = preset === 'none' ? null : resolveLlmConfig(process.env, { preset, model });
const llm = cfg ? createLlm(cfg) : null;
const jobs = createJobs();
const t0 = Date.now();
const id = jobs.start(type, { auto: true, ...JSON.parse(inputJson) }, FLOWS[type], { deps: { sources: createSources(process.env, fetch, { cacheDir: join(root, 'app', 'var', 'cache') }), llm, env: process.env, procedures: loadProcedures() } });
let j; for (;;) { j = jobs.get(id); if (['done', 'failed'].includes(j.status)) break; if (j.status === 'waiting') { console.log('GATE', j.gate.id); jobs.answer(id, j.gate.id, (j.gate.options || []).filter((o) => o.checked).map((o) => o.value)); } await new Promise((r) => setTimeout(r, 300)); }
console.log(JSON.stringify({ status: j.status, error: j.error, secs: ((Date.now() - t0) / 1000).toFixed(1), steps: j.steps.map((s) => `${s.state} ${s.name} [${s.ms != null ? (s.ms / 1000).toFixed(1) + 's' : '-'}]: ${s.note || ''}`), logs: j.logs.map((l) => l.text) }, null, 1));
if (j.result?.docset) { const { renderDocSet } = await import('../lib/table.mjs'); const fs = await import('node:fs'); fs.mkdirSync('/tmp/regitda', { recursive: true }); fs.writeFileSync(`/tmp/regitda/${type}-${spec.replace(/[^a-z0-9]/gi, '_')}.md`, renderDocSet(j.result.docset, 'md')); console.log('saved', `/tmp/regitda/${type}-${spec.replace(/[^a-z0-9]/gi, '_')}.md`); }
else if (j.result) { const fs = await import('node:fs'); fs.mkdirSync('/tmp/regitda', { recursive: true }); fs.writeFileSync(`/tmp/regitda/${type}-result.json`, JSON.stringify(j.result)); console.log('saved', `/tmp/regitda/${type}-result.json`); }
