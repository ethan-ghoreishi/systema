import { db, type Photo, type PhotoKind } from './db';
import { newId } from './ids';
import { TOMBSTONE } from './sync';

/**
 * Photo blobs live in IndexedDB (no cloud cost). Deleting one also drops its
 * trip link from later backups; there is no reversible offload.
 */

export async function addPhoto(
  file: Blob,
  opts: { tripId: string; stopId?: string | null; expenseId?: string | null; kind: PhotoKind },
): Promise<string> {
  const id = newId();
  await db.photos.add({
    id,
    tripId: opts.tripId,
    stopId: opts.stopId ?? null,
    expenseId: opts.expenseId ?? null,
    kind: opts.kind,
    blob: file,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * Delete photos and record a tombstone for each, so the deletion reaches other
 * devices (sync never infers a photo deletion from absence: it may be the only
 * copy). Call inside a transaction that includes db.photos and db.kv.
 */
export async function deletePhotosWhere(
  index: 'id' | 'tripId' | 'stopId' | 'expenseId',
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
