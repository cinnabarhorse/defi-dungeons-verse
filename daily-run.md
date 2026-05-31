## Daily High-Stakes Boss Runs – Implementation Plan

This document specifies a **minimal, shippable implementation** for daily, score-based boss payouts tied to an explicit **High‑Stakes Run** opt‑in via the Portal Mage NPC.

The goal is:

- **Simple mental model** for players.
- **Limited moving parts** for engineering.
- **Config‑driven** so tuning is possible without code changes.

---

## 1. Core Design Summary

- **Per‑run score**: Every boss kill records a single scalar `runScore` per difficulty.
- **Daily reference score per difficulty**: For each band (`normal`, `nightmare`, `hell`, `beyond_hell`), track **yesterday’s high score** as the reference `Y`.
- **Opt‑in High‑Stakes runs**:
  - Player selects a difficulty in the **Lobby** as normal.
  - Player talks to the **Portal Mage**, who reads the currently selected Lobby difficulty and asks whether to use today’s **High‑Stakes Jackpot** on that difficulty.
  - If confirmed, the next run on that Lobby difficulty is flagged `isHighStakes = true`.
  - If they kill the boss and meet the score threshold, they get a **guaranteed score‑based currency payout**.
- **Threshold rule**:
  - If `runScore < 0.5 * Y` → **no score‑based payout** (normal loot only).
  - If `runScore ≥ 0.5 * Y` → **payout** computed by a simple linear formula, capped per difficulty.
- **Usage limits**:
  - **Default**: `1` High‑Stakes attunement per account per real‑world day (across all difficulties).
  - Attunement is **consumed** on boss death or run failure (die/abandon).
- **Reset cadence**:
  - Daily reset of leaderboard and High‑Stakes attunements.
  - Start with a **fixed daily reset time** (UTC), configured in `GAME_CONFIG`.

---

## 2. Data Model & Storage

### 2.1. Difficulties

Reuse existing canonical difficulty IDs already in `difficulty-tiers` / `GAME_CONFIG`, but we will explicitly refer to four “bands”:

- `normal`
- `nightmare`
- `hell`
- `beyond_hell`

Assumption: each boss run is tagged with an unambiguous difficulty id we can map into one of the four bands.

### 2.2. New DB Structures

**(A) Daily high score per difficulty**

New table `daily_boss_high_scores`:

- **Columns (core)**
  - `date` (DATE, UTC, primary key part)
  - `difficulty_id` (TEXT / VARCHAR; primary key part; e.g. `normal`, `nightmare`, etc.)
  - `score` (BIGINT / INTEGER; the highest `runScore` observed that date for that difficulty)
  - `account_id` (TEXT / UUID; who achieved this high score; optional but useful)
  - `run_id` (optional reference to a run / session row)
  - `created_at` / `updated_at` (timestamps)

- **Indexes**
  - PK on `(date, difficulty_id)`.
  - Optional index on `(difficulty_id, date DESC)` for quick retrieval of most recent days.

**(B) Player High‑Stakes usage state**

New table `daily_high_stakes_state`:

- **Columns**
  - `date` (DATE, UTC; part of PK)
  - `account_id` (TEXT / UUID; part of PK)
  - `remaining_attunements` (INT; default 1 per day)
  - `active_difficulty_id` (TEXT, nullable; which difficulty is currently attuned for High‑Stakes, if any)
  - `active_run_id` (TEXT / UUID, nullable; to ensure we only apply attunement to one live run)
  - `created_at` / `updated_at`

- **Indexes**
  - PK on `(date, account_id)`.

Alternative: if we already have a per‑day account state table, this can be merged; otherwise keep it separate for clarity.

**(C) Run metadata extension (server‑side run/session)**

Boss runs are already tracked via existing tables:

- `games`:
  - `difficulty_tier` → canonical difficulty id for the run.
  - `metadata.bossKilled` → whether the boss was killed.
- `game_players`:
  - `player_id` → account/player id.
  - `game_id` → links to the game/run.
  - `metadata.score` → fallback for older score data.
- `run_scores`:
  - `player_id`, `game_id`
  - `score` → canonical `runScore` value (see `docs/player-score.md`).
  - `difficulty_tier`
  - `metadata` (jsonb) for extra flags.

For High‑Stakes runs we will:

