/**
 * Unified Sprite Manager
 * Abstracts sprite loading and animation logic for both characters and enemies
 */

import { IGameScene } from '../types/game-scene';

export interface SpriteConfig {
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
  duration?: number; // Optional duration override
}

export class UnifiedSpriteManager {
  private scene: IGameScene;
  private loadedSprites: Set<string> = new Set();
  private spriteConfigs: Map<string, SpriteConfig> = new Map();

  constructor(scene: IGameScene) {
    this.scene = scene;
  }

  /**
   * Load a sprite sheet and create animations (same logic as character system)
   */
  async loadSpriteSheet(config: SpriteConfig): Promise<void> {
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

          this.spriteConfigs.set(config.key, config);
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
   * Create Phaser animations from configuration (same as character system)
   */
  private createAnimationsFromConfig(config: SpriteConfig): void {
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

      // Create sprite-specific animation key to avoid conflicts
      const spriteSpecificKey = `${config.key}_${animConfig.key}`;

      // Check if animation already exists
      if (this.scene.anims.exists(spriteSpecificKey)) {
        this.scene.anims.remove(spriteSpecificKey);
      }

      this.scene.anims.create({
        key: spriteSpecificKey,
        frames: frames,
        frameRate: animConfig.frameRate,
        repeat: animConfig.repeat,
        duration: animConfig.duration,
      });
    });
  }

  /**
   * Create a sprite with proper initialization
   */
  createSprite(
    x: number,
    y: number,
    spriteKey: string,
    initialAnimation?: string
  ): Phaser.GameObjects.Sprite {
    if (!this.scene.textures.exists(spriteKey)) {
      throw new Error(`Sprite texture ${spriteKey} not loaded!`);
    }

    const sprite = this.scene.add.sprite(x, y, spriteKey);

    // Play initial animation if specified
    if (initialAnimation) {
      const fullAnimKey = `${spriteKey}_${initialAnimation}`;
      if (this.scene.anims.exists(fullAnimKey)) {
        sprite.play(fullAnimKey);
      } else {
        console.warn(
          `Animation ${fullAnimKey} not found for sprite ${spriteKey}`
        );
      }
    }

    return sprite;
  }

  /**
   * Play animation on a sprite
   */
  playAnimation(sprite: Phaser.GameObjects.Sprite, animationKey: string): void {
    const spriteKey = sprite.texture.key;
    const fullAnimKey = `${spriteKey}_${animationKey}`;

    // Only change animation if it's different from current
    if (sprite.anims.currentAnim?.key !== fullAnimKey) {
      if (this.scene.anims.exists(fullAnimKey)) {
        sprite.play(fullAnimKey);
      } else {
        console.warn(`Animation ${fullAnimKey} does not exist`);
      }
    }
  }

  /**
   * Check if sprite sheet is loaded
   */
  isSpriteLoaded(key: string): boolean {
    return this.loadedSprites.has(key);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.spriteConfigs.clear();
    this.loadedSprites.clear();
  }
}
