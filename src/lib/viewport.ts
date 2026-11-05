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

/** Scroll the inner pane against the visible viewport, including iOS keyboard panning. */
function reveal(el: HTMLElement): void {
  if (document.activeElement !== el) return;
  const pane = el.closest<HTMLElement>('.modal-body, .screen-body');
  if (!pane) return;
  const vv = window.visualViewport;
  const visibleTop = vv?.offsetTop ?? 0;
  const visibleBottom = visibleTop + (vv?.height ?? window.innerHeight);
  const bounds = pane.getBoundingClientRect();
  const top = Math.max(bounds.top, visibleTop) + 24;
  const bottom = Math.min(bounds.bottom, visibleBottom) - 24;
  const field = el.getBoundingClientRect();
  if (field.top < top || field.height > bottom - top) pane.scrollTop += Math.floor(field.top - top);
  else if (field.bottom > bottom) pane.scrollTop += Math.ceil(field.bottom - bottom);
}

export function initViewport(): void {
  const vv = window.visualViewport;
  const root = document.documentElement;
  const settle = () => {
    if (window.scrollY || root.scrollTop) window.scrollTo(0, 0);
  };
  if (vv) {
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
      root.style.setProperty('--kb', `${kb}px`);
      if (kb === 0 && !focusedField()) settle();
      else {
        const el = focusedField();
        // Next frame: the padding that `--kb` just grew has to be laid out
        // before the pane can scroll that far.
        if (el) requestAnimationFrame(() => reveal(el));
      }
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
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
