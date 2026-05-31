import type { PlayerSchema, EnemySchema } from '../schemas';
import type { GameRoom } from '../rooms/GameRoom';
import type {
  SpellDefinition,
  PlayerSpellState,
  FreezeEffect,
  BounceEffect,
} from '../types/spells';
import { SPELLS, SPELLS_BY_ID } from '../data/spells';
import { WEAPON_DEFINITIONS } from '../data/weapons';
import { getWearableBySlug, normalizeWearableSlug } from '../data/wearables';
import { applyMovementSlow } from './systems/StatusSystem';
import type { AggregatedSlow } from './ability-utils';
import { applyPlayerLifeSteal } from './ability-handlers';
import {
  applyAuraDamageMitigation,
  shouldEnemyEvadeAttack,
} from './systems/EnemySystem';
import { computeBaseDamageForCharacter } from './combat-utils';
import { ensureServerBroadcaster } from './messaging';

// Runtime scheduled spell follow-up task
interface ScheduledSpellBounceTask {
  at: number;
  kind: 'spell_bounce';
  playerId: string;
  fromId: string;
  toId: string;
  hopIndex: number;
  damage: number;
  spellId: string;
  weaponType: 'melee' | 'ranged';
  appliesOnHitEffects?: boolean;
}

type SpellRuntimeState = PlayerSpellState & {
  lastCastAtBySpellId: Record<string, number>;
};

const SPELL_RUNTIME_KEY = '__spellRuntimeState';

const DEFAULT_FREEZE_EFFECT: Omit<AggregatedSlow, 'sourceKey'> = {
  amount: 0.25,
  durationMs: 2000,
  chance: 1,
  appliesTo: 'all',
  stacking: 'strongest',
};

interface ParsedDerivedStats {
  activeWeaponSlug?: string;
  weapons?: Array<Record<string, unknown>>;
  [key: string]: any;
}

interface ManualSpellCastInput {
  spellId: string;
  targetId?: string;
}

export interface ManualSpellCastResult {
  ok: boolean;
  reason?: string;
}

export interface OnHitSpellContext {
  targetId: string;
  target: EnemySchema;
  damageDealt: number;
  baseDamage: number;
  weaponType: 'melee' | 'ranged';
  derivedStats?: ParsedDerivedStats | null;
  activeWeaponSlug?: string;
  skipSpellIds?: Set<string>;
}

interface SpellOnHitProcessingResult {
  bonusDamagePreMit: number;
  afterDamageCallbacks: Array<
    (actualDamage: number, totalBaseDamagePreMit: number) => void
  >;
}

function parseDerivedStats(player: PlayerSchema): ParsedDerivedStats | null {
  try {
    const parsed = JSON.parse(player.derivedStats || '{}');
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Ignore JSON parse errors, return null
  }
  return null;
}

function ensureSpellRuntimeState(player: PlayerSchema): SpellRuntimeState {
  const bag = (player as any)[SPELL_RUNTIME_KEY] as
    | SpellRuntimeState
    | undefined;
  if (bag) {
    return bag;
  }
  const created: SpellRuntimeState = {
    autocastEnabledBySpellId: {},
    cooldownUntilBySpellId: {},
    lastCastAtBySpellId: {},
  };
  (player as any)[SPELL_RUNTIME_KEY] = created;
  return created;
}

function getActiveWeaponSlug(
  derived: ParsedDerivedStats | null,
  player: PlayerSchema
): string | undefined {
  const raw =
    typeof derived?.activeWeaponSlug === 'string'
      ? derived.activeWeaponSlug
      : undefined;
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }
  try {
    const activeWeaponSlug = (derived?.activeWeapon as { slug?: string })?.slug;
    if (typeof activeWeaponSlug === 'string' && activeWeaponSlug.trim()) {
      return activeWeaponSlug.trim();
    }
  } catch {
    // Ignore errors reading active weapon slug
  }
  const stored = (player as any).activeWeaponSlug;
  if (typeof stored === 'string' && stored.trim().length > 0) {
    return stored.trim();
  }
  return undefined;
}

