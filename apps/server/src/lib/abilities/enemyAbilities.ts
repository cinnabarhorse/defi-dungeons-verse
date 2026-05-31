import type { Room } from 'colyseus';
import type { EnemySchema, GameRoomState, PlayerSchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { ENEMY_TYPES } from '../../data/enemies';
import { checkObstacleCollision } from '../systems/MapCollisionSystem';
import type { GameRoomApi } from '../../types';
import { calculateDamageAfterMitigation } from '../player-stats';
import { getPlayerEvade, rollEvade } from '../ability-utils';
import { STAGING_INVULNERABILITY_MS } from '../constants';
import { ensureServerBroadcaster } from '../messaging';
import { isPlayerDevInvincible } from '../debug';
import type { BroadcastCapable, ServerBroadcaster } from '../messaging';
import { applyStunStatus, handlePlayerZeroHp } from '../systems/StatusSystem';

type EnemyAbilityId = 'bloodlust_charge';

export interface EnemyAbilityDefinition {
  id: EnemyAbilityId | string;
  params?: Record<string, any>;
}

interface BloodlustChargeParams {
  powerupMs?: number;
  recoveryMs?: number;
  cooldownMs?: number;
  chargeSpeed?: number;
  chargeDamageMultiplier?: number;
  incomingDamageMultiplier?: number;
  hitRadius?: number;
  maxDashMs?: number;
}

type BloodlustState = 'idle' | 'powerup' | 'charge';

interface BloodlustRuntime {
  state: BloodlustState;
  stateUntil: number;
  nextReadyAt: number;
  targetPlayerId: string;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  stuckFrames: number;
  hasHitDuringCharge: boolean;
}

interface BloodlustResolvedConfig {
  powerupMs: number;
  recoveryMs: number;
  cooldownMs: number;
  chargeSpeed: number;
  chargeDamageMultiplier: number;
  incomingDamageMultiplier: number;
  hitRadius: number;
  maxDashMs: number;
}

interface BossChargeStunAbilityConfig {
  durationMs: number;
  chance: number;
  bonusDamage: number;
}

const BLOODLUST_RUNTIME_KEY = '__bloodlustCharge';
const BLOODLUST_ABILITY_ID: EnemyAbilityId = 'bloodlust_charge';
const BOSS_CHARGE_STUN_ABILITY_ID = 'boss_charge_stun';
const BOSS_CHARGE_STUN_SOURCE_KEY = 'enemy:boss_charge:stun';

const DEFAULT_BLOODLUST_CONFIG: BloodlustResolvedConfig = {
  powerupMs: 2400,
  recoveryMs: 3000,
  cooldownMs: 9000,
  chargeSpeed: 11,
  chargeDamageMultiplier: 2,
  incomingDamageMultiplier: 2,
  hitRadius: 30,
  maxDashMs: 1400,
};

export function runEnemyAbilities(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  nearestPlayer: PlayerSchema | null,
  now: number
): boolean {
  const abilityDefs = getAbilityDefinitions(enemy);
  if (!abilityDefs.length) {
    return false;
  }

  for (const def of abilityDefs) {
    const abilityId = String(def?.id || '').trim();
    if (!abilityId) continue;

    if (abilityId === BLOODLUST_ABILITY_ID) {
      const handled = runBloodlustChargeAbility(
        room,
        enemy,
        nearestPlayer,
        now,
        (def?.params || {}) as BloodlustChargeParams
      );
      if (handled) {
        return true;
      }
      continue;
    }
  }

  return false;
}

function getAbilityDefinitions(enemy: EnemySchema): EnemyAbilityDefinition[] {
  const defsRaw = (enemy as unknown as { _abilityRefs?: unknown })._abilityRefs;
  if (!Array.isArray(defsRaw)) return [];
  return (defsRaw as EnemyAbilityDefinition[]).filter(
    (entry) => entry && typeof entry.id === 'string'
  );
}

function runBloodlustChargeAbility(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  nearestPlayer: PlayerSchema | null,
  now: number,
  params: BloodlustChargeParams
): boolean {
  const config = resolveBloodlustConfig(params);
  const runtime = getBloodlustRuntime(enemy, now, config);

  if (enemy.hp <= 0) {
    resetBloodlustState(enemy, runtime);
    return false;
  }

  switch (runtime.state) {
    case 'idle': {
      if (!nearestPlayer || nearestPlayer.hp <= 0) {
        runtime.nextReadyAt = Math.max(runtime.nextReadyAt, now + 200);
        setIncomingDamageMultiplier(enemy, 1);
        return false;
      }
      if (now < runtime.nextReadyAt) {
        setIncomingDamageMultiplier(enemy, 1);
        return false;
      }
      enterBloodlustPowerupPhase(
        room,
        enemy,
        runtime,
        config,
        nearestPlayer,
        now
      );
      return true;
    }
    case 'powerup': {
      maintainPowerupState(enemy, runtime, now);
      if (now >= runtime.stateUntil) {
        startBloodlustChargePhase(room, enemy, runtime, config, now);
      }
      return true;
    }
    case 'charge': {
      handleBloodlustChargePhase(room, enemy, runtime, config, now);
      const stateAfterCharge = runtime.state as BloodlustState;
      return stateAfterCharge !== 'idle';
    }
    default:
      resetBloodlustState(enemy, runtime);
      return false;
  }
}

function resolveBloodlustConfig(
  params: BloodlustChargeParams | undefined
): BloodlustResolvedConfig {
  return {
    powerupMs: toPositiveNumber(
      params?.powerupMs,
      DEFAULT_BLOODLUST_CONFIG.powerupMs
    ),
    recoveryMs: toPositiveNumber(
      params?.recoveryMs,
      DEFAULT_BLOODLUST_CONFIG.recoveryMs
    ),
    cooldownMs: toPositiveNumber(
      params?.cooldownMs,
      DEFAULT_BLOODLUST_CONFIG.cooldownMs
    ),
    chargeSpeed: toPositiveNumber(
      params?.chargeSpeed,
      DEFAULT_BLOODLUST_CONFIG.chargeSpeed
    ),
    chargeDamageMultiplier: toPositiveMultiplier(
      params?.chargeDamageMultiplier,
      DEFAULT_BLOODLUST_CONFIG.chargeDamageMultiplier
    ),
    incomingDamageMultiplier: toPositiveMultiplier(
      params?.incomingDamageMultiplier,
      DEFAULT_BLOODLUST_CONFIG.incomingDamageMultiplier
    ),
    hitRadius: toPositiveNumber(
      params?.hitRadius,
      DEFAULT_BLOODLUST_CONFIG.hitRadius
    ),
    maxDashMs: toPositiveNumber(
      params?.maxDashMs,
      DEFAULT_BLOODLUST_CONFIG.maxDashMs
    ),
  };
}

function getBloodlustRuntime(
  enemy: EnemySchema,
  now: number,
  config: BloodlustResolvedConfig
): BloodlustRuntime {
  const existing = (enemy as any)[BLOODLUST_RUNTIME_KEY] as
    | BloodlustRuntime
    | undefined;
  if (existing) {
    return existing;
  }
  const runtime: BloodlustRuntime = {
    state: 'idle',
    stateUntil: 0,
    nextReadyAt: now + config.cooldownMs,
    targetPlayerId: '',
    targetX: enemy.x,
    targetY: enemy.y,
    vx: 0,
    vy: 0,
    stuckFrames: 0,
    hasHitDuringCharge: false,
  };
  (enemy as any)[BLOODLUST_RUNTIME_KEY] = runtime;
  return runtime;
}

function resetBloodlustState(enemy: EnemySchema, runtime: BloodlustRuntime) {
  runtime.state = 'idle';
  runtime.stateUntil = 0;
  runtime.hasHitDuringCharge = false;
  runtime.vx = 0;
  runtime.vy = 0;
  runtime.targetPlayerId = '';
  runtime.stuckFrames = 0;
  setIncomingDamageMultiplier(enemy, 1);
}

function enterBloodlustPowerupPhase(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  runtime: BloodlustRuntime,
  config: BloodlustResolvedConfig,
  target: PlayerSchema,
  now: number
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  runtime.state = 'powerup';
  runtime.stateUntil = now + config.powerupMs;
  runtime.hasHitDuringCharge = false;
  runtime.stuckFrames = 0;
  runtime.vx = 0;
  runtime.vy = 0;
  runtime.targetPlayerId = target.id;
  runtime.targetX = target.x;
  runtime.targetY = target.y;

  enemy.isAttacking = false;
  enemy.anim = 'idle';
  enemy.animUntil = 0;
  enemy.targetPlayerId = target.id;
  enemy.targetX = enemy.x;
  enemy.targetY = enemy.y;
  enemy.nextMoveTime = now + config.powerupMs + 100;

  setIncomingDamageMultiplier(enemy, 1);

  broadcaster.broadcast('boss_special_state', {
    state: 'powerup',
    enemyId: enemy.id,
    durationMs: config.powerupMs,
    targetX: runtime.targetX,
    targetY: runtime.targetY,
  });
}

function maintainPowerupState(
  enemy: EnemySchema,
  runtime: BloodlustRuntime,
  now: number
) {
  enemy.anim = 'idle';
  enemy.isAttacking = false;
  enemy.targetX = enemy.x;
  enemy.targetY = enemy.y;
  enemy.nextMoveTime = Math.max(enemy.nextMoveTime, now + 150);
}

function startBloodlustChargePhase(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  runtime: BloodlustRuntime,
  config: BloodlustResolvedConfig,
  now: number
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  const { targetX, targetY } = resolveBloodlustTarget(room, enemy, runtime);
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 0) {
    runtime.vx = dx / magnitude;
    runtime.vy = dy / magnitude;
  } else {
    runtime.vx = 0;
    runtime.vy = 0;
  }

  runtime.state = 'charge';
  runtime.stateUntil = now + config.maxDashMs;
  runtime.hasHitDuringCharge = false;
  runtime.stuckFrames = 0;

  enemy.anim = 'sprint';
  enemy.animUntil = 0;
  enemy.isAttacking = false;
  enemy.targetX = enemy.x;
  enemy.targetY = enemy.y;
  enemy.nextMoveTime = now + 250;

  updateFacingFromVector(enemy, runtime.vx, runtime.vy);

  broadcaster.broadcast('boss_special_state', {
    state: 'charge_start',
    enemyId: enemy.id,
    targetX,
    targetY,
  });
}

