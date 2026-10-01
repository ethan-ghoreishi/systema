/**
 * Minimal store-only ZIP (no compression: photos are already compressed).
 *
 * Writing composes the archive from Blob references, so photo bytes are read
 * once each (for the CRC) and never held together in memory — a backup of a
 * thousand photos costs one photo's worth of RAM. ZIP64 records are used only
 * when a size or offset needs them. Reading slices entries lazily from the
 * file and verifies each CRC, so a damaged or truncated file is caught before
 * anything is imported. Standard tools (Finder, Files, unzip) open the result.
 */

export interface ZipEntry {
  name: string;
  data: Blob;
}

const MAX32 = 0xffffffff;
const CHUNK = 4 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 of a Blob, read in chunks. */
export async function crc32(blob: Blob): Promise<number> {
  let c = 0xffffffff;
  for (let at = 0; at < blob.size; at += CHUNK) {
    const bytes = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

class Bytes {
  private view: DataView;
  private at = 0;
  readonly buf: Uint8Array<ArrayBuffer>;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.at, BigInt(v), true);
    this.at += 8;
    return this;
  }
  raw(b: Uint8Array) {
    this.buf.set(b, this.at);
    this.at += b.length;
    return this;
  }
}

function dosTime(d: Date): [number, number] {
  return [
    (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  ];
}

/**
 * Build a ZIP. `onProgress(done, total)` reports entries checksummed.
 * `force64` writes ZIP64 records regardless of size (for tests).
 */
export async function zip(
  entries: ZipEntry[],
  opts: { onProgress?: (done: number, total: number) => void; force64?: boolean; date?: Date } = {},
): Promise<Blob> {
  const enc = new TextEncoder();
  const [time, date] = dosTime(opts.date ?? new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const [i, entry] of entries.entries()) {
    const name = enc.encode(entry.name);
    const size = entry.data.size;
    const crc = await crc32(entry.data);
    const big = !!opts.force64 || size >= MAX32 || offset >= MAX32;
    const version = big ? 45 : 20;

    const local = new Bytes(30 + name.length + (big ? 20 : 0))
      .u32(0x04034b50)
      .u16(version)
      .u16(0x0800) // UTF-8 names
      .u16(0) // stored
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(big ? MAX32 : size)
      .u32(big ? MAX32 : size)
      .u16(name.length)
      .u16(big ? 20 : 0)
      .raw(name);
    if (big) local.u16(0x0001).u16(16).u64(size).u64(size);

    const cd = new Bytes(46 + name.length + (big ? 28 : 0))
      .u32(0x02014b50)
      .u16(version)
      .u16(version)
      .u16(0x0800)
      .u16(0)
      .u16(time)
      .u16(date)
      .u32(crc)
      .u32(big ? MAX32 : size)
      .u32(big ? MAX32 : size)
      .u16(name.length)
      .u16(big ? 28 : 0)
      .u16(0) // comment
      .u16(0) // disk
      .u16(0) // internal attrs
      .u32(0) // external attrs
      .u32(big ? MAX32 : offset)
      .raw(name);
    if (big) cd.u16(0x0001).u16(24).u64(size).u64(size).u64(offset);

    parts.push(local.buf, entry.data);
    central.push(cd.buf);
    offset += local.buf.length + size;
    opts.onProgress?.(i + 1, entries.length);
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const count = entries.length;
  const big = !!opts.force64 || count >= 0xffff || offset >= MAX32 || cdSize >= MAX32;
  parts.push(...central);
  if (big) {
    parts.push(
      new Bytes(56)
        .u32(0x06064b50)
        .u64(44)
        .u16(45)
        .u16(45)
        .u32(0)
        .u32(0)
        .u64(count)
        .u64(count)
        .u64(cdSize)
        .u64(offset).buf,
      new Bytes(20)
        .u32(0x07064b50)
        .u32(0)
        .u64(offset + cdSize)
        .u32(1).buf,
    );
  }
  parts.push(
    new Bytes(22)
      .u32(0x06054b50)
      .u16(0)
      .u16(0)
      .u16(big ? 0xffff : count)
      .u16(big ? 0xffff : count)
      .u32(big ? MAX32 : cdSize)
      .u32(big ? MAX32 : offset)
      .u16(0).buf,
  );
  return new Blob(parts, { type: 'application/zip' });
}

export interface UnzippedEntry {
  name: string;
  data: Blob;
  crc: number;
}

const damaged = (why: string) => new Error(`This backup file is damaged or incomplete (${why}).`);

async function view(blob: Blob, at: number, length: number): Promise<DataView> {
  const buf = await blob.slice(at, at + length).arrayBuffer();
  if (buf.byteLength < length) throw damaged('unexpected end of file');
  return new DataView(buf);
}

const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** True if the file starts like a ZIP archive. */
export async function isZip(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  return (await view(blob, 0, 4)).getUint32(0, true) === 0x04034b50;
}

/** List a ZIP's entries as lazy slices of the file. Stored (uncompressed) entries only. */
export async function unzip(file: Blob): Promise<UnzippedEntry[]> {
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = await view(file, file.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i -= 1) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw damaged('no end-of-archive record');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    const locAt = file.size - tailLen + eocd - 20;
    if (locAt < 0) throw damaged('missing ZIP64 locator');
    const loc = await view(file, locAt, 20);
    if (loc.getUint32(0, true) !== 0x07064b50) throw damaged('missing ZIP64 locator');
    const rec = await view(file, u64(loc, 8), 56);
    if (rec.getUint32(0, true) !== 0x06064b50) throw damaged('bad ZIP64 record');
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }
  if (cdOffset + cdSize > file.size) throw damaged('directory past end of file');

  const cd = await view(file, cdOffset, cdSize);
  const dec = new TextDecoder();
  const out: UnzippedEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > cdSize || cd.getUint32(p, true) !== 0x02014b50)
      throw damaged('bad directory entry');
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra: only the fields that overflowed, in order (sizes, then offset).
    for (let e = p + 46 + nameLen; e < p + 46 + nameLen + extraLen; ) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let f = e + 4;
        if (size === MAX32) {
          size = u64(cd, f);
          f += 16; // uncompressed + compressed (stored: equal)
        }
        if (offset === MAX32) offset = u64(cd, f);
      }
      e += 4 + len;
    }
    if (method !== 0) throw new Error(`Unsupported compressed entry in backup: ${name}`);
    const local = await view(file, offset, 30);
    if (local.getUint32(0, true) !== 0x04034b50) throw damaged(`bad entry header for ${name}`);
    const start = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    if (start + size > file.size) throw damaged(`${name} is cut short`);
    out.push({ name, data: file.slice(start, start + size), crc });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Check every entry's CRC; throws naming the first damaged one. */
export async function verifyZip(
  entries: UnzippedEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  for (const [i, e] of entries.entries()) {
    if ((await crc32(e.data)) !== e.crc) throw damaged(`${e.name} failed its checksum`);
    onProgress?.(i + 1, entries.length);
  }
}
