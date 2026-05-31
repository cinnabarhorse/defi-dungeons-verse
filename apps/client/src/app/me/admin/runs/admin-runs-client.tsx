'use client';

import { useMemo, useCallback, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getCharacterById } from '../../../../data/characters';
import { getAppServerBaseUrl } from '../../../../lib/server-url';
import { useEnsNames } from '../../../../hooks/useEnsNames';
import { Dialog } from '../../../../components/ui/Dialog';
import {
  HeroDetailsView,
  formatAttacksPerSecond,
  type HeroDetails,
  type HeroWeaponSummary,
  type AbilityEntry,
} from '../../../../components/HeroDetailsView';
import { getCharacterStats } from '../../../../lib/character-registry';
import { getWearableBySlug } from '../../../../data/wearables';
import { buildHeroDetailsForGotchi } from '../../../../lib/hero-details/gotchi-hero-details';

interface Run {
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
  floorReached: number | null;
  xpEarned: number | null;
  validForHighScore: boolean;
  characterId: string | null;
  lickTonguesCollected: number;
  deaths: number | null;
  damageDealt: number | null;
  damageTaken: number | null;
  coinsCollected: number | null;
  usdcEarned: number | null;
  ghstEarned: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
  region: string | null;
  dailyRuns?: {
    isHighStakes?: boolean;
    runScore?: number | null;
    thresholdScore?: number | null;
  } | null;
}

interface AdminRunsClientProps {
  initialRuns?: Run[];
  initialTotal?: number;
  initialOffset?: number;
}

const PAGE_SIZE = 50;

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatNumber(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString();
}

function formatUSDC(value: number | null): string {
  if (value == null || value === 0) return '—';
  // USDC is stored in base units (6 decimals)
  const usdc = value / 1_000_000;
  return `$${usdc.toFixed(2)}`;
}

function formatGHST(value: number | null): string {
  if (value == null || value === 0) return '—';
  return `${value.toFixed(2)} GHST`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // For older dates, show actual date
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return '—';
  }
}

function formatStatus(
  status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress'
): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'abandoned':
      return 'Abandoned';
    case 'game_ended':
      return 'Game Ended';
    case 'in_progress':
      return 'In Progress';
    default:
      return '—';
  }
}

function formatCharacter(characterId: string | null): string {
  if (!characterId) return '—';
  if (characterId.startsWith('gotchi:')) {
    const gotchiId = characterId.split(':')[1] ?? '';
    return gotchiId ? `Gotchi #${gotchiId}` : 'Owned Gotchi';
  }
  const character = getCharacterById(characterId);
  if (character) {
    return character.name;
  }
  return characterId;
}

function formatRegion(regionId: string | null): string {
  if (!regionId) return '—';
  // Map server region IDs to display names
  const regionMap: Record<string, string> = {
    'us-east': 'US East',
    'us-west': 'US West',
    'eu-west': 'Europe West',
    'ap-southeast': 'Asia Pacific',
  };
  return regionMap[regionId] || regionId;
}

function shortenAddress(address: string | null | undefined): string {
  if (!address) return '—';
  const start = address.slice(0, 6);
  const end = address.slice(-4);
  return `${start}…${end}`;
}

// ENS normalization handled by useEnsNames hook

