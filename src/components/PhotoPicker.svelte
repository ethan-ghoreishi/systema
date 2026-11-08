<script lang="ts">
  import Icon from './Icon.svelte';

  /**
   * Two ways in, never forcing the camera: Take photo opens the camera;
   * Choose from library picks one or many from Photos (in the order they
   * were taken — see addPhotos).
   */
  let {
    onFiles,
    multiple = true,
    disabled = false,
  }: { onFiles: (files: File[]) => void; multiple?: boolean; disabled?: boolean } = $props();

  let camera: HTMLInputElement;
  let library: HTMLInputElement;

  function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) onFiles(files);
  }
</script>

<div class="photo-picker">
  <button type="button" class="btn btn--ghost" {disabled} onclick={() => camera.click()}>
    <Icon name="camera" size={20} /> Take photo
  </button>
  <input
    bind:this={camera}
    type="file"
    accept="image/*"
    capture="environment"
    hidden
    onchange={picked}
    {disabled}
  />
  <button type="button" class="btn btn--ghost" {disabled} onclick={() => library.click()}>
    <Icon name="image" size={20} /> Choose from library
  </button>
  <input
    bind:this={library}
    type="file"
    accept="image/*"
    {multiple}
    hidden
    onchange={picked}
    {disabled}
  />
</div>
