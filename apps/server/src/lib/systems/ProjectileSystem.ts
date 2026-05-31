import type { Room } from 'colyseus';
import {
  GameRoomState,
  ProjectileSchema,
  EnemySchema,
  PlayerSchema,
} from '../../schemas';
import {
  GAME_CONFIG,
  STAGING_INVULNERABILITY_MS,
  DEBUG_LOGS,
} from '../constants';
import { calculateDamageAfterMitigation } from '../player-stats';
import type { GameRoomApi } from '../../types/game-room-api';
import { handleEnemyDeath as handleEnemyDeathSystem } from './EnemyDeathSystem';
import {
  getEnemyCrit,
  rollCrit,
  getPlayerEvade,
  rollEvade,
  getEnemyEvade,
  getPlayerCrit,
  getPlayerSlow,
  getEnemySlow,
} from '../ability-utils';
import { getEnemyAnimationDuration } from '../../data/enemies';

import {
  shouldEnemyEvadeAttack,
  applyAuraDamageMitigation,
} from './EnemySystem';
import {
  applyMovementSlow,
  clearAllMovementSlowsImmediate,
  clearPoisonImmediate,
  handlePlayerZeroHp,
} from './StatusSystem';
import { ensureServerBroadcaster } from '../messaging';
import { handleOnHitSpells } from '../spell-system';
import type { GameRoom } from '../../rooms/GameRoom';
import { isPlayerDevInvincible } from '../debug';

