import { describe, it, expect } from 'vitest';
import { exifTime } from '../../src/lib/exif';

/** A minimal JPEG: SOI, APP1/Exif with IFD0 → Exif IFD → DateTimeOriginal (+offset), SOS. */
function jpeg(date: string, offset?: string, little = true): ArrayBuffer {
  const bytes: number[] = [];
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) =>
    little
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
      : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const str = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
  // TIFF block (offsets relative to its start).
  const exifEntries = offset ? 2 : 1;
  const ifd0 = 8;
  const exifIfd = ifd0 + 2 + 12 + 4;
  const dataAt = exifIfd + 2 + exifEntries * 12 + 4;
  const dateBytes = str(date);
  const offBytes = offset ? str(offset) : [];
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(ifd0),
    ...u16(1),
    ...u16(0x8769),
    ...u16(4),
    ...u32(1),
    ...u32(exifIfd),
    ...u32(0),
    ...u16(exifEntries),
    ...u16(0x9003),
    ...u16(2),
    ...u32(dateBytes.length),
    ...u32(dataAt),
    ...(offset
      ? [...u16(0x9011), ...u16(2), ...u32(offBytes.length), ...u32(dataAt + dateBytes.length)]
      : []),
    ...u32(0),
    ...dateBytes,
    ...offBytes,
  ];
  const app1 = [...str('Exif'), 0, ...tiff];
  bytes.push(0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1);
  bytes.push(0xff, 0xda, 0, 2);
  return new Uint8Array(bytes).buffer;
}

describe('exifTime', () => {
  it('reads DateTimeOriginal, little- and big-endian', () => {
    expect(exifTime(jpeg('2026:10:16 14:32:05'))).toEqual({ wall: '2026-10-16T14:32:05' });
    expect(exifTime(jpeg('2026:10:16 14:32:05', undefined, false))).toEqual({
      wall: '2026-10-16T14:32:05',
    });
  });

  it('keeps the recorded offset', () => {
    expect(exifTime(jpeg('2026:10:16 14:32:05', '+02:00'))).toEqual({
      wall: '2026-10-16T14:32:05',
      offset: '+02:00',
    });
  });

  it('returns nothing for non-JPEGs and damaged files, without throwing', () => {
    expect(exifTime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBeUndefined();
    expect(exifTime(jpeg('2026:10:16 14:32:05').slice(0, 30))).toBeUndefined();
    expect(exifTime(jpeg('0000:00:00 00:00:00'))).toBeUndefined();
  });
});
