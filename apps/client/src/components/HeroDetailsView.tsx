'use client';

import { useMemo } from 'react';
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import { CharacterPreview } from './CharacterPreview';
import type { WearableDefinition, WearableSlot } from '../data/wearables';
import {
  EQUIPMENT_STAT_LABELS,
  STAT,
  STAT_CONFIG,
  ITEM_TYPE_EFFECTS,
  isWeaponWearable,
  getWearableRarity,
  type EquipmentStatModifier,
} from '../data/wearables';

export interface AbilityEntry {
  id: string;
  params?: Record<string, unknown> | null;
}

export interface HeroWeaponSummary {
  id: number;
  svgId?: number;
  name: string;
  weaponType: string;
  attackSpeed?: number | null;
  damageRange?: { min: number; max: number } | null;
  // grenade?: { damageCenter: number; damageEdge: number } | null;
}

export interface HeroDetails {
  name: string;
  description?: string;
  tier?: string;
  archetypeName?: string | null;
  runTraitSummary?: string | null;
  characterClass?: string;
  previewId: string;
  isDynamic: boolean;
  stats: {
    maxHealth: number;
    damageRange: { min: number; max: number };
    attackSpeedMs: number;
    attackRange: number | null;
    weaponType?: string;
    projectileSpeed?: number | null;
    movementSpeed?: number | null;
    hpRegenRate?: number | null;
  };
  formatted: {
    hp: string;
    damage: string;
    attackSpeed: string;
  };
  wearables: WearableDefinition[];
  abilities: AbilityEntry[];
  weapons: HeroWeaponSummary[];
}

function getPrimarySlot(wearable: WearableDefinition): WearableSlot {
  const slots = Array.isArray(wearable.slots) ? wearable.slots : [];
  for (const slot of slots) {
    if (slot !== 'none') {
      return slot;
    }
  }
  return 'none';
}

const ABILITY_LABELS: Record<string, string> = {
  'life-steal': 'Lifesteal',
  'critical-strike': 'Critical Strike',
  cleave: 'Cleave',
  'tongue-farm': 'Tongue Farm',
  'potion-farm': 'Potion Farm',
  'healing-splash': 'Healing Splash',
};

export function getAbilityLabel(id: string): string {
  return (
    ABILITY_LABELS[id] ||
    id
      .split('-')
      .map((segment) =>
        segment ? segment[0].toUpperCase() + segment.slice(1) : segment
      )
      .join(' ')
  );
}

