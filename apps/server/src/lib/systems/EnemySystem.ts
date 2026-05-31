import type { Room } from 'colyseus';
import type { GameRoomState, EnemySchema, PlayerSchema } from '../../schemas';
import { isOnRoad, checkObstacleCollision } from './MapCollisionSystem';
import type { GameRoomApi } from '../../types';
import { fireEnemyProjectile } from './ProjectileSystem';
import { GAME_CONFIG, STAGING_INVULNERABILITY_MS } from '../constants';
import { getEnemyAnimationDuration } from '../../data/enemies';
import { calculateDamageAfterMitigation } from '../player-stats';
import { applyAuras, getAuraDamageReduction, clearAuraEffects } from './AuraSystem';
import {
  getMovementSpeedScalar,
  applyMovementSlow,
  clearAllMovementSlowsImmediate,
  isEntityStunned,
  applyStunStatus,
  applyPoisonStatus,
  clearPoisonImmediate,
  handlePlayerZeroHp,
} from './StatusSystem';

import {
  getEnemyCrit,
  rollCrit,
  getEnemyCleave,
  isWithinCone,
  getEnemyEvade,
  getPlayerEvade,
  rollEvade,
  getEnemySlow,
  getEnemyStun,
  getEnemyPoison,
} from '../ability-utils';
import { getRandomEnemyType, spawnEnemyOfType } from './EnemySpawnSystem';
import { runEnemyAbilities } from '../abilities/enemyAbilities';
import type { GameRoom } from '../../rooms/GameRoom';
import { ensureServerBroadcaster } from '../messaging';
import { isPlayerDevInvincible } from '../debug';

export function shouldEnemyEvadeAttack(
  enemy: EnemySchema,
  weaponType: 'melee' | 'ranged',
  now: number
): boolean {
  const attemptEvade = (
    state:
      | {
          chance: number;
          cooldownMs?: number;
          lastTriggerAt?: number;
        }
      | undefined
  ): boolean => {
    if (!state) return false;
    const chance = Math.max(0, Math.min(1, Number(state.chance) || 0));
    if (chance <= 0) return false;
    const cooldownMs = Math.max(0, Number(state.cooldownMs) || 0);
    const last = Number(state.lastTriggerAt) || 0;
    if (cooldownMs > 0 && now - last < cooldownMs) return false;
    if (Math.random() < chance) {
      state.lastTriggerAt = now;
      return true;
    }
    return false;
  };

  const auraEvadeState = (enemy as any)._auraEvadeState;
  if (auraEvadeState) {
    const state =
      weaponType === 'melee' ? auraEvadeState.melee : auraEvadeState.ranged;
    if (attemptEvade(state)) {
      return true;
    }
  }

  let baseEvadeState = (enemy as any)._baseEvadeState as
    | {
        melee: { chance: number; cooldownMs?: number; lastTriggerAt: number };
        ranged: { chance: number; cooldownMs?: number; lastTriggerAt: number };
      }
    | undefined;

  if (!baseEvadeState) {
    const melee = aggregateEvadeFromEnemy(enemy.enemyType, 'melee');
    const ranged = aggregateEvadeFromEnemy(enemy.enemyType, 'ranged');
    baseEvadeState = {
      melee: {
        chance: melee.chance,
        cooldownMs: melee.cooldownMs,
        lastTriggerAt: 0,
      },
      ranged: {
        chance: ranged.chance,
        cooldownMs: ranged.cooldownMs,
        lastTriggerAt: 0,
      },
    };
    (enemy as any)._baseEvadeState = baseEvadeState;
  }

  const baseState =
    weaponType === 'melee' ? baseEvadeState.melee : baseEvadeState.ranged;
  if (attemptEvade(baseState)) {
    return true;
  }

  return false;
}

function aggregateEvadeFromEnemy(
  enemyType: string,
  weaponType: 'melee' | 'ranged'
) {
  const result = getEnemyEvade(enemyType, weaponType);
  return {
    chance: Math.max(0, Math.min(1, result?.chance || 0)),
    cooldownMs:
      typeof result?.cooldownMs === 'number' && result.cooldownMs > 0
        ? result.cooldownMs
        : undefined,
  };
}

export function applyAuraDamageMitigation(
  enemy: EnemySchema,
  damage: number
): number {
  const auraArmor = Math.max(0, getAuraDamageReduction(enemy));
  if (auraArmor <= 0) return damage;
  const auraPercent = Math.min(0.8, Math.max(0, auraArmor / 100));
  if (auraPercent <= 0) return damage;
  return Math.max(0, Math.round(damage * (1 - auraPercent)));
}