- Use `games.difficulty_tier` as the **difficulty id**.
- Use `game_players.player_id` as the **account id**.
- Use `run_scores.score` as the **runScore**.
- Store High‑Stakes flags and payout info inside `run_scores.metadata`, e.g.:

  ```json
  {
    "highStakes": {
      "isHighStakes": true,
      "consumed": true,
      "referenceScore": 12345,
      "thresholdScore": 6172,
      "payoutUSDC": 1.25,
      "payoutGHST": 4.0
    }
  }
  ```

No new `boss_runs` table or separate log format is required; we extend the existing `run_scores` rows.

### 2.3. Config in GAME_CONFIG

Add a new `GAME_CONFIG.dailyRuns` section, for example:

```ts
dailyRuns: {
  enabled: true,
  // Percent of reference Y that defines the eligibility floor
  scoreThresholdFraction: 0.5,

  // Default number of High-Stakes attunements per account per (UTC) day
  attunementsPerDay: 1,

  // Per-difficulty maximum currency caps for a single High-Stakes payout
  // These should be consistent with difficulty maxEarnings / chest logic
  maxPayoutPerDifficulty: {
    normal: { USDC: 0.5, GHST: 2 },
    nightmare: { USDC: 1.0, GHST: 4 },
    hell: { USDC: 1.5, GHST: 6 },
    beyond_hell: { USDC: 2.0, GHST: 8 },
  },
}
```

Numbers above are **placeholder defaults**; actual values must be aligned with your economy targets and `difficulty-tiers` data (`levelCost`, `maxEarnings`, etc.).

---

## 3. Run Score & Reference Score Logic

### 3.1. Run Score

**Goal**: simple monotonic measure of “how good the run was”. It does _not_ need to be perfect initially.

**Minimal v1 formula (server‑side)**:

```ts
runScore =
  floorCleared * 1000 +
  enemiesKilled * 10 +
  elitesKilled * 50 +
  (bossKilled ? 5000 : 0) +
  (noDeath ? 2000 : 0);
```

- Only **boss kills** participate in High‑Stakes payouts; but we can also compute `runScore` for failed runs for analytics.
- Ensure `runScore` is **non‑negative integer**.

Implementation notes:

- Add a helper on the server (e.g. `computeRunScore(context): number`) where `context` includes floor index, kills, elites, deaths, time, etc.
- This function should be used consistently anywhere we log run results.

### 3.2. Daily Reference Score Y

For each difficulty band, we want:

```ts
Y = yesterdayHighScore[difficulty]; // fallback to a baseline if missing
```

**Baseline fallback** (if no data yet):

- Add to `GAME_CONFIG.dailyRuns.baselineReferenceScore`, e.g.:

```ts
baselineReferenceScore: {
  normal: 5000,
  nightmare: 10000,
  hell: 15000,
  beyond_hell: 20000,
}
```

If `daily_boss_high_scores` for `yesterday` has **no row** for a difficulty, use `baselineReferenceScore[difficulty]` as `Y`.

### 3.3. Threshold & Payout Curve

Let:

- `S` = current `runScore`.
- `Y` = reference score for that difficulty (`yesterday` or baseline).
- `T = scoreThresholdFraction` (default 0.5).

**Eligibility**:

```ts
if (!isHighStakes) {
  // Either no score-based payout, or a very small baseline payout (v1: none)
  return noScorePayout;
}

if (S < T * Y) {
  return noScorePayout; // normal loot only, High-Stakes attunement consumed
}
```

**Linear payout ratio**:

- We map `S` to a ratio `r` in `[T, 1]`:

```ts
// clamp S/Y into [T, 1]
const raw = Y > 0 ? S / Y : 1;
const r = clamp(raw, T, 1);
```

**Difficulty caps**:

- From `GAME_CONFIG.dailyRuns.maxPayoutPerDifficulty[difficulty]`:

```ts
const caps = GAME_CONFIG.dailyRuns.maxPayoutPerDifficulty[difficulty];
const payoutUSDC = r * caps.USDC;
const payoutGHST = r * caps.GHST;
```

- Optionally round down to cents (USDC) or smallest GHST unit you support.

**Result**:

- A High‑Stakes run that hits threshold gets a deterministic payout between 50% and 100% of the configured cap per difficulty, based purely on `S` relative to `Y`.

---

