import { db, type Photo, type PhotoKind } from './db';
import { newId } from './ids';
import { TOMBSTONE } from './sync';
import { exifTime } from './exif';
import { wallToInstant } from './tz';

/**
 * Photo blobs live in IndexedDB (no cloud cost). Deleting one also drops its
 * trip link from later backups; there is no reversible offload.
 */

export interface PhotoTarget {
  tripId: string;
  stopId?: string | null;
  expenseId?: string | null;
  momentId?: string | null;
  kind: PhotoKind;
  /** Zone of the place the photos were taken: reads an EXIF time without an offset. */
  tz?: string;
}

/** Hex SHA-256 of some bytes (undefined where the platform has no WebCrypto). */
export async function sha256Hex(buf: ArrayBuffer): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** When a picked image was taken: EXIF first, else the file's own date if it isn't "now". */
export async function captureTime(file: Blob, tz?: string): Promise<number | undefined> {
  // EXIF sits at the start of a JPEG: read a header slice (read only — a
  // slice is never stored, which WebKit gets wrong).
  const head = await file.slice(0, 256 * 1024).arrayBuffer();
  const exif = exifTime(head);
  if (exif) {
    const t = exif.offset
      ? Date.parse(`${exif.wall}${exif.offset}`)
      : wallToInstant(exif.wall.slice(0, 16), tz);
    if (t != null && !Number.isNaN(t)) return t;
  }
  const modified = (file as File).lastModified;
  // A camera capture (or a picker that stamps the pick time) says "now": not a capture time.
  return modified && Math.abs(Date.now() - modified) > 60_000 ? modified : undefined;
}

/** Files in the order they were taken (reads only each file's header). */
async function inCaptureOrder(files: Blob[], tz?: string) {
  const timed = await Promise.all(
    files.map(async (file, i) => ({ file, i, takenAt: await captureTime(file, tz) })),
  );
  return timed.sort((a, b) => (a.takenAt ?? Infinity) - (b.takenAt ?? Infinity) || a.i - b.i);
}

/**
 * One picked or captured image as a photo record: copied to its own bytes
 * (never a reference into the picked file), with its size and SHA-256
 * recorded so its NAS copy can be verified, and its capture time.
 */
async function photoRecord(
  file: Blob,
  takenAt: number | undefined,
  target: PhotoTarget,
  createdAt: number,
): Promise<Photo> {
  const buf = await file.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  return {
    id: newId(),
    tripId: target.tripId,
    stopId: target.stopId ?? null,
    expenseId: target.expenseId ?? null,
    ...(target.momentId ? { momentId: target.momentId } : {}),
    kind: target.kind,
    blob: new Blob([buf], { type: file.type }),
    bytes: buf.byteLength,
    ...(sha256 ? { sha256 } : {}),
    ...(takenAt != null ? { takenAt } : {}),
    createdAt,
  };
}

/**
 * A few images (receipts) as records, without writing them, so a caller can
 * add them inside its own transaction — reading and hashing can't run inside
 * one. Holds them all in memory: for many photos, use addPhotos.
 */
export async function preparePhotos(files: Blob[], target: PhotoTarget): Promise<Photo[]> {
  const now = Date.now();
  const out: Photo[] = [];
  for (const [n, { file, takenAt }] of (await inCaptureOrder(files, target.tz)).entries())
    out.push(await photoRecord(file, takenAt, target, now + n));
  return out;
}

/**
 * Store picked or captured images in the order they were taken, one at a
 * time — a big multi-select from the library never sits in memory at once.
 * Distinct, ordered stamps keep a batch in capture order everywhere.
 */
export async function addPhotos(files: Blob[], target: PhotoTarget): Promise<string[]> {
  const now = Date.now();
  const ids: string[] = [];
  for (const [n, { file, takenAt }] of (await inCaptureOrder(files, target.tz)).entries()) {
    const row = await photoRecord(file, takenAt, target, now + n);
    await db.photos.add(row);
    ids.push(row.id);
  }
  return ids;
}

export async function addPhoto(file: Blob, target: PhotoTarget): Promise<string> {
  return (await addPhotos([file], target))[0];
}

/** The hex digits of a photo id, which its reference is a prefix of. */
const hex = (id: string) => id.replace(/-/g, '').toLowerCase();

/**
 * A short, stable name for a photo — the same on every device and in every
 * prompt, whatever it's attached to: 'P-3f9a1c'.
 */
export function photoRef(id: string): string {
  return `P-${hex(id).slice(0, 6)}`;
}

/**
 * References for a set of photos: six hex digits as always, lengthened only
 * for ids that would otherwise share one. Six digits is 16 million values, so
 * two of a few hundred photos collide now and then — and a repeated reference
 * would put one photo where the other belongs in a journal. A longer
 * reference is still a prefix of the id, so every reference already written
 * keeps resolving (see journal.ts).
 *
 * ponytail: twelve digits for a clash, not "until unique" — two ids sharing
 * 48 bits needs millions of photos. Loop the prefix length if that day comes.
 */
export function photoRefs(ids: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const short = hex(id).slice(0, 6);
    counts.set(short, (counts.get(short) ?? 0) + 1);
  }
  return new Map(
    ids.map((id) => {
      const h = hex(id);
      return [id, `P-${counts.get(h.slice(0, 6))! > 1 ? h.slice(0, 12) : h.slice(0, 6)}`];
    }),
  );
}

/** Capture order: when taken where known, else when added. */
export function photoTime(p: Pick<Photo, 'takenAt' | 'createdAt'>): number {
  return p.takenAt ?? p.createdAt;
}

/**
 * Delete photos and record a tombstone for each, so the deletion reaches other
 * devices (sync never infers a photo deletion from absence: it may be the only
 * copy). `only` narrows which of the matches go — a moment's photos are
 * indexed under the stop it was linked to as well, and must not go with that
 * stop. Call inside a transaction that includes db.photos and db.kv.
 */
export async function deletePhotosWhere(
  index: 'id' | 'tripId' | 'stopId' | 'expenseId' | 'momentId',
  value: string,
  only?: (photo: Photo) => boolean,
): Promise<void> {
  const match = db.photos.where(index).equals(value);
  const ids = (await (only ? match.filter(only) : match).primaryKeys()) as string[];
  if (!ids.length) return;
  const at = Date.now();
  await db.kv.bulkPut(ids.map((id) => ({ key: `${TOMBSTONE}${id}`, value: at })));
  await db.photos.bulkDelete(ids);
}

export async function deletePhoto(id: string): Promise<void> {
  await db.transaction('rw', db.photos, db.kv, () => deletePhotosWhere('id', id));
}

/** File extension for a photo blob (as stored on the NAS and in backups). */
export function photoExt(blob: Blob): string {
  return blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
}

/** Trigger a download so the photo can be saved off-device, then deleted here. */
export function downloadPhoto(photo: Photo): void {
  const url = URL.createObjectURL(photo.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `systema-${photo.kind}-${photo.createdAt}.${photoExt(photo.blob)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
