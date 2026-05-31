## Hunted (Per-Floor Elite Pressure Mechanic)

### TL;DR

- **After roughly 3 minutes on a floor** (with a small random offset), the room enters a **Hunted** state and timed elite packs begin spawning near the party.
- **After roughly 5 minutes on the same floor** (also with a small random offset), both the **frequency** of elite waves and the **number of concurrent packs** ramp up, stacking on top of the global enemy difficulty meter so that staying indefinitely becomes nearly impossible.
- **Reset** the Hunted state whenever the party uses a **Boss Portal** or **descends to the next floor** (new map), so each floor has its own pressure curve.
- **Implementation**: a lightweight, per-floor server timer wired into `GameRoom.gameTick()`, reusing the existing elite spawn system and adding a small HUD element that shows Hunted status and the next wave timer.

---

### Goals

- **Encourage forward progress**: Players can farm/clear a floor for a few minutes, but are strongly incentivized to move on.
- **Use elites as pressure**: New elites should feel like hunters that close in on the party if they linger.
- **Keep logic server-authoritative**: All Hunted timing and spawns are decided on the server to avoid exploits or desync.
- **Be tunable by config**: Timing and ramp behavior should be adjustable without code changes.

### Non-Goals (for this iteration)

- **No new elite archetypes** or abilities specific to Hunted (we reuse `ELITE_ARCHETYPES`).
- **No direct reward scaling** (XP/loot/currency) tied to Hunted.
- **No bespoke boss rules** beyond resetting Hunted when entering boss rooms via a portal.

---

## Timing & Intensity Model

All timings are **per floor** and reset when entering a new dungeon map (next floor or boss room).

- **Key defaults** (can live under `GAME_CONFIG.hunted`):
  - **`floorGracePeriodMs`**: `180_000` (3:00) — no Hunted spawns before this.
  - **`rampStartMs`**: `300_000` (5:00) — after this, intensity ramps more aggressively.
  - **`maxIntensityLevel`**: `5` — caps how extreme Hunted can get on a floor.
  - **`baseSpawnIntervalMs`** (intensity 1): `60_000` (1 wave / minute).
  - **`minSpawnIntervalMs`** (max intensity): `15_000`.
  - **`maxHuntedGroupsPerFloor`**: `8` (total Hunted elite packs spawned per floor).
  - **`maxConcurrentHuntedGroups`**: `3` (live Hunted packs at once).

### Intensity level as a function of floor time

Let:

- \( t\_\text{elapsed} = \text{now} - \text{state.huntedFloorStartedAt} \) (ms on current floor).
- \( t*\text{min} = t*\text{elapsed} / 60{,}000 \).

Define **Hunted intensity** \( L \) as:

- If \( t\_\text{elapsed} < \text{floorGracePeriodMs} \):
  - **`L = 0`** (Hunted disabled).
- Else if \( t\_\text{elapsed} < \text{rampStartMs} \):
  - **`L = 1`** (light pressure).
- Else:
  - \( L = \min\big(\text{maxIntensityLevel}, 1 + \lfloor (t\_\text{elapsed} - \text{rampStartMs}) / 60{,}000 \rfloor \big) \)
  - i.e. every **additional minute after 5:00** bumps intensity up by 1 until capped.

Result (with the defaults above):

- **0–3:00**: `L = 0` (no Hunted).
- **3:00–5:00**: `L = 1`.
- **5:00–6:00**: `L = 2`.
- **6:00–7:00**: `L = 3`.
- **7:00–8:00**: `L = 4`.
- **8:00+**: `L = 5` (capped).

### Spawn interval per intensity

Map intensity level to spawn interval (ms) with a simple table:

- **`intervalMs(L)`**:
  - `L <= 0`: no spawns.
  - `L = 1`: `60_000` ms between Hunted waves.
  - `L = 2`: `45_000` ms.
  - `L = 3`: `30_000` ms.
  - `L = 4`: `20_000` ms.
  - `L >= 5`: `15_000` ms (floor).