export function applyEnemyIncomingDamageModifiers(
  enemy: EnemySchema,
  damage: number
): number {
  const base = Number(damage);
  if (!Number.isFinite(base)) return 0;
  const positiveBase = Math.max(0, base);
  const multiplierRaw = Number((enemy as any).incomingDamageMultiplier);
  const multiplier =
    Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? multiplierRaw : 1;
  if (multiplier === 1) {
    return Math.max(0, Math.round(positiveBase));
  }
  return Math.max(0, Math.round(positiveBase * multiplier));
}

export function updateEnemyMovement(room: Room<GameRoomState>, now: number) {
  const defaultMeleeRange = 96;
  const defaultRangedRange = 192;
  // Activation radii (tiles → px) with hysteresis to prevent thrashing
  const R_IN_TILES = 18; // become active when nearer than this
  const R_OUT_TILES = 22; // go dormant when farther than this
  const R_IN_PX = R_IN_TILES * GAME_CONFIG.TILE_SIZE;
  const R_OUT_PX = R_OUT_TILES * GAME_CONFIG.TILE_SIZE;
  const R_IN_SQ = R_IN_PX * R_IN_PX;
  const R_OUT_SQ = R_OUT_PX * R_OUT_PX;
  const PROX_CHECK_MIN_MS = 250;
  const PROX_CHECK_MAX_MS = 400;
  const DORMANT_HEARTBEAT_MS = 1200; // cheap recheck cadence when far
  const STAY_ACTIVE_MS = 500; // stickiness window after activation
  const boundaryPadding = 50;

  // Pre-pass: determine which enemies are active this tick and update dormancy timers
  const activeEnemyIds = new Set<string>();
  for (const [enemyId, enemy] of room.state.enemies) {
    if (!enemy || enemy.hp <= 0) continue;

    let isActive = true;
    const forcedActive =
      enemy.forcedAggro ||
      !!enemy.aggroTargetPlayerId ||
      enemy.isCharging ||
      enemy.anim === ('hurt' as any) ||
      enemy.enemyType === 'portal_guardian'; // Bosses always stay active
    const stayActiveUntil = (enemy as any).stayActiveUntil as
      | number
      | undefined;
    if (
      forcedActive ||
      (typeof stayActiveUntil === 'number' && now < stayActiveUntil)
    ) {
      isActive = true;
    } else {
      const nextProximityCheckAt = (enemy as any).nextProximityCheckAt as
        | number
        | undefined;
      const havePlayers = room.state.players.size > 0;
      if (!havePlayers) {
        isActive = false;
      } else if (
        typeof nextProximityCheckAt === 'number' &&
        now < nextProximityCheckAt
      ) {
        isActive = !Boolean((enemy as any).isDormant);
      } else {
        let minDistSq = Infinity;
        for (const [_, p] of room.state.players) {
          const dx = p.x - enemy.x;
          const dy = p.y - enemy.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDistSq) minDistSq = d2;
        }
        let nextCheckMs =
          PROX_CHECK_MIN_MS +
          Math.floor(
            Math.random() * (PROX_CHECK_MAX_MS - PROX_CHECK_MIN_MS + 1)
          );
        if (minDistSq <= R_IN_SQ) {
          isActive = true;
          (enemy as any).stayActiveUntil = now + STAY_ACTIVE_MS;
          (enemy as any).isDormant = false;
        } else if (minDistSq >= R_OUT_SQ) {
          isActive = false;
          (enemy as any).isDormant = true;
          nextCheckMs = DORMANT_HEARTBEAT_MS + Math.floor(Math.random() * 400);
        } else {
          const priorDormant = Boolean((enemy as any).isDormant);
          isActive = !priorDormant;
        }
        (enemy as any).nextProximityCheckAt = now + nextCheckMs;
      }
    }

    if (isActive) activeEnemyIds.add(enemyId);
  }

  // Apply aura effects only to active enemies; clear on others
  applyAuras(room as any, now);

  // Process any scheduled removals/follow-ups (tick-queued) before updating enemies
  try {
    const state: any = room.state as any;
    if (
      Array.isArray(state._scheduledEnemyRemovals) &&
      state._scheduledEnemyRemovals.length > 0
    ) {
      const remaining: typeof state._scheduledEnemyRemovals = [];
      for (const task of state._scheduledEnemyRemovals) {
        if (now >= task.at) {
          if (room.state.enemies.has(task.id)) {
            try {
              const e = room.state.enemies.get(task.id);
              if (e) {
                clearAllMovementSlowsImmediate(room, e);
                clearPoisonImmediate(room, e);
                // Ensure any aura visual tags/stats are cleared before removal
                try {
                  clearAuraEffects(e as any);
                } catch {}
                // Sanitize transient fields prior to removal to avoid reuse
                try {
                  delete (e as any).lastHitWeaponSlug;
                } catch {}
              }
            } catch {}
            room.state.enemies.delete(task.id);
          }
        } else {
          remaining.push(task);
        }
      }
      state._scheduledEnemyRemovals = remaining;
    }
    if (
      Array.isArray(state._scheduledEnemyFollowups) &&
      state._scheduledEnemyFollowups.length > 0
    ) {
      const remainingF: typeof state._scheduledEnemyFollowups = [];
      for (const task of state._scheduledEnemyFollowups) {
        if (now >= task.at) {
          try {
            const count = Math.max(1, Math.floor(task.count || 1));
            for (let i = 0; i < count; i++)
              spawnEnemyOfType(room as any, getRandomEnemyType());
          } catch {}
        } else {
          remainingF.push(task);
        }
      }
      state._scheduledEnemyFollowups = remainingF;
    }
  } catch {}

  let activeEnemies = 0;
  for (const [enemyId, enemy] of room.state.enemies) {
    // Ensure only elites (and special bosses) expose names to clients
    if (!enemy.isElite && enemy.enemyType !== 'portal_guardian') {
      if (enemy.name) enemy.name = '' as any;
    }
    if (enemy.hp <= 0) continue;

    // Resolve any pending animation transitions scheduled via timestamps
    if (enemy.animUntil > 0 && now >= enemy.animUntil) {
      const nextAnim = (enemy.postAnim as any) || ('idle' as any);
      if (enemy.anim !== nextAnim) enemy.anim = nextAnim;
      enemy.animUntil = 0;
      enemy.postAnim = '' as any;
    }

    // Activation gating result from pre-pass
    const isActive = activeEnemyIds.has(enemyId);

    if (!isActive) {
      // Minimal maintenance while dormant
      if (
        enemy.anim !== ('hurt' as any) &&
        enemy.anim !== 'death' &&
        enemy.anim !== ('idle' as any)
      ) {
        enemy.anim = 'idle';
      }
      // Skip heavy processing for dormant enemies
      continue;
    }

    activeEnemies++;

    enemy.onRoad = isOnRoad(room, enemy.x, enemy.y);

    const detectionRange =
      enemy.aggroRange ||
      (enemy.attackType === 'ranged' ? defaultRangedRange : defaultMeleeRange);
    const detectionRangeSq = detectionRange * detectionRange;

    let nearestPlayer: PlayerSchema | null = null;
    let nearestDistance = Infinity;

    if (enemy.forcedAggro && enemy.aggroTargetPlayerId) {
      const aggroTargetPlayer = room.state.players.get(
        enemy.aggroTargetPlayerId
      );
      if (aggroTargetPlayer) {
        nearestPlayer = aggroTargetPlayer;
        const dx = aggroTargetPlayer.x - enemy.x;
        const dy = aggroTargetPlayer.y - enemy.y;
        nearestDistance = Math.sqrt(dx * dx + dy * dy);
        enemy.targetPlayerId = enemy.aggroTargetPlayerId;
      } else {
        enemy.forcedAggro = false;
        enemy.aggroTargetPlayerId = '';
      }
    }

    if (!nearestPlayer) {
      // Reuse existing target until invalid; throttle rescans
      const currentTargetId = enemy.targetPlayerId;
      if (currentTargetId) {
        const existing = room.state.players.get(currentTargetId);
        if (existing) {
          const dx = existing.x - enemy.x;
          const dy = existing.y - enemy.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= detectionRangeSq) {
            nearestPlayer = existing as PlayerSchema;
          } else {
            enemy.targetPlayerId = '';
          }
        } else {
          enemy.targetPlayerId = '';
        }
      }

      // Only rescan when due or when we have no valid target
      if (!nearestPlayer) {
        const nextTargetScanAt = (enemy as any).nextTargetScanAt as
          | number
          | undefined;
        const due =
          !Number.isFinite(nextTargetScanAt as number) ||
          typeof nextTargetScanAt !== 'number' ||
          now >= (nextTargetScanAt as number);

        if (due) {
          const hadTargetBeforeScan = Boolean(enemy.targetPlayerId);
          // Use squared-distance for scan
          let nearestDistSq = Infinity;
          let nearestId: string | null = null;
          for (const [playerId, player] of room.state.players) {
            const dx = player.x - enemy.x;
            const dy = player.y - enemy.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= detectionRangeSq && distSq < nearestDistSq) {
              nearestPlayer = player as PlayerSchema;
              nearestDistSq = distSq;
              nearestId = playerId;
            }
          }
          if (nearestPlayer && nearestId) {
            enemy.targetPlayerId = nearestId;
            nearestDistance = Math.sqrt(nearestDistSq);
            // Enter a brief charge when first acquiring a target via aggro
            if (!hadTargetBeforeScan) {
              enemy.isCharging = true;
              enemy.chargeEndTime = now + 3000;
            }
          }
          // Schedule next scan with jitter to avoid synchronization
          const jitterMs = 150 + Math.floor(Math.random() * 100); // 150–250ms
          (enemy as any).nextTargetScanAt = now + jitterMs;
        }
      }
    }

    const abilityHandled = runEnemyAbilities(room, enemy, nearestPlayer, now);
    if (abilityHandled) {
      continue;
    }

    if (nearestPlayer) {
      if (enemy.isAttacking !== true) enemy.isAttacking = true;
      if (enemy.attackType === 'melee') {
        handleMeleeEnemyAttack(room, enemy, nearestPlayer, now);
      } else {
        handleRangedEnemyAttack(room, enemy, nearestPlayer, now);
      }
    } else {
      if (enemy.isAttacking !== false) enemy.isAttacking = false;
      enemy.targetPlayerId = '';
      if (enemy.speed > 0) {
        handleEnemyRandomMovement(room, enemy, now, boundaryPadding);
      } else {
        if (
          enemy.anim !== ('hurt' as any) &&
          enemy.anim !== 'death' &&
          enemy.anim !== 'attack'
        ) {
          if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
        }
      }
    }
  }
  // Expose active count for perf HUD
  (room as any).lastActiveEnemies = activeEnemies;
}

