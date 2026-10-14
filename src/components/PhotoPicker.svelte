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

  function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length) onFiles(files);
  }
</script>

<div class="photo-picker">
  <label class="btn btn--ghost" class:btn--disabled={disabled}>
    <Icon name="camera" size={20} /> Take photo
    <input type="file" accept="image/*" capture="environment" hidden onchange={picked} {disabled} />
  </label>
  <label class="btn btn--ghost" class:btn--disabled={disabled}>
    <Icon name="image" size={20} /> Choose from library
    <input type="file" accept="image/*" {multiple} hidden onchange={picked} {disabled} />
  </label>
</div>
