// 업로드 작업공간: 원본은 in/ 에 읽기 전용(0444)·해시 기록, 산출물은 out/
import { mkdirSync, writeFileSync, readFileSync, chmodSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, basename } from 'node:path';
const safe = (n) => basename(String(n || 'file')).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80) || 'file';
const sha = (b) => createHash('sha256').update(b).digest('hex');

export function createWorkspace(root) {
  mkdirSync(root, { recursive: true });
  const dir = (id) => { if (!/^[a-f0-9]{16}$/.test(id)) throw Object.assign(new Error('작업공간 ID가 올바르지 않습니다.'), { status: 400 }); return join(root, id); };
  return {
    create() { const id = randomBytes(8).toString('hex'); mkdirSync(join(root, id, 'in'), { recursive: true }); mkdirSync(join(root, id, 'out'), { recursive: true }); writeFileSync(join(root, id, 'manifest.json'), '[]'); return id; },
    addFile(id, name, buf) {
      const d = dir(id), list = JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8'));
      const path = join(d, 'in', `${String(list.length).padStart(2, '0')}_${safe(name)}`);
      writeFileSync(path, buf, { mode: 0o444 }); chmodSync(path, 0o444);
      const rec = { name: safe(name), path, sha256: sha(buf), size: buf.length }; list.push(rec);
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(list));
      return rec;
    },
    verify(id) { const d = dir(id); return JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')).every((r) => sha(readFileSync(r.path)) === r.sha256); },
    outPath(id, name) { return join(dir(id), 'out', safe(name)); },
    sweep(maxAgeMs = 24 * 3600e3) {
      for (const n of readdirSync(root)) { const p = join(root, n); try { if (Date.now() - statSync(p).mtimeMs > maxAgeMs) { chmodSync(p, 0o700); rmSync(p, { recursive: true, force: true }); } } catch { /* 무시 */ } }
    },
  };
}
