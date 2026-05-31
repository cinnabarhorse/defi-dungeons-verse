import { IGameScene } from '../types/game-scene';
import { getAppServerBaseUrl } from '../lib/server-url';
import { fetchRandomAavegotchi, fetchAavegotchiById } from './aavegotchi-api';
import {
  GOTCHI_MAX_COLS,
  GOTCHI_ROW_FRAME_COUNTS,
  getGotchiRowEndFrame,
  type GotchiRow,
} from './gotchi-spritesheet';

export type GotchiAnimationDirection = 'down' | 'right' | 'up' | 'left';
export type GotchiAnimationAction =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'attack'
  | 'attack_ranged'
  | 'throw'
  | 'death';
type GotchiExtendedAction = GotchiAnimationAction | 'hurt';

interface GotchiAnimationDefinition {
  row: GotchiRow;
  baseFrameRate: number;
  repeat: number;
}

const GOTCHI_ANIMATION_DEFINITIONS: Record<
  GotchiExtendedAction,
  GotchiAnimationDefinition
> = {
  idle: { row: 0, baseFrameRate: 8, repeat: -1 },
  sprint: { row: 1, baseFrameRate: 11, repeat: -1 },
  walk: { row: 1, baseFrameRate: 7, repeat: -1 },
  throw: { row: 2, baseFrameRate: 9, repeat: -1 },
  attack_ranged: { row: 2, baseFrameRate: 9, repeat: -1 },
  attack: { row: 3, baseFrameRate: 9, repeat: -1 },
  hurt: { row: 4, baseFrameRate: 10, repeat: 0 },
  death: { row: 5, baseFrameRate: 9, repeat: 0 },
};

const GOTCHI_RUNTIME_ANIMATION_CONFIG: Record<
  GotchiAnimationAction,
  GotchiAnimationDefinition
> = {
  idle: GOTCHI_ANIMATION_DEFINITIONS.idle,
  walk: GOTCHI_ANIMATION_DEFINITIONS.walk,
  sprint: GOTCHI_ANIMATION_DEFINITIONS.sprint,
  throw: GOTCHI_ANIMATION_DEFINITIONS.throw,
  attack_ranged: GOTCHI_ANIMATION_DEFINITIONS.attack_ranged,
  attack: GOTCHI_ANIMATION_DEFINITIONS.attack,
  death: GOTCHI_ANIMATION_DEFINITIONS.death,
};

const GOTCHI_DIRECTIONS: GotchiAnimationDirection[] = [
  'down',
  'right',
  'up',
  'left',
];
const GOTCHI_ATTACK_ACTIONS = new Set<GotchiAnimationAction>([
  'attack',
  'attack_ranged',
  'throw',
]);
const FALLBACK_FRAME_DIMENSIONS = { frameWidth: 64, frameHeight: 64 };
const GOTCHI_ANIMATION_LOCK_DATA_KEY = 'gotchiAnimationLock';

export const removeBackgroundCSS = `
.gotchi-bg, 
.gotchi-shadow,
[class*="bg"],
[class*="shadow"],
[class*="background"] {
  display:none !important;
  visibility:hidden !important;
  opacity:0 !important;
}
`;

export interface DirectionalSprites {
  front: string; // svg field from API
  back: string;
  left: string;
  right: string;
}

export interface SpriteData {
  tokenId: string;
  sprites: DirectionalSprites;
  textures?: {
    front?: Phaser.Textures.Texture;
    back?: Phaser.Textures.Texture;
    left?: Phaser.Textures.Texture;
    right?: Phaser.Textures.Texture;
  };
  spritesheetKey?: string;
  frameWidth?: number;
  frameHeight?: number;
  spritesheetUrl?: string;
}

export class AavegotchiSpriteManager {
  private scene: IGameScene;
  private playerSprites: Map<string, SpriteData> = new Map(); // sessionId -> SpriteData
  private avatarCache: Map<string, SpriteData> = new Map(); // avatarId -> SpriteData
  private loadingPromises: Map<string, Promise<SpriteData | null>> = new Map();
  private spritesheetMeta: Map<string, { frameWidth: number; frameHeight: number }> =
    new Map();
  private imageDimensionCache: Map<string, { width: number; height: number }> =
    new Map();
  private spritesheetFallbackLogged: Set<string> = new Set();