So:

- First wave can hit as early as **3:00**.
- Around **5:00+**, waves become more frequent and eventually approach a **15s cadence** at peak intensity, compounded with the global enemy difficulty meter.

### Packs per wave

- Define **packs per wave** as a function of intensity:
  - `packs = clamp(1 + Math.floor((L - 1) / 2), 1, maxConcurrentHuntedGroups)`
    - `L = 1–2` → 1 pack.
    - `L = 3–4` → 2 packs.
    - `L >= 5` → 3 packs (if under `maxConcurrentHuntedGroups`).
- Do not exceed:
  - **`maxHuntedGroupsPerFloor`** (total waves per floor).
  - **`maxConcurrentHuntedGroups`** (live Hunted packs).

Note: **Power ramp** comes from:

- **More packs** at higher intensity.
- **Shorter intervals** between waves.
- **Global enemy difficulty meter** already scaling HP/damage minute-by-minute for all enemies (including elites).

---

## Server State

Add minimal, serializable fields to `GameRoomState` (in `apps/server/src/schemas/index.ts`) so logic and UI can derive Hunted status:

- **`huntedEnabled: boolean`**
  - True when Hunted is active for this floor (phase `in_game`, not in transition).
- **`huntedFloorStartedAt: number`**
  - Epoch ms when the current floor’s Hunted timer started.
  - Reset whenever the party enters a new dungeon map (next floor or boss room).
- **`huntedIntensityLevel: number`**
  - Current intensity level `L` (0–`maxIntensityLevel`).
- **`huntedNextSpawnAt: number`**
  - Epoch ms for the next scheduled **Hunted elite wave** on this floor (0 = none scheduled / disabled).
- **`huntedGroupsSpawnedThisFloor: number`**
  - Count of Hunted elite packs spawned on this floor so far.

All other derived values (elapsed minutes, interval, remaining time) are computed at runtime on server/client.

You can optionally keep **runtime-only (non-encoded)** helpers on `GameRoom` (not on the schema) to track:

- `private huntedLastSpawnAt: number`
- `private huntedNextWaveSpawnAt: number` (if you distinguish spawn vs. “UI warning” times)

---

## Server Runtime Flow

### 1) Reset on new floor / boss portal

Add a helper on `GameRoom` (e.g. `resetHuntedForNewFloor(now = Date.now())`):

- **Behavior**:
  - `state.huntedEnabled = GAME_CONFIG.hunted.enabled !== false`
  - `state.huntedFloorStartedAt = now`
  - `state.huntedIntensityLevel = 0`
  - `state.huntedGroupsSpawnedThisFloor = 0`
  - `state.huntedNextSpawnAt = now + GAME_CONFIG.hunted.floorGracePeriodMs`
- **Call sites**:
  - In `WorldTransitionSystem` when a new map is applied for the room:
    - Near where `resetEliteStateForNewMap` and `spawnElitesForDungeon` are called, invoke:
      - `(room as any).resetHuntedForNewFloor?.();`
  - Any explicit **“floor advanced”** helper on `GameRoom` if present (e.g., after `handleFloorAdvanced`).
  - Entering a **Boss Portal** already goes through the world transition pipeline, so the new map call will reset Hunted automatically.

This satisfies: **“The mechanic gets reset if they go through a Boss Portal or descend to the next level.”**

### 2) Per-tick update (wired into `gameTick`)

Add `updateHunted(now: number)` to `GameRoom` and call it from `gameTick()` after `updateEnemyDifficultyMeter(now)` and before heavy movement/AI logic:

```ts
private gameTick() {
  const tickMs = Math.round(1000 / GAME_CONFIG.SERVER_TICK_HZ);
  this.now = this.now > 0 ? this.now + tickMs : Date.now();
  const now = this.now;
  this.state.lastTick = now;

  this.updateEnemyDifficultyMeter(now);
  this.updateHunted(now);
  // ...rest of tick (kill streak, status, movement, etc.)
}
```