function handleBloodlustChargePhase(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  runtime: BloodlustRuntime,
  config: BloodlustResolvedConfig,
  now: number
) {
  const { targetX, targetY } = resolveBloodlustTarget(room, enemy, runtime);
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const magnitude = Math.hypot(dx, dy);

  if (magnitude > 0.001) {
    runtime.vx = dx / magnitude;
    runtime.vy = dy / magnitude;
  }

  const vx = runtime.vx;
  const vy = runtime.vy;

  if (vx === 0 && vy === 0) {
    endBloodlustNow(room, enemy, runtime, config, now);
    return;
  }

  const prevX = enemy.x;
  const prevY = enemy.y;

  enemy.x += vx * config.chargeSpeed;
  enemy.y += vy * config.chargeSpeed;
  enemy.anim = 'sprint';
  enemy.isAttacking = false;
  enemy.nextMoveTime = now + 200;

  updateFacingFromVector(enemy, vx, vy);

  if (checkObstacleCollision(room, enemy.x, enemy.y, 20)) {
    enemy.x = prevX;
    enemy.y = prevY;
    endBloodlustNow(room, enemy, runtime, config, now);
    return;
  }

  const moved = Math.hypot(enemy.x - prevX, enemy.y - prevY);
  if (moved < 0.5) {
    runtime.stuckFrames += 1;
    if (runtime.stuckFrames >= 4) {
      endBloodlustNow(room, enemy, runtime, config, now);
      return;
    }
  } else {
    runtime.stuckFrames = 0;
  }

  if (!runtime.hasHitDuringCharge) {
    for (const [, player] of room.state.players) {
      const candidate = player as PlayerSchema;
      if (!candidate || candidate.hp <= 0) continue;
      const dist = Math.hypot(candidate.x - enemy.x, candidate.y - enemy.y);
      if (dist <= config.hitRadius) {
        const hit = applyBloodlustChargeDamage(
          room,
          enemy,
          candidate,
          config,
          now
        );
        if (hit) {
          runtime.hasHitDuringCharge = true;
          endBloodlustNow(room, enemy, runtime, config, now);
          return;
        }
      }
    }
  }

  const distanceToTarget = Math.hypot(targetX - enemy.x, targetY - enemy.y);
  if (distanceToTarget <= Math.max(10, config.hitRadius * 0.5)) {
    endBloodlustNow(room, enemy, runtime, config, now);
    return;
  }

  if (now >= runtime.stateUntil) {
    endBloodlustNow(room, enemy, runtime, config, now);
  }
}