function formatPercent(
  value: number | undefined,
  nf?: Intl.NumberFormat
): string {
  if (!Number.isFinite(value as number)) return '';
  const percent = (value as number) * 100;
  return `${nf ? nf.format(percent) : percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function getNumberParam(
  params: Record<string, unknown> | null | undefined,
  key: string
): number | undefined {
  const value = params?.[key];
  return typeof value === 'number' ? value : undefined;
}

function getStringParam(
  params: Record<string, unknown> | null | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function getAbilityDetails(
  id: string,
  params?: Record<string, unknown> | null,
  nf?: Intl.NumberFormat
): string {
  if (id === 'life-steal') {
    const percent = getNumberParam(params, 'percent');
    const appliesTo = getStringParam(params, 'appliesTo') || 'melee';
    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      return 'Convert a portion of damage to healing';
    }
    const percentText = formatPercent(percent, nf);
    return `${percentText} lifesteal${appliesTo !== 'all' ? ` on ${appliesTo} hits` : ''}`;
  }
  if (id === 'critical-strike') {
    const chance = getNumberParam(params, 'chance');
    const multiplier = getNumberParam(params, 'multiplier');
    const appliesTo = getStringParam(params, 'appliesTo') || 'all';
    const chanceText =
      typeof chance === 'number' && Number.isFinite(chance)
        ? `${formatPercent(chance, nf)} chance`
        : 'Chance';
    const multText =
      typeof multiplier === 'number' && Number.isFinite(multiplier)
        ? `${multiplier}x damage`
        : 'increased damage';
    return `${chanceText} to crit for ${multText}${appliesTo !== 'all' ? ` (${appliesTo})` : ''}`;
  }
  if (id === 'cleave') {
    const maxTargets = getNumberParam(params, 'maxTargets');
    const damageMultiplier = getNumberParam(params, 'damageMultiplier') ?? 1;
    const coneAngleDeg = getNumberParam(params, 'coneAngleDeg');
    const parts: string[] = [];
    if (
      typeof maxTargets === 'number' &&
      Number.isFinite(maxTargets) &&
      maxTargets > 0
    ) {
      parts.push(`hit up to ${Math.round(maxTargets)} targets`);
    }
    const damagePercent = damageMultiplier * 100;
    parts.push(
      `${damagePercent % 1 === 0 ? damagePercent.toFixed(0) : damagePercent.toFixed(2)}% damage`
    );
    if (typeof coneAngleDeg === 'number' && Number.isFinite(coneAngleDeg)) {
      parts.push(`in ${Math.round(coneAngleDeg)}° cone`);
    }
    return parts.join(' ');
  }
  if (id === 'healing-splash') {
    const healAmount = getNumberParam(params, 'healAmount');
    const radius = getNumberParam(params, 'radius');
    const cooldown = getNumberParam(params, 'cooldownMs');
    const pieces: string[] = [];
    if (typeof healAmount === 'number' && Number.isFinite(healAmount)) {
      pieces.push(`${Math.round(healAmount)} HP splash`);
    }
    if (typeof radius === 'number' && Number.isFinite(radius)) {
      pieces.push(`within ${Math.round(radius)}px`);
    }
    if (typeof cooldown === 'number' && Number.isFinite(cooldown)) {
      const seconds = cooldown / 1000;
      pieces.push(
        `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s cooldown`
      );
    }
    return pieces.join(' • ');
  }
  if (id === 'evade') {
    const chance = getNumberParam(params, 'chance');
    return typeof chance === 'number' && Number.isFinite(chance)
      ? `${formatPercent(chance, nf)} chance to dodge incoming hits`
      : 'Chance to dodge incoming hits';
  }
  if (id === 'tongue-farm') {
    const bonus = getNumberParam(params, 'bonusChance');
    const rawTags = params?.appliesToEnemyTags;
    const tags = Array.isArray(rawTags)
      ? rawTags.filter(
          (tag): tag is string => typeof tag === 'string' && tag.length > 0
        )
      : undefined;
    const tagLabel =
      tags && tags.length > 0
        ? `${tags
            .map((tag) =>
              tag
                .split(/[-_]/)
                .map((segment) =>
                  segment
                    ? segment[0].toUpperCase() + segment.slice(1)
                    : segment
                )
                .join(' ')
            )
            .join(', ')} enemies`
        : 'eligible enemies';

    if (typeof bonus === 'number' && Number.isFinite(bonus)) {
      const formatted = formatPercent(Math.abs(bonus), nf);
      const sign = bonus >= 0 ? '+' : '-';
      return `${sign}${formatted} Lick Tongue drop chance from ${tagLabel}`;
    }

    return `Increases Lick Tongue drop chance from ${tagLabel}`;
  }
  if (id === 'potion-farm') {
    const mode = getStringParam(params, 'mode') || 'both';
    const multiplier = getNumberParam(params, 'potionWeightMultiplier');
    const extraChance = getNumberParam(params, 'extraPotionRollChance');
    const bias = getNumberParam(params, 'hpToManaBias');
    const parts: string[] = [];

    if (mode === 'reweight' || mode === 'both') {
      if (
        typeof multiplier === 'number' &&
        Number.isFinite(multiplier) &&
        multiplier > 0
      ) {
        const multText =
          multiplier % 1 === 0
            ? `${multiplier.toFixed(0)}x`
            : `${multiplier.toFixed(2)}x`;
        parts.push(`${multText} potion drop weight when loot appears`);
      } else {
        parts.push('Increases potion drop weight when loot appears');
      }
    }

    if (mode === 'extra-roll' || mode === 'both') {
      if (
        typeof extraChance === 'number' &&
        Number.isFinite(extraChance) &&
        extraChance > 0
      ) {
        parts.push(
          `${formatPercent(extraChance, nf)} chance to conjure a potion if nothing drops`
        );
      } else {
        parts.push('Chance to conjure a potion if nothing drops');
      }
    }

    if (typeof bias === 'number' && Number.isFinite(bias)) {
      const clamped = Math.min(1, Math.max(0, bias));
      const hpPercent = Math.round(clamped * 100);
      const manaPercent = 100 - hpPercent;
      parts.push(`${hpPercent}% HP / ${manaPercent}% Mana split`);
    }

    if (parts.length === 0) {
      parts.push('Increases potion drop chances');
    }

    return parts.join('. ');
  }
  return '';
}

export function formatAttacksPerSecond(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-/s';
  const aps = 1000 / ms;
  return `${aps % 1 === 0 ? aps : aps.toFixed(2)}/s`;
}

// Lightweight copies of the inventory wearable summary helpers so that
// hero details use the same concise breakdown formatting.
function formatModifier(mod: {
  stat: keyof typeof STAT;
  value: number;
  operation?: 'add' | 'mul' | 'add_percent';
}): string {
  const op = mod.operation ?? 'add';
  let label = EQUIPMENT_STAT_LABELS[
    mod.stat as keyof typeof EQUIPMENT_STAT_LABELS
  ] as string;
  // Abbreviate for compact UI
  label = label.replace(/Health/g, 'HP').replace(/Damage/g, 'DMG');
  // Remove leading percent symbol in label to avoid duplicates like "% % DMG"
  let normalizedLabel = label.replace(/^%\s*/, '');
  if (mod.stat === STAT.armor) {
    normalizedLabel = 'Armor';
  }
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  if (op === 'mul') {
    const pct = Math.round((mod.value - 1) * 100);
    return `${pct >= 0 ? '+' : ''}${pct}% ${normalizedLabel}`;
  }
  const cfg = (STAT_CONFIG as Record<string, { isPercent?: boolean }>)[
    mod.stat
  ];
  if (op === 'add_percent' || cfg?.isPercent) {
    const pct = Math.round(mod.value * 100);
    return `${pct >= 0 ? '+' : ''}${pct}% ${normalizedLabel}`;
  }
  // add (flat)
  const value =
    Math.abs(mod.value) % 1 === 0
      ? Math.trunc(mod.value)
      : Number(mod.value.toFixed(2));
  return `${sign(value)} ${normalizedLabel}`;
}

function summarizeWearable(
  wearable: WearableDefinition | undefined
): string | null {
  if (!wearable) return null;
  const qualityScalar = 1; // No quality in hero details; use base values
  const parts: string[] = [];

  // Weapon quick summary
  if (isWeaponWearable(wearable) && wearable.weapon) {
    const w = wearable.weapon as any;
    if (w?.grenade) {
      const g = w.grenade as any;
      const edge =
        typeof g?.damageEdge === 'number'
          ? Math.max(0, Math.round(g.damageEdge * qualityScalar))
          : 0;
      const center =
        typeof g?.damageCenter === 'number'
          ? Math.max(0, Math.round(g.damageCenter * qualityScalar))
          : edge;
      const min = Math.min(edge, center);
      const max = Math.max(edge, center);
      if (min > 0 || max > 0) {
        parts.push(`DMG ${min}-${max}`);
      }
      if (typeof g?.cooldownMs === 'number') {
        parts.push(`Cooldown ${g.cooldownMs} ms`);
      }
    } else {
      if (w?.damageRange) {
        const min = Math.round(w.damageRange.min * qualityScalar);
        const max = Math.round(w.damageRange.max * qualityScalar);
        parts.push(`DMG ${min}-${max}`);
      } else if (typeof w?.damage === 'number') {
        parts.push(`DMG ${Math.round(w.damage * qualityScalar)}`);
      }
      if (typeof w?.attackSpeed === 'number') {
        parts.push(`Attack Speed ${w.attackSpeed} ms`);
      }
    }
  }

  // Effects (stat modifiers) – prefer explicit wearable effects; otherwise fall back
  // to base type effects by rarity.
  const resolvedEffects = (() => {
    if (
      Array.isArray((wearable as any).effects) &&
      (wearable as any).effects.length > 0
    ) {
      return (wearable as any).effects;
    }
    const slot = getPrimarySlot(
      wearable as WearableDefinition
    ) as keyof typeof ITEM_TYPE_EFFECTS;
    const itemType = (wearable as any).itemType as string | undefined;
    if (!itemType) return [] as any[];
    const rarity = getWearableRarity(wearable as any);
    const bySlot = (ITEM_TYPE_EFFECTS as any)[slot] as
      | Record<string, Record<string, unknown>>
      | undefined;
    const byType = bySlot?.[itemType] as
      | Record<string, { type: 'stat'; modifiers: any[] }[]>
      | undefined;
    const effects = byType?.[rarity] || byType?.common || [];
    return Array.isArray(effects) ? effects : [];
  })();

  for (const effect of resolvedEffects) {
    if (!effect || effect.type !== 'stat') continue;
    const modifiers = Array.isArray(effect.modifiers) ? effect.modifiers : [];
    for (const mod of modifiers) {
      try {
        const scaled: EquipmentStatModifier = {
          ...(mod as EquipmentStatModifier),
        };
        // scalar is 1, so no value change; still normalize via formatter
        parts.push(formatModifier(scaled as any));
      } catch {
        // ignore formatting issues
      }
      if (parts.length >= 3) break; // keep concise
    }
    if (parts.length >= 3) break;
  }

  // Abilities (unchanged by quality for now)
  if ((wearable as any).abilities && (wearable as any).abilities.length) {
    for (const ability of (wearable as any).abilities) {
      const id = ability.id;
      const p: any = ability.params ?? {};
      if (id === 'evade' && typeof p.chance === 'number') {
        parts.push(`Evade ${Math.round(p.chance * 100)}%`);
      } else if (id === 'regen' && typeof p.perSecond === 'number') {
        parts.push(`Regen ${p.perSecond}/s`);
      } else if (
        id === 'augmented-vision' &&
        typeof p.multiplier === 'number'
      ) {
        parts.push(`Vision +${Math.round((p.multiplier - 1) * 100)}%`);
      } else if (id === 'damage-reduction') {
        if (typeof p.armor === 'number') {
          parts.push(`Armor +${Math.round(p.armor)}`);
        } else if (typeof p.percent === 'number') {
          parts.push(`Armor +${Math.round(p.percent * 100)}`);
        }
      } else if (id === 'attack-speed' && typeof p.multiplier === 'number') {
        parts.push(`Atk Spd +${Math.round((p.multiplier - 1) * 100)}%`);
      } else if (id === 'move-speed' && typeof p.multiplier === 'number') {
        parts.push(`Move +${Math.round((p.multiplier - 1) * 100)}%`);
      } else if (
        id === 'damage-multiplier' &&
        typeof p.multiplier === 'number'
      ) {
        parts.push(`DMG +${Math.round((p.multiplier - 1) * 100)}%`);
      } else if (id === 'critical-strike' && typeof p.chance === 'number') {
        parts.push(`Crit ${Math.round(p.chance * 100)}% x${p.multiplier ?? 2}`);
      } else if (id === 'tongue-farm' && typeof p.bonusChance === 'number') {
        parts.push(`Tongue +${Math.round(p.bonusChance * 100)}%`);
      }
      if (parts.length >= 3) break;
    }
  }

  if (parts.length === 0) return null;
  return parts.slice(0, 3).join(' • ');
}

interface HeroDetailsViewProps {
  details: HeroDetails;
  allocatedStats: {
    energy: number;
    aggression: number;
    spookiness: number;
    brainSize: number;
  };
}

export function HeroDetailsView({
  details,
  allocatedStats,
}: HeroDetailsViewProps) {
  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    []
  );

  const displayAbilities = details.abilities.map((entry) => ({
    id: entry.id,
    label: getAbilityLabel(entry.id),
    details: getAbilityDetails(entry.id, entry.params, numberFormatter),
  }));

  return (
    <DialogContent
      className="max-w-md border-white/10 bg-slate-950/95 text-gray-100"
      style={{ top: '50%', bottom: 'auto' }}
    >
      <DialogHeader className="flex-row items-center gap-3">
        <CharacterPreview
          characterId={details.previewId}
          size="sm"
          isSelected={true}
          className="flex-shrink-0"
          allocatedStats={allocatedStats}
        />
        <div className="flex-1 min-w-0">
          <DialogTitle className="text-lg text-white">
            {details.name}
          </DialogTitle>
          {details.archetypeName && (
            <DialogDescription className="text-xs text-gray-300 mt-0.5">
              {details.archetypeName}
            </DialogDescription>
          )}
        </div>
      </DialogHeader>
      <div className="space-y-5 text-sm">
        {details.characterClass && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">
              Class
            </div>
            <div className="text-white font-medium">
              {details.characterClass}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Stats
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <div>
              <div className="text-[11px] uppercase text-gray-500">Health</div>
              <div className="text-white font-semibold">
                {details.stats.maxHealth.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-500">Damage</div>
              <div className="text-white font-semibold">
                {details.formatted.damage}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-500">
                Attack Speed
              </div>
              <div className="text-white font-semibold">
                {details.formatted.attackSpeed}{' '}
                <span className="text-[11px] text-gray-400">
                  ({details.stats.attackSpeedMs}ms)
                </span>
              </div>
            </div>

            {details.stats.attackRange && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-gray-500">
                  Attack Range
                </div>
                <div className="text-white font-medium">
                  {details.stats.attackRange}px
                </div>
              </div>
            )}

            <div>
              <div className="text-[11px] uppercase text-gray-500">
                Movement Speed
              </div>
              <div className="text-white font-semibold">
                {details.stats.movementSpeed
                  ? details.stats.movementSpeed.toFixed(2)
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-gray-500">
                Projectile Speed
              </div>
              <div className="text-white font-semibold">
                {details.stats.projectileSpeed
                  ? `${details.stats.projectileSpeed} px/s`
                  : '—'}
              </div>
            </div>
          </div>
        </div>

        {details.weapons.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Weapons
            </div>
            <ul className="mt-2 space-y-2 text-sm">
              {details.weapons.map((weapon) => (
                <li key={weapon.id} className="rounded-lg bg-white/5 p-2">
                  <div className="flex items-center gap-2">
                    {typeof weapon.svgId === 'number' && (
                      <img
                        src={`/wearables/${weapon.svgId}.svg`}
                        alt={weapon.name}
                        className="h-8 w-8 rounded bg-white/10 p-1"
                        loading="lazy"
                      />
                    )}
                    <div>
                      <div className="text-white font-semibold">
                        {weapon.name}
                      </div>
                      <div className="text-xs text-gray-400">
                        <span className="capitalize">{weapon.weaponType}</span>
                        {weapon.damageRange && (
                          <span className="ml-2">
                            {weapon.damageRange.min === weapon.damageRange.max
                              ? `${weapon.damageRange.min} dmg`
                              : `${weapon.damageRange.min}-${weapon.damageRange.max} dmg`}
                          </span>
                        )}
                        {/* {!weapon.damageRange && weapon.grenade && (
                          <span className="ml-2">
                            {Math.min(
                              weapon.grenade.damageEdge,
                              weapon.grenade.damageCenter
                            )}
                            -
                            {Math.max(
                              weapon.grenade.damageEdge,
                              weapon.grenade.damageCenter
                            )}{' '}
                            dmg
                          </span>
                        )} */}
                        {weapon.attackSpeed && (
                          <span className="ml-2">
                            {formatAttacksPerSecond(weapon.attackSpeed)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Abilities
          </div>
          {displayAbilities.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {displayAbilities.map((ability) => (
                <li key={ability.id} className="rounded bg-white/5 px-2 py-1">
                  <div className="text-white font-medium">{ability.label}</div>
                  {ability.details && (
                    <div className="text-[11px] text-gray-300">
                      {ability.details}
                    </div>
                  )}
                  {/* {ability.sources.length > 0 && (
                    <div className="text-[11px] text-gray-400">
                      {ability.sources.join(', ')}
                    </div>
                  )} */}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-gray-400">
              No abilities unlocked yet.
            </p>
          )}
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Wearables
          </div>
          {details.wearables.filter((w) => !(w as any).weapon).length > 0 ? (
            <ul className="mt-2 grid grid-cols-2 gap-2 text-xs">
              {details.wearables
                .filter((w) => !(w as any).weapon)
                .map((wearable) => (
                  <li
                    key={wearable.id}
                    className="flex items-center gap-2 rounded-lg bg-white/5 p-2"
                  >
                    <img
                      src={`/wearables/${wearable.svgId}.svg`}
                      alt={wearable.name}
                      className="h-8 w-8 rounded bg-white/10 p-1"
                      loading="lazy"
                    />
                    <div>
                      <div className="text-white font-medium">
                        {wearable.name}
                      </div>
                      {(() => {
                        const summary = summarizeWearable(wearable);
                        return (
                          <div className="text-[11px] text-gray-300">
                            {summary ?? getPrimarySlot(wearable)}
                          </div>
                        );
                      })()}
                    </div>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-gray-400">No wearables equipped.</p>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