function getWeaponCategoryForSlug(
  slug: string | undefined
): string | undefined {
  if (!slug) return undefined;
  const trimmed = slug.trim();

  // First try direct lookup with original slug
  let definition = WEAPON_DEFINITIONS[trimmed];
  if (definition && typeof definition.weaponCategory === 'string') {
    return definition.weaponCategory;
  }

  // Try normalized slug (in case quality prefix was needed for lookup)
  const normalized = normalizeWearableSlug(trimmed);
  if (normalized !== trimmed) {
    definition = WEAPON_DEFINITIONS[normalized];
    if (definition && typeof definition.weaponCategory === 'string') {
      return definition.weaponCategory;
    }
  }

  // Fallback to wearable lookup (which handles normalization internally)
  const wearable = getWearableBySlug(trimmed);
  const category = wearable?.weapon?.weaponCategory;
  if (typeof category === 'string' && category.length > 0) {
    return category;
  }

  return undefined;
}

function getWeaponCategoryForPlayer(
  player: PlayerSchema,
  derived: ParsedDerivedStats | null
): string | undefined {
  const slug = getActiveWeaponSlug(derived, player);
  const category = getWeaponCategoryForSlug(slug);
  if (category) {
    return category;
  }
  const weapons = Array.isArray(derived?.weapons) ? derived?.weapons : [];
  const firstWeapon = weapons?.[0] as { slug?: string } | undefined;
  if (firstWeapon && typeof firstWeapon.slug === 'string') {
    return getWeaponCategoryForSlug(firstWeapon.slug);
  }
  return undefined;
}

function isSpellAllowedForCategory(
  spell: SpellDefinition,
  weaponCategory: string | undefined
): boolean {
  if (!spell.allowedWeaponTypes || spell.allowedWeaponTypes.length === 0) {
    return true;
  }
  if (!weaponCategory) return false;
  return spell.allowedWeaponTypes.includes(weaponCategory);
}

function initializeAutocastDefault(
  state: SpellRuntimeState,
  spell: SpellDefinition
) {
  if (state.autocastEnabledBySpellId[spell.id] === undefined) {
    state.autocastEnabledBySpellId[spell.id] =
      spell.autocastEnabledByDefault ?? false;
  }
}

function isOnCooldown(
  state: SpellRuntimeState,
  spellId: string,
  now: number
): boolean {
  const until = state.cooldownUntilBySpellId[spellId];
  return typeof until === 'number' && until > now;
}

function startCooldown(
  state: SpellRuntimeState,
  spell: SpellDefinition,
  now: number
) {
  if (typeof spell.cooldownMs === 'number' && spell.cooldownMs > 0) {
    state.cooldownUntilBySpellId[spell.id] = now + spell.cooldownMs;
  }
  state.lastCastAtBySpellId[spell.id] = now;
}

function hasSufficientMana(player: PlayerSchema, cost: number): boolean {
  if (!Number.isFinite(player.mana)) return false;
  return Math.floor(player.mana) >= cost;
}

function spendMana(player: PlayerSchema, cost: number) {
  const next = Math.max(0, Math.floor((player.mana || 0) - cost));
  player.mana = next;
}

function broadcastSpellProc(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  data?: Record<string, unknown>
) {
  try {
    const broadcaster = ensureServerBroadcaster(gameRoom as any);
    broadcaster.broadcast('spell_proc', {
      playerId: player.id,
      spellId: spell.id,
      ...(data || {}),
    });
  } catch {
    // Ignore broadcast errors
  }
}

function broadcastChainHit(
  gameRoom: GameRoom,
  player: PlayerSchema,
  payload: { fromId: string; toId: string; hopIndex: number }
) {
  try {
    const broadcaster = ensureServerBroadcaster(gameRoom as any);
    broadcaster.broadcast('chain_hit', {
      playerId: player.id,
      ...payload,
    });
  } catch {
    // Ignore broadcast errors
  }
}

function applyFreezeEffect(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  target: EnemySchema
): boolean {
  if (!target || target.hp <= 0) return false;
  const now = (gameRoom as any).now ?? Date.now();
  const slow: AggregatedSlow = {
    ...DEFAULT_FREEZE_EFFECT,
    sourceKey: `spell:${spell.id}:${player.id}`,
  };
  const result = applyMovementSlow(target, slow, now);
  if (result.applied && !result.hadActiveBefore && result.hasActiveAfter) {
    const broadcaster = ensureServerBroadcaster(gameRoom as any);
    broadcaster.broadcast('status_applied', {
      targetId: target.id,
      type: 'slow',
      amount: slow.amount,
      durationMs: slow.durationMs,
    });
  }
  return result.applied;
}

