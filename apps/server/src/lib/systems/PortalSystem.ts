import type { Room } from 'colyseus';
import { GameRoomState, EntitySchema } from '../../schemas';
import { PortalEntityState } from '../../types';
import { GAME_CONFIG } from '../constants';
import {
  isSpawnPositionSafe,
  checkObstacleCollision,
  checkPlayerCollision,
  isOnFloor,
  findNearestSafePosition,
  findRandomSafeFloorPosition,
} from './MapCollisionSystem';
import { ensureServerBroadcaster } from '../messaging';

interface PortalDefinition {
  kind: PortalKind;
  label: string;
  portalType: string;
  destination: PortalDestination;
  description: string;
}

interface PortalPlacement {
  x: number;
  y: number;
  score: number;
  definition: PortalDefinition;
  fallback?: boolean;
}

export type PortalKind = 'next_floor' | 'boss_room';
export type PortalDestination = 'next_floor' | 'boss_room';

const TILE_SIZE = GAME_CONFIG.TILE_SIZE;
const MIN_DISTANCE_FROM_SPAWN_TILES = 24; // 1.2 rooms (~768 px)
const MIN_DISTANCE_BETWEEN_PORTALS_TILES = 18; // ~576 px
const MIN_DISTANCE_FROM_EDGE_TILES = 2; // keep portals away from void edges
const MIN_DISTANCE_FROM_SPAWN_PX = MIN_DISTANCE_FROM_SPAWN_TILES * TILE_SIZE;
const MIN_DISTANCE_BETWEEN_PORTALS_PX =
  MIN_DISTANCE_BETWEEN_PORTALS_TILES * TILE_SIZE;
const PORTAL_INTERACTION_RADIUS = 200;
const PORTAL_SOUND_RADIUS = 420;
const PORTAL_SOUND_HYSTERESIS = 24;
const PORTAL_SOUND_BASE_VOLUME = 0.9;
const MAX_PLACEMENT_ATTEMPTS = 600;
const OPEN_AREA_RADIUS_TILES = 3;
const MIN_BOSS_PORTAL_FLOOR = 1;

const PORTAL_DEFINITIONS: Record<PortalKind, PortalDefinition> = {
  next_floor: {
    kind: 'next_floor',
    label: 'Hold to Descend',
    portalType: 'alpha',
    destination: 'next_floor',
    description: 'Descend deeper into the dungeon.',
  },
  boss_room: {
    kind: 'boss_room',
    label: 'Hold to Fight Boss',
    portalType: 'og',
    destination: 'boss_room',
    description: 'Challenge the floor boss for greater rewards.',
  },
};

type ChunkEntry = {
  x: number;
  y: number;
  chunkName: string;
  role?: string;
  tags?: string[];
  anchorX?: number;
  anchorY?: number;
  widthTiles?: number;
  heightTiles?: number;
  worldWidthPx?: number;
  worldHeightPx?: number;
};

type SpawnResult = {
  spawned: number;
  placements: PortalPlacement[];
  attempted: number;
};

const distanceSq = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

const pickRandom = <T>(arr: T[]): T | null => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const index = Math.floor(Math.random() * arr.length);
  return arr[index] ?? null;
};

const isRoomEntry = (entry: ChunkEntry | undefined | null): boolean => {
  if (!entry) return false;
  const role = String(entry.role || 'room').toLowerCase();
  if (role !== 'room') return false;
  const chunkName = String(entry.chunkName || '').toLowerCase();
  if (chunkName.includes('connector') || chunkName.includes('corridor')) {
    return false;
  }
  if (
    Array.isArray(entry.tags) &&
    entry.tags.some((tag) => String(tag).toLowerCase().includes('special'))
  ) {
    return false;
  }
  return true;
};

