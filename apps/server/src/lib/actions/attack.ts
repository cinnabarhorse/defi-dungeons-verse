import type { EntitySchema, EnemySchema, PlayerSchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { getCharacterStats } from '../character-registry';
import { computeBaseDamageForCharacter } from '../combat-utils';
import { BaseInteractiveAction } from './interactive';
import { ActionResult, type CombatActionType } from './types';
import {
  computePlayerDamageWithCrit,
  applyPlayerLifeSteal,
} from '../ability-handlers';
import {
  getPlayerCleave,
  getEnemyEvade,
  isWithinCone,
  rollEvade,
  getPlayerSlow,
  getPlayerStun,
} from '../ability-utils';
import {
  shouldEnemyEvadeAttack,
  applyAuraDamageMitigation,
  applyEnemyIncomingDamageModifiers,
} from '../systems/EnemySystem';
import {
  applyMovementSlow,
  applyStunStatus,
  isEntityStunned,
} from '../systems/StatusSystem';
import { GAME_CONFIG } from '../constants';
import type { EquipmentSlotName } from '../equipment-service';
import type { QualityTier } from '../../data/wearable-quality';
import type { EquippedWearableWithQuality } from '../../data/wearables';
const DEBUG = process.env.DEBUG === '1';

interface CombatConfig {
  interval: number;
  range: number;
  damage: number;
  emoji: string;
  actionVerb: string;
}

const COMBAT_CONFIGS: Record<string, CombatConfig> = {
  melee: {
    interval: 1000,
    range: 80,
    damage: 10,
    emoji: '⚔️',
    actionVerb: 'attacking',
  },
  ranged: {
    interval: 800,
    range: 110,
    damage: 8,
    emoji: '🏹',
    actionVerb: 'shooting',
  },
};

export class AttackEnemyAction extends BaseInteractiveAction {
  private readonly combatConfig: CombatConfig;
  private readonly weaponType: 'melee' | 'ranged';
  private readonly derivedStats: Record<string, any> | null;
  private readonly damageRange: { min: number; max: number } | null;

  constructor(
    actionType: CombatActionType,
    targetId: string,
    weaponType: string = 'melee',
    characterId?: string,
    options?: { derivedStats?: Record<string, any> | null }
  ) {
    const config = COMBAT_CONFIGS[weaponType] || COMBAT_CONFIGS.melee;
    const weaponTypeTyped = weaponType as 'melee' | 'ranged';
    const derivedStats = options?.derivedStats ?? null;
    const charStats = characterId ? getCharacterStats(characterId) : undefined;

    // Attempt to recompute character stats using the equipment snapshot embedded
    // in derivedStats to avoid stale ranges after equipment-effect code changes.
    const recomputedWithEquip = (() => {
      try {
        if (!characterId || !derivedStats) return undefined as any;
        type DerivedEquipmentItem = {
          slot?: string | null;
          slug?: string | null;
          quality?: QualityTier | null;
        };
        const items: DerivedEquipmentItem[] = Array.isArray(
          (derivedStats as any)?.equipment?.items
        )
          ? ((derivedStats as any).equipment.items as DerivedEquipmentItem[])
          : [];
        const equippedWearablesWithQuality: EquippedWearableWithQuality[] = [];
        for (const item of items) {
          const slotStr =
            typeof item.slot === 'string' && item.slot
              ? (item.slot as string)
              : null;
          const slug = typeof item.slug === 'string' ? item.slug : '';
          if (!slotStr || !slug) continue;
          equippedWearablesWithQuality.push({
            slot: slotStr as EquipmentSlotName,
            slug,
            quality: (item.quality as QualityTier | null) ?? undefined,
          });
        }
        if (equippedWearablesWithQuality.length === 0) return undefined as any;
        return getCharacterStats(characterId, {
          equippedWearablesWithQuality,
        });
      } catch {
        return undefined as any;
      }
    })();

    // Prefer derived stats (server-authoritative, includes equipment + progression)
    const derivedRange = (() => {
      if (!derivedStats) return undefined as number | undefined;
      const val =
        weaponTypeTyped === 'ranged'
          ? (derivedStats as any).rangedAttackRange
          : (derivedStats as any).meleeAttackRange;
      return typeof val === 'number' && Number.isFinite(val) && val > 0
        ? Math.floor(val)
        : undefined;
    })();

    const charRange = (() => {
      const source = recomputedWithEquip || charStats;
      if (!source) return undefined as number | undefined;
      const val =
        weaponTypeTyped === 'ranged'
          ? (source as any).rangedAttackRange
          : (source as any).meleeAttackRange;
      return typeof val === 'number' && Number.isFinite(val) && val > 0
        ? Math.floor(val)
        : undefined;
    })();

    const attackRange = derivedRange ?? charRange ?? config.range;

    console.log('attackRange:', attackRange);

    const attackInterval =
      // Prefer active weapon attackSpeed if present in derived snapshot
      (typeof (derivedStats as any)?.activeWeapon?.attackSpeed === 'number'
        ? (derivedStats as any).activeWeapon.attackSpeed
        : undefined) ??
      derivedStats?.attackSpeed ??
      charStats?.attackSpeed ??
      config.interval;
    const damage = derivedStats?.damage ?? charStats?.damage ?? config.damage;
    const damageRange =
      derivedStats?.damageRange ?? charStats?.damageRange ?? null;
    super(actionType, targetId, {
      interval: attackInterval,
      range: attackRange,
      emoji: config.emoji,
      actionVerb: config.actionVerb,
      animation: weaponTypeTyped === 'ranged' ? 'attack_ranged' : 'attack',
    });
    this.weaponType = weaponTypeTyped;
    this.derivedStats = derivedStats;
    this.damageRange =
      damageRange ?? (damage ? { min: damage, max: damage } : null);
    this.combatConfig = { ...config, range: attackRange, damage };
  }

  // Approach slightly inside the computed attack range to avoid off-by-one/latency edge cases
  protected getEffectiveRange(
    _player: PlayerSchema,
    _gameRoom: GameRoom
  ): number {
    const bufferPx = this.weaponType === 'melee' ? 12 : 8;
    return Math.max(0, this.interactionRange - bufferPx);
  }

  validateTarget(target: EntitySchema): boolean {
    if (target.kind !== 'enemy') {
      console.warn(`${this.emoji} Entity ${this.targetId} is not an enemy`);
      return false;
    }
    const enemyState = JSON.parse(target.state || '{}');
    if (enemyState.health <= 0) {
      console.warn(`${this.emoji} Enemy ${this.targetId} is already dead`);
      return false;
    }
    return true;
  }

  canStartInteraction(player: PlayerSchema, _gameRoom: GameRoom): boolean {
    // Block starting attacks during room transitions
    try {
      if (Boolean(((_gameRoom as any) || {}).isRoomTransitioning)) {
        return false;
      }
    } catch {}
    if (player.hp <= 0) {
      console.warn(
        `${this.emoji} Player ${player.name} is dead and cannot attack`
      );
      return false;
    }
    const now = (_gameRoom as any).now ?? Date.now();
    if (isEntityStunned(player, now)) {
      console.warn(
        `${this.emoji} Player ${player.name} is stunned and cannot attack`
      );
      return false;
    }
    return true;
  }

  performInteraction(player: PlayerSchema, gameRoom: GameRoom): any {
    // Cancel interactions while transitioning rooms to avoid race conditions
    try {
      if (Boolean(((gameRoom as any) || {}).isRoomTransitioning)) {
        return {
          result: ActionResult.CANCELLED,
          message: 'Room transitioning',
        };
      }
    } catch {}
    const enemyTarget = gameRoom.state.enemies.get(this.targetId);
    if (!enemyTarget)
      return { result: 'failed', message: 'Enemy no longer exists' };

    const nowCheck = (gameRoom as any).now ?? Date.now();
    if (isEntityStunned(player, nowCheck)) {
      return {
        result: ActionResult.CANCELLED,
        message: 'Player is stunned',
      };
    }

    const derivedSnapshot =
      this.derivedStats ??
      (() => {
        try {
          const parsed = JSON.parse(player.derivedStats || '{}');
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
          return {};
        }
      })();
    const activeWeaponSlugRaw =
      typeof derivedSnapshot?.activeWeaponSlug === 'string'
        ? derivedSnapshot.activeWeaponSlug.trim()
        : '';
    const activeWeaponSlug =
      activeWeaponSlugRaw.length > 0 ? activeWeaponSlugRaw : undefined;

    const maxRange = this.interactionRange;
    const distance = this.calculateDistance(player, enemyTarget);
    if (distance > maxRange) {
      return {
        result: 'failed',
        message: `Enemy out of range (${distance.toFixed(1)}px > ${maxRange}px)`,
      };
    }

    if (this.weaponType === 'ranged') {
      try {
        const slug = activeWeaponSlug || 'unknown';
        const idx = Number.isFinite(player.activeWeaponIndex)
          ? player.activeWeaponIndex
          : -1;
        console.log(
          `🏹 ATTACK (ranged) player=${player.name} char=${player.characterId} slug=${slug} index=${idx} attackType=${this.weaponType} dist=${distance.toFixed(
            1
          )} maxRange=${maxRange} enemy=${enemyTarget.id} ${enemyTarget.enemyType}`
        );
      } catch {
        console.log('something went wrong with the ranged attack');
      }

      // Gate ranged shots by explored tiles
      try {
        const tileX = Math.floor(enemyTarget.x / GAME_CONFIG.TILE_SIZE);
        const tileY = Math.floor(enemyTarget.y / GAME_CONFIG.TILE_SIZE);

        const roomApi = gameRoom as unknown as {
          isTileDiscovered?: (x: number, y: number) => boolean;
        };
        if (typeof roomApi.isTileDiscovered === 'function') {
          const discovered = roomApi.isTileDiscovered(tileX, tileY);
          if (!discovered) {
            return {
              result: 'failed',
              message: 'Target tile unexplored',
            } as any;
          }
        }
      } catch {}

      const startTs = (gameRoom as any).now ?? Date.now();
      const durationMs = this.interactionInterval;
      gameRoom.msg.broadcast('attack_started', {
        attackerId: player.id,
        targetId: this.targetId,
        timestamp: startTs,
        durationMs,
        hitOffsetMs: 0,
        direction: player.dir,
        weaponType: this.weaponType,
      });
      {
        const {
          fireProjectileAtTarget,
        } = require('../systems/ProjectileSystem');
        const baseDamage = computeBaseDamageForCharacter(
          player.characterId,
          this.combatConfig.damage,
          this.derivedStats
        );
        fireProjectileAtTarget(
          gameRoom,
          player.id,
          player,
          enemyTarget.x,
          enemyTarget.y,
          baseDamage
        );
      }
      return { result: 'continue' } as any;
    }

    const startTs = (gameRoom as any).now ?? Date.now();
    const durationMs = this.interactionInterval;
    let hitOffsetMs = Math.floor(durationMs * 0.25);
    try {
      const derived = this.derivedStats || {};
      const profile: any = (derived as any)?.activeWeapon?.attackAnimProfile;
      if (
        profile &&
        typeof profile.totalFrames === 'number' &&
        profile.totalFrames > 0 &&
        typeof profile.impactFrameIndex === 'number'
      ) {
        hitOffsetMs = Math.floor(
          durationMs * (profile.impactFrameIndex / profile.totalFrames)
        );
      }
    } catch {}
    hitOffsetMs = Math.max(0, Math.min(durationMs - 1, hitOffsetMs));
    gameRoom.msg.broadcast('attack_started', {
      attackerId: player.id,
      targetId: this.targetId,
      timestamp: startTs,
      durationMs,
      hitOffsetMs,
      direction: player.dir,
      weaponType: this.weaponType,
      // Include minimal profile data for clients if needed for effects (optional)
      weaponAnimProfile: (() => {
        try {
          const derived = this.derivedStats || {};
          const p: any = (derived as any)?.activeWeapon?.attackAnimProfile;
          if (
            p &&
            typeof p.totalFrames === 'number' &&
            typeof p.impactFrameIndex === 'number'
          ) {
            return {
              totalFrames: p.totalFrames,
              impactFrameIndex: p.impactFrameIndex,
              frameRateBase: p.frameRateBase,
            };
          }
        } catch {}
        return undefined;
      })(),
    });
    try {
      const slug = activeWeaponSlug || 'unknown';
      const idx = Number.isFinite(player.activeWeaponIndex)
        ? player.activeWeaponIndex
        : -1;
      console.log(
        `⚔️ ATTACK (melee) player=${player.name} char=${player.characterId} slug=${slug} index=${idx} attackType=${this.weaponType} dist=${distance.toFixed(
          1
        )} maxRange=${maxRange}`
      );
    } catch {}

    setTimeout(() => {
      const slowSources =
        this.weaponType === 'melee'
          ? getPlayerSlow(
              player.characterId,
              'melee',
              activeWeaponSlug,
              derivedSnapshot
            )
          : [];
      const stunSources =
        this.weaponType === 'melee'
          ? getPlayerStun(
              player.characterId,
              'melee',
              activeWeaponSlug,
              derivedSnapshot
            )
          : [];
      // Determine cleave settings for the player
      const cleave = getPlayerCleave(
        player.characterId,
        'melee',
        activeWeaponSlug,
        derivedSnapshot
      );
      const coneAngle = cleave.coneAngleDeg ?? 100; // default ~100° arc

      // Build list of enemy targets within melee range and inside cone
      const enemyTargets: Array<{ id: string; ref: any }> = [];
      for (const [enemyId, enemy] of gameRoom.state.enemies) {
        if (!enemy || enemy.hp <= 0) continue;
        const dist = Math.sqrt(
          Math.pow(enemy.x - player.x, 2) + Math.pow(enemy.y - player.y, 2)
        );
        if (dist > this.interactionRange) continue;
        if (
          !isWithinCone(
            player.x,
            player.y,
            player.dir,
            enemy.x,
            enemy.y,
            coneAngle
          )
        )
          continue;
        enemyTargets.push({ id: enemyId, ref: enemy });
      }

      // Sort by distance ascending for deterministic capping
      enemyTargets.sort((a, b) => {
        const da = Math.hypot(a.ref.x - player.x, a.ref.y - player.y);
        const db = Math.hypot(b.ref.x - player.x, b.ref.y - player.y);
        return da - db;
      });

      // Apply max targets (if any). Ensure at least the original target is included
      let finalTargets = enemyTargets;
      if (cleave.enabled) {
        if (typeof cleave.maxTargets === 'number') {
          // Ensure the originally selected target is prioritized
          finalTargets = [];
          const primary = gameRoom.state.enemies.get(this.targetId);
          if (primary && primary.hp > 0) {
            finalTargets.push({ id: this.targetId, ref: primary });
          }
          for (const t of enemyTargets) {
            if (finalTargets.find((x) => x.id === t.id)) continue;
            if (finalTargets.length >= cleave.maxTargets) break;
            finalTargets.push(t);
          }
        }
      } else {
        // No cleave: only the original target
        const targetEnemy = gameRoom.state.enemies.get(this.targetId);
        if (!targetEnemy || targetEnemy.hp <= 0) return;
        finalTargets = [{ id: this.targetId, ref: targetEnemy }];
      }

      let totalActualDamageDealt = 0;

      for (const target of finalTargets) {
        const nowTs = (gameRoom as any).now ?? Date.now();
        if (
          shouldEnemyEvadeAttack(
            target.ref as EnemySchema,
            this.weaponType,
            nowTs
          )
        ) {
          gameRoom.setEnemyAggro(target.id, player.id);
          gameRoom.msg.broadcast('attack_evaded', {
            attackerId: player.id,
            targetId: target.id,
            timestamp: nowTs,
            weaponType: this.weaponType,
          });
          continue;
        }
        const enemyType = target.ref.enemyType || '';
        try {
          const evade = getEnemyEvade(enemyType, this.weaponType);
          if (evade.chance > 0 && rollEvade(evade.chance)) {
            gameRoom.setEnemyAggro(target.id, player.id);
            gameRoom.msg.broadcast('attack_evaded', {
              attackerId: player.id,
              targetId: target.id,
              timestamp: nowTs,
              weaponType: this.weaponType,
            });
            continue;
          }
        } catch {}

        const base = computeBaseDamageForCharacter(
          player.characterId,
          this.combatConfig.damage,
          this.derivedStats
        );
        const { damage: critAdjusted, isCrit } = computePlayerDamageWithCrit(
          player,
          base,
          'melee',
          activeWeaponSlug,
          derivedSnapshot
        );
        const baseDamageToApply = Math.max(
          0,
          Math.round(
            critAdjusted * (cleave.enabled ? cleave.damageMultiplier : 1)
          )
        );
        const scaledDamage = applyEnemyIncomingDamageModifiers(
          target.ref as EnemySchema,
          baseDamageToApply
        );
        const mitigatedDamage = applyAuraDamageMitigation(
          target.ref as EnemySchema,
          scaledDamage
        );

        const prevHp = target.ref.hp;
        target.ref.hp = Math.max(0, target.ref.hp - mitigatedDamage);
        const actualDealt = Math.max(0, prevHp - target.ref.hp);
        totalActualDamageDealt += actualDealt;

        if (actualDealt > 0) {
          // Always set aggro when damage is dealt
          gameRoom.setEnemyAggro(target.id, player.id);

          if (activeWeaponSlug) {
            (target.ref as any).lastHitWeaponSlug = activeWeaponSlug;
          } else {
            delete (target.ref as any).lastHitWeaponSlug;
          }

          if (slowSources.length > 0 && target.ref.hp > 0) {
            let appliedSlowForBroadcast: {
              amount: number;
              durationMs: number;
            } | null = null;
            for (const slow of slowSources) {
              if (slow.chance < 1 && Math.random() >= slow.chance) continue;
              const result = applyMovementSlow(
                target.ref as EnemySchema,
                slow,
                nowTs
              );
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
            if (appliedSlowForBroadcast) {
              gameRoom.msg.broadcast('status_applied', {
                targetId: target.id,
                type: 'slow',
                amount: appliedSlowForBroadcast.amount,
                durationMs: appliedSlowForBroadcast.durationMs,
              });
            }
          }
          if (stunSources.length > 0 && target.ref.hp > 0) {
            let appliedStunForBroadcast = false;
            let stunBroadcastDuration = 0;
            for (const stun of stunSources) {
              if (stun.chance < 1 && Math.random() >= stun.chance) continue;
              const stunResult = applyStunStatus(
                gameRoom,
                target.ref as EnemySchema,
                stun,
                nowTs,
                { attackerId: player.id }
              );
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
            if (appliedStunForBroadcast) {
              gameRoom.msg.broadcast('status_applied', {
                targetId: target.id,
                type: 'stun',
                durationMs: stunBroadcastDuration,
              });
            }
          }
        }

        if (target.ref.hp <= 0) {
          void gameRoom.handleEnemyDeath(
            target.ref,
            target.id,
            this.weaponType,
            player.id
          );
        } else {
          setTimeout(() => {
            if (gameRoom.state.enemies.has(target.id)) {
              const e = gameRoom.state.enemies.get(target.id);
              if (e && e.hp > 0) {
                e.anim = 'idle';
                e.nextMoveTime = ((gameRoom as any).now ?? Date.now()) + 500;
              }
            }
          }, 500);
        }
      }

      // Optionally include breakables in the cone
      if (cleave.enabled && cleave.includeBreakables) {
        try {
          for (const [entityId, entity] of gameRoom.state.entities) {
            if (entity.kind !== 'obstacle') continue;
            const st = JSON.parse(entity.state || '{}');
            if (st.type !== 'tree' && st.type !== 'stone') continue;
            const dist = Math.hypot(entity.x - player.x, entity.y - player.y);
            if (dist > this.interactionRange) continue;
            if (
              !isWithinCone(
                player.x,
                player.y,
                player.dir,
                entity.x,
                entity.y,
                coneAngle
              )
            )
              continue;
            // Use generic harvest system (reduces health by 1 per swing)
            (gameRoom as any).performResourceHarvest?.(
              player.id,
              entityId,
              st.type
            );
          }
        } catch {}
      }

      if (this.weaponType === 'melee' && totalActualDamageDealt > 0) {
        applyPlayerLifeSteal(
          gameRoom,
          player,
          totalActualDamageDealt,
          'melee',
          activeWeaponSlug,
          derivedSnapshot
        );
      }
    }, hitOffsetMs);

    if (this.weaponType === 'melee') {
      setTimeout(() => {
        if (gameRoom.state.enemies.has(this.targetId)) {
          const enemy = gameRoom.state.enemies.get(this.targetId);
          if (enemy && enemy.hp > 0) {
            enemy.anim = 'idle';
            enemy.nextMoveTime = ((gameRoom as any).now ?? Date.now()) + 500;
          }
        }
      }, 500);
    }

    return { result: 'continue' } as any;
  }
}
