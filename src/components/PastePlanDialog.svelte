<script lang="ts">
  import { onMount } from 'svelte';

  /** Paste what Claude wrote for one city (or the whole trip), in a native top-layer sheet. */
  let {
    title,
    hint,
    onSave,
    onClose,
  }: {
    title: string;
    hint: string;
    onSave: (text: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  let dialogEl: HTMLDialogElement;
  let text = $state('');
  let error = $state('');
  let saving = $state(false);
  onMount(() => dialogEl.showModal());

  async function save() {
    if (!text.trim()) return;
    saving = true;
    error = '';
    try {
      await onSave(text);
      dialogEl.close();
    } catch (err) {
      error = `Not saved: ${err instanceof Error ? err.message : String(err)}. Your text is still here.`;
    } finally {
      saving = false;
    }
  }
</script>

<dialog
  class="modal"
  bind:this={dialogEl}
  onclose={onClose}
  oncancel={(e) => {
    if (saving) e.preventDefault();
  }}
>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" onclick={() => dialogEl.close()} disabled={saving}
        >Cancel</button
      >
      <h2 class="modal-title">{title}</h2>
      <button class="btn btn--primary btn--sm" onclick={save} disabled={saving || !text.trim()}
        >Save</button
      >
    </header>
    <div class="modal-body">
      <p class="hint">{hint}</p>
      {#if error}<p role="alert" class="hint hint--warn">{error}</p>{/if}
      <textarea
        class="field plan-textarea"
        aria-label="Plan text"
        placeholder="Paste Claude's answer here…"
        bind:value={text}></textarea>
    </div>
  </div>
</dialog>
