import {
  rollEnemyDrop,
  getEnemyDropThresholdForSimulation,
  type EnemyDropContext,
  getExpectedWearableQualityProportions,
  getExpectedWearableRarityProportions,
  getEliteWearableRarityMultipliers,
  maybeRollLickTongueDrop,
  rollChestItem,
  rollChestItems,
  rollChestCurrency,
  rollBossCurrency,
  LOOT_SOURCE_IDS,
} from '../data/loot-table';

function simulateDrops(num: number, ctx: EnemyDropContext) {
  let successes = 0;
  const items: Record<string, number> = {};
  for (let i = 0; i < num; i += 1) {
    const drop = rollEnemyDrop(ctx);
    if (!drop) continue;
    successes += 1;
    const key =
      drop.type === 'wearable' && (drop as any).quality
        ? `${drop.type}:${drop.name}:${(drop as any).quality}`
        : `${drop.type}:${drop.name}`;
    items[key] = (items[key] ?? 0) + 1;
  }
  return { successes, items };
}

describe('loot-table simulations', () => {
  const N = 5000;

  test('baseline normal enemies ~ base threshold', () => {
    const ctx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 0,
    };
    const expected = getEnemyDropThresholdForSimulation(ctx);
    const { successes } = simulateDrops(N, ctx);
    const observed = successes / N;
    expect(Math.abs(observed - expected)).toBeLessThanOrEqual(0.05);
  });

  test('boss currency "good" tier is disabled on floor 1', () => {
    const trials = 20000;
    let small = 0;
    let ok = 0;
    let good = 0;
    for (let i = 0; i < trials; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i + 700000,
        floorIndex: 0, // floor 1 (0-based)
      });
      if (reward.tier === 'small') small += 1;
      else if (reward.tier === 'ok') ok += 1;
      else if (reward.tier === 'good') good += 1;
    }
    // Ensure no 'good' hits occur on floor 1
    expect(good).toBe(0);
    // And ensure remaining shares inside drop portion are roughly in expected ratio 0.769/0.231
    const drop = small + ok;
    if (drop > 0) {
      const smallShare = small / drop;
      const okShare = ok / drop;
      expect(Math.abs(smallShare - 0.769)).toBeLessThanOrEqual(0.04);
      expect(Math.abs(okShare - 0.231)).toBeLessThanOrEqual(0.04);
    }
  });
  test('elites always drop and only wearables', () => {
    const ctx: EnemyDropContext = {
      classification: 'elite',
    };
    const { successes, items } = simulateDrops(N, ctx);
    expect(successes).toBe(N);
    const keys = Object.keys(items);
    expect(keys.every((k) => k.startsWith('wearable:'))).toBe(true);
  });

  test('run bonus yields expected success prob (threshold + extra roll)', () => {
    const baseCtx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 0,
    };
    const buffCtx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 0.2,
    };
    const baseObserved = simulateDrops(N, baseCtx).successes / N;
    const buffObserved = simulateDrops(N, buffCtx).successes / N;

    const tBuff = getEnemyDropThresholdForSimulation(buffCtx); // includes +runBonus capped at 0.95
    const eBuff = Math.min(
      0.5,
      Math.max(0, buffCtx.killStreakPotionCoinFindBonus || 0)
    );
    const expectedBuff = tBuff + (1 - tBuff) * eBuff; // primary + extra roll on fail

    // Baseline should be near its threshold (0.2)
    const tBase = getEnemyDropThresholdForSimulation(baseCtx);
    expect(Math.abs(baseObserved - tBase)).toBeLessThanOrEqual(0.05);

    // Buffed observed should be close to theoretical expected (~0.52 for +0.2 bonus)
    expect(Math.abs(buffObserved - expectedBuff)).toBeLessThanOrEqual(0.04);

    // And of course greater than baseline
    expect(buffObserved).toBeGreaterThan(baseObserved);
  });

  test('high run bonus saturates cap and extra roll (0.95 + 0.5 on fail)', () => {
    const ctx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 1,
    };
    const observed = simulateDrops(N, ctx).successes / N;
    const t = getEnemyDropThresholdForSimulation(ctx); // 0.95 cap
    const e = 0.5; // extra roll cap
    const expected = t + (1 - t) * e; // 0.975
    expect(Math.abs(observed - expected)).toBeLessThanOrEqual(0.02);
  });

  test('potion farm biases toward potions', () => {
    const ctx: EnemyDropContext = {
      classification: 'trash',
      potionFarm: {
        enabled: true,
        enableReweight: true,
        potionWeightMultiplier: 3,
        enableExtraRoll: true,
        extraRollChance: 0.2,
        hpToManaBias: 0.8,
      },
    };
    const baseCtx: EnemyDropContext = { classification: 'trash' };
    const base = simulateDrops(N, baseCtx);
    const withFarm = simulateDrops(N, ctx);
    const basePotion = Object.entries(base.items)
      .filter(([k]) => k.startsWith('potion:'))
      .reduce((s, [, v]) => s + v, 0);
    const farmPotion = Object.entries(withFarm.items)
      .filter(([k]) => k.startsWith('potion:'))
      .reduce((s, [, v]) => s + v, 0);
    expect(farmPotion).toBeGreaterThan(basePotion);
  });

  test('wearable rarity×quality joint distribution sanity', () => {
    const ctx: EnemyDropContext = { classification: 'elite' };
    const { items } = simulateDrops(N, ctx);
    const groups: Record<string, number> = {};
    let totalWear = 0;
    for (const [k, v] of Object.entries(items)) {
      if (!k.startsWith('wearable:')) continue;
      totalWear += v;
      const [, name, quality] = k.split(':');
      // name unused; quality used below
      const rarity = 'unknown'; // rarity is included inside roll (embedded on item); skipping per-name rarity in smoke test
      const key = `${rarity}|${quality}`;
      groups[key] = (groups[key] ?? 0) + v;
    }
    // Only assert non-degenerate totals here
    expect(totalWear).toBeGreaterThan(0);
  });

  test('wearable quality distribution roughly matches expected proportions', () => {
    const ctx: EnemyDropContext = { classification: 'elite' };
    const { items } = simulateDrops(N, ctx);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of Object.entries(items)) {
      if (!k.startsWith('wearable:')) continue;
      const parts = k.split(':');
      const quality = parts[2];
      counts[quality] = (counts[quality] ?? 0) + v;
      total += v;
    }
    const observed: Record<string, number> = {};
    Object.entries(counts).forEach(([q, c]) => {
      observed[q] = c / total;
    });
    const expected = getExpectedWearableQualityProportions();
    // Allow generous tolerance due to sampling; 5% per bucket
    (Object.keys(expected) as Array<keyof typeof expected>).forEach((q) => {
      const obs = observed[q] ?? 0;
      expect(Math.abs(obs - expected[q])).toBeLessThanOrEqual(0.05);
    });
  });

  test('wearable rarity distribution roughly matches expected proportions', () => {
    function simulateEliteRarity(num: number) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < num; i += 1) {
        const drop = rollEnemyDrop({ classification: 'elite' });
        if (!drop || drop.type !== 'wearable' || !(drop as any).rarity)
          continue;
        const r = (drop as any).rarity as string;
        counts[r] = (counts[r] ?? 0) + 1;
      }
      return counts;
    }
    const counts = simulateEliteRarity(N);
    const total = Object.values(counts).reduce((s, v) => s + v, 0);
    const observed: Record<string, number> = {};
    Object.entries(counts).forEach(([r, c]) => {
      observed[r] = c / total;
    });
    const expected = getExpectedWearableRarityProportions();
    (Object.keys(expected) as Array<keyof typeof expected>).forEach((r) => {
      const obs = observed[r] ?? 0;

      expect(Math.abs(obs - expected[r])).toBeLessThanOrEqual(0.05);
    });
  });

  // Why: Normal enemies' wearable rarity now respects difficulty-tier multipliers.
  // Coverage: Ensures higher difficulties bias toward higher rarities for NORMAL enemies.
  test('normal enemy wearable rarity shifts upward with higher difficulty', () => {
    const Nbig = 15000;
    function simulateNormalRarity(tierId: string) {
      const counts: Record<string, number> = {};
      let total = 0;
      for (let i = 0; i < Nbig; i += 1) {
        const drop = rollEnemyDrop({
          classification: 'trash',
          difficultyTierId: tierId,
        });
        if (!drop || drop.type !== 'wearable' || !(drop as any).rarity)
          continue;
        const r = (drop as any).rarity as string;
        counts[r] = (counts[r] ?? 0) + 1;
        total += 1;
      }
      const hiShare = ['rare', 'legendary', 'mythical', 'godlike'].reduce(
        (s, r) => s + (counts[r] ?? 0),
        0
      );
      return total > 0 ? hiShare / total : 0;
    }
    const low = simulateNormalRarity('normal_1');
    const high = simulateNormalRarity('nightmare_3');
    expect(high).toBeGreaterThan(low);
  });

  // Why: Elite wearable rarity is difficulty-biased; verify increased high-rarity share at higher tiers.
  // Coverage: Ensures elite rarity weighting increases with tier and agrees with expected proportions.
  test('elite wearable rarity increases with difficulty and matches expected proportions', () => {
    const Nbig = 15000;
    function simulateEliteRarity(tierId: string) {
      const counts: Record<string, number> = {};
      let total = 0;
      for (let i = 0; i < Nbig; i += 1) {
        const drop = rollEnemyDrop({
          classification: 'elite',
          difficultyTierId: tierId,
        });
        if (!drop || drop.type !== 'wearable' || !(drop as any).rarity)
          continue;
        const r = (drop as any).rarity as string;
        counts[r] = (counts[r] ?? 0) + 1;
        total += 1;
      }
      return { counts, total };
    }
    const low = simulateEliteRarity('normal_1');
    const high = simulateEliteRarity('hell_3');
    const lowHi =
      ['rare', 'legendary', 'mythical', 'godlike'].reduce(
        (s, r) => s + (low.counts[r] ?? 0),
        0
      ) / Math.max(1, low.total);
    const highHi =
      ['rare', 'legendary', 'mythical', 'godlike'].reduce(
        (s, r) => s + (high.counts[r] ?? 0),
        0
      ) / Math.max(1, high.total);
    expect(highHi).toBeGreaterThan(lowHi);

    // Also check expected proportions with multipliers at high tier
    const expectedRarity = getExpectedWearableRarityProportions(
      getEliteWearableRarityMultipliers('hell_3')
    );
    const observed: Record<string, number> = {};
    Object.entries(high.counts).forEach(([r, c]) => {
      observed[r] = c / high.total;
    });
    (Object.keys(expectedRarity) as Array<keyof typeof expectedRarity>).forEach(
      (r) => {
        const obs = observed[r] ?? 0;
        expect(Math.abs(obs - expectedRarity[r])).toBeLessThanOrEqual(0.06);
      }
    );
  });

  // Why: Enemies should never drop USDC coins; script enforces this, test to guard regressions.
  // Coverage: Validates the USDC denial rule in enemy coin drops.
  test('enemies never drop USDC coin', () => {
    const N = 12000;
    let usdcHits = 0;
    for (let i = 0; i < N; i += 1) {
      const drop = rollEnemyDrop({ classification: 'trash' });
      if (!drop) continue;
      const key = `${drop.type}:${drop.name}`.toLowerCase();
      if (key.includes('coin:usdc')) usdcHits += 1;
    }
    expect(usdcHits).toBe(0);
  });

  // Why: Potion Farm extra roll should increase drop rate even when categories are unchanged.
  // Coverage: Confirms extra roll path raises success probability in practice.
  test('potion farm extra roll increases drop success rate', () => {
    const trials = 6000;
    const base =
      simulateDrops(trials, { classification: 'trash' }).successes / trials;
    const withFarm =
      simulateDrops(trials, {
        classification: 'trash',
        potionFarm: {
          enabled: true,
          enableReweight: false,
          potionWeightMultiplier: 1,
          enableExtraRoll: true,
          extraRollChance: 0.3,
          hpToManaBias: 0.5,
        },
      }).successes / trials;
    expect(withFarm).toBeGreaterThan(base);
  });

  // Why: Potion Farm HP/Mana bias should steer which potion appears more frequently.
  // Coverage: Verifies hpToManaBias=0.8 favors Health and hpToManaBias=0.2 favors Mana.
  test('potion farm hp/mana bias shifts potion outcomes', () => {
    const trials = 12000;
    function countPotions(bias: number) {
      const ctx: EnemyDropContext = {
        classification: 'trash',
        potionFarm: {
          enabled: true,
          enableReweight: false,
          potionWeightMultiplier: 1,
          enableExtraRoll: false,
          extraRollChance: 0,
          hpToManaBias: bias,
        },
      };
      const result = simulateDrops(trials, ctx);
      const hp = Object.entries(result.items)
        .filter(([k]) => k.toLowerCase().startsWith('potion:health potion'))
        .reduce((s, [, v]) => s + v, 0);
      const mana = Object.entries(result.items)
        .filter(([k]) => k.toLowerCase().startsWith('potion:mana potion'))
        .reduce((s, [, v]) => s + v, 0);
      return { hp, mana };
    }
    const hi = countPotions(0.8);
    const lo = countPotions(0.2);
    expect(hi.hp).toBeGreaterThan(hi.mana);
    expect(lo.mana).toBeGreaterThan(lo.hp);
  });

  // Why: Lick Tongue special drop chance should reflect base + bonus; test with mocked aggregator.
  // Coverage: Validates maybeRollLickTongueDrop probability calibration with tags.
  test('lick tongue drop probability ~ base + bonus with tags', () => {
    const trials = 12000;
    const bonus = 0.05;
    const tags = ['lickquidator'];
    let hits = 0;
    for (let i = 0; i < trials; i += 1) {
      if (maybeRollLickTongueDrop(tags, () => ({ bonusChance: bonus })))
        hits += 1;
    }
    const observed = hits / trials;
    // Base is 0.1 in table; expected ~ 0.15. Allow generous tolerance.
    expect(Math.abs(observed - 0.15)).toBeLessThanOrEqual(0.03);
  });

  test('difficulty drop rate multipliers (normal_2, nightmare_2, hell_2)', () => {
    const baseCtx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 0,
    };
    const n2Ctx: EnemyDropContext = {
      classification: 'trash',
      difficultyTierId: 'normal_2',
    };
    const nm2Ctx: EnemyDropContext = {
      classification: 'trash',
      difficultyTierId: 'nightmare_2',
    };
    const h2Ctx: EnemyDropContext = {
      classification: 'trash',
      difficultyTierId: 'hell_2',
    };

    const baseT = getEnemyDropThresholdForSimulation(baseCtx); // base 0.2
    const n2T = getEnemyDropThresholdForSimulation(n2Ctx);
    const nm2T = getEnemyDropThresholdForSimulation(nm2Ctx);
    const h2T = getEnemyDropThresholdForSimulation(h2Ctx);

    // Check theoretical thresholds scale up
    expect(n2T).toBeGreaterThan(baseT);
    expect(nm2T).toBeGreaterThan(n2T);
    expect(h2T).toBeGreaterThan(nm2T);

    // Empirically validate ordering
    const trials = 4000;
    const baseObs = simulateDrops(trials, baseCtx).successes / trials;
    const n2Obs = simulateDrops(trials, n2Ctx).successes / trials;
    const nm2Obs = simulateDrops(trials, nm2Ctx).successes / trials;
    const h2Obs = simulateDrops(trials, h2Ctx).successes / trials;

    expect(n2Obs).toBeGreaterThan(baseObs);
    expect(nm2Obs).toBeGreaterThan(n2Obs);
    expect(h2Obs).toBeGreaterThan(nm2Obs);
  });

  test.each([
    ['normal_1'],
    ['normal_3'],
    ['nightmare_3'],
    ['hell_1'],
    ['hell_3'],
  ])('drop rate within tolerance for %s', (tierId) => {
    const ctx: EnemyDropContext = {
      classification: 'trash',
      killStreakPotionCoinFindBonus: 0,
      difficultyTierId: tierId,
    };
    const expected = getEnemyDropThresholdForSimulation(ctx);
    const Ntrials = 6000;
    const observed = simulateDrops(Ntrials, ctx).successes / Ntrials;
    // Use 5% absolute tolerance for stochastic error
    expect(Math.abs(observed - expected)).toBeLessThanOrEqual(0.05);
  });
});

