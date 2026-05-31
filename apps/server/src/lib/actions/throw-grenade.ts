import { BaseAction } from './base';
import { ActionResult, ActionType } from './types';
import type { PlayerSchema } from '../../schemas';
import type { GameRoom } from '../../rooms/GameRoom';
import { getCharacterStats } from '../character-registry';
import type { GrenadeWeaponDefinition } from '../../data/weapons';
import { handleEnemyDeath as handleEnemyDeathSystem } from '../systems/EnemyDeathSystem';
import { computeGrenadeDamage } from '../grenades/utils';
import type { Animation } from '../../types';
import { extractWearableSlugs } from '../equipment-service';
import { getWearableBySlug } from '../../data/wearables';
import { getPlayerStun } from '../ability-utils';
import { applyStunStatus, isEntityStunned } from '../systems/StatusSystem';

interface ThrowGrenadePayload {
  wearableSlug?: string;
  wearableId?: string | number;
  target?: {
    x: number;
    y: number;
  };
}

const GRENADE_COOLDOWNS = new Map<string, number>();

function getCooldownKey(
  roomId: string,
  playerId: string,
  wearableSlug: string
): string {
  return `${roomId}:${playerId}:${wearableSlug}`;
}

function normalizeWearableSlug(
  payload: ThrowGrenadePayload | undefined
): string {
  if (!payload) return '';
  if (
    typeof payload.wearableSlug === 'string' &&
    payload.wearableSlug.length > 0
  ) {
    return payload.wearableSlug;
  }
  if (payload.wearableId !== undefined) {
    return String(payload.wearableId);
  }
  return '';
}

function parseTarget(payload: ThrowGrenadePayload | undefined): {
  x: number;
  y: number;
} {
  const target = payload?.target;
  const x = typeof target?.x === 'number' ? target.x : Number(target?.x);
  const y = typeof target?.y === 'number' ? target.y : Number(target?.y);
  return { x, y };
}

function hasSufficientMana(player: PlayerSchema, cost: number): boolean {
  const normalized = Math.max(0, Math.floor(cost || 0));
  const current = Math.floor((player.mana as number) || 0);
  return current >= normalized;
}

function spendMana(player: PlayerSchema, cost: number) {
  const normalized = Math.max(0, Math.floor(cost || 0));
  const current = Math.floor((player.mana as number) || 0);
  player.mana = Math.max(0, current - normalized);
}

export class ThrowGrenadeAction extends BaseAction {
  private readonly wearableSlug: string;
  private targetX: number;
  private targetY: number;
  private grenadeConfig: GrenadeWeaponDefinition | null = null;
  private readonly grenadeId: string;
  private resolvedTarget: { x: number; y: number } | null = null;
  private travelDistance = 0;
  private hasScheduledExplosion = false;
  private cooldownMs = 0;