## 4. High‑Stakes Flow & UX Hooks

### 4.1. Portal Mage – Attunement UX

**High‑level interaction (client):**

1. Player talks to Portal Mage in hub / town.
2. Client calls a server endpoint, e.g.:
   - `GET /daily-runs/preview?accountId=...`
   - Server responds with (using the **currently selected Lobby difficulty**):
     - Yesterday’s high score `Y` for that difficulty.
     - Threshold `T * Y` for that difficulty.
     - Max possible payout for a High‑Stakes run on that difficulty.
     - How many attunements remain today.
3. Player confirms they want to use their **Daily Jackpot** on their current Lobby difficulty and clicks **“Attune High‑Stakes Run”**.
4. Client calls:
   - `POST /daily-runs/attune` with `{ difficultyId }` taken from the Lobby selection.
5. Server:
   - Validates remaining attunements for today.
   - Sets `active_difficulty_id` and `remaining_attunements -= 1` in `daily_high_stakes_state`.
   - Returns updated state to client.
6. Client shows confirmation + the key numbers:
   - Reference score `Y`.
   - Threshold `T * Y`.
   - Max payout.

### 4.2. Run Start Hook (server)

When a new dungeon run is created:

1. Look up `daily_high_stakes_state` by `(today, account_id)`.
2. If `active_difficulty_id === run.difficulty_id` and `active_run_id` is null:
   - Set `run.isHighStakes = true`.
   - Persist `active_run_id = run.id`.
3. Otherwise:
   - `run.isHighStakes = false`.

On **run termination** (boss kill, death, abandon):

- If `run.id === active_run_id` in `daily_high_stakes_state`:
  - Clear `active_difficulty_id` and `active_run_id`.
  - (Attunement is consumed whether or not they succeed.)

### 4.3. Boss Kill Hook (server)

At boss kill:

1. Compute `runScore = computeRunScore(context)`.
2. Persist `runScore` to the run record.
3. Update **today’s high score**:
   - Determine today’s date (UTC).
   - In `daily_boss_high_scores`, upsert row `(date=today, difficulty_id)` where:
     - If row exists and `runScore > existing.score` → update.
     - Else do nothing.
4. Determine **reference score** `Y`:
   - Look at **yesterday’s date**.
   - Try to read `(yesterday, difficulty_id)` row from `daily_boss_high_scores`.
   - If found, `Y = score`.
   - Else, `Y = baselineReferenceScore[difficulty]`.
5. If `run.isHighStakes`:
   - Apply eligibility rule and payout curve from §3.3.
   - Create a withdrawal / on‑chain payout request using existing payouts pipeline (e.g. via `token-withdrawals` and batch processor).
6. Return to client a **boss summary payload** including:
   - `runScore`
   - `referenceScore` (`Y`)
   - `thresholdScore` (`T * Y`)
   - `isHighStakes`
   - `payoutUSDC`, `payoutGHST`

### 4.4. Client Boss Summary UX

On receiving summary payload:

- If `isHighStakes` and `payoutUSDC + payoutGHST > 0`:
  - Show a High‑Stakes panel:
    - “You scored **S** vs yesterday’s reference **Y**.”
    - “You hit **X%** of the reference and earned **N GHST** and **M USDC**.”
- If `isHighStakes` and payout is 0:
  - “You scored **S**, but needed at least **T \* Y** for a payout. Your attunement was consumed.”
- If not High‑Stakes:
  - Show normal boss loot recap only.

---

## 5. Daily Handling & Optional Cleanup

### 5.1. Per‑request daily logic

**High‑Stakes attunement (`daily_high_stakes_state`)**

- Keyed by `(date, account_id)` where `date` is the **UTC date** (e.g. from `current_date` in SQL).
- On any preview/attune request:
  - Compute `todayUtcDate`.
  - Look up row `(todayUtcDate, account_id)`.
  - If none exists:
    - Treat as a fresh day: create a new row with:
      - `remaining_attunements = attunementsPerDay`
      - `active_difficulty_id = null`
      - `active_run_id = null`
  - If a row exists for today:
    - Use its `remaining_attunements` / `active_*` fields as the current state.
- Older days remain in the table but are naturally ignored by using the current UTC date as part of the key.

**Daily boss highs (`daily_boss_high_scores`)**

