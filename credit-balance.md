## Credits by Wearable Rarity — Implementation Plan

### Summary

- Disable difficulty-based entry fees at runtime (keep `tier.levelCost` intact for possible reintroduction later).
- Charge entry credits based on the highest equipped wearable rarity on the player at join time.
- Cost schedule (absolute, not additive):
  - Naked: 1
  - Common: 2
  - Uncommon: 3
  - Rare: 5
  - Legendary: 8
  - Mythical: 10
  - Godlike: 20
- Number of items does not matter; we use the highest rarity present.
- All equipped slots count (head, body, face, eyes, handLeft, handRight, pet, background). Weapons are included. Quality tiers are ignored for pricing.
- Price is locked at join time.

### Server changes

1. Centralize cost logic

- New module: `apps/server/src/lib/economy/entry-cost.ts`
  - Expose:
    - `getEntryCreditsForRarity(maxRarity: WearableRarity | null): number`
    - `getMaxEquippedRarityForPlayer(playerId: string): Promise<WearableRarity | null>`
    - `getEntryFeeCentsForPlayer(playerId: string): Promise<number>` (wraps the above and multiplies by 100)
  - Implementation details:
    - Fetch equipment once using `getPlayerEquipmentState(playerId)` from `equipment-service`.
    - Prefer `equippedWearablesWithQuality` (array of `{ slot, slug, quality }`) to avoid string parsing and keep slot assignment explicit.
    - For each slug, resolve `getWearableBySlug(slug)` and `getWearableRarity(def)` from `apps/server/src/data/wearables`.
    - Determine max rarity by order: common < uncommon < rare < legendary < mythical < godlike. Map to the schedule above.
    - If the player has no equipped wearables, treat as Naked (1 credit).
    - If any equipped slug cannot resolve to a known rarity, throw an error (should never happen).

2. Charge entry using wearable-based credits

- Update `apps/server/src/rooms/GameRoom.ts` join flow to ignore difficulty `levelCost` for pricing and instead call `getEntryFeeCentsForPlayer(playerId)`.
- Current charge site (to replace):

```6422:6495:apps/server/src/rooms/GameRoom.ts
const tier = getDifficultyTier(this.state.difficultyTier);
const levelCost = tier?.levelCost ?? 0;
...
if (levelCost > 0 && !entryFeeCharged) {
  const costCents = Math.round(levelCost * 100);
  const playerRecord = await playersRepo.getPlayerById(playerId);
  ...
  const updated = await playersRepo.updateCredits(playerId, -costCents);
  ...
  this.logEconomyTransaction({
    playerId,
    currency: 'CREDITS',
    amount: -levelCost,
    source: 'game_entry',
    gameId: this.currentGameId,
    metadata: {
      difficultyTier: this.state.difficultyTier,
      entryFeeCents: costCents,
    },
  });
}
```

- Replace with:
  - `const costCents = await getEntryFeeCentsForPlayer(playerId);`
  - Keep the same insufficient credits handling, ledger tracking, refund behavior.
  - Update log metadata to include wearable cost context (e.g., `wearableCostBracket`, `difficultyTier` for analytics):
    - `metadata: { difficultyTier, entryFeeCents, wearableCostBracket: 'naked'|'common'|'uncommon'|'rare'|'legendary'|'mythical'|'godlike' }`.
  - Do not remove `tier.levelCost` data; simply stop using it for pricing.

3. Refunds/ledger

- No change beyond using `entryFeeCents` from the wearable-based calculation (still tracked in `joinMetadata` and ledger).

4. Preflight entry-cost API (for V2)

- Add a lightweight server endpoint to return the current wearable-based entry cost for the authenticated player.
  - Proposed route: `apps/server/src/routes/entry-cost.ts`
  - Request: `GET /entry-cost` (auth via session/cookie/header used elsewhere)
  - Response:
    - `{ credits: number, cents: number, bracket: 'naked'|'common'|'uncommon'|'rare'|'legendary'|'mythical'|'godlike' }`
  - Implementation: reuse `getEntryFeeCentsForPlayer` and derive `credits = cents / 100` and `bracket` from max rarity.

### Client changes (V2 required)

- Update `apps/client/src/components/Lobby.tsx` to call the preflight endpoint and show the computed cost.
  - Disable CTA when `balance < required credits` and show “Insufficient credits”.
  - Keep existing `useCredits` for balance; add a small `useEntryCost` helper to fetch/cache the preflight result.

### Data and docs

- Keep `apps/server/src/data/difficulty-tiers.ts` as-is for combat/loot scaling; `levelCost` remains intact but is ignored for pricing.
- Update `docs/credits.md` to clarify: credits are determined by highest equipped wearable rarity, independent of difficulty.

### Telemetry/analytics

- Extend `logEconomyTransaction` metadata for `game_entry` with `wearableCostBracket` and computed `entryCredits` for downstream analysis of smurfing vs. bracket usage.

### Edge cases

- If a player equips/unequips after paying (pre-game), we do not re-price; price is locked at join time.
- If any equipped slug lacks a known rarity, throw an error.
- Mixed party: each player pays their own rate.
- Guests: same pricing as linked players; guests pay based on their character’s rarity.

### Test plan

- Player with no equipment → entry fee = 1 credit.
- Equip any Common item → 2; any Uncommon → 3; any Rare → 5; any Legendary → 8; any Mythical → 10; any Godlike → 20.
- Multiple items across tiers → pick highest rarity only.
- All slots count; quality ignored.
- Preflight endpoint returns the same bracket/cost that will be charged on join.
- Difficulty changes do not affect entry fee.
- Refunds still restore the exact `entryFeeCents` charged.

### Decisions (confirmed)

- Replace difficulty costs with wearable-based costs (runtime only); keep `tier.levelCost` for potential future use.
- All equipped slots count; weapons included; quality ignored.
- Guests pay according to their character’s rarity.
- V2 client flow with preflight endpoint and disabled CTA is required.
- Include `wearableCostBracket` in economy logs.
- Throw on unknown rarity resolution.

### Rollout

- Phase 1: Implement server wearable-based charging + preflight endpoint; update Lobby to display/guard with V2 UI.
- Phase 2: Update docs and announce policy change.
