/**
 * Character Sprite Animation Manager
 * Handles sprite sheet animations for character sprites
 */

import { DEFAULT_CHARACTER_SPRITE_CONFIG } from './character-sprite-config';
import {
  getCharacter,
  getRandomCharacter,
  getCharacterConfig,
  getCharacterStats,
  type Character,
} from './character-registry';

export interface SpriteSheetConfig {
  key: string;
  imagePath: string;
  frameWidth: number;
  frameHeight: number;
  animations: AnimationConfig[];
}

export interface AnimationConfig {
  key: string;
  row: number;
  startFrame: number;
  endFrame: number;
  frameRate: number;
  repeat: number; // -1 for infinite loop
}

export interface DirectionalAnimations {
  down: AnimationConfig[];
  left: AnimationConfig[];
  right: AnimationConfig[];
  up: AnimationConfig[];
}

export class CharacterSpriteManager {
  private scene: Phaser.Scene;
  private spriteSheets: Map<string, SpriteSheetConfig> = new Map();
  private loadedSprites: Set<string> = new Set();
  private playerCharacters: Map<string, string> = new Map(); // sessionId -> characterId

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Default character sprite configuration
   * Based on analysis of the provided sprite sheet
   */
  getDefaultSpriteConfig(): SpriteSheetConfig {
    return DEFAULT_CHARACTER_SPRITE_CONFIG;
  }

  /**
   * Load a sprite sheet and create animations
   */
  async loadSpriteSheet(config: SpriteSheetConfig): Promise<void> {
    if (this.loadedSprites.has(config.key)) {
      return; // Already loaded
    }

    return new Promise((resolve, reject) => {
      // Load the sprite sheet with nearest neighbor filtering for crisp pixels
      this.scene.load.spritesheet(config.key, config.imagePath, {
        frameWidth: config.frameWidth,
        frameHeight: config.frameHeight,
      });

      // Set texture filtering to nearest for crisp pixel art
      this.scene.load.once('complete', () => {
        const texture = this.scene.textures.get(config.key);
        if (texture && texture.source[0]) {
          texture.source[0].scaleMode = Phaser.ScaleModes.NEAREST;
        }
      });

      const onComplete = () => {
        try {
          // Create animations from config
          this.createAnimationsFromConfig(config);

          this.spriteSheets.set(config.key, config);
          this.loadedSprites.add(config.key);

          this.scene.load.off('complete', onComplete);
          this.scene.load.off('loaderror', onError);
          resolve();
        } catch (error) {
          reject(error);
        }
      };

      const onError = (file: any) => {
        if (file.key === config.key) {
          this.scene.load.off('complete', onComplete);
          this.scene.load.off('loaderror', onError);
          reject(new Error(`Failed to load sprite sheet: ${config.key}`));
        }
      };

      this.scene.load.on('complete', onComplete);
      this.scene.load.on('loaderror', onError);
      this.scene.load.start();
    });
  }

  /**
   * Create Phaser animations from configuration
   */
  private createAnimationsFromConfig(config: SpriteSheetConfig): void {
    // Calculate frames per row based on sprite sheet dimensions
    const textureWidth = this.scene.textures.get(config.key).source[0].width;
    const textureHeight = this.scene.textures.get(config.key).source[0].height;
    const framesPerRow = Math.floor(textureWidth / config.frameWidth);
    const totalRows = Math.floor(textureHeight / config.frameHeight);

    config.animations.forEach((animConfig) => {
      // Calculate actual frame numbers based on row and column
      const startFrameNumber =
        animConfig.row * framesPerRow + animConfig.startFrame;
      const endFrameNumber =
        animConfig.row * framesPerRow + animConfig.endFrame;

      const frames = this.scene.anims.generateFrameNumbers(config.key, {
        start: startFrameNumber,
        end: endFrameNumber,
      });

      // Create character-specific animation key to avoid conflicts
      const characterSpecificKey = `${config.key}_${animConfig.key}`;

      // Check if animation already exists
      if (this.scene.anims.exists(characterSpecificKey)) {
        this.scene.anims.remove(characterSpecificKey);
      }

      this.scene.anims.create({
        key: characterSpecificKey,
        frames: frames,
        frameRate: animConfig.frameRate,
        repeat: animConfig.repeat,
      });
    });
  }

  /**
   * Create a character sprite with animations
   */
  createCharacterSprite(
    x: number,
    y: number,
    spriteSheetKey: string = 'character_default'
  ): Phaser.GameObjects.Sprite {
    const sprite = this.scene.add.sprite(x, y, spriteSheetKey);

    // Set default animation
    sprite.play('idle_down');

    return sprite;
  }

  /**
   * Get animation key based on action and direction
   */
  getAnimationKey(action: string, direction: string): string {
    // Map game directions to sprite directions
    let spriteDirection: string;
    switch (direction) {
      case 'left':
        spriteDirection = 'left';
        break;
      case 'right':
        spriteDirection = 'right';
        break;
      case 'up':
        spriteDirection = 'up';
        break;
      case 'down':
      default:
        spriteDirection = 'down';
        break;
    }

    return `${action}_${spriteDirection}`;
  }