  constructor(payload: ThrowGrenadePayload | undefined) {
    const wearableSlug = normalizeWearableSlug(payload);
    super(ActionType.THROW_GRENADE, wearableSlug || 'grenade', 'throw');
    const { x, y } = parseTarget(payload);
    this.wearableSlug = wearableSlug;
    this.targetX = x;
    this.targetY = y;
    this.grenadeId = `gren_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private ensureConfig(player: PlayerSchema): GrenadeWeaponDefinition | null {
    if (this.grenadeConfig) {
      return this.grenadeConfig;
    }

    // Prefer resolving directly from the wearable definition to avoid
    // relying on character base stats (which may omit equipped grenades).
    const wearable = getWearableBySlug(this.wearableSlug);
    const wearableGrenade =
      wearable?.weapon?.weaponType === 'grenades'
        ? wearable.weapon.grenade
        : undefined;
    if (wearableGrenade) {
      this.grenadeConfig = { ...wearableGrenade };
      this.cooldownMs = Math.max(0, this.grenadeConfig.cooldownMs || 0);
      return this.grenadeConfig;
    }

    // Fallback: derive via character stats
    if (!player?.characterId) {
      return null;
    }
    const stats = getCharacterStats(player.characterId);
    const weapon = stats.weapons.find(
      (entry) => entry.slug === this.wearableSlug
    );
    if (!weapon || weapon.weaponType !== 'grenades' || !weapon.grenade) {
      return null;
    }

    this.grenadeConfig = { ...weapon.grenade };
    this.cooldownMs = Math.max(0, weapon.grenade.cooldownMs || 0);
    return this.grenadeConfig;
  }

  private playerHasWearable(player: PlayerSchema): boolean {
    if (!player?.equippedWearables) return false;
    const slugs = extractWearableSlugs(player.equippedWearables);
    return slugs.includes(this.wearableSlug);
  }

  canStart(player: PlayerSchema, gameRoom: GameRoom): boolean {
    if (!player || player.hp <= 0) {
      console.warn(
        '🧨 Player is unable to throw grenades right now (dead or missing)'
      );
      return false;
    }

    if (isEntityStunned(player, Date.now())) {
      console.warn('🧨 Player is stunned and cannot throw grenades right now');
      return false;
    }

    if (!this.wearableSlug) {
      console.warn('🧨 Grenade action missing wearable slug');
      return false;
    }

    if (!Number.isFinite(this.targetX) || !Number.isFinite(this.targetY)) {
      console.warn('🧨 Invalid grenade target coordinates');
      return false;
    }

    if (!this.playerHasWearable(player)) {
      console.warn(
        `🧨 Player ${player.id} tried to throw grenade ${this.wearableSlug} without equipping it`
      );
      return false;
    }

    const config = this.ensureConfig(player);
    if (!config) {
      console.warn(
        `🧨 No grenade configuration found for wearable ${this.wearableSlug}, cannot throw.`
      );
      return false;
    }

    const manaCost = Math.max(0, Math.floor((config as any).manaCost || 0));
    if (manaCost > 0 && !hasSufficientMana(player, manaCost)) {
      console.warn(
        `🧨 Insufficient mana to throw ${this.wearableSlug} (need ${manaCost}, have ${Math.floor(
          (player.mana as number) || 0
        )})`
      );
      return false;
    }

    const cooldownKey = getCooldownKey(
      gameRoom.roomId,
      player.id,
      this.wearableSlug
    );
    const readyAt = GRENADE_COOLDOWNS.get(cooldownKey) ?? 0;
    const now = Date.now();
    if (now < readyAt) {
      const remaining = readyAt - now;
      console.warn(
        `🧨 Grenade ${this.wearableSlug} on cooldown for ${remaining}ms (player ${player.id})`
      );
      return false;
    }

    return true;
  }

  private clampTargetToRange(
    player: PlayerSchema,
    config: GrenadeWeaponDefinition
  ) {
    const originX = player.x;
    const originY = player.y;
    const dx = this.targetX - originX;
    const dy = this.targetY - originY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxRange = config.maxRangePx ?? 1000;

    if (distance === 0 || !Number.isFinite(distance)) {
      this.resolvedTarget = { x: originX, y: originY };
      this.travelDistance = 0;
      return;
    }

    if (distance <= maxRange) {
      this.resolvedTarget = { x: this.targetX, y: this.targetY };
      this.travelDistance = distance;
      return;
    }

    const ratio = maxRange / distance;
    this.resolvedTarget = {
      x: originX + dx * ratio,
      y: originY + dy * ratio,
    };
    this.travelDistance = maxRange;
  }

  private setPlayerDirectionTowardTarget(player: PlayerSchema) {
    if (!this.resolvedTarget) return;
    const dx = this.resolvedTarget.x - player.x;
    const dy = this.resolvedTarget.y - player.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      player.dir = dx >= 0 ? 'right' : 'left';
    } else {
      player.dir = dy >= 0 ? 'down' : 'up';
    }
  }

  onStart(player: PlayerSchema, gameRoom: GameRoom): void {
    super.onStart(player, gameRoom);
    const config = this.ensureConfig(player);
    if (!config) {
      return;
    }

    this.clampTargetToRange(player, config);
    this.setPlayerDirectionTowardTarget(player);

    const cooldownKey = getCooldownKey(
      gameRoom.roomId,
      player.id,
      this.wearableSlug
    );
    GRENADE_COOLDOWNS.set(cooldownKey, Date.now() + (config.cooldownMs || 0));

    player.anim = 'throw' as Animation;

    const resolved = this.resolvedTarget ?? { x: player.x, y: player.y };
    const throwSpeed =
      config.throwSpeedPxPerSec > 0 ? config.throwSpeedPxPerSec : 600;
    const travelTimeMs = Math.round((this.travelDistance / throwSpeed) * 1000);
    const fuseMs = config.fuseMs ?? 0;
    const explosionDelay = Math.max(0, travelTimeMs + fuseMs);
    this.cooldownMs = config.cooldownMs || 0;

    const now = Date.now();
    const origin = { x: player.x, y: player.y };

    const manaCost = Math.max(0, Math.floor((config as any).manaCost || 0));
    if (manaCost > 0) {
      if (!hasSufficientMana(player, manaCost)) {
        // Double-check in case of race; abort without broadcasting
        return;
      }
      spendMana(player, manaCost);
      try {
        if (
          player.mana <= 0 &&
          typeof (gameRoom as any).tryAutoRestoreMana === 'function'
        ) {
          (gameRoom as any).tryAutoRestoreMana(player);
        }
      } catch {
        // ignore auto-restore errors
      }
    }

    gameRoom.msg.broadcast('grenade_thrown', {
      grenadeId: this.grenadeId,
      playerId: player.id,
      wearableSlug: this.wearableSlug,
      origin,
      target: resolved,
      timestamp: now,
      travelTimeMs,
      fuseMs,
      cooldownMs: this.cooldownMs,
      blastRadius: config.blastRadiusPx,
    });

    this.hasScheduledExplosion = true;

    setTimeout(() => {
      try {
        this.handleExplosion(gameRoom, player.id, config, resolved);
      } catch (error) {
        console.error('🧨 Error resolving grenade explosion', error);
      }
    }, explosionDelay);
  }

  private handleExplosion(
    gameRoom: GameRoom,
    throwerId: string,
    config: GrenadeWeaponDefinition,
    impactPoint: { x: number; y: number }
  ) {
    const healingConfig = config.healingSplash;
    if (healingConfig) {
      this.resolveHealingSplash(
        gameRoom,
        throwerId,
        config,
        healingConfig,
        impactPoint
      );
      return;
    }

    this.resolveDamageExplosion(gameRoom, throwerId, config, impactPoint);
  }

  private resolveDamageExplosion(
    gameRoom: GameRoom,
    throwerId: string,
    config: GrenadeWeaponDefinition,
    impactPoint: { x: number; y: number }
  ) {
    const now = Date.now();
    const radius = Math.max(0, config.blastRadiusPx);
    const impactedEnemies: Array<{
      enemyId: string;
      damage: number;
      hp: number;
      maxHp: number;
    }> = [];
    const impactedPlayers: Array<{
      playerId: string;
      damage: number;
      hp: number;
      maxHp: number;
    }> = [];
    const thrower = gameRoom.state.players.get(throwerId);
    const parsedDerivedStats =
      (() => {
        if (!thrower) return undefined;
        try {
          const parsed = JSON.parse(thrower.derivedStats || '{}');
          return parsed && typeof parsed === 'object' ? parsed : undefined;
        } catch {
          return undefined;
        }
      })() ?? undefined;
    const stunSources =
      thrower && thrower.characterId
        ? getPlayerStun(
            thrower.characterId,
            'grenades',
            this.wearableSlug,
            parsedDerivedStats
          )
        : [];

    for (const [enemyId, enemy] of gameRoom.state.enemies) {
      if (!enemy || enemy.hp <= 0) continue;
      const dx = enemy.x - impactPoint.x;
      const dy = enemy.y - impactPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(distance) || distance > radius) continue;

      const damage = computeGrenadeDamage(distance, config);
      if (damage <= 0) continue;

      gameRoom.handleRoomLeverageEngagement('combat');
      enemy.hp = Math.max(0, enemy.hp - damage);
      enemy.anim = 'hurt';

      gameRoom.msg.broadcast('enemy_damaged', {
        enemyId,
        damage,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        attackerId: throwerId,
        weaponType: 'grenades',
        isCrit: false,
        attackerDir: enemy.dir,
        interval: this.cooldownMs,
        // New: indicate this explosion killed the enemy
        killed: enemy.hp <= 0,
      });

      enemy.forcedAggro = true;
      enemy.aggroTargetPlayerId = throwerId;
      enemy.targetPlayerId = throwerId;
      enemy.isCharging = true;
      enemy.chargeEndTime = now + 3000;

      if (stunSources.length > 0 && enemy.hp > 0) {
        let appliedStunForBroadcast = false;
        let stunBroadcastDuration = 0;
        for (const stun of stunSources) {
          if (stun.chance < 1 && Math.random() >= stun.chance) continue;
          const stunResult = applyStunStatus(gameRoom, enemy, stun, now, {
            attackerId: throwerId,
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
        if (appliedStunForBroadcast) {
          gameRoom.msg.broadcast('status_applied', {
            targetId: enemyId,
            type: 'stun',
            durationMs: stunBroadcastDuration,
          });
        }
      }

      setTimeout(() => {
        if (gameRoom.state.enemies.has(enemyId)) {
          const target = gameRoom.state.enemies.get(enemyId);
          if (target && target.hp > 0) {
            target.anim = 'idle';
            target.nextMoveTime = Date.now() + 500;
          }
        }
      }, 500);

      impactedEnemies.push({
        enemyId,
        damage,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
      });

      if (enemy.hp <= 0) {
        const gameRoomApi = gameRoom as unknown as {
          handleEnemyDeath?: (
            enemy: any,
            enemyId: string,
            attackType: 'melee' | 'ranged' | 'grenades',
            killerId?: string
          ) => Promise<void> | void;
        };

        if (typeof gameRoomApi.handleEnemyDeath === 'function') {
          void gameRoomApi.handleEnemyDeath(
            enemy,
            enemyId,
            'grenades',
            throwerId
          );
        } else {
          void handleEnemyDeathSystem(
            gameRoom as any,
            enemy,
            enemyId,
            'grenades',
            throwerId
          );
        }
      }
    }

    gameRoom.msg.broadcast('grenade_exploded', {
      grenadeId: this.grenadeId,
      playerId: throwerId,
      wearableSlug: this.wearableSlug,
      position: impactPoint,
      radius,
      timestamp: now,
      enemies: impactedEnemies,
      players: impactedPlayers,
      effect: 'damage',
    });
  }

  private resolveHealingSplash(
    gameRoom: GameRoom,
    throwerId: string,
    config: GrenadeWeaponDefinition,
    healing: NonNullable<GrenadeWeaponDefinition['healingSplash']>,
    impactPoint: { x: number; y: number }
  ) {
    const now = Date.now();
    const radius = Math.max(0, healing.radius ?? config.blastRadiusPx ?? 0);
    if (radius <= 0) {
      return;
    }

    const affectsSelf = healing.affectsSelf !== false;
    const allowOverheal = Boolean(healing.allowOverheal);
    const maxTargets = Number.isFinite(healing.maxTargets)
      ? Math.max(0, Math.floor(healing.maxTargets as number))
      : 0;
    const targetLimit = maxTargets > 0 ? maxTargets : Infinity;
    const falloffMode = healing.falloff ?? 'none';

    const thrower = gameRoom.state.players.get(throwerId) || null;

    const candidates: Array<{
      playerId: string;
      player: PlayerSchema;
      distance: number;
    }> = [];

    for (const [playerId, player] of gameRoom.state.players) {
      if (player.hp <= 0) continue; // No revives via Healing Splash
      if (!affectsSelf && playerId === throwerId) continue;

      const dx = player.x - impactPoint.x;
      const dy = player.y - impactPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(distance) || distance > radius) continue;

      candidates.push({ playerId, player, distance });
    }

    candidates.sort((a, b) => a.distance - b.distance);

    const heals: Array<{
      playerId: string;
      healAmount: number;
      hp: number;
      maxHp: number;
    }> = [];

    for (const candidate of candidates.slice(0, targetLimit)) {
      const { playerId, player, distance } = candidate;

      const falloffScalar = (() => {
        if (falloffMode === 'linear' && radius > 0) {
          const normalized = Math.min(1, Math.max(0, distance / radius));
          return 1 - normalized;
        }
        return 1;
      })();

      const healBase = healing.healAmount * falloffScalar;
      const healAmount = this.computeHealingAmount(healBase, player, thrower);
      if (healAmount <= 0) continue;

      const previousHp = player.hp;
      const maxHpCap = allowOverheal ? Number.MAX_SAFE_INTEGER : player.maxHp;
      player.hp = Math.min(maxHpCap, player.hp + healAmount);
      const actualHealed = player.hp - previousHp;
      if (actualHealed <= 0) continue;

      heals.push({
        playerId,
        healAmount: actualHealed,
        hp: player.hp,
        maxHp: player.maxHp,
      });

      gameRoom.msg.broadcast('player_healed', {
        playerId,
        healAmount: actualHealed,
        currentHp: player.hp,
        maxHp: player.maxHp,
        source: 'healing-splash',
        originPlayerId: throwerId,
        wearableSlug: this.wearableSlug,
      });
    }

    gameRoom.msg.broadcast('grenade_exploded', {
      grenadeId: this.grenadeId,
      playerId: throwerId,
      wearableSlug: this.wearableSlug,
      position: impactPoint,
      radius,
      timestamp: now,
      effect: 'healing',
      heals,
    });
  }

  private computeHealingAmount(
    baseHeal: number,
    target: PlayerSchema,
    _source: PlayerSchema | null
  ): number {
    if (!Number.isFinite(baseHeal) || baseHeal <= 0) {
      return 0;
    }

    const targetCharacterId = target.characterId || 'coderdan';
    const baselineStats = getCharacterStats(targetCharacterId);
    const baselineMaxHp = Math.max(1, baselineStats.maxHealth || 100);
    const targetMaxHp = Math.max(1, target.maxHp || baselineMaxHp);
    const progressionScalar = targetMaxHp / baselineMaxHp;

    const scaled = Math.max(0, baseHeal) * progressionScalar;
    const rounded = Math.round(scaled);

    if (rounded > 0) {
      return rounded;
    }

    return Math.round(Math.max(0, baseHeal));
  }

  update(_player: PlayerSchema, _gameRoom: GameRoom) {
    if (this.hasScheduledExplosion) {
      return { result: ActionResult.COMPLETED, message: 'Grenade thrown' };
    }
    return { result: ActionResult.CONTINUE };
  }
}