  constructor(scene: IGameScene) {
    this.scene = scene;
  }

  /**
   * Preload a default Aavegotchi sprite that can be used for all players
   */
  async preloadDefaultSprite(): Promise<void> {
    try {
      // Fetch a random Aavegotchi for the default sprite
      const gotchiData = await fetchRandomAavegotchi();

      if (!gotchiData) {
        throw new Error('Failed to fetch default Aavegotchi data');
      }

      console.log(
        `🎮 Preloading Aavegotchi #${gotchiData.id} as default sprite`
      );

      // Process and load all directional sprites
      const directions = ['front', 'back', 'left', 'right'] as const;

      for (const direction of directions) {
        const svgData = gotchiData[direction === 'front' ? 'svg' : direction];
        if (!svgData) continue;

        try {
          const textureKey = `default_aavegotchi_${direction}`;

          // Apply CSS transformation to remove background
          const processedSVG = this.applyStyleToSVG(svgData);

          // Convert SVG to data URL
          const svgBlob = new Blob([processedSVG], { type: 'image/svg+xml' });
          const svgUrl = URL.createObjectURL(svgBlob);

          // Load as texture in Phaser synchronously
          await new Promise<void>((resolve, reject) => {
            this.scene.load.image(textureKey, svgUrl);

            const onComplete = () => {
              this.scene.load.off('filecomplete', onFileComplete);
              this.scene.load.off('loaderror', onError);
              URL.revokeObjectURL(svgUrl);
              resolve();
            };

            const onFileComplete = (key: string) => {
              if (key === textureKey) {
                onComplete();
              }
            };

            const onError = (file: any) => {
              if (file.key === textureKey) {
                this.scene.load.off('filecomplete', onFileComplete);
                this.scene.load.off('loaderror', onError);
                URL.revokeObjectURL(svgUrl);
                reject(new Error(`Failed to load texture: ${textureKey}`));
              }
            };

            this.scene.load.on('filecomplete', onFileComplete);
            this.scene.load.on('loaderror', onError);
            this.scene.load.start();
          });
        } catch (error) {
          console.warn(`Failed to preload ${direction} texture:`, error);
        }
      }

      // Store the default sprite data
      this.playerSprites.set('default', {
        tokenId: gotchiData.id,
        sprites: {
          front: gotchiData.svg,
          back: gotchiData.back,
          left: gotchiData.left,
          right: gotchiData.right,
        },
      });
    } catch (error) {
      console.error('Failed to preload default Aavegotchi sprite:', error);
      throw error;
    }
  }

  /**
   * Apply CSS styles to remove background from Aavegotchi SVG
   */
  private applyStyleToSVG(svgString: string): string {
    try {
      // Parse the SVG
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
      const svgElement = svgDoc.querySelector('svg');

      if (!svgElement) {
        console.warn('No SVG element found in string');
        return svgString;
      }

      // Check if there's already a style element
      let styleElement = svgDoc.querySelector('style');

      if (!styleElement) {
        // Create a new style element
        styleElement = svgDoc.createElement('style');
        styleElement.setAttribute('type', 'text/css');
        svgElement.insertBefore(styleElement, svgElement.firstChild);
      }

      // Add our CSS to remove the background
      const existingCSS = styleElement.textContent || '';
      styleElement.textContent = existingCSS + '\n' + removeBackgroundCSS;

      // Debug: Log the processed SVG to verify CSS is applied
      const serializer = new XMLSerializer();
      const processedSVG = serializer.serializeToString(svgDoc);

      // Verify CSS was added
      if (
        processedSVG.includes('.gotchi-bg') &&
        processedSVG.includes('.gotchi-shadow')
      ) {
        console.log(
          '✅ CSS successfully applied to remove backgrounds and shadows'
        );
      } else {
        console.warn('⚠️ CSS may not have been applied correctly');
      }

      return processedSVG;
    } catch (error) {
      console.warn('Failed to apply CSS to SVG:', error);
      return svgString;
    }
  }