function getSpellBonusDamage(spell: SpellDefinition): number {
  let value = 0;
  switch (spell.effects.kind) {
    case 'freeze':
      value = Number(spell.damage ?? 0);
      break;
    case 'bounce':
      value = Number(spell.damage ?? 0);
      break;
    default:
      value = 0;
  }
  if (!Number.isFinite(value) || value <= 0) {
    const fallback = Number(spell.damage ?? 0);
    if (Number.isFinite(fallback) && fallback > 0) {
      value = fallback;
    }
  }
  return Number.isFinite(value) && value > 0
    ? Math.max(0, Math.round(value))
    : 0;
}

function applySpellBonusDamage(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  ctx: OnHitSpellContext,
  targetId: string,
  target: EnemySchema,
  options: { allowEvade?: boolean } = {}
) {
  const bonusDamage = getSpellBonusDamage(spell);
  if (bonusDamage <= 0) return;
  applySpellDamageToEnemy(
    gameRoom,
    player,
    targetId,
    target,
    bonusDamage,
    ctx.weaponType,
    ctx.derivedStats ?? null,
    ctx.activeWeaponSlug,
    { source: spell.id, allowEvade: options.allowEvade }
  );
}

function hasLineOfSight(
  gameRoom: GameRoom,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): boolean {
  if (typeof (gameRoom as any).hasLineOfSight === 'function') {
    try {
      return (gameRoom as any).hasLineOfSight(fromX, fromY, toX, toY);
    } catch {
      return true;
    }
  }
  return true;
}

function findNextBounceTarget(
  gameRoom: GameRoom,
  origin: EnemySchema,
  visited: Set<string>,
  radius: number,
  allowRepeat: boolean
): { enemy: EnemySchema; id: string } | null {
  let best: { enemy: EnemySchema; id: string; distance: number } | null = null;
  for (const [enemyId, enemy] of gameRoom.state.enemies) {
    if (!enemy || enemy.hp <= 0) continue;
    if (!allowRepeat && visited.has(enemyId)) continue;
    if (enemyId === origin.id) continue;
    const dx = enemy.x - origin.x;
    const dy = enemy.y - origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) continue;
    if (!hasLineOfSight(gameRoom, origin.x, origin.y, enemy.x, enemy.y)) {
      continue;
    }
    if (!best || dist < best.distance) {
      best = { enemy, id: enemyId, distance: dist };
    }
  }
  return best ? { enemy: best.enemy, id: best.id } : null;
}

function applySpellDamageToEnemy(
  gameRoom: GameRoom,
  player: PlayerSchema,
  enemyId: string,
  enemy: EnemySchema,
  rawDamage: number,
  weaponType: 'melee' | 'ranged',
  derivedStats: ParsedDerivedStats | null,
  activeWeaponSlug: string | undefined,
  options?: { source?: string; allowEvade?: boolean }
): number {
  if (!enemy || enemy.hp <= 0) return 0;
  const broadcaster = ensureServerBroadcaster(gameRoom as any);
  const allowEvade = options?.allowEvade !== false;
  const now = (gameRoom as any).now ?? Date.now();
  if (allowEvade && shouldEnemyEvadeAttack(enemy, weaponType, now)) {
    gameRoom.setEnemyAggro(enemyId, player.id);
    broadcaster.broadcast('attack_evaded', {
      attackerId: player.id,
      targetId: enemyId,
      timestamp: now,
      weaponType,
    });
    return 0;
  }

  // Be robust to mocks returning undefined/NaN in tests; fall back to raw
  const rawRounded = Math.max(0, Math.round(rawDamage));
  const mitigatedAttempt = applyAuraDamageMitigation(enemy, rawRounded) as any;
  const mitigatedDamage = Number.isFinite(Number(mitigatedAttempt))
    ? Number(mitigatedAttempt)
    : rawRounded;
  const prevHp = enemy.hp;
  enemy.hp = Math.max(0, enemy.hp - mitigatedDamage);
  const actualDealt = Math.max(0, prevHp - enemy.hp);
  if (actualDealt <= 0) {
    return 0;
  }

  gameRoom.handleRoomLeverageEngagement('combat');

  if (activeWeaponSlug) {
    (enemy as any).lastHitWeaponSlug = activeWeaponSlug;
  } else {
    delete (enemy as any).lastHitWeaponSlug;
  }

  gameRoom.setEnemyAggro(enemyId, player.id);
  broadcaster.broadcast('damage_applied', {
    attackerId: player.id,
    targetId: enemyId,
    timestamp: now,
    damage: mitigatedDamage,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    weaponType,
    isCrit: false,
    killed: enemy.hp <= 0,
  });

  if (enemy.hp <= 0) {
    void gameRoom.handleEnemyDeath(enemy, enemyId, weaponType, player.id);
  } else {
    enemy.anim = 'hurt';
    enemy.nextMoveTime = Math.max(enemy.nextMoveTime, now + 300);
  }

  if (derivedStats && activeWeaponSlug) {
    applyPlayerLifeSteal(
      gameRoom,
      player,
      actualDealt,
      weaponType,
      activeWeaponSlug,
      derivedStats
    );
  }

  return actualDealt;
}