export function handleEnemyRandomMovement(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  now: number,
  boundaryPadding: number
) {
  let enemySpeed = 1;
  if (enemy.onRoad) enemySpeed *= 1.25;
  enemySpeed *= getMovementSpeedScalar(enemy, now);

  if (now >= enemy.nextMoveTime) {
    const moveDistance = 50 + Math.random() * 100;
    const angle = Math.random() * Math.PI * 2;

    let newTargetX = enemy.x + Math.cos(angle) * moveDistance;
    let newTargetY = enemy.y + Math.sin(angle) * moveDistance;

    newTargetX = Math.max(
      boundaryPadding,
      Math.min(GAME_CONFIG.WORLD_WIDTH - boundaryPadding, newTargetX)
    );
    newTargetY = Math.max(
      boundaryPadding,
      Math.min(GAME_CONFIG.WORLD_HEIGHT - boundaryPadding, newTargetY)
    );

    enemy.targetX = newTargetX;
    enemy.targetY = newTargetY;
    enemy.nextMoveTime = now + (2000 + Math.random() * 3000);
  }

  const deltaX = enemy.targetX - enemy.x;
  const deltaY = enemy.targetY - enemy.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (distance > 2) {
    const moveX = (deltaX / distance) * enemySpeed;
    const moveY = (deltaY / distance) * enemySpeed;

    const prevX = enemy.x;
    const prevY = enemy.y;

    enemy.x += moveX;
    enemy.y += moveY;

    if (checkObstacleCollision(room, enemy.x, enemy.y, 20)) {
      enemy.x = prevX;
      enemy.y = prevY;
      enemy.nextMoveTime = now;
      enemy.anim = 'idle';
    } else {
      if (Math.abs(moveX) > Math.abs(moveY)) {
        const nextDir = moveX > 0 ? ('right' as any) : ('left' as any);
        if (enemy.dir !== nextDir) enemy.dir = nextDir;
      } else {
        const nextDir = moveY > 0 ? ('down' as any) : ('up' as any);
        if (enemy.dir !== nextDir) enemy.dir = nextDir;
      }
      if (enemy.anim !== ('walk' as any)) enemy.anim = 'walk';
    }
  } else {
    if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
  }
}

