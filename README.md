# DeFi Dungeons Monorepo

DeFi Dungeons is a monorepo for the Aavegotchi game stack:

- `apps/client`: Next.js + Phaser game client (default `http://localhost:3001`)
- `apps/server`: Colyseus + Express game server (default `http://localhost:1999`)
- `apps/subgraph`: Subgraph project
- `packages/*`: shared TypeScript packages used by apps

This README focuses on getting the repo running locally and providing a reliable day-to-day workflow.

## Prerequisites

- Node.js `>=18`
- pnpm `>=8` (repo is pinned to `pnpm@8.12.0`)
- A Postgres/Supabase database you can connect to

## 1) Install dependencies

```bash
pnpm install
```

## 2) Configure environment variables

The server loads env files from multiple places. Practical default: put a single `.env.local` in repo root.

### Required to boot the server

The server fails on startup unless these are set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL` or `DATABASE_URL`

### Recommended for local development

- `PORT=1999`
- `CLIENT_ORIGIN=http://localhost:3001`
- `SESSION_SECRET=<long-random-string>`
- `SIWE_DOMAIN=localhost`
- `SIWE_ALLOWED_DOMAINS=localhost,localhost:3001`
- `BASE_RPC_URL=https://mainnet.base.org`

### Client-side optional vars

These are not required for basic local boot, but enable wallet/realtime flows:

- `NEXT_PUBLIC_APP_SERVER_URL=http://localhost:1999`
- `NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>`
- `NEXT_PUBLIC_THIRDWEB_CLIENT_ID=<thirdweb-client-id>`
- `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=<walletconnect-project-id>`
- `NEXT_PUBLIC_SIWE_DOMAIN=localhost`
- `NEXT_PUBLIC_SIWE_URI=http://localhost:3001`

### Example `.env.local`

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=<postgres-url>

PORT=1999
CLIENT_ORIGIN=http://localhost:3001
SESSION_SECRET=replace-with-random-secret
SIWE_DOMAIN=localhost
SIWE_ALLOWED_DOMAINS=localhost,localhost:3001
BASE_RPC_URL=https://mainnet.base.org

NEXT_PUBLIC_APP_SERVER_URL=http://localhost:1999
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SIWE_DOMAIN=localhost
NEXT_PUBLIC_SIWE_URI=http://localhost:3001
```

## 3) Run database migrations (and optional seed)

```bash
pnpm db:migrate
pnpm db:seed
```

If migrations fail because of connection resolution, run:

```bash
pnpm tsx scripts/print-env-precedence.ts
```

## 4) Start local development

```bash
pnpm dev
```

This runs Turborepo dev tasks for the workspace after generating shared assets.

Local endpoints:

- Client: `http://localhost:3001`
- Server health: `http://localhost:1999/health`

## Common development commands

```bash
pnpm dev                 # Start local dev (client + server through turbo)
pnpm stop                # Stop local dev processes/ports
pnpm generate:shared     # Regenerate shared data artifacts
pnpm type-check          # Workspace type checks
pnpm lint                # Workspace linting
pnpm build               # Build client (via turbo)
```

## Testing

### Workspace

```bash
pnpm test
pnpm test:e2e
```

### Server script tests (root Jest config)

```bash
pnpm test:loot
# or directly
pnpm jest -c jest.config.js
```

### Client unit tests

```bash
pnpm --filter @gotchiverse/client test
```

### Client Playwright tests

```bash
pnpm --filter @gotchiverse/client test:e2e
```

## Troubleshooting

- `SUPABASE_URL is not configured`:
  Set server env vars in `.env.local` at repo root.
- Data mismatch after editing `data/*` files:
  Run `pnpm generate:shared` and retry.
- Unexpected runtime env behavior:
  Use `pnpm tsx scripts/print-env-precedence.ts` to see effective env values and source files.

## Agent workflow

If you are using coding agents in this repo, read:

- `AGENTS.md` for TDD expectations, delivery checklist, and repo conventions.

## License

Software source code and documentation are MIT-licensed. Media assets are not
automatically covered by the MIT license; see `ASSET_LICENSES.md` and
`NOTICE.md` before reusing sprites, music, sound effects, logos, screenshots, or
other artwork.
