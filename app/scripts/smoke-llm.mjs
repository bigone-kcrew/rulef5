// 모델 연결 확인: node app/scripts/smoke-llm.mjs exaone | openrouter:<model>  (키는 출력하지 않음)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { resolveLlmConfig, createLlm } from '../lib/llm.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [join(root, 'app', '.env'), join(root, '.env'), join(root, '.private', 'app.env')]) loadEnv(f);
for (const spec of process.argv.slice(2)) {
  const [preset, model] = spec.split(/:(.+)/);
  const cfg = resolveLlmConfig(process.env, { preset, model });
  const t0 = Date.now();
  try {
    const o = await createLlm(cfg).chatJson([{ role: 'system', content: 'JSON으로만 답한다.' }, { role: 'user', content: '{"answer": "대한민국의 수도"} 형식으로 답하라.' }], (x) => { if (!x.answer) throw new Error('answer 없음'); return x; }, { maxTokens: 2000 });
    console.log(spec, 'OK', JSON.stringify(o), `${Date.now() - t0}ms`);
  } catch (e) { console.log(spec, 'FAIL', e.code, e.message, `${Date.now() - t0}ms`); }
}
