'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useSession } from './providers/SessionProvider';
import { useGotchiSprites } from '../hooks/useGotchiSprites';
import { useGotchiEquipment } from '../hooks/useGotchiEquipment';
import { setCharacterSpriteOverride } from '../lib/character-registry';
import { CHARACTERS } from '../lib/character-registry';
import { CharacterPreview } from './CharacterPreview';
import { GotchiPreview } from './GotchiPreview';
import { cn } from '../lib/utils';
import {
  getWearableById,
  getWearableBySlug,
  getWearableRarity,
  itemTypes,
  type WearableDefinition,
  type WearableRarity,
  type WearableSlot,
} from '../data/wearables';
import { GOTCHI_SLOT_BY_INDEX } from '../lib/gotchi-utils';
import {
  getCharacterStats,
  setGotchiWearables,
  setGotchiWearableAssignments,
  type EquipmentSlotMap,
} from '../data/characters';
import { type ProgressionProfile } from '../lib/progression';

const ABILITY_LABELS: Record<string, string> = {
  'life-steal': 'Lifesteal',
  'critical-strike': 'Critical Strike',
  cleave: 'Cleave',
  'potion-farm': 'Potion Farm',
};

// Reused from shared lib/gotchi-utils

interface AbilityLike {
  id?: string;
  name?: string;
}

function normalizeAbilityId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (value && typeof value === 'object') {
    const obj = value as AbilityLike;
    if (typeof obj.id === 'string' && obj.id.trim().length > 0) return obj.id;
    if (typeof obj.name === 'string' && obj.name.trim().length > 0)
      return obj.name;
  }
  return null;
}

function normalizeAbilityList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map((v) => normalizeAbilityId(v)).filter(Boolean) as string[];
}

function getAbilityLabel(input: unknown): string {
  const id = normalizeAbilityId(input);
  if (!id) return 'Ability';
  const fromMap = ABILITY_LABELS[id];
  if (fromMap) return fromMap;
  return id
    .split('-')
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : s))
    .join(' ');
}

function formatAttacksPerSecond(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-/s';
  const aps = 1000 / ms;
  return `${aps % 1 === 0 ? aps : aps.toFixed(2)}/s`;
}

function formatCredits(credits: number): string {
  return credits === 1 ? '1 credit' : `${credits} credits`;
}