- Also keyed by `(date, difficulty_id)` using the UTC date.
- On boss kill:
  - Compute `todayUtcDate`.
  - Upsert `(todayUtcDate, difficulty_id)` with the highest `runScore` seen that day.
- When computing `Y` (yesterday’s reference score):
  - Compute `yesterdayUtcDate`.
  - Read `(yesterdayUtcDate, difficulty_id)` from `daily_boss_high_scores`.
  - If missing, fall back to `baselineReferenceScore[difficulty]`.

Result: the “daily” behavior is entirely derived from UTC dates and per‑request checks for correctness.

### 5.2. Daily Reference Scores

- `Y` is always “**yesterday’s row**” or baseline.
- Data retention:
  - Keep last 30–60 days of high scores per difficulty for analytics.
  - An optional weekly or monthly cleanup job can prune older entries.

---

## 6. Integration with Existing Currency Systems

### 6.1. Where to Hook in `loot-table.ts`

Current file `data/loot-table.ts` includes `rollBossCurrency` and chest reward logic. For the High‑Stakes system:

- **Approach**:
  - Keep `rollBossCurrency` as‑is for **non‑High‑Stakes** boss currency drops (if desired).
  - Add a new, server‑side function (not in `loot-table.ts`) for **High‑Stakes payouts**:

    ```ts
    function computeHighStakesBossPayout(options: {
      difficultyId: string;
      runScore: number;
      referenceScore: number;
      currencyCaps: { USDC: number; GHST: number };
      thresholdFraction: number; // e.g. 0.5
    }): { usdc: number; ghst: number } {
      const { runScore: S, referenceScore: Y, thresholdFraction: T } = options;
      if (!Number.isFinite(S) || S <= 0) return { usdc: 0, ghst: 0 };
      const baseRef = Y > 0 ? Y : 1;
      if (S < T * baseRef) return { usdc: 0, ghst: 0 };

      const raw = S / baseRef;
      const r = Math.max(T, Math.min(1, raw));

      const usdc = r * options.currencyCaps.USDC;
      const ghst = r * options.currencyCaps.GHST;
      return { usdc, ghst };
    }
    ```

- The **server route** handling boss kill (or a game service) calls this function once, then enqueues a payout via existing withdrawal mechanisms.

### 6.2. Withdrawal / Accounting Flow

- Reuse existing:
  - `apps/server/src/routes/token-withdrawals.ts`
  - `apps/server/src/lib/withdrawals/batch-processor.ts`

**On successful High‑Stakes run**:

1. Compute `(usdc, ghst)` payout.
2. If either > 0:
   - Create appropriate withdrawal records for the player’s wallet / account.
   - Tag them with metadata:
     - `source: 'high_stakes_run'`
     - `difficulty_id`
     - `run_id`
     - `run_score`
3. Let the **existing batch processor** handle actual sending.

---

## 7. Defaults & Tuning Knobs

### 7.1. Initial Defaults

- **scoreThresholdFraction**: `0.5`
- **attunementsPerDay**: `1`
- **resetTimeUtcHour**: `0` (midnight UTC)
- **baselineReferenceScore** (examples):
  - `normal`: `5000`
  - `nightmare`: `10000`
  - `hell`: `15000`
  - `beyond_hell`: `20000`
- **maxPayoutPerDifficulty** (examples, rough scale):
  - `normal`: `{ USDC: 0.5, GHST: 2 }`
  - `nightmare`: `{ USDC: 1.0, GHST: 4 }`
  - `hell`: `{ USDC: 1.5, GHST: 6 }`
  - `beyond_hell`: `{ USDC: 2.0, GHST: 8 }`

These need to be cross‑checked against:

- Typical `runScore` ranges per difficulty.
- Existing chest / boss EV in `CHEST_REWARD_DISTRIBUTIONS` and `difficulty-tiers`.
- Overall target currency emission per active player per day.

### 7.2. Simple Levers for Live Ops

Without code changes, you can:

- Adjust **scoreThresholdFraction** (e.g. 0.4–0.6).
- Adjust **per‑difficulty caps** up/down.
- Adjust **attunementsPerDay** (e.g. from 1 → 2 if engagement is high and economy allows).
- Enable/disable the entire system with `dailyRuns.enabled`.

---

## 8. Implementation Steps Checklist

