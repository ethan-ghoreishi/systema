/**
 * The on-screen keyboard, kept apart from ordinary layout. The app shell is
 * fixed to the viewport and the document never scrolls; iOS ignores
 * `interactive-widget`, so when the keyboard opens it pans the page to the
 * focused field instead of resizing. This only (1) exposes the keyboard's
 * height as `--kb`, so a scroll pane can make room for its last fields, and
 * (2) puts the page back where it belongs once the keyboard has gone (iOS
 * can leave it shifted, so the top bar looks lost).
 */
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
    };
    vv.addEventListener('resize', update);
    update();
  }
  document.addEventListener('focusout', () => {
    // After the field change has finished: no field focused → keyboard closing.
    setTimeout(() => {
      const el = document.activeElement;
      if (!el || !el.matches('input, textarea, select, [contenteditable]')) settle();
    }, 100);
  });
}