export function handleMeleeEnemyAttack(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  now: number
) {
  const deltaX = player.x - enemy.x;
  const deltaY = player.y - enemy.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const meleeRange = enemy.attackRange || 24;

  if (enemy.anim === 'attack') return;

  const attackCooldownMs = Math.max(
    200,
    Number((enemy as any).attackCooldownMs) || 800
  );

  if (distance <= meleeRange && now - enemy.lastAttackTime > attackCooldownMs) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      const nextDir = dx > 0 ? ('right' as any) : ('left' as any);
      if (enemy.dir !== nextDir) enemy.dir = nextDir;
    } else {
      const nextDir = dy > 0 ? ('down' as any) : ('up' as any);
      if (enemy.dir !== nextDir) enemy.dir = nextDir;
    }
    performEnemyMeleeAttack(room, enemy, player, now);
    return;
  }

  if (distance > meleeRange) {
    let sprintSpeed = 3;
    if (enemy.isCharging && Date.now() < enemy.chargeEndTime) {
      sprintSpeed = 5;
    } else if (enemy.isCharging) {
      enemy.isCharging = false;
      enemy.chargeEndTime = 0;
    }
    if (enemy.onRoad) sprintSpeed *= 1.25;
    sprintSpeed *= getMovementSpeedScalar(enemy, now);

    const moveX = (deltaX / distance) * sprintSpeed;
    const moveY = (deltaY / distance) * sprintSpeed;
    const prevX = enemy.x;
    const prevY = enemy.y;
    enemy.x += moveX;
    enemy.y += moveY;

    if (checkObstacleCollision(room, enemy.x, enemy.y, 20)) {
      enemy.x = prevX;
      enemy.y = prevY;
      enemy.anim = 'idle';
    } else {
      if (Math.abs(moveX) > Math.abs(moveY)) {
        const nextDir = moveX > 0 ? ('right' as any) : ('left' as any);
        if (enemy.dir !== nextDir) enemy.dir = nextDir;
      } else {
        const nextDir = moveY > 0 ? ('down' as any) : ('up' as any);
        if (enemy.dir !== nextDir) enemy.dir = nextDir;
      }
      if (enemy.anim !== ('attack' as any)) {
        if (enemy.anim !== ('sprint' as any)) enemy.anim = 'sprint';
      }
    }
  } else {
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      const nextDir = deltaX > 0 ? ('right' as any) : ('left' as any);
      if (enemy.dir !== nextDir) enemy.dir = nextDir;
    } else {
      const nextDir = deltaY > 0 ? ('down' as any) : ('up' as any);
      if (enemy.dir !== nextDir) enemy.dir = nextDir;
    }
    if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
  }

  const dx2 = player.x - enemy.x;
  const dy2 = player.y - enemy.y;
  if (Math.abs(dx2) > Math.abs(dy2)) {
    const nextDir = dx2 > 0 ? ('right' as any) : ('left' as any);
    if (enemy.dir !== nextDir) enemy.dir = nextDir;
  } else {
    const nextDir = dy2 > 0 ? ('down' as any) : ('up' as any);
    if (enemy.dir !== nextDir) enemy.dir = nextDir;
  }
}