1. **Data & config**
   - [ ] Add `dailyRuns` section to `GAME_CONFIG`.
   - [ ] Create `daily_boss_high_scores` table + migration.
   - [ ] Create `daily_high_stakes_state` table + migration.
   - [ ] Reuse existing `games`, `game_players`, and `run_scores` tables for per‑run data (no new boss run table needed).

2. **Server logic**
   - [ ] Implement `computeRunScore(context)` and integrate into boss kill flow.
   - [ ] Implement insertion/upsert of today’s high score on boss kill.
   - [ ] Implement helper to fetch `Y` (yesterday’s high or baseline).
   - [ ] Implement `computeHighStakesBossPayout(...)`.
   - [ ] Wire payout computation into boss kill pipeline and enqueue withdrawals.

3. **High‑Stakes state management**
   - [ ] Implement endpoint to preview daily runs state: `GET /daily-runs/preview`.
   - [ ] Implement endpoint to attune a difficulty: `POST /daily-runs/attune`.
   - [ ] Hook run creation to mark `isHighStakes` based on attunement.
   - [ ] Clear attunement on run completion / abandon.

4. **Cleanup (optional)**
   - [ ] Add periodic cleanup of old `daily_boss_high_scores` and `daily_high_stakes_state` rows (e.g. prune entries older than N days).

5. **Client UX**
   - [ ] Portal Mage dialogue hooks:
     - Show yesterday’s high, threshold, and caps for the **currently selected Lobby difficulty**.
     - Show remaining High‑Stakes attunements.
     - Allow confirming use of the Daily Jackpot and calling `attune`.
   - [ ] Boss summary screen:
     - Show score vs reference / threshold.
     - Show payout result for High‑Stakes runs.

6. **Monitoring / analytics**
   - [ ] Log High‑Stakes runs including `difficulty`, `runScore`, `Y`, payout amounts.
   - [ ] Create simple dashboards (or queries) for:
     - Distribution of `runScore` per difficulty.
     - Number of High‑Stakes attempts per day, success rate.
     - Total daily GHST / USDC emitted via High‑Stakes.

Once these pieces are in place, you can incrementally refine:

- The **runScore formula**.
- The **reference score smoothing** (multi‑day percentiles instead of single‑day high).
- The **caps and thresholds**, based on real data.

---

## 9. Example Player Story (Happy Path)

### 9.1. Daily reset and setup

- **00:00 UTC**: Daily reset job runs.
  - `daily_high_stakes_state` is reset for all accounts: each gets `attunementsPerDay = 1`.
  - `daily_boss_high_scores` now has a row for **yesterday** per difficulty (or falls back to `baselineReferenceScore` if no data).
- **Player logs in** later in the day.
  - They have **1 High‑Stakes attunement** available.
  - The game has already tracked some runs from other players, updating **today’s** `daily_boss_high_scores`, but today’s value does **not** affect their threshold (which is based on **yesterday**).

### 9.2. Choosing difficulty and talking to Portal Mage

- **Player opens Lobby** and selects **Nightmare** difficulty for their next dungeon run.
- Before starting the run, they walk over to the **Portal Mage** and interact.
- Client calls `GET /daily-runs/preview` with the player’s account id and current Lobby difficulty.
- Server responds with:
  - Yesterday’s high score for Nightmare: `Y = 12_340`.
  - Threshold for payout: `T * Y = 0.5 * 12_340 = 6_170`.
  - Max possible payout caps for Nightmare, e.g. `1.0 USDC` and `4.0 GHST`.
  - Remaining attunements today: `1`.
- The Portal Mage UI shows:
  - “Yesterday’s best Nightmare score: **12,340**.”
  - “You must score at least **6,170** to earn a payout.”
  - “If you match or beat **12,340**, you can earn up to **4.0 GHST and 1.0 USDC**.”
- Player chooses “Use my Daily Jackpot on this run.”
- Client calls `POST /daily-runs/attune` with `{ difficultyId: 'nightmare_X' }` (actual tier id from Lobby).
- Server:
  - Verifies they still have `remaining_attunements > 0`.
  - Writes/updates `daily_high_stakes_state` for `(today, account_id)`:
    - `remaining_attunements` becomes `0`.
    - `active_difficulty_id` is set to the Nightmare tier id.
    - `active_run_id` remains `null` until the run is created.

### 9.3. Starting the High‑Stakes run