**`updateHunted(now)` logic (high level):**

1. **Guards**:
   - If `!GAME_CONFIG.hunted.enabled` → return.
   - If `state.phase !== 'in_game'` → disable Hunted and return.
   - If `state.players.size === 0` or `isRoomTransitioning` → pause Hunted by:
     - `state.huntedEnabled = false; state.huntedNextSpawnAt = 0;` (or keep enabled but don’t advance; see Edge Cases).
2. **Initialize floor timer**:
   - If `!state.huntedFloorStartedAt` → set to `now` and `state.huntedNextSpawnAt = now + floorGracePeriodMs`.
3. **Compute elapsed & intensity**:
   - `elapsedMs = now - state.huntedFloorStartedAt`.
   - Compute `L` as described in the **Intensity level** section and write to `state.huntedIntensityLevel`.
   - If `L <= 0`:
     - Ensure `state.huntedNextSpawnAt = state.huntedFloorStartedAt + floorGracePeriodMs`.
     - Return (still in grace period).
4. **Check spawn timer**:
   - If `state.huntedNextSpawnAt <= 0`:
     - Compute next spawn time using `intervalMs(L)` and set `state.huntedNextSpawnAt = now + interval`.
     - Return.
   - If `now < state.huntedNextSpawnAt` → nothing to do this tick.
5. **Bounds and caps**:
   - If `state.huntedGroupsSpawnedThisFloor >= maxHuntedGroupsPerFloor`:
     - Option A (simple): stop scheduling more waves:
       - `state.huntedEnabled = false; state.huntedNextSpawnAt = 0;`
       - return.
     - Option B: keep intensity HUD but no more Hunted spawns (still “dangerous” because of global meter).
6. **Spawn one Hunted wave**:
   - Compute `packsThisWave` based on current intensity `L` and `maxConcurrentHuntedGroups`.
   - Call `spawnHuntedEliteWave(packsThisWave, now)` (see next section).
   - Increment `state.huntedGroupsSpawnedThisFloor` by the actual number of packs spawned.
7. **Schedule next wave**:
   - Recompute `L` (it may have increased) or reuse cached `L`.
   - `interval = intervalMs(L)`.
   - `state.huntedNextSpawnAt = now + interval`.

Optionally emit a match event for telemetry and effects:

- `emitMatchEvent('hunted_spawn', { floorIndex: state.currentFloor, intensity: L, packs: packsSpawned, elapsedMs });`

---

## Elite Spawn Logic for Hunted

### Reuse `spawnEliteGroup`

We already have a robust elite spawning helper (`spawnEliteGroup` in `EnemySpawnSystem`) that:

- Applies difficulty tier scaling and global enemy difficulty meter multipliers.
- Picks safe positions within a room chunk.
- Spawns a leader + minions and wires up elite abilities and auras.

Hunted should **reuse this** rather than invent a parallel path.

### Choosing where to spawn Hunted elites

High-level behavior:

- **Spawn “around” the party**, not randomly anywhere:
  - Choose one or more **anchor players** (e.g., random party member, or the farthest-forward player).
  - For each pack:
    - Find the **room chunk** containing or nearest to that player using `chunkLayoutData` / `dungeonChunkLayoutData`.
    - Call into a new helper:
      - `getDungeonChunkEntryForWorldPosition(x, y): DungeonChunkLayoutEntry | null`.
    - Use that chunk as the `SpawnEliteGroupOptions.chunk`.
- Respect existing safety checks:
  - `isRoomChunk(entry)` to ensure we’re in a room, not a corridor-only chunk.
  - Use the same **min distance from elites** and obstacle/path checks that normal elite spawn uses.

### Hunted wave helper

Sketch for `spawnHuntedEliteWave` on `GameRoom`:

