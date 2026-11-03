/**
 * The on-screen keyboard, kept apart from ordinary layout. The app shell is
 * fixed to the viewport and the document never scrolls; iOS ignores
 * `interactive-widget`, so when the keyboard opens it pans the page to the
 * focused field instead of resizing. This only (1) exposes the keyboard's
 * height as `--kb`, so a scroll pane can make room for its last fields,
 * (2) brings the focused field into the part of the screen the keyboard
 * leaves, because iOS does not scroll an inner pane inside a fixed sheet, and
 * (3) puts the page back where it belongs once the keyboard has gone (iOS can
 * leave it shifted, so the top bar looks lost).
 */

const FIELDS = 'input, textarea, select, [contenteditable]';

function focusedField(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches(FIELDS) ? el : null;
}

/**
 * Put the focused field in the middle of what is still visible. `nearest`
 * would leave a field sitting on the keyboard's top edge, where the next field
 * below it is unreachable; centring also reveals the label and the hint under
 * it, which is where a refusal is written.
 */
function reveal(el: HTMLElement): void {
  if (document.activeElement !== el) return;
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
}

export function initViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const settle = () => {
    if (window.scrollY || root.scrollTop) window.scrollTo(0, 0);
  };
  if (vv) {
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', `${kb}px`);
      if (kb === 0) settle();
      else {
        const el = focusedField();
        // Next frame: the padding that `--kb` just grew has to be laid out
        // before the pane can scroll that far.
        if (el) requestAnimationFrame(() => reveal(el));
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', () => {
      if (!focusedField()) settle();
    });
    update();
  }
  // Moving between fields while the keyboard is already open fires no resize,
  // so nothing above would run: reveal the new field on its own.
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !el.matches(FIELDS)) return;
    setTimeout(() => reveal(el), 250);
  });
  document.addEventListener('focusout', () => {
    // After the field change has finished: no field focused → keyboard closing.
    setTimeout(() => {
      if (!focusedField()) settle();
    }, 100);
  });
}
