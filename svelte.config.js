import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
  // Lets us use <script lang="ts"> and runes in .svelte / .svelte.ts files.
  preprocess: vitePreprocess(),
};