- **Inputs**: `packsToSpawn`, `now`.
- **Behavior**:
  - Clamp `packsToSpawn` so we never exceed `maxConcurrentHuntedGroups` or `maxHuntedGroupsPerFloor`.
  - Select up to `packsToSpawn` players as anchors (e.g., random sample of active players).
  - For each anchor:
    - Resolve `DungeonChunkLayoutEntry` near that player.
    - Use `createSeededRng('hunted:' + currentFloor + ':' + waveIndex + ':' + anchorPlayerId)` for deterministic randomness.
    - Call `sysSpawnEliteGroup(this as any, { chunk, archetype, rng, roomTier })`:
      - Archetype selection can reuse `eligibleArchetypes` logic from `trySpawnEliteInChunk` (filter by `allowedRoomTiers`/`allowedBiomes` and weight by `baseThreatWeight`).
      - Optionally bias toward higher-threat archetypes when `L` is high (e.g., filter out low `baseThreatWeight` elites at high intensity).
  - Track live groups in `eliteGroupsByRoom` as today; Hunted waves simply add more entries.

### Interplay with `eliteMaxPerFloor`

We currently constrain elites per floor via `GAME_CONFIG.eliteMaxPerFloor`.

- Hunted needs to **lift this cap somewhat** while still bounding worst case:
  - Add `GAME_CONFIG.hunted.huntedExtraEliteCap` (default `4`).
  - Effective cap for elites becomes:
    - `effectiveMaxElitesPerFloor = eliteMaxPerFloor + huntedExtraEliteCap`.
- Hunted waves:
  - Check `this.elitesSpawnedThisFloor` against `effectiveMaxElitesPerFloor` rather than the base cap.
  - Once exceeded, stop spawning new Hunted elites on that floor.

This keeps the total number of elites under control but allows Hunted to **go beyond the “normal” elite density** in a way that’s easy to reason about (e.g., “Hunted can add up to 4 extra elite packs per floor”).

---

## Client / UI

### HUD Elements

Add a compact **Hunted HUD indicator** to both `GameHUD` and `MobileGameHUD`:

- **Color-only “threat light” (no explicit timer)**:
  - A small icon or bar on the HUD that changes color based on how close you are to being hunted and how intense it is:
    - **Green**: safely before the grace-period threshold (no Hunted risk yet).
    - **Yellow**: within a short window of the Hunted threshold (you’re lingering and are about to be hunted).
    - **Red**: Hunted is active (`L >= 1`), with optional stronger red/pulsing at higher intensities.
  - Optionally show a tiny label like **“SAFE / WARMING UP / HUNTED”**, but no MM:SS countdown.
- **When disabled (e.g., floor completed / boss room / staging)**:
  - Hide or gray out the Hunted HUD.

### Data flow

- **Server → Client state**:
  - `GameRoomState` already broadcasts:
    - `phase`, `currentFloor`
    - `enemyDifficultyEnabled`, `enemyDifficultyLevel`, `enemyDifficultyNextAt`
  - Add (minimum needed for the threat light):
    - `huntedEnabled`
    - `huntedIntensityLevel`
    - `huntedNextSpawnAt` (optional; can be used purely for internal client logic such as switching from green→yellow as you approach the threshold).
- **Client wiring**:
  - In `GameScene`, extend the state watcher to subscribe to the new Hunted fields and forward them into React state (similar to the enemy difficulty meter wiring).
  - In `page.tsx`, plumb the new values as props into `GameHUD` and `MobileGameHUD`.
  - In `GameHUD` / `MobileGameHUD`, add a `useEffect` similar to the existing **intensity countdown**:
    - Compute a human-readable `huntedCountdownLabel` from `huntedNextSpawnAt - Date.now()` (e.g. `MM:SS`, `READY`, or `--:--`).

### UX details

- When a Hunted wave actually spawns, optionally:
  - Flash a short **toast** or HUD message: **“Hunted elites have found you!”**.
  - Briefly pulse the Hunted HUD element or add a radial highlight around the party.
- Make sure Hunted HUD is **off by default in staging** rooms and only active in real dungeon runs.

---

## Configuration & Tuning

