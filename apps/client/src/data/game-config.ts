/**
 * ⚠️  AUTO-GENERATED FILE - DO NOT EDIT MANUALLY! ⚠️
 *
 * Client Game Config Data - Generated from /data/game-config.ts
 * This file contains core game configuration values used by client and server.
 *
 * To make changes, edit /data/game-config.ts and run: npm run generate:shared
 */

// Single source of truth for game configuration
// This file is consumed by scripts/generate-shared-files.ts to produce
// client/server copies under apps/*/src/data/game-config.ts

export const GAME_CONFIG = {
  TILE_SIZE: 32,
  MAP_WIDTH: 200, // tiles
  MAP_HEIGHT: 200, // tiles
  WORLD_WIDTH: 32 * 200, // px (match MAP_WIDTH)
  WORLD_HEIGHT: 32 * 200, // px (match MAP_HEIGHT)
  SERVER_TICK_HZ: 30,
  SNAPSHOT_HZ: 15,
  MAX_PLAYERS: 3,
  MOVEMENT_SPEED: 4, // tiles per second
  ATTACK_COOLDOWN: 1000, // ms
  BASE_HP: 100,
  // Feature flags
  EDGE_PAN_ENABLED: false,
  // Staging
  // When true, client should always load staging assets and the server should favor staging flow.
  ELITE_AURA_COLORS: ['red', 'green', 'blue', 'yellow'],
  eliteSpawnChanceByRoomTier: {
    default: 0.2,
    medium: 0.2,
    large: 0.22,
    small: 0.18,
  },
  eliteMaxPerFloor: 100,
  minDistanceBetweenElites: 14, // tiles
  // Minimum distance (in tiles) that player initial spawns must be from elite leaders
  playerSpawnMinDistanceFromElites: 12, // tiles
  // Minimum distance (in tiles) between the party's spawn anchor and elite groups.
  // Helps prevent elites from appearing in the same room as the party on new floors.
  eliteMinDistanceFromPlayerAnchorTiles: 24,
  minionRingRadiusTiles: 4,
  maxFormationAttempts: 6,
  maxElitesPerRoomBySize: {
    small: 1,
    medium: 1,
    large: 2,
  },
  hunted: {
    enabled: true,
    floorGracePeriodMs: 90_000, // 15s before first Hunted wave
    rampStartMs: 30_000, // unused for wave-based ramp
    maxIntensityLevel: 100,
    baseSpawnIntervalMs: 30_000, // starting interval
    minSpawnIntervalMs: 2_000, // floor interval
    waveIntervalStepMs: 2_000, // reduce interval by 2s each wave
    perWaveHpMultiplier: 0.05, // +5% HP per wave
    perWaveDamageMultiplier: 0.05, // +5% damage per wave
    perIntensitySpeedMultiplier: 0.2, // +25% speed per intensity level
    minSpeedMultiplierVsPlayer: 1.3, // floor hunted speed to 130% of player base
    soloHunterMode: true, // spawn a single hunter per wave (no packs)
    maxHuntedGroupsPerFloor: 0,
    maxConcurrentHuntedGroups: 25,
    huntedExtraEliteCap: 200,
  },
  enemyDifficultyMeter: {
    enabled: true,
    tickIntervalMs: 60_000,
    damagePerMinute: 0.08,
    hpPerMinute: 0.1,
    maxDamageMultiplier: 4,
    maxHpMultiplier: 6,
    rescaleBatchSize: 35,
    rescaleBatchDelayMs: 75,
    floorDescendDelta: 5,
  },
  bossLoot: {
    depth: {
      enabled: true,
      wearableCategoryBiasPerFloor: 0.02,
      wearableCategoryBiasMax: 0.35,
      // Boss-tier scaling knobs (by tier.dropRateMultiplier)
      // Probability scaling: dropTarget *= 1 + probabilityDropRateWeight * (dropRateMultiplier - 1)
      probabilityDropRateWeight: 0.5,
      // Amount scaling: baseAmount *= 1 + amountDropRateWeight * (dropRateMultiplier - 1)
      amountDropRateWeight: 0.25,
      // Depth-based currency knobs
      // Probability: already controlled by currencyDropBonusPerFloor / currencyDropMaxBonus / currencyDropTargetCap
      // Amount: scale base amount modestly with depth to avoid economy spikes
      currencyAmountBonusPerFloor: 0.01,
      currencyAmountMaxBonus: 0.15,
      wearableRarityBoostPerFloor: {
        legendary: 0.02,
        mythical: 0.01,
        godlike: 0.005,
      },
      wearableRarityBoostMax: {
        legendary: 0.5,
        mythical: 0.5,
        godlike: 0.5,
      },
      wearableStateBiasPerFloor: {
        broken: -0.02,
        budget: -0.012,
        average: 0,
        excellent: 0.01,
        flawless: 0.015,
      },
      wearableStateBiasMax: {
        broken: 0.6,
        budget: 0.5,
        average: 0.25,
        excellent: 0.5,
        flawless: 0.5,
      },
      currencyDropBonusPerFloor: 0.02,
      currencyDropMaxBonus: 0.3,
      currencyDropTargetCap: 0.9,
    },
  },
  dailyRuns: {
    enabled: true,
    scoreThresholdFraction: 0.5,
    attunementsPerDay: 1,
    resetTimeUtcHour: 0,
    baselineReferenceScore: {
      normal: 1000,
      nightmare: 120000,
      hell: 500000,
      beyond_hell: 1000000,
    },
    maxPayoutPerDifficulty: {
      normal: { USDC: 0.5, GHST: 2 },
      nightmare: { USDC: 1, GHST: 4 },
      hell: { USDC: 1.5, GHST: 6 },
      beyond_hell: { USDC: 2, GHST: 8 },
    },
  },
  STAGING_ENABLED: true,
  ENABLE_ENEMY_RESPAWN: true,
};
