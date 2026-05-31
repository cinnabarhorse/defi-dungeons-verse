import type { Room, Client } from 'colyseus';
import { GameRoomState, EntitySchema } from '../../schemas';
import { GAME_CONFIG, DEBUG_LOGS, LEVERAGE_CONFIG } from '../constants';
import { ENEMY_TYPES, getEnemyAnimationDuration } from '../../data/enemies';
import { generateItemData } from '../../data/items';
import {
  rollEnemyDrop,
  maybeRollLickTongueDrop,
  rollChestItems,
  rollChestCurrency,
  rollBossCurrency,
  LOOT_SOURCE_IDS,
  type EnemyDropContext,
  type PotionFarmConfig,
  type DroppedItemData,
} from '../../data/loot-table';
import {
  transitionAllPlayersToNewMap,
  transitionAllPlayersToBossRoom,
} from './WorldTransitionSystem';
import type { GameRoomApi } from '../../types/game-room-api';
import type { GameRoom } from '../../rooms/GameRoom';
import {
  getPlayerPotionFarmForWeapon,
  getPlayerTongueFarmForWeapon,
} from '../ability-utils';
import { DIFFICULTY_TIER_SEQUENCE } from '../../data/difficulty-tiers';
import { ensureServerBroadcaster } from '../messaging';
import { enemyKillsRepo } from '../db';
import { clearAuraEffects } from './AuraSystem';

const PORTAL_MAX_INTERACTION_DISTANCE = 200;