function parseDerivedStats(
  player: PlayerSchema
): Record<string, any> | undefined {
  try {
    const parsed = JSON.parse(player.derivedStats || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function fireProjectileAtTarget(
  room: Room<GameRoomState>,
  playerId: string,
  player: PlayerSchema,
  targetX: number,
  targetY: number,
  damage: number = 10
) {
  // Do not spawn projectiles during room transitions or outside active gameplay
  try {
    const transitioning = Boolean((room as any)?.isRoomTransitioning);
    const phase = (room.state as any)?.phase;
    if (transitioning || phase !== 'in_game') {
      return;
    }
  } catch {}
  const broadcaster = ensureServerBroadcaster(room as any);
  const projectile = new ProjectileSchema();
  projectile.id = `projectile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  projectile.ownerId = playerId;
  projectile.x = player.x;
  projectile.y = player.y;
  const derivedStats = parseDerivedStats(player) || {};
  const activeWeaponSlug =
    typeof derivedStats?.activeWeaponSlug === 'string' &&
    derivedStats.activeWeaponSlug.trim().length > 0
      ? derivedStats.activeWeaponSlug.trim()
      : undefined;
  (projectile as any).weaponSlug = activeWeaponSlug;

  let finalDamage = damage;
  try {
    const crit = getPlayerCrit(
      player.characterId,
      'ranged',
      activeWeaponSlug,
      derivedStats
    );
    if (crit.chance > 0) {
      const didCrit = rollCrit(crit.chance);
      if (didCrit && crit.multiplier > 1) {
        finalDamage = Math.round(damage * crit.multiplier);
        (projectile as any).isCrit = true;
      }
    }
  } catch {}
  projectile.damage = finalDamage;
  projectile.createdAt = Date.now();

  const deltaX = targetX - player.x;
  const deltaY = targetY - player.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  if (distance > 0) {
    // Use pre-computed derived stats instead of recalculating
    const speed = derivedStats.projectileSpeed || 200;
    projectile.velocityX = (deltaX / distance) * speed;
    projectile.velocityY = (deltaY / distance) * speed;
  } else {
    // Use pre-computed derived stats instead of recalculating
    const speed = derivedStats.projectileSpeed || 200;
    projectile.velocityX = 0;
    projectile.velocityY = -speed;
  }

  room.state.projectiles.set(projectile.id, projectile);
}

export function fireEnemyProjectile(
  room: Room<GameRoomState>,
  enemy: EnemySchema,
  player: PlayerSchema,
  now: number
) {
  // Do not spawn projectiles during room transitions or outside active gameplay
  try {
    const transitioning = Boolean((room as any)?.isRoomTransitioning);
    const phase = (room.state as any)?.phase;
    if (transitioning || phase !== 'in_game') {
      return;
    }
  } catch {}
  const projectileId = `enemy_proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const projectile = new ProjectileSchema();
  projectile.id = projectileId;
  projectile.ownerId = enemy.id;
  projectile.x = enemy.x;
  projectile.y = enemy.y;
  projectile.damage = enemy.damage;
  projectile.createdAt = now;

  const deltaX = player.x - enemy.x;
  const deltaY = player.y - enemy.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const projectileSpeed = Number.isFinite(enemy.projectileSpeed)
    ? enemy.projectileSpeed
    : 200;
  if (distance > 0) {
    projectile.velocityX = (deltaX / distance) * projectileSpeed;
    projectile.velocityY = (deltaY / distance) * projectileSpeed;
  } else {
    // Fallback: shoot along facing direction if target overlaps source
    const dir = (enemy as any).dir as
      | 'left'
      | 'right'
      | 'up'
      | 'down'
      | undefined;
    if (dir === 'left') {
      projectile.velocityX = -projectileSpeed;
      projectile.velocityY = 0;
    } else if (dir === 'right') {
      projectile.velocityX = projectileSpeed;
      projectile.velocityY = 0;
    } else if (dir === 'down') {
      projectile.velocityX = 0;
      projectile.velocityY = projectileSpeed;
    } else {
      // default up
      projectile.velocityX = 0;
      projectile.velocityY = -projectileSpeed;
    }
  }
  if (!Number.isFinite(projectile.velocityX)) projectile.velocityX = 0;
  if (!Number.isFinite(projectile.velocityY))
    projectile.velocityY = -projectileSpeed;

  room.state.projectiles.set(projectileId, projectile);
  // Removed setDirty hint added during investigation
  // Removed debug broadcast added during investigation
}

export function updateProjectiles(room: Room<GameRoomState>, now: number) {
  // Avoid mutating/iterating projectile state during room transitions
  try {
    if ((room as any)?.isRoomTransitioning) {
      return;
    }
  } catch {}
  const broadcaster = ensureServerBroadcaster(room as any);
  const gameRoom = room as unknown as GameRoom;
  const deltaTime = 1 / 60;
  const projectilesToRemove: string[] = [];

  for (const [projectileId, projectile] of room.state.projectiles) {
    projectile.x += projectile.velocityX * deltaTime;
    projectile.y += projectile.velocityY * deltaTime;

    // Tick-scheduled cleanup for exploding projectiles (replaces setTimeout)
    const explodeAt = (projectile as any).explodeAt as number | undefined;
    if (
      (projectile as any).exploding &&
      typeof explodeAt === 'number' &&
      now >= explodeAt
    ) {
      projectilesToRemove.push(projectileId);
      continue;
    }

    if (
      projectile.x < 0 ||
      projectile.x > GAME_CONFIG.WORLD_WIDTH ||
      projectile.y < 0 ||
      projectile.y > GAME_CONFIG.WORLD_HEIGHT ||
      now - projectile.createdAt > 3000
    ) {
      // Only remove timed-out or out-of-bounds projectiles. Do not trigger
      // a cactus explosion here; reserve explosion animation for actual hits.
      projectilesToRemove.push(projectileId);
      continue;
    }

    if (
      projectile.ownerId.startsWith('enemy_') &&
      !(projectile as any).exploding
    ) {
      for (const [playerId, player] of room.state.players) {
        const distance = Math.sqrt(
          Math.pow(player.x - projectile.x, 2) +
            Math.pow(player.y - projectile.y, 2)
        );
        if (distance < 24) {
          try {
            const evade = getPlayerEvade(player.characterId, 'ranged');
            if (evade.chance > 0 && rollEvade(evade.chance)) {
              broadcaster.broadcast('attack_evaded', {
                attackerId: projectile.ownerId,
                targetId: playerId,
                timestamp: Date.now(),
                weaponType: 'ranged',
              });
              projectilesToRemove.push(projectileId);
              break;
            }
          } catch {}

          const ownerEnemy = room.state.enemies.get(projectile.ownerId);
          let damage = projectile.damage;
          try {
            if (ownerEnemy) {
              const baseCrit = getEnemyCrit(ownerEnemy.enemyType, 'ranged');
              const auraCrit = (ownerEnemy as any)._auraCrit?.ranged || {
                chance: 0,
                multiplier: 1,
              };
              const totalChance = Math.max(
                0,
                Math.min(1, (baseCrit?.chance || 0) + (auraCrit.chance || 0))
              );
              const totalMultiplier =
                Math.max(1, baseCrit?.multiplier || 1) +
                Math.max(0, (auraCrit.multiplier || 1) - 1);
              if (
                totalChance > 0 &&
                rollCrit(totalChance) &&
                totalMultiplier > 1
              ) {
                damage = Math.round(damage * totalMultiplier);
              }
            }
          } catch {}
          const { finalDamage } = calculateDamageAfterMitigation(
            player,
            damage
          );
          const runStartedAt = (room.state as any).runStartedAt;
          const phase = (room.state as any).phase;
          if (
            phase === 'in_game' &&
            typeof runStartedAt === 'number' &&
            runStartedAt > 0 &&
            Date.now() - runStartedAt < STAGING_INVULNERABILITY_MS
          ) {
            continue;
          }
          if (isPlayerDevInvincible(player)) {
            continue;
          }
          const leverage = gameRoom?.getLeverageTotal?.() ?? 1;
          const adjustedDamage = Math.max(
            0,
            Math.round(finalDamage * leverage)
          );
          if (adjustedDamage <= 0) {
            continue;
          }
          player.hp = Math.max(0, player.hp - adjustedDamage);

          if (adjustedDamage > 0 && ownerEnemy && player.hp > 0) {
            const slowSources = getEnemySlow(ownerEnemy.enemyType, 'ranged');
            if (slowSources.length > 0) {
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
          }

          if (adjustedDamage > 0) {
            gameRoom?.handleRoomLeverageEngagement?.('combat');
          }

          if (player.hp <= 0) {
            handlePlayerZeroHp(room, player, 'enemy_ranged');
          }
          if (ownerEnemy && ownerEnemy.enemyType === 'cactus') {
            (projectile as any).exploding = true;
            projectile.velocityX = 0;
            projectile.velocityY = 0;
            (projectile as any).explodeAt = now + 400;
          } else {
            projectilesToRemove.push(projectileId);
          }
          break;
        }
      }
    } else {
      for (const [enemyId, enemy] of room.state.enemies) {
        if (!enemy || enemy.hp <= 0) continue;
        const distance = Math.sqrt(
          Math.pow(enemy.x - projectile.x, 2) +
            Math.pow(enemy.y - projectile.y, 2)
        );
        if (distance < 24) {
          const nowTs = Date.now();
          if (shouldEnemyEvadeAttack(enemy as EnemySchema, 'ranged', nowTs)) {
            broadcaster.broadcast('attack_evaded', {
              attackerId: projectile.ownerId,
              targetId: enemyId,
              timestamp: nowTs,
              weaponType: 'ranged',
            });
            projectilesToRemove.push(projectileId);
            break;
          }
          try {
            const evade = getEnemyEvade(enemy.enemyType, 'ranged');
            if (evade.chance > 0 && rollEvade(evade.chance)) {
              broadcaster.broadcast('attack_evaded', {
                attackerId: projectile.ownerId,
                targetId: enemyId,
                timestamp: Date.now(),
                weaponType: 'ranged',
              });
              projectilesToRemove.push(projectileId);
              break;
            }
          } catch {}

          const mitigatedDamage = applyAuraDamageMitigation(
            enemy as EnemySchema,
            projectile.damage
          );
          const prevHp = enemy.hp;
          enemy.hp = Math.max(0, enemy.hp - mitigatedDamage);
          const actualDealt = Math.max(0, prevHp - enemy.hp);
          if (actualDealt > 0) {
            gameRoom?.handleRoomLeverageEngagement?.('combat');
            const projectileSlugRaw = (projectile as any).weaponSlug;
            if (typeof projectileSlugRaw === 'string') {
              (enemy as any).lastHitWeaponSlug = projectileSlugRaw;
            } else {
              delete (enemy as any).lastHitWeaponSlug;
            }

            const ownerPlayer = room.state.players.get(projectile.ownerId);
            let derivedStats: Record<string, any> | undefined;
            let weaponSlug: string | undefined;
            if (ownerPlayer) {
              derivedStats = parseDerivedStats(ownerPlayer) || undefined;
              weaponSlug =
                typeof projectileSlugRaw === 'string'
                  ? projectileSlugRaw
                  : undefined;
            }
            if (ownerPlayer && enemy.hp > 0) {
              const slowSources = getPlayerSlow(
                ownerPlayer.characterId,
                'ranged',
                weaponSlug,
                derivedStats
              );
              if (slowSources.length > 0) {
                let appliedSlowForBroadcast: {
                  amount: number;
                  durationMs: number;
                } | null = null;
                for (const slow of slowSources) {
                  if (slow.chance < 1 && Math.random() >= slow.chance) continue;
                  const result = applyMovementSlow(enemy, slow, now);
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
                if (appliedSlowForBroadcast && enemyId) {
                  broadcaster.broadcast('status_applied', {
                    targetId: enemyId,
                    type: 'slow',
                    amount: appliedSlowForBroadcast.amount,
                    durationMs: appliedSlowForBroadcast.durationMs,
                  });
                }
              }
            }
            if (ownerPlayer) {
              handleOnHitSpells(gameRoom, ownerPlayer, {
                targetId: enemyId,
                target: enemy,
                damageDealt: actualDealt,
                baseDamage: projectile.damage,
                weaponType: 'ranged',
                derivedStats,
                activeWeaponSlug: weaponSlug,
              });
            }

            // Only broadcast damage and play hurt animation when damage was dealt
            // Derive attacker direction from projectile velocity
            const absVx = Math.abs(projectile.velocityX);
            const absVy = Math.abs(projectile.velocityY);
            let attackerDir: 'left' | 'right' | 'up' | 'down' = 'right';
            if (absVx >= absVy) {
              attackerDir = projectile.velocityX >= 0 ? 'right' : 'left';
            } else {
              attackerDir = projectile.velocityY >= 0 ? 'down' : 'up';
            }
            const hurtDuration = Math.max(
              100,
              Number(getEnemyAnimationDuration(enemy.name, 'hurt') || 500)
            );
            broadcaster.broadcast('enemy_damaged', {
              enemyId,
              damage: mitigatedDamage,
              hp: enemy.hp,
              maxHp: enemy.maxHp,
              attackerId: projectile.ownerId,
              weaponType: 'ranged',
              isCrit: !!(projectile as any).isCrit,
              attackerDir,
              interval: hurtDuration,
              killed: enemy.hp <= 0,
            });
            // Schedule animation transition in main tick instead of using setTimeout
            if (enemy.anim !== ('hurt' as any)) enemy.anim = 'hurt';
            (enemy as any).animUntil = now + hurtDuration;
            (enemy as any).postAnim = 'idle';
            enemy.nextMoveTime = Math.max(
              enemy.nextMoveTime,
              now + hurtDuration
            );

            if (enemy.hp <= 0) {
              try {
                clearAllMovementSlowsImmediate(room, enemy);
                clearPoisonImmediate(room, enemy);
              } catch {}
              const gameRoom = room as unknown as {
                handleEnemyDeath?: (
                  enemy: any,
                  enemyId: string,
                  attackType: 'melee' | 'ranged' | 'grenades',
                  killerId?: string
                ) => Promise<void> | void;
              };

              if (typeof gameRoom.handleEnemyDeath === 'function') {
                void gameRoom.handleEnemyDeath(
                  enemy,
                  enemyId,
                  'ranged',
                  projectile.ownerId
                );
              } else {
                void handleEnemyDeathSystem(
                  room,
                  enemy,
                  enemyId,
                  'ranged',
                  projectile.ownerId
                );
              }
            }
          }
          // Directly mutate enemy's aggro fields to avoid untyped room API
          enemy.forcedAggro = true as any;
          enemy.aggroTargetPlayerId = projectile.ownerId as any;
          enemy.targetPlayerId = projectile.ownerId as any;
          enemy.isCharging = true;
          enemy.chargeEndTime = Date.now() + 3000;
          projectilesToRemove.push(projectileId);
          break;
        }
      }
    }
  }

  projectilesToRemove.forEach((id) => {
    room.state.projectiles.delete(id);
  });
}
