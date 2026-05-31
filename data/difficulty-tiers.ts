/**
 * Difficulty Tiers - Single Source of Truth
 * This file contains difficulty tier definitions used by both client and server
 */

export interface DifficultyTier {
  id: string;
  name: string;
  lickTonguesRequired: number;
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  enemySpeedMultiplier: number;
  enemyAggroRangeMultiplier: number;
  dropRateMultiplier: number; // For future loot improvements
  maxEarnings: number; // max USDC earned per run
  description: string;
  levelCost: number; //the amount of USDC required to play per run
  xpMultiplier: number; // XP multiplier applied to enemy base XP
}

export const DIFFICULTY_TIERS: Record<string, DifficultyTier> = {
  normal_1: {
    id: 'normal_1',
    name: 'Normal 1',
    lickTonguesRequired: 0,
    enemyHealthMultiplier: 1.0,
    enemyDamageMultiplier: 1.0,
    enemySpeedMultiplier: 1.0,
    enemyAggroRangeMultiplier: 1.0,
    dropRateMultiplier: 1.0,
    maxEarnings: 1,
    levelCost: 1,
    xpMultiplier: 1.0,
    description:
      'The starting difficulty - enemies are at their base strength.',
  },
  normal_2: {
    id: 'normal_2',
    name: 'Normal 2',
    lickTonguesRequired: 10,
    enemyHealthMultiplier: 1.2,
    enemyDamageMultiplier: 1.1,
    enemySpeedMultiplier: 1.0,
    enemyAggroRangeMultiplier: 1.1,
    dropRateMultiplier: 1.1,
    maxEarnings: 2,
    levelCost: 1,
    xpMultiplier: 1.1,
    description:
      'Slightly tougher enemies with 20% more health and 10% more damage.',
  },
  normal_3: {
    id: 'normal_3',
    name: 'Normal 3',
    lickTonguesRequired: 25,
    enemyHealthMultiplier: 1.5,
    enemyDamageMultiplier: 1.25,
    enemySpeedMultiplier: 1.1,
    enemyAggroRangeMultiplier: 1.2,
    dropRateMultiplier: 1.2,
    maxEarnings: 4,
    levelCost: 1,
    xpMultiplier: 1.2,
    description:
      'Noticeably stronger enemies with improved stats across the board.',
  },
  nightmare_1: {
    id: 'nightmare_1',
    name: 'Nightmare 1',
    lickTonguesRequired: 50,
    enemyHealthMultiplier: 2.0,
    enemyDamageMultiplier: 1.5,
    enemySpeedMultiplier: 1.2,
    enemyAggroRangeMultiplier: 1.3,
    dropRateMultiplier: 1.5,
    maxEarnings: 8,
    levelCost: 5,
    xpMultiplier: 1.4,
    description: 'Enter the nightmare realm - enemies are twice as tough!',
  },
  nightmare_2: {
    id: 'nightmare_2',
    name: 'Nightmare 2',
    lickTonguesRequired: 100,
    enemyHealthMultiplier: 2.5,
    enemyDamageMultiplier: 1.75,
    enemySpeedMultiplier: 1.3,
    enemyAggroRangeMultiplier: 1.4,
    dropRateMultiplier: 1.75,
    levelCost: 5,
    maxEarnings: 15,
    xpMultiplier: 1.6,
    description: 'The nightmare intensifies with even deadlier foes.',
  },
  nightmare_3: {
    id: 'nightmare_3',
    name: 'Nightmare 3',
    lickTonguesRequired: 175,
    enemyHealthMultiplier: 3.0,
    enemyDamageMultiplier: 2.0,
    enemySpeedMultiplier: 1.4,
    enemyAggroRangeMultiplier: 1.5,
    dropRateMultiplier: 2.0,
    maxEarnings: 25,
    levelCost: 5,
    xpMultiplier: 1.8,
    description:
      'The peak of nightmare difficulty - only the strongest survive.',
  },
  hell_1: {
    id: 'hell_1',
    name: 'Hell 1',
    lickTonguesRequired: 275,
    enemyHealthMultiplier: 4.0,
    enemyDamageMultiplier: 2.5,
    enemySpeedMultiplier: 1.5,
    enemyAggroRangeMultiplier: 1.6,
    dropRateMultiplier: 2.5,
    maxEarnings: 40,
    levelCost: 10,
    xpMultiplier: 2.0,
    description:
      'Welcome to hell - enemies are four times deadlier than normal.',
  },
  hell_2: {
    id: 'hell_2',
    name: 'Hell 2',
    lickTonguesRequired: 400,
    enemyHealthMultiplier: 5.0,
    enemyDamageMultiplier: 3.0,
    enemySpeedMultiplier: 1.6,
    enemyAggroRangeMultiplier: 1.7,
    dropRateMultiplier: 3.0,
    maxEarnings: 65,
    levelCost: 10,
    xpMultiplier: 2.3,
    description: 'Hell burns hotter - face enemies of unimaginable power.',
  },
  hell_3: {
    id: 'hell_3',
    name: 'Hell 3',
    lickTonguesRequired: 600,
    enemyHealthMultiplier: 6.0,
    enemyDamageMultiplier: 3.5,
    enemySpeedMultiplier: 1.7,
    enemyAggroRangeMultiplier: 1.8,
    dropRateMultiplier: 3.5,
    maxEarnings: 100,
    levelCost: 10,
    xpMultiplier: 2.6,
    description: 'The deepest circle of hell - only legends dare enter.',
  },
  beyond_hell: {
    id: 'beyond_hell',
    name: 'Beyond Hell',
    lickTonguesRequired: 1000,
    enemyHealthMultiplier: 8.0,
    enemyDamageMultiplier: 4.0,
    enemySpeedMultiplier: 2.0,
    enemyAggroRangeMultiplier: 2.0,
    dropRateMultiplier: 5.0,
    maxEarnings: 250,
    levelCost: 25,
    xpMultiplier: 3.0,
    description: 'Beyond comprehension - face the ultimate challenge.',
  },
};