- Player starts the dungeon run from the Lobby on Nightmare.
- When the server creates the new `game` / `game_players` entries:
  - It checks `daily_high_stakes_state` for `(today, account_id)`.
  - Sees that `active_difficulty_id` matches the new game’s `difficulty_tier`.
  - Flags this run as High‑Stakes:
    - `run.isHighStakes = true`.
    - `active_run_id` is set to this game’s id.
- Player plays the run as normal.
  - Score is tracked via the existing Player Score system, ultimately persisted in `run_scores.score`.

### 9.4. Boss kill and payout

- Player reaches and kills the boss.
- On boss death:
  - Server looks up `run_scores.score` (or equivalent) and treats that as `runScore`.
    - Suppose the final `runScore` persisted in `run_scores.score` is `S = 10_000`.
  - Server updates **today’s** high score in `daily_boss_high_scores` for Nightmare if `S` is higher than the current value.
  - Server reads **yesterday’s** high score for Nightmare:
    - Finds `Y = 12_340` in `daily_boss_high_scores` for yesterday.
  - Check threshold:
    - `T = 0.5`, so `T * Y = 6_170`.
    - `S = 10_000` ≥ `6_170` → eligible for payout.
  - Compute payout ratio:

    ```ts
    raw = S / Y; // 10_000 / 12_340 ≈ 0.81
    r = clamp(raw, T, 1); // ~0.81 in [0.5, 1]
    caps = { USDC: 1.0, GHST: 4.0 };
    payoutUSDC = 0.81 * 1.0; // ≈ 0.81
    payoutGHST = 0.81 * 4.0; // ≈ 3.24
    ```

  - Server records payout in the existing withdrawals system (e.g. creates `token_withdrawals` rows) and tags them as coming from `high_stakes_run`.
  - `run_scores.metadata.highStakes` is populated with:
    - `isHighStakes: true`
    - `consumed: true`
    - `referenceScore: 12340`
    - `thresholdScore: 6170`
    - `payoutUSDC: 0.81`
    - `payoutGHST: 3.24`
  - `daily_high_stakes_state` is updated to clear `active_difficulty_id` and `active_run_id` for this account (attunement is now fully consumed).

### 9.5. Boss summary and follow‑up runs

- Server sends a boss summary payload back to the client:
  - `runScore = 10000`
  - `referenceScore = 12340`
  - `thresholdScore = 6170`
  - `isHighStakes = true`
  - `payoutUSDC ≈ 0.81`
  - `payoutGHST ≈ 3.24`
- Client shows a High‑Stakes summary panel:
  - “You scored **10,000** vs yesterday’s reference **12,340**.”
  - “You hit **~81%** of the reference and earned **3.24 GHST and 0.81 USDC**.”
- Player continues to play:
  - Any additional runs that day are **not** High‑Stakes (their `remaining_attunements` is 0).
  - They can still earn normal loot and any non‑High‑Stakes boss currency the existing systems provide.
- After the next daily reset:
  - They receive a fresh High‑Stakes attunement and can repeat the process on any difficulty they choose in the Lobby.

---

## 10. Testing & Migration Considerations

### 10.1. Database migrations

- **Existing tables relied on**
  - `games` (from `20250216_000004_games_telemetry.sql`):
    - Provides `id`, `difficulty_tier`, `metadata` (including `bossKilled`), and `floor_reached`.
  - `game_players` (same migration):
    - Provides per‑player/game stats and `metadata` for runs.
  - `run_scores` (from `20250928_000021_player_scores.sql`):
    - Provides canonical per‑player run `score`, `difficulty_tier`, and `metadata`.
  - `economy_transactions` (from `20250216_000006_economy_ledger.sql`) and `token_withdrawals` (from `20250220_000022_create_token_withdrawals.sql`):
    - Already support currency accounting and withdrawal flows; High‑Stakes payouts should **reuse** these, not introduce a parallel path.

- **New tables to add**
  - `daily_boss_high_scores`:
    - Keyed by `(date, difficulty_id)` with `score`, optional `account_id`, `run_id`, timestamps, and indexes on `(date, difficulty_id)` and optionally `(difficulty_id, date desc)`.
  - `daily_high_stakes_state`:
    - Keyed by `(date, account_id)` with `remaining_attunements`, `active_difficulty_id`, `active_run_id`, and timestamps.
  - Migrations should:
    - Be **additive**, using `create table if not exists` and `create index if not exists`.
    - Avoid backfilling; both tables can safely start empty and fill from live traffic.
    - Maintain the same schema in all environments (dev/staging/prod).