  /**
   * Update character animation based on current state
   */
  updateCharacterAnimation(
    sprite: Phaser.GameObjects.Sprite,
    action: string,
    direction: string,
    characterId?: string,
    intervalMs?: number
  ): void {
    // For attack actions, determine if we should use ranged attack animation
    let finalAction = action;
    if (action === 'attack' && characterId) {
      const characterStats = getCharacterStats(characterId);
      if (characterStats.weaponType === 'ranged') {
        finalAction = 'attack_ranged';
      }
    }

    // Handle sprite flipping for left/right directions - use the working approach
    let animationKey: string;
    let shouldFlipX = false;

    if (direction === 'left') {
      // Use right animation but flip the sprite
      animationKey = `${finalAction}_right`;
      shouldFlipX = true;
    } else if (direction === 'right') {
      // Use right animation normally
      animationKey = `${finalAction}_right`;
      shouldFlipX = false;
    } else {
      // Use the specified direction (up/down)
      animationKey = `${finalAction}_${direction}`;
    }

    // Apply sprite flipping
    sprite.setFlipX(shouldFlipX);

    // Try character-specific animation first, then fallback to generic
    const textureKey = sprite.texture.key;
    const characterSpecificKey = `${textureKey}_${animationKey}`;

    let finalAnimationKey = animationKey; // Default to generic
    if (this.scene.anims.exists(characterSpecificKey)) {
      finalAnimationKey = characterSpecificKey; // Use character-specific if available
    }

    // Compute and apply time scale for attack animations to match server interval
    const isAttackAnim =
      finalAction === 'attack' ||
      finalAction === 'attack_ranged' ||
      finalAction === 'throw';

    if (isAttackAnim && typeof intervalMs === 'number' && intervalMs > 0) {
      const textureKey = sprite.texture.key;
      const baseDurationSec = this.getAnimationBaseDuration(
        textureKey,
        animationKey
      );
      const targetDurationSec = intervalMs / 1000;
      const rawScale =
        baseDurationSec > 0 ? baseDurationSec / targetDurationSec : 1;
      // Allow wider speedup so full animation still advances across frames
      let clampedScale = Math.max(0.1, Math.min(8, rawScale));
      // Visual-only per-character scaling from shared config
      if (characterId) {
        try {
          const stats = getCharacterStats(characterId) as any;
          const visualScale =
            finalAction === 'attack_ranged'
              ? stats.attackRangedVisualScale
              : stats.attackVisualScale;
          if (typeof visualScale === 'number' && visualScale !== 1) {
            clampedScale = Math.min(8, clampedScale * visualScale);
          }
        } catch {}
      }
      if (sprite.anims) {
        sprite.anims.timeScale = clampedScale;
      }
    } else {
      // Reset to normal speed for non-attack animations or unknown intervals
      if (sprite.anims) {
        sprite.anims.timeScale = 1;
      }
    }

    // For attack animations, always ensure a visible restart even if the key matches
    const safePlay = (key: string) => {
      // Guard against missing anims system or undefined animation data
      if (!sprite.anims || !sprite.anims.animationManager) return;
      const anim = sprite.anims.animationManager.get(key);
      if (!anim) return;
      // Some Phaser versions assume an animation has a config; defensive check
      if ((anim as any).frames?.length === 0) return;
      sprite.play(key);
    };

    if (isAttackAnim) {
      if (this.scene.anims.exists(finalAnimationKey)) {
        const canRestart =
          !!sprite.anims?.currentAnim &&
          sprite.anims.currentAnim.key === finalAnimationKey &&
          Array.isArray((sprite.anims.currentAnim as any).frames) &&
          (sprite.anims.currentAnim as any).frames.length > 0;

        if (canRestart) {
          try {
            sprite.anims.restart();
          } catch {
            // If restart trips internal phaser state, fall back to play
            safePlay(finalAnimationKey);
          }
        } else {
          safePlay(finalAnimationKey);
        }
      } else {
        console.warn(`Animation ${finalAnimationKey} does not exist`);
        if (this.scene.anims.exists('idle_down')) {
          safePlay('idle_down');
        }
      }
    } else {
      // Non-attack animations: only switch if different
      if (sprite.anims?.currentAnim?.key !== finalAnimationKey) {
        if (this.scene.anims.exists(finalAnimationKey)) {
          safePlay(finalAnimationKey);
        } else {
          console.warn(`Animation ${finalAnimationKey} does not exist`);
          if (this.scene.anims.exists('idle_down')) {
            safePlay('idle_down');
          }
        }
      }
    }
  }