describe('treasure chest simulations', () => {
  const CHEST_TRIALS = 15000;

  test('chests only produce coin or wearable items (no potions/materials/weapons)', () => {
    let invalid = 0;
    let coinCount = 0;
    let wearCount = 0;
    for (let i = 0; i < CHEST_TRIALS; i += 1) {
      const item = rollChestItem({ sourceId: LOOT_SOURCE_IDS.treasureChest });
      if (item.type === 'coin') coinCount += 1;
      else if (item.type === 'wearable') wearCount += 1;
      else invalid += 1;
    }
    expect(invalid).toBe(0);
    expect(coinCount + wearCount).toBe(CHEST_TRIALS);
  });

  test('chest coin items never include USDC (handled by currency pipeline)', () => {
    const trials = 8000;
    let usdcHits = 0;
    for (let i = 0; i < trials; i += 1) {
      const item = rollChestItem({ sourceId: LOOT_SOURCE_IDS.treasureChest });
      if (item.type !== 'coin') continue;
      const key = `${item.type}:${item.name}`.toLowerCase();
      if (key.includes('coin:usdc')) usdcHits += 1;
    }
    expect(usdcHits).toBe(0);
  });

  test.each(['normal_1', 'nightmare_2', 'hell_3'])(
    'USDC average aligns with expected value for %s',
    (tierId) => {
      const trials = 12000;
      // Expected value is tier-level; take from helper once
      const expected = rollChestCurrency({
        difficultyTierId: tierId,
        currency: 'USDC',
        randomSeed: 1234,
      }).expectedValue;
      let sum = 0;
      for (let i = 0; i < trials; i += 1) {
        const r = rollChestCurrency({
          difficultyTierId: tierId,
          currency: 'USDC',
          randomSeed: i,
        });
        sum += r.amount;
      }
      const avg = sum / trials;
      const relErr = Math.abs(avg - expected) / Math.max(expected, 1e-6);
      // Allow 15% relative error due to stochastic sampling and distribution shape
      expect(relErr).toBeLessThanOrEqual(0.15);
    }
  );

  test.each(['normal_1', 'nightmare_2', 'hell_3'])(
    'GHST average aligns with expected value for %s',
    (tierId) => {
      const trials = 12000;
      const expected = rollChestCurrency({
        difficultyTierId: tierId,
        currency: 'GHST',
        randomSeed: 4321,
      }).expectedValue;
      let sum = 0;
      for (let i = 0; i < trials; i += 1) {
        const r = rollChestCurrency({
          difficultyTierId: tierId,
          currency: 'GHST',
          randomSeed: i + 777,
        });
        sum += r.amount;
      }
      const avg = sum / trials;
      const relErr = Math.abs(avg - expected) / Math.max(expected, 1e-6);
      expect(relErr).toBeLessThanOrEqual(0.15);
    }
  );

  test('chest wearable rarity increases with difficulty', () => {
    const trials = 20000;
    function simulateWearableHighShare(tierId: string) {
      const hiSet = new Set(['rare', 'legendary', 'mythical', 'godlike']);
      let hi = 0;
      let total = 0;
      for (let i = 0; i < trials; i += 1) {
        const item = rollChestItem({
          difficultyTierId: tierId,
          sourceId: LOOT_SOURCE_IDS.treasureChest,
        });
        if (item.type !== 'wearable') continue;
        const rarity = (item as any).rarity as string | undefined;
        if (!rarity) continue;
        total += 1;
        if (hiSet.has(rarity)) hi += 1;
      }
      return total > 0 ? hi / total : 0;
    }
    const low = simulateWearableHighShare('normal_1');
    const high = simulateWearableHighShare('hell_3');
    expect(high).toBeGreaterThan(low);
  });

  test('chest wearable rarity proportions roughly match expectations (e.g., hell_3)', () => {
    const tierId = 'hell_3';
    const trials = 20000;
    const counts: Record<string, number> = {};
    let total = 0;
    for (let i = 0; i < trials; i += 1) {
      const item = rollChestItem({
        difficultyTierId: tierId,
        sourceId: LOOT_SOURCE_IDS.treasureChest,
      });
      if (item.type !== 'wearable') continue;
      const r = (item as any).rarity as string | undefined;
      if (!r) continue;
      counts[r] = (counts[r] ?? 0) + 1;
      total += 1;
    }
    const observed: Record<string, number> = {};
    Object.entries(counts).forEach(([r, c]) => {
      observed[r] = total > 0 ? c / total : 0;
    });
    const expected = getExpectedWearableRarityProportions(
      getEliteWearableRarityMultipliers(tierId)
    );
    (Object.keys(expected) as Array<keyof typeof expected>).forEach((r) => {
      const obs = observed[r] ?? 0;
      expect(Math.abs(obs - expected[r])).toBeLessThanOrEqual(0.07);
    });
  });
});

