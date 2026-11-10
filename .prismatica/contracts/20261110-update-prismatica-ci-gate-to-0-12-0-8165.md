---
id: 20261110-update-prismatica-ci-gate-to-0-12-0-8165
title: Update Prismatica CI gate to 0.12.0
issue: update/0.12.0
tier: light
stage: frame
baseline:
  commit: c60e10d2445c5dfbee58f3efe3d94a1dfb2670cc
  branch: main
branch: change/20261110-update-prismatica-ci-gate-to-0-12-0-8165
worktree: /Users/Ehsan/workspace/active/systema-lanes/20261110-update-prismatica-ci-gate-to-0-12-0-8165
updateVersion: 0.12.0
updateWorkflow: .github/workflows/prismatica-gate.yml
allowedPaths:
  - .github/workflows/prismatica-gate.yml
forbiddenPaths: []
nonGoals: []
acceptanceChecks:
  - id: ac-1
    description: CI gate reads prismatica@0.12.0
    test: manual:owner
docsDelta: []
createdAt: 2026-11-10T13:08:49.654Z
amendments: []
---

# Update Prismatica CI gate to 0.12.0

- **Issue:** update/0.12.0
- **Risk tier:** light — copy, colours, spacing — checks plus one screenshot
- **Baseline:** c60e10d2445c5dfbee58f3efe3d94a1dfb2670cc on main _(never re-baselined)_

## You may only change

- .github/workflows/prismatica-gate.yml

## Never touch

_nothing explicitly forbidden_

## Non-goals

_none stated_

## Acceptance checks (definition of done)

- [ ] **ac-1** — CI gate reads prismatica@0.12.0 _(proof: manual:owner)_

## Docs to update

_none_

## Amendments

_none_

