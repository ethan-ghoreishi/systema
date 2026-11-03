<script lang="ts">
  import { commonCurrencies } from '../lib/currencies';

  /**
   * Which currency a place is priced in.
   *
   * A native <select> on purpose: iOS renders a suggestion list behind a text
   * box as nothing at all, so the field read as empty with no way to find out
   * what it wanted. The wheel names every currency this app sees, and "Other"
   * still takes a code nobody thought of.
   */
  let {
    value,
    label,
    onchange,
  }: { value: string; label: string; onchange: (code: string) => void } = $props();

  const OTHER = '__other';
  const known = $derived(commonCurrencies.some((c) => c.code === value.trim().toUpperCase()));
  let typing = $state(false);
  // Nothing set yet is its own state. Without it the wheel shows its first
  // entry, so an unanswered field reads as pounds — and picking pounds then
  // fires no change, leaving no way to answer it.
  const unset = $derived(!value.trim() && !typing);
  const shown = $derived(unset ? '' : typing || !known ? OTHER : value.trim().toUpperCase());

  function pick(code: string) {
    if (code === OTHER) {
      typing = true;
      return;
    }
    typing = false;
    onchange(code);
  }
</script>

<select
  class="field city-ccy"
  aria-label={label}
  value={shown}
  onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}
>
  {#if unset}
    <option value="">Which currency?</option>
  {/if}
  {#each commonCurrencies as c (c.code)}
    <option value={c.code}>{c.code} · {c.name}</option>
  {/each}
  <option value={OTHER}>Other…</option>
</select>
{#if shown === OTHER}
  <input
    class="field city-ccy"
    aria-label={`${label} code`}
    maxlength="3"
    autocapitalize="characters"
    placeholder="ISO code"
    {value}
    onchange={(e) => {
      const code = (e.currentTarget as HTMLInputElement).value.trim().toUpperCase();
      if (code) {
        typing = false;
        onchange(code);
      }
    }}
  />
{/if}
