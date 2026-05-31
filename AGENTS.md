# AGENTS.md

This document defines how coding agents should work in this repository.

## Goal

Ship correct changes quickly with a test-driven workflow, minimal regressions, and clear handoff notes.

## Repo map

- `apps/client`: Next.js + Phaser frontend
- `apps/server`: Colyseus + Express backend
- `apps/subgraph`: subgraph package
- `packages/*`: shared library packages
- `data/*`, `scripts/*`: shared game data and script-based tooling/tests

## Core workflow (TDD)

Use a strict Red -> Green -> Refactor loop:

1. Red: add or update a test that captures the expected behavior; confirm it fails.
2. Green: implement the smallest change that makes the test pass.
3. Refactor: clean up code while keeping tests green.
4. Verify: run the appropriate scoped tests plus type-check/lint for touched areas.

Do not merge behavior changes without tests unless the change is pure docs, config comments, or non-executable assets.

## Test map

Choose the narrowest test level first, then widen if needed.

- Server script tests (root Jest config):
  - Location: `scripts/**/*.spec.ts`
  - Command: `pnpm test:loot` or `pnpm jest -c jest.config.js`
- Client unit/integration tests:
  - Location: `apps/client/src/**/__tests__` and `*.spec.ts(x)`/`*.test.ts(x)`
  - Command: `pnpm --filter @gotchiverse/client test`
- Client E2E tests:
  - Location: `apps/client/e2e`
  - Command: `pnpm --filter @gotchiverse/client test:e2e`
- Workspace sweeps:
  - Command: `pnpm test`, `pnpm type-check`, `pnpm lint`

## Required pre-merge checks

All changes must be accompanied by a pull request. Do not consider work complete until there is a PR with scope summary, test evidence, and any known risks.

For any code change, run all that apply:

- Focused tests for changed modules
- `pnpm type-check`
- `pnpm lint`

When changing shared gameplay data (`data/*`, wearables, characters, map assets), also run:

- `pnpm generate:shared`
- Relevant tests that consume generated outputs

## Environment and boot

Server startup requires:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` or `DATABASE_URL`

Recommended local defaults:

- Client: `http://localhost:3001`
- Server: `http://localhost:1999`

Helpful env debugging command:

```bash
pnpm tsx scripts/print-env-precedence.ts
```

## Implementation guidelines

- Keep diffs focused; avoid drive-by refactors unless necessary.
- Preserve existing architecture boundaries between `apps/client`, `apps/server`, and `packages`.
- Prefer shared package utilities over duplicating logic.
- Add tests near the behavior you changed.
- Update docs when changing scripts, env requirements, or developer workflow.

## Security and safety

- Never commit new secrets, API keys, private tokens, or credentials.
- Do not log sensitive values in tests or runtime code.
- Treat payment, withdrawals, and auth paths as high-risk: require explicit tests for success and failure paths.

## Handoff format

When finishing a task, include:

1. What changed (files and behavior)
2. Which tests were run
3. Remaining risks or follow-ups

If tests were not run, state that explicitly.
