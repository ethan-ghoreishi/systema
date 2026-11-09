<script lang="ts">
  import type { Photo } from '../lib/db';
  import { deletePhoto, downloadPhoto } from '../lib/photos';
  import { photoFormats, type PhotoFormat } from '../lib/photo-format';
  import { nasBackup } from '../lib/nas.svelte';
  import Icon from './Icon.svelte';

  let {
    photos,
    label,
    disabled = false,
  }: { photos: Photo[]; label: string; disabled?: boolean } = $props();
  let urls = $state<Record<string, string>>({});
  let opened = $state<Photo | null>(null);
  let viewer: HTMLDialogElement;
  let error = $state('');
  let unavailable = $state<Record<string, boolean>>({});
  $effect(() => {
    const next = Object.fromEntries(photos.map((p) => [p.id, URL.createObjectURL(p.blob)]));
    urls = next;
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  });
  // Read ahead of the Save tap: a download started after an await can be dropped.
  let formats = $state<Record<string, PhotoFormat>>({});
  $effect(() => {
    let live = true;
    void photoFormats(photos).then((f) => {
      if (live) formats = f;
    });
    return () => (live = false);
  });
  const save = (p: Photo) => downloadPhoto(p, formats[p.id]);
  function open(photo: Photo) {
    opened = photo;
    viewer.showModal();
  }
  function badge(id: string): string {
    return nasBackup.configured && nasBackup.failures[id] ? 'not backed up' : '';
  }
  async function remove(photo: Photo) {
    if (
      !confirm(
        'Delete this photo permanently? This also removes it from the journal, synced devices and future backups. Save and verify a separate copy first.',
      )
    )
      return;
    try {
      await deletePhoto(photo.id);
      if (viewer.open) viewer.close();
      error = '';
    } catch (err) {
      error = `Photo not deleted: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
</script>

{#if error}<p class="hint hint--warn" role="alert">{error}</p>{/if}
<div class="photo-grid">
  {#each photos as p (p.id)}
    <div class="photo-thumb">
      <button class="photo-open" aria-label={`View photo of ${label}`} onclick={() => open(p)}>
        <img
          src={urls[p.id]}
          alt={label}
          loading="lazy"
          decoding="async"
          onerror={() => (unavailable[p.id] = true)}
        />
      </button>
      {#if unavailable[p.id]}<span class="photo-badge">Preview unavailable. Save the original.</span
        >{/if}
      {#if badge(p.id)}<span class="photo-badge">{badge(p.id)}</span>{/if}
      <div class="photo-actions">
        <button class="photo-act" aria-label="Save photo" onclick={() => save(p)}
          ><Icon name="export" size={16} /></button
        >
        <button class="photo-act" aria-label="Delete photo" {disabled} onclick={() => remove(p)}
          ><Icon name="trash" size={16} /></button
        >
      </div>
    </div>
  {/each}
</div>
<!-- The enlarged photograph sits above everything, the way every other
     full-screen view here does: inline it would open below the fold. -->
<dialog
  class="modal"
  aria-label="Photograph"
  bind:this={viewer}
  onclose={(e) => {
    e.stopPropagation();
    opened = null;
  }}
  oncancel={(e) => e.stopPropagation()}
>
  <div class="modal-sheet">
    <header class="modal-head">
      <button class="btn btn--ghost btn--sm" onclick={() => viewer.close()}>Close photo</button>
      <h2 class="modal-title">{label}</h2>
    </header>
    <div class="modal-body">
      {#if opened && urls[opened.id]}
        {#if unavailable[opened.id]}
          {@const photo = opened}
          <p class="hint hint--warn" role="status">
            This browser can't show this photo. The original is kept unchanged; save it to open it
            in another app.
          </p>
          <button class="btn btn--primary" onclick={() => save(photo)}>Save the original</button>
        {:else}
          <img
            class="photo-full"
            src={urls[opened.id]}
            alt={label}
            onerror={() => {
              if (opened) unavailable[opened.id] = true;
            }}
          />
        {/if}
      {/if}
    </div>
  </div>
</dialog>

<style>
  .photo-open {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .photo-full {
    display: block;
    width: 100%;
    height: auto;
    margin-inline: auto;
  }
</style>
