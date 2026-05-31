'use client';

import { useState } from 'react';
import { Lock, Zap, Skull, Flame, Eye } from 'lucide-react';
import {
  DIFFICULTY_TIERS,
  getDifficultyTier,
  getNextLockedTier,
  getUnlockCost,
  isTierEligible,
  getPreviousTierId,
} from '../data/difficulty-tiers';
import { cn } from '../lib/utils';

interface DifficultySelectorProps {
  selectedTier: string;
  unlockedTiers: string[];
  lickTongueCount: number;
  onTierSelect: (tierId: string) => void;
  onUnlock: (tierId: string) => Promise<void>;
  onClose?: () => void;
  className?: string;
}

// Tier icons based on difficulty category
const getTierIcon = (tierId: string) => {
  if (tierId.startsWith('normal')) return <Zap className="w-4 h-4" />;
  if (tierId.startsWith('nightmare')) return <Eye className="w-4 h-4" />;
  if (tierId.startsWith('hell')) return <Flame className="w-4 h-4" />;
  if (tierId === 'beyond_hell') return <Skull className="w-4 h-4" />;
  return <Zap className="w-4 h-4" />;
};

// Tier colors based on difficulty category
const getTierColor = (tierId: string) => {
  if (tierId.startsWith('normal'))
    return 'text-green-400 border-green-400/30 bg-green-400/10';
  if (tierId.startsWith('nightmare'))
    return 'text-purple-400 border-purple-400/30 bg-purple-400/10';
  if (tierId.startsWith('hell'))
    return 'text-red-400 border-red-400/30 bg-red-400/10';
  if (tierId === 'beyond_hell')
    return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
  return 'text-gray-400 border-gray-400/30 bg-gray-400/10';
};

export function DifficultySelector({
  selectedTier,
  onTierSelect,
  unlockedTiers,
  lickTongueCount,
  onUnlock,
  onClose,
  className,
}: DifficultySelectorProps) {
  const [pendingTierId, setPendingTierId] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const nextEligibleTier = getNextLockedTier(lickTongueCount);

  const handleTierSelect = (tierId: string) => {
    if (unlockedTiers.includes(tierId)) {
      onTierSelect(tierId);
    }
  };

  const handleUnlock = async (tierId: string) => {
    setUnlockError(null);
    setPendingTierId(tierId);
    try {
      await onUnlock(tierId);
      onTierSelect(tierId);
    } catch (error) {
      const status = (error as any)?.status;
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to unlock difficulty tier';
      if (status === 409) {
        setUnlockError(message || 'Tier already unlocked.');
        onTierSelect(tierId);
      } else {
        setUnlockError(message);
      }
    } finally {
      setPendingTierId(null);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
        {unlockError && (
          <div className="text-sm text-red-400">{unlockError}</div>
        )}

        {/* Difficulty Tiers Grid */}
        <div className="grid grid-cols-1 gap-3">
          {Object.keys(DIFFICULTY_TIERS).map((tierId) => {
            const tier = getDifficultyTier(tierId);
            if (!tier) return null;

            const isUnlocked = unlockedTiers.includes(tierId);
            const isSelected = selectedTier === tierId;
            const cost = getUnlockCost(tierId) ?? 0;
            const isAffordable = isTierEligible(tierId, lickTongueCount);
            const prerequisiteId = getPreviousTierId(tierId);
            const hasPrerequisite = !prerequisiteId || unlockedTiers.includes(prerequisiteId);
            const meetsSequential = hasPrerequisite;
            const isUnlocking = pendingTierId === tierId;
            const tierColors = getTierColor(tierId);

            return (
              <div key={tierId} className="relative">
                <button
                  type="button"
                  onClick={() => handleTierSelect(tierId)}
                  disabled={!isUnlocked}
                  className={cn(
                  'w-full relative p-3 border text-left transition-all',
                  'focus:outline-none focus:ring-2 focus:ring-blue-500',
                  isSelected
                    ? `${tierColors} ring-2 ring-current`
                    : isUnlocked
                      ? `${tierColors} hover:brightness-110`
                      : 'text-gray-500 border-gray-600 bg-gray-800/50 cursor-not-allowed'
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getTierIcon(tierId)}
                    <span className="font-semibold text-sm truncate">
                      {tier.name}
                    </span>
                    {isUnlocked ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-400/10 text-green-400 border border-green-400/30">
                        Unlocked
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 border border-red-400/30">
                        👅 {cost}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-blue-400 font-semibold shrink-0">
                    ${tier.maxEarnings} max
                  </div>
                  {isSelected && (
                    <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
                  )}
                </div>
              </button>

              {!isUnlocked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/70 p-3">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isAffordable || !meetsSequential || isUnlocking) return;
                      void handleUnlock(tierId);
                    }}
                    disabled={!isAffordable || !meetsSequential || isUnlocking}
                    className={cn(
                      'px-3 py-1 rounded-md text-sm font-semibold transition-colors border flex flex-row items-center gap-2 text-gray-300'
                    )}
                  >
                    <Lock className="w-6 h-6 text-gray-400" />{' '}
                    {isUnlocking
                      ? 'Unlocking…'
                      : meetsSequential
                        ? `Unlock 👅 ${cost} `
                        : prerequisiteId
                          ? `Requires ${getDifficultyTier(prerequisiteId)?.name}`
                          : `Unlock 👅 ${cost}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Tier Info */}
      {selectedTier && getDifficultyTier(selectedTier) && (
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-600">
          <div className="flex items-center justify-between mb-1">
            <h4 className="font-semibold text-white">
              {getDifficultyTier(selectedTier)!.name}
            </h4>
          </div>
          <p className="text-xs text-gray-300">
            {getDifficultyTier(selectedTier)!.description}
          </p>

          <p className="text-blue-400 font-bold text-sm mt-2">
            Cost per run: ${getDifficultyTier(selectedTier)!.levelCost} / Max
            Reward: ${getDifficultyTier(selectedTier)!.maxEarnings}
          </p>
        </div>
      )}
    </div>
  );
}
