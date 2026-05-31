import type { Room } from 'colyseus';
import { MapSchema } from '@colyseus/schema';
import {
  GameRoomState,
  EntitySchema,
  EnemySchema,
  NPCSchema,
  ProjectileSchema,
} from '../../schemas';
import { GAME_CONFIG, INITIAL_ENEMY_COUNT } from '../constants';
import { DEBUG_LOGS } from '../constants';
import {
  spawnEnemyOfType,
  getRandomEnemyType,
  setPlayerSpawnPosition,
} from './EnemySpawnSystem';
import { spawnNPCs } from './NPCSystem';
import type { GameRoomApi } from '../../types/game-room-api';
import { spawnFloorPortals } from './PortalSystem';
import { MapGenerator } from 'src/utils/MapGenerator';
import { loadMapChunks } from '../../data/maps-loader';
import { ensureServerBroadcaster } from '../messaging';
import type { AuraEffect } from './AuraSystem';
import type { AbilityReference } from '../../data/characters';

function attachRandomBossAura(boss: EnemySchema) {
  const pool: Array<{
    id: string;
    visualTag: 'aura:red' | 'aura:green' | 'aura:blue' | 'aura:yellow';
    abilities: AbilityReference[];
    name: string;
  }> = [
    {
      id: 'boss_berserker',
      name: 'Berserker',
      visualTag: 'aura:red',
      abilities: [
        {
          id: 'damage-multiplier',
          params: { multiplier: 1.25, appliesTo: 'all' },
        },
        { id: 'attack-speed', params: { multiplier: 1.15 } },
      ],
    },
    {
      id: 'boss_guardian',
      name: 'Guardian',
      visualTag: 'aura:blue',
      abilities: [
        { id: 'damage-reduction', params: { armor: 15 } },
        { id: 'regen', params: { perSecond: 6 } },
      ],
    },
    {
      id: 'boss_assassin',
      name: 'Assassin',
      visualTag: 'aura:yellow',
      abilities: [
        { id: 'move-speed', params: { multiplier: 1.15 } },
        {
          id: 'critical-strike',
          params: { chance: 0.15, multiplier: 1.5, appliesTo: 'all' },
        },
        { id: 'evade', params: { chance: 0.15, cooldownMs: 3000 } },
        {
          id: 'poison',
          params: { chance: 0.5, damagePerSecond: 10, durationSeconds: 4 },
        },
      ],
    },
    {
      id: 'boss_vampiric',
      name: 'Vampiric',
      visualTag: 'aura:green',
      abilities: [
        {
          id: 'life-steal',
          params: { percent: 0.12, appliesTo: 'melee', maxPerHit: 40 },
        },
        {
          id: 'hp-multiplier',
          params: { multiplier: 1.5 },
        },
      ],
    },
  ];

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const radiusTiles = 4 + Math.floor(Math.random() * 3); // 4, 5, or 6
  const radiusPx = radiusTiles * GAME_CONFIG.TILE_SIZE;

  // Prefix boss name with the aura label (e.g., "Berserker Portal Guardian")
  try {
    const curr =
      typeof (boss as any).name === 'string' && (boss as any).name.length > 0
        ? (boss as any).name
        : 'Portal Guardian';
    const prefix = `${chosen.name} `;
    if (!curr.startsWith(prefix)) {
      (boss as any).name = (prefix + curr) as any;
    }
  } catch {}

  const sources: AuraEffect[] = Array.isArray((boss as any)._auraSources)
    ? (boss as any)._auraSources
    : ((boss as any)._auraSources = []);

  const abilityIds =
    Array.isArray(chosen.abilities) && chosen.abilities.length > 0
      ? Array.from(
          new Set(
            chosen.abilities
              .map((a) => (a && typeof a.id === 'string' ? a.id : ''))
              .filter((id) => id.length > 0)
          )
        )
      : [];
  const additionalTags =
    abilityIds.length > 0
      ? abilityIds.map((id) => `aura:ability:${id}`)
      : undefined;

  sources.push({
    id: chosen.id,
    radiusPx,
    abilities: chosen.abilities,
    visualTag: chosen.visualTag,
    additionalTags,
  });
}

