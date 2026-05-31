import type { PoolClient } from 'pg';
import { GAME_CONFIG } from './constants';
import { getDifficultyTier } from '../data/difficulty-tiers';
import { dailyBossHighScoresRepo } from './db';

export type DifficultyBand = 'normal' | 'nightmare' | 'hell' | 'beyond_hell';

export interface DailyRunsConfig {
  enabled: boolean;
  scoreThresholdFraction: number;
  attunementsPerDay: number;
  resetTimeUtcHour: number;
  baselineReferenceScore: Record<DifficultyBand, number>;
  maxPayoutPerDifficulty: Record<
    DifficultyBand,
    {
      USDC: number;
      GHST: number;
    }
  >;
}

const DEFAULT_CONFIG: DailyRunsConfig = {
  enabled: false,
  scoreThresholdFraction: 0.5,
  attunementsPerDay: 1,
  resetTimeUtcHour: 0,
  baselineReferenceScore: {
    normal: 5000,
    nightmare: 10000,
    hell: 15000,
    beyond_hell: 20000,
  },
  maxPayoutPerDifficulty: {
    normal: { USDC: 0.5, GHST: 2 },
    nightmare: { USDC: 1, GHST: 4 },
    hell: { USDC: 1.5, GHST: 6 },
    beyond_hell: { USDC: 2, GHST: 8 },
  },
};

function clampResetHour(hour: unknown): number {
  const parsed = Number(hour);
  if (!Number.isFinite(parsed)) return 0;
  const normalized = Math.floor(parsed);
  return Math.min(23, Math.max(0, normalized));
}

export function getDailyRunsConfig(): DailyRunsConfig {
  const raw = (GAME_CONFIG as any)?.dailyRuns ?? {};
  const baseline = {
    ...DEFAULT_CONFIG.baselineReferenceScore,
    ...(raw.baselineReferenceScore ?? {}),
  };
  const payoutCaps = {
    ...DEFAULT_CONFIG.maxPayoutPerDifficulty,
    ...(raw.maxPayoutPerDifficulty ?? {}),
  };

  return {
    enabled: raw.enabled !== false,
    scoreThresholdFraction:
      typeof raw.scoreThresholdFraction === 'number' &&
      Number.isFinite(raw.scoreThresholdFraction)
        ? Math.max(0, raw.scoreThresholdFraction)
        : DEFAULT_CONFIG.scoreThresholdFraction,
    attunementsPerDay:
      typeof raw.attunementsPerDay === 'number' &&
      Number.isFinite(raw.attunementsPerDay)
        ? Math.max(0, Math.floor(raw.attunementsPerDay))
        : DEFAULT_CONFIG.attunementsPerDay,
    resetTimeUtcHour: clampResetHour(raw.resetTimeUtcHour),
    baselineReferenceScore: baseline,
    maxPayoutPerDifficulty: payoutCaps,
  };
}

export function getDifficultyBand(difficultyId: string): DifficultyBand {
  const normalized = (difficultyId || '').toLowerCase();
  if (normalized === 'beyond_hell') {
    return 'beyond_hell';
  }
  if (normalized.startsWith('hell')) {
    return 'hell';
  }
  if (normalized.startsWith('nightmare')) {
    return 'nightmare';
  }
  return 'normal';
}

export function getDailyDate(options?: {
  nowMs?: number;
  offsetDays?: number;
  resetHour?: number;
}): string {
  const now = new Date(options?.nowMs ?? Date.now());
  const resetHour = clampResetHour(options?.resetHour ?? undefined);

  const anchor = new Date(now);
  const utcHour = anchor.getUTCHours();
  if (utcHour < resetHour) {
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }
  anchor.setUTCHours(resetHour, 0, 0, 0);

  if (options?.offsetDays) {
    anchor.setUTCDate(anchor.getUTCDate() + Math.trunc(options.offsetDays));
  }

  return anchor.toISOString().slice(0, 10);
}

export function computeHighStakesBossPayout(options: {
  difficultyId: string;
  runScore: number;
  referenceScore: number;
  thresholdFraction?: number;
}): { usdc: number; ghst: number; ratio: number } {
  const config = getDailyRunsConfig();
  const band = getDifficultyBand(options.difficultyId);
  const caps = config.maxPayoutPerDifficulty[band] ?? {
    USDC: 0,
    GHST: 0,
  };
  const thresholdFraction =
    typeof options.thresholdFraction === 'number'
      ? options.thresholdFraction
      : config.scoreThresholdFraction;

  const S = Math.max(0, Number(options.runScore) || 0);
  const Y = Math.max(0, Number(options.referenceScore) || 0);
  const T = Math.max(0, thresholdFraction);

  if (!(S > 0) || !(Y > 0)) {
    return { usdc: 0, ghst: 0, ratio: 0 };
  }

  if (S < T * Y) {
    return { usdc: 0, ghst: 0, ratio: 0 };
  }

  const raw = Y > 0 ? S / Y : 1;
  const r = Math.max(T, Math.min(1, raw));

  return {
    usdc: r * (caps?.USDC ?? 0),
    ghst: r * (caps?.GHST ?? 0),
    ratio: r,
  };
}

export async function getReferenceScore(options: {
  difficultyId: string;
  nowMs?: number;
  client?: PoolClient;
}): Promise<{
  referenceScore: number;
  thresholdScore: number;
  thresholdFraction: number;
  referenceDate: string;
  source: 'yesterday' | 'baseline';
}> {
  const config = getDailyRunsConfig();
  const resetHour = config.resetTimeUtcHour;
  const yesterdayDate = getDailyDate({
    nowMs: options.nowMs,
    offsetDays: -1,
    resetHour,
  });

  const band = getDifficultyBand(options.difficultyId);
  const baseline = config.baselineReferenceScore[band] ?? 0;

  const highScore =
    await dailyBossHighScoresRepo.getHighScoreForDate({
      date: yesterdayDate,
      difficultyId: options.difficultyId,
      client: options.client,
    });

  const referenceScore = Math.max(
    0,
    Number(highScore?.score ?? baseline) || 0
  );
  const thresholdFraction = config.scoreThresholdFraction;
  const thresholdScore = Math.floor(thresholdFraction * referenceScore);

  return {
    referenceScore,
    thresholdScore,
    thresholdFraction,
    referenceDate: yesterdayDate,
    source: highScore ? ('yesterday' as const) : ('baseline' as const),
  };
}

export function normalizeDifficultyId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/-/g, '_');
}

export function isDifficultyValid(difficultyId: string | null): boolean {
  if (!difficultyId) return false;
  return Boolean(getDifficultyTier(difficultyId));
}