function endBloodlustNow(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  runtime: BloodlustRuntime,
  config: BloodlustResolvedConfig,
  now: number
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  broadcaster.broadcast('boss_special_state', {
    state: 'charge_end',
    enemyId: enemy.id,
  });

  runtime.state = 'idle';
  runtime.stateUntil = 0;
  runtime.hasHitDuringCharge = false;
  runtime.vx = 0;
  runtime.vy = 0;
  runtime.stuckFrames = 0;
  runtime.targetPlayerId = '';
  runtime.nextReadyAt = now + config.cooldownMs;

  enemy.anim = 'idle';
  enemy.animUntil = 0;
  enemy.isAttacking = false;
  enemy.targetX = enemy.x;
  enemy.targetY = enemy.y;
  enemy.nextMoveTime = now;

  setIncomingDamageMultiplier(enemy, 1);

  broadcaster.broadcast('boss_special_state', {
    state: 'ended',
    enemyId: enemy.id,
  });
}

function resolveBloodlustTarget(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  runtime: BloodlustRuntime
): { targetX: number; targetY: number } {
  const existingId = runtime.targetPlayerId;
  if (existingId) {
    const existing = room.state.players.get(existingId) as
      | PlayerSchema
      | undefined;
    if (existing && existing.hp > 0) {
      runtime.targetX = existing.x;
      runtime.targetY = existing.y;
      enemy.targetPlayerId = existing.id;
      return { targetX: runtime.targetX, targetY: runtime.targetY };
    }
  }

  let nearest: PlayerSchema | null = null;
  let nearestDistSq = Infinity;
  for (const [, player] of room.state.players) {
    const candidate = player as PlayerSchema;
    if (!candidate || candidate.hp <= 0) continue;
    const dx = candidate.x - enemy.x;
    const dy = candidate.y - enemy.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = candidate;
    }
  }

  if (nearest) {
    runtime.targetPlayerId = nearest.id;
    runtime.targetX = nearest.x;
    runtime.targetY = nearest.y;
    enemy.targetPlayerId = nearest.id;
  }

  return { targetX: runtime.targetX, targetY: runtime.targetY };
}