function groupAbilityIds(ids: string[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const id of ids) {
    if (!counts.has(id)) order.push(id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return order.map((id) => ({ id, count: counts.get(id)! }));
}

/**
 * Entry cost schedule based on wearable rarity (matches server-side logic)
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

const RARITY_ORDER: WearableRarity[] = [
  'common',
  'uncommon',
  'rare',
  'legendary',
  'mythical',
  'godlike',
];

/**
 * Calculate entry cost from character's default equipped wearables
 */
function calculateEntryCostFromCharacter(character: {
  info: { equippedWearables?: EquipmentSlotMap };
}): number {
  const equippedWearablesMap = character.info.equippedWearables;
  const equippedWearables = equippedWearablesMap
    ? Object.values(equippedWearablesMap).filter(
        (slug): slug is string => typeof slug === 'string' && slug.length > 0
      )
    : [];

  if (equippedWearables.length === 0) {
    return ENTRY_CREDITS_BY_RARITY.naked;
  }

  let maxRarity: WearableRarity | null = null;
  let maxRarityIndex = -1;

  for (const slug of equippedWearables) {
    const wearable = getWearableBySlug(slug);
    if (!wearable) continue;

    const rarity = getWearableRarity(wearable);
    const rarityIndex = RARITY_ORDER.indexOf(rarity);

    if (rarityIndex === -1) continue;

    if (rarityIndex > maxRarityIndex) {
      maxRarityIndex = rarityIndex;
      maxRarity = rarity;
    }
  }

  if (maxRarity === null) {
    return ENTRY_CREDITS_BY_RARITY.naked;
  }

  return ENTRY_CREDITS_BY_RARITY[maxRarity];
}

/**
 * Calculate entry cost from an array of wearable definitions
 */
function calculateEntryCostFromWearables(
  wearableDefs: WearableDefinition[]
): number {
  if (wearableDefs.length === 0) {
    return ENTRY_CREDITS_BY_RARITY.naked;
  }

  let maxRarity: WearableRarity | null = null;
  let maxRarityIndex = -1;

  for (const wearable of wearableDefs) {
    const rarity = getWearableRarity(wearable);
    const rarityIndex = RARITY_ORDER.indexOf(rarity);

    if (rarityIndex === -1) continue;

    if (rarityIndex > maxRarityIndex) {
      maxRarityIndex = rarityIndex;
      maxRarity = rarity;
    }
  }

  if (maxRarity === null) {
    return ENTRY_CREDITS_BY_RARITY.naked;
  }

  return ENTRY_CREDITS_BY_RARITY[maxRarity];
}

interface CharacterCardProps {
  character: (typeof CHARACTERS)[number];
  description: string;
  unlockCost: number;
  requiresUnlock: boolean;
  isUnlocked: boolean;
  isSelected: boolean;
  isUnlocking: boolean;
  isAffordable: boolean;
  selectedCharacterId: string | null;
  pendingCharacterId: string | null;
  unlockedCharacterSet: Set<string>;
  allocatedStats?: ProgressionProfile['stats'];
  playerId: string | null;
  lickTongueCount: number;
  onCharacterSelect: (characterId: string) => Promise<void>;
  onUnlock: (characterId: string) => Promise<void>;
}

function CharacterCard({
  character,
  description,
  unlockCost,
  requiresUnlock,
  isUnlocked,
  isSelected,
  isUnlocking,
  isAffordable,
  selectedCharacterId,
  pendingCharacterId,
  allocatedStats,
  playerId,
  lickTongueCount,
  onCharacterSelect,
  onUnlock,
}: CharacterCardProps) {
  const entryCredits = useMemo(
    () => calculateEntryCostFromCharacter(character),
    [character]
  );

  return (
    <div
      className={cn(
        'relative bg-white/5 border border-white/10 rounded-lg p-2 py-1 transition-all duration-200 hover:bg-white/15 hover:border-white/20',
        !isUnlocked && !isAffordable && 'opacity-60',
        isUnlocked ? 'cursor-pointer' : '',
        isSelected &&
          'ring-2 ring-purple-500 bg-purple-500/10 border-purple-500/30'
      )}
      onClick={() => {
        if (!isUnlocked || isUnlocking || pendingCharacterId) return;
        void onCharacterSelect(character.id);
      }}
      aria-selected={isSelected}
      aria-disabled={!isUnlocked}
    >
      <div className="flex items-center gap-2">
        <CharacterPreview
          characterId={character.id}
          size="sm"
          isSelected={isSelected}
          className="flex-shrink-0"
          allocatedStats={allocatedStats}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="font-medium text-white text-sm truncate">
                {character.info.name}
              </div>
              {isSelected && (
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse flex-shrink-0" />
              )}
            </div>
            <div className="text-xs text-gray-300 font-semibold flex-shrink-0">
              {formatCredits(entryCredits)}
            </div>
          </div>
          {/* Description */}
          <div className="mt-0.5 text-xs text-gray-400 line-clamp-1">
            {description}
          </div>
        </div>

        {!isUnlocked && requiresUnlock && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!isAffordable || isUnlocking) return;
              void onUnlock(character.id);
            }}
            disabled={!isAffordable || isUnlocking}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs transition-colors border flex flex-row items-center gap-1.5 border-purple-400/40 bg-purple-600/90 hover:bg-purple-600 flex-shrink-0',
              isAffordable && !isUnlocking
                ? 'text-white font-semibold'
                : 'text-gray-300 font-medium',
              (!isAffordable || isUnlocking) && 'opacity-60 cursor-not-allowed'
            )}
          >
            <Lock
              className={cn(
                'w-4 h-4',
                isAffordable && !isUnlocking ? 'text-white' : 'text-gray-300'
              )}
            />
            {isUnlocking ? 'Unlocking…' : `👅 ${unlockCost}`}
          </button>
        )}
      </div>
    </div>
  );
}

interface CharacterSelectorProps {
  selectedCharacterId: string | null;
  unlockedCharacters: string[];
  lickTongueCount: number;
  onCharacterSelect: (
    characterId: string,
    options?: { gotchiSpriteUrl?: string | null }
  ) => Promise<void>;
  onUnlockCharacter: (characterId: string) => Promise<void>;
  isHydrated?: boolean;
  className?: string;
  progressionProfile?: ProgressionProfile | null;
  activeTab?: 'characters' | 'gotchis';
  onTabChange?: (tab: 'characters' | 'gotchis') => void;
  serverBaseUrl?: string;
}