  /**
   * Get or load sprite data for a player
   */
  async getPlayerSprite(
    sessionId: string,
    tokenId?: string
  ): Promise<SpriteData | null> {
    // If we have a specific tokenId, check avatar cache first
    if (tokenId && this.avatarCache.has(tokenId)) {
      const cached = this.avatarCache.get(tokenId)!;

      // Create a new sprite data for this session with the same content
      // but we need to load textures with the new session ID
      const sessionSprite: SpriteData = {
        tokenId: cached.tokenId,
        sprites: { ...cached.sprites },
      };

      // Try to load PNG textures first, fall back to SVG textures
      try {
        await this.loadPNGTextures(sessionId, sessionSprite);
      } catch (error) {
        console.warn(
          `Failed to load PNG textures, falling back to SVG:`,
          error
        );
        await this.loadSVGTextures(sessionId, sessionSprite);
      }

      this.playerSprites.set(sessionId, sessionSprite);
      return sessionSprite;
    }

    // Return cached sprite if available
    if (this.playerSprites.has(sessionId)) {
      const cached = this.playerSprites.get(sessionId)!;
      return cached;
    }

    // Return existing loading promise if in progress
    if (this.loadingPromises.has(sessionId)) {
      return this.loadingPromises.get(sessionId)!;
    }

    // Start loading sprite data - try server-generated sprites first
    const loadPromise = tokenId
      ? this.loadSpriteDataFromServer(sessionId, tokenId)
      : this.loadSpriteData(sessionId, tokenId);
    this.loadingPromises.set(sessionId, loadPromise);

    try {
      const result = await loadPromise;
      this.loadingPromises.delete(sessionId);
      return result;
    } catch (error) {
      this.loadingPromises.delete(sessionId);
      console.error(`Failed to load sprite for player ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Load and cache sprite data for a player
   */
  private async loadSpriteData(
    sessionId: string,
    tokenId?: string
  ): Promise<SpriteData | null> {
    try {

      // Fetch Aavegotchi data
      const gotchiData = tokenId
        ? await fetchAavegotchiById(tokenId)
        : await fetchRandomAavegotchi();

      if (!gotchiData) {
        return null;
      }

      const spriteData: SpriteData = {
        tokenId: gotchiData.id,
        sprites: {
          front: gotchiData.svg,
          back: gotchiData.back,
          left: gotchiData.left,
          right: gotchiData.right,
        },
      };

      // Load SVGs as textures
      await this.loadSVGTextures(sessionId, spriteData);

      // Cache the sprite data by sessionId
      this.playerSprites.set(sessionId, spriteData);

      // Also cache by avatarId for future use
      this.avatarCache.set(spriteData.tokenId, spriteData);

      return spriteData;
    } catch (error) {
      console.error(`Error loading sprite data for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Load sprite data for a player using server-generated PNG sprites
   */
  private async loadSpriteDataFromServer(
    sessionId: string,
    tokenId?: string
  ): Promise<SpriteData | null> {
    try {
      const baseUrl: string = getAppServerBaseUrl();
      const SERVER_BASE_URL = baseUrl.replace(/\/$/, '');

      let spriteUrl: string | null = null;
      if (tokenId) {
        // Resolve specific sprite (generate on-demand if needed)
        const res = await fetch(`${SERVER_BASE_URL}/api/gotchis/${tokenId}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          console.warn(`Failed to resolve sprite for tokenId ${tokenId}: ${res.status}`);
          return null;
        }
        const data = await res.json();
        const s = data?.sprite;
        const rawUrl = s?.url as string | undefined;
        if (rawUrl) {
          spriteUrl = /^https?:\/\//i.test(rawUrl)
            ? rawUrl
            : `${SERVER_BASE_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        }
      } else {
        // Fallback: list existing sprites and pick first
        const response = await fetch(`${SERVER_BASE_URL}/api/gotchis`, {
          credentials: 'include',
        });
        if (!response.ok) {
          console.warn(`Failed to fetch sprite list: ${response.status}`);
          return null;
        }
        const data = await response.json();
        const sprites = data.sprites || [];
        const first = sprites[0];
        const rawUrl = first?.url as string | undefined;
        if (rawUrl) {
          spriteUrl = /^https?:\/\//i.test(rawUrl)
            ? rawUrl
            : `${SERVER_BASE_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        }
      }

      if (!spriteUrl) {
        console.warn(`No sprite URL available for tokenId: ${tokenId ?? 'N/A'}`);
        return null;
      }

      const spriteData: SpriteData = {
        tokenId: (tokenId ?? 'unknown').toString(),
        sprites: {
          front: spriteUrl,
          back: spriteUrl,
          left: spriteUrl,
          right: spriteUrl,
        },
      };

      // Load the PNG as textures
      await this.loadPNGTextures(sessionId, spriteData);

      // Cache the sprite data by sessionId
      this.playerSprites.set(sessionId, spriteData);

      // Also cache by avatarId for future use
      this.avatarCache.set(spriteData.tokenId, spriteData);

      return spriteData;
    } catch (error) {
      console.error(
        `Error loading sprite data from server for ${sessionId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Convert SVG strings to Phaser textures
   */
  private async loadSVGTextures(
    sessionId: string,
    spriteData: SpriteData
  ): Promise<void> {
    const directions = ['front', 'back', 'left', 'right'] as const;

    for (const direction of directions) {
      const svgData = spriteData.sprites[direction];
      if (!svgData) continue;

      try {
        const textureKey = `${sessionId}_${direction}`;

        // Apply CSS transformation to remove background
        const processedSVG = this.applyStyleToSVG(svgData);

        // Convert SVG to data URL
        const svgBlob = new Blob([processedSVG], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);

        // Load as texture in Phaser
        await new Promise<void>((resolve, reject) => {
          this.scene.load.image(textureKey, svgUrl);

          const onComplete = () => {
            this.scene.load.off('filecomplete', onFileComplete);
            this.scene.load.off('loaderror', onError);
            URL.revokeObjectURL(svgUrl);
            resolve();
          };

          const onFileComplete = (key: string) => {
            if (key === textureKey) {
              onComplete();
            }
          };

          const onError = (file: any) => {
            if (file.key === textureKey) {
              this.scene.load.off('filecomplete', onFileComplete);
              this.scene.load.off('loaderror', onError);
              URL.revokeObjectURL(svgUrl);
              reject(new Error(`Failed to load texture: ${textureKey}`));
            }
          };

          this.scene.load.on('filecomplete', onFileComplete);
          this.scene.load.on('loaderror', onError);
          this.scene.load.start();
        });
      } catch (error) {
        console.warn(
          `Failed to load ${direction} texture for ${sessionId}:`,
          error
        );
      }
    }
  }

  /**
   * Load PNG spritesheets from server-generated sprites
   */
  private async loadPNGTextures(
    sessionId: string,
    spriteData: SpriteData
  ): Promise<void> {
    const imageUrl = spriteData.sprites.front;
    if (!imageUrl) {
      console.warn(`No spritesheet URL found for ${sessionId}`);
      return;
    }

    const textureKey = `${sessionId}_spritesheet`;
    spriteData.spritesheetUrl = imageUrl;

    const { frameWidth, frameHeight } =
      (await this.resolveSpritesheetFrameDimensions(imageUrl)) ??
      FALLBACK_FRAME_DIMENSIONS;

    if (this.scene.textures.exists(textureKey)) {
      this.scene.textures.remove(textureKey);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const handleComplete = () => {
          try {
            const texture = this.scene.textures.get(textureKey);
            if (!texture || !texture.source[0]) {
              throw new Error(`Texture source missing for ${textureKey}`);
            }

            texture.source[0].scaleMode = Phaser.ScaleModes.NEAREST;

            this.spritesheetMeta.set(textureKey, {
              frameWidth,
              frameHeight,
            });
            spriteData.spritesheetKey = textureKey;
            spriteData.frameWidth = frameWidth;
            spriteData.frameHeight = frameHeight;

            this.registerGotchiAnimations(textureKey);

            this.scene.load.off('complete', handleComplete);
            this.scene.load.off('loaderror', handleError);
            resolve();
          } catch (error) {
            this.scene.load.off('complete', handleComplete);
            this.scene.load.off('loaderror', handleError);
            reject(error);
          }
        };

        const handleError = (file: any) => {
          if (file?.key === textureKey) {
            this.scene.load.off('complete', handleComplete);
            this.scene.load.off('loaderror', handleError);
            reject(
              new Error(`Failed to load spritesheet: ${textureKey} (${imageUrl})`)
            );
          }
        };

        this.scene.load.on('complete', handleComplete);
        this.scene.load.on('loaderror', handleError);
        this.scene.load.spritesheet(textureKey, imageUrl, {
          frameWidth,
          frameHeight,
        });
        this.scene.load.start();
      });
    } catch (error) {
      this.spritesheetMeta.delete(textureKey);
      spriteData.spritesheetKey = undefined;
      spriteData.frameWidth = undefined;
      spriteData.frameHeight = undefined;

      if (!this.spritesheetFallbackLogged.has(textureKey)) {
        console.warn(
          `⚠️ Falling back to static textures for ${sessionId}:`,
          error
        );
        this.spritesheetFallbackLogged.add(textureKey);
      }

      throw error;
    }
  }

  private async resolveSpritesheetFrameDimensions(
    imageUrl: string
  ): Promise<{ frameWidth: number; frameHeight: number }> {
    const dimensions = await this.getImageDimensions(imageUrl);
    if (!dimensions) {
      return FALLBACK_FRAME_DIMENSIONS;
    }

    const rows = GOTCHI_ROW_FRAME_COUNTS.length || 1;
    const cols = GOTCHI_MAX_COLS || 1;

    const frameWidth = Math.floor(dimensions.width / cols);
    const frameHeight = Math.floor(dimensions.height / rows);

    return {
      frameWidth:
        frameWidth > 0 ? frameWidth : FALLBACK_FRAME_DIMENSIONS.frameWidth,
      frameHeight:
        frameHeight > 0 ? frameHeight : FALLBACK_FRAME_DIMENSIONS.frameHeight,
    };
  }

  private async getImageDimensions(
    imageUrl: string
  ): Promise<{ width: number; height: number } | null> {
    if (this.imageDimensionCache.has(imageUrl)) {
      return this.imageDimensionCache.get(imageUrl)!;
    }

    if (typeof Image === 'undefined') {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;

          if (width > 0 && height > 0) {
            const dimensions = { width, height };
            this.imageDimensionCache.set(imageUrl, dimensions);
            resolve(dimensions);
          } else {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
      } catch (error) {
        console.warn('Failed to measure spritesheet dimensions:', error);
        resolve(null);
      }
    });
  }

  private registerGotchiAnimations(textureKey: string): void {
    const meta = this.spritesheetMeta.get(textureKey);
    if (!meta) {
      console.warn(`Missing spritesheet metadata for ${textureKey}`);
      return;
    }

    const texture = this.scene.textures.get(textureKey);
    if (!texture || !texture.source[0]) {
      console.warn(`Texture not found for ${textureKey}`);
      return;
    }

    const framesPerRow = Math.floor(texture.source[0].width / meta.frameWidth);
    if (!Number.isFinite(framesPerRow) || framesPerRow <= 0) {
      console.warn(
        `Invalid frames per row calculation for ${textureKey}:`,
        framesPerRow
      );
      return;
    }

    for (const [action, definition] of Object.entries(
      GOTCHI_ANIMATION_DEFINITIONS
    ) as Array<[GotchiExtendedAction, GotchiAnimationDefinition]>) {
      const row = definition.row;
      const endColumn = Math.min(
        getGotchiRowEndFrame(row),
        framesPerRow - 1
      );
      const startIndex = row * framesPerRow;
      const endIndex = startIndex + endColumn;

      if (endIndex < startIndex) continue;

      for (const direction of GOTCHI_DIRECTIONS) {
        const animationKey = `${textureKey}_${action}_${direction}`;
        if (this.scene.anims.exists(animationKey)) {
          this.scene.anims.remove(animationKey);
        }

        const frames = this.scene.anims.generateFrameNumbers(textureKey, {
          start: startIndex,
          end: endIndex,
        });

        this.scene.anims.create({
          key: animationKey,
          frames,
          frameRate: definition.baseFrameRate,
          repeat: definition.repeat,
        });
      }
    }
  }

  private resolveStaticTextureKey(
    sessionId: string,
    direction: string
  ): string | null {
    const suffixMap: Record<string, string> = {
      down: 'front',
      up: 'back',
      left: 'left',
      right: 'right',
    };
    const normalizedDirection =
      typeof direction === 'string' ? direction.toLowerCase() : 'down';
    const suffix =
      suffixMap[normalizedDirection] ?? suffixMap.down;

    const candidates = [
      `${sessionId}_${suffix}`,
      `default_aavegotchi_${suffix}`,
    ];

    for (const key of candidates) {
      if (this.scene.textures.exists(key)) {
        return key;
      }
    }

    return null;
  }

  /**
   * Get the appropriate animation key for a player's current direction
   */
  getTextureKeyForDirection(
    sessionId: string,
    direction: string
  ): string | null {
    // Map game directions to animation keys
    let animationKey: string;

    switch (direction) {
      case 'left':
        animationKey = 'idle_left';
        break;
      case 'right':
        animationKey = 'idle_right';
        break;
      case 'up':
        animationKey = 'idle_up';
        break;
      case 'down':
      default:
        animationKey = 'idle_down';
        break;
    }

    // Try player-specific spritesheet first
    const playerAnimationKey = `${sessionId}_spritesheet_${animationKey}`;
    if (this.scene.anims.exists(playerAnimationKey)) {
      return playerAnimationKey;
    }

    // Fall back to default spritesheet
    const defaultAnimationKey = `default_aavegotchi_spritesheet_${animationKey}`;
    if (this.scene.anims.exists(defaultAnimationKey)) {
      return defaultAnimationKey;
    }

    const staticTextureKey = this.resolveStaticTextureKey(
      sessionId,
      direction
    );
    if (staticTextureKey) {
      return staticTextureKey;
    }

    return null;
  }

  getSpritesheetKey(sessionId: string): string | null {
    const spriteData = this.playerSprites.get(sessionId);
    if (spriteData?.spritesheetKey) {
      return spriteData.spritesheetKey;
    }

    const defaultSprite = this.playerSprites.get('default');
    if (defaultSprite?.spritesheetKey) {
      return defaultSprite.spritesheetKey;
    }

    return null;
  }

  /**
   * Get default animation key for a direction (used for immediate sprite creation)
   */
  getDefaultAnimationKey(direction: string): string {
    let animationKey: string;

    switch (direction) {
      case 'left':
        animationKey = 'idle_left';
        break;
      case 'right':
        animationKey = 'idle_right';
        break;
      case 'up':
        animationKey = 'idle_up';
        break;
      case 'down':
      default:
        animationKey = 'idle_down';
        break;
    }

    return `default_aavegotchi_spritesheet_${animationKey}`;
  }

  /**
   * Clean up sprite data for a player
   */
  cleanupPlayerSprite(sessionId: string): void {
    const spriteData = this.playerSprites.get(sessionId);
    if (!spriteData) return;

    // Remove textures from Phaser
    const directions = ['front', 'back', 'left', 'right'];
    directions.forEach((direction) => {
      const textureKey = `${sessionId}_${direction}`;
      if (this.scene.textures.exists(textureKey)) {
        this.scene.textures.remove(textureKey);
      }
    });

    if (spriteData.spritesheetKey) {
      if (this.scene.textures.exists(spriteData.spritesheetKey)) {
        this.scene.textures.remove(spriteData.spritesheetKey);
      }
      this.spritesheetMeta.delete(spriteData.spritesheetKey);
      this.spritesheetFallbackLogged.delete(spriteData.spritesheetKey);
    }

    this.playerSprites.delete(sessionId);
    this.loadingPromises.delete(sessionId);
  }

  /**
   * Get all loaded player sprites
   */
  getAllPlayerSprites(): Map<string, SpriteData> {
    return new Map(this.playerSprites);
  }

  /**
   * Clear session sprite cache (useful when transitioning between rooms)
   * Note: Preserves avatar cache to maintain avatar consistency across rooms
   */
  clearCache(): void {
    this.playerSprites.clear();
    this.loadingPromises.clear();
    this.spritesheetMeta.clear();
    this.spritesheetFallbackLogged.clear();
  }
}

const DEFAULT_ANIMATION_FALLBACK_DIRECTION: Record<
  GotchiAnimationAction,
  GotchiAnimationDirection
> = {
  idle: 'down',
  walk: 'down',
  sprint: 'down',
  attack: 'right',
  attack_ranged: 'right',
  throw: 'right',
  death: 'down',
};

export function playAavegotchiAnimation(
  sprite: Phaser.GameObjects.Sprite,
  action: GotchiAnimationAction,
  direction: GotchiAnimationDirection,
  intervalMs?: number
): void {
  if (!sprite || !sprite.scene || !sprite.anims) return;

  if (sprite.getData(GOTCHI_ANIMATION_LOCK_DATA_KEY)) {
    return;
  }

  const baseKeyData = sprite.getData('gotchiSpritesheetKey');
  const baseTextureKey =
    typeof baseKeyData === 'string' && baseKeyData.length > 0
      ? baseKeyData
      : sprite.texture?.key;

  if (typeof baseTextureKey !== 'string' || baseTextureKey.length === 0) {
    return;
  }

  const animationManager = sprite.scene.anims;
  const config = GOTCHI_RUNTIME_ANIMATION_CONFIG[action];
  if (!config) {
    return;
  }

  const preferredDirections: GotchiAnimationDirection[] =
    direction === 'left'
      ? ['left', 'right', DEFAULT_ANIMATION_FALLBACK_DIRECTION[action]]
      : [
          direction,
          DEFAULT_ANIMATION_FALLBACK_DIRECTION[action],
          direction === 'right' ? 'left' : 'right',
        ];

  let animationKey: string | null = null;
  for (const candidateDirection of preferredDirections) {
    const candidateKey = `${baseTextureKey}_${action}_${candidateDirection}`;
    if (animationManager.exists(candidateKey)) {
      animationKey = candidateKey;
      break;
    }
  }

  if (!animationKey) {
    const idleFallbackKey = `${baseTextureKey}_idle_${DEFAULT_ANIMATION_FALLBACK_DIRECTION.idle}`;
    if (animationManager.exists(idleFallbackKey)) {
      sprite.play(idleFallbackKey, true);
    }
    return;
  }

  const shouldFlipX = direction === 'left';
  sprite.setFlipX(shouldFlipX);
  sprite.setFlipY(false);

  const currentKey = sprite.anims.currentAnim?.key;
  sprite.play(animationKey, currentKey === animationKey);

  let timeScale = 1;
  if (
    intervalMs &&
    intervalMs > 0 &&
    GOTCHI_ATTACK_ACTIONS.has(action) &&
    config.baseFrameRate > 0
  ) {
    const frameCount = getGotchiRowEndFrame(config.row) + 1;
    if (frameCount > 0) {
      const baseDurationMs = (frameCount / config.baseFrameRate) * 1000;
      const calculated = baseDurationMs / intervalMs;
      if (Number.isFinite(calculated) && calculated > 0) {
        timeScale = Math.max(0.1, Math.min(4, calculated));
      }
    }
  }

  sprite.anims.timeScale = timeScale;
}
