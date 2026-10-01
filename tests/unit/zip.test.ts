import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, isZip, unzip, verifyZip, zip } from '../../src/lib/zip';

const bytes = new Uint8Array(256).map((_, i) => i);
const entries = () => [
  { name: 'systema-backup.json', data: new Blob(['{"app":"systema"}']) },
  { name: 'photos/binary.jpg', data: new Blob([bytes, bytes]) },
  { name: 'photos/café-é.png', data: new Blob(['ünïcode']) },
  { name: 'photos/empty.jpg', data: new Blob([]) },
];

/** Check an archive with tools that share no code with ours. */
async function independentlyValid(archive: Blob): Promise<void> {
  const file = join(mkdtempSync(join(tmpdir(), 'systema-zip-')), 'backup.zip');
  writeFileSync(file, new Uint8Array(await archive.arrayBuffer()));
  execFileSync('unzip', ['-tq', file]);
  execFileSync('python3', ['-m', 'zipfile', '-t', file]);
}

describe('zip', () => {
  it('computes the standard CRC-32', async () => {
    expect(await crc32(new Blob(['123456789']))).toBe(0xcbf43926);
  });

  for (const force64 of [false, true]) {
    it(`round-trips entries ${force64 ? 'with ZIP64 records' : 'as plain ZIP'}`, async () => {
      const archive = await zip(entries(), { force64 });
      expect(await isZip(archive)).toBe(true);
      await independentlyValid(archive);
      const out = await unzip(archive);
      await verifyZip(out);
      expect(out.map((e) => e.name)).toEqual(entries().map((e) => e.name));
      for (const [i, e] of out.entries())
        expect(new Uint8Array(await e.data.arrayBuffer())).toEqual(
          new Uint8Array(await entries()[i].data.arrayBuffer()),
        );
    });
  }

  it('handles a thousand photo-sized entries', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      name: `photos/${i}.jpg`,
      data: new Blob([`photo ${i}`]),
    }));
    const out = await unzip(await zip(many));
    await verifyZip(out);
    expect(await out[999].data.text()).toBe('photo 999');
  });

  it('detects a corrupted entry by its checksum', async () => {
    const good = new Uint8Array(await (await zip(entries())).arrayBuffer());
    const bad = good.slice();
    const at = new TextDecoder('latin1').decode(good).indexOf('"app"');
    bad[at] ^= 0xff;
    const out = await unzip(new Blob([bad]));
    await expect(verifyZip(out)).rejects.toThrow('systema-backup.json failed its checksum');
  });

  it('refuses a truncated file', async () => {
    const archive = await zip(entries());
    await expect(unzip(archive.slice(0, archive.size - 30))).rejects.toThrow(
      'damaged or incomplete',
    );
    await expect(unzip(archive.slice(0, 200))).rejects.toThrow('damaged or incomplete');
  });

  it('recognises a non-ZIP (legacy JSON) backup', async () => {
    expect(await isZip(new Blob(['{"app":"systema"}']))).toBe(false);
  });
});