function emitLeverageSnapshot(
  room: Room<GameRoomState>,
  stage:
    | 'before_floor_transition'
    | 'after_floor_transition'
    | 'before_boss_transition'
    | 'after_boss_transition'
) {
  try {
    const api = room as unknown as GameRoomApi;
    if (typeof api.emitMatchEvent !== 'function') {
      return;
    }
    api.emitMatchEvent('leverage_snapshot', {
      stage,
      floorIndex: (room as any).currentFloor ?? 0,
      floorLeverage: room.state.floorLeverage,
      roomLeverage: room.state.roomLeverage,
      leverageTotal: room.state.leverageTotal,
    });
  } catch (error) {
    console.warn('Failed to emit leverage snapshot event', error);
  }
}

export function transitionAllPlayersToBossRoom(room: Room<GameRoomState>) {
  if (DEBUG_LOGS) console.log('⚔️ Transitioning to boss room...');
  emitLeverageSnapshot(room, 'before_boss_transition');
  const __prevPatchRate = (room as any).patchRate ?? 50;
  try {
    (room as any).setPatchRate(0);
  } catch {}
  try {
    if (typeof (room as any).pauseEnemyDifficultyMeter === 'function') {
      (room as any).pauseEnemyDifficultyMeter('boss_room');
    }
    (room as any).bossEncounterActive = true;
    (room as any).portalsSpawnedForCurrentFloor = false;
    (room as any).isRoomTransitioning = true;
    if (typeof (room as any).timedSpawnInterval !== 'undefined') {
      const interval = (room as any)
        .timedSpawnInterval as NodeJS.Timeout | null;
      if (interval) clearInterval(interval);
      (room as any).timedSpawnInterval = null;
    }
    (room.state as any).nextTimedSpawnAt = 0;
  } catch (error) {
    console.warn('Failed to prepare boss room transition', error);
  }

  room.state.entities = new MapSchema<EntitySchema>();
  room.state.enemies = new MapSchema<EnemySchema>();
  room.state.npcs = new MapSchema<NPCSchema>();
  room.state.projectiles = new MapSchema<ProjectileSchema>();
  // Clear filter cache sets to avoid stale references
  room.state._visibleEnemyIds?.clear();
  room.state._visibleNpcIds?.clear();
  room.state._visibleProjectileIds?.clear();
  room.state._discoveredEntityIds?.clear();
  const broadcaster = ensureServerBroadcaster(room);

  let bossChunkApplied = false;
  let bossChunkWidth = 0;
  let bossChunkHeight = 0;
  const bossSpawnPositions: Array<{ x: number; y: number }> = [];
  try {
    const bossChunks = loadMapChunks('chunks-boss.ts');
    const bossChunk = bossChunks.find(
      (chunk) => chunk?.name === 'dungeon-boss-room'
    );
    if (bossChunk) {
      const tileSize = GAME_CONFIG.TILE_SIZE;
      const floorTiles = new Set<string>();
      bossChunkWidth = bossChunk.width * tileSize;
      bossChunkHeight = bossChunk.height * tileSize;

      bossChunk.assets.forEach((asset, index) => {
        const tileKey = `${asset.x},${asset.y}`;
        if (String(asset.category) === 'floors') {
          for (let dy = 0; dy <= 1; dy += 1) {
            for (let dx = 0; dx <= 1; dx += 1) {
              floorTiles.add(`${asset.x + dx},${asset.y + dy}`);
            }
          }
          return;
        }

        if (asset.isSpawnPoint) {
          const spawnX = asset.x * tileSize + tileSize / 2;
          const spawnY = asset.y * tileSize + tileSize / 2;
          bossSpawnPositions.push({ x: spawnX, y: spawnY });
          return;
        }

        const entity = new EntitySchema();
        entity.id =
          asset.id && typeof asset.id === 'string'
            ? `boss_chunk_${asset.id}`
            : `boss_chunk_${asset.assetId}_${index}`;
        entity.kind = 'obstacle' as any;
        entity.x = asset.x * tileSize;
        entity.y = asset.y * tileSize;

        const state: Record<string, unknown> = {
          type: 'special',
          assetId: asset.assetId,
          sprite: asset.sprite,
          fromChunk: true,
        };

        if (String(asset.category) === 'walls') {
          state.indestructible = true;
          state.hasCollision = true;
        } else if (
          asset.category &&
          asset.category !== 'special' &&
          asset.category !== 'floors'
        ) {
          state.type = asset.category;
        }

        if (asset.allowOverlap) {
          state.allowOverlap = true;
        }
        if (typeof asset.rotation === 'number') {
          state.rotation = asset.rotation;
        }
        if (typeof (asset as any).renderLayer === 'string') {
          state.renderLayer = (asset as any).renderLayer;
        }
        if (typeof (asset as any).depthHint === 'number') {
          state.depthHint = (asset as any).depthHint;
        }

        entity.state = JSON.stringify(state);
        room.state.entities.set(entity.id, entity);
      });

      const layoutEntry = {
        x: 0,
        y: 0,
        chunkName: bossChunk.name,
      };

      (room as any).dungeonChunkLayoutData = [layoutEntry];
      (room as any).chunkLayoutData = [layoutEntry];
      (room as any).mapGenerator = {
        hasFloorTile(tx: number, ty: number) {
          return floorTiles.has(`${tx},${ty}`);
        },
        isPixelOnFloor(x: number, y: number) {
          const tileX = Math.floor(x / tileSize);
          const tileY = Math.floor(y / tileSize);
          return floorTiles.has(`${tileX},${tileY}`);
        },
      };

      try {
        broadcaster.broadcast('chunk_layout_update', {
          chunkLayout: [layoutEntry],
          difficultyTier: room.state.difficultyTier,
          phase: 'boss_room',
        });
      } catch (error) {
        console.warn('Failed to broadcast boss chunk layout', error);
      }
      bossChunkApplied = true;
    } else {
      console.warn(
        'Boss room chunk "dungeon-boss-room" not found in chunks-boss.ts'
      );
    }
  } catch (error) {
    console.warn('Failed to load boss chunk data', error);
  }

  if (!bossChunkApplied) {
    try {
      (room as any).mapGenerator = null;
      (room as any).dungeonChunkLayoutData = [];
      (room as any).chunkLayoutData = [];
    } catch {}
  }

  const defaultCenterX = GAME_CONFIG.WORLD_WIDTH / 2;
  const defaultCenterY = GAME_CONFIG.WORLD_HEIGHT / 2;
  let centerX = defaultCenterX;
  let centerY = defaultCenterY;
  if (bossChunkApplied && bossChunkWidth > 0 && bossChunkHeight > 0) {
    centerX = bossChunkWidth / 2;
    centerY = bossChunkHeight / 2;
  }
  let radius = Math.max(GAME_CONFIG.TILE_SIZE * 5, GAME_CONFIG.TILE_SIZE * 7);
  if (bossChunkApplied && bossChunkWidth > 0 && bossChunkHeight > 0) {
    const maxRadius = Math.min(bossChunkWidth, bossChunkHeight);
    radius = Math.max(
      GAME_CONFIG.TILE_SIZE * 3,
      maxRadius / 2 - GAME_CONFIG.TILE_SIZE
    );
  }

  const playerCount = Math.max(1, room.state.players.size);
  let index = 0;
  room.state.players.forEach((player) => {
    if (bossChunkApplied && bossSpawnPositions.length > 0) {
      const spawn =
        bossSpawnPositions[index] ??
        bossSpawnPositions[index % bossSpawnPositions.length];
      player.x = spawn.x;
      player.y = spawn.y;
    } else {
      const angle = (index / playerCount) * Math.PI * 2;
      const offsetRadius = radius * (player.isBot ? 0.65 : 1);
      player.x = centerX + Math.cos(angle) * offsetRadius;
      player.y = centerY + Math.sin(angle) * offsetRadius;
    }
    index += 1;
  });

  const bossSpawn = { x: centerX, y: centerY - GAME_CONFIG.TILE_SIZE * 2 };
  let boss: any = null;
  try {
    boss = spawnEnemyOfType(room as any, 'portal_guardian', bossSpawn, {
      minDistanceFromOthers: GAME_CONFIG.TILE_SIZE * 8,
      initial: {
        isElite: true,
      },
    });
  } catch (error) {
    console.warn('Failed to spawn boss enemy for boss room', error);
  }

  if (boss) {
    boss.hp = Math.max(boss.hp, boss.maxHp);
    boss.name = (boss.name || 'Portal Guardian') as any;
    (boss as any).isBossEncounter = true;
    (boss as any).rewardMultiplier = Math.max(
      2,
      Number((boss as any).rewardMultiplier) || 2
    );
    attachRandomBossAura(boss);
  }

  broadcaster.broadcast('entered_boss_room', {
    message: 'A powerful foe approaches!',
  });

  try {
    const api = room as unknown as GameRoomApi;
    if (typeof api.emitMatchEvent === 'function') {
      api.emitMatchEvent('boss_room_entered', {
        bossSpawn,
        bossEnemyType: boss?.enemyType ?? 'portal_guardian',
        playerCount,
        floor: (room as any).currentFloor ?? 0,
      });
    }
  } catch (error) {
    console.warn('Failed to emit boss_room_entered event', error);
  }

  emitLeverageSnapshot(room, 'after_boss_transition');
  try {
    (room.state as any).nextTimedSpawnAt = 0;
    (room as any).isRoomTransitioning = false;
  } catch {}
  try {
    (room as any).setPatchRate(__prevPatchRate);
  } catch {}
}

