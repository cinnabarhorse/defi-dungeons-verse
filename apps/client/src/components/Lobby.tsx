'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi } from 'lucide-react';
import {
  Ghost,
  HandMetal,
  Info,
  MapPin,
  Server,
  Skull,
  Swords,
  Trophy,
  User,
  UserCircle,
  UserIcon,
} from 'lucide-react';
import { WalletConnectControl } from './WalletConnectControl';
import { Button } from './ui/Button';
import { CharacterSelector } from './CharacterSelector';
import { CharacterPreview } from './CharacterPreview';
import {
  HeroDetailsView,
  formatAttacksPerSecond,
  getAbilityLabel,
} from './HeroDetailsView';
import type {
  AbilityEntry,
  HeroDetails,
  HeroWeaponSummary,
} from './HeroDetailsView';
import type { QualityTier } from '../data/wearable-quality';
import { DifficultySelector } from './DifficultySelector';
import { RegionSelector, type RegionSelectorRef } from './RegionSelector';
import { cn } from '../lib/utils';
import { CHARACTERS } from '../lib/character-registry';
import { getDifficultyTier } from '../data/difficulty-tiers';
import { SERVER_REGIONS, getServerUrlForRegion } from '../lib/server-regions';
import type { EquipmentSlotName } from '../hooks/useEquipment';
import { getCharacterStats } from '../lib/character-registry';
import {
  getWearableBySlug,
  itemTypes,
  type WearableDefinition,
} from '../data/wearables';
import { useGotchiSprites } from '../hooks/useGotchiSprites';
import { useGotchiEquipment } from '../hooks/useGotchiEquipment';
import { useEquipment } from '../hooks/useEquipment';
import { useSession } from './providers/SessionProvider';
import { usePlayer } from './providers/PlayerProvider';
import { ApplyForAlpha } from './ApplyForAlpha';
import { buildGotchiSlotMapFromSvgIds } from '../lib/gotchi-utils';
import {
  computeProgressionModifiers,
  type ProgressionProfile,
} from '../lib/progression';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/Dialog';
import { Globe } from 'lucide-react';
import { TopupForm } from './topup/topup-form';
import type { OwnedGotchiEquipmentRecord } from '../hooks/useGotchiEquipment';
import {
  RUN_ARCHETYPES_BY_ID,
  RUN_ARCHETYPE_BY_CHARACTER_ID,
  type RunLevelTraitDefinition,
} from '../data/archetypes';
import { formatKillStreakTrait } from '../lib/traits';
import { useLootCatalog } from '../hooks/useLootCatalog';
import { SplashBackground } from './SplashBackground';

const DEV_MODE = process.env.NODE_ENV !== 'production';

function resolveWearableIconFor(
  wearable: WearableDefinition | null | undefined
): string | null {
  if (!wearable) return null;
  const rawId = (wearable as any).svgId as number | undefined;
  const numericId = Number.isFinite(rawId) ? (rawId as number) : wearable.id;
  return Number.isFinite(numericId) ? `/wearables/${numericId}.svg` : null;
}

function resolveWeaponIconFor(
  weapon: HeroWeaponSummary | null | undefined
): string | null {
  if (!weapon) return null;
  const numericId = Number((weapon as any).svgId ?? weapon.id);
  return Number.isFinite(numericId) ? `/wearables/${numericId}.svg` : null;
}