function buildHeroDetailsForRun(run: Run | null): HeroDetails | null {
  if (!run?.characterId) return null;
  try {
    const characterId = run.characterId;
    const isDynamic = characterId.startsWith('gotchi:');
    const derived = getCharacterStats(characterId);
    const characterInfo = !isDynamic ? getCharacterById(characterId) : null;
    const name = formatCharacter(characterId);
    const previewId = characterId;
    const attackRange =
      (derived.weaponType === 'ranged'
        ? derived.rangedAttackRange
        : derived.meleeAttackRange) ?? null;

    const wearables = derived.equipment.slugs
      .map((slug) => getWearableBySlug(slug))
      .filter((w): w is NonNullable<ReturnType<typeof getWearableBySlug>> =>
        Boolean(w)
      )
      .filter((w) => !(w as any).weapon);

    const abilities: AbilityEntry[] = derived.abilities.map((a) => ({
      id: a.id,
      params: (a as any).params ?? null,
    }));

    const weapons: HeroWeaponSummary[] = derived.weapons.map((w) => ({
      id: w.id,
      svgId: w.id,
      name: w.name,
      weaponType: w.weaponType,
      attackSpeed: w.attackSpeed ?? null,
      damageRange: w.damageRange
        ? { min: w.damageRange.min, max: w.damageRange.max }
        : typeof w.damage === 'number'
          ? { min: w.damage, max: w.damage }
          : null,
    }));

    const attackSpeedMs = derived.attackSpeed ?? 1000;
    const maxHealth = derived.maxHealth ?? 100;

    return {
      name,
      description: characterInfo?.description,
      tier: characterInfo?.tier,
      archetypeName: null,
      runTraitSummary: null,
      characterClass: characterInfo?.characterClass,
      previewId,
      isDynamic,
      stats: {
        maxHealth,
        damageRange: {
          min: derived.damageRange.min,
          max: derived.damageRange.max,
        },
        attackSpeedMs,
        attackRange,
        weaponType: derived.weaponType,
        projectileSpeed: derived.projectileSpeed ?? null,
        movementSpeed: derived.movementSpeed ?? null,
        hpRegenRate: null,
      },
      formatted: {
        hp: `${maxHealth}`,
        damage:
          derived.damageRange.min === derived.damageRange.max
            ? `${derived.damageRange.min}`
            : `${derived.damageRange.min}-${derived.damageRange.max}`,
        attackSpeed: formatAttacksPerSecond(attackSpeedMs),
      },
      wearables,
      abilities,
      weapons,
    };
  } catch {
    return null;
  }
}

// gotchi details resolved via helper

