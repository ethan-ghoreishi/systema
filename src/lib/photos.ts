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

/**
 * Picked or captured images as photo records, in the order they were taken —
 * without writing them, so a caller can add them inside its own transaction
 * (preparing involves reads and hashing, which can't run inside one). Each
 * is copied to its own bytes (never a reference into the picked file), with
 * its size and SHA-256 recorded so its NAS copy can be verified, and its
 * original capture time where the file carries one.
 */
export async function preparePhotos(files: Blob[], target: PhotoTarget): Promise<Photo[]> {
  const timed = await Promise.all(
    files.map(async (file, i) => ({ file, i, takenAt: await captureTime(file, target.tz) })),
  );
  timed.sort((a, b) => (a.takenAt ?? Infinity) - (b.takenAt ?? Infinity) || a.i - b.i);
  const now = Date.now();
  const out: Photo[] = [];
  for (const [n, { file, takenAt }] of timed.entries()) {
    const buf = await file.arrayBuffer();
    const sha256 = await sha256Hex(buf);
    out.push({
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
      // Distinct, ordered stamps keep a batch in capture order everywhere.
      createdAt: now + n,
    });
  }
  return out;
}

/** Store picked or captured images (see preparePhotos). */
export async function addPhotos(files: Blob[], target: PhotoTarget): Promise<string[]> {
  const rows = await preparePhotos(files, target);
  await db.photos.bulkAdd(rows);
  return rows.map((r) => r.id);
}

export async function addPhoto(file: Blob, target: PhotoTarget): Promise<string> {
  return (await addPhotos([file], target))[0];
}

/**
 * A short, stable name for a photo — the same on every device and in every
 * prompt, whatever it's attached to: 'P-3f9a1c'.
 */
export function photoRef(id: string): string {
  return `P-${id.replace(/-/g, '').slice(0, 6)}`;
}

/** Capture order: when taken where known, else when added. */
export function photoTime(p: Pick<Photo, 'takenAt' | 'createdAt'>): number {
  return p.takenAt ?? p.createdAt;
}

/**
 * Delete photos and record a tombstone for each, so the deletion reaches other
 * devices (sync never infers a photo deletion from absence: it may be the only
 * copy). Call inside a transaction that includes db.photos and db.kv.
 */
export async function deletePhotosWhere(
  index: 'id' | 'tripId' | 'stopId' | 'expenseId' | 'momentId',
  value: string,
): Promise<void> {
  const ids = (await db.photos.where(index).equals(value).primaryKeys()) as string[];
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
