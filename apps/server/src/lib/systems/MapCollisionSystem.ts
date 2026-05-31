import type { Room } from 'colyseus';
import { GameRoomState } from '../../schemas';
import type { GameRoomApi } from '../../types/game-room-api';
import { EntityKind } from '../../types';
import { GAME_CONFIG } from '../constants';
import { getObstacleConfig } from '../../data/obstacles';

export function checkObstacleCollision(
  room: Room<GameRoomState>,
  x: number,
  y: number,
  radius: number = 20
): boolean {
  for (const [_, entity] of room.state.entities) {
    if (
      entity.kind === (EntityKind as any).OBSTACLE ||
      entity.kind === 'obstacle'
    ) {
      const state = JSON.parse(entity.state || '{}');
      if (
        state.type === 'tree' ||
        state.type === 'stone' ||
        state.type === 'wall' ||
        state.hasCollision
      ) {
        const obstacleConfig = getObstacleConfig(state.assetId || '');
        const obstacleCenterX = entity.x + obstacleConfig.width / 2;
        const obstacleCenterY =
          entity.y + obstacleConfig.height - obstacleConfig.collisionRadius;
        const distance = Math.sqrt(
          (x - obstacleCenterX) ** 2 + (y - obstacleCenterY) ** 2
        );
        if (distance < radius + obstacleConfig.collisionRadius) return true;
      }
    }
    if (entity.kind === 'portal') {
      const state = JSON.parse(entity.state || '{}');
      if (state.hasCollision) {
        const distance = Math.sqrt((x - entity.x) ** 2 + (y - entity.y) ** 2);
        if (distance < radius + 30) return true;
      }
    }
  }

  return false;
}

export function checkPlayerCollision(
  room: Room<GameRoomState>,
  x: number,
  y: number,
  radius: number = 60
): boolean {
  for (const [_, player] of room.state.players) {
    const distance = Math.sqrt((x - player.x) ** 2 + (y - player.y) ** 2);
    if (distance < radius) return true;
  }
  return false;
}

export function isOnRoad(
  room: Room<GameRoomState>,
  x: number,
  y: number
): boolean {
  // Basic heuristic: treat areas near center tiles as roads if tile metadata exists.
  // If GameRoom has a dedicated road map, prefer delegating to it via an override hook.
  const api = room as unknown as GameRoomApi;
  if (typeof api._isOnRoadImpl === 'function') {
    return api._isOnRoadImpl(x, y);
  }
  // Fallback: consider nothing as roads to keep behavior unchanged where not provided
  return false;
}

export function isSpawnPositionSafe(
  room: Room<GameRoomState>,
  x: number,
  y: number,
  minDistanceFromEnemies: number = 100
): boolean {
  //add a new "isOnFloor" function
  if (!isOnFloor(room, x, y)) return false;

  if (checkObstacleCollision(room, x, y, 20)) return false;
  if (checkPlayerCollision(room, x, y, 60)) return false;
  for (const [_, existingEnemy] of room.state.enemies) {
    const distance = Math.sqrt(
      (existingEnemy.x - x) ** 2 + (existingEnemy.y - y) ** 2
    );
    if (distance < minDistanceFromEnemies) return false;
  }
  return true;
}

export function findRandomSafePosition(
  room: Room<GameRoomState>,
  padding: number = 64,
  minDistanceFromEnemies: number = 100,
  maxAttempts: number = 25
): { x: number; y: number } | null {
  for (let i = 0; i < maxAttempts; i++) {
    const x = padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 2 * padding);
    const y =
      padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - 2 * padding);
    if (isSpawnPositionSafe(room, x, y, minDistanceFromEnemies))
      return { x, y };
  }
  return null;
}

/**
 * Attempts to find a random safe spawn position that lies on a known floor tile
 * provided by the active MapGenerator. This samples tile coordinates instead of
 * uniform world pixels to avoid biasing toward fallback positions near center.
 */
export function findRandomSafeFloorPosition(
  room: Room<GameRoomState>,
  minDistanceFromEnemies: number = 100,
  maxAttempts: number = 200
): { x: number; y: number } | null {
  try {
    const anyRoom: any = room as any;
    const mg = anyRoom.mapGenerator;
    if (!mg) return null;

    const tileSize = GAME_CONFIG.TILE_SIZE;
    const mapWidthTiles = GAME_CONFIG.MAP_WIDTH;
    const mapHeightTiles = GAME_CONFIG.MAP_HEIGHT;

    for (let i = 0; i < maxAttempts; i++) {
      const tx = Math.floor(Math.random() * mapWidthTiles);
      const ty = Math.floor(Math.random() * mapHeightTiles);

      if (typeof mg.hasFloorTile === 'function' && mg.hasFloorTile(tx, ty)) {
        const x = tx * tileSize + tileSize * 0.5;
        const y = ty * tileSize + tileSize * 0.5;
        if (isSpawnPositionSafe(room, x, y, minDistanceFromEnemies)) {
          return { x, y };
        }
      }
    }
  } catch {}
  return null;
}

export function findNearestSafePosition(
  room: Room<GameRoomState>,
  fromX: number,
  fromY: number,
  minDistanceFromEnemies: number = 100,
  maxSearchRadius: number = 320,
  stepRadius: number = 32,
  angleSamples: number = 16
): { x: number; y: number } | null {
  for (let r = stepRadius; r <= maxSearchRadius; r += stepRadius) {
    for (let i = 0; i < angleSamples; i++) {
      const theta = (2 * Math.PI * i) / angleSamples;
      let x = fromX + r * Math.cos(theta);
      let y = fromY + r * Math.sin(theta);
      x = Math.max(0, Math.min(GAME_CONFIG.WORLD_WIDTH - 1, x));
      y = Math.max(0, Math.min(GAME_CONFIG.WORLD_HEIGHT - 1, y));
      if (isSpawnPositionSafe(room, x, y, minDistanceFromEnemies))
        return { x, y };
    }
  }
  return null;
}

/**
 * Returns true when the world position lies on a floor tile as provided by the
 * active MapGenerator (derived from the chunk's floor assets). If floor data
 * is unavailable, this degrades to permissive behavior (returns true) to avoid
 * blocking spawns in legacy rooms.
 */
export function isOnFloor(
  room: Room<GameRoomState>,
  x: number,
  y: number
): boolean {
  try {
    const anyRoom: any = room as any;
    const mg = anyRoom.mapGenerator;
    if (mg) {
      // Prefer fast API if available
      if (typeof mg.isPixelOnFloor === 'function') {
        return mg.isPixelOnFloor(x, y);
      }
      if (typeof mg.hasFloorTile === 'function') {
        const tile = GAME_CONFIG.TILE_SIZE;
        const tx = Math.floor(x / tile);
        const ty = Math.floor(y / tile);
        return mg.hasFloorTile(tx, ty);
      }
      // Fallback to legacy Set API
      if (typeof mg.getFloorTiles === 'function') {
        const floorTiles: Set<string> = mg.getFloorTiles();
        if (floorTiles && floorTiles.size > 0) {
          const tile = GAME_CONFIG.TILE_SIZE;
          const tx = Math.floor(x / tile);
          const ty = Math.floor(y / tile);
          return floorTiles.has(`${tx},${ty}`);
        }
      }
    }
  } catch {}
  // Fallback: allow if floor data not available
  return true;
}