function normalizeWeaponSlug(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function handleEnemyDeath(
  room: Room<GameRoomState>,
  enemy: any,
  enemyId: string,
  attackType: 'melee' | 'ranged' | 'grenades' = 'melee',
  killerId?: string
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  enemy.anim = 'death';
  // Immediately clear any aura visual tags/stats on the dead entity
  try {
    clearAuraEffects(enemy as any);
  } catch {}
  if (DEBUG_LOGS) console.log(`⚔️ Enemy ${enemyId} defeated by ${attackType}!`);

  const isPortalGuardian =
    enemy.enemyType === 'portal_guardian' || enemy.name === 'Portal Guardian';
  const isBossEncounter = Boolean((enemy as any).isBossEncounter);
  const killer = killerId ? room.state.players.get(killerId) : undefined;
  const gameRoomApi = room as unknown as GameRoomApi;

  // If this enemy was an aura source (boss or elite leader), proactively clear aura effects
  // from all other living enemies so no stale buffs/tags linger between ticks.
  try {
    const hadAuraSources =
      Array.isArray((enemy as any)?._auraSources) &&
      (enemy as any)._auraSources.length > 0;
    const isEliteLeader =
      Boolean((enemy as any)?.isElite) && (enemy as any)?.leaderId === enemy.id;
    const isBossOrLeader = isBossEncounter || hadAuraSources || isEliteLeader;
    if (isBossOrLeader) {
      for (const [id, e] of room.state.enemies) {
        if (!e || id === enemyId) continue;
        if (e.hp > 0) {
          try {
            clearAuraEffects(e as any);
          } catch {}
        }
      }
    }
  } catch {}

  if (isPortalGuardian && DEBUG_LOGS) {
    console.log('👑 Portal Guardian defeated!');
  }

  if (isPortalGuardian) {
    try {
      if (typeof gameRoomApi.emitMatchEvent === 'function') {
        gameRoomApi.emitMatchEvent('pg_killed', {
          enemyId,
          killerId: killerId ?? null,
          killerName: killer?.name ?? null,
          x: enemy.x,
          y: enemy.y,
          difficultyTier: room.state.difficultyTier,
        });
      }
    } catch (error) {
      console.warn('Failed to emit pg_killed event', error);
    }
  }

  const enemyType = enemy.enemyType || enemy.name || '';
  const baseStats = ENEMY_TYPES[enemyType];
  const enemyTags = Array.isArray(baseStats?.tags)
    ? baseStats!.tags
    : Array.isArray((enemy as any)?.tags)
      ? [...((enemy as any).tags as string[])]
      : [];

  const shooterWeaponSlug =
    normalizeWeaponSlug((enemy as any)?.lastHitWeaponSlug) || undefined;
  const killerDerivedStats = (() => {
    if (!killer) return {};
    try {
      const parsed = JSON.parse(killer.derivedStats || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  })();
  const killerActiveWeaponSlug =
    normalizeWeaponSlug((killerDerivedStats as any)?.activeWeaponSlug) ||
    undefined;
  const weaponSlugForLoot = shooterWeaponSlug || killerActiveWeaponSlug;

  const classification: EnemyDropContext['classification'] =
    (baseStats?.classification as EnemyDropContext['classification']) ??
    (isBossEncounter ? 'boss' : enemy.isElite ? 'elite' : 'trash');

  const potionFarm = mapPotionFarmAggregation(
    killer && typeof killer.characterId === 'string'
      ? getPlayerPotionFarmForWeapon(
          killer.characterId,
          weaponSlugForLoot,
          killerDerivedStats
        )
      : undefined
  );

  const rewardMultiplier =
    typeof enemy.rewardMultiplier === 'number'
      ? enemy.rewardMultiplier
      : undefined;

  const dropContext: EnemyDropContext = {
    enemyType,
    enemyTags,
    classification,
    killStreakPotionCoinFindBonus: Number(
      (killer as any)?.killStreakPotionCoinFindBonus ??
        (killer as any)?.runPotionCoinFindBonus ??
        0
    ),
    rewardMultiplier,
    potionFarm,
    difficultyTierId: room.state.difficultyTier,
  };

  if (classification === 'boss') {
    // Boss behaves like opening a treasure chest: 3-5 chest items + currency
    const difficultyTier = room.state.difficultyTier || 'normal_1';
    const count = 3 + Math.floor(Math.random() * 3); // 3-5
    const deathX = enemy.x;
    const deathY = enemy.y;
    const floorIndex = Math.max(1, Number((room as any).currentFloor) || 1);
    try {
      // Generate chest-like item drops around the boss
      const chestDrops = rollChestItems({
        count,
        difficultyTierId: difficultyTier,
        sourceId: LOOT_SOURCE_IDS.treasureChest,
        floorIndex,
      });

      const spawnRadius = 140;
      let spawnIndex = 0;
      // For Portal Guardian, we hold drops until currency allocations are ready,
      // then spawn everything at once.
      const pgPending: Array<{
        entityId: string;
        x: number;
        y: number;
        payload: any;
        kind: 'item' | 'currency';
        allocation?: {
          distribution: { id: string };
          currency?: 'USDC' | 'GHST';
          amount?: number;
          meta?: Record<string, any>;
          playerId?: string | null;
        };
      }> = [];

      for (const drop of chestDrops as DroppedItemData[]) {
        const quantity = Number.isFinite(drop.quantity)
          ? Number(drop.quantity)
          : 1;
        const payload: any = {
          ...drop,
          itemType: drop.type ?? 'item',
          type: drop.type ?? 'item',
          quantity,
          origin: 'boss_drop',
          category: drop.type ?? 'item',
          difficultyTier,
        };
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * spawnRadius * 0.75 + spawnRadius * 0.25;
        const entityId = `boss_drop_${Date.now()}_${spawnIndex++}`;
        const x = deathX + Math.cos(angle) * radius;
        const y = deathY + Math.sin(angle) * radius;

        if (isPortalGuardian) {
          pgPending.push({
            entityId,
            x,
            y,
            payload,
            kind: 'item',
          });
        } else {
          const entity = new EntitySchema();
          entity.id = entityId;
          entity.kind = 'collectible' as any;
          entity.x = x;
          entity.y = y;
          entity.state = JSON.stringify(payload);
          room.state.entities.set(entityId, entity);

          if (typeof gameRoomApi.registerEnemyDrop === 'function') {
            void gameRoomApi.registerEnemyDrop({
              entityId,
              enemyId,
              enemyType: enemy?.enemyType || enemy?.name || 'unknown',
              dropTable: payload.type ?? 'item',
              item: {
                id: entityId,
                name: payload.name,
                type: payload.type,
                quantity: payload.quantity,
                rarity: payload.rarity,
                color: payload.color,
                description: payload.description,
                wearableId: payload.wearableId,
                spriteId: payload.spriteId,
                wearableSlug: payload.wearableSlug,
                quality: payload.quality,
                durabilityScore: payload.durabilityScore,
              },
            });
          }
        }
      }

      // Spawn USDC + GHST currency using probability-based boss drop system
      const playerDbId = (room as any).getPlayerIdForSession
        ? (room as any).getPlayerIdForSession(killerId)
        : undefined;
      const gameId = (room as any).currentGameId;

      const Lmax = LEVERAGE_CONFIG.max;
      const L = Math.max(
        1,
        Math.min(Lmax, Number(room.state.leverageTotal || 1))
      );

      // Get Daily Quest bonus if player completed one
      let dailyQuestBonusUsdc = 0;
      let dailyQuestBonusGhst = 0;
      let isDailyQuest = false;
      if (
        playerDbId &&
        typeof (room as any).getDailyQuestBossBonus === 'function'
      ) {
        const bonus = (room as any).getDailyQuestBossBonus(playerDbId);
        dailyQuestBonusUsdc = bonus.usdc;
        dailyQuestBonusGhst = bonus.ghst;
        isDailyQuest = dailyQuestBonusUsdc > 0 || dailyQuestBonusGhst > 0;
      }

      const usdcReward = rollBossCurrency({
        difficultyTierId: difficultyTier,
        currency: 'USDC',
        leverageTotal: L,
        floorIndex,
        dailyQuestBonus: dailyQuestBonusUsdc,
        guaranteeDrop: isDailyQuest,
      });
      const ghstReward = rollBossCurrency({
        difficultyTierId: difficultyTier,
        currency: 'GHST',
        leverageTotal: L,
        floorIndex,
        dailyQuestBonus: dailyQuestBonusGhst,
        guaranteeDrop: isDailyQuest,
      });

      if (typeof (room as any).clearDailyQuestPayoutGuarantees === 'function') {
        (room as any).clearDailyQuestPayoutGuarantees();
      }

      if (typeof gameRoomApi.emitMatchEvent === 'function') {
        try {
          gameRoomApi.emitMatchEvent('boss_currency_roll', {
            floorIndex,
            difficultyTier,
            leverageTotal: L,
            currency: 'USDC',
            tier: usdcReward.tier,
            amount: usdcReward.amount,
            baseAmount: usdcReward.baseAmount,
            depthBonus: usdcReward.depthBonusApplied ?? 0,
            dropTarget: usdcReward.dropTarget ?? null,
            dailyQuestBonus: dailyQuestBonusUsdc || undefined,
          });
          gameRoomApi.emitMatchEvent('boss_currency_roll', {
            floorIndex,
            difficultyTier,
            leverageTotal: L,
            currency: 'GHST',
            tier: ghstReward.tier,
            amount: ghstReward.amount,
            baseAmount: ghstReward.baseAmount,
            depthBonus: ghstReward.depthBonusApplied ?? 0,
            dropTarget: ghstReward.dropTarget ?? null,
            dailyQuestBonus: dailyQuestBonusGhst || undefined,
          });
        } catch (error) {
          console.warn('Failed to emit boss_currency_roll event', error);
        }
      }

      const requestedUsdc = usdcReward.amount;
      const requestedGhst = ghstReward.amount;

      if (playerDbId && gameId) {
        (async () => {
          const killEntry =
            (room as any).recentEnemyKillIds?.get?.(enemyId) ?? null;
          const currentKillId: string | null = killEntry?.id ?? null;
          const hasPreviousBossKill = await enemyKillsRepo.hasPreviousBossKill({
            playerId: playerDbId,
            excludeKillId: currentKillId,
            bossEnemyTypes: ['portal_guardian'],
          });
          const isFirstBossKill = !hasPreviousBossKill;

          let finalUsdc = requestedUsdc;
          let finalGhst = requestedGhst;
          let guaranteedApplied = false;

          // First boss kill guarantee
          if (isFirstBossKill && finalGhst <= 0 && finalUsdc <= 0) {
            const ghstFallback = Math.max(0.1, ghstReward.baseAmount);
            const usdcFallback = Math.max(0.1, usdcReward.baseAmount);
            if (ghstFallback >= usdcFallback) {
              finalGhst = ghstFallback;
            } else {
              finalUsdc = usdcFallback;
            }
            guaranteedApplied = true;
          }

          const tasks: Array<Promise<any>> = [];
          if (finalGhst > 0) {
            tasks.push(
              (room as any).allocateChestGhstLoot({
                playerId: playerDbId,
                gameId,
                chestId: `boss_${enemyId}`,
                difficultyTier: difficultyTier,
                requestedAmount: finalGhst,
                probability: ghstReward.probability,
                expectedValue: ghstReward.expectedValue,
                entityId: `boss_${enemyId}_ghst`,
              })
            );
          } else {
            tasks.push(Promise.resolve(null));
          }
          if (finalUsdc > 0) {
            tasks.push(
              (room as any).allocateChestUsdcLoot({
                playerId: playerDbId,
                gameId,
                chestId: `boss_${enemyId}`,
                difficultyTier: difficultyTier,
                requestedAmount: finalUsdc,
                probability: usdcReward.probability,
                expectedValue: usdcReward.expectedValue,
                entityId: `boss_${enemyId}_usdc`,
              })
            );
          } else {
            tasks.push(Promise.resolve(null));
          }

          const [ghstAllocation, usdcAllocation] = await Promise.all(tasks);

          const grantedUsdc = Number(usdcAllocation?.amount ?? 0);
          const grantedGhst = Number(ghstAllocation?.amount ?? 0);

          const spawnCurrency = (
            currency: 'USDC' | 'GHST',
            amount: number,
            allocation: any
          ) => {
            if (!(amount > 0) || !allocation) return;
            const angle = Math.random() * Math.PI * 2;
            const radius =
              Math.random() * spawnRadius * 0.75 + spawnRadius * 0.25;
            const entityId = `boss_${enemyId}_${currency.toLowerCase()}`;
            const payload: any = {
              itemType: 'coin',
              type: 'coin',
              name: currency,
              quantity: 1,
              origin: 'boss_drop',
              category: 'coin',
              difficultyTier,
            };
            if (currency === 'USDC') payload.usdcAmount = amount;
            if (currency === 'GHST') (payload as any).ghstAmount = amount;

            const x = deathX + Math.cos(angle) * radius;
            const y = deathY + Math.sin(angle) * radius;

            if (isPortalGuardian) {
              pgPending.push({
                entityId,
                x,
                y,
                payload,
                kind: 'currency',
                allocation: {
                  distribution: { id: allocation.distribution.id },
                  currency,
                  amount,
                  meta: {
                    chestId: `boss_${enemyId}`,
                    difficultyTier,
                    currency,
                    amount,
                    tier:
                      currency === 'USDC' ? usdcReward.tier : ghstReward.tier,
                    baseAmount:
                      currency === 'USDC'
                        ? usdcReward.baseAmount
                        : ghstReward.baseAmount,
                    guaranteedFirstBossKill: guaranteedApplied || undefined,
                    isDailyQuest: isDailyQuest || undefined,
                  },
                  playerId: playerDbId ?? null,
                },
              });
            } else {
              const entity = new EntitySchema();
              entity.id = entityId;
              entity.kind = 'collectible' as any;
              entity.x = x;
              entity.y = y;
              entity.state = JSON.stringify(payload);
              room.state.entities.set(entityId, entity);

              try {
                const timeout = setTimeout(() => {
                  (room as any).entityLootDistributions.delete(entityId);
                }, 10 * 60_000);
                (room as any).entityLootDistributions.set(entityId, {
                  distributionId: allocation.distribution.id,
                  timeout,
                  source: 'boss_drop',
                  metadata: {
                    chestId: `boss_${enemyId}`,
                    difficultyTier,
                    currency,
                    amount,
                    tier:
                      currency === 'USDC' ? usdcReward.tier : ghstReward.tier,
                    baseAmount:
                      currency === 'USDC'
                        ? usdcReward.baseAmount
                        : ghstReward.baseAmount,
                    guaranteedFirstBossKill: guaranteedApplied || undefined,
                    isDailyQuest: isDailyQuest || undefined,
                  },
                  playerId: playerDbId ?? null,
                });
              } catch {}
            }
          };

          if (grantedUsdc > 0 && usdcAllocation) {
            spawnCurrency('USDC', grantedUsdc, usdcAllocation);
          }
          if (grantedGhst > 0 && ghstAllocation) {
            spawnCurrency('GHST', grantedGhst, ghstAllocation);
          }

          // If this was Portal Guardian, spawn all pending drops together now and notify clients.
          if (isPortalGuardian) {
            for (const d of pgPending) {
              const entity = new EntitySchema();
              entity.id = d.entityId;
              entity.kind = 'collectible' as any;
              entity.x = d.x;
              entity.y = d.y;
              entity.state = JSON.stringify(d.payload);
              room.state.entities.set(d.entityId, entity);

              if (d.kind === 'item') {
                if (typeof gameRoomApi.registerEnemyDrop === 'function') {
                  void gameRoomApi.registerEnemyDrop({
                    entityId: d.entityId,
                    enemyId,
                    enemyType: enemy?.enemyType || enemy?.name || 'unknown',
                    dropTable: d.payload.type ?? 'item',
                    item: {
                      id: d.entityId,
                      name: d.payload.name,
                      type: d.payload.type,
                      quantity: d.payload.quantity,
                      rarity: d.payload.rarity,
                      color: d.payload.color,
                      description: d.payload.description,
                      wearableId: d.payload.wearableId,
                      spriteId: d.payload.spriteId,
                      wearableSlug: d.payload.wearableSlug,
                      quality: d.payload.quality,
                      durabilityScore: d.payload.durabilityScore,
                    },
                  });
                }
              } else if (d.kind === 'currency' && d.allocation) {
                try {
                  const timeout = setTimeout(() => {
                    (room as any).entityLootDistributions.delete(d.entityId);
                  }, 10 * 60_000);
                  (room as any).entityLootDistributions.set(d.entityId, {
                    distributionId: d.allocation.distribution.id,
                    timeout,
                    source: 'boss_drop',
                    metadata: d.allocation.meta || {},
                    playerId: d.allocation.playerId ?? null,
                  });
                } catch {}
              }
            }
            // Notify clients that all boss loot is ready; client can now fade the boss out.
            try {
              broadcaster.broadcast('boss_loot_ready', {
                enemyId,
                enemyType: enemy.enemyType,
              });
            } catch {}
            // Schedule removal after loot reveal so client fade can play.
            try {
              const state = room.state as any;
              if (!Array.isArray(state._scheduledEnemyRemovals))
                state._scheduledEnemyRemovals = [];
              const removeAt =
                Date.now() +
                getEnemyAnimationDuration(enemy.enemyType, 'death');
              state._scheduledEnemyRemovals.push({
                id: enemyId,
                at: removeAt,
                reason: 'death',
              });
            } catch {}
          }
        })().catch((error) => {
          console.error('Failed to allocate boss currency rewards', {
            gameId,
            playerId: playerDbId,
            bossId: enemyId,
            error,
          });
        });
      } else if (isPortalGuardian) {
        // No currency path available; spawn held item drops now, notify clients, and schedule removal.
        for (const d of pgPending) {
          const entity = new EntitySchema();
          entity.id = d.entityId;
          entity.kind = 'collectible' as any;
          entity.x = d.x;
          entity.y = d.y;
          entity.state = JSON.stringify(d.payload);
          room.state.entities.set(d.entityId, entity);

          if (d.kind === 'item') {
            if (typeof gameRoomApi.registerEnemyDrop === 'function') {
              void gameRoomApi.registerEnemyDrop({
                entityId: d.entityId,
                enemyId,
                enemyType: enemy?.enemyType || enemy?.name || 'unknown',
                dropTable: d.payload.type ?? 'item',
                item: {
                  id: d.entityId,
                  name: d.payload.name,
                  type: d.payload.type,
                  quantity: d.payload.quantity,
                  rarity: d.payload.rarity,
                  color: d.payload.color,
                  description: d.payload.description,
                  wearableId: d.payload.wearableId,
                  spriteId: d.payload.spriteId,
                  wearableSlug: d.payload.wearableSlug,
                  quality: d.payload.quality,
                  durabilityScore: d.payload.durabilityScore,
                },
              });
            }
          }
        }
        try {
          broadcaster.broadcast('boss_loot_ready', {
            enemyId,
            enemyType: enemy.enemyType,
          });
        } catch {}
        try {
          const state = room.state as any;
          if (!Array.isArray(state._scheduledEnemyRemovals))
            state._scheduledEnemyRemovals = [];
          const removeAt =
            Date.now() + getEnemyAnimationDuration(enemy.enemyType, 'death');
          state._scheduledEnemyRemovals.push({
            id: enemyId,
            at: removeAt,
            reason: 'death',
          });
        } catch {}
      }
    } catch (error) {
      console.warn('Failed to spawn boss chest-like drops', error);
    }
  } else {
    const drop = rollEnemyDrop(dropContext);
    if (drop) {
      spawnCollectibleFromItemData(room, enemy, enemyId, drop);
    }
  }

  const shouldDropTongue = maybeRollLickTongueDrop(enemyTags, (tags) => {
    if (!killer || typeof killer.characterId !== 'string') {
      return { bonusChance: 0 };
    }
    try {
      return getPlayerTongueFarmForWeapon(
        killer.characterId,
        tags,
        weaponSlugForLoot,
        killerDerivedStats
      );
    } catch (error) {
      console.warn('Failed to aggregate Tongue Farm bonus', error);
      return { bonusChance: 0 };
    }
  });
  if (shouldDropTongue) {
    spawnLickTongueDrop(room, enemy, enemyId);
  }

  // Schedule removal and follow-up work to be processed in the main tick
  try {
    // For Portal Guardian, removal is scheduled after loot is ready.
    if (!isPortalGuardian) {
      const removeAt =
        Date.now() + getEnemyAnimationDuration(enemy.enemyType, 'death');
      const state = room.state as any;
      if (!Array.isArray(state._scheduledEnemyRemovals))
        state._scheduledEnemyRemovals = [];
      state._scheduledEnemyRemovals.push({
        id: enemyId,
        at: removeAt,
        reason: 'death',
      });
    }
    if (!isPortalGuardian && !isBossEncounter) {
      // Increment kill metrics
      room.state.totalEnemyKills += 1;

      if (GAME_CONFIG.ENABLE_ENEMY_RESPAWN) {
        const state = room.state as any;
        if (!Array.isArray(state._scheduledEnemyFollowups))
          state._scheduledEnemyFollowups = [];
        const followUpAt =
          Date.now() +
          getEnemyAnimationDuration(enemy.enemyType, 'death') +
          100;
        state._scheduledEnemyFollowups.push({
          at: followUpAt,
          kind: 'spawn_random',
          count: 1,
        });
      }
    }
  } catch {}

  if (isBossEncounter) {
    try {
      if (typeof gameRoomApi.emitMatchEvent === 'function') {
        gameRoomApi.emitMatchEvent('boss_room_cleared', {
          enemyId,
          enemyType: enemy.enemyType,
          killerId: killerId ?? null,
          floor: (room as any).currentFloor ?? 0,
        });
      }
    } catch (error) {
      console.warn('Failed to emit boss_room_cleared event', error);
    }
    // Also broadcast to connected clients so the UI can react immediately
    try {
      broadcaster.broadcast('boss_room_cleared', {
        enemyId,
        enemyType: enemy.enemyType,
        killerId: killerId ?? null,
        floor: (room as any).currentFloor ?? 0,
      });
    } catch {}
    try {
      (room as any).bossEncounterActive = false;
    } catch {}
  }
}

function mapPotionFarmAggregation(
  aggregation: ReturnType<typeof getPlayerPotionFarmForWeapon> | undefined
): PotionFarmConfig | undefined {
  if (!aggregation) return undefined;
  const multiplier = Number.isFinite(aggregation.potionWeightMultiplier)
    ? Number(aggregation.potionWeightMultiplier)
    : 1;
  const extraCap =
    typeof aggregation.maxExtraChanceCap === 'number' &&
    aggregation.maxExtraChanceCap > 0
      ? aggregation.maxExtraChanceCap
      : 1;
  const extraRoll = Math.min(
    extraCap,
    Math.max(0, Number(aggregation.extraRollChance ?? 0))
  );

  return {
    enabled: Boolean(aggregation.enabled),
    enableReweight: Boolean(aggregation.enableReweight),
    potionWeightMultiplier: multiplier,
    enableExtraRoll: Boolean(aggregation.enableExtraRoll),
    extraRollChance: extraRoll,
    hpToManaBias: Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(aggregation.hpToManaBias)
          ? aggregation.hpToManaBias
          : 0.5
      )
    ),
  };
}

function spawnCollectibleFromItemData(
  room: Room<GameRoomState>,
  enemy: any,
  enemyId: string,
  drop: DroppedItemData
) {
  const droppedItem = new EntitySchema();
  droppedItem.id = `drop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  droppedItem.kind = 'collectible' as any;
  droppedItem.x = enemy.x;
  droppedItem.y = enemy.y;
  droppedItem.state = JSON.stringify(drop);
  room.state.entities.set(droppedItem.id, droppedItem);

  if (DEBUG_LOGS) {
    console.log(
      `🎁 Enemy dropped ${drop.name} (${drop.type}) at (${enemy.x}, ${enemy.y})`
    );
  }

  const api = room as unknown as GameRoomApi;
  if (typeof api.registerEnemyDrop === 'function') {
    void api.registerEnemyDrop({
      entityId: droppedItem.id,
      enemyId,
      enemyType: enemy?.enemyType || enemy?.name || 'unknown',
      dropTable: drop.type ?? 'unknown',
      item: {
        id: droppedItem.id,
        name: drop.name,
        type: drop.type,
        quantity: drop.quantity,
        rarity: drop.rarity,
        color: drop.color,
        description: drop.description,
        wearableId: drop.wearableId,
        spriteId: drop.spriteId,
        wearableSlug: drop.wearableSlug,
        quality: drop.quality,
        durabilityScore: drop.durabilityScore,
      },
    });
  }
}

export function spawnLickTongueDrop(
  room: Room<GameRoomState>,
  enemy: any,
  enemyId: string
) {
  const itemData = generateItemData('lick_tongue');
  const offsetX = (Math.random() - 0.5) * 40;
  const offsetY = (Math.random() - 0.5) * 40;

  const droppedItem = new EntitySchema();
  droppedItem.id = `lick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  droppedItem.kind = 'collectible' as any;
  droppedItem.x = enemy.x + offsetX;
  droppedItem.y = enemy.y + offsetY;
  droppedItem.state = JSON.stringify(itemData);
  room.state.entities.set(droppedItem.id, droppedItem);
  if (DEBUG_LOGS) {
    console.log(
      `👅 Enemy dropped LICK TONGUE at (${droppedItem.x}, ${droppedItem.y})!`
    );
  }

  const api = room as unknown as GameRoomApi;
  if (typeof api.registerEnemyDrop === 'function') {
    void api.registerEnemyDrop({
      entityId: droppedItem.id,
      enemyId,
      enemyType: enemy?.enemyType || enemy?.name || 'unknown',
      dropTable: 'special_lick',
      item: {
        id: itemData.id ?? droppedItem.id,
        name: itemData.name,
        type: itemData.type,
        quantity: itemData.quantity ?? 1,
        rarity: itemData.rarity,
        description: itemData.description,
        color: itemData.color,
        spriteId: itemData.spriteId,
      },
    });
  }
}

export function handlePortalInteraction(
  room: Room<GameRoomState>,
  client: Client,
  data: { portalId: string }
) {
  const broadcaster = ensureServerBroadcaster(room as any);
  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  const gameRoomApi = room as unknown as GameRoomApi;
  const gameRoomInstance = room.state.room as GameRoom | undefined;

  // Prevent interactions during transitions
  try {
    const anyRoom = room as any;
    if (anyRoom.isRoomTransitioning) {
      return;
    }
  } catch {}

  const portal = room.state.entities.get(data.portalId);
  if (!portal) {
    if (DEBUG_LOGS) console.log(`❌ Portal ${data.portalId} not found`);
    return;
  }

  const portalState = JSON.parse(portal.state || '{}');
  const portalType = portalState.portalType;
  const portalKind = portalState.portalKind || portalType;
  const rawDestination = String(
    portalState.destination || 'next_floor'
  ).toLowerCase();
  const destination: 'new_map' | 'next_floor' | 'boss_room' =
    rawDestination === 'boss_room'
      ? 'boss_room'
      : rawDestination === 'new_map'
        ? 'new_map'
        : 'next_floor';

  if (DEBUG_LOGS) {
    console.log(
      `🌀 Player ${player.name} entering ${portalKind} portal -> ${destination}`
    );
  }

  const distance = Math.sqrt(
    Math.pow(player.x - portal.x, 2) + Math.pow(player.y - portal.y, 2)
  );
  if (distance > PORTAL_MAX_INTERACTION_DISTANCE) {
    if (DEBUG_LOGS) console.log(`🚫 Player too far from portal: ${distance}`);
    return;
  }

  let nextDifficulty: string | undefined;
  const currentDifficulty = String(room.state.difficultyTier || 'normal_1');
  nextDifficulty = currentDifficulty;
  try {
    (room as any).portalsSpawnedForCurrentFloor = false;
  } catch {}

  if (destination === 'boss_room') {
    if (DEBUG_LOGS) console.log('⚔️ Portal leading to boss encounter!');
    transitionAllPlayersToBossRoom(room);
  } else {
    if (destination === 'new_map') {
      const idx = Math.max(
        0,
        DIFFICULTY_TIER_SEQUENCE.indexOf(currentDifficulty)
      );
      const nextIdx = Math.min(DIFFICULTY_TIER_SEQUENCE.length - 1, idx + 1);
      nextDifficulty =
        DIFFICULTY_TIER_SEQUENCE[nextIdx] || room.state.difficultyTier;
    }

    if (destination === 'next_floor') {
      const deltaConfig =
        (GAME_CONFIG.enemyDifficultyMeter as any)?.floorDescendDelta ?? 5;
      const descendDelta = Math.max(0, Math.floor(Number(deltaConfig) || 0));
      const currentFloorIndex = Number((room as any).currentFloor) || 0;
      const targetFloorIndex =
        currentFloorIndex > 0 ? currentFloorIndex + 1 : 1;
      const intensityBefore = Number(room.state.enemyDifficultyLevel) || 0;
      let intensityAfter = intensityBefore;
      if (descendDelta > 0) {
        if (gameRoomInstance?.incrementEnemyDifficultyLevel) {
          const result = gameRoomInstance.incrementEnemyDifficultyLevel(
            descendDelta,
            'next_floor'
          );
          intensityAfter = result.current;
        } else {
          room.state.enemyDifficultyLevel = intensityBefore + descendDelta;
          intensityAfter = room.state.enemyDifficultyLevel;
        }
      }
      if (typeof gameRoomApi.emitMatchEvent === 'function') {
        try {
          gameRoomApi.emitMatchEvent('floor_descended', {
            floorIndex: targetFloorIndex,
            difficultyTier: room.state.difficultyTier,
            intensityBefore,
            intensityAfter,
            delta: intensityAfter - intensityBefore,
          });
        } catch (error) {
          console.warn('Failed to emit floor_descended event', error);
        }
      }
    }

    if (DEBUG_LOGS) {
      console.log(
        `🗺️ Portal leading to ${
          destination === 'next_floor' ? 'next floor' : 'new map'
        } with difficulty ${nextDifficulty}`
      );
    }
    transitionAllPlayersToNewMap(room, nextDifficulty);
  }

  try {
    if (typeof gameRoomApi.emitMatchEvent === 'function') {
      gameRoomApi.emitMatchEvent('portal_used', {
        portalId: data.portalId,
        portalType,
        portalKind,
        destination,
        usedBySessionId: client.sessionId,
        usedByPlayerId: player.id ?? null,
        usedByPlayerName: player.name ?? null,
        nextDifficulty: nextDifficulty ?? null,
      });
    }
  } catch (error) {
    console.warn('Failed to emit portal_used event', error);
  }

  // Defensive: delete only if it still exists to avoid MapSchema errors
  try {
    if (room.state.entities.has(data.portalId)) {
      room.state.entities.delete(data.portalId);
    }
  } catch {}
  broadcaster.broadcast('portal_used', {
    portalType,
    portalKind,
    destination,
    usedBy: player.name,
  });
}