describe('boss currency drop simulations', () => {
  const BOSS_TRIALS = 50000;

  test('boss currency tier probabilities match expected distribution (floor 2+)', () => {
    const tierCounts: Record<string, number> = {
      none: 0,
      small: 0,
      ok: 0,
      good: 0,
    };

    for (let i = 0; i < BOSS_TRIALS; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
        floorIndex: 1, // floor 2 enables "good"
      });
      tierCounts[reward.tier] = (tierCounts[reward.tier] ?? 0) + 1;
    }

    const observed = {
      none: tierCounts.none / BOSS_TRIALS,
      small: tierCounts.small / BOSS_TRIALS,
      ok: tierCounts.ok / BOSS_TRIALS,
      good: tierCounts.good / BOSS_TRIALS,
    };

    // Expected with floorIndex=1 (depth bonus 0.02) and L=1 baseline
    const dropTarget = 0.4 + 0.02;
    const expected = {
      none: 1 - dropTarget,
      small: 0.75 * dropTarget,
      ok: 0.225 * dropTarget,
      good: 0.025 * dropTarget,
    };

    // Allow 2.5% tolerance for stochastic sampling
    expect(Math.abs(observed.none - expected.none)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.small - expected.small)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.ok - expected.ok)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.good - expected.good)).toBeLessThanOrEqual(0.025);
  });

  test('boss currency tier probabilities scale with leverage (L=10, floor 2+)', () => {
    const tierCounts: Record<string, number> = {
      none: 0,
      small: 0,
      ok: 0,
      good: 0,
    };

    const L = 10;
    const dropTarget = 0.4 + 0.2 * ((L - 1) / 9); // 0.6 at L=10
    const expected = {
      none: 1 - dropTarget, // 0.4
      small: 0.75 * dropTarget, // 0.45
      ok: 0.225 * dropTarget, // 0.135
      good: 0.025 * dropTarget, // 0.015
    };

    for (let i = 0; i < BOSS_TRIALS; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i + 100000,
        leverageTotal: L,
      floorIndex: 1 });
      tierCounts[reward.tier] = (tierCounts[reward.tier] ?? 0) + 1;
    }

    const observed = {
      none: tierCounts.none / BOSS_TRIALS,
      small: tierCounts.small / BOSS_TRIALS,
      ok: tierCounts.ok / BOSS_TRIALS,
      good: tierCounts.good / BOSS_TRIALS,
    };

    // Allow 2.5% tolerance for stochastic sampling at scaled probabilities
    expect(Math.abs(observed.none - expected.none)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.small - expected.small)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.ok - expected.ok)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(observed.good - expected.good)).toBeLessThanOrEqual(0.025);
  });

  test('boss currency amounts scale with difficulty tier', () => {
    const tiers = ['normal_1', 'nightmare_2', 'hell_3'];
    const averages: Record<string, number> = {};

    for (const tierId of tiers) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < 10000; i += 1) {
        const reward = rollBossCurrency({
          difficultyTierId: tierId,
          currency: 'USDC',
          randomSeed: i + tierId.length,
        });
        if (reward.amount > 0) {
          sum += reward.amount;
          count += 1;
        }
      }
      averages[tierId] = count > 0 ? sum / count : 0;
    }

    // Higher tiers should have higher average amounts
    expect(averages['nightmare_2']).toBeGreaterThan(averages['normal_1']);
    expect(averages['hell_3']).toBeGreaterThan(averages['nightmare_2']);
  });

  test('boss currency tier multipliers are correctly applied (floor 2+)', () => {
    const tierAmounts: Record<string, number[]> = {
      small: [],
      ok: [],
      good: [],
    };

    for (let i = 0; i < 20000; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
        floorIndex: 1,
      });
      if (reward.tier !== 'none' && reward.baseAmount > 0) {
        const multiplier = reward.amount / reward.baseAmount;
        tierAmounts[reward.tier].push(multiplier);

        // Verify multipliers are approximately correct
        if (reward.tier === 'small') {
          expect(multiplier).toBeCloseTo(0.3, 1);
        } else if (reward.tier === 'ok') {
          expect(multiplier).toBeCloseTo(1.0, 1);
        } else if (reward.tier === 'good') {
          expect(multiplier).toBeCloseTo(3.0, 1);
        }
      }
    }

    // Verify we collected samples from each tier
    expect(tierAmounts.small.length).toBeGreaterThan(0);
    expect(tierAmounts.ok.length).toBeGreaterThan(0);
    expect(tierAmounts.good.length).toBeGreaterThan(0);
  });

  test('boss currency amounts respect minimum 0.1 threshold', () => {
    for (let i = 0; i < 5000; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
      });
      if (reward.amount > 0) {
        expect(reward.amount).toBeGreaterThanOrEqual(0.1);
      }
    }
  });

  test('boss currency tier distribution ratios (within drop portion) are consistent across difficulty tiers', () => {
    const tiers = ['normal_1', 'nightmare_2', 'hell_3'];
    const tierDistributions: Record<string, Record<string, number>> = {};

    for (const tierId of tiers) {
      const counts: Record<string, number> = { none: 0, small: 0, ok: 0, good: 0 };
      for (let i = 0; i < 10000; i += 1) {
        const reward = rollBossCurrency({
          difficultyTierId: tierId,
          currency: 'USDC',
          randomSeed: i + tierId.length * 1000,
        });
        counts[reward.tier] = (counts[reward.tier] ?? 0) + 1;
      }
      const none = counts.none / 10000;
      const dropPortion = Math.max(1e-9, 1 - none);
      // Normalize inside drop portion
      tierDistributions[tierId] = {
        none,
        small: (counts.small / 10000) / dropPortion,
        ok: (counts.ok / 10000) / dropPortion,
        good: (counts.good / 10000) / dropPortion,
      };
    }

    // Normalized tier ratios inside the drop portion should be consistent across difficulty levels
    const normal = tierDistributions['normal_1'];
    const nightmare = tierDistributions['nightmare_2'];
    const hell = tierDistributions['hell_3'];

    // Expected normalized ratios: small 0.75, ok 0.225, good 0.025
    // Allow 3% absolute tolerance across tiers and vs. expected due to sampling
    const expected = { small: 0.75, ok: 0.225, good: 0.025 };
    [normal, nightmare, hell].forEach((dist) => {
      expect(Math.abs(dist.small - expected.small)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(dist.ok - expected.ok)).toBeLessThanOrEqual(0.03);
      expect(Math.abs(dist.good - expected.good)).toBeLessThanOrEqual(0.03);
    });
  });

  test('boss currency works for both USDC and GHST', () => {
    const usdcTiers: Record<string, number> = { none: 0, small: 0, ok: 0, good: 0 };
    const ghstTiers: Record<string, number> = { none: 0, small: 0, ok: 0, good: 0 };

    for (let i = 0; i < 10000; i += 1) {
      const usdcReward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
      });
      const ghstReward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'GHST',
        randomSeed: i,
      });

      usdcTiers[usdcReward.tier] = (usdcTiers[usdcReward.tier] ?? 0) + 1;
      ghstTiers[ghstReward.tier] = (ghstTiers[ghstReward.tier] ?? 0) + 1;
    }

    // Both currencies should have similar tier distributions
    const usdcDist = {
      none: usdcTiers.none / 10000,
      small: usdcTiers.small / 10000,
      ok: usdcTiers.ok / 10000,
      good: usdcTiers.good / 10000,
    };
    const ghstDist = {
      none: ghstTiers.none / 10000,
      small: ghstTiers.small / 10000,
      ok: ghstTiers.ok / 10000,
      good: ghstTiers.good / 10000,
    };

    // Allow 2% tolerance
    expect(Math.abs(usdcDist.none - ghstDist.none)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(usdcDist.small - ghstDist.small)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(usdcDist.ok - ghstDist.ok)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(usdcDist.good - ghstDist.good)).toBeLessThanOrEqual(0.02);
  });

  test('boss currency expected value is correctly scaled by tier multiplier (floor 2+)', () => {
    const baseReward = rollChestCurrency({
      difficultyTierId: 'normal_1',
      currency: 'USDC',
      randomSeed: 1234,
    });

    let totalExpectedValue = 0;
    let totalCount = 0;

    for (let i = 0; i < 10000; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
      floorIndex: 1 });
      totalExpectedValue += reward.expectedValue;
      totalCount += 1;
    }

    const avgExpectedValue = totalExpectedValue / totalCount;

    // Expected value should be base * weighted average of multipliers
    // 0.6 * 0 + 0.3 * 0.3 + 0.09 * 1.0 + 0.01 * 3.0 = 0.09 + 0.09 + 0.03 = 0.21
    const expectedMultiplier = 0.3 * 0.3 + 0.09 * 1.0 + 0.01 * 3.0; // 0.21
    const expectedAvg = baseReward.expectedValue * expectedMultiplier;

    // Allow 15% relative error due to stochastic sampling
    const relErr = Math.abs(avgExpectedValue - expectedAvg) / Math.max(expectedAvg, 1e-6);
    expect(relErr).toBeLessThanOrEqual(0.15);
  });

  test('boss currency expected value scales with leverage (L=10, floor 2+)', () => {
    const baseReward = rollChestCurrency({
      difficultyTierId: 'normal_1',
      currency: 'USDC',
      randomSeed: 9876,
    });

    const L = 10;
    const dropTarget = 0.4 + 0.2 * ((L - 1) / 9); // 0.6
    // Sum_{tiers} P_tier(L) * multiplier_tier
    const expectedMultiplierAtL =
      (0.75 * dropTarget) * 0.3 + // small
      (0.225 * dropTarget) * 1.0 + // ok
      (0.025 * dropTarget) * 3.0; // good

    let totalExpectedValue = 0;
    let totalCount = 0;
    for (let i = 0; i < 12000; i += 1) {
      const reward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i + 24680,
        leverageTotal: L,
      floorIndex: 1 });
      totalExpectedValue += reward.expectedValue;
      totalCount += 1;
    }
    const avgExpectedValue = totalExpectedValue / totalCount;
    const expectedAvg = baseReward.expectedValue * expectedMultiplierAtL; // 0.315 * baseEV at L=10

    const relErr = Math.abs(avgExpectedValue - expectedAvg) / Math.max(expectedAvg, 1e-6);
    expect(relErr).toBeLessThanOrEqual(0.18);
  });

  test('boss currency amounts maintain base amount scaling relationship', () => {
    // Test that baseAmount is always the original chest currency amount
    for (let i = 0; i < 1000; i += 1) {
      const bossReward = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
      });
      const chestReward = rollChestCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i,
      });

      expect(bossReward.baseAmount).toBeCloseTo(chestReward.amount, 5);
    }
  });

  test('boss currency drop probability increases with depth', () => {
    const trials = 30000;
    let shallowDrops = 0;
    let deepDrops = 0;
    for (let i = 0; i < trials; i += 1) {
      const shallow = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i + 400000,
        floorIndex: 1,
      });
      const deep = rollBossCurrency({
        difficultyTierId: 'normal_1',
        currency: 'USDC',
        randomSeed: i + 500000,
        floorIndex: 10,
      });
      if (shallow.tier !== 'none') shallowDrops += 1;
      if (deep.tier !== 'none') deepDrops += 1;
    }
    const shallowRate = shallowDrops / trials;
    const deepRate = deepDrops / trials;
    expect(deepRate).toBeGreaterThan(shallowRate + 0.05);
  });
});

