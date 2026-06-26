import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default ts.config(
  {
    ignores: [
      'dist/',
      'dev-dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'node_modules/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        // Injected by Vite's `define` (see vite.config.ts).
        __APP_VERSION__: 'readonly',
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
      },
    },
  },
  {
    rules: {
      // The app deliberately touches a few browser APIs that aren't fully typed
      // (beforeinstallprompt, navigator.standalone); allow pragmatic casts.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);