export function processScheduledSpellFollowups(
  gameRoom: GameRoom,
  now: number
) {
  try {
    const state: any = gameRoom.state as any;
    const queue = state._scheduledSpellFollowups as
      | ScheduledSpellBounceTask[]
      | undefined;
    if (!Array.isArray(queue) || queue.length === 0) return;
    const remaining: ScheduledSpellBounceTask[] = [];
    for (const task of queue) {
      if (!task || task.kind !== 'spell_bounce') continue;
      if (now < task.at) {
        remaining.push(task);
        continue;
      }

      const target = gameRoom.state.enemies.get(task.toId);
      if (!target || target.hp <= 0) {
        continue;
      }
      const player = gameRoom.state.players.get(task.playerId);
      if (!player || player.hp <= 0) {
        continue;
      }

      const derivedStats = parseDerivedStats(player);
      const activeWeaponSlug = getActiveWeaponSlug(derivedStats, player);

      const actualDealt = applySpellDamageToEnemy(
        gameRoom,
        player,
        task.toId,
        target,
        task.damage,
        task.weaponType,
        derivedStats,
        activeWeaponSlug,
        { source: task.spellId, allowEvade: false }
      );

      try {
        // eslint-disable-next-line no-console
        console.log(
          `[spell] bounce_execute hop=${task.hopIndex} to=${task.toId} dmg=${task.damage} actual=${actualDealt}`
        );
      } catch {
        // Ignore console.log errors
      }

      broadcastChainHit(gameRoom, player, {
        fromId: task.fromId,
        toId: task.toId,
        hopIndex: task.hopIndex,
      });

      if (task.appliesOnHitEffects && actualDealt > 0) {
        handleOnHitSpells(gameRoom, player, {
          targetId: task.toId,
          target,
          damageDealt: actualDealt,
          baseDamage: task.damage,
          weaponType: task.weaponType,
          derivedStats,
          activeWeaponSlug,
          skipSpellIds: new Set([task.spellId]),
        });
      }
    }
    state._scheduledSpellFollowups = remaining;
  } catch {
    // Ignore errors processing scheduled followups
  }
}

function executeBounceEffect(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  effect: BounceEffect,
  ctx: OnHitSpellContext
) {
  // Require actual damage dealt on the initial hit; do not seed from baseDamage
  if (ctx.damageDealt <= 0) return;
  let baseDamage = ctx.damageDealt;
  const bonusDamage = getSpellBonusDamage(spell);
  if (bonusDamage > 0) {
    baseDamage += bonusDamage;
  }
  if (baseDamage <= 0) return;

  const visited = new Set<string>();
  visited.add(ctx.targetId);
  let previousEnemy = ctx.target;
  let previousId = ctx.targetId;
  const now = Date.now();

  for (let hop = 1; hop < effect.maxTargets; hop += 1) {
    const next = findNextBounceTarget(
      gameRoom,
      previousEnemy,
      visited,
      effect.radius,
      effect.allowRepeat
    );
    if (!next) {
      break;
    }

    visited.add(next.id);
    const multiplier = Math.max(0, 1 - effect.falloffPerHop * hop);
    const hopDamage = Math.max(0, Math.round(baseDamage * multiplier));
    if (hopDamage <= 0) {
      break;
    }

    {
      try {
        const stateAny: any = gameRoom.state as any;
        if (!Array.isArray(stateAny._scheduledSpellFollowups)) {
          stateAny._scheduledSpellFollowups = [];
        }
        const task: ScheduledSpellBounceTask = {
          at: now + Math.max(0, hop * effect.travelMs),
          kind: 'spell_bounce',
          playerId: player.id,
          fromId: previousId,
          toId: next.id,
          hopIndex: hop,
          damage: hopDamage,
          spellId: spell.id,
          weaponType: ctx.weaponType,
          appliesOnHitEffects: Boolean(effect.appliesOnHitEffects),
        };
        stateAny._scheduledSpellFollowups.push(task);
      } catch {
        // Ignore errors scheduling spell followup
      }
    }

    previousEnemy = next.enemy;
    previousId = next.id;
  }
}

