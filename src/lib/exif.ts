/**
 * When a JPEG was taken, from its EXIF block (DateTimeOriginal, plus
 * OffsetTimeOriginal when the camera wrote one). Pure and bounded: it reads
 * only the header bytes it's given and never throws on odd files.
 *
 * Photos picked from the iPhone library usually arrive as JPEG with EXIF
 * intact; anything else (PNG, screenshots, stripped files) returns undefined.
 */

export interface ExifTime {
  /** Wall clock where the photo was taken: 'YYYY-MM-DDTHH:mm:ss'. */
  wall: string;
  /** '+01:00' when recorded. */
  offset?: string;
}

export function exifTime(buf: ArrayBuffer): ExifTime | undefined {
  try {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return undefined;
    let off = 2;
    while (off + 4 <= v.byteLength) {
      if (v.getUint8(off) !== 0xff) return undefined;
      const marker = v.getUint8(off + 1);
      const size = v.getUint16(off + 2);
      if (marker === 0xe1 && ascii(v, off + 4, 4) === 'Exif') return readTiff(v, off + 10);
      if (marker === 0xda) return undefined; // image data: no EXIF before it
      off += 2 + size;
    }
  } catch {
    // Truncated or malformed: no time.
  }
  return undefined;
}

function ascii(v: DataView, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n && at + i < v.byteLength; i += 1) {
    const c = v.getUint8(at + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

function readTiff(v: DataView, tiff: number): ExifTime | undefined {
  const little = v.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => v.getUint16(tiff + at, little);
  const u32 = (at: number) => v.getUint32(tiff + at, little);
  if (u16(2) !== 42) return undefined;

  const tags = (ifd: number): Map<number, string | number> => {
    const out = new Map<number, string | number>();
    const n = u16(ifd);
    for (let i = 0; i < n; i += 1) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      if (type === 2) {
        const at = count > 4 ? u32(e + 8) : e + 8;
        out.set(tag, ascii(v, tiff + at, count));
      } else if (type === 4) {
        out.set(tag, u32(e + 8));
      }
    }
    return out;
  };

  const ifd0 = tags(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = typeof exifPtr === 'number' ? tags(exifPtr) : new Map();
  const raw = (exif.get(0x9003) ?? ifd0.get(0x0132)) as string | undefined;
  const m = raw?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === '0000') return undefined;
  const offset = exif.get(0x9011) as string | undefined;
  return {
    wall: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`,
    ...(offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? { offset } : {}),
  };
}
