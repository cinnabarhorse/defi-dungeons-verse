# DeFi Dungeons Verse Architecture

DeFi Dungeons Verse is a real-time multiplayer 2D dungeon world. The client owns rendering, input, HUD, wallet UX, and editor/admin surfaces. The server owns room authority, simulation, persistence, rewards, and API routes.

## Runtime Shape

```text
Next.js + Phaser client      Colyseus + Express server      Supabase/Postgres
apps/client          <---->  apps/server             <----> db + edge functions
      |                              |
      |                              +---- Goldsky deposit subgraph
      |
      +---- Base/Farcaster miniapp metadata
```

## Client

`apps/client` is a Next.js App Router app with Phaser for the playable world.

Important areas:

- `src/game/GameScene.ts` for the main Phaser scene
- `src/game/systems` for environment, fog, item, and quest systems
- `src/components` for lobby, HUD, wallet, inventory, and UI composition
- `src/app` for routes such as play, me, loot, wearables, stats, admin, simulations, map editor, and tiled importer
- `src/data` generated from the root `data` directory

## Server

`apps/server` combines Colyseus rooms with Express APIs.

Important areas:

- `src/rooms` for game, lobby, dungeon, crafting, potion, entry-fee, and scoring systems
- `src/routes` for auth, player, inventory, withdrawals, stats, admin, daily-run, and token flows
- `src/lib` for persistence, Aavegotchi integration, combat, equipment, logging, progression, top-up, and withdrawal helpers
- `src/data` generated from root `data`

## Shared Data

Root `data` files are the source of truth for characters, enemies, items, weapons, difficulty tiers, loot, maps, spells, abilities, and generated chunks.

```bash
pnpm run generate:shared
```

Generated copies in `apps/client/src/data` and `apps/server/src/data` should not be edited directly.

## Persistence And Integrations

- Supabase/Postgres stores player, auth, economy, inventory, score, deposit, and withdrawal state.
- SQL migrations live in `db/migrations`.
- Supabase edge function config lives in `supabase`.
- Goldsky subgraph code lives in `apps/subgraph`.
- Thirdweb/SIWE support wallet authentication and transaction flows.

## Test Layers

- Root Jest config covers script-level gameplay and data specs.
- Client Jest covers hooks and UI behavior.
- Playwright covers browser flows in `apps/client/e2e`.
- Simulation scripts help validate combat, loot, stats, and boss behavior.
