## Running tests

### Prerequisites

- Node 18+ and pnpm installed
- Install deps once:

```bash
pnpm install
```

If you changed files under `data/` (e.g., characters or wearables), re-generate shared files before running tests:

```bash
pnpm generate:shared
```

### Test scope

- Jest is configured (Node env, ts-jest) to discover tests only under `scripts/**/*.spec.ts` via `jest.config.js`.
- These tests are server-only and do not require Phaser or a running game.

### Quick start

- Run our script-scoped tests:

```bash
pnpm jest -c jest.config.js
```

Equivalent shortcut (runs in-band):

```bash
pnpm test:loot
```

### Common commands

- Run a single file:

```bash
pnpm jest -c jest.config.js scripts/stats-consistency.spec.ts
```

- Filter by test name (regex):

```bash
pnpm jest -c jest.config.js -t "Client vs Server"
```

- Watch mode:

```bash
pnpm jest -c jest.config.js --watch
```

- Verbose, single-process (useful for debugging):

```bash
pnpm jest -c jest.config.js --runInBand --verbose
```

- Coverage (optional):

```bash
pnpm jest -c jest.config.js --coverage
```

### Notes

- The consistency tests compare client `getCharacterStats` with server `getCharacterStats` and server `syncPlayerCharacterStats` output, entirely in Node.
- If imports ever fail due to browser-only globals, ensure code paths guarded by `typeof window !== 'undefined'` are not executed at import time (current setup is safe).
