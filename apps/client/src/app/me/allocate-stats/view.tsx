'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ProfilePanel } from '../../../components/ProfilePanel';
import { usePlayer } from '../../../components/providers/PlayerProvider';

export default function AllocateStatsClient() {
  const {
    progressionProfile,
    progressionLevelProgress,
    isProgressionHydrated,
    saveProgressionProfile,
    resetProgressionProfile,
    deallocateAllStats,
  } = usePlayer();

  const isEditingDisabled = useMemo(() => false, []);

  return (
    <main className="min-h-screen-safe bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white pb-20">
      <div className="mx-auto w-full max-w-3xl px-4 py-12">
        <header className="mb-6">
          <Link href="/me" className="text-sm text-white/70 hover:text-white">
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Allocate Stats
          </h1>
        </header>

        <ProfilePanel
          profile={progressionProfile}
          levelProgress={progressionLevelProgress}
          isHydrated={isProgressionHydrated}
          isEditingDisabled={isEditingDisabled}
          onSubmit={(next) => {
            void (async () => {
              await saveProgressionProfile(next);
            })();
          }}
          onResetToLevelOne={() => {
            void (async () => {
              await resetProgressionProfile();
            })();
          }}
          onDeallocateAll={() => {
            void (async () => {
              await deallocateAllStats();
            })();
          }}
        />
      </div>

      {/* bottom tabs now rendered globally in RootLayout */}
    </main>
  );
}
