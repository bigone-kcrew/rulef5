// 테스트·시연용 최소 HWPX(무압축 zip) 생성기. 사용: node make-hwpx.mjs <입력.txt> <출력.hwpx>
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function zip(entries, { deflate = false } = {}) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of entries) {
    const nb = Buffer.from(name), raw = Buffer.from(data), comp = deflate && name !== 'mimetype' ? deflateRawSync(raw) : raw, method = comp === raw ? 0 : 8, crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb); off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

export function makeHwpx(text, opts) {
  const paras = text.split(/\r?\n/).map((l) => `<hp:p><hp:run><hp:t>${esc(l)}</hp:t></hp:run></hp:p>`).join('');
  const sec = `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${paras}</hs:sec>`;
  return zip([['mimetype', 'application/hwp+zip'], ['Contents/section0.xml', sec]], opts);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  writeFileSync(process.argv[3], makeHwpx(readFileSync(process.argv[2], 'utf8'), { deflate: true }));
}