const getBaseChunkSizeTiles = (
  mapGenerator: any
): {
  widthTiles: number;
  heightTiles: number;
} => {
  if (mapGenerator && typeof mapGenerator.getChunkPixelSize === 'function') {
    try {
      const { widthPx, heightPx } = mapGenerator.getChunkPixelSize();
      const widthTiles = Math.max(1, Math.round(widthPx / TILE_SIZE));
      const heightTiles = Math.max(1, Math.round(heightPx / TILE_SIZE));
      return { widthTiles, heightTiles };
    } catch {}
  }

  const fallback = Math.max(1, Math.round(20));
  return { widthTiles: fallback, heightTiles: fallback };
};

const getChunkDimensionsTiles = (
  entry: ChunkEntry,
  baseWidths: { widthTiles: number; heightTiles: number }
) => {
  const widthTiles =
    Math.max(
      1,
      entry.widthTiles ??
        Math.round(
          (entry.worldWidthPx ?? baseWidths.widthTiles * TILE_SIZE) / TILE_SIZE
        )
    ) || baseWidths.widthTiles;
  const heightTiles =
    Math.max(
      1,
      entry.heightTiles ??
        Math.round(
          (entry.worldHeightPx ?? baseWidths.heightTiles * TILE_SIZE) /
            TILE_SIZE
        )
    ) || baseWidths.heightTiles;
  return { widthTiles, heightTiles };
};

const getChunkOriginTiles = (
  entry: ChunkEntry,
  dimensions: { widthTiles: number; heightTiles: number },
  baseWidths: { widthTiles: number; heightTiles: number }
) => {
  const anchorXTiles =
    typeof entry.anchorX === 'number'
      ? Math.floor(entry.anchorX / TILE_SIZE)
      : entry.x * baseWidths.widthTiles;
  const anchorYTiles =
    typeof entry.anchorY === 'number'
      ? Math.floor(entry.anchorY / TILE_SIZE)
      : entry.y * baseWidths.heightTiles;
  return {
    startTileX: anchorXTiles,
    startTileY: anchorYTiles,
    endTileX: anchorXTiles + dimensions.widthTiles - 1,
    endTileY: anchorYTiles + dimensions.heightTiles - 1,
  };
};

const computeOpenAreaScore = (
  mapGenerator: any,
  tileX: number,
  tileY: number
) => {
  if (!mapGenerator || typeof mapGenerator.hasFloorTile !== 'function') {
    return 0;
  }

  let floorCount = 0;
  for (let dx = -OPEN_AREA_RADIUS_TILES; dx <= OPEN_AREA_RADIUS_TILES; dx++) {
    for (let dy = -OPEN_AREA_RADIUS_TILES; dy <= OPEN_AREA_RADIUS_TILES; dy++) {
      const sampleX = tileX + dx;
      const sampleY = tileY + dy;
      if (mapGenerator.hasFloorTile(sampleX, sampleY)) {
        floorCount += 1;
      }
    }
  }
  return floorCount;
};

const passesEdgeConstraints = (tileX: number, tileY: number) => {
  if (
    tileX < MIN_DISTANCE_FROM_EDGE_TILES ||
    tileY < MIN_DISTANCE_FROM_EDGE_TILES
  ) {
    return false;
  }
  if (
    tileX >= GAME_CONFIG.MAP_WIDTH - MIN_DISTANCE_FROM_EDGE_TILES ||
    tileY >= GAME_CONFIG.MAP_HEIGHT - MIN_DISTANCE_FROM_EDGE_TILES
  ) {
    return false;
  }
  return true;
};

interface PlacementContext {
  room: Room<GameRoomState>;
  mapGenerator: any;
  roomEntries: ChunkEntry[];
  baseChunkSize: { widthTiles: number; heightTiles: number };
  spawnPoints: Array<{ x: number; y: number }>;
  existingPlacements: PortalPlacement[];
  minSpawnDistanceSq: number;
  minPortalDistanceSq: number;
}