// Utility functions
export function getDifficultyTier(tierId: string): DifficultyTier | null {
  return DIFFICULTY_TIERS[tierId] || null;
}

export function getNextLockedTier(
  lickTongueCount: number
): DifficultyTier | null {
  const nextTierId = Object.keys(DIFFICULTY_TIERS).find(
    (tierId) => DIFFICULTY_TIERS[tierId].lickTonguesRequired > lickTongueCount
  );
  return nextTierId ? DIFFICULTY_TIERS[nextTierId] : null;
}

export function getUnlockCost(tierId: string): number | null {
  const tier = getDifficultyTier(tierId);
  return tier ? tier.lickTonguesRequired : null;
}

export function isTierEligible(
  tierId: string,
  lickTongueCount: number
): boolean {
  const cost = getUnlockCost(tierId);
  return cost !== null && lickTongueCount >= cost;
}

// Sequential unlocking helpers
export const DIFFICULTY_TIER_SEQUENCE: string[] = [
  'normal_1',
  'normal_2',
  'normal_3',
  'nightmare_1',
  'nightmare_2',
  'nightmare_3',
  'hell_1',
  'hell_2',
  'hell_3',
  'beyond_hell',
];

export function getPreviousTierId(tierId: string): string | null {
  const index = DIFFICULTY_TIER_SEQUENCE.indexOf(tierId);
  if (index <= 0) return null;
  return DIFFICULTY_TIER_SEQUENCE[index - 1] || null;
}

export function meetsSequentialPrerequisite(
  tierId: string,
  unlockedTiers: string[]
): boolean {
  const previous = getPreviousTierId(tierId);
  if (!previous) return true;
  return unlockedTiers.includes(previous);
}

export function canUnlockTier(
  tierId: string,
  lickTongueCount: number,
  unlockedTiers: string[]
): boolean {
  if (unlockedTiers.includes(tierId)) return false;
  if (!isTierEligible(tierId, lickTongueCount)) return false;
  return meetsSequentialPrerequisite(tierId, unlockedTiers);
}

// Reward calculation interfaces and types
export interface RewardCalculationResult {
  amount: number;
  probability: number;
  expectedValue: number;
}

export interface RewardDistribution {
  minReward: number;
  maxReward: number;
  expectedReturn: number; // As percentage of cost (e.g., 0.8 = 80% return)
  volatility: number; // Higher = more variance in rewards
}

// Reward distribution configuration for each tier type
const REWARD_DISTRIBUTIONS: Record<string, RewardDistribution> = {
  normal: {
    minReward: 0,
    maxReward: 1,
    expectedReturn: 0.85, // 85% return on investment
    volatility: 0.3, // Low volatility for beginner tiers
  },
  nightmare: {
    minReward: 0,
    maxReward: 1,
    expectedReturn: 0.8, // 80% return on investment
    volatility: 0.5, // Medium volatility
  },
  hell: {
    minReward: 0,
    maxReward: 1,
    expectedReturn: 0.75, // 75% return on investment
    volatility: 0.7, // High volatility - high risk, high reward
  },
  beyond_hell: {
    minReward: 0,
    maxReward: 1,
    expectedReturn: 0.7, // 70% return on investment
    volatility: 0.9, // Very high volatility - extreme risk/reward
  },
};

/**
 * Calculates the probabilistic USDC reward for opening a treasure chest
 * Uses a beta distribution for realistic reward curves with configurable risk/reward profiles
 */