- **Order and deployment**
  - Ensure new migrations run **after** the existing `games`, `game_players`, `run_scores`, `economy_transactions`, and `token_withdrawals` migrations.
  - Ship migrations first, then roll out server changes that depend on them (High‑Stakes logic should guard on `dailyRuns.enabled` and degrade gracefully if disabled).

### 10.2. Unit tests (server)

- **Scoring and payout**
  - `computeHighStakesBossPayout`:
    - Given `(S, Y, T, caps)`, verify:
      - `S < T*Y` → payout is `{ usdc: 0, ghst: 0 }`.
      - `S = T*Y` → payout is `T * caps`.
      - `S = Y` or higher → payout is exactly `caps`.
      - Intermediate values interpolate linearly and clamp correctly between `[T, 1]`.
  - Reference score helper:
    - When a row exists in `daily_boss_high_scores` for `yesterday`, it is used as `Y`.
    - When no row exists, `baselineReferenceScore[difficulty]` is used.

- **Daily state helpers**
  - `daily_high_stakes_state`:
    - First preview/attune call on a new UTC date creates a row with `remaining_attunements = attunementsPerDay` and null `active_*` fields.
    - Attuning decrements `remaining_attunements` and sets `active_difficulty_id`.
    - Run start correctly sets `active_run_id` only when difficulty matches.
    - Run end clears `active_*` for that date/account.
  - `daily_boss_high_scores`:
    - Boss kill upserts the row for `(todayUtcDate, difficulty)` and only raises `score` when higher than existing.

### 10.3. Integration tests / end‑to‑end

- **High‑Stakes happy path**
  - Given a player with one attunement and known `Y` for Nightmare:
    - Attune via `POST /daily-runs/attune`.
    - Run a Nightmare dungeon, kill the boss, and force `runScore = S` where `T*Y ≤ S ≤ Y`.
    - Assert:
      - `run_scores` row exists with `score = S` and metadata including `highStakes` block.
      - `daily_boss_high_scores` has today’s row updated to at least `S`.
      - A `token_withdrawals` record exists with the expected `(usdc, ghst)` amounts.
      - The boss summary payload to the client contains `runScore`, `referenceScore`, `thresholdScore`, and the computed payout.

- **Threshold and baseline behavior**
  - Case where `yesterday` has no entry for the difficulty:
    - Ensure `baselineReferenceScore[difficulty]` is used as `Y` and payouts/eligibility behave as expected.
  - Case where `S < T*Y`:
    - Ensure no `token_withdrawals` are created and attunement is still consumed.

- **Multiple runs and daily boundaries**
  - Same day:
    - Use the attunement, complete a High‑Stakes run, then start additional runs:
      - Verify additional runs are non‑High‑Stakes (unless you explicitly add more attunements via config).
  - Cross‑day:
    - Simulate hitting a UTC day boundary (or mock the date helper):
      - Verify a new `(date, account_id)` row is created with fresh attunements.
      - Verify `Y` correctly flips to the previous day’s high scores.

### 10.4. Guarding / simplifying existing reward logic

- **Configuration gating**
  - Add a boolean `dailyRuns.enabled` flag in `GAME_CONFIG`:
    - When `false`, all new High‑Stakes logic should be a **no‑op**: no `daily_*` tables writes and no score‑based boss payouts.
    - When `true`, High‑Stakes payouts supplement or replace existing boss currency logic per design.

- **Single source of truth for boss currency**
  - Decide explicitly:
    - Whether `rollBossCurrency` should still run for boss kills when `run.isHighStakes = true`, or whether High‑Stakes payouts fully replace the currency part for those runs.
  - Implement that decision in **one place** (e.g. in `EnemyDeathSystem` around the boss death block) and document it in comments to avoid future duplication.

- **Regression coverage**
  - Add tests (or targeted manual checks) to ensure:
    - When `dailyRuns.enabled = false`, the current boss currency behavior is unchanged.
    - When `dailyRuns.enabled = true` but a run is not High‑Stakes, existing `rollBossCurrency` behavior still applies as expected.
