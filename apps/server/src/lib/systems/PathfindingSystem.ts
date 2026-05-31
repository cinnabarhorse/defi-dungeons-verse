import type { Room } from 'colyseus';
import { GameRoomState, PlayerSchema, EntitySchema } from '../../schemas';
import { GAME_CONFIG } from '../constants';
import { findPath } from '../pathfinding';
import { getObstacleConfig } from '../../data/obstacles';
import { EntityKind } from '../../types';
import { checkObstacleCollision } from './MapCollisionSystem';
import { getMovementSpeedScalar, isEntityStunned } from './StatusSystem';

export function buildObstacleSet(room: Room<GameRoomState>): Set<string> {
  const obstacles = new Set<string>();
  for (const entity of room.state.entities.values()) {
    if (
      entity.kind === (EntityKind as any).OBSTACLE ||
      entity.kind === 'obstacle'
    ) {
      const state = JSON.parse(entity.state || '{}');
      // Treat trees, stones, explicit walls, and any obstacle marked with hasCollision as blocking
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
        const collisionRadius = obstacleConfig.collisionRadius + 20 + 10;
        const radiusInTiles = Math.ceil(
          collisionRadius / GAME_CONFIG.TILE_SIZE
        );
        const centerTileX = Math.floor(obstacleCenterX / GAME_CONFIG.TILE_SIZE);
        const centerTileY = Math.floor(obstacleCenterY / GAME_CONFIG.TILE_SIZE);
        for (let dx = -radiusInTiles; dx <= radiusInTiles; dx++) {
          for (let dy = -radiusInTiles; dy <= radiusInTiles; dy++) {
            const tileX = centerTileX + dx;
            const tileY = centerTileY + dy;
            const tileCenterX =
              tileX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
            const tileCenterY =
              tileY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
            const distance = Math.sqrt(
              (tileCenterX - obstacleCenterX) ** 2 +
                (tileCenterY - obstacleCenterY) ** 2
            );
            if (distance < collisionRadius) obstacles.add(`${tileX},${tileY}`);
          }
        }
      }
    }
    if (entity.kind === 'portal') {
      const state = JSON.parse(entity.state || '{}');
      if (state.hasCollision) {
        const collisionRadius = 30 + 20;
        const radiusInTiles = Math.ceil(
          collisionRadius / GAME_CONFIG.TILE_SIZE
        );
        const centerTileX = Math.floor(entity.x / GAME_CONFIG.TILE_SIZE);
        const centerTileY = Math.floor(entity.y / GAME_CONFIG.TILE_SIZE);
        for (let dx = -radiusInTiles; dx <= radiusInTiles; dx++) {
          for (let dy = -radiusInTiles; dy <= radiusInTiles; dy++) {
            const tileX = centerTileX + dx;
            const tileY = centerTileY + dy;
            const tileCenterX =
              tileX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
            const tileCenterY =
              tileY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
            const distance = Math.sqrt(
              (tileCenterX - entity.x) ** 2 + (tileCenterY - entity.y) ** 2
            );
            if (distance < collisionRadius) obstacles.add(`${tileX},${tileY}`);
          }
        }
      }
    }
  }
  return obstacles;
}

export function isPlayerAdjacentToTile(
  playerX: number,
  playerY: number,
  tileX: number,
  tileY: number
): boolean {
  const distX = Math.abs(playerX - tileX);
  const distY = Math.abs(playerY - tileY);
  return distX <= 1 && distY <= 1 && !(distX === 0 && distY === 0);
}

export function findAdjacentWalkableTile(
  obstacleX: number,
  obstacleY: number,
  playerX: number,
  playerY: number,
  obstacles: Set<string>
): { x: number; y: number } | null {
  for (let radius = 1; radius <= 4; radius++) {
    const candidates: Array<{ x: number; y: number; distance: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (radius > 1 && Math.abs(dx) < radius && Math.abs(dy) < radius)
          continue;
        const candidateX = obstacleX + dx;
        const candidateY = obstacleY + dy;
        if (
          candidateX < 0 ||
          candidateY < 0 ||
          candidateX >= GAME_CONFIG.MAP_WIDTH ||
          candidateY >= GAME_CONFIG.MAP_HEIGHT
        ) {
          continue;
        }
        if (obstacles.has(`${candidateX},${candidateY}`)) continue;
        const distance = Math.sqrt(
          (candidateX - playerX) ** 2 + (candidateY - playerY) ** 2
        );
        candidates.push({ x: candidateX, y: candidateY, distance });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      const chosen = candidates[0];
      return { x: chosen.x, y: chosen.y };
    }
  }
  return null;
}

export function findDirectPathObstacles(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  obstacles: Set<string>
): string[] {
  const blockedPositions: string[] = [];
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);
  const sx = startX < endX ? 1 : -1;
  const sy = startY < endY ? 1 : -1;
  let err = dx - dy;
  let x = startX;
  let y = startY;
  while (true) {
    const key = `${x},${y}`;
    if (obstacles.has(key)) blockedPositions.push(key);
    if (x === endX && y === endY) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return blockedPositions;
}

