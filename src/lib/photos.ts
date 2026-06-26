import { db, type Photo, type PhotoKind } from './db';
import { newId } from './ids';

/** Photo blobs live in IndexedDB (no cloud cost). Offload = download + delete. */

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

export async function deletePhoto(id: string): Promise<void> {
  await db.photos.delete(id);
}

/** Trigger a download so the photo can be saved off-device, then deleted here. */
export function downloadPhoto(photo: Photo): void {
  const url = URL.createObjectURL(photo.blob);
  const a = document.createElement('a');
  const ext = photo.blob.type.includes('png') ? 'png' : 'jpg';
  a.href = url;
  a.download = `systema-${photo.kind}-${photo.createdAt}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
