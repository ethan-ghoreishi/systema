/**
 * What a photo's bytes are, read from the bytes themselves. A stored MIME
 * type can be wrong or missing — an older NAS served every HEIC as JPEG, an
 * older ZIP named it .jpg, some browsers give HEIC no type at all — while the
 * first bytes never lie. Nothing here changes a photo's bytes.
 */

export interface PhotoFormat {
  /** File extension for a download, share or backup entry. */
  ext: string;
  /** MIME type, or '' when neither the bytes nor the stored type say. */
  mime: string;
}

const KNOWN: Record<string, PhotoFormat> = {
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  heic: { ext: 'heic', mime: 'image/heic' },
  heif: { ext: 'heif', mime: 'image/heif' },
};
// ISO-BMFF major brands: HEVC-coded images are HEIC; the generic image and
// sequence brands are HEIF.
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'mif2', 'msf1', 'heif']);

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** The format the first bytes show, if it is one Systema knows. */
export function sniffFormat(head: Uint8Array): PhotoFormat | undefined {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return KNOWN.jpg;
  if (ascii(head, 0, 8) === '\x89PNG\r\n\x1a\n') return KNOWN.png;
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return KNOWN.webp;
  if (ascii(head, 4, 8) === 'ftyp') {
    const brand = ascii(head, 8, 12);
    if (HEIC_BRANDS.has(brand)) return KNOWN.heic;
    if (HEIF_BRANDS.has(brand)) return KNOWN.heif;
  }
  return undefined;
}

/**
 * The bytes first, then the stored type. Anything else keeps its own image
 * subtype, or is honestly unknown: `.bin`, never a guessed `.jpg`.
 */
export function photoFormat(head: Uint8Array, declared = ''): PhotoFormat {
  const sniffed = sniffFormat(head);
  if (sniffed) return sniffed;
  const sub = declared.toLowerCase().match(/^image\/([a-z0-9.+-]+)$/)?.[1];
  if (!sub) return { ext: 'bin', mime: declared };
  const ext = sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '');
  return KNOWN[ext] ?? { ext: ext || 'bin', mime: declared };
}

/** A stored photo's format, reading only its first bytes (falls back to its type). */
export async function blobFormat(blob: Blob): Promise<PhotoFormat> {
  try {
    return photoFormat(new Uint8Array(await blob.slice(0, 32).arrayBuffer()), blob.type);
  } catch {
    // WebKit can fail an IndexedDB Blob read transiently: the stored type is all we have.
    return photoFormat(new Uint8Array(), blob.type);
  }
}

/** Formats for a set of photos, by id — for taps that must stay synchronous (download, share). */
export async function photoFormats(
  photos: { id: string; blob: Blob }[],
): Promise<Record<string, PhotoFormat>> {
  const out: Record<string, PhotoFormat> = {};
  for (const p of photos) out[p.id] = await blobFormat(p.blob);
  return out;
}

/**
 * The extension a photo is uploaded to the NAS under. Every receiver version
 * stores only .jpg/.png/.webp (others become .jpg), and HEIC has always gone
 * up as .jpg, so it stays .jpg: a new name would put a second file beside the
 * one already there. Downloads read the format from the bytes again.
 */
export function nasExt(format: PhotoFormat): 'jpg' | 'png' | 'webp' {
  return format.ext === 'png' || format.ext === 'webp' ? format.ext : 'jpg';
}
