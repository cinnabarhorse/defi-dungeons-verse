/**
 * Game Scene Types
 * Shared type definitions for GameScene interfaces used across the application
 */

import type { Room } from 'colyseus.js';

/**
 * Interface representing GameScene properties needed by various managers
 * This extends Phaser.Scene with optional game-specific properties
 * All game-specific properties are optional to work with different scene types
 */
export interface IGameScene extends Phaser.Scene {
  // Colyseus room connection
  room?: Room | null;

  // Entity tracking - all optional since not all scenes have all entity types
  playerEntities?: { [sessionId: string]: any };
  enemyEntities?: { [enemyId: string]: any };
  npcEntities?: { [npcId: string]: any };
  projectileEntities?: { [projectileId: string]: any };
  droppedItemEntities?: { [itemId: string]: any };
  treasureChestEntities?: { [chestId: string]: any };
  portalEntities?: { [portalId: string]: any };
}