export function applyBloodlustChargeDamage(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  config: BloodlustResolvedConfig,
  now: number
): boolean {
  const broadcaster = ensureServerBroadcaster(
    room as unknown as BroadcastCapable & { msg?: ServerBroadcaster }
  );
  const bossChargeStunConfig = resolveBossChargeStunAbility(enemy);
  const bonusDamage = bossChargeStunConfig?.bonusDamage ?? 0;
  if (!player || player.hp <= 0 || isPlayerDevInvincible(player)) return false;

  const runStartedAt = room.state.runStartedAt;
  const phase = room.state.phase;
  const gameRoomInstance = (room.state.room as GameRoom | undefined) ?? null;
  if (
    phase === 'in_game' &&
    typeof runStartedAt === 'number' &&
    runStartedAt > 0 &&
    now - runStartedAt < STAGING_INVULNERABILITY_MS
  ) {
    return false;
  }

  const evade = getPlayerEvade(player.characterId, 'melee');
  if (evade.chance > 0 && rollEvade(evade.chance)) {
    broadcaster.broadcast('attack_evaded', {
      attackerId: enemy.id,
      targetId: player.id,
      timestamp: Date.now(),
      weaponType: 'boss_charge',
    });
    return false;
  }

  const baseDamageWithoutBonus = Math.max(
    0,
    Math.round(Math.max(0, enemy.damage) * config.chargeDamageMultiplier)
  );
  const totalBaseDamage = Math.max(
    0,
    baseDamageWithoutBonus + Math.max(0, Math.round(bonusDamage))
  );
  if (totalBaseDamage <= 0) return false;

  const { finalDamage } = calculateDamageAfterMitigation(
    player,
    totalBaseDamage
  );
  const leverage = gameRoomInstance?.getLeverageTotal?.() ?? 1;
  const adjustedDamage = Math.max(0, Math.round(finalDamage * leverage));
  if (adjustedDamage <= 0) return false;

  const prevHp = player.hp;
  player.hp = Math.max(0, player.hp - adjustedDamage);
  const dealt = Math.max(0, prevHp - player.hp);
  if (dealt <= 0) return false;

  gameRoomInstance?.handleRoomLeverageEngagement?.('combat');

  broadcaster.broadcast('damage_applied', {
    attackerId: enemy.id,
    targetId: player.id,
    timestamp: Date.now(),
    damage: dealt,
    hp: player.hp,
    maxHp: player.maxHp,
    weaponType: 'boss_charge',
    isCrit: false,
    killed: player.hp <= 0,
  });

  maybeApplyBossChargeStun(
    room,
    enemy,
    player,
    bossChargeStunConfig,
    now,
    broadcaster
  );

  if (player.hp <= 0) {
    handlePlayerZeroHp(room, player, 'enemy_melee');
  }

  return true;
}