const trySamplePortalPosition = (
  ctx: PlacementContext,
  definition: PortalDefinition
): PortalPlacement | null => {
  const {
    room,
    mapGenerator,
    roomEntries,
    baseChunkSize,
    spawnPoints,
    existingPlacements,
    minSpawnDistanceSq,
    minPortalDistanceSq,
  } = ctx;

  let best: PortalPlacement | null = null;
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt += 1) {
    const entry = pickRandom(roomEntries);
    if (!entry) continue;

    const { widthTiles, heightTiles } = getChunkDimensionsTiles(
      entry,
      baseChunkSize
    );
    const bounds = getChunkOriginTiles(
      entry,
      { widthTiles, heightTiles },
      baseChunkSize
    );

    const localTileX =
      bounds.startTileX +
      Math.max(0, Math.floor(Math.random() * Math.max(1, widthTiles)));
    const localTileY =
      bounds.startTileY +
      Math.max(0, Math.floor(Math.random() * Math.max(1, heightTiles)));

    if (!passesEdgeConstraints(localTileX, localTileY)) {
      continue;
    }

    if (
      mapGenerator &&
      typeof mapGenerator.hasFloorTile === 'function' &&
      !mapGenerator.hasFloorTile(localTileX, localTileY)
    ) {
      continue;
    }

    const centerX = localTileX * TILE_SIZE + TILE_SIZE / 2;
    const centerY = localTileY * TILE_SIZE + TILE_SIZE / 2;

    if (!isOnFloor(room, centerX, centerY)) {
      continue;
    }

    if (!isSpawnPositionSafe(room, centerX, centerY, TILE_SIZE * 2)) {
      continue;
    }

    if (
      checkObstacleCollision(room, centerX, centerY, TILE_SIZE * 2) ||
      checkPlayerCollision(room, centerX, centerY, TILE_SIZE * 2)
    ) {
      continue;
    }

    if (
      spawnPoints.length > 0 &&
      spawnPoints.some(
        (spawn) =>
          distanceSq(centerX, centerY, spawn.x, spawn.y) < minSpawnDistanceSq
      )
    ) {
      continue;
    }

    if (
      existingPlacements.some(
        (placement) =>
          distanceSq(centerX, centerY, placement.x, placement.y) <
          minPortalDistanceSq
      )
    ) {
      continue;
    }

    const score = computeOpenAreaScore(mapGenerator, localTileX, localTileY);
    if (!best || score > best.score) {
      best = {
        x: centerX,
        y: centerY,
        score,
        definition,
      };
    }
  }

  return best;
};

const fallbackPlacement = (
  ctx: PlacementContext,
  definition: PortalDefinition
): PortalPlacement | null => {
  const { room, spawnPoints, existingPlacements, minPortalDistanceSq } = ctx;

  const target = spawnPoints[0] ?? {
    x: GAME_CONFIG.WORLD_WIDTH / 2,
    y: GAME_CONFIG.WORLD_HEIGHT / 2,
  };

  const fallbackRadius = Math.max(
    MIN_DISTANCE_BETWEEN_PORTALS_PX,
    TILE_SIZE * 12
  );

  const nearest = findNearestSafePosition(
    room,
    target.x,
    target.y,
    fallbackRadius,
    fallbackRadius * 2,
    TILE_SIZE
  );
  if (nearest) {
    if (
      existingPlacements.some(
        (placement) =>
          distanceSq(nearest.x, nearest.y, placement.x, placement.y) <
          minPortalDistanceSq
      )
    ) {
      return null;
    }
    return {
      x: nearest.x,
      y: nearest.y,
      score: 0,
      definition,
      fallback: true,
    };
  }

  const randomSafe = findRandomSafeFloorPosition(room, TILE_SIZE * 8, 200);
  if (randomSafe) {
    if (
      existingPlacements.some(
        (placement) =>
          distanceSq(randomSafe.x, randomSafe.y, placement.x, placement.y) <
          minPortalDistanceSq
      )
    ) {
      return null;
    }
    return {
      x: randomSafe.x,
      y: randomSafe.y,
      score: -1,
      definition,
      fallback: true,
    };
  }

  return null;
};

