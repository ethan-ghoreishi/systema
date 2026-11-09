# Systema

Systema is a local-first Svelte 5 and TypeScript travel PWA. User records live
in IndexedDB through Dexie; the optional NAS holds backups and shared snapshots.

## Working rules

- Use plain UK English. Lead with the answer, keep explanations short, and
  distinguish evidence from assumptions.
- Preserve trips, expenses, visits, Moments, photo bytes and links. Never test
  against the user's installed app database or live NAS. Use synthetic data in
  isolated browser contexts.
- Preserve backup and sync compatibility. Validate incoming data before writes,
  keep related writes transactional, and never remove data to make a check pass.
- Keep the app usable offline. No accounts, paid services, runtime AI calls or
  new external data destinations without an explicit owner decision.
- Read callers before changing shared code. Reuse existing helpers and make the
  smallest complete change. Do not mix unrelated cleanup into a change.

## Prismatica

- This repository is governed by Prismatica. Use `prismatica next` for the
  authoritative next action and `prismatica doctor` to diagnose setup problems.
- Plan new changes through Prismatica Start; implement only in the resulting
  change lane against its current brief. Read `prismatica open` before work.
- Use Prismatica Understand to propose Flows and Rules from real code. Never
  hand-edit canonical records or manufacture passing evidence.
- The owner approves Flows and Rules and makes seal, acceptance and merge
  decisions. Do not bypass hooks or checks. Do not commit, push or deploy beyond
  the boundary the owner requested.

## Checks

- `npm run check` checks Svelte components and TypeScript; bare `tsc --noEmit`
  does not check this project's referenced applications.
- `npm run lint`, `npm run test` and `npm run build` cover static checks, unit
  tests and the production build.
- `npm run test:e2e` uses isolated Chromium and WebKit contexts. Install browsers
  with `npx playwright install --with-deps chromium webkit` when needed.
- `npm run test:pwa` checks updates across production builds. Real PHP receiver
  tests require an isolated temporary receiver; see `.github/workflows/deploy.yml`.
- Automated browser results do not establish native iPhone or live NAS behaviour.
