// 무의존 zip 해제(STORED·DEFLATE) + HWPX 본문 텍스트 추출
import { inflateRawSync } from 'node:zlib';
const bad = (m = 'HWPX 파일을 읽을 수 없습니다.') => Object.assign(new Error(m), { code: 'invalid_hwpx', status: 400 });

export function unzipEntries(buf, want = () => true, budget = 50 * 1024 * 1024) {
  let total = 0;
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw bad();
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw bad();
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!want(name)) continue;
    if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw bad();
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), data = buf.subarray(start, start + csize);
    if (usize > 50 * 1024 * 1024) throw bad('압축 해제 크기가 너무 큽니다.');
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) { try { raw = inflateRawSync(data, { maxOutputLength: Math.max(1, budget - total) }); } catch { throw bad('압축 해제 크기가 너무 크거나 파일이 손상되었습니다.'); } }
    else continue;
    total += raw.length;
    if (total >= budget) throw bad('압축 해제 크기가 너무 큽니다.');
    out.set(name, raw);
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m);

export function hwpxToText(buf) {
  const files = unzipEntries(buf, (n) => /^Contents\/section\d+\.xml$/i.test(n));
  const secs = [...files.keys()].filter((k) => /^Contents\/section\d+\.xml$/i.test(k)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (!secs.length) throw bad('HWPX 본문(section)이 없습니다.');
  const lines = [];
  for (const s of secs) {
    const xml = files.get(s).toString('utf8');
    for (const p of xml.match(/<hp:p[\s>][\s\S]*?<\/hp:p>/g) || []) {
      // 표 안 문단은 중첩되므로 가장 안쪽 텍스트만 모은다
      const t = (p.match(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g) || []).map((x) => unesc(x.replace(/<[^>]+>/g, ''))).join('');
      lines.push(t);
    }
  }
  return lines.join('\n');
}