export function CharacterSelector({
  selectedCharacterId,
  unlockedCharacters,
  lickTongueCount,
  onCharacterSelect,
  onUnlockCharacter,
  isHydrated = true,
  className,
  progressionProfile,
  activeTab: externalActiveTab,
  onTabChange: externalOnTabChange,
  serverBaseUrl,
}: CharacterSelectorProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<
    'characters' | 'gotchis'
  >('characters');
  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = externalOnTabChange ?? setInternalActiveTab;
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(
    null
  );
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // All hooks must be called before any conditional returns
  const { isWalletConnected, playerId } = useSession();
  const { entries, isLoading } = useGotchiSprites(
    isWalletConnected,
    serverBaseUrl
  );

  const isGotchiTabActive = activeTab === 'gotchis';
  const allocatedStats = progressionProfile?.stats;
  const unlockedCharacterSet = useMemo(
    () => new Set(unlockedCharacters),
    [unlockedCharacters]
  );
  const sortedCharacters = useMemo(() => {
    const playable = CHARACTERS.filter((c) => c.info.isPlayable !== false);
    return playable.sort((a, b) => {
      const costA = Number.isFinite(a.info.unlockCost) ? a.info.unlockCost : 0;
      const costB = Number.isFinite(b.info.unlockCost) ? b.info.unlockCost : 0;
      if (costA !== costB) return costA - costB;
      return a.info.name.localeCompare(b.info.name);
    });
  }, []);
  const handleCharacterSelect = async (
    characterId: string,
    options?: { gotchiSpriteUrl?: string | null }
  ) => {
    if (pendingCharacterId) return;
    setPendingCharacterId(characterId);
    try {
      await onCharacterSelect(characterId, options);
    } finally {
      setPendingCharacterId(null);
    }
  };

  const handleUnlock = useCallback(
    async (characterId: string) => {
      setUnlockError(null);
      setPendingCharacterId(characterId);
      try {
        await onUnlockCharacter(characterId);
        onCharacterSelect(characterId);
      } catch (error) {
        setUnlockError(
          error instanceof Error ? error.message : 'Failed to unlock character'
        );
      } finally {
        setPendingCharacterId(null);
      }
    },
    [onUnlockCharacter, onCharacterSelect]
  );

  // Show loading skeleton if not hydrated
  if (!isHydrated) {
    return (
      <div className={cn('space-y-3', className)}>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Select Hero
        </label>

        {/* Loading Skeleton */}
        <div className="relative bg-white/10 border border-white/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-32 h-32 bg-white/20 rounded-full animate-pulse flex-shrink-0" />
              <div className="space-y-2">
                <div className="h-5 bg-white/20 rounded animate-pulse w-24" />
                <div className="h-4 bg-white/20 rounded animate-pulse w-20" />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="h-6 bg-white/20 rounded animate-pulse w-12" />
              <div className="w-4 h-4 bg-white/20 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('', className)}>
      {unlockError && (
        <div className="mb-4 text-sm text-red-400">{unlockError}</div>
      )}

      {activeTab === 'gotchis' && (
        <OwnedGotchiesBlock
          selectedCharacterId={selectedCharacterId}
          onUse={(id, options) =>
            pendingCharacterId ? undefined : handleCharacterSelect(id, options)
          }
          entries={entries}
          isLoading={isLoading}
          isWalletConnected={isWalletConnected}
          demoAllAnimations={isGotchiTabActive}
          serverBaseUrl={serverBaseUrl}
        />
      )}

      {/* Characters List - One per row */}
      {activeTab === 'characters' && (
        <div className="space-y-1.5">
          <div className="flex flex-col gap-1.5 p-1">
            {sortedCharacters.map((character) => {
              const description = character.info.description;

              const cost = Number(character.info.unlockCost ?? 0);
              const requiresUnlock = cost > 0;
              const isUnlocked =
                !requiresUnlock || unlockedCharacterSet.has(character.id);
              const isSelected =
                isUnlocked && selectedCharacterId === character.id;
              const isUnlocking = pendingCharacterId === character.id;
              const isAffordable = lickTongueCount >= cost;

              return (
                <CharacterCard
                  key={character.id}
                  character={character}
                  description={description}
                  unlockCost={cost}
                  requiresUnlock={requiresUnlock}
                  isUnlocked={isUnlocked}
                  isSelected={isSelected}
                  isUnlocking={isUnlocking}
                  isAffordable={isAffordable}
                  selectedCharacterId={selectedCharacterId}
                  pendingCharacterId={pendingCharacterId}
                  unlockedCharacterSet={unlockedCharacterSet}
                  allocatedStats={allocatedStats}
                  playerId={playerId}
                  lickTongueCount={lickTongueCount}
                  onCharacterSelect={handleCharacterSelect}
                  onUnlock={handleUnlock}
                />
              );
            })}
          </div>
        </div>
      )}

      {pendingCharacterId && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
          role="status"
          aria-live="polite"
        >
          <div className="rounded-md border border-white/20 bg-black/80 px-4 py-3 text-white text-sm inline-flex items-center gap-2">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <span>Selecting hero…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GotchiItem({
  entry,
  selectedCharacterId,
  onUse,
  svgIdToItemTypeId,
  equipmentRecord,
  equipLoading,
  demoAllAnimations,
  serverBaseUrl,
}: {
  entry: ReturnType<typeof useGotchiSprites>['entries'][number];
  selectedCharacterId: string | null;
  onUse: (
    characterId: string,
    options?: { gotchiSpriteUrl?: string | null }
  ) => void;
  svgIdToItemTypeId: Map<number, number>;
  equipmentRecord: { equippedWearables: number[]; name?: string } | undefined;
  equipLoading: boolean;
  demoAllAnimations: boolean;
  serverBaseUrl?: string;
}) {
  const [resolvedUrl, setResolvedUrl] = React.useState<string>(entry.url || '');
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const dynamicId = `gotchi:${entry.id}`;
  const isSelected = selectedCharacterId === dynamicId;
  const wearableAssignments = useMemo(() => {
    const equipped = equipmentRecord?.equippedWearables || [];
    const result: Array<{ slot: WearableSlot; def: WearableDefinition }> = [];
    equipped.forEach((svgId, index) => {
      const slot = GOTCHI_SLOT_BY_INDEX[index];
      if (!slot) return;
      const itemTypeId = svgIdToItemTypeId.get(svgId);
      if (!itemTypeId) return;
      const def = getWearableById(itemTypeId);
      if (!def) return;
      result.push({ slot, def });
    });
    return result;
  }, [equipmentRecord?.equippedWearables, svgIdToItemTypeId]);

  const wearableDefs = useMemo(
    () => wearableAssignments.map((entry) => entry.def),
    [wearableAssignments]
  );

  const wearableSlugs = useMemo(
    () => wearableAssignments.map((entry) => entry.def.slug),
    [wearableAssignments]
  );

  const slotMap = useMemo<EquipmentSlotMap>(() => {
    const map: EquipmentSlotMap = {};
    for (const { slot, def } of wearableAssignments) {
      map[slot as keyof EquipmentSlotMap] = def.slug;
    }
    return map;
  }, [wearableAssignments]);

  const slotKey = useMemo(
    () =>
      wearableAssignments
        .map((entry) => `${entry.slot}:${entry.def.slug}`)
        .join('|'),
    [wearableAssignments]
  );

  const derived = useMemo(
    () =>
      getCharacterStats(dynamicId, {
        equippedWearables: slotMap,
      }),
    [dynamicId, slotKey, slotMap]
  );

  const abilityIds: string[] = [];
  for (const def of wearableDefs) {
    if (def.weapon && Array.isArray(def.weapon.abilities)) {
      for (const a of def.weapon.abilities) {
        if (a?.id) abilityIds.push(a.id);
      }
    }
  }
  const wearableAbilityGroups = groupAbilityIds(abilityIds);

  const entryCredits = useMemo(
    () => calculateEntryCostFromWearables(wearableDefs),
    [wearableDefs]
  );

  React.useEffect(() => {
    setResolvedUrl(entry.url || '');
  }, [entry.url]);

  // Resolution is handled by GotchiPreview; keep this effect removed

  const effectiveUrl = resolvedUrl || entry.url || '';

  return (
    <div
      ref={rootRef}
      className={cn(
        'relative bg-white/5 border border-white/10 rounded-lg p-3 cursor-pointer transition-all hover:bg-white/15 hover:border-white/20',
        isSelected &&
          'ring-2 ring-purple-500 bg-purple-500/10 border-purple-500/30'
      )}
      onClick={() => {
        if (effectiveUrl) {
          setCharacterSpriteOverride(dynamicId, {
            imagePath: effectiveUrl,
            frameWidth: 100,
            frameHeight: 100,
          });
        }
        // Persist current gotchi wearables for downstream stats usage
        const assignmentsPayload = wearableAssignments.map((assignment) => ({
          slot: assignment.slot,
          slug: assignment.def.slug,
        }));
        setGotchiWearables(String(entry.id), wearableSlugs);
        setGotchiWearableAssignments(String(entry.id), assignmentsPayload);
        onUse(dynamicId, { gotchiSpriteUrl: effectiveUrl || null });
      }}
      aria-selected={isSelected}
    >
      <div className="flex items-center gap-4">
        <GotchiPreview
          url={effectiveUrl}
          gotchiId={entry.id}
          serverBaseUrl={serverBaseUrl}
          onResolvedUrl={setResolvedUrl}
          size="md"
          className="rounded mb-0 flex-shrink-0"
          hasPanelBackground={false}
          demoAllAnimations={demoAllAnimations}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-white text-sm truncate">
              {equipLoading
                ? 'loading...'
                : equipmentRecord?.name &&
                    equipmentRecord.name.trim().length > 0
                  ? `${equipmentRecord.name} - ${formatCredits(entryCredits)}`
                  : `Gotchi #${entry.id} - ${formatCredits(entryCredits)}`}
            </div>
          </div>

          {/* Abilities (from equipped weapon/armor only) */}
          <div className="mt-2 flex flex-wrap gap-1">
            {wearableAbilityGroups.length > 0 ? (
              wearableAbilityGroups.map(({ id, count }, idx) => (
                <span
                  key={`${id}-${idx}`}
                  className="px-1.5 py-0.5 rounded bg-purple-600/30 text-purple-100 text-[11px]"
                >
                  {`${getAbilityLabel(id)}${count > 1 ? ` x${count}` : ''}`}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-gray-400">No abilities</span>
            )}
          </div>

          {/* Stats (defaults only): damage | speed | HP */}
          <div className="mt-2 text-xs">
            <div className="bg-white/10 rounded px-2 py-1 text-gray-200 inline-flex items-center flex-wrap gap-1">
              <span className="inline-flex items-center gap-1">
                {derived.weaponType === 'melee' ? (
                  '⚔️'
                ) : derived.weaponType === 'ranged' ? (
                  '🏹'
                ) : (
                  <span className="capitalize">{derived.weaponType}</span>
                )}
                <span>
                  {derived.damageRange.min === derived.damageRange.max
                    ? `${derived.damageRange.min}`
                    : `${derived.damageRange.min}-${derived.damageRange.max}`}
                </span>
              </span>
              <span className="text-gray-400 mx-1">|</span>
              <span>{formatAttacksPerSecond(derived.attackSpeed)}</span>
              <span className="text-gray-400 mx-1">|</span>
              <span>{derived.maxHealth} HP</span>
            </div>
          </div>

          {/* Equipped Wearables (SVG icons) */}
          {wearableDefs.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex items-center gap-1 overflow-x-auto">
                {wearableDefs.map((w) => (
                  <img
                    key={w.id}
                    src={`/wearables/${w.svgId}.svg`}
                    alt={w.name}
                    className="w-6 h-6 rounded object-contain bg-white/10 p-0.5"
                    loading="lazy"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OwnedGotchiesBlock({
  selectedCharacterId,
  onUse,
  entries,
  isLoading,
  isWalletConnected,
  demoAllAnimations,
  serverBaseUrl,
}: {
  selectedCharacterId: string | null;
  onUse: (
    characterId: string,
    options?: { gotchiSpriteUrl?: string | null }
  ) => void;
  entries: ReturnType<typeof useGotchiSprites>['entries'];
  isLoading: boolean;
  isWalletConnected: boolean;
  demoAllAnimations: boolean;
  serverBaseUrl?: string;
}) {
  // All hooks must be called before any conditional returns
  // Build svgId -> itemTypeId lookup once
  const svgIdToItemTypeId = useMemo(() => {
    const map = new Map<number, number>();
    try {
      Object.entries(itemTypes).forEach(([idStr, def]) => {
        const idNum = Number(idStr);
        if (def && Number.isFinite(def.svgId)) {
          map.set(def.svgId, idNum);
        }
      });
    } catch {}
    return map;
  }, []);

  // Use cached equipment data (in-memory, session-scoped)
  const { isLoading: equipLoading, byId } =
    useGotchiEquipment(isWalletConnected);

  if (!isWalletConnected) return null;

  return (
    <div className="space-y-2 mb-6">
      <h3 className="text-sm font-medium text-gray-300">My Aavegotchis</h3>
      {(isLoading || equipLoading) && (
        <div className="text-xs text-gray-400">Loading your gotchis…</div>
      )}
      {entries.length === 0 && !isLoading && (
        <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/20 rounded px-3 py-2">
          <strong>Authentication Required:</strong> Sign the message in your
          wallet to authenticate and load your Aavegotchis.
        </div>
      )}

      <div className="flex flex-col gap-3 p-1">
        {entries.map((e) => (
          <GotchiItem
            key={e.id}
            entry={e}
            selectedCharacterId={selectedCharacterId}
            onUse={onUse}
            svgIdToItemTypeId={svgIdToItemTypeId}
            equipmentRecord={byId[e.id]}
            equipLoading={equipLoading}
            demoAllAnimations={demoAllAnimations}
            serverBaseUrl={serverBaseUrl}
          />
        ))}
      </div>
    </div>
  );
}