export function handleRangedEnemyAttack(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  now: number
) {
  if (isEntityStunned(enemy, now)) {
    if (enemy.anim !== ('death' as any) && enemy.anim !== ('hurt' as any)) {
      if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
    }
    return;
  }

  const attackCooldown = enemy.rangedAttackSpeed || 2000;
  const timeSinceLastAttack = now - enemy.lastAttackTime;

  // Generic reload/burst behavior for ranged enemies when configured on the schema
  const reloadDurationMs = Number((enemy as any).reloadDurationMs) || 0;
  const magazineSize = Number((enemy as any).rangedMagazineSize) || 0;
  const hasReload = reloadDurationMs > 0 && magazineSize > 0;
  if (hasReload) {
    const isReloading = Boolean((enemy as any).isReloading);
    const reloadUntil = Number((enemy as any).reloadUntil) || 0;
    let shotsFiredInBurst = Number((enemy as any).shotsFiredInBurst) || 0;

    // If currently reloading and not done, hold fire and idle
    if (isReloading && now < reloadUntil) {
      if (enemy.anim !== ('hurt' as any) && enemy.anim !== 'death') {
        if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
      }
      return;
    }

    // If reload completed, reset burst state
    if (isReloading && now >= reloadUntil) {
      (enemy as any).isReloading = false;
      (enemy as any).reloadUntil = 0;
      shotsFiredInBurst = 0;
      (enemy as any).shotsFiredInBurst = 0;
    }

    // If magazine is empty, enter reload
    if (shotsFiredInBurst >= magazineSize) {
      (enemy as any).isReloading = true;
      (enemy as any).reloadUntil = now + reloadDurationMs;
      if (enemy.anim !== ('hurt' as any) && enemy.anim !== 'death') {
        if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
      }
      return;
    }

    // Normal per-shot cooldown
    if (timeSinceLastAttack > attackCooldown) {
      fireEnemyProjectile(room, enemy, player, now);
      enemy.lastAttackTime = now;
      (enemy as any).shotsFiredInBurst = shotsFiredInBurst + 1;
      if (enemy.anim !== ('attack' as any)) enemy.anim = 'attack';
      enemy.animUntil = now + getEnemyAnimationDuration(enemy.name, 'attack');
      enemy.postAnim = 'idle' as any;
    } else {
      if (enemy.anim !== ('hurt' as any) && enemy.anim !== 'death') {
        if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
      }
    }
  } else {
    // Default behavior for other ranged enemies
    if (timeSinceLastAttack > attackCooldown) {
      fireEnemyProjectile(room, enemy, player, now);
      enemy.lastAttackTime = now;
      if (enemy.anim !== ('attack' as any)) enemy.anim = 'attack';
      enemy.animUntil = now + getEnemyAnimationDuration(enemy.name, 'attack');
      enemy.postAnim = 'idle' as any;
    } else {
      if (enemy.anim !== ('hurt' as any) && enemy.anim !== 'death') {
        if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
      }
    }
  }

  const deltaX = player.x - enemy.x;
  const deltaY = player.y - enemy.y;
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    const nextDir = deltaX > 0 ? ('right' as any) : ('left' as any);
    if (enemy.dir !== nextDir) enemy.dir = nextDir;
  } else {
    const nextDir = deltaY > 0 ? ('down' as any) : ('up' as any);
    if (enemy.dir !== nextDir) enemy.dir = nextDir;
  }
}