export function calculateTreasureReward(
  tierId: string,
  randomSeed?: number
): RewardCalculationResult {
  const tier = getDifficultyTier(tierId);
  if (!tier) {
    return { amount: 0, probability: 0, expectedValue: 0 };
  }

  // Determine tier type for distribution lookup
  let tierType = 'normal';
  if (tierId.startsWith('nightmare')) tierType = 'nightmare';
  else if (tierId.startsWith('hell') && tierId !== 'beyond_hell')
    tierType = 'hell';
  else if (tierId === 'beyond_hell') tierType = 'beyond_hell';

  const distribution = REWARD_DISTRIBUTIONS[tierType];
  const random =
    randomSeed !== undefined ? seededRandom(randomSeed) : Math.random();

  // Calculate expected value based on cost and return rate
  const expectedValue = tier.levelCost * distribution.expectedReturn;

  // Use beta distribution for realistic reward curves
  // Higher volatility = more extreme outcomes (either very low or very high rewards)
  const alpha = 2 - distribution.volatility; // Lower alpha = more left-skewed (more small rewards)
  const beta = 2 + distribution.volatility; // Higher beta = longer tail (rare big rewards)

  const betaRandom = betaDistribution(random, alpha, beta);

  // Apply non-linear scaling to create more interesting reward distribution
  // This creates a curve where most rewards are small, but big rewards are possible
  const scaledRandom = Math.pow(
    betaRandom,
    1.5 - distribution.volatility * 0.5
  );

  // Calculate final reward amount
  const rewardAmount = Math.floor(scaledRandom * tier.maxEarnings * 100) / 100; // Round to 2 decimal places

  // Calculate probability of getting this exact reward (approximate)
  const probability = calculateRewardProbability(
    rewardAmount,
    tier.maxEarnings,
    distribution
  );

  return {
    amount: rewardAmount,
    probability: probability,
    expectedValue: expectedValue,
  };
}

/**
 * Generates a seeded random number for deterministic testing
 */
function seededRandom(seed: number): number {
  // Add 1 to avoid sin(0) = 0 issues
  const x = Math.sin(seed + 1) * 10000;
  return Math.abs(x - Math.floor(x));
}

/**
 * Approximates beta distribution using uniform random
 * This creates more realistic reward distributions than pure uniform
 */
function betaDistribution(random: number, alpha: number, beta: number): number {
  // Simple approximation of beta distribution
  // For more accuracy, you could use a proper beta distribution implementation
  const u1 = Math.max(0.001, Math.min(0.999, random)); // Clamp to avoid edge cases
  const u2 = Math.max(0.001, Math.min(0.999, seededRandom(random * 1000)));

  const x = Math.pow(u1, 1 / Math.max(0.1, alpha));
  const y = Math.pow(u2, 1 / Math.max(0.1, beta));

  const sum = x + y;
  return sum > 0 ? x / sum : 0.5; // Fallback to 0.5 if sum is 0
}

/**
 * Calculates approximate probability of getting a specific reward amount
 */
function calculateRewardProbability(
  amount: number,
  maxAmount: number,
  distribution: RewardDistribution
): number {
  const normalizedAmount = amount / maxAmount;

  // Probability decreases exponentially for higher rewards
  // Adjusted by volatility - higher volatility = flatter probability curve
  const baseProb = Math.exp(-normalizedAmount * (3 - distribution.volatility));

  // Normalize to ensure probabilities make sense
  return Math.min(baseProb, 1.0);
}

/**
 * Gets the expected value for a given difficulty tier
 */
export function getExpectedReward(tierId: string): number {
  const tier = getDifficultyTier(tierId);
  if (!tier) return 0;

  let tierType = 'normal';
  if (tierId.startsWith('nightmare')) tierType = 'nightmare';
  else if (tierId.startsWith('hell') && tierId !== 'beyond_hell')
    tierType = 'hell';
  else if (tierId === 'beyond_hell') tierType = 'beyond_hell';

  const distribution = REWARD_DISTRIBUTIONS[tierType];
  return tier.levelCost * distribution.expectedReturn;
}

/**
 * Simulates multiple treasure chest openings to analyze reward distribution
 * Useful for balancing and testing
 */
export function simulateRewards(
  tierId: string,
  simulations: number = 1000
): {
  averageReward: number;
  medianReward: number;
  minReward: number;
  maxReward: number;
  totalPayout: number;
  profitMargin: number; // Percentage of cost recovered
} {
  const tier = getDifficultyTier(tierId);
  if (!tier) {
    return {
      averageReward: 0,
      medianReward: 0,
      minReward: 0,
      maxReward: 0,
      totalPayout: 0,
      profitMargin: 0,
    };
  }

  const rewards: number[] = [];
  let totalPayout = 0;

  for (let i = 0; i < simulations; i++) {
    const result = calculateTreasureReward(tierId, i);
    rewards.push(result.amount);
    totalPayout += result.amount;
  }

  rewards.sort((a, b) => a - b);

  const averageReward = totalPayout / simulations;
  const medianReward = rewards[Math.floor(simulations / 2)];
  const minReward = rewards[0];
  const maxReward = rewards[simulations - 1];
  const totalCost = tier.levelCost * simulations;
  const profitMargin = (totalPayout / totalCost) * 100;

  return {
    averageReward,
    medianReward,
    minReward,
    maxReward,
    totalPayout,
    profitMargin,
  };
}
