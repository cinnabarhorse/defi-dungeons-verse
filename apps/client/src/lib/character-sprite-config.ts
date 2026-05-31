/**
 * Character Sprite Configuration
 * Default configuration for the character sprite pack
 */

import type { SpriteSheetConfig } from './character-sprite-manager';

export const DEFAULT_CHARACTER_SPRITE_CONFIG: SpriteSheetConfig = {
  key: 'character_default',
  imagePath: '/sprites/character/character_sheet.png',
  frameWidth: 100, // 100px per frame (confirmed from Unity)
  frameHeight: 100, // 100px per frame (confirmed from Unity)
  animations: [
    // Based on Unity data: 6 frames per row, idle animation confirmed working
    {
      key: 'idle_down',
      row: 0,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: -1,
    },
    // Right idle (left will be flipped version of this)
    {
      key: 'idle_right',
      row: 0,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: -1,
    },
    {
      key: 'idle_up',
      row: 0,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: -1,
    },

    // Walking animations - start simple with just one direction
    {
      key: 'walk_down',
      row: 1,
      startFrame: 0,
      endFrame: 5,
      frameRate: 8,
      repeat: -1,
    },
    // Right walking (left will be flipped version of this)
    {
      key: 'walk_right',
      row: 1,
      startFrame: 0,
      endFrame: 5,
      frameRate: 8,
      repeat: -1,
    },
    {
      key: 'walk_up',
      row: 1,
      startFrame: 0,
      endFrame: 5,
      frameRate: 8,
      repeat: -1,
    },

    // Attack animations - using row 12 (normal attack animation)
    {
      key: 'attack_down',
      row: 12,
      startFrame: 0,
      endFrame: 5,
      frameRate: 6, // Slower to match 1000ms server timing
      repeat: -1, // Loop continuously for actions
    },
    // Right attack (left will be flipped version of this)
    {
      key: 'attack_right',
      row: 12,
      startFrame: 0,
      endFrame: 5,
      frameRate: 6, // Slower to match 1000ms server timing
      repeat: -1, // Loop continuously for actions
    },
    {
      key: 'attack_up',
      row: 12,
      startFrame: 0,
      endFrame: 5,
      frameRate: 6, // Slower to match 1000ms server timing
      repeat: -1, // Loop continuously for actions
    },

    // Ranged attack animations - using row 10 (ranged attack animation, 3 frames)
    {
      key: 'attack_ranged_down',
      row: 10,
      startFrame: 0,
      endFrame: 2, // Only 3 frames (0, 1, 2)
      frameRate: 4, // Adjusted for 3 frames in 800ms timing
      repeat: -1, // Loop continuously for actions
    },
    // Right ranged attack (left will be flipped version of this)
    {
      key: 'attack_ranged_right',
      row: 10,
      startFrame: 0,
      endFrame: 2, // Only 3 frames (0, 1, 2)
      frameRate: 4, // Adjusted for 3 frames in 800ms timing
      repeat: -1, // Loop continuously for actions
    },
    {
      key: 'attack_ranged_up',
      row: 10,
      startFrame: 0,
      endFrame: 2, // Only 3 frames (0, 1, 2)
      frameRate: 4, // Adjusted for 3 frames in 800ms timing
      repeat: -1, // Loop continuously for actions
    },

    // Grenade throw animations (single sequence)
    {
      key: 'throw_down',
      row: 10,
      startFrame: 0,
      endFrame: 2,
      frameRate: 8,
      repeat: 0,
    },
    {
      key: 'throw_right',
      row: 10,
      startFrame: 0,
      endFrame: 2,
      frameRate: 8,
      repeat: 0,
    },
    {
      key: 'throw_up',
      row: 10,
      startFrame: 0,
      endFrame: 2,
      frameRate: 8,
      repeat: 0,
    },

    // Hurt animations - using row 13 (ducking/hurt animation)
    {
      key: 'hurt_down',
      row: 13,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: 0,
    },
    {
      key: 'hurt_right',
      row: 13,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: 0,
    },
    {
      key: 'hurt_up',
      row: 13,
      startFrame: 0,
      endFrame: 5,
      frameRate: 12,
      repeat: 0,
    },
  ],
};

/**
 * Easy-to-adjust configurations for common sprite sizes
 */
export const SPRITE_SIZE_PRESETS = {
  '16x16': { frameWidth: 16, frameHeight: 16 },
  '24x24': { frameWidth: 24, frameHeight: 24 },
  '32x32': { frameWidth: 32, frameHeight: 32 },
  '48x48': { frameWidth: 48, frameHeight: 48 },
  '64x64': { frameWidth: 64, frameHeight: 64 },
};

/**
 * Helper function to create a custom sprite config with different frame size
 */
export function createCustomSpriteConfig(
  frameWidth: number,
  frameHeight: number,
  imagePath: string = '/sprites/character/character_sheet.png'
): SpriteSheetConfig {
  return {
    ...DEFAULT_CHARACTER_SPRITE_CONFIG,
    frameWidth,
    frameHeight,
    imagePath,
  };
}
