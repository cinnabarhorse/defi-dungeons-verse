'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  LootList,
  type LootItem,
  type LootCategory,
} from '../../components/loot/LootList';
import { useLootCatalog } from '../../hooks/useLootCatalog';
import { useTotalPrincipalLocked } from '../../hooks/useTotalPrincipalLocked';
import { Button } from '../../components/ui/Button';

function resolveLootIcon(icon: unknown) {
  if (typeof icon !== 'string') return undefined;
  const trimmed = icon.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('/') || /^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes('/')) {
    const stripped = trimmed.replace(/^\.+/, '').replace(/^\/+/, '');
    if (!stripped) return undefined;
    return `/${stripped}`;
  }
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (!normalized) return undefined;
  if (
    normalized === 'ghst' ||
    normalized === 'ghst.gif' ||
    normalized === 'ghst.svg'
  ) {
    return '/sprites/coins/ghst.gif';
  }
  const hasExtension = /\.[a-z0-9]+$/i.test(normalized);
  const filename = hasExtension ? normalized : `${normalized}.svg`;
  return `/loot-icons/${filename}`;
}

export default function LootView() {
  const router = useRouter();
  const { loot: lootCatalog, isLoading, error, refetch } = useLootCatalog();
  const {
    totalPrincipal,
    isLoading: isLoadingPrincipal,
    error: principalError,
  } = useTotalPrincipalLocked();

  const principalNumber = useMemo(() => {
    if (!totalPrincipal) return 0;
    const num = Number.parseFloat(totalPrincipal);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [totalPrincipal]);
  const goal = 10000;
  const progressPct = useMemo(() => {
    if (goal <= 0) return 0;
    const pct = (principalNumber / goal) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [principalNumber]);
  const progressLabel = useMemo(() => {
    const fmt = (v: number) =>
      new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
    return `${fmt(principalNumber)} / ${fmt(goal)}`;
  }, [principalNumber]);

  const items: LootItem[] = useMemo(() => {
    return lootCatalog.map<LootItem>((entry) => {
      const metadata =
        entry && typeof entry.metadata === 'object' && entry.metadata !== null
          ? (entry.metadata as Record<string, unknown>)
          : {};
      const name =
        (typeof entry.name === 'string' && entry.name) ||
        (typeof metadata.label === 'string' && metadata.label) ||
        `Loot ${entry.id.slice(0, 6)}`;
      const category: LootCategory =
        (metadata.category as LootCategory | undefined) ??
        (entry.lootType === 'erc20'
          ? 'token'
          : entry.lootType === 'virtual'
            ? 'other'
            : entry.lootType === 'erc721'
              ? 'wearable'
              : 'other');
      const description =
        typeof metadata.description === 'string' ? metadata.description : null;
      const iconUrl = resolveLootIcon(metadata.icon);
      return {
        id: entry.id,
        name,
        quantity: entry.remaining,
        category,
        iconUrl,
        description,
      };
    });
  }, [lootCatalog]);

  const formattedPrincipal = useMemo(() => {
    if (!totalPrincipal) return null;
    const num = Number.parseFloat(totalPrincipal);
    if (Number.isNaN(num)) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  }, [totalPrincipal]);

  return (
    <div className="min-h-screen-safe text-white pb-20">
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                Total Principal Locked
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {isLoadingPrincipal ? (
                  <span className="text-white/50">Loading...</span>
                ) : formattedPrincipal ? (
                  formattedPrincipal
                ) : principalError ? (
                  <span className="text-red-400">
                    Error: {principalError.message}
                  </span>
                ) : (
                  <span className="text-white/50">—</span>
                )}
              </p>
              {principalError && !isLoadingPrincipal ? (
                <p className="mt-2 text-xs text-red-300">
                  Unable to fetch staking data. The contract function may not
                  exist or the name may be incorrect.
                </p>
              ) : null}
              {/* Progress to $10,000 within the same group */}
              <div className="mt-6">
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span>First Milestone</span>
                  <span className="tabular-nums">{progressLabel}</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{
                      width: `${isLoadingPrincipal ? 0 : progressPct.toFixed(0)}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={Math.round(progressPct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Principal progress to goal"
                  />
                </div>
                <div className="mt-1 text-right text-[10px] text-white/60">
                  {`${progressPct.toFixed(0)}%`}
                </div>
              </div>
            </div>
          </div>
        </div>
        <LootList
          items={items}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          onStartRun={() => {
            router.push('/play');
          }}
        />
      </div>
    </div>
  );
}