describe('boss chest depth scaling', () => {
  test('wearable quality skews higher on deeper floors', () => {
    const sample = (floorIndex: number) => {
      const iterations = 1500;
      let excellentPlus = 0;
      let totalWearables = 0;
      for (let i = 0; i < iterations; i += 1) {
        const drops = rollChestItems({
          count: 3,
          difficultyTierId: 'normal_1',
          sourceId: LOOT_SOURCE_IDS.treasureChest,
          floorIndex,
        });
        for (const drop of drops) {
          if (drop.type !== 'wearable') continue;
          totalWearables += 1;
          if (drop.quality === 'excellent' || drop.quality === 'flawless') {
            excellentPlus += 1;
          }
        }
      }
      return totalWearables > 0 ? excellentPlus / totalWearables : 0;
    };

    const shallowRate = sample(1);
    const deepRate = sample(10);
    // With current depth quality bias config, expect a modest but measurable increase
    expect(deepRate).toBeGreaterThan(shallowRate + 0.005);
  });

  test('wearable frequency increases with floor depth', () => {
    const measure = (floorIndex: number) => {
      const iterations = 3000;
      let wearableCount = 0;
      let totalItems = 0;
      for (let i = 0; i < iterations; i += 1) {
        const drops = rollChestItems({
          count: 2,
          difficultyTierId: 'normal_1',
          sourceId: LOOT_SOURCE_IDS.treasureChest,
          floorIndex,
        });
        totalItems += drops.length;
        for (const drop of drops) {
          if (drop.type === 'wearable') {
            wearableCount += 1;
          }
        }
      }
      return totalItems > 0 ? wearableCount / totalItems : 0;
    };

    const earlyShare = measure(1);
    const deepShare = measure(12);
    expect(deepShare).toBeGreaterThan(earlyShare + 0.02);
  });
});
