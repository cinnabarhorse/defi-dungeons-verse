import { GameRoom } from 'src/rooms/GameRoom';
import { GAME_CONFIG } from './constants';
import { EntitySchema, PlayerSchema } from 'src/schemas';
import { ENEMY_TYPES } from 'src/data/enemies';
import {
  getRandomItemType,
  generateItemData,
  getAllItemCategories,
} from 'src/data/items';
import { spawnDebugPortalsNear } from './systems/PortalSystem';

// Utility function to generate random positions
export function generateRandomPosition(padding: number = 100): {
  x: number;
  y: number;
} {
  const x = padding + Math.random() * (GAME_CONFIG.WORLD_WIDTH - 2 * padding);
  const y = padding + Math.random() * (GAME_CONFIG.WORLD_HEIGHT - 2 * padding);
  return { x, y };
}

// Utility function to generate positions in a circle pattern
export function generateCirclePositions(
  centerX: number,
  centerY: number,
  radius: number,
  count: number
): { x: number; y: number }[] {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    positions.push({ x, y });
  }
  return positions;
}

export function spawnTestItems(room: GameRoom) {
  console.log('🎁 Spawning test items in clumps for vacuum testing...');

  // Get all available item categories dynamically from items.ts
  const itemCategories = getAllItemCategories();
  const numClumps = 5; // Reduced from 20 to 5 clumps for better performance
  const itemsPerClump = 20; // Reduced from 50 to 20 items per clump

  for (let clump = 0; clump < numClumps; clump++) {
    // Random clump center position using utility
    const clumpCenter = generateRandomPosition(200);

    for (let i = 0; i < itemsPerClump; i++) {
      // Random position within clump (50px radius)
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * 50;
      const x = clumpCenter.x + Math.cos(angle) * distance;
      const y = clumpCenter.y + Math.sin(angle) * distance;

      // Get random item category and then random item type from that category
      const randomCategory =
        itemCategories[Math.floor(Math.random() * itemCategories.length)];
      const randomItemType = getRandomItemType(randomCategory);

      // Generate item data using centralized system
      const itemData = generateItemData(randomItemType);

      // Create test item entity
      const testItem = new EntitySchema();
      testItem.id = `test_${clump}_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      testItem.kind = 'collectible';
      testItem.x = x;
      testItem.y = y;
      testItem.state = JSON.stringify(itemData);

      // Add to game state
      room.state.entities.set(testItem.id, testItem);
    }
  }

  console.log(
    `✅ Spawned ${numClumps * itemsPerClump} test items in ${numClumps} clumps (reduced count for better performance)`
  );
}

export function spawnTestEnemies(room: GameRoom, count: number = 20) {
  console.log(`👹 Spawning ${count} random test enemies for debugging...`);

  // Get all available enemy types (excluding fortress and entrance guardians for testing)
  const testEnemyTypes = Object.keys(ENEMY_TYPES).filter(
    (type) => !type.includes('guardian')
  );

  for (let i = 0; i < count; i++) {
    // Select random enemy type
    const randomEnemyType =
      testEnemyTypes[Math.floor(Math.random() * testEnemyTypes.length)];

    // Generate random position using utility
    const position = generateRandomPosition(100);

    room.spawnEnemyOfType(randomEnemyType, position);
  }

  console.log(`👹 Spawned ${count} random test enemies successfully!`);
}

// Function to clear test items
export function clearTestItems(room: GameRoom): number {
  let removedCount = 0;
  for (const [itemId, entity] of room.state.entities) {
    if (entity.kind === 'collectible' && itemId.startsWith('test_')) {
      if (room.state.entities.has(itemId)) {
        room.state.entities.delete(itemId);
      }
      removedCount++;
    }
  }
  console.log(`🧹 Cleared ${removedCount} test items`);
  return removedCount;
}

// Function to spawn RektDoggos in a circle pattern
export function spawnRektDoggos(room: GameRoom, count: number = 3) {
  console.log(`🐕 Spawning ${count} RektDoggos for testing...`);

  const centerX = GAME_CONFIG.WORLD_WIDTH / 2;
  const centerY = GAME_CONFIG.WORLD_HEIGHT / 2;
  const radius = 200;

  const positions = generateCirclePositions(centerX, centerY, radius, count);

  positions.forEach((position) => {
    room.spawnEnemyOfType('rekt_doggo', position);
  });

  console.log(`🐕 Spawned ${count} RektDoggos successfully!`);
}

export function spawnLickys(room: GameRoom, count: number = 3) {
  console.log(`🪼 Spawning ${count} Lickys for testing...`);

  const centerX = GAME_CONFIG.WORLD_WIDTH / 2;
  const centerY = GAME_CONFIG.WORLD_HEIGHT / 2;
  const radius = 300; // Slightly larger radius for Lickys

  const positions = generateCirclePositions(centerX, centerY, radius, count);

  positions.forEach((position) => {
    room.spawnEnemyOfType('licky', position);
  });

  console.log(`🪼 Spawned ${count} Lickys successfully!`);
}

/**
 * Dev-only helper: determines whether a given player should be treated as
 * invincible to all incoming damage.
 *
 * - Only ever returns true when NODE_ENV !== 'production'
 * - Backed by the PlayerSchema.devInvincible flag, toggled via debug messages
 */
export function isPlayerDevInvincible(
  player: PlayerSchema | null | undefined
): boolean {
  if (!player) return false;
  // Hard guard: never allow client-toggled invincibility in production
  if (process.env.NODE_ENV === 'production') return false;
  try {
    return Boolean((player as any).devInvincible);
  } catch {
    return false;
  }
}

// Centralized debug command handler
export function setupDebugHandlers(room: GameRoom) {
  // Dev-only guard: skip registering debug handlers in production
  const isProduction = process.env.NODE_ENV === 'production';

  console.log(
    `🔧 Debug handlers initialized. Production mode: ${isProduction}`
  );

  // Debug command to spawn RektDoggos
  room.onMessage('debug_spawn_doggos', (client, data: { count?: number }) => {
    if (isProduction) return;
    const count = data.count || 3;
    console.log(
      `🐕 Debug command: Spawning ${count} RektDoggos from client ${client.sessionId}`
    );
    spawnRektDoggos(room, count);
  });

  // Debug command to spawn Lickys
  room.onMessage('debug_spawn_lickys', (client, data: { count?: number }) => {
    if (isProduction) return;
    const count = data.count || 3;
    console.log(
      `🪼 Debug command: Spawning ${count} Lickys from client ${client.sessionId}`
    );
    spawnLickys(room, count);
  });

  // Debug command to spawn test items for vacuum testing
  room.onMessage('spawnTestItems', (client) => {
    if (isProduction) return;
    console.log(
      `🎁 Debug command: Spawning test items for vacuum testing from client ${client.sessionId}`
    );
    spawnTestItems(room);
  });

  // Debug command to clear test items
  room.onMessage('clearTestItems', (client) => {
    if (isProduction) return;
    const removedCount = clearTestItems(room);
    console.log(
      `🧹 Cleared ${removedCount} test items from client ${client.sessionId}`
    );
  });

  // Debug command to spawn test enemies
  room.onMessage('spawnTestEnemies', (client, data: { count?: number }) => {
    if (isProduction) return;
    const count = data.count || 20;
    console.log(
      `👹 Debug command: Spawning ${count} test enemies from client ${client.sessionId}`
    );
    spawnTestEnemies(room, count);
  });

  // Debug command: spawn two portals next to the issuing player (dev only)
  room.onMessage('debug_spawn_portals_here', (client) => {
    if (isProduction) {
      console.log('⚠️ Debug command ignored in production');
      return;
    }
    try {
      console.log(
        `🌀 Debug: Received portal spawn request from ${client.sessionId}`
      );
      const player = room.state.players.get(client.sessionId);
      if (!player) {
        console.warn(`❌ Player not found for session ${client.sessionId}`);
        return;
      }

      const originX = Math.floor(player.x);
      const originY = Math.floor(player.y);
      console.log(
        `🌀 Debug: Spawning portals near player ${player.name} at (${originX}, ${originY})`
      );
      spawnDebugPortalsNear(room as any, originX, originY);
    } catch (error) {
      console.warn('Failed to execute debug_spawn_portals_here', error);
    }
  });

  // Debug command: toggle per-player dev invincibility
  room.onMessage(
    'debug_toggle_invincibility',
    (client, data: { enabled?: boolean } | null | undefined) => {
      if (isProduction) return;
      const player = room.state.players.get(client.sessionId);
      if (!player) {
        console.warn(
          `⚠️ debug_toggle_invincibility: player not found for session ${client.sessionId}`
        );
        return;
      }

      const current = (player as any).devInvincible === true;
      const next =
        typeof data?.enabled === 'boolean' ? Boolean(data.enabled) : !current;

      (player as any).devInvincible = next;

      console.log(
        `🛡️ Debug: Player ${client.sessionId} invincibility set to ${next}`
      );
    }
  );
}
