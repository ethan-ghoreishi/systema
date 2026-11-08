<script lang="ts">
  import type { Photo } from '../lib/db';
  import { deletePhoto, downloadPhoto } from '../lib/photos';
  import { nasBackup } from '../lib/nas.svelte';
  import Icon from './Icon.svelte';

  let {
    photos,
    label,
    disabled = false,
  }: { photos: Photo[]; label: string; disabled?: boolean } = $props();
  let urls = $state<Record<string, string>>({});
  let opened = $state<Photo | null>(null);
  let error = $state('');
  let unavailable = $state<Record<string, boolean>>({});
  $effect(() => {
    const next = Object.fromEntries(photos.map((p) => [p.id, URL.createObjectURL(p.blob)]));
    urls = next;
    return () => Object.values(next).forEach((url) => URL.revokeObjectURL(url));
  });
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
      opened = null;
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
      <button class="photo-open" aria-label={`View photo of ${label}`} onclick={() => (opened = p)}>
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
        <button class="photo-act" aria-label="Save photo" onclick={() => downloadPhoto(p)}
          ><Icon name="export" size={16} /></button
        >
        <button class="photo-act" aria-label="Delete photo" {disabled} onclick={() => remove(p)}
          ><Icon name="trash" size={16} /></button
        >
      </div>
    </div>
  {/each}
</div>
{#if opened && urls[opened.id]}
  <div class="card" role="region" aria-label="Full photograph">
    <button class="btn btn--ghost" onclick={() => (opened = null)}>Close photo</button>
    <img style="display:block;width:100%;height:auto" src={urls[opened.id]} alt={label} />
  </div>
{/if}

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
</style>
