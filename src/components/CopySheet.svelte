<script lang="ts">
  import { tick } from 'svelte';
  import { copyFallback } from '../lib/copy.svelte';
  import { downloadText } from '../lib/download';

  /**
   * Shown when the clipboard refuses a copy: the text, selected, in a native
   * <dialog> (top layer, like the expense sheet), with Copy again, Share and
   * Download. Nothing is lost if every automatic route fails.
   */
  let dialogEl: HTMLDialogElement;
  let textEl = $state<HTMLTextAreaElement>();
  let note = $state('');
  const pending = $derived(copyFallback.pending);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  $effect(() => {
    if (!pending) return;
    note = '';
    if (!dialogEl.open) dialogEl.showModal();
    void tick().then(selectAll);
  });

  function selectAll() {
    textEl?.focus({ preventScroll: true });
    textEl?.setSelectionRange(0, textEl.value.length);
  }

  function close() {
    copyFallback.pending = null;
    if (dialogEl.open) dialogEl.close();
  }

  function copyAgain() {
    if (!pending) return;
    // A fresh tap: the clipboard usually accepts it now.
    void navigator.clipboard?.writeText(pending.text).then(
      () => {
        note = 'Copied.';
        setTimeout(close, 700);
      },
      () => {
        selectAll();
        note = 'Still refused. The text is selected: use the system Copy, or Share.';
      },
    );
  }

  function share() {
    if (!pending) return;
    void navigator.share({ title: pending.label, text: pending.text }).catch(() => {});
  }

  function download() {
    if (!pending) return;
    const name = pending.label.toLowerCase().replace(/[^\w]+/g, '-') || 'text';
    downloadText(`${name}.txt`, pending.text);
  }
</script>

<dialog class="modal" bind:this={dialogEl} onclose={() => (copyFallback.pending = null)}>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" onclick={close}>Close</button>
      <h2 class="modal-title">{pending?.label ?? 'Text'}</h2>
      <button class="btn btn--primary btn--sm" onclick={copyAgain}>Copy</button>
    </header>
    <div class="modal-body">
      <p class="hint" role="status">
        {note ||
          "Couldn't copy automatically. The text is below and selected — copy it, or share it."}
      </p>
      <textarea
        bind:this={textEl}
        class="field copy-sheet-text"
        readonly
        aria-label="Text to copy"
        value={pending?.text ?? ''}></textarea>
      <div class="cluster cluster--wrap">
        {#if canShare}<button class="btn btn--ghost" onclick={share}>Share…</button>{/if}
        <button class="btn btn--ghost" onclick={download}>Download (.txt)</button>
        <button class="btn btn--ghost" onclick={selectAll}>Select all</button>
      </div>
    </div>
  </div>
</dialog>