function resolveSpellEffect(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  ctx: OnHitSpellContext
) {
  switch (spell.effects.kind) {
    case 'freeze':
      if (applyFreezeEffect(gameRoom, player, spell, ctx.target)) {
        applySpellBonusDamage(
          gameRoom,
          player,
          spell,
          ctx,
          ctx.targetId,
          ctx.target,
          { allowEvade: true }
        );
      }
      break;
    case 'bounce':
      executeBounceEffect(gameRoom, player, spell, spell.effects, ctx);
      break;
    default:
      break;
  }
}

function getEligibleSpellsForPlayer(
  player: PlayerSchema,
  derivedStats: ParsedDerivedStats | null,
  weaponCategory: string | undefined
): SpellDefinition[] {
  return SPELLS.filter((spell) => {
    if (spell.enabled === false) return false;
    return isSpellAllowedForCategory(spell, weaponCategory);
  });
}

function attemptSpellCast(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  ctx: OnHitSpellContext,
  state: SpellRuntimeState,
  now: number
) {
  initializeAutocastDefault(state, spell);
  const isAutocast = Boolean(state.autocastEnabledBySpellId[spell.id]);
  if (!isAutocast) {
    try {
      // eslint-disable-next-line no-console
      console.log(`[spell] skip ${spell.id} autocast=off`);
    } catch {
      // Ignore console.log errors
    }
    return;
  }
  if (!hasSufficientMana(player, spell.manaCost)) {
    try {
      // eslint-disable-next-line no-console
      console.log(
        `[spell] skip ${spell.id} mana_insufficient cost=${spell.manaCost} mana=${player.mana}`
      );
    } catch {
      // Ignore console.log errors
    }
    return;
  }
  if (isOnCooldown(state, spell.id, now)) {
    try {
      // eslint-disable-next-line no-console
      console.log(
        `[spell] skip ${spell.id} on_cooldown until=${state.cooldownUntilBySpellId[spell.id]} now=${now}`
      );
    } catch {
      // Ignore console.log errors
    }
    return;
  }

  spendMana(player, spell.manaCost);
  // If mana hits zero, attempt to auto-consume a mana potion on server
  try {
    if (
      player.mana <= 0 &&
      typeof (gameRoom as any).tryAutoRestoreMana === 'function'
    ) {
      (gameRoom as any).tryAutoRestoreMana(player);
    }
  } catch {
    // Ignore errors in auto-restore mana
  }
  startCooldown(state, spell, now);
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[spell] cast ${spell.id} autocast=true target=${ctx.targetId}`
    );
  } catch {
    // Ignore console.log errors
  }
  broadcastSpellProc(gameRoom, player, spell, {
    autocast: true,
    targetId: ctx.targetId,
  });
  resolveSpellEffect(gameRoom, player, spell, ctx);
}

export function handleOnHitSpells(
  gameRoom: GameRoom,
  player: PlayerSchema,
  ctx: OnHitSpellContext
) {
  if (!player || player.hp <= 0) return;
  if (!ctx || !ctx.target) return;

  const now = (gameRoom as any).now ?? Date.now();
  const derivedStats =
    ctx.derivedStats !== undefined
      ? ctx.derivedStats
      : parseDerivedStats(player);
  const weaponCategory = getWeaponCategoryForPlayer(player, derivedStats);
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[spell] on_hit target=${ctx.targetId} dmg=${ctx.damageDealt} weaponType=${ctx.weaponType} category=${weaponCategory}`
    );
  } catch {
    // Ignore console.log errors
  }
  const eligible = getEligibleSpellsForPlayer(
    player,
    derivedStats,
    weaponCategory
  );
  try {
    // eslint-disable-next-line no-console
    console.log(
      `[spell] eligible ${eligible.map((s) => s.id).join(',') || 'none'}`
    );
  } catch {
    // Ignore console.log errors
  }
  if (!eligible.length) return;

  const runtime = ensureSpellRuntimeState(player);

  for (const spell of eligible) {
    if (ctx.skipSpellIds && ctx.skipSpellIds.has(spell.id)) {
      continue;
    }
    attemptSpellCast(gameRoom, player, spell, ctx, runtime, now);
  }
}

