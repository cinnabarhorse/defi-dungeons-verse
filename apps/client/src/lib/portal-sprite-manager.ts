/**
 * Portal Sprite Manager
 * Handles loading and creating portal sprites with animations
 */

import {
  PORTAL_TYPES,
  PORTAL_CONFIG,
  type PortalTypeConfig,
} from './portal-sprite-config';

export class PortalSpriteManager {
  private scene: Phaser.Scene;
  private loadedConfigs: Set<string> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Preload all portal sprites and animations
   */
  async preloadPortalSprites(): Promise<void> {
    console.log('🌀 PortalSpriteManager: Preloading portal sprites...');

    // Load each portal type as a spritesheet (they contain animation frames)
    for (const [portalType, config] of Object.entries(PORTAL_TYPES)) {
      await this.loadPortalTypeSpriteSheet(portalType, config);
    }

    console.log('✅ PortalSpriteManager: All portal sprites loaded');
  }

  /**
   * Load a portal type as a spritesheet with animations
   */
  private async loadPortalTypeSpriteSheet(
    portalType: string,
    config: PortalTypeConfig
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if (this.scene.textures.exists(config.key)) {
        console.log(`🌀 Portal spritesheet ${config.key} already loaded`);
        this.createAnimationsFromPortalConfig(portalType, config);
        resolve();
        return;
      }

      console.log(
        `🌀 Loading ${portalType} portal spritesheet: ${config.imagePath}`
      );

      this.scene.load.spritesheet(config.key, config.imagePath, {
        frameWidth: config.frameWidth,
        frameHeight: config.frameHeight,
      });

      this.scene.load.once(`filecomplete-spritesheet-${config.key}`, () => {
        console.log(`✅ Portal spritesheet loaded: ${config.key}`);
        this.createAnimationsFromPortalConfig(portalType, config);
        this.loadedConfigs.add(config.key);
        resolve();
      });

      this.scene.load.once(`loaderror`, (file: any) => {
        if (file.key === config.key) {
          console.warn(`⚠️ Portal spritesheet not found: ${config.imagePath}`);
          reject(
            new Error(`Portal spritesheet not found: ${config.imagePath}`)
          );
        }
      });

      this.scene.load.start();
    });
  }

  /**
   * Create Phaser animations from portal type configuration
   */
  private createAnimationsFromPortalConfig(
    portalType: string,
    config: PortalTypeConfig
  ): void {
    console.log(`🌀 Creating ${portalType} portal animations`);

    config.animations.forEach((animConfig) => {
      // Helper function to create animation
      const createAnimation = (suffix: string, frameOffset: number) => {
        const animKey = `${config.key}_${animConfig.key}_${suffix}`;
        const frames = this.scene.anims.generateFrameNumbers(config.key, {
          start: animConfig.startFrame + frameOffset,
          end: animConfig.endFrame + frameOffset,
        });

        if (this.scene.anims.exists(animKey)) {
          this.scene.anims.remove(animKey);
        }

        this.scene.anims.create({
          key: animKey,
          frames,
          frameRate: animConfig.frameRate,
          repeat: animConfig.repeat,
        });

        return animKey;
      };

      // Create both animations
      const leftKey = createAnimation('left', 0); // Top row (0-9)
      const rightKey = createAnimation('right', 10); // Bottom row (10-19)

      console.log(
        `✅ Created ${portalType} animations: ${leftKey} + ${rightKey}`
      );
    });
  }

  /**
   * Create a portal sprite with animation
   */
  createPortalSprite(
    x: number,
    y: number,
    portalType: string,
    portalId: string
  ): Phaser.GameObjects.Container {
    const typeConfig = PORTAL_TYPES[portalType];
    const container = this.scene.add.container(x, y);

    if (!typeConfig || !this.scene.textures.exists(typeConfig.key)) {
      console.error(`❌ Portal ${portalType} not available, using fallback`);
      const fallback = this.scene.add.rectangle(0, 0, 88, 52, 0x6600cc);
      fallback.setStrokeStyle(2, 0x9900ff);
      container.add(fallback);
      return container;
    }

    // Helper to create sprite half
    const createHalf = (offsetX: number, animSuffix: string) => {
      const sprite = this.scene.add.sprite(offsetX, 0, typeConfig.key);
      sprite.setOrigin(0.5, 0.5).setScale(2.0);

      const animKey = `${typeConfig.key}_portal_spin_${animSuffix}`;
      if (this.scene.anims.exists(animKey)) {
        sprite.play(animKey);
      }

      return sprite;
    };

    // Create both halves
    const leftHalf = createHalf(0, 'left');
    const rightHalf = createHalf(-1, 'right');

    container.add([leftHalf, rightHalf]);
    // Note: Depth will be set by caller based on Y position for proper layering

    // Store references
    container.setData({ leftHalf, rightHalf, portalType, portalId });

    console.log(`✅ Portal ${portalType} created: ${portalId}`);
    return container;
  }

  /**
   * Check if a portal type is supported
   */
  hasPortalType(portalType: string): boolean {
    return portalType in PORTAL_TYPES;
  }

  /**
   * Get all available portal types
   */
  getAvailablePortalTypes(): string[] {
    return Object.keys(PORTAL_TYPES);
  }
}