  /**
   * Calculate the base loop duration (in seconds) for a given animation
   */
  private getAnimationBaseDuration(
    textureKey: string,
    animationKey: string
  ): number {
    const config = this.spriteSheets.get(textureKey);
    if (!config) return 1; // Sensible default

    const anim = config.animations.find((a) => a.key === animationKey);
    if (!anim) return 1;

    const numFrames = Math.max(1, anim.endFrame - anim.startFrame + 1);
    const frameRate = Math.max(1, anim.frameRate);
    return numFrames / frameRate;
  }

  /**
   * Load a specific character for a player
   */
  async loadCharacterForPlayer(
    sessionId: string,
    characterId?: string
  ): Promise<string> {
    // If an explicit id is provided, try to load it even if it's not in CHARACTERS
    if (characterId) {
      try {
        const cfg = getCharacterConfig(characterId);
        await this.loadSpriteSheet(cfg);
        this.playerCharacters.set(sessionId, characterId);
        return characterId;
      } catch (err) {
        // Fallback to known character set
      }
    }

    const fallback = getRandomCharacter();
    const config = getCharacterConfig(fallback.id);
    await this.loadSpriteSheet(config);
    this.playerCharacters.set(sessionId, fallback.id);

    return fallback.id;
  }

  /**
   * Get the character ID for a player
   */
  getPlayerCharacter(sessionId: string): string | null {
    return this.playerCharacters.get(sessionId) || null;
  }

  /**
   * Create character sprite with specific character type
   */
  createCharacterSpriteForPlayer(
    sessionId: string,
    x: number,
    y: number,
    characterId?: string
  ): Phaser.GameObjects.Sprite {
    const actualCharacterId =
      characterId || this.getPlayerCharacter(sessionId) || 'coderdan';

    console.log(`🎭 CharacterSpriteManager.createCharacterSpriteForPlayer:`, {
      sessionId,
      characterId,
      actualCharacterId,
      isGotchi: actualCharacterId.startsWith('gotchi:'),
    });

    const character = getCharacter(actualCharacterId);

    if (!character) {
      console.error(`🎭 Character ${actualCharacterId} not found in registry`);
      throw new Error(`Character ${actualCharacterId} not found`);
    }

    const config = getCharacterConfig(actualCharacterId);

    // If the texture isn't present yet, force-load it now using the config
    if (!this.scene.textures.exists(config.key)) {
      try {
        // Kick off the load synchronously using existing loader
        const sheetLoaded = this.loadSpriteSheet(config);
        // Note: loadSpriteSheet returns a Promise; we don't await here because this
        // method is expected to return a sprite. Create a placeholder and swap later.
      } catch (e) {
        console.warn('Failed to trigger spritesheet load for', config.key, e);
      }
      const sprite = this.scene.add.sprite(x, y, config.key);
      return sprite;
    }

    if (!this.scene.textures.exists(config.key)) {
      // Defer rendering until the texture is available; attach a minimal placeholder
      const sprite = this.scene.add.sprite(x, y, config.key);
      return sprite;
    }

    const sprite = this.scene.add.sprite(x, y, config.key);

    // Play character-specific idle animation
    const idleAnimationKey = `${config.key}_idle_down`;
    if (this.scene.anims.exists(idleAnimationKey)) {
      sprite.play(idleAnimationKey);
    } else {
      console.warn(
        `Animation ${idleAnimationKey} not found, trying generic idle_down`
      );
      sprite.play('idle_down');
    }

    return sprite;
  }

  /**
   * Preload default character sprites (loads Coderdan as default)
   */
  async preloadDefaultCharacterSprites(): Promise<void> {
    const defaultConfig = getCharacterConfig('coderdan'); // Use character registry
    await this.loadSpriteSheet(defaultConfig);
  }

  /**
   * Preload all character sprites for bot variety
   */
  async preloadAllCharacterSprites(): Promise<void> {
    const { CHARACTERS } = await import('./character-registry');

    for (const character of CHARACTERS) {
      try {
        const config = getCharacterConfig(character.id);
        await this.loadSpriteSheet(config);
      } catch (error) {
        console.warn(
          `⚠️ Failed to load ${character.info.name} sprites:`,
          error
        );
      }
    }
  }

  /**
   * Check if sprite sheet is loaded
   */
  isSpriteSheetLoaded(key: string): boolean {
    return this.loadedSprites.has(key);
  }

  /**
   * Get all loaded sprite sheet configurations
   */
  getAllSpriteSheets(): Map<string, SpriteSheetConfig> {
    return new Map(this.spriteSheets);
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.spriteSheets.clear();
    this.loadedSprites.clear();
  }
}

/**
 * Utility function to automatically calculate sprite sheet dimensions
 * from an image (useful for development)
 */
export function calculateSpriteSheetDimensions(
  image: HTMLImageElement,
  expectedRows: number,
  expectedCols: number
): { frameWidth: number; frameHeight: number } {
  return {
    frameWidth: Math.floor(image.width / expectedCols),
    frameHeight: Math.floor(image.height / expectedRows),
  };
}
