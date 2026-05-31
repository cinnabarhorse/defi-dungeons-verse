import {
  getPlayerEquipmentState,
  buildEquipmentStateForCharacter,
  normalizeEquipmentSlotName,
  ensureGotchiWearablesHydrated,
} from '../equipment-service';
import { equipmentRepo } from '../db';
import {
  getWearableBySlug,
  getWearableRarity,
  type WearableRarity,
} from '../../data/wearables';
import { normalizeQualityTier } from '../../data/wearable-quality';

/**
 * Cost schedule for entry credits based on wearable rarity (absolute, not additive).
 */
const ENTRY_CREDITS_BY_RARITY: Record<WearableRarity | 'naked', number> = {
  naked: 1,
  common: 2,
  uncommon: 3,
  rare: 4,
  legendary: 5,
  mythical: 6,
  godlike: 8,
};

/**
 * Rarity order for comparison (lower index = lower rarity).
 */
const RARITY_ORDER: WearableRarity[] = [
  'common',
  'uncommon',
  'rare',
  'legendary',
  'mythical',
  'godlike',
];

/**
 * Returns the entry credits cost for a given maximum rarity.
 * @param maxRarity The highest rarity present, or null for naked (no equipment)
 * @returns The number of credits required
 */
export function getEntryCreditsForRarity(
  maxRarity: WearableRarity | null
): number {
  if (maxRarity === null) {
    return ENTRY_CREDITS_BY_RARITY.naked;
  }
  return ENTRY_CREDITS_BY_RARITY[maxRarity];
}

/**
 * Determines the maximum equipped rarity for a player.
 * @param playerId The player ID
 * @param characterId Optional character ID to use instead of resolving from database
 * @returns The highest rarity present, or null if no equipment
 * @throws Error if any equipped slug cannot resolve to a known rarity
 */
export async function getMaxEquippedRarityForPlayer(
  playerId: string,
  characterId?: string | null
): Promise<WearableRarity | null> {
  let equipmentState;
  if (characterId) {
    await ensureGotchiWearablesHydrated(playerId, characterId);
    const overridesRaw = await equipmentRepo.getEquippedWithInstances(
      playerId,
      characterId
    );
    const overrides = overridesRaw.map((entry) => ({
      slot: normalizeEquipmentSlotName(entry.slot),
      slug: entry.wearableSlug,
      inventoryItemId: entry.inventoryItemId ?? null,
      quality: normalizeQualityTier(entry.quality),
    }));
    equipmentState = buildEquipmentStateForCharacter(characterId, overrides);
  } else {
    equipmentState = await getPlayerEquipmentState(playerId);
  }
  // Ignore the background slot for entry-cost calculations
  const eligibleAssignments = (equipmentState.equipment || []).filter(
    (a) => a && a.slot !== 'background'
  );
  if (eligibleAssignments.length === 0) {
    return null; // Naked
  }

  let maxRarity: WearableRarity | null = null;
  let maxRarityIndex = -1;

  for (const { slug } of eligibleAssignments) {
    const wearable = getWearableBySlug(slug);
    if (!wearable) {
      throw new Error(
        `Cannot resolve wearable rarity for slug: ${slug} (player: ${playerId})`
      );
    }

    const rarity = getWearableRarity(wearable);
    const rarityIndex = RARITY_ORDER.indexOf(rarity);

    if (rarityIndex === -1) {
      throw new Error(
        `Unknown rarity "${rarity}" for wearable slug: ${slug} (player: ${playerId})`
      );
    }

    if (rarityIndex > maxRarityIndex) {
      maxRarityIndex = rarityIndex;
      maxRarity = rarity;
    }
  }

  return maxRarity;
}

/**
 * Gets the wearable cost bracket name for a given rarity.
 * @param maxRarity The highest rarity present, or null for naked
 * @returns The cost bracket name
 */
export function getWearableCostBracket(
  maxRarity: WearableRarity | null
):
  | 'naked'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'legendary'
  | 'mythical'
  | 'godlike' {
  if (maxRarity === null) {
    return 'naked';
  }
  return maxRarity;
}

/**
 * Calculates the entry fee in cents for a player based on their equipped wearables.
 * @param playerId The player ID
 * @param characterId Optional character ID to use instead of resolving from database
 * @returns The entry fee in cents
 * @throws Error if any equipped slug cannot resolve to a known rarity
 */
export async function getEntryFeeCentsForPlayer(
  playerId: string,
  characterId?: string | null
): Promise<number> {
  const maxRarity = await getMaxEquippedRarityForPlayer(playerId, characterId);
  const credits = getEntryCreditsForRarity(maxRarity);
  return Math.round(credits * 100);
}
