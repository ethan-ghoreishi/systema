/**
 * Copying from a tap. iOS only lets a page write to the clipboard while the
 * tap is still being handled: anything awaited first (a database write, a
 * fetch) loses that permission and the copy fails. So `copyText` must be the
 * first thing a click handler does, before any `await` — persist afterwards.
 *
 * If the clipboard still refuses, the text is never lost: a sheet shows it
 * selected, with Share and Download, so it can be copied by hand.
 */

class CopyFallback {
  /** Text the clipboard refused, shown in the fallback sheet. */
  pending = $state<{ text: string; label: string } | null>(null);
}

export const copyFallback = new CopyFallback();

/** document.execCommand('copy'): for browsers without the async clipboard API. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  // Fixed, invisible, 16px: no scroll jump, no iOS zoom, no keyboard.
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;pointer-events:none';
  document.body.appendChild(ta);
  const prev = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/**
 * Copy `text`. Call synchronously from the tap handler. Resolves true when it
 * reached the clipboard; otherwise opens the fallback sheet and resolves false.
 */
export function copyText(text: string, label = 'Text'): Promise<boolean> {
  let attempt: Promise<unknown>;
  try {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    attempt = clip?.writeText
      ? clip.writeText(text)
      : legacyCopy(text)
        ? Promise.resolve()
        : Promise.reject(new Error('no clipboard'));
  } catch (err) {
    attempt = Promise.reject(err);
  }
  return attempt.then(
    () => true,
    () => {
      copyFallback.pending = { text, label };
      return false;
    },
  );
}
