import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blobFormat, nasExt, photoFormat, sniffFormat } from '../../src/lib/photo-format';
import { BACKUP_JSON, readBackupFile } from '../../src/lib/export';
import { zip } from '../../src/lib/zip';

// Genuine images written by macOS ImageIO (sips) and libwebp (cwebp) from one
// 32×32 test pattern; hashes taken with `shasum -a 256` when they were made
// (see docs/travel-reliability-closure.md).
const FIXTURES = {
  heic: ['024afeaa6c5bf99e1bf8991d809a1506d2ebf9bf7e535fdd285b6b2e7f2d95bb', 'image/heic'],
  heif: ['a5d5667d41e91a4330dd6bde8cb01b9fba4d95b763030e9107d8321ec711afe7', 'image/heif'],
  jpg: ['fc720740d2ff97389e83dadf65a3e333d295ae2f3cfa7c5823e323e1d89c4f9d', 'image/jpeg'],
  png: ['3421731e84b62704d2a6cde3d120c238c64d42ec8f770fdf88ca9e08e431c58e', 'image/png'],
  webp: ['34b7e5b7501f18f60bb2434989dcd593b754d9c82703846ec27b76ba1d4f8dbf', 'image/webp'],
} as const;
const read = (ext: string) => readFileSync(`tests/fixtures/reliability/sample.${ext}`);

describe('photo formats', () => {
  it('reads each committed fixture as what it is, whatever it was labelled', () => {
    for (const [ext, [sha, mime]] of Object.entries(FIXTURES)) {
      const bytes = read(ext);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
      // The bytes win over a historical .jpg label, a wrong type or none.
      for (const declared of ['', 'image/jpeg', 'application/octet-stream'])
        expect(photoFormat(bytes, declared)).toEqual({ ext, mime });
    }
  });

  it('knows the still-image HEIF brand as well as the sequence one', () => {
    const header = (brand: string) =>
      new Uint8Array([0, 0, 0, 24, ...Buffer.from(`ftyp${brand}`), 0, 0, 0, 0]);
    expect(sniffFormat(header('mif1'))).toEqual({ ext: 'heif', mime: 'image/heif' });
    expect(sniffFormat(header('heix'))).toEqual({ ext: 'heic', mime: 'image/heic' });
    // Another ISO-BMFF brand is not claimed as HEIC.
    expect(sniffFormat(header('avif'))).toBeUndefined();
  });

  it('is honest about bytes it cannot place', () => {
    const junk = new TextEncoder().encode('not an image at all');
    expect(photoFormat(junk, '')).toEqual({ ext: 'bin', mime: '' });
    expect(photoFormat(junk, 'image/gif')).toEqual({ ext: 'gif', mime: 'image/gif' });
    expect(photoFormat(junk, 'image/heic')).toEqual({ ext: 'heic', mime: 'image/heic' });
    expect(photoFormat(new Uint8Array(), 'image/jpeg')).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
  });

  it('uploads under the names every receiver version already uses', () => {
    expect(['heic', 'heif', 'jpg', 'png', 'webp'].map((e) => nasExt(photoFormat(read(e))))).toEqual(
      ['jpg', 'jpg', 'jpg', 'png', 'webp'],
    );
    expect(nasExt({ ext: 'bin', mime: '' })).toBe('jpg');
  });

  it('ZIP restore reads HEIC and HEIF originals back byte for byte under any entry name', async () => {
    const backup = {
      app: 'systema',
      version: 1,
      exportedAt: '2026-11-09T10:00:00.000Z',
      trips: [],
      cities: [],
      stops: [],
      expenses: [],
      fxRates: [],
      photos: [],
      settings: [],
    };
    // This version names entries by their bytes; an older one named HEIC/HEIF .jpg.
    const entries: [string, string][] = [
      ['p-heic', 'photos/p-heic.heic'],
      ['p-heif', 'photos/p-heif.heif'],
      ['old-heic', 'photos/old-heic.jpg'],
      ['old-heif', 'photos/old-heif.jpg'],
      ['p-jpg', 'photos/p-jpg.jpg'],
      ['p-png', 'photos/p-png.png'],
      ['p-webp', 'photos/p-webp.webp'],
    ];
    const source = (id: string) => id.split('-')[1];
    const file = await zip([
      { name: BACKUP_JSON, data: new Blob([JSON.stringify(backup)]) },
      ...entries.map(([id, name]) => ({ name, data: new Blob([read(source(id))]) })),
    ]);
    const { files } = await readBackupFile(file);
    expect([...files.keys()]).toEqual(entries.map(([id]) => id));
    for (const [id] of entries) {
      const ext = source(id) as keyof typeof FIXTURES;
      const blob = files.get(id)!;
      const bytes = Buffer.from(await blob.arrayBuffer());
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(FIXTURES[ext][0]);
      // The bytes decide the format, whatever the entry name guessed.
      expect(await blobFormat(blob)).toEqual({ ext, mime: FIXTURES[ext][1] });
    }
    // A damaged archive is refused before anything comes back.
    const damaged = new Uint8Array(await file.arrayBuffer());
    const heic = read('heic');
    const at = Buffer.from(damaged).indexOf(heic) + heic.length - 1; // the stored HEIC's last byte
    expect(at).toBeGreaterThan(0);
    damaged[at] ^= 0xff;
    await expect(readBackupFile(new Blob([damaged]))).rejects.toThrow(/damaged or incomplete/);
  });
});
