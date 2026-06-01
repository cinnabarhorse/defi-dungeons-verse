# DeFi Dungeons Verse

DeFi Dungeons Verse is the real-time Aavegotchi dungeon world. It pairs a Next.js/Phaser client with a Colyseus/Express server for multiplayer movement, combat, rooms, map exploration, loot, progression, inventory, wallet sessions, and admin tooling.

This repository is the Verse app, not the separate idle-run game. Contributors should expect active client/server gameplay code, shared generated game data, Supabase-backed persistence, and a Goldsky subgraph package.

## Stack

- Next.js 14 App Router client in `apps/client`
- Phaser game scene and React HUD/UI
- Colyseus and Express game server in `apps/server`
- Shared generated data from `data`
- Supabase/Postgres for player, economy, inventory, run, and auth data
- Goldsky subgraph in `apps/subgraph`
- pnpm workspaces with Turborepo

## Repository Layout

```text
apps/
  client/      Next.js app, Phaser game, UI routes, Playwright E2E
  server/      Colyseus rooms, Express API, jobs, game systems
  subgraph/    Goldsky subgraph package
data/          Source-of-truth game data copied into client and server
db/            SQL migrations for Supabase/Postgres
docs/          Architecture, systems, and feature notes
packages/      Shared domain packages
scripts/       Data generation, simulation, migration, and ops helpers
supabase/      Edge function configuration
```

## Prerequisites

- Node.js 20
- pnpm 8
- A Supabase/Postgres database for full server flows

## Local Setup

```bash
pnpm install
pnpm run generate:shared
```

The server loads env files from repo root, server dir, and cwd. For local development, a root `.env.local` is the simplest path.

Minimum server values:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=postgres://...
```

Recommended local values:

```bash
PORT=1999
CLIENT_ORIGIN=http://localhost:3001
SESSION_SECRET=replace-with-random-secret
SIWE_DOMAIN=localhost
SIWE_ALLOWED_DOMAINS=localhost,localhost:3001
BASE_RPC_URL=https://mainnet.base.org

NEXT_PUBLIC_APP_SERVER_URL=http://localhost:1999
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_THIRDWEB_CLIENT_ID=your-thirdweb-client-id
NEXT_PUBLIC_SIWE_DOMAIN=localhost
NEXT_PUBLIC_SIWE_URI=http://localhost:3001
```

## Development

```bash
pnpm dev
```

Local endpoints:

- Client: `http://localhost:3001`
- Server: `http://localhost:1999`
- Health check: `http://localhost:1999/health`

Common commands:

```bash
pnpm generate:shared     # Regenerate shared data artifacts
pnpm type-check          # Workspace type checks
pnpm lint                # Workspace linting
pnpm build               # Build the client
pnpm test                # Workspace tests through Turbo
pnpm test:loot           # Root Jest script/gameplay specs
pnpm test:e2e            # Playwright E2E through Turbo
pnpm db:migrate          # Run SQL migrations
pnpm db:seed             # Seed local data
```

Game data is generated from `data` into app workspaces. Edit source files under `data`, then run:

```bash
pnpm run generate:shared
```

## Current Game Systems

- Real-time room joining, movement, combat, enemy, item, and portal systems
- Phaser world rendering with fog of war, minimap, environment, NPC, loot, and sprite managers
- Aavegotchi and hero character selection with wearable/equipment support
- Inventory, equipment, credits, withdrawals, loot catalog, and admin APIs
- Progression, XP, kill streaks, spells, grenades, abilities, elite enemies, and boss mechanics
- Map editor, tiled importer, simulation pages, stats, leaderboard, and admin dashboards
- Supabase-backed auth/session state and Goldsky-backed deposit indexing

## Testing

For docs-only changes, a focused test may be enough. For source changes, run the narrowest affected tests plus type-check.

```bash
pnpm type-check
pnpm test:loot
```

Run E2E when touching game startup, routing, Phaser/Colyseus integration, wallet/session flows, inventory, or UI navigation:

```bash
pnpm test:e2e
```

E2E and full server flows require a reachable Supabase/Postgres database. Use `pnpm tsx scripts/print-env-precedence.ts` if env resolution is unclear.

## License

Software source code and documentation are MIT-licensed. Media assets are not automatically covered by the MIT license; see `ASSET_LICENSES.md` and `NOTICE.md` before reusing sprites, music, sound effects, logos, screenshots, or other artwork.
