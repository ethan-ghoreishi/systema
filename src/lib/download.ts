/** Browser helpers for downloading and sharing files. (Copying: copy.svelte.ts.) */

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Generous: a large backup may still be streaming to disk.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Share a file through the system share sheet where the platform can (iOS:
 * Calendar, Files, the Claude app…), else download it. Call from a tap, before
 * any await.
 */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as Error).name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(file.name, file);
  return 'downloaded';
}
