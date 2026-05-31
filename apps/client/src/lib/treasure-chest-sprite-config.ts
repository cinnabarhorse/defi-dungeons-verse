/**
 * Treasure Chest Sprite Configuration
 * Configuration for treasure chest sprite sheet and animations
 */

import type { SpriteConfig } from './sprite-manager-unified';

/**
 * Treasure Chest Sprite Configuration
 * Based on TreasureChest.png spritesheet layout:
 * - Image dimensions: 512x128px
 * - Frame size: 64x64px
 * - Layout: 8 frames per row, 2 rows total
 * - Bottom row (frames 0-7): Idle animation (8 frames)
 * - Top row (frames 8-13): Opening animation (6 frames)
 */
export const TREASURE_CHEST_SPRITE_CONFIG: SpriteConfig = {
  key: 'treasure_chest',
  imagePath: '/sprites/treasure-chest/treasure_chest.png',
  frameWidth: 64,
  frameHeight: 64,
  animations: [
    {
      key: 'idle',
      row: 1, // Bottom row (y=64)
      startFrame: 0,
      endFrame: 7, // 8 frames for idle animation
      frameRate: 8,
      repeat: -1,
    },
    {
      key: 'open',
      row: 0, // Top row (y=0)
      startFrame: 0,
      endFrame: 5, // 6 frames for opening animation
      frameRate: 12,
      repeat: 0,
    },
  ],
};