const resolvePortalDefinitions = (
  floorIndex: number,
  includeBoss: boolean
): PortalDefinition[] => {
  const defs: PortalDefinition[] = [PORTAL_DEFINITIONS.next_floor];
  if (includeBoss) {
    defs.push(PORTAL_DEFINITIONS.boss_room);
  }
  return defs;
};

const spawnPortalEntity = (
  room: Room<GameRoomState>,
  placement: PortalPlacement,
  floorIndex: number
) => {
  const { definition, x, y } = placement;
  const entity = new EntitySchema();
  entity.id = `portal_${definition.kind}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  entity.kind = 'portal' as any;
  entity.x = Math.round(x);
  entity.y = Math.round(y);
  // Typed portal audio/interaction state
  const portalState: PortalEntityState = {
    label: definition.label, // action prompt shown near the portal
    interactionRadius: PORTAL_INTERACTION_RADIUS, // px distance to allow interaction
    soundRadius: PORTAL_SOUND_RADIUS, // px max audible distance
    soundHysteresis: PORTAL_SOUND_HYSTERESIS, // px margin to avoid rapid on/off at edge
    soundBaseVolume: PORTAL_SOUND_BASE_VOLUME, // base volume scalar [0..1]
  };

  entity.state = JSON.stringify({
    type: 'portal',
    portalKind: definition.kind,
    portalType: definition.portalType,
    destination: definition.destination,
    description: definition.description,
    indestructible: true,
    hasCollision: false,
    pullParty: true,
    floorIndex,
    fallback: placement.fallback ?? false,
    ...portalState,
  });
  room.state.entities.set(entity.id, entity);
  return entity;
};

export const spawnFloorPortals = (
  room: Room<GameRoomState>,
  options: { floorIndex?: number; includeBossPortal?: boolean } = {}
): SpawnResult => {
  const anyRoom = room as any;

  const alreadySpawned = Boolean(anyRoom.portalsSpawnedForCurrentFloor);
  if (alreadySpawned) {
    return { spawned: 0, placements: [], attempted: 0 };
  }

  if (anyRoom.bossEncounterActive) {
    return { spawned: 0, placements: [], attempted: 0 };
  }

  const floorIndex =
    typeof options.floorIndex === 'number'
      ? options.floorIndex
      : typeof anyRoom.currentFloor === 'number'
        ? anyRoom.currentFloor
        : 1;

  const includeBoss =
    options.includeBossPortal ??
    (floorIndex >= MIN_BOSS_PORTAL_FLOOR &&
      !Boolean(anyRoom.bossEncounterActive));

  const mapGenerator = anyRoom.mapGenerator;
  if (!mapGenerator) {
    console.warn(
      'spawnFloorPortals: mapGenerator unavailable, skipping portal spawn'
    );
    return { spawned: 0, placements: [], attempted: 0 };
  }

  const chunkEntries: ChunkEntry[] = Array.isArray(
    anyRoom.dungeonChunkLayoutData
  )
    ? anyRoom.dungeonChunkLayoutData.filter(isRoomEntry)
    : [];

  if (chunkEntries.length === 0) {
    console.warn(
      'spawnFloorPortals: no eligible room chunks found, skipping portal spawn'
    );
    return { spawned: 0, placements: [], attempted: 0 };
  }

  const baseChunkSize = getBaseChunkSizeTiles(mapGenerator);
  const spawnPoints: Array<{ x: number; y: number }> =
    typeof mapGenerator.getSpawnPoints === 'function'
      ? mapGenerator.getSpawnPoints()
      : [];

  const minSpawnDistanceSq = Math.max(
    MIN_DISTANCE_FROM_SPAWN_PX * MIN_DISTANCE_FROM_SPAWN_PX,
    TILE_SIZE * TILE_SIZE * 225
  );
  const minPortalDistanceSq = Math.max(
    MIN_DISTANCE_BETWEEN_PORTALS_PX * MIN_DISTANCE_BETWEEN_PORTALS_PX,
    TILE_SIZE * TILE_SIZE * 144
  );

  const ctx: PlacementContext = {
    room,
    mapGenerator,
    roomEntries: chunkEntries,
    baseChunkSize,
    spawnPoints,
    existingPlacements: [],
    minSpawnDistanceSq,
    minPortalDistanceSq,
  };

  const definitions = resolvePortalDefinitions(floorIndex, includeBoss);
  const placements: PortalPlacement[] = [];
  let attempts = 0;

  for (const definition of definitions) {
    ctx.existingPlacements = placements;
    const placement = trySamplePortalPosition(ctx, definition);
    attempts += MAX_PLACEMENT_ATTEMPTS;
    if (placement) {
      placements.push(placement);
      spawnPortalEntity(room, placement, floorIndex);
      continue;
    }

    const fallback = fallbackPlacement(ctx, definition);
    if (fallback) {
      placements.push(fallback);
      spawnPortalEntity(room, fallback, floorIndex);
    } else {
      console.warn(
        `spawnFloorPortals: failed to place portal ${definition.kind}`
      );
    }
  }

  if (placements.length > 0) {
    anyRoom.portalsSpawnedForCurrentFloor = true;
    const broadcaster = ensureServerBroadcaster(room);
    try {
      broadcaster.broadcast('portals_opened', {
        // Only include a message when there are multiple portals to choose from
        message:
          placements.length > 1
            ? 'Two portals have appeared! Choose your path.'
            : undefined,
        portalCount: placements.length,
        floorIndex,
        portals: placements.map((placement) => ({
          kind: placement.definition.kind,
          label: placement.definition.label,
          x: Math.round(placement.x),
          y: Math.round(placement.y),
          fallback: Boolean(placement.fallback),
        })),
      });
    } catch (error) {
      console.warn(
        'spawnFloorPortals: failed to broadcast portals_opened',
        error
      );
    }

    try {
      const api = room as unknown as {
        emitMatchEvent?: (
          event: string,
          payload?: Record<string, unknown>
        ) => void;
      };
      if (typeof api.emitMatchEvent === 'function') {
        api.emitMatchEvent('portals_spawned', {
          floorIndex,
          portalCount: placements.length,
          includeBoss,
          placements: placements.map((placement) => ({
            kind: placement.definition.kind,
            x: Math.round(placement.x),
            y: Math.round(placement.y),
            score: placement.score,
            fallback: placement.fallback ?? false,
          })),
        });
      }
    } catch (error) {
      console.warn(
        'spawnFloorPortals: failed to emit portals_spawned event',
        error
      );
    }
  } else {
    anyRoom.portalsSpawnedForCurrentFloor = false;
  }

  return { spawned: placements.length, placements, attempted: attempts };
};

export const spawnDebugPortalsNear = (
  room: Room<GameRoomState>,
  originX: number,
  originY: number
) => {
  const definitions = [
    PORTAL_DEFINITIONS.next_floor,
    PORTAL_DEFINITIONS.boss_room,
  ];
  const placements: PortalPlacement[] = [];

  definitions.forEach((definition, index) => {
    const offsetX = (index === 0 ? -1 : 1) * TILE_SIZE * 4;
    const targetX = originX + offsetX;
    const targetY = originY;

    const nearest = findNearestSafePosition(
      room,
      targetX,
      targetY,
      TILE_SIZE * 2,
      TILE_SIZE * 8,
      TILE_SIZE
    );
    const position = nearest ?? { x: targetX, y: targetY };
    const placement: PortalPlacement = {
      x: position.x,
      y: position.y,
      score: 0,
      definition,
      fallback: !nearest,
    };
    placements.push(placement);
    spawnPortalEntity(room, placement, (room as any).currentFloor ?? 1);
  });

  const broadcaster = ensureServerBroadcaster(room);
  try {
    broadcaster.broadcast('portals_opened', {
      message: 'Debug portals have appeared!',
      portalCount: placements.length,
      debug: true,
    });
  } catch {}
};