function resolveLootIcon(icon: unknown): string | undefined {
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

interface LootPreviewItem {
  id: string;
  name: string;
  iconUrl?: string;
  quantity: number | null;
}

function LootPreviewStrip() {
  const { loot, isLoading } = useLootCatalog();

  const items = useMemo<LootPreviewItem[]>(() => {
    return loot
      .filter((entry) => entry && entry.isActive !== false)
      .slice(0, 18)
      .map((entry) => {
        const metadata =
          entry && typeof entry.metadata === 'object' && entry.metadata !== null
            ? (entry.metadata as Record<string, unknown>)
            : {};
        const name =
          (typeof entry.name === 'string' && entry.name) ||
          (typeof (metadata as any).label === 'string' &&
            ((metadata as any).label as string)) ||
          `Loot ${entry.id.slice(0, 6)}`;
        const iconUrl = resolveLootIcon((metadata as any).icon);
        return {
          id: entry.id,
          name,
          iconUrl,
          quantity: entry.remaining ?? null,
        };
      });
  }, [loot]);

  if (isLoading && items.length === 0) {
    return (
      <div className="mt-3">
        <div className="h-16 rounded-xl bg-white/5 border border-white/10 animate-pulse" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-3">
      <div
        aria-label="Available loot preview"
        className="h-16 rounded-xl bg-white/5 border border-white/10 px-3 flex items-center overflow-x-auto gap-2"
      >
        {items.map((item) => {
          const formatted =
            item.quantity == null
              ? '∞'
              : new Intl.NumberFormat(undefined, {
                  maximumFractionDigits: 0,
                }).format(item.quantity);
          return (
            <div
              key={item.id}
              className="relative h-10 w-10 rounded bg-white/10 grid place-items-center shrink-0"
              title={item.name}
            >
              {item.iconUrl ? (
                <img
                  src={item.iconUrl}
                  alt={item.name}
                  className="h-8 w-8 object-contain"
                />
              ) : (
                <span className="text-[10px] text-white/70">LOOT</span>
              )}
              <div className="absolute -bottom-1 -right-1 text-[10px] leading-none px-1 rounded-full bg-black/70 border border-white/10 text-white">
                {formatted}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAbilityEntry(ability: unknown): AbilityEntry | null {
  if (!ability || typeof ability !== 'object') return null;
  const candidate = ability as { id?: unknown; params?: unknown };
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return null;
  }

  const params = candidate.params;
  return {
    id: candidate.id,
    params: isRecord(params) ? (params as Record<string, unknown>) : null,
  };
}

function appendAbilities(target: AbilityEntry[], abilities: Iterable<unknown>) {
  for (const ability of abilities) {
    const entry = normalizeAbilityEntry(ability);
    if (entry) {
      target.push(entry);
    }
  }
}

function formatFloat(value: number, maxDecimals = 2): string {
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(value * factor) / factor;
  if (Number.isInteger(rounded)) {
    return `${rounded}`;
  }
  return rounded.toFixed(Math.min(maxDecimals, 2)).replace(/\.?0+$/, '');
}

function formatPercentValue(value: number): string {
  const percent = value * 100;
  const abs = Math.abs(percent);
  const decimals = abs >= 10 ? 0 : abs >= 1 ? 1 : 2;
  return formatFloat(percent, decimals);
}

function formatKillStreakTraitSummary(
  trait: RunLevelTraitDefinition | undefined
): string | null {
  if (!trait) return null;
  if (trait.type === 'none')
    return trait.note ? `Kill streak trait: ${trait.note}` : null;

  // Show the per-unit effect and cap concisely; use the shared formatter for 1 unit
  const sample = formatKillStreakTrait(trait, 1);
  if (!sample) return trait.note ? `Kill streak trait: ${trait.note}` : null;

  const cap = typeof trait.cap === 'number' ? trait.cap : null;
  const capText =
    cap != null && trait.type !== 'hp_regen'
      ? ` (cap ${Math.round(cap * 100)}%)`
      : '';
  return `Kill streak: ${sample.shortLabel} ${sample.valueText}/unit${capText}.`;
}

// Aggregation helpers for preview stacking
const MAX_TONGUE_FARM_BONUS = 0.25;
const DEFAULT_TONGUE_FARM_TAGS = ['lickquidator'];

function aggregateTongueFarm(entries: AbilityEntry[]): {
  bonusChance: number;
  appliesToEnemyTags: string[];
} {
  let total = 0;
  const tagSet = new Set<string>();

  for (const entry of entries) {
    if (!entry || entry.id !== 'tongue-farm') continue;
    const params = entry.params || {};
    const rawBonus = (params as any).bonusChance;
    const sourceCap = (params as any).maxBonus;
    const bonus =
      typeof rawBonus === 'number' && Number.isFinite(rawBonus) && rawBonus > 0
        ? rawBonus
        : 0;
    const capped =
      typeof sourceCap === 'number' &&
      Number.isFinite(sourceCap) &&
      sourceCap >= 0
        ? Math.min(bonus, sourceCap)
        : bonus;
    total += Math.max(0, capped);

    const appliesRaw = (params as any).appliesToEnemyTags;
    const tags =
      Array.isArray(appliesRaw) && appliesRaw.length > 0
        ? appliesRaw.filter((t) => typeof t === 'string' && t.length > 0)
        : DEFAULT_TONGUE_FARM_TAGS;
    for (const t of tags) tagSet.add(t);
  }

  const clamped = Math.max(0, Math.min(MAX_TONGUE_FARM_BONUS, total));
  const tags =
    tagSet.size > 0 ? Array.from(tagSet) : [...DEFAULT_TONGUE_FARM_TAGS];
  return { bonusChance: clamped, appliesToEnemyTags: tags };
}

interface BuildHeroDetailsArgs {
  isCharacterHydrated: boolean;
  selectedCharacterId: string | null;
  selectedCharacterName: string;
  progressionModifiers: ReturnType<typeof computeProgressionModifiers>;
  svgIdToItemTypeId: Map<number, number>;
  gotchiEquipById: Record<number, OwnedGotchiEquipmentRecord>;
  equippedWearablesWithQuality?: Array<{
    slot: EquipmentSlotName;
    slug: string;
    quality: QualityTier;
  }>;
}

function buildHeroDetails({
  isCharacterHydrated,
  selectedCharacterId,
  selectedCharacterName,
  progressionModifiers,
  svgIdToItemTypeId,
  gotchiEquipById,
  equippedWearablesWithQuality,
}: BuildHeroDetailsArgs): HeroDetails | null {
  if (!isCharacterHydrated) return null;
  if (!selectedCharacterId) return null;

  try {
    const fallbackCharacter = CHARACTERS[0];
    const isDynamic = selectedCharacterId?.startsWith('gotchi:') ?? false;
    const selectedCharacter = isDynamic
      ? fallbackCharacter
      : CHARACTERS.find((c) => c.id === selectedCharacterId) ||
        fallbackCharacter;
    const previewId = isDynamic ? selectedCharacterId : selectedCharacter.id;
    const normalizedCharacterId = isDynamic
      ? null
      : selectedCharacter.id.toLowerCase();
    const archetypeId = normalizedCharacterId
      ? (RUN_ARCHETYPE_BY_CHARACTER_ID[normalizedCharacterId] ?? null)
      : null;
    const archetypeDef = archetypeId
      ? RUN_ARCHETYPES_BY_ID[archetypeId]
      : undefined;
    const archetypeName = archetypeDef?.name ?? null;
    const runTraitSummary = archetypeDef
      ? formatKillStreakTraitSummary(archetypeDef.levelTrait)
      : null;
    const baseDescription = isDynamic
      ? 'Your connected Aavegotchi hero. Stats and abilities depend on equipped wearables and allocated traits.'
      : selectedCharacter.info.description;

    const abilityEntries: AbilityEntry[] = [];
    let wearables: WearableDefinition[] = [];
    let baseDamageRange = { min: 10, max: 10 };
    let baseAttackSpeed = 1000;
    let baseMaxHealth = 100;
    let attackRange: number | null = isDynamic ? 80 : null;
    let weaponType: string | undefined = isDynamic ? 'melee' : undefined;
    let projectileSpeed: number | null = null;
    let movementSpeed: number | null = null;
    const weapons: HeroWeaponSummary[] = [];

    if (isDynamic) {
      // Gotchi: compute derived stats using the same pipeline as inventory
      const split = selectedCharacterId.split(':')[1];
      const gotchiIdNum = parseInt(split || '0', 10);
      const record = Number.isFinite(gotchiIdNum)
        ? gotchiEquipById[gotchiIdNum]
        : undefined;

      // Build a slot map from the equipped SVG ids when we have them,
      // so getCharacterStats can derive modifiers identically to Inventory.
      const equippedSvgIds = (record?.equippedWearables || []) as number[];
      const slotMap = buildGotchiSlotMapFromSvgIds(
        equippedSvgIds,
        svgIdToItemTypeId
      );

      const derivedStats = Object.keys(slotMap).length
        ? getCharacterStats(selectedCharacterId, { equippedWearables: slotMap })
        : getCharacterStats(selectedCharacterId);

      // Populate hero details from derived stats (wearable modifiers applied)
      baseDamageRange = { ...derivedStats.damageRange };
      baseAttackSpeed = derivedStats.attackSpeed ?? baseAttackSpeed;
      baseMaxHealth = derivedStats.maxHealth ?? baseMaxHealth;
      weaponType = derivedStats.weaponType ?? weaponType;
      attackRange =
        (derivedStats.weaponType === 'ranged'
          ? derivedStats.rangedAttackRange
          : derivedStats.meleeAttackRange) ?? attackRange;
      projectileSpeed = derivedStats.projectileSpeed ?? null;
      movementSpeed = derivedStats.movementSpeed ?? null;

      wearables = derivedStats.equipment.slugs
        .map((slug) => getWearableBySlug(slug))
        .filter((w): w is NonNullable<ReturnType<typeof getWearableBySlug>> =>
          Boolean(w)
        );

      derivedStats.weapons.forEach((weapon) => {
        weapons.push({
          id: weapon.id,
          svgId: weapon.id,
          name: weapon.name,
          weaponType: weapon.weaponType,
          attackSpeed: weapon.attackSpeed ?? null,
          damageRange: weapon.damageRange
            ? { ...weapon.damageRange }
            : typeof weapon.damage === 'number'
              ? { min: weapon.damage, max: weapon.damage }
              : null,
        });
        appendAbilities(abilityEntries, weapon.abilities);
      });

      appendAbilities(abilityEntries, derivedStats.abilities);
    } else {
      const derivedStats = getCharacterStats(selectedCharacter.id, {
        equippedWearablesWithQuality,
      });
      baseDamageRange = { ...derivedStats.damageRange };
      baseAttackSpeed = derivedStats.attackSpeed ?? baseAttackSpeed;
      baseMaxHealth = derivedStats.maxHealth ?? baseMaxHealth;
      weaponType = derivedStats.weaponType ?? weaponType;
      attackRange =
        (derivedStats.weaponType === 'ranged'
          ? derivedStats.rangedAttackRange
          : derivedStats.meleeAttackRange) ?? attackRange;
      projectileSpeed = derivedStats.projectileSpeed ?? null;
      movementSpeed = derivedStats.movementSpeed ?? null;
      wearables = derivedStats.equipment.slugs
        .map((slug) => getWearableBySlug(slug))
        .filter((w): w is NonNullable<ReturnType<typeof getWearableBySlug>> =>
          Boolean(w)
        );

      appendAbilities(abilityEntries, derivedStats.abilities);

      if (
        derivedStats.abilities.length === 0 &&
        Array.isArray(selectedCharacter.info.abilities)
      ) {
        appendAbilities(abilityEntries, selectedCharacter.info.abilities);
      }

      derivedStats.weapons.forEach((weapon) => {
        weapons.push({
          id: weapon.id,
          svgId: weapon.id,
          name: weapon.name,
          weaponType: weapon.weaponType,
          attackSpeed: weapon.attackSpeed ?? null,
          damageRange: weapon.damageRange
            ? { ...weapon.damageRange }
            : typeof weapon.damage === 'number'
              ? { min: weapon.damage, max: weapon.damage }
              : null,
        });
        appendAbilities(abilityEntries, weapon.abilities);
      });
      // Note: derivedStats.abilities already include wearable abilities; avoid double-adding
    }

    // Ensure hero details do not list weapon wearables in the Wearables section
    wearables = wearables.filter((w) => !w.weapon);

    const pm = progressionModifiers;
    const finalDamageRange = {
      min: Math.max(1, Math.round(baseDamageRange.min * pm.damageMultiplier)),
      max: Math.max(1, Math.round(baseDamageRange.max * pm.damageMultiplier)),
    };
    const finalAttackSpeed = Math.max(
      150,
      Math.round(baseAttackSpeed * pm.attackSpeedScalar)
    );
    const finalMaxHealth = Math.max(
      1,
      Math.round(baseMaxHealth * pm.maxHealthMultiplier + pm.maxHealthFlatBonus)
    );

    const abilityMap = new Map<string, AbilityEntry>();
    abilityEntries.forEach((entry) => {
      const existing = abilityMap.get(entry.id);
      if (!existing) {
        abilityMap.set(entry.id, {
          id: entry.id,
          params: entry.params ?? null,
        });
        return;
      }
      if (!existing.params && entry.params) {
        abilityMap.set(entry.id, { id: entry.id, params: entry.params });
      }
    });

    // Post-process: aggregate stacking for Tongue Farm so preview shows total
    if (abilityEntries.some((e) => e.id === 'tongue-farm')) {
      const agg = aggregateTongueFarm(abilityEntries);
      abilityMap.set('tongue-farm', {
        id: 'tongue-farm',
        params: {
          bonusChance: agg.bonusChance,
          appliesToEnemyTags: agg.appliesToEnemyTags,
        },
      });
    }

    const abilities = Array.from(abilityMap.values()).sort((a, b) =>
      getAbilityLabel(a.id).localeCompare(getAbilityLabel(b.id))
    );

    return {
      name: selectedCharacterName,
      description: baseDescription,
      tier: isDynamic ? 'unique' : selectedCharacter.info.tier,
      archetypeName,
      runTraitSummary,
      characterClass: selectedCharacter.info.characterClass,
      previewId,
      isDynamic,
      stats: {
        maxHealth: finalMaxHealth,
        damageRange: finalDamageRange,
        attackSpeedMs: finalAttackSpeed,
        attackRange,
        weaponType,
        projectileSpeed,
        movementSpeed,
      },
      formatted: {
        hp: `${finalMaxHealth}`,
        damage:
          finalDamageRange.min === finalDamageRange.max
            ? `${finalDamageRange.min}`
            : `${finalDamageRange.min}-${finalDamageRange.max}`,
        attackSpeed: formatAttacksPerSecond(finalAttackSpeed),
      },
      wearables,
      abilities,
      weapons,
    } satisfies HeroDetails;
  } catch {
    return null;
  }
}

export interface LobbyProps {
  // Character state
  selectedCharacterId: string | null;
  isCharacterHydrated: boolean;
  onCharacterSelect: (characterId: string) => void;
  onUnlockCharacter: (characterId: string) => Promise<void>;
  unlockedCharacters: string[];

  // Region state
  selectedRegionId: string;
  onRegionSelect: (regionId: string) => void;

  // Difficulty state
  selectedDifficultyTier: string;
  onDifficultySelect: (tier: string) => void;
  onUnlockDifficulty: (tier: string) => Promise<void>;

  // Wallet state
  isWalletConnected: boolean;
  ctaLabel?: string;
  ctaDisabled?: boolean;
  ctaDisabledReason?: string | null;
  joinInfo?: {
    roomId: string;
    regionName?: string;
    playerCount?: number;
    maxPlayers?: number;
  } | null;
  isDifficultyLocked?: boolean;
  isRegionLocked?: boolean;

  // Game state
  isStarting: boolean;
  gameStarted: boolean;
  error: string | null;
  onStartGame: () => void;
  onError: (error: string | null) => void;
  onStartTreasureRoom?: () => void;

  // Inventory for difficulty selector
  unlockedTiers: string[];
  lickTongueCount: number;

  // Credits system
  creditsBalance: number;
  creditsRequired: number;
  hasSufficientCredits: boolean;
  onCreditTopUp: (amount?: number) => void | Promise<void>;
  creditTopUpAmount?: number;

  // Progression
  progressionProfile: ProgressionProfile;
  onAdjustStats?: () => void;
}

export function Lobby({
  selectedCharacterId,
  unlockedCharacters,
  isCharacterHydrated,
  onCharacterSelect,
  onUnlockCharacter,
  selectedRegionId,
  onRegionSelect,
  selectedDifficultyTier,
  onDifficultySelect,
  onUnlockDifficulty,
  isWalletConnected,
  ctaLabel,
  ctaDisabled,
  ctaDisabledReason,
  joinInfo,
  isDifficultyLocked,
  isRegionLocked,
  isStarting,
  gameStarted,
  error,
  onStartGame,
  onError,
  unlockedTiers,
  lickTongueCount,
  creditsBalance,
  creditsRequired,
  hasSufficientCredits,
  onCreditTopUp,
  creditTopUpAmount = 100,
  progressionProfile,
  onAdjustStats,
}: LobbyProps) {
  const router = useRouter();
  const { hasValidSession, playerId } = useSession();
  const { isAuthorized } = usePlayer();
  const regionServerUrl = getServerUrlForRegion(selectedRegionId);
  const { state: equipmentState, refresh: refreshEquipment } = useEquipment(
    hasValidSession ? playerId : null
  );
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);
  const [characterTab, setCharacterTab] = useState<'characters' | 'gotchis'>(
    'characters'
  );
  const [difficultyDialogOpen, setDifficultyDialogOpen] = useState(false);
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);

  const selectorPanelRef = useRef<HTMLDivElement>(null);
  const characterRowRef = useRef<HTMLDivElement>(null);
  const difficultyRowRef = useRef<HTMLButtonElement>(null);
  const regionSelectorRef = useRef<RegionSelectorRef>(null);

  const regionSelectable = !isRegionLocked;
  const difficultySelectable = !isDifficultyLocked;

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );
  const scoreFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    []
  );

  const formattedCreditsBalance = numberFormatter.format(creditsBalance);
  const formattedCreditsRequired = numberFormatter.format(creditsRequired);
  const formattedTopUpAmount = numberFormatter.format(creditTopUpAmount);
  const allocatedStats = progressionProfile.stats;
  const progressionModifiers = useMemo(
    () => computeProgressionModifiers(allocatedStats),
    [
      allocatedStats.energy,
      allocatedStats.aggression,
      allocatedStats.spookiness,
      allocatedStats.brainSize,
    ]
  );
  const unspentPoints = Math.max(0, progressionProfile.unspentPoints);

  // Ensure equipment state reflects the currently selected hero
  useEffect(() => {
    if (!hasValidSession || !playerId) return;
    // Refresh whenever selection changes so server resolves equipment for that hero
    void refreshEquipment();
  }, [selectedCharacterId, hasValidSession, playerId, refreshEquipment]);

  const equippedOverridesForSelected = useMemo(() => {
    if (!equipmentState) return undefined;
    if (equipmentState.characterId !== selectedCharacterId) return undefined;
    return equipmentState.equippedWearablesWithQuality;
  }, [equipmentState, selectedCharacterId]);

  // Build svgId -> itemTypeId lookup once for gotchi equipment
  const svgIdToItemTypeId = useMemo(() => {
    const map = new Map<number, number>();
    try {
      Object.entries(itemTypes).forEach(([idStr, def]) => {
        const idNum = Number(idStr);
        if ((def as any) && Number.isFinite((def as any).svgId)) {
          map.set((def as any).svgId, idNum);
        }
      });
    } catch {}
    return map;
  }, []);

  // Load gotchi equipment so we can render wearables in the summary row
  const { byId: gotchiEquipById } = useGotchiEquipment(isWalletConnected);
  const { entries: gotchiEntries } = useGotchiSprites(
    isWalletConnected,
    regionServerUrl
  );

  const finalCtaLabel = useMemo(() => {
    if (isStarting) return 'Connecting...';
    if (ctaLabel && ctaLabel !== 'Play Now') return ctaLabel;
    return `Start Game — ${formattedCreditsRequired} credit${creditsRequired === 1 ? '' : 's'}`;
  }, [isStarting, ctaLabel, formattedCreditsRequired, creditsRequired]);

  const buttonDisabled = isStarting || ctaDisabled || !hasSufficientCredits;

  const handleTopUpClick = useCallback(() => {
    onCreditTopUp(creditTopUpAmount);
  }, [onCreditTopUp, creditTopUpAmount]);

  const handlePrimaryClick = useCallback(() => {
    onStartGame();
  }, [onStartGame]);

  // Daily quest preview (threshold based on yesterday's high score)
  const [dailyQuestLoading, setDailyQuestLoading] = useState(false);
  const [dailyQuestInfo, setDailyQuestInfo] = useState<{
    thresholdScore: number;
    referenceScore: number;
    remainingAttunements: number | null;
  } | null>(null);

  useEffect(() => {
    if (!hasValidSession || !selectedDifficultyTier || !regionServerUrl) {
      setDailyQuestInfo(null);
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      setDailyQuestLoading(true);
      try {
        const url = new URL('/api/daily-runs/preview', regionServerUrl);
        url.searchParams.set('difficultyId', selectedDifficultyTier);
        const resp = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!resp.ok) {
          setDailyQuestInfo(null);
          return;
        }
        const data = await resp.json();
        const thresholdScore = Math.max(
          0,
          Math.floor(Number(data?.thresholdScore) || 0)
        );
        const referenceScore = Math.max(
          0,
          Math.floor(Number(data?.referenceScore) || 0)
        );
        const rawRemaining = Number((data as any)?.remainingAttunements);
        const remainingAttunements =
          Number.isFinite(rawRemaining) && rawRemaining >= 0
            ? Math.floor(rawRemaining)
            : null;
        setDailyQuestInfo({
          thresholdScore,
          referenceScore,
          remainingAttunements,
        });
      } catch (error) {
        if ((error as any)?.name !== 'AbortError') {
          setDailyQuestInfo(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setDailyQuestLoading(false);
        }
      }
    };

    run();

    return () => controller.abort();
  }, [hasValidSession, selectedDifficultyTier, regionServerUrl]);

  const hasDailyQuestAttunement =
    dailyQuestInfo && typeof dailyQuestInfo.remainingAttunements === 'number'
      ? dailyQuestInfo.remainingAttunements > 0
      : null;

  // Bridge handler to satisfy CharacterSelector's async signature while
  // preserving Lobby's simpler prop type for onCharacterSelect
  const handleCharacterSelect = useCallback(
    async (
      characterId: string,
      _options?: { gotchiSpriteUrl?: string | null | undefined }
    ): Promise<void> => {
      await Promise.resolve(onCharacterSelect(characterId));
    },
    [onCharacterSelect]
  );

  const selectedCharacterName = useMemo(() => {
    if (!selectedCharacterId) return 'hero';
    try {
      const isDynamic = selectedCharacterId.startsWith('gotchi:');
      if (isDynamic) {
        const idPart = selectedCharacterId.split(':')[1];
        const idNum = parseInt(idPart || '0', 10);
        const rec = Number.isFinite(idNum) ? gotchiEquipById[idNum] : undefined;
        const name = rec?.name?.trim();
        return name && name.length > 0
          ? name
          : idPart
            ? `Gotchi #${idPart}`
            : 'Gotchi';
      }
      const selectedCharacter =
        CHARACTERS.find((c) => c.id === selectedCharacterId) || CHARACTERS[0];
      return selectedCharacter?.info.name ?? 'hero';
    } catch {
      return 'hero';
    }
  }, [selectedCharacterId]);

  const selectedHeroDetails = useMemo<HeroDetails | null>(
    () =>
      buildHeroDetails({
        isCharacterHydrated,
        selectedCharacterId,
        selectedCharacterName,
        progressionModifiers,
        svgIdToItemTypeId,
        gotchiEquipById,
        equippedWearablesWithQuality: equippedOverridesForSelected,
      }),
    [
      isCharacterHydrated,
      selectedCharacterId,
      selectedCharacterName,
      progressionModifiers,
      svgIdToItemTypeId,
      gotchiEquipById,
      equippedOverridesForSelected,
    ]
  );

  return (
    <SplashBackground>
      {/* Header - thinner, merged */}
      <div className="mt-3 mb-2 max-w-md w-full mx-auto px-2">
        <div className="text-white/90 text-center">
          <h1 className="text-3xl md:text-4xl font-hud font-black">
            DeFi Dungeon
          </h1>
          <div className="mt-1 flex items-center justify-center gap-3 text-xs text-gray-300">
            <WalletConnectControl />
            <span className="font-hud font-black">v0.2</span>
          </div>
        </div>
        {/* Loot preview strip */}
        <div className="backdrop-blur rounded-xl">
          <LootPreviewStrip />
        </div>
        {allocatedStats && (
          <div className="mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-2 text-xs text-gray-300 whitespace-nowrap">
                  <Trophy /> <span>LVL {progressionProfile.level}</span>
                </div>
                <div className="rounded-md px-3 py-1.5 flex items-center gap-3 text-xs whitespace-nowrap bg-white/10 backdrop-blur">
                  <div className="flex items-center gap-1">
                    <span>⚡</span>
                    <span className="font-semibold text-white">
                      {allocatedStats.energy}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span>🗡️</span>
                    <span className="font-semibold text-white">
                      {allocatedStats.aggression}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span>❤️</span>
                    <span className="font-semibold text-white">
                      {allocatedStats.spookiness}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span>🧠</span>
                    <span className="font-semibold text-white">
                      {allocatedStats.brainSize}
                    </span>
                  </div>
                </div>
              </div>
              {typeof onAdjustStats === 'function' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onAdjustStats()}
                >
                  {unspentPoints > 0 ? `Spend (${unspentPoints})` : 'Adjust'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-6 max-w-md w-full mx-auto">
        {joinInfo && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-gray-200 backdrop-blur">
            <div className="flex items-center justify-between">
              <span className="text-white font-semibold">
                Joining room {joinInfo.roomId}
              </span>
              {typeof joinInfo.playerCount === 'number' &&
                typeof joinInfo.maxPlayers === 'number' && (
                  <span className="text-xs text-gray-400">
                    {joinInfo.playerCount}/{joinInfo.maxPlayers} players
                  </span>
                )}
            </div>
            {joinInfo.regionName && (
              <div className="text-[11px] text-gray-400 mt-2">
                Region: {joinInfo.regionName}
              </div>
            )}
          </div>
        )}

        {/* Main Panel - Character Selection */}
        <div
          className="rounded-xl bg-white/5 p-2 backdrop-blur"
          aria-labelledby="hero-heading"
        >
          {/* Accessible section label (visually hidden) */}
          <h2 id="hero-heading" className="sr-only">
            Hero
          </h2>
          {/* Character Selection */}
          <div>
            <div
              ref={characterRowRef}
              className={cn(
                'relative rounded-lg p-2',
                isAuthorized
                  ? 'cursor-pointer transition-all duration-200 hover:bg-white/10'
                  : 'cursor-default',
                characterDialogOpen && 'ring-2 ring-purple-500/50'
              )}
              onClick={(e) => {
                e.stopPropagation();
                if (!isAuthorized) {
                  return;
                }
                // Don't toggle if clicking on a button or dialog
                const target = e.target as HTMLElement;
                if (
                  target.closest('button') ||
                  target.closest('[role="dialog"]')
                ) {
                  return;
                }
                setCharacterDialogOpen(true);
              }}
            >
              {isCharacterHydrated ? (
                selectedHeroDetails ? (
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="grid gap-2 items-start flex-1 min-w-0"
                      style={{
                        gridTemplateColumns: `${selectedHeroDetails.isDynamic ? 80 : 64}px 1fr`,
                      }}
                    >
                      <div className="relative rounded-lg grid place-items-center shrink-0">
                        <CharacterPreview
                          characterId={selectedHeroDetails.previewId}
                          size="sm"
                          isSelected={true}
                          className="flex-shrink-0"
                          allocatedStats={progressionProfile.stats}
                        />
                      </div>
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <h4 className="text-base font-semibold text-gray-100 truncate">
                              {selectedCharacterName}
                            </h4>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-gray-200">
                          <span>HP {selectedHeroDetails.formatted.hp}</span>
                          <span className="text-gray-500">•</span>
                          <span>
                            ATK {selectedHeroDetails.formatted.damage}
                          </span>
                          <span className="text-gray-500">•</span>
                          <span>
                            AS {selectedHeroDetails.formatted.attackSpeed}
                          </span>
                        </div>

                        {/* Wearable + weapon loadout row */}
                        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                          {selectedHeroDetails.weapons &&
                            selectedHeroDetails.weapons
                              .slice(0, 2)
                              .map((wep) => {
                                const iconSrc = resolveWeaponIconFor(wep);
                                return (
                                  <div
                                    key={`weapon-${wep.id}`}
                                    className="h-5 w-5 rounded bg-white/10 grid place-items-center shrink-0"
                                  >
                                    {iconSrc ? (
                                      <img
                                        src={iconSrc}
                                        alt={wep.name}
                                        className="h-4 w-4 object-contain"
                                      />
                                    ) : (
                                      <span className="text-[7px] text-white/70">
                                        WPN
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                          {selectedHeroDetails.wearables &&
                            selectedHeroDetails.wearables
                              .slice(0, 6)
                              .map((w) => {
                                const iconSrc = resolveWearableIconFor(w);
                                return (
                                  <div
                                    key={w.id}
                                    className="h-5 w-5 rounded bg-white/10 grid place-items-center shrink-0"
                                  >
                                    {iconSrc ? (
                                      <img
                                        src={iconSrc}
                                        alt={w.slug}
                                        className="h-4 w-4 object-contain"
                                      />
                                    ) : (
                                      <span className="text-[7px] text-white/70">
                                        {w.slug}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center shrink-0">
                      <div
                        className={cn(
                          'transition-transform duration-200 text-gray-400 text-xs',
                          characterDialogOpen ? 'rotate-90' : 'rotate-0'
                        )}
                      >
                        ▶
                      </div>
                    </div>
                  </div>
                ) : selectedCharacterId ? (
                  <div className="text-xs text-gray-400">
                    Loading hero details...
                  </div>
                ) : (
                  <div className="text-center">
                    {isAuthorized ? (
                      <Button
                        type="button"
                        className="w-full rounded-none bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_12px_35px_rgba(99,102,241,0.35)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCharacterDialogOpen(true);
                        }}
                        aria-label="Select hero"
                      >
                        Select a Hero
                      </Button>
                    ) : (
                      <ApplyForAlpha />
                    )}
                  </div>
                )
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <div className="w-10 h-10 bg-white/20 rounded-full animate-pulse flex-shrink-0" />
                    <div className="space-y-1.5">
                      <div className="h-3 bg-white/20 rounded animate-pulse w-20" />
                      <div className="h-2.5 bg-white/20 rounded animate-pulse w-16" />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="h-4 bg-white/20 rounded animate-pulse w-12" />
                    <div className="w-2.5 h-2.5 bg-white/20 rounded animate-pulse" />
                  </div>
                </div>
              )}
            </div>
            {selectedCharacterId && selectedHeroDetails ? (
              <div className="mt-1.5 flex gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{
                        type: 'spring',
                        stiffness: 400,
                        damping: 25,
                      }}
                      className="flex-1 text-xs bg-transparent border border-white/30 text-white hover:bg-white/10 backdrop-blur py-1.5 rounded-md transition-colors"
                      aria-label="View stats"
                    >
                      View Stats
                    </motion.button>
                  </DialogTrigger>
                  <HeroDetailsView
                    details={selectedHeroDetails}
                    allocatedStats={progressionProfile.stats}
                  />
                </Dialog>
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{
                    type: 'spring',
                    stiffness: 400,
                    damping: 25,
                  }}
                  onClick={() => router.push('/me/inventory')}
                  className="flex-1 text-xs bg-transparent border border-white/30 text-white hover:bg-white/10 backdrop-blur py-1.5 rounded-md transition-colors"
                  aria-label="Change gear"
                >
                  Change Gear
                </motion.button>
              </div>
            ) : null}
          </div>
        </div>

        {/* Credits & Start Game Card - Grouped */}
        {selectedCharacterId ? (
          <div className="mt-3 rounded-xl bg-gradient-to-br from-white/10 via-white/5 to-white/5 border border-white/20 p-3 backdrop-blur shadow-lg">
            {/* Primary CTA - Start Game Button - Most Prominent */}
            <Button
              className={cn(
                'w-full relative overflow-hidden mb-3',
                'bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600',
                'hover:from-purple-500 hover:via-indigo-500 hover:to-blue-500',
                'px-6 py-5 md:py-4',
                'text-lg md:text-base font-black text-white',
                'shadow-[0_8px_32px_rgba(99,102,241,0.4)] hover:shadow-[0_12px_40px_rgba(99,102,241,0.5)]',
                'border-2 border-purple-400/50',
                'transition-all duration-200',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-[0_8px_32px_rgba(99,102,241,0.4)]',
                'active:scale-[0.98]'
              )}
              onClick={handlePrimaryClick}
              disabled={buttonDisabled}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-xl">⚔️</span>
                <span>{finalCtaLabel}</span>
              </span>
              {!buttonDisabled && (
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{
                    x: ['-100%', '100%'],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    repeatDelay: 1,
                    ease: 'linear',
                  }}
                />
              )}
            </Button>

            {/* Daily Quest callout */}
            {hasDailyQuestAttunement !== false && (
              <div className="mb-2 rounded-lg border border-indigo-400/30 bg-indigo-900/20 px-3 py-2 flex items-center gap-2 text-[12px] text-indigo-100">
                <Trophy className="w-4 h-4 text-amber-300" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-indigo-100/80">
                    {dailyQuestLoading
                      ? 'Daily Quest: loading score...'
                      : dailyQuestInfo
                        ? `Daily Quest: Complete a run with score higher than ${scoreFormatter.format(dailyQuestInfo.thresholdScore)}. Talk to Nyx.`
                        : 'Daily Quest: target score unavailable. Talk to Nyx.'}
                  </span>
                </div>
              </div>
            )}

            {/* Credits Info Section */}
            <div className="border-t border-white/10 pt-3">
              {/* Main Balance Row - Compact */}
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl md:text-3xl font-black text-white tabular-nums leading-none">
                      {formattedCreditsBalance}
                    </span>
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Credits
                    </span>
                  </div>
                </div>
                {hasSufficientCredits ? (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/30 border border-green-400/40">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-300"></div>
                    <span className="text-[10px] font-bold text-green-200 uppercase tracking-wide">
                      Ready
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/30 border border-yellow-400/40">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-300"></div>
                    <span className="text-[10px] font-bold text-yellow-200 uppercase tracking-wide">
                      Low
                    </span>
                  </div>
                )}
              </div>

              {/* Cost Breakdown - Inline Compact with Difficulty/Region */}
              <div className="flex items-center justify-between gap-2 mb-2 px-1 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] text-gray-400">Cost:</span>
                    <span className="text-sm font-bold text-white tabular-nums">
                      {formattedCreditsRequired}
                    </span>
                  </div>
                  <div className="text-gray-600 text-xs">→</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[10px] text-gray-400">
                      Remaining:
                    </span>
                    <span
                      className={cn(
                        'text-sm font-bold tabular-nums',
                        creditsBalance - creditsRequired >= 0
                          ? 'text-green-300'
                          : 'text-red-300'
                      )}
                    >
                      {numberFormatter.format(
                        Math.max(0, creditsBalance - creditsRequired)
                      )}
                    </span>
                  </div>
                </div>
                {/* Difficulty & Region - Inline */}
                <div className="flex items-center gap-1">
                  {/* Difficulty pill */}
                  {(() => {
                    const selectedDifficulty = getDifficultyTier(
                      selectedDifficultyTier
                    );
                    if (!selectedDifficulty) return null;

                    const getTierIcon = (tierId: string) => {
                      if (tierId.startsWith('normal')) return '⚡';
                      if (tierId.startsWith('nightmare')) return '👁️';
                      if (tierId.startsWith('hell')) return '🔥';
                      if (tierId === 'beyond_hell') return '💀';
                      return '⚡';
                    };

                    const getTierColorClass = (tierId: string) => {
                      if (tierId.startsWith('normal')) return 'text-green-400';
                      if (tierId.startsWith('nightmare'))
                        return 'text-purple-400';
                      if (tierId.startsWith('hell')) return 'text-red-400';
                      if (tierId === 'beyond_hell') return 'text-yellow-400';
                      return 'text-gray-400';
                    };

                    return (
                      <button
                        ref={difficultyRowRef}
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] transition-colors rounded',
                          'bg-white/5 border border-white/10',
                          difficultySelectable
                            ? 'text-gray-200 hover:text-white hover:bg-white/10'
                            : 'text-gray-400 cursor-not-allowed'
                        )}
                        onClick={(e) => {
                          if (!difficultySelectable) return;
                          e.stopPropagation();
                          setDifficultyDialogOpen(true);
                        }}
                        aria-label="Change difficulty"
                      >
                        <span
                          className={cn(
                            'text-[10px]',
                            getTierColorClass(selectedDifficulty.id)
                          )}
                        >
                          {getTierIcon(selectedDifficulty.id)}
                        </span>
                        <span className="truncate max-w-[3.5rem]">
                          {selectedDifficulty.name}
                        </span>
                      </button>
                    );
                  })()}

                  {/* Region pill */}
                  {(() => {
                    const selectedRegion =
                      SERVER_REGIONS.find((r) => r.id === selectedRegionId) ||
                      SERVER_REGIONS[0];
                    return (
                      <button
                        type="button"
                        className={cn(
                          'inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] transition-colors rounded',
                          'bg-white/5 border border-white/10',
                          regionSelectable
                            ? 'text-gray-200 hover:text-white hover:bg-white/10'
                            : 'text-gray-400 cursor-not-allowed'
                        )}
                        onClick={(e) => {
                          if (!regionSelectable) return;
                          e.stopPropagation();
                          setRegionDialogOpen(true);
                        }}
                        aria-label="Change region"
                      >
                        <span
                          className="text-[10px]"
                          role="img"
                          aria-label={selectedRegion.location}
                        >
                          {selectedRegion.flag}
                        </span>
                        <span className="truncate max-w-[3rem]">
                          {selectedRegion.name}
                        </span>
                      </button>
                    );
                  })()}
                </div>
              </div>

              {/* Add Credits Button - Smaller, Secondary */}
              <Dialog>
                <DialogTrigger asChild>
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{
                      type: 'spring',
                      stiffness: 400,
                      damping: 25,
                    }}
                    className="w-full rounded-md font-medium transition-all text-xs py-2 px-3 bg-white/10 border border-white/20 text-white hover:bg-white/15"
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <span>➕</span>
                      <span>Add Credits</span>
                    </span>
                  </motion.button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="!text-2xl">
                      Top Up Credits
                    </DialogTitle>
                    <DialogDescription>
                      Add credits by locking tokens for 30 days. All funds are
                      auto-deposited into Aave to generate interest for weekly
                      rewards.
                    </DialogDescription>
                  </DialogHeader>
                  <TopupForm />
                </DialogContent>
              </Dialog>

              {/* Info Text - Compact */}
              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400">
                <Info className="w-3 h-3 shrink-0" />
                <span>Deducted after dungeon entry</span>
              </div>
            </div>

            {/* Status Messages */}
            {ctaDisabledReason && (
              <div className="mt-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-[11px] text-yellow-200 text-center">
                  {ctaDisabledReason}
                </p>
              </div>
            )}
            {error && (
              <div className="mt-2 p-2.5 bg-red-500/20 border border-red-500/30 rounded-lg backdrop-blur">
                <p className="text-red-300 text-xs mb-1.5">{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onError(null)}
                  className="h-7 text-red-300 hover:text-red-200 text-xs px-2"
                >
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {/* Bottom bar removed - CTA now lives in the Match card */}

        {/* Character Dialog */}
        <Dialog
          open={characterDialogOpen}
          onOpenChange={setCharacterDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose your Hero</DialogTitle>
              <DialogDescription className="text-sm text-gray-300 grid grid-cols-[1fr_2fr_1fr] items-center gap-2">
                <div className="flex items-center gap-2">
                  Balance:{' '}
                  <span className="font-semibold text-white">
                    👅 {lickTongueCount}
                  </span>
                </div>
                <div className="flex justify-center">
                  <div className="inline-flex rounded-full bg-black/40 p-1 border border-white/10 backdrop-blur">
                    <button
                      aria-pressed={characterTab === 'characters'}
                      className={cn(
                        'px-2 py-0.5 text-xs rounded-full transition-colors',
                        characterTab === 'characters'
                          ? 'bg-purple-600/30 text-white border border-purple-500/30'
                          : 'text-gray-300 hover:text-white'
                      )}
                      onClick={() => setCharacterTab('characters')}
                    >
                      Heroes
                    </button>
                    <button
                      aria-pressed={characterTab === 'gotchis'}
                      className={cn(
                        'ml-1 px-2 py-0.5 text-xs rounded-full transition-colors',
                        characterTab === 'gotchis'
                          ? 'bg-purple-600/30 text-white border border-purple-500/30'
                          : 'text-gray-300 hover:text-white'
                      )}
                      onClick={() => setCharacterTab('gotchis')}
                    >
                      {`Gotchis${isWalletConnected ? ` (${gotchiEntries.length})` : ''}`}
                    </button>
                  </div>
                </div>
                <div></div>
              </DialogDescription>
            </DialogHeader>
            <CharacterSelector
              selectedCharacterId={selectedCharacterId}
              unlockedCharacters={unlockedCharacters}
              lickTongueCount={lickTongueCount}
              onCharacterSelect={async (characterId, options) => {
                await handleCharacterSelect(characterId, options);
                setCharacterDialogOpen(false);
              }}
              onUnlockCharacter={onUnlockCharacter}
              isHydrated={isCharacterHydrated}
              progressionProfile={progressionProfile}
              activeTab={characterTab}
              onTabChange={setCharacterTab}
              serverBaseUrl={regionServerUrl}
            />
          </DialogContent>
        </Dialog>

        {/* Difficulty Dialog */}
        <Dialog
          open={difficultyDialogOpen}
          onOpenChange={setDifficultyDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Select Difficulty</DialogTitle>
              <DialogDescription className="text-sm text-gray-300">
                Balance:{' '}
                <span className="font-semibold text-white">
                  👅 {lickTongueCount}
                </span>
              </DialogDescription>
            </DialogHeader>
            <DifficultySelector
              selectedTier={selectedDifficultyTier}
              unlockedTiers={unlockedTiers}
              lickTongueCount={lickTongueCount}
              onTierSelect={(tierId) => {
                onDifficultySelect(tierId);
                setDifficultyDialogOpen(false);
              }}
              onUnlock={onUnlockDifficulty}
            />
          </DialogContent>
        </Dialog>

        {/* Region Dialog */}
        <Dialog open={regionDialogOpen} onOpenChange={setRegionDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Select Server Region
              </DialogTitle>
              <DialogDescription className="text-sm text-gray-300 flex items-center gap-2 flex-wrap">
                Select the region closest to your location for the best gaming
                experience.
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regionSelectorRef.current?.checkAllPings()}
                  className="text-xs h-6 px-2"
                >
                  <Wifi className="w-3 h-3 mr-1" />
                  Check Ping
                </Button>
              </DialogDescription>
            </DialogHeader>
            <RegionSelector
              ref={regionSelectorRef}
              selectedRegion={selectedRegionId}
              onRegionSelect={(regionId) => {
                onRegionSelect(regionId);
                setRegionDialogOpen(false);
              }}
              regions={SERVER_REGIONS}
            />
          </DialogContent>
        </Dialog>
      </div>
    </SplashBackground>
  );
}