export function transitionAllPlayersToNewMap(
  room: Room<GameRoomState>,
  difficultyTier: string
) {
  if (DEBUG_LOGS)
    console.log(`🗺️ Creating new map with difficulty: ${difficultyTier}`);
  emitLeverageSnapshot(room, 'before_floor_transition');
  const __prevPatchRate = (room as any).patchRate ?? 50;
  try {
    (room as any).setPatchRate(0);
  } catch {}
  try {
    const anyRoom = room as any;
    const current = Number(anyRoom.currentFloor) || 0;
    const nextFloor = current > 0 ? current + 1 : 1;
    if (typeof anyRoom.handleFloorAdvanced === 'function') {
      anyRoom.handleFloorAdvanced(nextFloor);
    } else {
      anyRoom.currentFloor = nextFloor;
      (room.state as any).currentFloor = nextFloor;
      const prevFloorReached = Number((room.state as any).floorReached ?? 0);
      (room.state as any).floorReached = Math.max(nextFloor, prevFloorReached);
    }
    anyRoom.bossEncounterActive = false;
    anyRoom.portalsSpawnedForCurrentFloor = false;
  } catch {}
  // Re-open the floor leverage window for the new floor (Stani prompt),
  // but do not reset the cumulative leverage value.
  try {
    const anyRoom = room as any;
    if (typeof anyRoom.openFloorLeverageForNewFloor === 'function') {
      anyRoom.openFloorLeverageForNewFloor({ broadcast: true });
    }
  } catch {}
  // Pause timed spawns before clearing entities
  try {
    (room as any).isRoomTransitioning = true;
    if (typeof (room as any).pauseEnemyDifficultyMeter === 'function') {
      (room as any).pauseEnemyDifficultyMeter('floor_transition');
    }
    if (typeof (room as any).timedSpawnInterval !== 'undefined') {
      const interval = (room as any)
        .timedSpawnInterval as NodeJS.Timeout | null;
      if (interval) clearInterval(interval);
      (room as any).timedSpawnInterval = null;
    }
    (room.state as any).nextTimedSpawnAt = 0;
  } catch {}

  room.state.entities = new MapSchema<EntitySchema>();
  room.state.enemies = new MapSchema<EnemySchema>();
  room.state.npcs = new MapSchema<NPCSchema>();
  room.state.projectiles = new MapSchema<ProjectileSchema>();
  // Clear filter cache sets to avoid stale references
  room.state._visibleEnemyIds?.clear();
  room.state._visibleNpcIds?.clear();
  room.state._visibleProjectileIds?.clear();
  room.state._discoveredEntityIds?.clear();
  const broadcaster = ensureServerBroadcaster(room);

  room.state.difficultyTier = difficultyTier;

  const newSeed = Math.floor(Math.random() * 1_000_000);
  (room.state as any).seed = newSeed;

  // Prefer using the same chunk sets already loaded by the GameRoom
  // (runtime-generated dungeon chunks). Avoid async here to keep state
  // mutations synchronous during Colyseus patch broadcast.
  let chunkSets: any | undefined;
  try {
    const prevMg = (room as any).mapGenerator as any;
    if (prevMg && prevMg.chunkSets) {
      chunkSets = prevMg.chunkSets;
    }
  } catch (err) {
    console.warn('Error while resolving chunk sets for room transition', err);
  }

  const mapGenerator = new MapGenerator(
    newSeed,
    GAME_CONFIG.MAP_WIDTH,
    GAME_CONFIG.MAP_HEIGHT,
    difficultyTier,
    chunkSets
  );
  // Store on room so collision/walkable mask and other systems can access floors & layout
  (room as any).mapGenerator = mapGenerator;
  const { entities, enemySpawns, chunkLayout } =
    mapGenerator.generateEntities();
  // Expose chunk layout for bounds checks
  (room as any).dungeonChunkLayoutData = chunkLayout;
  (room as any).chunkLayoutData = chunkLayout;
  try {
    (room as any).dungeonEntityBlueprints = entities.map((entity: any) => ({
      id: entity.id,
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      state: entity.state,
    }));
  } catch {}
  try {
    const { clearWalkableMask } = require('./MapCollisionSystem');
    clearWalkableMask(room);
  } catch {}
  for (const e of entities) {
    const ent = new EntitySchema();
    ent.id = e.id;
    ent.kind = e.kind;
    ent.x = e.x;
    ent.y = e.y;
    ent.state = e.state;
    room.state.entities.set(ent.id, ent);
  }

  enemySpawns.forEach((spawn: any) => {
    spawnEnemyOfType(room, spawn.type, { x: spawn.x, y: spawn.y });
  });

  const initialEnemyCount = INITIAL_ENEMY_COUNT;
  for (let i = 0; i < initialEnemyCount; i++) {
    spawnEnemyOfType(room, getRandomEnemyType());
  }

  // Reset elite spawn state and spawn elites for the new floor before placing players,
  // so player spawns can respect min distance from elite leaders.
  try {
    (room as any).resetEliteStateForNewMap?.();
  } catch {}
  try {
    (room as any).resetHuntedForNewFloor?.();
  } catch {}
  try {
    (room as any).spawnElitesForDungeon?.();
  } catch {}

  room.state.players.forEach((player) => {
    setPlayerSpawnPosition(room, player);
  });

  try {
    spawnFloorPortals(room, {
      floorIndex: (room as any).currentFloor ?? 1,
    });
  } catch (error) {
    console.warn('Failed to spawn floor portals on new map', error);
  }

  broadcaster.broadcast('entered_new_map', {
    message: `Entered new realm with ${difficultyTier} difficulty!`,
    difficultyTier,
    floorIndex: (room as any).currentFloor ?? 1,
  });

  try {
    broadcaster.broadcast('chunk_layout_update', {
      chunkLayout,
      difficultyTier,
      phase: room.state.phase,
    });
  } catch (error) {
    console.warn('Failed to broadcast chunk layout update on new map', error);
  }

  const api = room as unknown as GameRoomApi;
  if (typeof api.syncGameMetrics === 'function') {
    api.syncGameMetrics();
  }

  try {
    if (typeof (room as any).enableFogForClients === 'function') {
      (room as any).enableFogForClients({ broadcast: true, reset: true });
    }
  } catch (error) {
    console.warn('Failed to reset fog of war on new map', error);
  }

  // Resume timed spawns for the new map
  try {
    (room as any).isRoomTransitioning = false;
    if (typeof (room as any).resumeEnemyDifficultyMeter === 'function') {
      (room as any).resumeEnemyDifficultyMeter('floor_transition');
    } else if (typeof (room as any).resetEnemyDifficultyMeter === 'function') {
      (room as any).resetEnemyDifficultyMeter();
    }
    const { TIMED_SPAWN } = require('../constants');
    const schedule = () => {
      const now = Date.now();
      (room.state as any).nextTimedSpawnAt = now + TIMED_SPAWN.intervalMs;
    };
    const runSpawn = () => {
      const gameRoom: any = room as any;
      if (TIMED_SPAWN.requireActivePlayers && room.state.players.size === 0) {
        (room.state as any).nextTimedSpawnAt = 0;
        return;
      }
      if (TIMED_SPAWN.pauseDuringTransition && gameRoom.isRoomTransitioning) {
        (room.state as any).nextTimedSpawnAt = 0;
        return;
      }
      if (room.state.enemies.size >= TIMED_SPAWN.maxEnemies) {
        (room.state as any).nextTimedSpawnAt = 0;
        return;
      }
      const count = Math.max(0, TIMED_SPAWN.batchCount | 0);
      const {
        getRandomEnemyType,
        spawnEnemyOfType,
      } = require('./EnemySpawnSystem');
      for (let i = 0; i < count; i++) {
        if (room.state.enemies.size >= TIMED_SPAWN.maxEnemies) break;
        spawnEnemyOfType(room, getRandomEnemyType());
      }
      schedule();
    };
    schedule();
    (room as any).timedSpawnInterval = setInterval(
      runSpawn,
      TIMED_SPAWN.intervalMs
    );
  } catch {}

  if (typeof api.emitMatchEvent === 'function') {
    try {
      api.emitMatchEvent('new_map_entered', {
        difficultyTier,
        playerCount: room.state.players.size,
      });
    } catch (error) {
      console.warn('Failed to emit new_map_entered event', error);
    }
  }

  // After players have been grouped for the new floor, spawn NPCs so Stani
  // is positioned near the party's final spawn cluster.
  spawnNPCs(room);

  try {
    (room as any).setPatchRate(__prevPatchRate);
  } catch {}
}