function distanceToLine(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  if (lenSq === 0) return Math.sqrt(A * A + B * B);
  const param = dot / lenSq;
  let xx: number, yy: number;
  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getNearbyObstacles(
  centerX: number,
  centerY: number,
  obstacles: Set<string>,
  radius: number
): string[] {
  const nearbyObstacles: string[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = centerX + dx;
      const y = centerY + dy;
      const key = `${x},${y}`;
      if (obstacles.has(key)) nearbyObstacles.push(key);
    }
  }
  return nearbyObstacles;
}

export function updateAutoWalking(
  room: Room<GameRoomState>,
  player: PlayerSchema,
  now: number
) {
  try {
    if (isEntityStunned(player, now)) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      if (player.anim !== ('death' as any) && player.anim !== ('hurt' as any)) {
        player.anim = 'idle';
      }
      return;
    }
    const pathNodes: any[] = JSON.parse(player.currentPath);
    if (player.pathIndex >= pathNodes.length) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      player.anim = 'idle';
      return;
    }
    const currentNode = pathNodes[player.pathIndex];

    const targetPixelX = currentNode.x * GAME_CONFIG.TILE_SIZE;
    const targetPixelY = currentNode.y * GAME_CONFIG.TILE_SIZE;
    const distanceX = targetPixelX - player.x;
    const distanceY = targetPixelY - player.y;

    const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
    if (distance < GAME_CONFIG.TILE_SIZE / 2) {
      player.pathIndex++;
      return;
    }
    let velocity = player.isSprinting ? 9.375 * 2 : 9.375;
    if (player.onRoad) velocity *= 1.25;
    velocity *= getMovementSpeedScalar(player, now);
    const normalizedX = distanceX / distance;
    const normalizedY = distanceY / distance;
    const prevX = player.x;
    const prevY = player.y;

    player.x += normalizedX * velocity;
    player.y += normalizedY * velocity;

    if (checkObstacleCollision(room, player.x, player.y, 20)) {
      player.x = prevX;
      player.y = prevY;
      if (!(player as any).repathCount) (player as any).repathCount = 0;
      (player as any).repathCount++;
      if ((player as any).repathCount > 3) {
        player.isAutoWalking = false;
        player.currentPath = '';
        player.pathIndex = 0;
        player.anim = 'idle';
        (player as any).repathCount = 0;
        return;
      }
      const nodes: any[] = JSON.parse(player.currentPath);

      if (nodes.length > 0) {
        const finalTarget = nodes[nodes.length - 1];
        const currentTileX = Math.floor(player.x / GAME_CONFIG.TILE_SIZE);
        const currentTileY = Math.floor(player.y / GAME_CONFIG.TILE_SIZE);
        const obstacles = buildObstacleSet(room);
        const collisionTileX = Math.floor(
          (player.x + normalizedX * velocity) / GAME_CONFIG.TILE_SIZE
        );
        const collisionTileY = Math.floor(
          (player.y + normalizedY * velocity) / GAME_CONFIG.TILE_SIZE
        );
        obstacles.add(`${collisionTileX},${collisionTileY}`);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            obstacles.add(`${collisionTileX + dx},${collisionTileY + dy}`);
          }
        }
        const newPath = findPath(
          currentTileX,
          currentTileY,
          finalTarget.x,
          finalTarget.y,
          obstacles
        );
        if (newPath && newPath.nodes.length > 1) {
          if (newPath.nodes.length > 10) {
            console.log('path length is too long, skipping');
            return;
          }

          player.currentPath = JSON.stringify(newPath.nodes);
          player.pathIndex = 1;
          (player as any).repathCount = 0;
          return;
        } else {
          for (let radius = 1; radius <= 3; radius++) {
            for (let dx = -radius; dx <= radius; dx++) {
              for (let dy = -radius; dy <= radius; dy++) {
                if (Math.abs(dx) !== radius && Math.abs(dy) !== radius)
                  continue;
                const nearX = finalTarget.x + dx;
                const nearY = finalTarget.y + dy;
                if (!obstacles.has(`${nearX},${nearY}`)) {
                  const fallbackPath = findPath(
                    currentTileX,
                    currentTileY,
                    nearX,
                    nearY,
                    obstacles
                  );
                  if (fallbackPath && fallbackPath.nodes.length > 1) {
                    if (fallbackPath.nodes.length > 10) {
                      console.log('path length is too long, skipping');
                      return;
                    }

                    player.currentPath = JSON.stringify(fallbackPath.nodes);
                    player.pathIndex = 1;
                    return;
                  }
                }
              }
            }
          }
        }
      }
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      player.anim = 'idle';
      return;
    }
    if (Math.abs(normalizedX) > Math.abs(normalizedY)) {
      player.dir = normalizedX > 0 ? ('right' as any) : ('left' as any);
    } else {
      player.dir = normalizedY > 0 ? ('down' as any) : ('up' as any);
    }
    player.anim = 'walk';
    player.lastMoveTime = now;
  } catch (error) {
    player.isAutoWalking = false;
    player.currentPath = '';
    player.pathIndex = 0;
  }
}
