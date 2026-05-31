'use client';

import { useState, useEffect } from 'react';
import { getAppServerBaseUrl } from '../../lib/server-url';
import { SplashBackground } from '../../components/SplashBackground';
import { Leaderboard } from '../../components/leaderboard/Leaderboard';
import { TopRuns } from '../../components/leaderboard/TopRuns';
import type { LeaderboardEntry } from '../../types/leaderboard';
import { cn } from '../../lib/utils';

interface LeaderboardResponse {
  players?: LeaderboardEntry[];
}

async function fetchLeaderboard(
  sortBy: 'level' | 'usdc' | 'topups'
): Promise<LeaderboardEntry[]> {
  const baseUrl = getAppServerBaseUrl();
  const url = new URL(`${baseUrl}/api/leaderboard`);
  url.searchParams.set('sortBy', sortBy);

  const response = await fetch(url.toString(), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to load leaderboard');
  }

  const data = (await response.json()) as LeaderboardResponse;
  if (!data || !Array.isArray(data.players)) {
    return [];
  }

  return data.players.map((entry) => ({
    ...entry,
    level: Math.max(1, Number(entry.level) || 1),
  }));
}

interface TopRun {
  id: string;
  gameId: string;
  playerId: string;
  playerWalletAddress?: string | null;
  playerUsername?: string | null;
  score: number | null;
  difficultyTier: string | null;
  completedAt: string | null;
  durationMs: number | null;
  kills: number | null;
  xpEarned: number | null;
  validForHighScore: boolean;
  characterId: string | null;
  lickTonguesCollected: number;
  deaths: number | null;
  damageDealt: number | null;
  damageTaken: number | null;
  coinsCollected: number | null;
  usdcEarned: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
  region: string | null;
}

async function fetchTopRuns(): Promise<TopRun[]> {
  const baseUrl = getAppServerBaseUrl();
  const url = new URL(`${baseUrl}/api/leaderboard/top-runs`);
  url.searchParams.set('limit', '100');
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load top runs');
  }
  const data = (await response.json()) as { runs?: TopRun[] } | null;
  return Array.isArray(data?.runs) ? data!.runs : [];
}

export default function LeaderboardPage() {
  const [sortBy, setSortBy] = useState<'level' | 'usdc' | 'topups' | 'top_runs'>(
    'top_runs'
  );
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [runs, setRuns] = useState<TopRun[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    setFetchError(null);
    if (sortBy === 'top_runs') {
      fetchTopRuns()
        .then((data) => {
          setRuns(data);
          setIsLoading(false);
        })
        .catch((error) => {
          setFetchError(
            error instanceof Error ? error.message : 'Unknown error'
          );
          setIsLoading(false);
        });
    } else {
      fetchLeaderboard(sortBy)
        .then((data) => {
          setPlayers(data);
          setIsLoading(false);
        })
        .catch((error) => {
          setFetchError(
            error instanceof Error ? error.message : 'Unknown error'
          );
          setIsLoading(false);
        });
    }
  }, [sortBy]);

  return (
    <SplashBackground as="main" className="text-white pb-20">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 lg:px-8 backdrop-blur">
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.35em] text-violet-300/70">
            DeFi Dungeon
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Adventurer Leaderboard
          </h1>
          <p className="mt-4 text-sm text-white/70 sm:text-base">
            Live snapshot of top players and runs across the dungeon. View by
            most earned USDC, highest level, most topups, or top run scores.
          </p>
        </header>

        <div className="flex justify-center">
          <div className="inline-flex rounded-full bg-black/40 p-1 border border-white/10 backdrop-blur">
            <button
              aria-pressed={sortBy === 'usdc'}
              className={cn(
                'px-3 py-1.5 text-sm rounded-full transition-colors',
                sortBy === 'usdc'
                  ? 'bg-purple-600/30 text-white border border-purple-500/30'
                  : 'text-gray-300 hover:text-white'
              )}
              onClick={() => setSortBy('usdc')}
            >
              Most Earned
            </button>
            <button
              aria-pressed={sortBy === 'level'}
              className={cn(
                'ml-1 px-3 py-1.5 text-sm rounded-full transition-colors',
                sortBy === 'level'
                  ? 'bg-purple-600/30 text-white border border-purple-500/30'
                  : 'text-gray-300 hover:text-white'
              )}
              onClick={() => setSortBy('level')}
            >
              Highest Level
            </button>
            <button
              aria-pressed={sortBy === 'topups'}
              className={cn(
                'ml-1 px-3 py-1.5 text-sm rounded-full transition-colors',
                sortBy === 'topups'
                  ? 'bg-purple-600/30 text-white border border-purple-500/30'
                  : 'text-gray-300 hover:text-white'
              )}
              onClick={() => setSortBy('topups')}
            >
              Most Topups
            </button>
            <button
              aria-pressed={sortBy === 'top_runs'}
              className={cn(
                'ml-1 px-3 py-1.5 text-sm rounded-full transition-colors',
                sortBy === 'top_runs'
                  ? 'bg-purple-600/30 text-white border border-purple-500/30'
                  : 'text-gray-300 hover:text-white'
              )}
              onClick={() => setSortBy('top_runs')}
            >
              Top Scores
            </button>
          </div>
        </div>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl shadow-violet-900/20 backdrop-blur">
          {isLoading ? (
            <div className="px-8 py-16 text-center text-white/70">
              <p className="text-lg font-medium">Loading leaderboard...</p>
            </div>
          ) : sortBy === 'top_runs' ? (
            <TopRuns runs={runs} error={fetchError} />
          ) : (
            <Leaderboard
              players={players}
              error={fetchError}
              showCharacter={!(sortBy === 'usdc' || sortBy === 'topups')}
            />
          )}
        </section>
      </div>

      {/* bottom tabs now rendered globally in RootLayout */}
    </SplashBackground>
  );
}