Extend the shared game config (`data/game-config.ts` → generated into `apps/server/src/data/game-config.ts` and `apps/client/src/data/game-config.ts`) with a new `hunted` block:

- **Example defaults**:

```ts
hunted: {
  enabled: true,
  floorGracePeriodMs: 180_000, // 3 minutes before first Hunted wave
  rampStartMs: 300_000,        // 5 minutes before aggressive ramp
  maxIntensityLevel: 5,
  baseSpawnIntervalMs: 60_000, // intensity 1
  minSpawnIntervalMs: 15_000,  // max intensity
  maxHuntedGroupsPerFloor: 8,
  maxConcurrentHuntedGroups: 3,
  eliteCapMultiplier: 1.5,
},
```

Balancing knobs:

- **Timing**: `floorGracePeriodMs`, `rampStartMs`, and the intensity-to-interval mapping.
- **Pressure**: `maxHuntedGroupsPerFloor`, `maxConcurrentHuntedGroups`, `eliteCapMultiplier`.
- **Future** (optional later): add per-intensity HP/damage bonuses specific to Hunted elites if global scaling + density are not enough.

---

## Edge Cases & Policies

- **Empty room / all players dead**:
  - Default: pause Hunted (no new waves) while `players.size === 0`.
  - On resume (players re-enter / respawn on the same floor), you can either:
    - Resume from current `huntedFloorStartedAt` (time still counts), or
    - Reset Hunted for that floor (more forgiving).
- **Room transitions**:
  - On any new dungeon map (next floor or boss room), always call `resetHuntedForNewFloor`.
  - When in **treasure rooms or staging**, ensure `huntedEnabled = false` and `huntedNextSpawnAt = 0`.
- **Boss fights**:
  - Default proposal: **no new Hunted waves during active boss encounters**.
    - Bosses already scale via the global enemy difficulty meter.
    - Hunted should be about floor linger pressure, not about griefing boss fights.
- **Elite density and spawn safety**:
  - Continue to respect:
    - Minimum distance between elites.
    - Minimum distance from player spawn positions.
    - Collision and obstacle checks.
  - Hunted waves should **not** spawn directly on top of the party, but clearly within their current area.

---

## Implementation Plan (High-Level)

- **Config**:
  - Add the `hunted` block in `data/game-config.ts` and regenerate shared config for server/client.
- **Server state**:
  - Extend `GameRoomState` (`apps/server/src/schemas/index.ts`) with Hunted fields.
- **GameRoom logic**:
  - Implement `resetHuntedForNewFloor` and `updateHunted(now)`.
  - Wire `updateHunted` into `gameTick()`.
  - Add `spawnHuntedEliteWave` using `spawnEliteGroup` and nearby room chunks.
- **World transitions**:
  - In `WorldTransitionSystem`, invoke `resetHuntedForNewFloor` when applying a new map (next floor / boss).
- **Client/UI**:
  - Subscribe to Hunted fields in `GameScene`.
  - Thread these into `page.tsx`, `GameHUD`, and `MobileGameHUD`.
  - Render Hunted label + countdown and basic wave feedback.
- **Telemetry (optional but recommended)**:
  - Emit `hunted_spawn`, `hunted_reset`, and/or `hunted_state` match events for analysis.

---

## Acceptance Criteria

- **Timing**:
  - On a fresh floor, no Hunted elites spawn for the first **3 minutes**.
  - After **3 minutes**, elite packs begin spawning near the party.
  - After **5+ minutes**, spawn frequency and concurrent Hunted packs increase, making the floor increasingly unmanageable.
- **Reset behavior**:
  - Entering any **Boss Portal** or descending to a **new floor** fully resets Hunted (timers, intensity, counters).
- **UI**:
  - Players can always see whether they are **safe**, when **Hunted** will begin, and when the **next Hunted wave** will arrive.
- **Difficulty**:
  - Staying on a single floor for a long time results in a **dramatic spike** in difficulty driven by stacked elite waves plus the global enemy difficulty meter.