function maybeApplyBossChargeStun(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  stunConfig: BossChargeStunAbilityConfig | null,
  now: number,
  broadcaster: ReturnType<typeof ensureServerBroadcaster>
): void {
  if (
    !stunConfig ||
    !player ||
    player.hp <= 0 ||
    typeof player.id !== 'string' ||
    !player.id
  ) {
    return;
  }
  if (stunConfig.chance < 1 && Math.random() >= stunConfig.chance) {
    return;
  }
  const gameRoomInstance = (room.state.room as GameRoom | undefined) ?? null;
  const result = applyStunStatus(
    gameRoomInstance,
    player,
    {
      chance: 1,
      durationMs: stunConfig.durationMs,
      appliesTo: 'all',
      sourceKey: BOSS_CHARGE_STUN_SOURCE_KEY,
      abilitySourceId: BOSS_CHARGE_STUN_ABILITY_ID,
    },
    now,
    { attackerId: enemy.id }
  );
  if (result.applied && !result.hadActiveBefore && result.hasActiveAfter) {
    broadcaster.broadcast('status_applied', {
      targetId: player.id,
      type: 'stun',
      durationMs: stunConfig.durationMs,
    });
  }
}

function resolveBossChargeStunAbility(
  enemy: EnemySchema
): BossChargeStunAbilityConfig | null {
  const cached = (
    enemy as unknown as {
      _bossChargeStunConfig?: BossChargeStunAbilityConfig;
    }
  )._bossChargeStunConfig;
  if (cached) {
    return cached;
  }

  const configFromInstance = extractBossChargeStunConfig(
    getAbilityDefinitions(enemy) as Array<{
      id?: string;
      params?: Record<string, unknown>;
    }>
  );
  if (configFromInstance) {
    (
      enemy as unknown as {
        _bossChargeStunConfig?: BossChargeStunAbilityConfig;
      }
    )._bossChargeStunConfig = configFromInstance;
    return configFromInstance;
  }

  const baseStats = ENEMY_TYPES?.[enemy.enemyType];
  if (baseStats && Array.isArray(baseStats.abilities)) {
    const configFromBase = extractBossChargeStunConfig(baseStats.abilities);
    if (configFromBase) {
      (
        enemy as unknown as {
          _bossChargeStunConfig?: BossChargeStunAbilityConfig;
        }
      )._bossChargeStunConfig = configFromBase;
      return configFromBase;
    }
  }

  return null;
}

function extractBossChargeStunConfig(
  abilityRefs:
    | Array<{ id?: string; params?: Record<string, unknown> }>
    | undefined
): BossChargeStunAbilityConfig | null {
  if (!Array.isArray(abilityRefs)) {
    return null;
  }
  const found = abilityRefs.find(
    (entry) =>
      entry &&
      typeof entry.id === 'string' &&
      entry.id === BOSS_CHARGE_STUN_ABILITY_ID
  );
  if (!found) {
    return null;
  }
  const rawParams = (found.params || {}) as {
    durationMs?: unknown;
    chance?: unknown;
    damage?: unknown;
  };
  const durationRaw = Number(rawParams.durationMs);
  const durationMs = Number.isFinite(durationRaw)
    ? Math.max(1, Math.round(durationRaw))
    : 2000;
  if (durationMs <= 0) {
    return null;
  }
  const chanceRaw = Number(rawParams.chance);
  const chance = Number.isFinite(chanceRaw)
    ? Math.max(0, Math.min(1, chanceRaw))
    : 1;
  const damageRaw = Number(rawParams.damage);
  const bonusDamage = Number.isFinite(damageRaw)
    ? Math.max(0, Math.round(damageRaw))
    : 0;
  return {
    durationMs,
    chance,
    bonusDamage,
  };
}

function updateFacingFromVector(enemy: EnemySchema, vx: number, vy: number) {
  if (Math.abs(vx) >= Math.abs(vy)) {
    if (vx > 0) {
      if (enemy.dir !== 'right') enemy.dir = 'right';
    } else if (vx < 0) {
      if (enemy.dir !== 'left') enemy.dir = 'left';
    }
  } else if (vy !== 0) {
    if (vy > 0) {
      if (enemy.dir !== 'down') enemy.dir = 'down';
    } else {
      if (enemy.dir !== 'up') enemy.dir = 'up';
    }
  }
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

function toPositiveMultiplier(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

function setIncomingDamageMultiplier(enemy: EnemySchema, value: number) {
  const multiplier = Number(value);
  if (Number.isFinite(multiplier) && multiplier > 0) {
    (
      enemy as unknown as { incomingDamageMultiplier?: number }
    ).incomingDamageMultiplier = multiplier;
  } else {
    (
      enemy as unknown as { incomingDamageMultiplier?: number }
    ).incomingDamageMultiplier = 1;
  }
}
