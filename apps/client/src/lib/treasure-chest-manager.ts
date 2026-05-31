/**
 * Treasure Chest Manager
 * Handles treasure chest sprite creation, animation, and state management
 */

import type { IGameScene } from '../types/game-scene';
import { TREASURE_CHEST_SPRITE_CONFIG } from './treasure-chest-sprite-config';

// Treasure chest animation frame constants
const TREASURE_CHEST_FRAMES = {
  IDLE_START: 8, // First frame of idle animation (bottom row)
  OPEN_FINAL: 5, // Final frame of opening animation (top row)
} as const;

// Treasure chest color constants
const TREASURE_CHEST_COLORS = {
  CLOSED: 0xdaa520, // Gold color for closed chest
  OPENED: 0x8b4513, // Brown color for opened chest
} as const;

interface TreasureChestState {
  opened?: boolean;
}

interface GameEntity {
  x: number;
  y: number;
  state: string;
  onChange: (callback: () => void) => void;
}

/**
 * Creates a treasure chest sprite with proper animation capabilities
 */
function createTreasureChestSprite(
  scene: IGameScene,
  entity: GameEntity,
  isOpened: boolean
): Phaser.GameObjects.Sprite {
  const sprite = scene.add.sprite(entity.x, entity.y, 'treasure_chest');
  sprite.setScale(3.0);
  // Ensure proper layering using Y-sort so it appears above floors and behind taller entities
  sprite.setDepth(entity.y);

  // Set initial frame based on state
  if (isOpened) {
    sprite.setFrame(TREASURE_CHEST_FRAMES.OPEN_FINAL);
  } else {
    sprite.setFrame(TREASURE_CHEST_FRAMES.IDLE_START);

    // Play idle animation if available
    if (scene.anims.exists('treasure_chest_idle')) {
      sprite.play('treasure_chest_idle');
    }
  }

  return sprite;
}

/**
 * Creates a fallback rectangle for treasure chest when sprite is not available
 */
function createTreasureChestFallback(
  scene: IGameScene,
  entity: GameEntity,
  isOpened: boolean
): Phaser.GameObjects.Rectangle {
  const color = isOpened
    ? TREASURE_CHEST_COLORS.OPENED
    : TREASURE_CHEST_COLORS.CLOSED;
  const rectangle = scene.add.rectangle(entity.x, entity.y, 96, 96, color); // Doubled from 48x48 to 96x96
  rectangle.setStrokeStyle(4, 0x000000); // Doubled stroke width too
  // Match layering behavior with sprite variant
  rectangle.setDepth(entity.y);
  return rectangle;
}

/**
 * Adds click handler to treasure chest sprite
 */
function addTreasureChestClickHandler(
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
  entity: GameEntity,
  entityId: string,
  scene: IGameScene
): void {
  sprite.setInteractive();
  sprite.on('pointerdown', () => {
    const latestState: TreasureChestState = JSON.parse(entity.state || '{}');
    if (!latestState.opened) {
      scene.room?.send('open_chest', { chestId: entityId });
    }
  });
}

/**
 * Ensures sprite has animation capabilities and recreates if necessary
 */
function ensureSpriteAnimationCapabilities(
  sprite: Phaser.GameObjects.Sprite,
  scene: IGameScene,
  entity: GameEntity,
  entityId: string
): Phaser.GameObjects.Sprite {
  if (!sprite.anims) {
    console.log('🔧 Sprite missing animation component, recreating...');
    sprite.destroy();

    const newSprite = createTreasureChestSprite(scene, entity, false);
    if (scene.treasureChestEntities) {
      scene.treasureChestEntities[entityId] = newSprite;
    }
    addTreasureChestClickHandler(newSprite, entity, entityId, scene);

    return newSprite;
  }

  return sprite;
}

/**
 * Plays opening animation on treasure chest sprite
 */
function playTreasureChestOpeningAnimation(
  sprite: Phaser.GameObjects.Sprite,
  scene: IGameScene
): void {
  if (!scene.anims.exists('treasure_chest_open')) {
    console.warn('⚠️ treasure_chest_open animation not found, using fallback');
    sprite.setFrame(TREASURE_CHEST_FRAMES.OPEN_FINAL);
    return;
  }

  try {
    sprite.play('treasure_chest_open');

    // Set final frame when animation completes
    sprite.once('animationcomplete-treasure_chest_open', () => {
      sprite.setFrame(TREASURE_CHEST_FRAMES.OPEN_FINAL);
    });
  } catch (error) {
    console.error('Error playing animation:', error);
    sprite.setFrame(TREASURE_CHEST_FRAMES.OPEN_FINAL);
  }
}