function resolveManualSpell(
  gameRoom: GameRoom,
  player: PlayerSchema,
  spell: SpellDefinition,
  targetId: string,
  derivedStats: ParsedDerivedStats | null,
  weaponType: 'melee' | 'ranged',
  runtime: SpellRuntimeState,
  now: number
): ManualSpellCastResult {
  const enemy = gameRoom.state.enemies.get(targetId);
  if (!enemy) {
    return { ok: false, reason: 'target_not_found' };
  }
  if (!hasSufficientMana(player, spell.manaCost)) {
    return { ok: false, reason: 'insufficient_mana' };
  }
  if (isOnCooldown(runtime, spell.id, now)) {
    return { ok: false, reason: 'on_cooldown' };
  }

  spendMana(player, spell.manaCost);
  // If mana hits zero, attempt to auto-consume a mana potion on server
  try {
    if (
      player.mana <= 0 &&
      typeof (gameRoom as any).tryAutoRestoreMana === 'function'
    ) {
      (gameRoom as any).tryAutoRestoreMana(player);
    }
  } catch {
    // Ignore errors in auto-restore mana
  }
  startCooldown(runtime, spell, now);
  broadcastSpellProc(gameRoom, player, spell, {
    autocast: false,
    targetId,
  });

  const activeWeaponSlug = getActiveWeaponSlug(derivedStats, player);

  let baseDamage =
    weaponType === 'melee' || weaponType === 'ranged'
      ? computeBaseDamageForCharacter(
          player.characterId,
          weaponType === 'melee' ? 10 : 8,
          derivedStats
        )
      : 0;
  const manualBonus = getSpellBonusDamage(spell);
  if (manualBonus > 0) {
    baseDamage += manualBonus;
  }

  let damageDealt = 0;
  if (baseDamage > 0 && spell.effects.kind === 'bounce') {
    damageDealt = applySpellDamageToEnemy(
      gameRoom,
      player,
      targetId,
      enemy,
      baseDamage,
      weaponType,
      derivedStats,
      activeWeaponSlug,
      { source: spell.id, allowEvade: true }
    );
  }

  const context: OnHitSpellContext = {
    targetId,
    target: enemy,
    damageDealt,
    baseDamage,
    weaponType,
    derivedStats,
    activeWeaponSlug,
  };
  resolveSpellEffect(gameRoom, player, spell, context);
  return { ok: true };
}

export function handleManualSpellCast(
  gameRoom: GameRoom,
  player: PlayerSchema,
  input: ManualSpellCastInput
): ManualSpellCastResult {
  if (!player || player.hp <= 0) {
    return { ok: false, reason: 'player_dead' };
  }
  const spell = SPELLS_BY_ID[input.spellId];
  if (!spell || spell.enabled === false) {
    return { ok: false, reason: 'spell_disabled' };
  }
  const derivedStats = parseDerivedStats(player);
  const weaponCategory = getWeaponCategoryForPlayer(player, derivedStats);
  if (!isSpellAllowedForCategory(spell, weaponCategory)) {
    return { ok: false, reason: 'weapon_not_allowed' };
  }

  const runtime = ensureSpellRuntimeState(player);
  const weaponType =
    player.attackType === 'ranged' || spell.effects.kind === 'bounce'
      ? 'ranged'
      : 'melee';

  let targetId = input.targetId;
  if (!targetId || !gameRoom.state.enemies.has(targetId)) {
    const candidate = player.actionTarget;
    if (candidate && gameRoom.state.enemies.has(candidate)) {
      targetId = candidate;
    }
  }
  if (!targetId) {
    return { ok: false, reason: 'no_target' };
  }
  return resolveManualSpell(
    gameRoom,
    player,
    spell,
    targetId,
    derivedStats,
    weaponType,
    runtime,
    (gameRoom as any).now ?? Date.now()
  );
}

export function setSpellAutocast(
  player: PlayerSchema,
  spellId: string,
  enabled: boolean
) {
  const runtime = ensureSpellRuntimeState(player);
  runtime.autocastEnabledBySpellId[spellId] = enabled;
}

export function getSpellAutocast(
  player: PlayerSchema,
  spellId: string
): boolean {
  const runtime = ensureSpellRuntimeState(player);
  initializeAutocastDefault(runtime, SPELLS_BY_ID[spellId]);
  return Boolean(runtime.autocastEnabledBySpellId[spellId]);
}


