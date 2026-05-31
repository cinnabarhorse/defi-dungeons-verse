import type { InventoryItem } from '../types/inventory';

/**
 * Count the number of Lick Tongues in the player's inventory
 */
export function countLickTongues(inventory: InventoryItem[]): number {
  return inventory
    .filter((item) => item.name === 'Lick Tongue' && item.type === 'material')
    .reduce((total, item) => total + (item.quantity || 1), 0);
}

/**
 * Get or create player's difficulty progress from the in-memory cache
 */
export interface DifficultyProgress {
  unlockedTiers: string[];
  selectedTier: string;
  lickTongueCount: number;
  lastUpdated: number;
}

let inMemoryDifficultyProgress: DifficultyProgress = {
  unlockedTiers: ['normal_1'],
  selectedTier: 'normal_1',
  lickTongueCount: 0,
  lastUpdated: Date.now(),
};

export function getDifficultyProgress(): DifficultyProgress {
  return { ...inMemoryDifficultyProgress };
}

export function saveDifficultyProgress(progress: DifficultyProgress): void {
  inMemoryDifficultyProgress = {
    ...progress,
    lastUpdated: Date.now(),
  };
}

export function updateDifficultyProgress(
  inventory: InventoryItem[],
  selectedTier?: string
): DifficultyProgress {
  const currentLickTongueCount = countLickTongues(inventory);
  const progress = getDifficultyProgress();

  const unlockedTiers = progress.unlockedTiers;

  const updatedProgress: DifficultyProgress = {
    ...progress,
    lickTongueCount: currentLickTongueCount,
  };

  if (selectedTier && unlockedTiers.includes(selectedTier)) {
    updatedProgress.selectedTier = selectedTier;
  }

  if (!unlockedTiers.includes(updatedProgress.selectedTier)) {
    updatedProgress.selectedTier = 'normal_1';
  }

  saveDifficultyProgress(updatedProgress);
  return updatedProgress;
}