/**
 * Handles treasure chest state changes (opening animation)
 */
function handleTreasureChestStateChange(
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle,
  scene: IGameScene,
  entity: GameEntity,
  entityId: string
): void {
  if (sprite instanceof Phaser.GameObjects.Sprite) {
    const validSprite = ensureSpriteAnimationCapabilities(
      sprite,
      scene,
      entity,
      entityId
    );
    playTreasureChestOpeningAnimation(validSprite, scene);
  } else if (sprite instanceof Phaser.GameObjects.Rectangle) {
    // Update rectangle color for fallback
    sprite.fillColor = TREASURE_CHEST_COLORS.OPENED;
  }
}

/**
 * Main function to render a treasure chest sprite
 */
export function renderTreasureChestSprite(
  scene: IGameScene,
  entity: GameEntity,
  entityId: string
): void {
  const state: TreasureChestState = JSON.parse(entity.state || '{}');
  const isOpened = state.opened || false;

  let chestSprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;

  // Create sprite or fallback rectangle
  if (scene.textures.exists('treasure_chest')) {
    chestSprite = createTreasureChestSprite(scene, entity, isOpened);
  } else {
    chestSprite = createTreasureChestFallback(scene, entity, isOpened);
    console.warn(
      '⚠️ Treasure chest spritesheet not found, using fallback rectangle'
    );

    // If the spritesheet loads later, upgrade the fallback to the real sprite
    const tryUpgrade = (key: string) => {
      if (key !== 'treasure_chest') return;
      try {
        const map = (scene as any).treasureChestEntities || {};
        const current = map[entityId];
        if (!current || !scene.textures.exists('treasure_chest')) return;

        // Replace rectangle with sprite
        const sprite = createTreasureChestSprite(scene, entity, isOpened);
        addTreasureChestClickHandler(sprite, entity, entityId, scene);
        map[entityId] = sprite;
        if (current && typeof current.destroy === 'function') current.destroy();
        console.log('✅ Upgraded treasure chest to sprite after texture load');
      } catch (e) {
        console.warn('⚠️ Failed to upgrade treasure chest sprite:', e);
      } finally {
        // Remove listener after first attempt
        scene.textures.off('addtexture', tryUpgrade as any);
      }
    };

    // Listen for when the texture is added to the texture manager
    scene.textures.on('addtexture', tryUpgrade as any);

    // Also proactively queue the spritesheet load if not already present
    try {
      if (!scene.textures.exists(TREASURE_CHEST_SPRITE_CONFIG.key)) {
        scene.load.spritesheet(
          TREASURE_CHEST_SPRITE_CONFIG.key,
          TREASURE_CHEST_SPRITE_CONFIG.imagePath,
          {
            frameWidth: TREASURE_CHEST_SPRITE_CONFIG.frameWidth,
            frameHeight: TREASURE_CHEST_SPRITE_CONFIG.frameHeight,
          }
        );
        scene.load.once('complete', () =>
          tryUpgrade(TREASURE_CHEST_SPRITE_CONFIG.key)
        );
        // Start the loader (safe to call)
        // Some Phaser typings expose isLoading as a boolean, others omit it; just start.
        scene.load.start();
      }
    } catch {}

    // Final safety: poll a few times in case events were missed
    let attempts = 20;
    const poll = () => {
      if (scene.textures.exists('treasure_chest')) {
        tryUpgrade('treasure_chest');
        return;
      }
      if (--attempts > 0) {
        scene.time.delayedCall(100, poll);
      }
    };
    scene.time.delayedCall(100, poll);
  }

  // Add click handler and store sprite
  addTreasureChestClickHandler(chestSprite, entity, entityId, scene);
  if (scene.treasureChestEntities) {
    scene.treasureChestEntities[entityId] = chestSprite;
  }

  // Listen for state changes (chest opening)
  let currentIsOpened = isOpened;
  entity.onChange(() => {
    const newState: TreasureChestState = JSON.parse(entity.state || '{}');
    const newIsOpened = newState.opened || false;

    if (newIsOpened !== currentIsOpened) {
      currentIsOpened = newIsOpened;
      handleTreasureChestStateChange(chestSprite, scene, entity, entityId);
    }
  });
}