export function performEnemyMeleeAttack(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  now: number
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  if (isEntityStunned(enemy, now)) {
    if (enemy.anim !== ('death' as any) && enemy.anim !== ('hurt' as any)) {
      if (enemy.anim !== ('idle' as any)) enemy.anim = 'idle';
    }
    return;
  }

  const gameRoomInstance = (room.state.room as GameRoom | undefined) ?? null;
  // Determine cleave parameters for the enemy
  const slowSources = getEnemySlow(enemy.enemyType, 'melee');
  const stunSources = getEnemyStun(enemy.enemyType, 'melee');
  const poisonSources = getEnemyPoison(enemy.enemyType, 'melee');
  let totalActualDamageDealt = 0;
  try {
    const cleave = getEnemyCleave(enemy.enemyType, 'melee');
    const coneAngle = cleave.coneAngleDeg ?? 100;

    // Collect all players in melee range and cone
    const candidatePlayers: Array<PlayerSchema> = [];
    for (const [_, p] of room.state.players) {
      if (!p || p.hp <= 0) continue;
      const dist = Math.hypot(p.x - enemy.x, p.y - enemy.y);
      const meleeRange = enemy.attackRange || 24;
      if (dist > meleeRange) continue;
      if (!isWithinCone(enemy.x, enemy.y, enemy.dir, p.x, p.y, coneAngle))
        continue;
      candidatePlayers.push(p);
    }

    // Sort near to far
    candidatePlayers.sort((a, b) => {
      const da = Math.hypot(a.x - enemy.x, a.y - enemy.y);
      const db = Math.hypot(b.x - enemy.x, b.y - enemy.y);
      return da - db;
    });

    let finalTargets = candidatePlayers;
    if (
      !cleave.enabled &&
      player &&
      player.hp > 0 &&
      !isPlayerDevInvincible(player)
    ) {
      finalTargets = [player];
    } else if (cleave.enabled && typeof cleave.maxTargets === 'number') {
      // Ensure the intended target is included first
      const prioritized: PlayerSchema[] = [];
      if (player && player.hp > 0) prioritized.push(player);
      for (const p of candidatePlayers) {
        if (prioritized.find((q) => q.id === p.id)) continue;
        if (prioritized.length >= cleave.maxTargets) break;
        prioritized.push(p);
      }
      finalTargets = prioritized;
    }

    for (const tgt of finalTargets) {
      if (isPlayerDevInvincible(tgt)) {
        continue;
      }
      const runStartedAt = (room.state as any).runStartedAt;
      const phase = (room.state as any).phase;
      const invulnerable =
        phase === 'in_game' &&
        typeof runStartedAt === 'number' &&
        runStartedAt > 0 &&
        Date.now() - runStartedAt < STAGING_INVULNERABILITY_MS;
      if (invulnerable) {
        continue;
      }
      try {
        const evade = getPlayerEvade(tgt.characterId, 'melee');
        if (evade.chance > 0 && rollEvade(evade.chance)) {
          broadcaster.broadcast('attack_evaded', {
            attackerId: enemy.id,
            targetId: tgt.id,
            timestamp: Date.now(),
            weaponType: 'melee',
          });
          continue;
        }
      } catch {}

      let damage = enemy.damage;
      // Apply crit per target
      try {
        const baseCrit = getEnemyCrit(enemy.enemyType, 'melee');
        const auraCrit = (enemy as any)._auraCrit?.melee || {
          chance: 0,
          multiplier: 1,
        };
        const totalChance = Math.max(
          0,
          Math.min(1, (baseCrit?.chance || 0) + (auraCrit.chance || 0))
        );
        const bonusMultiplier =
          Math.max(1, baseCrit?.multiplier || 1) +
          Math.max(0, (auraCrit.multiplier || 1) - 1);
        if (totalChance > 0 && rollCrit(totalChance) && bonusMultiplier > 1) {
          damage = Math.round(damage * bonusMultiplier);
        }
      } catch {}
      const adjusted = Math.max(
        0,
        Math.round(damage * (cleave.enabled ? cleave.damageMultiplier : 1))
      );
      const { finalDamage } = calculateDamageAfterMitigation(tgt, adjusted);
      const leverage = gameRoomInstance?.getLeverageTotal?.() ?? 1;
      const adjustedFinalDamage = Math.max(
        0,
        Math.round(finalDamage * leverage)
      );
      if (adjustedFinalDamage <= 0) {
        continue;
      }
      const prevHp = tgt.hp;
      tgt.hp = Math.max(0, tgt.hp - adjustedFinalDamage);
      const dealt = Math.max(0, prevHp - tgt.hp);
      totalActualDamageDealt += dealt;
      if (dealt > 0) {
        gameRoomInstance?.handleRoomLeverageEngagement?.('combat');
      }
      if (dealt > 0 && tgt.hp > 0 && slowSources.length > 0) {
        let appliedSlowForBroadcast: {
          amount: number;
          durationMs: number;
        } | null = null;
        for (const slow of slowSources) {
          if (slow.chance < 1 && Math.random() >= slow.chance) continue;
          const result = applyMovementSlow(tgt, slow, now);
          if (
            result.applied &&
            !result.hadActiveBefore &&
            result.hasActiveAfter &&
            !appliedSlowForBroadcast
          ) {
            appliedSlowForBroadcast = {
              amount: slow.amount,
              durationMs: slow.durationMs,
            };
          }
        }
        if (appliedSlowForBroadcast && tgt.id) {
          broadcaster.broadcast('status_applied', {
            targetId: tgt.id,
            type: 'slow',
            amount: appliedSlowForBroadcast.amount,
            durationMs: appliedSlowForBroadcast.durationMs,
          });
        }
      }
      if (dealt > 0 && tgt.hp > 0 && stunSources.length > 0) {
        let appliedStunForBroadcast = false;
        let stunBroadcastDuration = 0;
        for (const stun of stunSources) {
          if (stun.chance < 1 && Math.random() >= stun.chance) continue;
          const stunResult = applyStunStatus(gameRoomInstance, tgt, stun, now, {
            attackerId: enemy.id,
          });
          if (
            stunResult.applied &&
            !stunResult.hadActiveBefore &&
            stunResult.hasActiveAfter
          ) {
            appliedStunForBroadcast = true;
            stunBroadcastDuration = Math.max(
              stunBroadcastDuration,
              Math.round(stun.durationMs)
            );
          }
        }
        if (appliedStunForBroadcast && tgt.id) {
          broadcaster.broadcast('status_applied', {
            targetId: tgt.id,
            type: 'stun',
            durationMs: stunBroadcastDuration,
          });
        }
      }
      if (dealt > 0 && tgt.hp > 0 && poisonSources.length > 0) {
        let poisonBroadcast: {
          durationMs: number;
          dps: number;
          tickMs: number;
        } | null = null;
        for (const poison of poisonSources) {
          if (poison.chance < 1 && Math.random() >= poison.chance) continue;
          const result = applyPoisonStatus(gameRoomInstance, tgt, poison, now, {
            attackerId: enemy.id,
          });
          if (
            result.applied &&
            !result.hadActiveBefore &&
            result.hasActiveAfter &&
            !poisonBroadcast
          ) {
            const tickMs = Math.max(1, poison.tickIntervalMs);
            const dps = Math.max(
              0,
              Math.round((poison.damagePerTick * 1000) / tickMs)
            );
            poisonBroadcast = {
              durationMs: poison.durationMs,
              dps,
              tickMs,
            };
          }
        }
        if (poisonBroadcast && tgt.id) {
          broadcaster.broadcast('status_applied', {
            targetId: tgt.id,
            type: 'poison',
            durationMs: poisonBroadcast.durationMs,
            dps: poisonBroadcast.dps,
            tickMs: poisonBroadcast.tickMs,
          });
        }
      }

      if (tgt.hp <= 0) {
        handlePlayerZeroHp(room, tgt, 'enemy_melee');
      }
    }
  } catch {
    // Fallback to single-target damage if any issue occurs
    if (isPlayerDevInvincible(player)) {
      return;
    }
    const runStartedAt = (room.state as any).runStartedAt;
    const phase = (room.state as any).phase;
    if (
      phase === 'in_game' &&
      typeof runStartedAt === 'number' &&
      runStartedAt > 0 &&
      Date.now() - runStartedAt < STAGING_INVULNERABILITY_MS
    ) {
      return;
    }
    const prevHp = player.hp;
    const { finalDamage } = calculateDamageAfterMitigation(
      player,
      enemy.damage
    );
    const leverage = gameRoomInstance?.getLeverageTotal?.() ?? 1;
    const adjustedFinalDamage = Math.max(0, Math.round(finalDamage * leverage));
    let fallbackDealt = 0;
    if (adjustedFinalDamage > 0) {
      player.hp = Math.max(0, player.hp - adjustedFinalDamage);
      fallbackDealt = Math.max(0, prevHp - player.hp);
      if (fallbackDealt > 0) {
        gameRoomInstance?.handleRoomLeverageEngagement?.('combat');
      }
    }
    totalActualDamageDealt = fallbackDealt;
    if (fallbackDealt > 0 && player.hp > 0 && slowSources.length > 0) {
      let appliedSlowForBroadcast: {
        amount: number;
        durationMs: number;
      } | null = null;
      for (const slow of slowSources) {
        if (slow.chance < 1 && Math.random() >= slow.chance) continue;
        const result = applyMovementSlow(player, slow, now);
        if (
          result.applied &&
          !result.hadActiveBefore &&
          result.hasActiveAfter &&
          !appliedSlowForBroadcast
        ) {
          appliedSlowForBroadcast = {
            amount: slow.amount,
            durationMs: slow.durationMs,
          };
        }
      }
      if (appliedSlowForBroadcast && player.id) {
        broadcaster.broadcast('status_applied', {
          targetId: player.id,
          type: 'slow',
          amount: appliedSlowForBroadcast.amount,
          durationMs: appliedSlowForBroadcast.durationMs,
        });
      }
    }

    if (player.hp <= 0) {
      handlePlayerZeroHp(room, player, 'enemy_melee');
    }
  }

  enemy.lastAttackTime = now;
  if (enemy.anim !== ('attack' as any)) enemy.anim = 'attack';
  enemy.animUntil = now + getEnemyAnimationDuration(enemy.name, 'attack');
  enemy.postAnim = 'sprint' as any;

  if (totalActualDamageDealt > 0) {
    const totalLifeSteal = Math.max(
      0,
      Number((enemy as any).lifeStealMeleePct) || 0
    );
    if (totalLifeSteal > 0) {
      let healAmount = Math.max(
        0,
        Math.round(totalActualDamageDealt * totalLifeSteal)
      );
      const capPerHit = Number((enemy as any)._lifeStealCapPerHit) || 0;
      if (capPerHit > 0) {
        healAmount = Math.min(healAmount, capPerHit);
      }
      if (healAmount > 0) {
        const oldHp = enemy.hp;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);
        const actualHealed = enemy.hp - oldHp;
        if (actualHealed > 0) {
          broadcaster.broadcast('life_steal_heal_enemy', {
            enemyId: enemy.id,
            healAmount: actualHealed,
            currentHp: enemy.hp,
            maxHp: enemy.maxHp,
            source: 'melee',
          });
        }
      }
    }
  }

  // Timestamp-based transition handled in update loop
}
