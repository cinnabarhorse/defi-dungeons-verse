'use client';

import Image from 'next/image';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

export type LootCategory = 'token' | 'material' | 'wearable' | 'other';

export interface LootItem {
  id: string;
  name: string;
  quantity?: number | null;
  category: LootCategory;
  iconUrl?: string;
  description?: string | null;
}

const numberFormatter = new Intl.NumberFormat('en-US');

const categoryLabels: Record<LootCategory, string> = {
  token: 'Token',
  material: 'Material',
  wearable: 'Wearable',
  other: 'Other',
};

interface LootListProps {
  items?: LootItem[];
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  onStartRun: () => void;
}

function SkeletonCard() {
  return (
    <div className="group relative flex h-full flex-col justify-between gap-6 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-white/20" />
            <div className="h-3 w-24 rounded bg-white/10" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 text-sm text-white/60">
        <div>
          <div className="text-xs uppercase tracking-wide text-white/40">
            Remaining
          </div>
          <div className="mt-2 h-8 w-24 rounded bg-white/20" />
        </div>
      </div>
    </div>
  );
}

export function LootList({
  items = [],
  isLoading = false,
  error = null,
  onRetry,
  onStartRun,
}: LootListProps) {
  return (
    <section aria-labelledby="loot-title" className="space-y-10">
      <header className="space-y-3 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">
          Real Loot
        </p>
        <h1
          id="loot-title"
          className="text-3xl font-semibold text-white sm:text-4xl"
        >
          Available Boss Loot
        </h1>
        <p className="mx-auto max-w-xl text-sm text-white/70">
          Slay the Boss to earn loot! Drop rate is rolled by difficulty,
          leverage used, and floor reached.
        </p>
      </header>

      {error ? (
        <div className="mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 backdrop-blur">
          <span>Unable to load live loot data. Showing preview.</span>
          {onRetry ? (
            <Button
              variant="ghost"
              className="text-white/80 hover:text-white"
              onClick={onRetry}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div
        role="list"
        aria-busy={isLoading ? 'true' : 'false'}
        className={cn(
          'grid justify-center justify-items-center gap-5 sm:grid-cols-[max-content_max-content]',
          isLoading && items.length === 0 ? 'animate-pulse' : ''
        )}
      >
        {isLoading && items.length === 0
          ? Array.from({ length: 8 }).map((_, idx) => (
              <SkeletonCard key={`skeleton-${idx}`} />
            ))
          : items.map((item) => {
              const formattedQuantity =
                item.quantity == null
                  ? '∞'
                  : numberFormatter.format(item.quantity);
              const labelId = `loot-${item.id}-title`;

              return (
                <article
                  key={item.id}
                  role="listitem"
                  aria-labelledby={labelId}
                  aria-label={`${item.name}: ${formattedQuantity} available`}
                  className={cn(
                    'group relative flex h-full w-fit flex-col justify-between gap-6 rounded-3xl border bg-black/40 p-5 shadow-lg transition-transform focus-within:-translate-y-1 focus-within:shadow-xl hover:-translate-y-1 hover:shadow-xl backdrop-blur'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-4">
                      {item.iconUrl ? (
                        <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                          <Image
                            src={item.iconUrl}
                            alt=""
                            width={56}
                            height={56}
                            className="h-full w-full object-contain"
                          />
                        </span>
                      ) : null}
                      <div>
                        <h3
                          id={labelId}
                          className="text-lg font-semibold text-white"
                        >
                          {item.name.replace('Airdrop', '')}
                        </h3>
                        <p className="text-xs uppercase tracking-[0.3em] text-white/50">
                          {categoryLabels[item.category]}
                        </p>
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-4 text-sm text-white/60">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-white/50">
                        Remaining
                      </dt>
                      <dd
                        className={cn('text-3xl font-semibold')}
                        aria-label={`${formattedQuantity} ${item.name}`}
                      >
                        {formattedQuantity}
                      </dd>
                    </div>
                    {/* <div>
                  {item.description ? (
                    <p className="text-sm text-white/70">{item.description}</p>
                  ) : null}
                </div> */}
                  </dl>
                </article>
              );
            })}
      </div>

      <footer className="flex flex-col items-center gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
          Ready when you are
        </p>
        <Button
          size="lg"
          className="rounded-full bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 px-8 py-6 text-base font-semibold text-white shadow-[0_12px_35px_rgba(99,102,241,0.45)] transition-transform hover:scale-[1.02] focus-visible:scale-[1.02]"
          onClick={onStartRun}
        >
          Start run
        </Button>
      </footer>
    </section>
  );
}
