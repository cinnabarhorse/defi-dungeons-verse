/**
 * Enemy Sprite Manager
 * Handles loading and managing enemy sprite sheets and animations
 * Now uses the unified sprite manager for consistency
 */

import { ENEMY_SPRITE_CONFIGS } from './enemy-sprite-config';
import { UnifiedSpriteManager } from './sprite-manager-unified';

export class EnemySpriteManager {
  private scene: Phaser.Scene;
  private spriteManager: UnifiedSpriteManager;
  private enemySprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private loadedSprites: Set<string> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.spriteManager = new UnifiedSpriteManager(scene);
  }

  /**
   * Load a specific enemy sprite sheet
   */
  async loadEnemySprite(enemyType: string): Promise<void> {
    if (this.loadedSprites.has(enemyType)) {
      return; // Already loaded
    }

    const config = ENEMY_SPRITE_CONFIGS[enemyType];
    if (!config) {
      return;
    }

    // Use the unified sprite manager (same as character system)
    await this.spriteManager.loadSpriteSheet(config);
    this.loadedSprites.add(enemyType);
  }

  /**
   * Create an enemy sprite at specified position
   */
  createEnemySprite(
    enemyId: string,
    enemyType: string,
    x: number,
    y: number,
    spriteConfig?: {
      displayWidth: number;
      displayHeight: number;
    },
    options?: {
      sizeMultiplier?: number;
    }
  ): Phaser.GameObjects.Sprite | null {
    const config = ENEMY_SPRITE_CONFIGS[enemyType];
    if (!config) {
      return null;
    }

    if (!this.loadedSprites.has(enemyType)) {
      return null;
    }

    // Use unified sprite manager to create sprite (same as character system)
    const sprite = this.spriteManager.createSprite(x, y, config.key, 'idle');

    let baseScale = 1.0;
    if (spriteConfig) {
      baseScale = enemyType === 'portal_guardian' ? 2.0 : 1.0;
    } else {
      if (enemyType === 'portal_guardian') {
        baseScale = 2.0;
      } else {
        baseScale = 1.0;
      }
    }

    const sizeMultiplier = Math.max(0.1, options?.sizeMultiplier ?? 1);
    sprite.setScale(baseScale * sizeMultiplier);
    sprite.setData('baseScale', baseScale);

    // Store reference
    this.enemySprites.set(enemyId, sprite);

    return sprite;
  }

  /**
   * Play an animation on an enemy sprite
   */
  playEnemyAnimation(enemyId: string, animationKey: string): void {
    const sprite = this.enemySprites.get(enemyId);
    if (!sprite) {
      return;
    }

    // Special handling for death animation - fade out effect
    if (animationKey === 'death') {
      // Play hurt animation as death visual feedback
      const hurtAnimKey = `${sprite.texture.key}_hurt`;
      if (this.scene.anims.exists(hurtAnimKey)) {
        sprite.play(hurtAnimKey);
      }

      // Create smooth fade-out tween
      this.scene.tweens.add({
        targets: sprite,
        alpha: 0,
        duration: 1000,
        ease: 'Power2.easeOut',
      });
      return;
    }

    // Normal animation playback
    const fullAnimKey = `${sprite.texture.key}_${animationKey}`;
    if (this.scene.anims.exists(fullAnimKey)) {
      sprite.play(fullAnimKey);
    }
  }

  /**
   * Update enemy sprite position
   */
  updateEnemyPosition(enemyId: string, x: number, y: number): void {
    const sprite = this.enemySprites.get(enemyId);
    if (sprite) {
      sprite.setPosition(x, y);
    }
  }

  /**
   * Remove an enemy sprite
   */
  removeEnemySprite(enemyId: string): void {
    const sprite = this.enemySprites.get(enemyId);
    if (sprite) {
      sprite.destroy();
      this.enemySprites.delete(enemyId);
    }
  }

  /**
   * Get enemy sprite by ID
   */
  getEnemySprite(enemyId: string): Phaser.GameObjects.Sprite | undefined {
    return this.enemySprites.get(enemyId);
  }

  /**
   * Check if an enemy type has sprite configuration
   */
  hasEnemyConfig(enemyType: string): boolean {
    return !!ENEMY_SPRITE_CONFIGS[enemyType];
  }

  /**
   * Cleanup all enemy sprites
   */
  destroy(): void {
    this.enemySprites.forEach((sprite) => {
      sprite.destroy();
    });
    this.enemySprites.clear();
    this.loadedSprites.clear();
    this.spriteManager.destroy();
  }
}