export default function AdminRunsClient({
  initialRuns = [],
  initialTotal = 0,
  initialOffset = 0,
}: AdminRunsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [total, setTotal] = useState(initialTotal);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<HeroDetails | null>(
    null
  );
  const [resettingDailyRun, setResettingDailyRun] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const currentOffset = useMemo(() => {
    const offset = searchParams.get('offset');
    return offset ? Math.max(0, Number(offset)) : 0;
  }, [searchParams]);

  const totalPages = useMemo(() => Math.ceil(total / PAGE_SIZE), [total]);
  const currentPage = useMemo(
    () => Math.floor(currentOffset / PAGE_SIZE) + 1,
    [currentOffset]
  );
  const hasNextPage = currentOffset + PAGE_SIZE < total;
  const hasPrevPage = currentOffset > 0;

  const fetchRuns = useCallback(async (offset: number) => {
    setIsLoading(true);
    try {
      const baseUrl = getAppServerBaseUrl();
      const res = await fetch(
        `${baseUrl}/api/admin/runs?limit=${PAGE_SIZE}&offset=${offset}`,
        {
          method: 'GET',
          credentials: 'include',
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { runs?: Run[]; total?: number };
        setRuns(data.runs ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      // ignore errors
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // On initial mount, use server data if available
    if (!hasInitialized) {
      setHasInitialized(true);
      if (currentOffset === initialOffset && initialRuns.length > 0) {
        // We already have the correct data, don't fetch
        return;
      }
    }

    // Fetch when offset changes (handles client-side navigation)
    fetchRuns(currentOffset);
  }, [
    currentOffset,
    fetchRuns,
    hasInitialized,
    initialOffset,
    initialRuns.length,
  ]);

  // Resolve ENS names for all players using hook
  const ensAddresses = useMemo(
    () => runs.map((r) => r.playerWalletAddress).filter(Boolean) as string[],
    [runs]
  );
  const { ensByAddress } = useEnsNames(ensAddresses);

  const handleNextPage = useCallback(() => {
    if (!hasNextPage) return;
    const nextOffset = currentOffset + PAGE_SIZE;
    router.push(`/me/admin/runs?offset=${nextOffset}`);
  }, [router, currentOffset, hasNextPage]);

  const handlePrevPage = useCallback(() => {
    if (!hasPrevPage) return;
    const prevOffset = Math.max(0, currentOffset - PAGE_SIZE);
    router.push(`/me/admin/runs?offset=${prevOffset}`);
  }, [router, currentOffset, hasPrevPage]);

  const allocatedStats = useMemo(
    () => ({
      energy: 0,
      aggression: 0,
      spookiness: 0,
      brainSize: 0,
    }),
    []
  );

  const handleResetDailyRunForPlayer = useCallback(async () => {
    setResetMessage(null);
    setResettingDailyRun(true);
    try {
      const baseUrl = getAppServerBaseUrl();
      const res = await fetch(`${baseUrl}/api/admin/daily-runs/reset`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        let msg = 'Failed to reset Daily Quest state.';
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) msg = data.error;
        } catch {
          // ignore JSON parse errors
        }
        setResetMessage(msg);
        return;
      }

      const data = (await res.json()) as {
        date?: string;
        state?: { remainingAttunements?: number | null } | null;
      };

      const remaining =
        typeof data?.state?.remainingAttunements === 'number'
          ? data.state.remainingAttunements
          : null;

      if (remaining != null) {
        setResetMessage(
          `Daily Quest state reset for today (${data.date ?? 'today'}): remaining attunements = ${remaining}.`
        );
      } else {
        setResetMessage('Daily Quest state reset for today.');
      }
    } catch {
      setResetMessage('Network error while resetting Daily Quest state.');
    } finally {
      setResettingDailyRun(false);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!selectedRun) {
        setSelectedDetails(null);
        return;
      }
      // Build synchronously for static characters; fetch-equipped for gotchis
      if (selectedRun.characterId?.startsWith('gotchi:')) {
        const details = await buildHeroDetailsForGotchi(
          selectedRun.characterId
        );
        if (!cancelled) setSelectedDetails(details);
      } else {
        const details = buildHeroDetailsForRun(selectedRun);
        setSelectedDetails(details);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedRun]);

  if (runs.length === 0 && !isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-white/60">No runs found</p>
        <p className="mt-2 text-sm text-white/40">
          No dungeon runs have been completed yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pagination Controls */}
      {total > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-white/60">
            Showing {currentOffset + 1}–
            {Math.min(currentOffset + PAGE_SIZE, total)} of{' '}
            {total.toLocaleString()} runs
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevPage}
                disabled={!hasPrevPage || isLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <div className="text-sm text-white/60">
                Page {currentPage} of {totalPages}
              </div>
              <button
                onClick={handleNextPage}
                disabled={!hasNextPage || isLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col items-start gap-1 md:items-end">
              <button
                type="button"
                onClick={handleResetDailyRunForPlayer}
                disabled={resettingDailyRun}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {resettingDailyRun
                  ? 'Resetting Daily Quest…'
                  : 'Reset my Daily Quest'}
              </button>
              {resetMessage && (
                <div className="max-w-md text-xs text-amber-100/80">
                  {resetMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Runs Table */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
        {isLoading ? (
          <div className="p-8 text-center text-white/60">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-white/10 bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/60">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/60">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/60">
                    Player
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/60">
                    Character
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-white/60">
                    Difficulty / Region
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-white/60">
                    Daily Quest
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Score
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Floor
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Kills
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    👅 Tongues
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    XP
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Coins
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    USDC
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    GHST
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-white/60">
                    Deaths
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-white/5 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-white/90">
                      {formatDate(run.completedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-white/90">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                          run.status === 'completed'
                            ? 'bg-green-500/20 text-green-400'
                            : run.status === 'abandoned'
                              ? 'bg-red-500/20 text-red-400'
                              : run.status === 'game_ended'
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : 'bg-blue-500/20 text-blue-400'
                        }`}
                      >
                        {formatStatus(run.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-white/90">
                      {run.playerUsername ||
                        (run.playerWalletAddress &&
                          ensByAddress[run.playerWalletAddress]) ||
                        shortenAddress(run.playerWalletAddress)}
                    </td>
                    <td className="px-4 py-3 text-sm text-white/90">
                      <button
                        type="button"
                        className="underline decoration-white/30 hover:decoration-white text-left"
                        onClick={() => setSelectedRun(run)}
                        title="View hero details"
                      >
                        {formatCharacter(run.characterId)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-white/90">
                      <div className="flex flex-col gap-0.5">
                        <span>{run.difficultyTier || '—'}</span>
                        <span className="text-xs text-white/60">
                          {formatRegion(run.region)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-white/90">
                      {run.dailyRuns?.isHighStakes
                        ? 'Yes'
                        : run.dailyRuns
                          ? 'No'
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatDuration(run.durationMs)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-white">
                      {formatNumber(run.score)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.floorReached)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.kills)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.lickTonguesCollected)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.xpEarned)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.coinsCollected)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatUSDC(run.usdcEarned)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatGHST(run.ghstEarned)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white/90">
                      {formatNumber(run.deaths)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog
        open={!!selectedRun}
        onOpenChange={(open) => {
          if (!open) setSelectedRun(null);
        }}
      >
        {selectedDetails ? (
          <HeroDetailsView
            details={selectedDetails}
            allocatedStats={allocatedStats}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
