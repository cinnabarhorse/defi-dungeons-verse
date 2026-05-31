import { GAME_CONFIG } from '../lib/constants';
import {
  AavegotchiSpriteManager,
  playAavegotchiAnimation,
  type GotchiAnimationAction,
  type GotchiAnimationDirection,
} from '../lib/sprite-manager';
import { CharacterSpriteManager } from '../lib/character-sprite-manager';
import { EnemySpriteManager } from '../lib/enemy-sprite-manager';
import { EntityManager } from '../lib/entity-manager';
import { PortalSpriteManager } from '../lib/portal-sprite-manager';
import {
  getAttackRange,
  getCharacterStats,
  setCharacterSpriteOverride,
} from '../lib/character-registry';
import { HUD_PHASER_FONT_FAMILY } from '../lib/fonts';
import type { Room, Client } from 'colyseus.js';
import { debugLog } from '../lib/debug';
import { ENEMY_TYPES, type EnemyStats } from '../../../server/src/data/enemies';
import { getWearableBySlug, normalizeWearableSlug } from '../data/wearables';
import {
  WEAPON_DEFINITIONS,
  type GrenadeWeaponDefinition,
} from '../data/weapons';
import { FLOOR_TILESET } from '../data/floor-tileset';
import type { ServerToClientMessages } from '../types/messages';
import { SPELLS, SPELLS_BY_ID, type SpellDefinition } from '../data/spells';
import { resolveGotchiSpritesheetUrl as resolveGotchiSpritesheetUrlApi } from '../lib/gotchi-api';

const GOTCHI_LOCK_ACTIONS: ReadonlySet<GotchiAnimationAction> = new Set([
  'attack',
  'attack_ranged',
  'throw',
]);
const GOTCHI_ANIMATION_LOCK_KEY = 'gotchiAnimationLock';
const GOTCHI_ANIMATION_TIMER_KEY = 'gotchiAnimationLockTimer';
const GOTCHI_DEATH_FLAG_KEY = 'gotchiDeathActive';
const GOTCHI_DEATH_TIMER_KEY = 'gotchiDeathFadeTimer';
const GOTCHI_DEATH_FADE_DELAY_MS = 3000;
const GOTCHI_DEFAULT_ATTACK_LOCK_MS = 600;
const GOTCHI_SPRINT_ALPHA = 0.82;

export interface GrenadeHudEntry {
  slug: string;
  name: string;
  svgId: number;
  cooldownMs: number;
  readyAt: number;
  remainingMs: number;
  isCoolingDown: boolean;
  maxRangePx: number;
  damageCenter: number;
  damageEdge: number;
  fuseMs: number;
  throwSpeedPxPerSec: number;
  healingSplash?: GrenadeWeaponDefinition['healingSplash'];
  manaCost?: number;
  insufficientMana?: boolean;
}

export interface GrenadeHudState {
  grenades: GrenadeHudEntry[];
  armedGrenadeSlug: string | null;
}

export interface ScoreHudState {
  score: number;
  eligible: boolean;
}

export interface WeaponHudEntry {
  slot: 'left' | 'right';
  slug: string;
  name: string;
  iconUrl: string;
  weaponType: 'melee' | 'ranged';
}

export interface WeaponHudState {
  weapons: WeaponHudEntry[];
  activeIndex: number;
}

export interface SpellHudEntry {
  id: string;
  name: string;
  description: string;
  manaCost: number;
  cooldownMs: number;
  cooldownRemainingMs: number;
  isCoolingDown: boolean;
  autocastEnabled: boolean;
  insufficientMana: boolean;
  icon?: string;
}

export interface SpellHudState {
  spells: SpellHudEntry[];
}

interface GrenadeCooldownInfo {
  readyAt: number;
  cooldownMs: number;
}

interface GrenadeDefinitionEntry {
  slug: string;
  name: string;
  svgId: number;
  grenade: GrenadeWeaponDefinition;
}

type GrenadeThrownMessage = ServerToClientMessages['grenade_thrown'];
type GrenadeExplodedMessage = ServerToClientMessages['grenade_exploded'];

import type { InventoryItem } from '../types/inventory';
import { ItemSystem } from './systems/ItemSystem';
import { EnvironmentSystem } from './systems/EnvironmentSystem';
import { FogOfWarSystem } from './systems/FogOfWarSystem';
import { FOG_OF_WAR_ENABLED } from '../lib/constants';
import { TREASURE_CHEST_SPRITE_CONFIG } from '../lib/treasure-chest-sprite-config';
import { ASSET_CATEGORIES } from '../data/map-editor-assets';
import type { ProgressionProfile } from '../lib/progression';
import { inferStripMetaFromSize } from '../lib/animated-sprites';
import type { AudioSettings } from '../types/preferences';
import type { MinimapOptions } from '../types/ui';
import type {
  ProgressionLevelLostMessage,
  ProgressionProfileMessage,
  ProgressionXpAwardMessage,
} from '../types/progression';
import type {
  KillStreakProfileMessage,
  KillStreakResetMessage,
  KillStreakUpdatedMessage,
} from '../types/kill-streak';
import type { MapCluster } from '../types/map-editor';

export type MapChunkSets = Record<string, MapCluster[]>;

interface BossSpecialVfxState {
  powerupTween?: Phaser.Tweens.Tween;
  flashTween?: Phaser.Tweens.Tween;
  originalScaleX?: number;
  originalScaleY?: number;
}

const MINIMAP_DEFAULT_OPTIONS: MinimapOptions = {
  size: 160,
  mobileSize: 120,
  margin: 16,
  mode: 'local-radius',
  showOnMobile: true,
  maskShape: 'circle',
  targetWorldWidth: 24000,
  backgroundColor: 0x001425,
  borderColor: 0x1b768f,
  borderAlpha: 0.95,
  playerColor: 0x5be0ff,
  playerMarkerScreenRadius: 5,
};

const SLOW_TINT_COLOR = 0x66ccff;

export interface GameSceneConfig {
  playerName: string;
  isWalletConnected: boolean;
  walletAddress: string;
  joinRoomId?: string;
  regionId?: string;
  debugTreasureRoom?: boolean;
  isMobile: boolean;
  avatarId?: string | null;
  selectedCharacterId?: string; // Selected character for the player
  useCharacterSprites?: boolean; // Option to use character sprites instead of Aavegotchi
  difficultyTier?: string; // Selected difficulty tier for the room
  serverUrl?: string; // Server URL for authentication checks
  audioSettings?: AudioSettings;
  // Callback functions for communicating with React component
  onRoomJoined?: (info: {
    roomId: string;
    roomCode?: string;
    hostSessionId?: string;
    maxPlayers?: number;
    playerCount?: number;
    region?: string;
    difficultyTier?: string;
  }) => void;
  onPlayerCountChange?: (count: number) => void;
  onConnectionStatusChange?: (
    status: 'connected' | 'disconnected' | 'reconnecting'
  ) => void;
  onPingUpdate?: (ping: number) => void;
  onPacketLossUpdate?: (packetLoss: number) => void;
  onServerRegionUpdate?: (region: string) => void;
  setMaxPlayers?: (value: number | null) => void;
  onItemPickup?: (item: InventoryItem) => void;
  onAvatarIdUpdate?: (avatarId: string) => void;
  onNPCInteraction?: (
    npcId: string,
    npcName: string,
    npcCharacterId: string,
    dialogueId: string
  ) => void;
  onError?: (error: string) => void;
  // Timed-spawn HUD updates
  onTimedSpawnInfoUpdate?: (info: {
    nextTimedSpawnAt: number;
    enemyCount: number;
  }) => void;
  onEnemyDifficultyUpdate?: (info: {
    level: number;
    nextAt: number;
    enabled: boolean;
  }) => void;
  onHuntedUpdate?: (info: {
    intensityLevel: number;
    nextSpawnAt: number;
    enabled: boolean;
  }) => void;
  progressionProfile?: ProgressionProfile;
  onProgressionProfile?: (message: ProgressionProfileMessage) => void;
  onProgressionXpAward?: (message: ProgressionXpAwardMessage) => void;
  onProgressionLevelLost?: (message: ProgressionLevelLostMessage) => void;
  onKillStreakProfile?: (message: KillStreakProfileMessage) => void;
  onKillStreakUpdated?: (message: KillStreakUpdatedMessage) => void;
  onKillStreakReset?: (message: KillStreakResetMessage) => void;
  mapChunks?: MapChunkSets;
}

export function createGameScene(Phaser: any) {
  return class GameScene extends Phaser.Scene {
    client!: Client; // Colyseus client
    room: Room | null = null;
    config: GameSceneConfig;

    // Entity tracking
    playerEntities: { [sessionId: string]: any } = {};
    enemyEntities: { [enemyId: string]: any } = {};
    npcEntities: { [npcId: string]: any } = {};
    projectileEntities: { [projectileId: string]: any } = {};
    droppedItemEntities: { [itemId: string]: any } = {};
    treasureChestEntities: { [chestId: string]: any } = {};
    portalEntities: { [portalId: string]: any } = {};
    specialEntities: { [specialId: string]: any } = {};
    bossSpecialVfxByEnemy: Map<string, BossSpecialVfxState> = new Map();
    spellDefinitions: SpellDefinition[] = [];
    spellDefinitionsSnapshot: string | null = null;
    spellHudState: SpellHudState = { spells: [] };
    private spellHudStateSnapshot: string | null = null;
    private spellCooldowns: Map<string, number> = new Map();
    private spellAutocastMap: Map<string, boolean> = new Map();
    private pendingSpellAutocastUpdates: Map<
      string,
      { requested: boolean; previous: boolean }
    > = new Map();
    private spellStoragePrefix: string = '';
    private currentMana: number = 0;
    private currentMaxMana: number = 0;
    private nextSpellHudEmitAt = 0;
    pixelOffsetAssetIds: Set<string> = new Set();
    editorFrameCountById: Map<string, number> = new Map();
    slowTintedEntities: Map<
      string,
      {
        tintTL: number;
        tintTR: number;
        tintBL: number;
        tintBR: number;
        wasTinted: boolean;
      }
    > = new Map();
    pendingSlowTintIds: Set<string> = new Set();
    stunLabels: Map<string, Phaser.GameObjects.Text> = new Map();
    pendingStunLabelIds: Set<string> = new Set();
    floorVisibilityThrottleMs = 100;
    nextFloorVisibilityUpdateAt = 0;
    mapChunks: MapChunkSets = {};
    minimapCamera?: Phaser.Cameras.Scene2D.Camera;
    minimapMaskGraphics?: Phaser.GameObjects.Graphics;
    minimapMask?: Phaser.Display.Masks.GeometryMask;
    minimapOverlayGraphics?: Phaser.GameObjects.Graphics;
    minimapPlayerBlip?: Phaser.GameObjects.Arc;
    minimapFollowTarget?: Phaser.GameObjects.GameObject | null;
    minimapOptions: MinimapOptions = { ...MINIMAP_DEFAULT_OPTIONS };
    minimapUpdateThrottleMs = 100; // ~10 Hz overlay updates
    // Gate minimap rendering until the scene is fully ready/joined
    minimapEnabled: boolean = false;
    nextMinimapUpdateAt = 0;
    minimapIgnoredObjects: Set<Phaser.GameObjects.GameObject> = new Set();
    minimapTargetWorldWidth: number = MINIMAP_DEFAULT_OPTIONS.targetWorldWidth;
    // Input handling
    cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
    spaceKey: any = null;
    nKey: any = null;
    iKey: any = null;
    pKey: any = null;
    shiftKey: any = null;

    bKey: any = null; // For debug toggle
    aKey: any = null; // For auto-attack toggle
    gKey: any = null; // For dev invincibility toggle
    tKey: any = null; // For test items spawning
    cKey: any = null; // For clearing test items
    eKey: any = null; // For test enemies spawning
    fKey: any = null; // For fog-of-war debug toggle
    oneKey: any = null;
    twoKey: any = null;
    wKey: any = null; // For WASD movement (up)
    sKey: any = null; // For WASD movement (down)
    dKey: any = null; // For WASD movement (right)
    lastSpaceKeyState = false;
    lastNKeyState = false;
    lastIKeyState = false;
    lastPKeyState = false;

    lastBKeyState = false;
    lastGKeyState = false;

    lastTKeyState = false;
    lastCKeyState = false;
    lastEKeyState = false;
    lastFKeyState = false;
    lastOneKeyState = false;
    lastTwoKeyState = false;

    // Input send throttling/coalescing
    private inputSendIntervalMs: number = (() => {
      const raw =
        typeof process !== 'undefined'
          ? Number(process.env.NEXT_PUBLIC_INPUT_SEND_HZ)
          : NaN;
      const hz = Number.isFinite(raw) && raw > 0 && raw <= 240 ? raw : 30; // sane default 30 Hz
      const clampedHz = Math.max(1, Math.min(240, hz));
      return Math.max(10, Math.floor(1000 / clampedHz));
    })();
    private inputKeepaliveMs: number = 150; // ensure periodic keepalive even if unchanged
    private lastInputSentAt: number = 0;
    private lastInputSignature: string = '';
    private inputDirty: boolean = false;

    // Game state
    weaponMode: string = 'melee';
    rangeIndicator: any = null;
    lastTransitionTime: number = 0;
    isTransitioning: boolean = false;
    spriteManager: AavegotchiSpriteManager | null = null;
    characterSpriteManager: CharacterSpriteManager | null = null;
    enemySpriteManager: EnemySpriteManager | null = null;
    portalSpriteManager: PortalSpriteManager | null = null;
    entityManager: EntityManager | null = null;

    // Auto-attack state
    autoAttackEnabled: boolean = true;
    lastAutoAttackTime: number = 0;
    currentAutoTarget: string | null = null;
    aggroRangeGraphics: any = null;
    // Client-side attack gate
    isAttackLocked: boolean = false;
    attackLockEndsAt: number = 0;
    // Damage throttle: pause auto-attack briefly after taking damage
    recentlyHitUntil: number = 0;

    // Grenade system state
    grenadeDefinitions: GrenadeDefinitionEntry[] = [];
    grenadeCooldowns: Map<string, GrenadeCooldownInfo> = new Map();
    armedGrenadeSlug: string | null = null;
    grenadeRangeGraphics: Phaser.GameObjects.Graphics | null = null;
    grenadeTargetGraphics: Phaser.GameObjects.Graphics | null = null;
    grenadeAimPointer: { x: number; y: number } | null = null;
    grenadeProjectileSprites: Map<string, Phaser.GameObjects.GameObject> =
      new Map();
    grenadeWearablesSignature: string | null = null;
    grenadeTextureKeys: Map<string, string> = new Map();
    grenadeHudStateSnapshot: string | null = null;
    nextGrenadeHudEmitAt = 0;
    weaponHudState: WeaponHudState = { weapons: [], activeIndex: -1 };
    weaponHudStateSnapshot: string | null = null;
    lastWeaponCycleAt: number = 0;
    weaponCycleDebounceMs = 200;
    scoreHudSnapshot: string | null = null;

    currentProgressionProfile: ProgressionProfile | null = null;

    // Vacuum system state (debug visualization only - server handles logic)
    vacuumRadiusGraphics: any = null;

    // Click animation system
    clickIndicators: Phaser.GameObjects.Graphics[] = [];

    // Pending click-to-move SFX trigger (cleared on successful path start)
    pendingClickMove: {
      x: number;
      y: number;
      tileX: number;
      tileY: number;
      createdAt: number;
    } | null = null;

    // Game systems
    itemSystem: ItemSystem;
    environmentSystem: EnvironmentSystem;
    fogOfWarSystem: FogOfWarSystem | null = null;

    // Audio system
    audioSettings: AudioSettings = {
      masterVolume: 70,
      sfxVolume: 80,
      musicVolume: 60,
      muted: false,
    };
    backgroundMusic: any = null;
    backgroundMusicKey: string = 'ddtheme';
    musicFadeOutTween: any = null;
    musicFadeInTween: any = null;
    // SFX safety guards
    _lastSfxAt: number = 0;
    _sfxCooldownMs: number = 28;
    _sfxSuppressionUntil: number = 0;
    _tabHidden: boolean = false;

    // Path debugging
    pathGraphics: any = null;
    currentPath: any[] = [];

    // Debug elements that should be controlled by B hotkey
    testRect: any = null;
    interactiveObjectRects: any[] = [];
    debugInstructionText: any = null;

    inputPayload = {
      left: false,
      right: false,
      up: false,
      down: false,
      sprint: false,
    };

    mobileInputPayload = {
      left: false,
      right: false,
      up: false,
      down: false,
      sprint: false,
    };

    isMobileControlled = false;

    // Edge panning (desktop-only)
    edgePanEnabled: boolean = GAME_CONFIG?.EDGE_PAN_ENABLED ?? false;
    edgePanMarginPx: number = 36;
    edgePanMaxRatioX: number = 0.25;
    edgePanMaxRatioY: number = 0.25;
    edgePanLerp: number = 0.18;
    edgePanCurrentOffsetX: number = 0;
    edgePanCurrentOffsetY: number = 0;

    constructor(config: GameSceneConfig) {
      super({ key: 'GameScene' });
      this.config = config;
      this.mapChunks = config.mapChunks || {};

      // Initialize weapon mode based on selected character
      if (config.selectedCharacterId) {
        const characterStats = getCharacterStats(config.selectedCharacterId);
        this.weaponMode = characterStats.weaponType;
        console.log(
          `🎯 GameScene: Initialized weapon mode for ${config.selectedCharacterId}: ${this.weaponMode}`
        );
      }

      this.itemSystem = new ItemSystem(this);
      this.environmentSystem = new EnvironmentSystem(this);
      this.fogOfWarSystem = FOG_OF_WAR_ENABLED
        ? new FogOfWarSystem(this)
        : null;

      this.applyAudioSettings(config.audioSettings);

      // Build an index of animated assets from the map editor definitions
      this.buildEditorAnimationIndex();
    }

    protected shouldRenderMinimap(): boolean {
      // Hide minimap until explicitly enabled by the scene
      if (!this.minimapEnabled) {
        return false;
      }
      if (!this.minimapOptions) {
        this.minimapOptions = { ...MINIMAP_DEFAULT_OPTIONS };
      }
      if (this.config.isMobile && !this.minimapOptions.showOnMobile) {
        return false;
      }
      return true;
    }

    protected getMinimapViewportSize(): number {
      if (!this.shouldRenderMinimap()) {
        return 0;
      }
      return this.config.isMobile
        ? this.minimapOptions.mobileSize
        : this.minimapOptions.size;
    }

    protected getGameViewportSize(): { width: number; height: number } {
      const scaleManager = this.scale as Phaser.Scale.ScaleManager | undefined;
      if (scaleManager) {
        const size = scaleManager.gameSize || {
          width: scaleManager.width,
          height: scaleManager.height,
        };
        if (Number.isFinite(size.width) && Number.isFinite(size.height)) {
          return { width: size.width, height: size.height };
        }
      }

      const mainCamera = this.cameras?.main;
      if (mainCamera) {
        return { width: mainCamera.width, height: mainCamera.height };
      }

      return { width: 0, height: 0 };
    }

    protected computeMinimapZoom(viewportSize: number): number {
      const configuredWidth =
        this.minimapTargetWorldWidth ||
        this.minimapOptions.targetWorldWidth ||
        MINIMAP_DEFAULT_OPTIONS.targetWorldWidth;
      const desiredWorldWidth = Math.max(64, configuredWidth);
      if (!viewportSize || viewportSize <= 0) {
        return 1;
      }
      const computedZoom = viewportSize / desiredWorldWidth;
      return Phaser.Math.Clamp(computedZoom, 0.005, 2.5);
    }

    protected initializeMinimap(): void {
      if (!this.shouldRenderMinimap() || !this.cameras) {
        this.teardownMinimap();
        return;
      }

      const viewportSize = this.getMinimapViewportSize();
      if (!viewportSize || viewportSize <= 0) {
        this.teardownMinimap();
        return;
      }

      const margin = Math.max(0, this.minimapOptions.margin || 0);
      const { width: gameWidth, height: gameHeight } =
        this.getGameViewportSize();
      const viewportX = margin;
      // Position minimap at top-left on mobile (just under player count container), bottom-left on desktop
      // XP bar: 8px (h-2)
      // Player count container starts at top-5 (20px) or top-3 (12px) and is ~40-50px tall
      // So minimap should start around: 8px (XP bar) + 12-20px (container top) + 40-50px (container height) + 4px gap = ~64-78px
      // Using 70px for a good visual position
      const viewportY = this.config.isMobile
        ? 70 // Position just under player count container (~70px from top)
        : Math.max(margin, gameHeight - viewportSize - margin);

      if (this.config.isMobile && this.minimapCamera) {
        console.log('📍 Minimap repositioning on mobile:', {
          viewportX,
          viewportY,
          viewportSize,
        });
      }

      if (!this.minimapCamera) {
        const createdCamera = this.cameras.add(
          viewportX,
          viewportY,
          viewportSize,
          viewportSize
        );
        createdCamera.setName('minimap');
        createdCamera.roundPixels = true;
        this.minimapCamera = createdCamera;
      } else {
        this.minimapCamera.setViewport(
          viewportX,
          viewportY,
          viewportSize,
          viewportSize
        );
      }

      const minimapCamera = this.minimapCamera;
      if (!minimapCamera) {
        return;
      }

      const zoom = this.computeMinimapZoom(viewportSize);
      minimapCamera.setZoom(zoom);
      const worldWidth = GAME_CONFIG?.WORLD_WIDTH || 3840;
      const worldHeight = GAME_CONFIG?.WORLD_HEIGHT || 2160;
      const viewWidthWorld = viewportSize / Math.max(zoom, 0.0001);
      const viewHeightWorld = viewportSize / Math.max(zoom, 0.0001);
      const halfViewWidth = viewWidthWorld / 2;
      const halfViewHeight = viewHeightWorld / 2;
      minimapCamera.setBounds(
        -halfViewWidth,
        -halfViewHeight,
        worldWidth + halfViewWidth * 2,
        worldHeight + halfViewHeight * 2
      );

      const followTarget = this.minimapFollowTarget;
      if (!this.isGameObjectDestroyed(followTarget)) {
        minimapCamera.startFollow(
          followTarget as Phaser.GameObjects.GameObject,
          true,
          0.2,
          0.2
        );
        minimapCamera.setDeadzone(0, 0);
      } else {
        minimapCamera.stopFollow();
      }

      this.refreshMinimapMask(viewportX, viewportY, viewportSize);
      this.updateMinimapOverlayGraphics(viewportX, viewportY, viewportSize);
      this.ensureMinimapPlayerBlip();

      // Reapply ignores for any objects registered before the camera existed
      this.minimapIgnoredObjects.forEach((obj) => {
        if (this.isGameObjectDestroyed(obj)) return;
        minimapCamera.ignore(obj);
      });
      if (this.minimapOverlayGraphics) {
        minimapCamera.ignore(this.minimapOverlayGraphics);
      }

      this.nextMinimapUpdateAt = 0;
    }

    protected refreshMinimapMask(
      viewportX: number,
      viewportY: number,
      viewportSize: number
    ): void {
      const centerX = viewportX + viewportSize / 2;
      const centerY = viewportY + viewportSize / 2;

      if (this.isGameObjectDestroyed(this.minimapMaskGraphics)) {
        this.minimapMaskGraphics = this.make.graphics({
          x: centerX,
          y: centerY,
          add: false,
        });
      } else {
        this.minimapMaskGraphics!.setPosition(centerX, centerY);
        this.minimapMaskGraphics!.clear();
      }

      const maskGraphics = this.minimapMaskGraphics;
      if (!maskGraphics) {
        return;
      }

      maskGraphics.fillStyle(0xffffff, 1);
      if (this.minimapOptions.maskShape === 'circle') {
        maskGraphics.fillCircle(0, 0, viewportSize / 2);
      } else {
        maskGraphics.fillRect(
          -viewportSize / 2,
          -viewportSize / 2,
          viewportSize,
          viewportSize
        );
      }

      if (!this.minimapMask) {
        this.minimapMask = maskGraphics.createGeometryMask();
      }

      const mask = this.minimapMask;
      const minimapCamera = this.minimapCamera;
      if (mask && minimapCamera) {
        mask.setInvertAlpha(false);
        minimapCamera.setMask(mask);
      }
    }

    protected updateMinimapOverlayGraphics(
      viewportX: number,
      viewportY: number,
      viewportSize: number
    ): void {
      if (this.isGameObjectDestroyed(this.minimapOverlayGraphics)) {
        const overlayGraphics = this.add.graphics();
        overlayGraphics.setScrollFactor(0);
        overlayGraphics.setDepth(5000);
        overlayGraphics.setName('minimap-overlay');
        this.minimapOverlayGraphics = overlayGraphics;
      }

      const overlay = this.minimapOverlayGraphics;
      if (!overlay) {
        return;
      }

      const centerX = viewportX + viewportSize / 2;
      const centerY = viewportY + viewportSize / 2;

      overlay.clear();
      overlay.fillStyle(this.minimapOptions.backgroundColor, 0.55);
      overlay.lineStyle(
        2,
        this.minimapOptions.borderColor,
        this.minimapOptions.borderAlpha
      );

      if (this.minimapOptions.maskShape === 'circle') {
        overlay.fillCircle(centerX, centerY, viewportSize / 2);
        overlay.strokeCircle(centerX, centerY, viewportSize / 2);
      } else {
        overlay.fillRoundedRect(
          viewportX,
          viewportY,
          viewportSize,
          viewportSize,
          8
        );
        overlay.strokeRoundedRect(
          viewportX,
          viewportY,
          viewportSize,
          viewportSize,
          8
        );
      }

      overlay.setVisible(true);
      const minimapCamera = this.minimapCamera;
      if (minimapCamera) {
        minimapCamera.ignore(overlay);
      }
    }

    protected ensureMinimapPlayerBlip(): void {
      if (!this.shouldRenderMinimap()) {
        this.minimapPlayerBlip?.setVisible(false);
        return;
      }

      if (this.isGameObjectDestroyed(this.minimapPlayerBlip)) {
        this.minimapPlayerBlip = this.add.circle(
          0,
          0,
          this.minimapOptions.playerMarkerScreenRadius,
          this.minimapOptions.playerColor,
          1
        );
        const blip = this.minimapPlayerBlip;
        if (blip) {
          blip.setDepth(4000);
          blip.setScrollFactor(1);
          blip.setVisible(false);
          const mainCamera = this.cameras?.main;
          if (mainCamera) {
            mainCamera.ignore(blip);
          }
        }
      }

      this.minimapPlayerBlip?.setVisible(Boolean(this.minimapFollowTarget));
    }

    protected updateMinimapPlayerMarker(): void {
      if (
        !this.minimapCamera ||
        !this.minimapPlayerBlip ||
        !this.minimapFollowTarget ||
        this.isGameObjectDestroyed(this.minimapFollowTarget)
      ) {
        if (this.minimapPlayerBlip) {
          this.minimapPlayerBlip.setVisible(false);
        }
        if (this.isGameObjectDestroyed(this.minimapFollowTarget)) {
          this.minimapFollowTarget = null;
        }
        return;
      }

      const target: any = this.minimapFollowTarget as any;
      if (typeof target.x === 'number' && typeof target.y === 'number') {
        this.minimapPlayerBlip.setVisible(true);
        this.minimapPlayerBlip.setPosition(target.x, target.y);
      }

      const zoom = Math.max(0.001, this.minimapCamera.zoom || 1);
      const desiredWorldRadius =
        this.minimapOptions.playerMarkerScreenRadius / zoom;
      const currentRadius = (this.minimapPlayerBlip as any).radius || 0;
      if (Math.abs(currentRadius - desiredWorldRadius) > 0.25) {
        this.minimapPlayerBlip.setRadius(desiredWorldRadius);
      }
    }

    protected setMinimapFollowTarget(
      target: Phaser.GameObjects.GameObject | null
    ): void {
      if (this.isGameObjectDestroyed(target)) {
        this.minimapFollowTarget = null;
      } else {
        this.minimapFollowTarget = target;
      }

      const minimapCamera = this.minimapCamera;
      if (!minimapCamera) {
        return;
      }

      if (this.minimapFollowTarget) {
        minimapCamera.startFollow(this.minimapFollowTarget, true, 0.2, 0.2);
        minimapCamera.setDeadzone(0, 0);
      } else {
        minimapCamera.stopFollow();
      }

      this.ensureMinimapPlayerBlip();
    }

    protected teardownMinimap(): void {
      const minimapCamera = this.minimapCamera;
      if (minimapCamera) {
        this.cameras?.remove(minimapCamera);
        minimapCamera.destroy();
        this.minimapCamera = undefined;
      }

      this.minimapMask?.destroy();
      this.minimapMask = undefined;

      this.minimapMaskGraphics?.destroy();
      this.minimapMaskGraphics = undefined;

      this.minimapOverlayGraphics?.destroy();
      this.minimapOverlayGraphics = undefined;

      this.minimapPlayerBlip?.destroy();
      this.minimapPlayerBlip = undefined;

      this.minimapFollowTarget = null;
    }

    protected isGameObjectDestroyed(
      obj: Phaser.GameObjects.GameObject | null | undefined
    ): obj is null | undefined {
      if (!obj) {
        return true;
      }
      const candidate = obj as Phaser.GameObjects.GameObject & {
        destroyed?: boolean;
        scene?: Phaser.Scene | null;
        active?: boolean;
      };
      if (candidate.scene === null || candidate.scene === undefined) {
        return true;
      }
      if (candidate.destroyed === true) {
        return true;
      }
      if (candidate.active === false) {
        return true;
      }
      return false;
    }

    private handleBossSpecialStateMessage(data: any): void {
      const payload = data || {};
      const enemyId =
        typeof payload?.enemyId === 'string' ? payload.enemyId : '';
      if (!enemyId) return;

      const stateKey = String(payload?.state || '');
      const sprite = this.enemySpriteManager?.getEnemySprite(enemyId) ?? null;

      if (!sprite || this.isGameObjectDestroyed(sprite)) {
        if (stateKey === 'ended' || stateKey === 'charge_end') {
          this.clearBossSpecialVfx(enemyId);
        }
        const retryCount = Number(payload?.__retryCount) || 0;
        if (retryCount < 2) {
          this.time.delayedCall(150, () =>
            this.handleBossSpecialStateMessage({
              ...payload,
              __retryCount: retryCount + 1,
            })
          );
        }
        return;
      }

      switch (stateKey) {
        case 'powerup':
          this.applyBossPowerupVfx(enemyId, sprite);
          break;
        case 'charge_start':
          this.applyBossChargeStartVfx(enemyId, sprite);
          break;
        case 'charge_end':
          this.applyBossChargeEndVfx(enemyId, sprite);
          break;
        case 'recovery':
          this.applyBossRecoveryVfx(enemyId, sprite);
          break;
        case 'ended':
          this.clearBossSpecialVfx(enemyId);
          break;
        default:
          break;
      }
    }

    protected applySlowTint(targetId: string): void {
      if (!targetId) return;
      const container = this.entityManager?.getEntity(targetId);
      if (!container) {
        this.pendingSlowTintIds.add(targetId);
        return;
      }
      const sprite =
        (container.getData('playerSprite') as
          | Phaser.GameObjects.Sprite
          | undefined) ??
        (container.getData('enemySprite') as
          | Phaser.GameObjects.Sprite
          | undefined) ??
        (container.getData('mainSprite') as
          | Phaser.GameObjects.Sprite
          | undefined);
      if (!sprite || typeof (sprite as any).setTint !== 'function') {
        this.pendingSlowTintIds.add(targetId);
        return;
      }
      if (this.slowTintedEntities.has(targetId)) {
        this.pendingSlowTintIds.delete(targetId);
        return;
      }
      const previousState = {
        tintTL: sprite.tintTopLeft,
        tintTR: sprite.tintTopRight,
        tintBL: sprite.tintBottomLeft,
        tintBR: sprite.tintBottomRight,
        wasTinted: sprite.isTinted,
      };
      this.slowTintedEntities.set(targetId, previousState);
      sprite.setTint(SLOW_TINT_COLOR);
      this.pendingSlowTintIds.delete(targetId);
    }

    protected clearSlowTint(targetId: string): void {
      if (!targetId) return;
      this.pendingSlowTintIds.delete(targetId);
      const stored = this.slowTintedEntities.get(targetId);
      if (!stored) return;

      const container = this.entityManager?.getEntity(targetId);
      if (container) {
        const sprite =
          (container.getData('playerSprite') as
            | Phaser.GameObjects.Sprite
            | undefined) ??
          (container.getData('enemySprite') as
            | Phaser.GameObjects.Sprite
            | undefined) ??
          (container.getData('mainSprite') as
            | Phaser.GameObjects.Sprite
            | undefined);
        if (sprite && typeof (sprite as any).setTint === 'function') {
          if (stored.wasTinted) {
            sprite.setTint(
              stored.tintTL,
              stored.tintTR,
              stored.tintBL,
              stored.tintBR
            );
          } else {
            sprite.clearTint();
          }
        }
      }

      this.slowTintedEntities.delete(targetId);
    }

    protected tryApplyPendingSlowTint(targetId: string): void {
      if (!targetId) return;
      if (this.pendingSlowTintIds.has(targetId)) {
        this.applySlowTint(targetId);
      }
    }

    protected showStunLabel(targetId: string): void {
      if (!targetId) return;
      const container = this.entityManager?.getEntity(targetId);
      if (!container) {
        this.pendingStunLabelIds.add(targetId);
        return;
      }
      if (this.stunLabels.has(targetId)) {
        this.pendingStunLabelIds.delete(targetId);
        return;
      }
      const label = this.add
        .text(0, -40, 'Stunned', {
          fontFamily: HUD_PHASER_FONT_FAMILY,
          fontSize: '16px',
          color: '#ffd966',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1);
      label.setDepth(100000);
      label.setName('stunLabel');
      this.entityManager?.addElementToEntity(targetId, 'stunLabel', label);
      this.stunLabels.set(targetId, label);
      this.pendingStunLabelIds.delete(targetId);
    }

    protected clearStunLabel(targetId: string): void {
      if (!targetId) return;
      this.pendingStunLabelIds.delete(targetId);
      const label = this.stunLabels.get(targetId);
      if (label) {
        if (this.entityManager?.hasEntity(targetId)) {
          this.entityManager.removeElementFromEntity(targetId, 'stunLabel');
        } else {
          label.destroy();
        }
        this.stunLabels.delete(targetId);
      } else if (this.entityManager?.hasEntity(targetId)) {
        this.entityManager.removeElementFromEntity(targetId, 'stunLabel');
      }
    }

    protected tryApplyPendingStunLabel(targetId: string): void {
      if (!targetId) return;
      if (this.pendingStunLabelIds.has(targetId)) {
        this.showStunLabel(targetId);
      }
    }

    protected clearAllStunLabels(): void {
      for (const [entityId] of this.stunLabels) {
        this.clearStunLabel(entityId);
      }
      this.pendingStunLabelIds.clear();
    }

    private getBossSpecialVfxState(
      enemyId: string,
      sprite: Phaser.GameObjects.Sprite
    ): BossSpecialVfxState {
      let state = this.bossSpecialVfxByEnemy.get(enemyId);
      if (!state) {
        state = {};
        this.bossSpecialVfxByEnemy.set(enemyId, state);
      }
      if (typeof state.originalScaleX !== 'number') {
        state.originalScaleX = sprite.scaleX;
        state.originalScaleY = sprite.scaleY;
      }
      return state;
    }

    private stopAndRemoveTween(tween?: Phaser.Tweens.Tween): void {
      if (!tween) return;
      try {
        tween.stop();
      } catch {}
      try {
        tween.remove();
      } catch {}
    }

    private restoreBossBaseAppearance(
      sprite: Phaser.GameObjects.Sprite,
      state: BossSpecialVfxState,
      options?: { keepTint?: boolean }
    ): void {
      if (
        typeof state.originalScaleX === 'number' &&
        typeof state.originalScaleY === 'number'
      ) {
        sprite.setScale(state.originalScaleX, state.originalScaleY);
      }
      if (!options?.keepTint) {
        sprite.clearTint();
      }
    }

    private applyBossPowerupVfx(
      enemyId: string,
      sprite: Phaser.GameObjects.Sprite
    ): void {
      const state = this.getBossSpecialVfxState(enemyId, sprite);
      this.stopAndRemoveTween(state.powerupTween);
      this.stopAndRemoveTween(state.flashTween);
      this.restoreBossBaseAppearance(sprite, state);
      sprite.setTint(0xff4d4d);
      state.powerupTween = this.tweens.add({
        targets: sprite,
        scaleX: (state.originalScaleX ?? sprite.scaleX) * 1.12,
        scaleY: (state.originalScaleY ?? sprite.scaleY) * 1.12,
        duration: 420,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
      state.flashTween = undefined;
      this.bossSpecialVfxByEnemy.set(enemyId, state);
    }

    private applyBossChargeStartVfx(
      enemyId: string,
      sprite: Phaser.GameObjects.Sprite
    ): void {
      const state = this.getBossSpecialVfxState(enemyId, sprite);
      this.stopAndRemoveTween(state.powerupTween);
      this.stopAndRemoveTween(state.flashTween);
      this.restoreBossBaseAppearance(sprite, state);
      state.flashTween = this.tweens.add({
        targets: sprite,
        scaleX: (state.originalScaleX ?? sprite.scaleX) * 1.08,
        scaleY: (state.originalScaleY ?? sprite.scaleY) * 0.94,
        duration: 160,
        ease: 'Quad.easeOut',
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          this.restoreBossBaseAppearance(sprite, state);
        },
      });
      state.powerupTween = undefined;
      this.bossSpecialVfxByEnemy.set(enemyId, state);
    }

    private applyBossChargeEndVfx(
      enemyId: string,
      sprite: Phaser.GameObjects.Sprite
    ): void {
      const state = this.getBossSpecialVfxState(enemyId, sprite);
      this.stopAndRemoveTween(state.powerupTween);
      this.stopAndRemoveTween(state.flashTween);
      this.restoreBossBaseAppearance(sprite, state);
      state.powerupTween = undefined;
      state.flashTween = undefined;
      this.bossSpecialVfxByEnemy.set(enemyId, state);
    }

    private applyBossRecoveryVfx(
      enemyId: string,
      sprite: Phaser.GameObjects.Sprite
    ): void {
      const state = this.getBossSpecialVfxState(enemyId, sprite);
      this.stopAndRemoveTween(state.powerupTween);
      this.stopAndRemoveTween(state.flashTween);
      this.restoreBossBaseAppearance(sprite, state);
      state.powerupTween = undefined;
      state.flashTween = undefined;
      this.bossSpecialVfxByEnemy.set(enemyId, state);
    }

    private clearBossSpecialVfx(enemyId: string): void {
      const state = this.bossSpecialVfxByEnemy.get(enemyId);
      if (state) {
        this.stopAndRemoveTween(state.powerupTween);
        this.stopAndRemoveTween(state.flashTween);
      }
      const sprite = this.enemySpriteManager?.getEnemySprite(enemyId) ?? null;
      if (sprite && !this.isGameObjectDestroyed(sprite)) {
        if (state) {
          this.restoreBossBaseAppearance(sprite, state);
        } else {
          sprite.clearTint();
        }
      }
      this.bossSpecialVfxByEnemy.delete(enemyId);
    }

    protected registerMinimapIgnore(
      gameObject:
        | Phaser.GameObjects.GameObject
        | Phaser.GameObjects.GameObject[]
        | null
        | undefined
    ): void {
      if (!gameObject) return;
      const objects = Array.isArray(gameObject) ? gameObject : [gameObject];

      objects.forEach((obj) => {
        if (!obj) return;
        const single = obj as Phaser.GameObjects.GameObject & {
          destroyed?: boolean;
        };
        if (this.isGameObjectDestroyed(single)) {
          return;
        }
        this.minimapIgnoredObjects.add(single);
        const minimapCamera = this.minimapCamera;
        if (minimapCamera) {
          minimapCamera.ignore(single);
        }
        single.once('destroy', () => {
          this.minimapIgnoredObjects.delete(single);
        });
      });
    }

    protected handleScaleResize(gameSize: Phaser.Structs.Size): void {
      this.resize(gameSize);
    }

    protected applyFloorLayout(
      chunks: any[],
      layout: Array<{ x: number; y: number; chunkName: string }>
    ) {
      if (!this.environmentSystem) {
        return;
      }
      this.environmentSystem.renderChunkFloors(chunks, layout);
      this.nextFloorVisibilityUpdateAt = 0;
      this.environmentSystem.updateVisibleFloors(this.cameras?.main);
    }

    applyAudioSettings(settings?: Partial<AudioSettings>) {
      if (!settings) {
        return;
      }
      const clampVolume = (value: unknown, fallback: number) => {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
          return Math.max(0, Math.min(100, numeric));
        }
        return fallback;
      };

      this.audioSettings = {
        masterVolume: clampVolume(
          settings.masterVolume,
          this.audioSettings.masterVolume
        ),
        sfxVolume: clampVolume(
          settings.sfxVolume,
          this.audioSettings.sfxVolume
        ),
        musicVolume: clampVolume(
          settings.musicVolume,
          this.audioSettings.musicVolume
        ),
        muted:
          typeof settings.muted === 'boolean'
            ? settings.muted
            : this.audioSettings.muted,
      };
      this.updateMusicPlaybackState();
    }

    /**
     * Play a sound effect with volume control
     */
    playSFX(soundKey: string, volume: number = 1) {
      if (this.audioSettings.muted) return;
      const now =
        typeof performance !== 'undefined' && performance?.now
          ? performance.now()
          : Date.now();
      if (this._tabHidden) return;
      if (now < this._sfxSuppressionUntil) return;
      if (now - this._lastSfxAt < this._sfxCooldownMs) return;
      this._lastSfxAt = now;

      try {
        const sound = this.sound.add(soundKey);
        const finalVolume =
          (this.audioSettings.masterVolume / 100) *
          (this.audioSettings.sfxVolume / 100) *
          volume;
        sound.play({ volume: finalVolume });
        try {
          sound.once(Phaser.Sound.Events.COMPLETE, () => {
            try {
              (sound as any).destroy && (sound as any).destroy();
            } catch {}
          });
        } catch {}
      } catch (error) {
        console.warn(`Failed to play sound ${soundKey}:`, error);
      }
    }

    /**
     * Refresh audio settings when preferences change
     */
    refreshAudioSettings(settings?: AudioSettings) {
      if (settings) {
        this.applyAudioSettings(settings);
      }
    }

    private computeMusicVolume(): number {
      const master = Number(this.audioSettings?.masterVolume ?? 0);
      const music = Number(this.audioSettings?.musicVolume ?? 0);
      return Math.max(0, Math.min(1, (master / 100) * (music / 100)));
    }

    private startBackgroundMusic(): void {
      if (!this.sound || this.audioSettings.muted) return;
      if (!(this as any).cache?.audio?.exists?.(this.backgroundMusicKey)) {
        // Theme not loaded yet; will retry on loader complete
        return;
      }
      try {
        const volume = this.computeMusicVolume();
        if (!this.backgroundMusic) {
          this.backgroundMusic = this.sound.add(this.backgroundMusicKey, {
            loop: true,
            volume,
          });
        }
        if (this.sound.locked) {
          this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
            try {
              this.backgroundMusic?.play({
                loop: true,
                volume: this.computeMusicVolume(),
              });
            } catch {}
          });
          return;
        }
        if (!this.backgroundMusic.isPlaying) {
          this.backgroundMusic.play({ loop: true, volume });
        } else {
          if (typeof this.backgroundMusic.setVolume === 'function') {
            this.backgroundMusic.setVolume(volume);
          }
          if (typeof this.backgroundMusic.resume === 'function') {
            this.backgroundMusic.resume();
          }
        }
      } catch (e) {
        console.warn('Failed to start background music:', e);
      }
    }

    private updateMusicPlaybackState(): void {
      if (!(this as any).cache?.audio?.exists?.(this.backgroundMusicKey)) {
        // Wait until theme is loaded
        return;
      }
      const volume = this.computeMusicVolume();
      if (this.audioSettings.muted || volume <= 0) {
        try {
          if (
            this.backgroundMusic?.isPlaying &&
            typeof this.backgroundMusic.pause === 'function'
          ) {
            this.backgroundMusic.pause();
          }
          if (
            this.backgroundMusic &&
            typeof this.backgroundMusic.setVolume === 'function'
          ) {
            this.backgroundMusic.setVolume(0);
          }
        } catch {}
        return;
      }
      if (!this.backgroundMusic) {
        this.startBackgroundMusic();
        return;
      }
      try {
        if (
          !this.backgroundMusic.isPlaying &&
          typeof this.backgroundMusic.resume === 'function'
        ) {
          this.backgroundMusic.resume();
        }
        if (typeof this.backgroundMusic.setVolume === 'function') {
          this.backgroundMusic.setVolume(volume);
        }
      } catch {}
    }

    /**
     * Immediately switch the looping background music to the specified key.
     * Stops and destroys the current track before starting the new one.
     */
    public switchBackgroundMusic(nextKey: string): void {
      try {
        // Cancel any active fade tweens
        try {
          this.musicFadeOutTween?.stop();
        } catch {}
        try {
          this.musicFadeInTween?.stop();
        } catch {}
        this.musicFadeOutTween = null;
        this.musicFadeInTween = null;
        // Stop and destroy any existing background track
        if (this.backgroundMusic) {
          try {
            if (typeof this.backgroundMusic.stop === 'function') {
              this.backgroundMusic.stop();
            }
          } catch {}
          try {
            if (typeof this.backgroundMusic.destroy === 'function') {
              this.backgroundMusic.destroy();
            }
          } catch {}
          this.backgroundMusic = null;
        }
        // Update key and start new track
        this.backgroundMusicKey = nextKey;
        this.startBackgroundMusic();
      } catch (e) {
        console.warn('Failed to switch background music:', e);
      }
    }

    /**
     * Cross-fade from the current background music to the specified key.
     * If no music is currently playing, simply starts the new track.
     */
    public crossFadeBackgroundMusic(
      nextKey: string,
      durationMs: number = 1000
    ): void {
      try {
        if (!this.sound || this.audioSettings.muted) {
          // If audio is muted or sound not available, just switch immediately
          this.switchBackgroundMusic(nextKey);
          return;
        }
        if (!(this as any).cache?.audio?.exists?.(nextKey)) {
          // Next track not loaded; fall back to immediate switch which will start when loaded
          this.switchBackgroundMusic(nextKey);
          return;
        }
        // Cancel any existing fades
        try {
          this.musicFadeOutTween?.stop();
        } catch {}
        try {
          this.musicFadeInTween?.stop();
        } catch {}
        this.musicFadeOutTween = null;
        this.musicFadeInTween = null;

        const targetVolume = this.computeMusicVolume();

        // Create next sound instance at 0 volume and start looping
        const nextSound = this.sound.add(nextKey, {
          loop: true,
          volume: 0,
        });
        try {
          if (this.sound.locked) {
            // If audio is locked (e.g. before user interaction), just queue a regular switch
            nextSound.destroy();
            this.switchBackgroundMusic(nextKey);
            return;
          }
          nextSound.play({ loop: true, volume: 0 });
        } catch {
          // If play fails, fall back to immediate switch
          try {
            nextSound.destroy();
          } catch {}
          this.switchBackgroundMusic(nextKey);
          return;
        }

        const currentSound = this.backgroundMusic;
        const currentStartVolume =
          (currentSound && typeof currentSound.volume === 'number'
            ? currentSound.volume
            : targetVolume) || 0;

        // Start tweens for cross-fade
        // Fade in next
        this.musicFadeInTween = this.tweens.addCounter({
          from: 0,
          to: targetVolume,
          duration: durationMs,
          onUpdate: (tw: any) => {
            try {
              const v = tw.getValue();
              if (typeof nextSound.setVolume === 'function') {
                nextSound.setVolume(v);
              }
            } catch {}
          },
        });

        // Fade out current
        if (currentSound) {
          this.musicFadeOutTween = this.tweens.addCounter({
            from: currentStartVolume,
            to: 0,
            duration: durationMs,
            onUpdate: (tw: any) => {
              try {
                const v = tw.getValue();
                if (typeof currentSound.setVolume === 'function') {
                  currentSound.setVolume(v);
                }
              } catch {}
            },
            onComplete: () => {
              try {
                if (typeof currentSound.stop === 'function') {
                  currentSound.stop();
                }
                if (typeof currentSound.destroy === 'function') {
                  currentSound.destroy();
                }
              } catch {}
              // Adopt the new sound as the background track and key
              this.backgroundMusic = nextSound;
              this.backgroundMusicKey = nextKey;
              this.musicFadeOutTween = null;
            },
          });
        } else {
          // No current sound; adopt immediately
          this.backgroundMusic = nextSound;
          this.backgroundMusicKey = nextKey;
          // Also ensure volume ends at target after tween completes
          this.musicFadeInTween?.once?.('complete', () => {
            try {
              if (typeof nextSound.setVolume === 'function') {
                nextSound.setVolume(targetVolume);
              }
            } catch {}
            this.musicFadeInTween = null;
          });
        }
      } catch (e) {
        console.warn('Failed to cross-fade background music:', e);
        // Fallback to immediate switch
        this.switchBackgroundMusic(nextKey);
      }
    }

    /**
     * Start the next music immediately at full volume while fading out the current track.
     * This avoids fading in the new track, per boss intro requirement.
     */
    public switchMusicNoFadeInFadeOutCurrent(
      nextKey: string,
      fadeOutMs: number = 800
    ): void {
      try {
        if (!this.sound || this.audioSettings.muted) {
          this.switchBackgroundMusic(nextKey);
          return;
        }
        if (!(this as any).cache?.audio?.exists?.(nextKey)) {
          // Asset not ready; fallback to immediate switch behavior
          this.switchBackgroundMusic(nextKey);
          return;
        }
        // Cancel any existing fades
        try {
          this.musicFadeOutTween?.stop();
        } catch {}
        try {
          this.musicFadeInTween?.stop();
        } catch {}
        this.musicFadeOutTween = null;
        this.musicFadeInTween = null;

        const targetVolume = this.computeMusicVolume();

        // Create and start the next sound immediately at target volume
        const nextSound = this.sound.add(nextKey, {
          loop: true,
          volume: targetVolume,
        });
        try {
          if (this.sound.locked) {
            nextSound.destroy();
            this.switchBackgroundMusic(nextKey);
            return;
          }
          nextSound.play({ loop: true, volume: targetVolume });
        } catch {
          try {
            nextSound.destroy();
          } catch {}
          this.switchBackgroundMusic(nextKey);
          return;
        }

        const currentSound = this.backgroundMusic;
        // Adopt the new sound as the active background track
        this.backgroundMusic = nextSound;
        this.backgroundMusicKey = nextKey;

        // If there is a current track, fade it out only, then stop/destroy
        if (currentSound) {
          const currentStartVolume =
            (typeof currentSound.volume === 'number'
              ? currentSound.volume
              : targetVolume) || 0;
          this.musicFadeOutTween = this.tweens.addCounter({
            from: currentStartVolume,
            to: 0,
            duration: fadeOutMs,
            onUpdate: (tw: any) => {
              try {
                const v = tw.getValue();
                if (typeof currentSound.setVolume === 'function') {
                  currentSound.setVolume(v);
                }
              } catch {}
            },
            onComplete: () => {
              try {
                if (typeof currentSound.stop === 'function') {
                  currentSound.stop();
                }
                if (typeof currentSound.destroy === 'function') {
                  currentSound.destroy();
                }
              } catch {}
              this.musicFadeOutTween = null;
            },
          });
        }
      } catch (e) {
        console.warn(
          'Failed to switch music without fade-in (fade-out only):',
          e
        );
        this.switchBackgroundMusic(nextKey);
      }
    }

    private setupVisibilityAudioGuards(): void {
      try {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
          return;
        }

        const handleVisibilityOrFocusChange = () => {
          const hidden = Boolean((document as any).hidden);
          const now =
            typeof performance !== 'undefined' && performance?.now
              ? performance.now()
              : Date.now();
          if (hidden) {
            this._tabHidden = true;
            this._sfxSuppressionUntil = now + 200;
            try {
              if (this.sound && typeof this.sound.stopAll === 'function') {
                this.sound.stopAll();
              }
            } catch {}
            try {
              if (
                this.backgroundMusic?.isPlaying &&
                typeof this.backgroundMusic.pause === 'function'
              ) {
                this.backgroundMusic.pause();
              }
              if (
                this.backgroundMusic &&
                typeof this.backgroundMusic.setVolume === 'function'
              ) {
                this.backgroundMusic.setVolume(0);
              }
            } catch {}
          } else {
            this._tabHidden = false;
            this._sfxSuppressionUntil = now + 800; // suppress burst on return
            // Resume music at correct volume
            this.updateMusicPlaybackState();
          }
        };

        document.addEventListener(
          'visibilitychange',
          handleVisibilityOrFocusChange
        );
        const onBlur = () => handleVisibilityOrFocusChange();
        const onFocus = () => handleVisibilityOrFocusChange();
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);

        this.events.once('shutdown', () => {
          try {
            document.removeEventListener(
              'visibilitychange',
              handleVisibilityOrFocusChange
            );
          } catch {}
          try {
            window.removeEventListener('blur', onBlur);
            window.removeEventListener('focus', onFocus);
          } catch {}
        });
      } catch {}
    }

    /**
     * Build a lookup table of assetId -> frameCount for assets that have animations
     * based on the map editor's asset catalog (ASSET_CATEGORIES).
     */
    private buildEditorAnimationIndex(): void {
      try {
        const index = new Map<string, number>();
        Object.values(ASSET_CATEGORIES).forEach((category: any) => {
          category.assets.forEach((asset: any) => {
            const frameCount = Number(asset.frameCount);
            if (
              typeof asset.id === 'string' &&
              Number.isFinite(frameCount) &&
              frameCount > 1
            ) {
              index.set(asset.id, frameCount);
            }
          });
        });
        this.editorFrameCountById = index;
      } catch (e) {
        console.warn('Failed to build editor animation index', e);
        this.editorFrameCountById = new Map();
      }
    }

    private getEditorFrameCount(assetId: string | undefined): number {
      if (!assetId) return 0;
      return this.editorFrameCountById.get(assetId) || 0;
    }

    /**
     * Dynamically generate sprite mapping from chunk assets
     *
     * This system automatically discovers all unique assets from chunk data
     * and generates the appropriate sprite loading paths. This eliminates
     * the need for manual sprite mapping maintenance.
     *
     * How it works:
     * 1. Scans all chunks for unique assetId values
     * 2. Uses the asset's sprite property to build the full path
     * 3. Auto-generates sprite loading configuration
     *
     * Benefits:
     * - Zero maintenance: new chunk assets are automatically loaded
     * - Perfect sync: if it's in chunks, it gets loaded
     * - Scalable: works with unlimited assets
     *
     * @returns Object mapping assetId -> sprite file path
     */
    generateDynamicSpriteMapping(): { [key: string]: string } {
      const spriteMapping: { [key: string]: string } = {};
      const processedAssets = new Set<string>();
      this.pixelOffsetAssetIds.clear();

      // Single pass: extract unique assets from all chunk sets and build mapping
      this.getAllChunks().forEach((chunk) => {
        chunk.assets.forEach((asset: any) => {
          if (
            asset &&
            typeof asset.assetId === 'string' &&
            (asset.positionMode === 'pixel' ||
              typeof asset.offsetX === 'number' ||
              typeof asset.offsetY === 'number')
          ) {
            this.pixelOffsetAssetIds.add(asset.assetId);
          }

          if (!processedAssets.has(asset.assetId) && asset.sprite) {
            processedAssets.add(asset.assetId);
            const defaultPath =
              asset.isCharacter === true || asset.category === 'characters'
                ? `/sprites/character/${String(asset.sprite).toLowerCase()}`
                : `/sprites/env/${String(asset.sprite).toLowerCase()}`;
            // Fallbacks for missing assets in public sprites
            const fallbackSprites: { [key: string]: string } = {
              dungeons_floor_8:
                '/sprites/env/floors/dungeon/dungeons_floor_6.png',
            };
            spriteMapping[asset.assetId] =
              fallbackSprites[asset.assetId] || defaultPath;
          }
        });
      });

      return spriteMapping;
    }

    getPixelAdjustedPosition(
      assetId: string | undefined,
      baseX: number,
      baseY: number,
      state?: any
    ): { x: number; y: number } {
      const offsetX = typeof state?.offsetX === 'number' ? state.offsetX : 0;
      const offsetY = typeof state?.offsetY === 'number' ? state.offsetY : 0;

      if (
        offsetX === 0 &&
        offsetY === 0 &&
        (!assetId || !this.pixelOffsetAssetIds.has(assetId))
      ) {
        return { x: baseX, y: baseY };
      }

      return { x: baseX + offsetX, y: baseY + offsetY };
    }

    /**
     * Discover animated environment assets from chunk data
     * We rely on the exported chunk asset flag `animated: true` from the map editor
     */
    private getAnimatedEnvAssetMap(): Map<string, { spritePath: string }> {
      const animated = new Map<string, { spritePath: string }>();
      const processed = new Set<string>();
      const allChunks = this.getAllChunks();
      allChunks.forEach((chunk) => {
        chunk.assets.forEach((asset: any) => {
          if (
            asset &&
            (asset.animated === true ||
              this.getEditorFrameCount(asset.assetId) > 1) &&
            typeof asset.assetId === 'string' &&
            typeof asset.sprite === 'string' &&
            !processed.has(asset.assetId)
          ) {
            processed.add(asset.assetId);
            animated.set(asset.assetId, {
              spritePath:
                asset.isCharacter === true || asset.category === 'characters'
                  ? `/sprites/character/${String(asset.sprite).toLowerCase()}`
                  : `/sprites/env/${String(asset.sprite).toLowerCase()}`,
            });
          }
        });
      });
      return animated;
    }

    private getAllChunks(): MapCluster[] {
      const aggregated: MapCluster[] = [];
      Object.values(this.mapChunks).forEach((chunks) => {
        aggregated.push(...chunks);
      });
      return aggregated;
    }

    /**
     * Convert loaded image textures for animated env assets into spritesheet-like frames
     * Assumes frames are arranged as a strip (horizontal preferred; vertical supported).
     * Frame size is inferred as square tiles: min(width, height) and divisible.
     */
    private registerAnimatedEnvSprites(): void {
      const animatedMap = this.getAnimatedEnvAssetMap();
      if (animatedMap.size === 0) {
        return;
      }

      animatedMap.forEach((_info, assetId) => {
        const key = assetId; // texture key equals assetId
        if (!this.textures.exists(key)) {
          return;
        }
        const texture = this.textures.get(key);
        const source = texture?.source?.[0];
        if (!source) {
          return;
        }

        const texWidth = source.width;
        const texHeight = source.height;

        // Prefer explicit frameCount from editor metadata; otherwise infer
        let frameCount = this.getEditorFrameCount(assetId);
        let frameWidth = texWidth;
        let frameHeight = texHeight;
        let orientation: 'horizontal' | 'vertical' =
          texWidth >= texHeight ? 'horizontal' : 'vertical';

        if (frameCount > 1) {
          // Match editor logic: choose orientation by comparing dimensions
          if (orientation === 'horizontal') {
            frameWidth = Math.floor(texWidth / frameCount);
            frameHeight = texHeight;
          } else {
            frameWidth = texWidth;
            frameHeight = Math.floor(texHeight / frameCount);
          }
        } else {
          const meta = inferStripMetaFromSize(texWidth, texHeight, 8);
          frameWidth = meta.frameWidth;
          frameHeight = meta.frameHeight;
          frameCount = meta.frameCount;
          orientation = meta.orientation as 'horizontal' | 'vertical';
        }

        // Avoid duplicating frames if already added
        const alreadyFramed = texture.getFrameNames().length > 1;
        if (!alreadyFramed && frameCount > 1) {
          for (let i = 0; i < frameCount; i++) {
            const sx = orientation === 'horizontal' ? i * frameWidth : 0;
            const sy = orientation === 'vertical' ? i * frameHeight : 0;
            // Frame names as numeric index for generateFrameNumbers compatibility
            texture.add(i.toString(), 0, sx, sy, frameWidth, frameHeight);
          }
        }

        // Set pixel-art scaling
        source.scaleMode = Phaser.ScaleModes.NEAREST;

        // Create animation if not present
        const animKey = `${key}_anim`;
        if (!this.anims.exists(animKey) && frameCount > 1) {
          this.anims.create({
            key: animKey,
            frames: this.anims.generateFrameNumbers(key, {
              start: 0,
              end: frameCount - 1,
            }),
            frameRate: 8, // Match editor preview FPS
            repeat: -1,
          });
        }
      });
    }

    preload() {
      console.log('GameScene: preload called');

      if (!this.textures.exists(FLOOR_TILESET.imageKey)) {
        this.load.image(FLOOR_TILESET.imageKey, FLOOR_TILESET.imagePath);
      }

      // Setup cursor keys
      this.cursors = this.input.keyboard!.createCursorKeys();

      const keyMapping = {
        spaceKey: Phaser.Input.Keyboard.KeyCodes.SPACE,
        nKey: Phaser.Input.Keyboard.KeyCodes.N,
        iKey: Phaser.Input.Keyboard.KeyCodes.I,
        pKey: Phaser.Input.Keyboard.KeyCodes.P,
        shiftKey: Phaser.Input.Keyboard.KeyCodes.SHIFT,
        bKey: Phaser.Input.Keyboard.KeyCodes.B,
        aKey: Phaser.Input.Keyboard.KeyCodes.A,
        gKey: Phaser.Input.Keyboard.KeyCodes.G,
        wKey: Phaser.Input.Keyboard.KeyCodes.W,
        sKey: Phaser.Input.Keyboard.KeyCodes.S,
        dKey: Phaser.Input.Keyboard.KeyCodes.D,
        tKey: Phaser.Input.Keyboard.KeyCodes.T,
        cKey: Phaser.Input.Keyboard.KeyCodes.C,
        eKey: Phaser.Input.Keyboard.KeyCodes.E,
        fKey: Phaser.Input.Keyboard.KeyCodes.F,
        oneKey: Phaser.Input.Keyboard.KeyCodes.ONE,
        twoKey: Phaser.Input.Keyboard.KeyCodes.TWO,
      };

      for (const [key, code] of Object.entries(keyMapping)) {
        this[key] = this.input.keyboard!.addKey(code);
      }

      // Mark input as dirty on movement key transitions (arrows + shift)
      const markDirty = () => {
        this.inputDirty = true;
      };
      this.input.keyboard?.on('keydown', (evt: KeyboardEvent) => {
        switch (evt.code) {
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'ArrowUp':
          case 'ArrowDown':
          case 'KeyW':
          case 'KeyA':
          case 'KeyS':
          case 'KeyD':
          case 'ShiftLeft':
          case 'ShiftRight':
            markDirty();
            break;
        }
      });
      this.input.keyboard?.on('keyup', (evt: KeyboardEvent) => {
        switch (evt.code) {
          case 'ArrowLeft':
          case 'ArrowRight':
          case 'ArrowUp':
          case 'ArrowDown':
          case 'KeyW':
          case 'KeyA':
          case 'KeyS':
          case 'KeyD':
          case 'ShiftLeft':
          case 'ShiftRight':
            markDirty();
            break;
        }
      });
    }

    async create() {
      console.log('GameScene: create called');

      // Dynamic sprite loading: Extract unique assets from chunks and load them automatically
      const spriteMapping = this.generateDynamicSpriteMapping();

      // Await the initial environment sprite batch and register animations
      // before the server starts sending entities that reference them.
      const envSpritesLoaded = new Promise<void>((resolve) => {
        this.load.once('complete', () => {
          try {
            // Register animations for animated environment assets (from chunks)
            this.registerAnimatedEnvSprites();
          } catch (e) {
            console.warn('Failed to register animated env sprites', e);
          }
          resolve();
        });
      });

      // Queue env textures: use spritesheets up-front for animated assets
      const animatedSpecs: Array<{
        key: string;
        url: string;
        frameCount: number;
      }> = [];
      const staticSpecs: Array<{ key: string; url: string }> = [];

      Object.entries(spriteMapping).forEach(([key, url]) => {
        const frameCount = this.getEditorFrameCount(key);
        if (frameCount > 1) {
          animatedSpecs.push({ key, url, frameCount });
        } else {
          staticSpecs.push({ key, url });
        }
      });

      // Load static images immediately
      staticSpecs.forEach(({ key, url }) => this.load.image(key, url));

      // Pre-measure animated strips to compute frame dimensions, then load as spritesheets
      if (animatedSpecs.length > 0) {
        const measurements = await Promise.all(
          animatedSpecs.map(
            (spec) =>
              new Promise<{
                key: string;
                url: string;
                frameWidth: number;
                frameHeight: number;
              }>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  const totalW = img.naturalWidth || (img as any).width || 0;
                  const totalH = img.naturalHeight || (img as any).height || 0;
                  const horizontal = totalW >= totalH;
                  const frameWidth = horizontal
                    ? Math.max(1, Math.floor(totalW / spec.frameCount))
                    : totalW;
                  const frameHeight = horizontal
                    ? totalH
                    : Math.max(1, Math.floor(totalH / spec.frameCount));
                  resolve({
                    key: spec.key,
                    url: spec.url,
                    frameWidth,
                    frameHeight,
                  });
                };
                img.onerror = () => {
                  // Fallback: load as image if we can't measure
                  staticSpecs.push({ key: spec.key, url: spec.url });
                  resolve({
                    key: spec.key,
                    url: spec.url,
                    frameWidth: 0,
                    frameHeight: 0,
                  });
                };
                img.src = spec.url;
              })
          )
        );

        // Enqueue measured spritesheets
        measurements.forEach(({ key, url, frameWidth, frameHeight }) => {
          if (frameWidth > 0 && frameHeight > 0) {
            this.load.spritesheet(key, url, {
              frameWidth,
              frameHeight,
            });
          } else {
            // Fallback to image if measurement failed
            this.load.image(key, url);
          }
        });
      }

      this.load.on('loaderror', (file: any) => {
        if (file.key.startsWith('tree_')) {
          console.error(
            `❌ Failed to load sprite: ${file.key} from ${file.url}`
          );
        }
      });

      // Treasure chest will be loaded via UnifiedSpriteManager in create() method

      // Load GHST token spritesheet (5000x2000px, 5 frames in row 0, 1 frame in row 1)
      this.load.spritesheet('ghst_token', '/sprites/coins/ghsttokensheet.png', {
        frameWidth: 1000, // 5000px ÷ 5 frames = 1000px per frame
        frameHeight: 1000, // 2000px ÷ 2 rows = 1000px per frame
      });

      const audioMapping = {
        pewpew: '/sfx/pewpew.mp3',
        grenade_throw: '/sfx/grenade_throw.mp3',
        grenade_explode: '/sfx/grenade_explode.mp3',
        healsplash: '/sfx/healsplash.mp3',
        fastwoosh: '/sfx/fastwoosh.mp3',
        itempickup: '/sfx/itempickup.mp3',
        enemy_dead: '/sfx/enemy_dead.mp3',
        slimedeath: '/sfx/slimedeath.mp3',
        dogbark: '/sfx/dogbark.mp3',
        ddtheme: '/music/ddtheme.mp3',
        boss1: '/music/boss1.mp3',
        victory1: '/music/victory1.mp3',
        gotchihit: '/sfx/gotchihit.mp3',
        lickdeath: '/sfx/lickdeath.mp3',
        cactusdeath: '/sfx/cactusdeath.mp3',
        slash: '/sfx/slash.mp3',
        crit: '/sfx/crit.mp3',
        playerlevelup: '/sfx/playerlevelup.mp3',
        clicksound: '/sfx/clicksound.mp3',
        portalpulsating: '/sfx/portalpulsating.mp3',
      };

      for (const [key, value] of Object.entries(audioMapping)) {
        this.load.audio(key, value);
      }

      // Load treasure chest spritesheet before starting the loader
      this.load.spritesheet(
        TREASURE_CHEST_SPRITE_CONFIG.key,
        TREASURE_CHEST_SPRITE_CONFIG.imagePath,
        {
          frameWidth: TREASURE_CHEST_SPRITE_CONFIG.frameWidth,
          frameHeight: TREASURE_CHEST_SPRITE_CONFIG.frameHeight,
        }
      );

      // Create animations after the spritesheets load

      //todo: refactor when we have more animations
      this.load.once('complete', () => {
        // GHST token animation
        this.anims.create({
          key: 'ghst_token_spin',
          frames: this.anims.generateFrameNumbers('ghst_token', {
            start: 0,
            end: 5,
          }),
          frameRate: 8, // 8 FPS for smooth animation
          repeat: -1, // Loop forever
        });

        // Create treasure chest animations
        this.createTreasureChestAnimations();
      });

      // Start theme music after assets have loaded and when audio is unlocked
      this.load.once('complete', () => {
        this.updateMusicPlaybackState();
        if (this.sound?.locked) {
          this.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
            this.updateMusicPlaybackState();
          });
        }
      });

      this.load.start();

      // Initialize sprite managers
      this.spriteManager = new AavegotchiSpriteManager(this as any);
      this.characterSpriteManager = new CharacterSpriteManager(this as any);
      this.enemySpriteManager = new EnemySpriteManager(this as any);
      this.portalSpriteManager = new PortalSpriteManager(this as any);
      this.entityManager = new EntityManager(this as any);

      // Dynamically preload all enemy sprites that have sprite configurations
      await this.loadAnimatedEnemySprites();

      // Preload portal sprites and animations
      await this.loadPortalSprites();

      // Initialize character sprites if enabled
      if (this.config.useCharacterSprites) {
        try {
          // Load all character sprites for bot variety
          await this.characterSpriteManager.preloadAllCharacterSprites();
        } catch (error) {
          console.warn(
            '⚠️ Failed to preload character sprites, falling back to Aavegotchi:',
            error
          );
          // Fallback to Aavegotchi sprites
          await this.spriteManager.preloadDefaultSprite();
        }
      } else {
        // Preload a default Aavegotchi sprite for all players

        try {
          await this.spriteManager.preloadDefaultSprite();
        } catch (error) {
          console.warn(
            '⚠️ Failed to preload Aavegotchi sprite, will use fallback:',
            error
          );
        }
      }

      // Store React callbacks for UI communication
      // Note: These will be set by the LocalGameScene that extends this class

      // Set background to a neutral color (will be covered by procedural terrain)
      this.cameras.main.setBackgroundColor('#2c3e50');

      // Set up camera bounds for the larger world with some padding
      const worldWidth = GAME_CONFIG?.WORLD_WIDTH || 3840;
      const worldHeight = GAME_CONFIG?.WORLD_HEIGHT || 2160;
      this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

      if (this.cameras?.main) {
        this.cameras.main.roundPixels = true;
      }

      // Set mobile-friendly zoom level (keep high for crisp text, show more world via larger viewport)
      // const zoomLevel = this.config.isMobile ? 1.0 : 0.8;
      // this.cameras.main.setZoom(zoomLevel);

      // console.log(
      //   `📱 Camera zoom set to ${zoomLevel} for ${this.config.isMobile ? 'mobile' : 'desktop'} device`
      // );

      // Set up physics world bounds (if needed)
      if (this.physics && this.physics.world) {
        this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
      }

      // Initialize complete environment (terrain, roads, boundaries)
      this.environmentSystem.initializeEnvironment(worldWidth, worldHeight);

      // Chunk floors will be rendered after sprites load (in load.on('complete') handler)
      // and again when room state becomes available with chunk layout

      debugLog('🌍 Base world setup completed');

      // Ensure environment textures are available before connecting so
      // entity renders (e.g., special assets) don't fail due to missing textures.
      try {
        await envSpritesLoaded;
      } catch {}

      // Delay minimap until after room join; it will be enabled in setupRoomHandlers/connect flow
      this.minimapEnabled = false;
      this.initializeMinimap();
      if (this.scale) {
        this.scale.on('resize', this.handleScaleResize, this);
      }
      this.events.once('shutdown', () => {
        this.scale?.off('resize', this.handleScaleResize, this);
        this.teardownMinimap();
        try {
          if (this.backgroundMusic) {
            if (typeof this.backgroundMusic.stop === 'function') {
              this.backgroundMusic.stop();
            }
            if (typeof this.backgroundMusic.destroy === 'function') {
              this.backgroundMusic.destroy();
            }
            this.backgroundMusic = null;
          }
        } catch {}
      });

      // Start server connection (this will be customized by extending classes)
      await this.initializeServerConnection();
    }

    /**
     * Load player sprite (either Aavegotchi or character sprite based on config)
     */
    async loadPlayerSprite(sessionId: string, player: any): Promise<void> {
      debugLog(`🎭 loadPlayerSprite called for ${sessionId}:`, {
        characterId: player?.characterId,
        hasCharacterId: !!player?.characterId,
        isCustomGotchi: player?.characterId?.startsWith('gotchi:'),
        playerData: player,
      });

      // Check if this is a custom gotchi
      const isCustomGotchi =
        player?.characterId && player.characterId.startsWith('gotchi:');

      if (isCustomGotchi) {
        // Custom gotchis: ensure spritesheet override is registered, then load via CharacterSpriteManager
        if (this.characterSpriteManager) {
          debugLog(
            `🎭 Using CharacterSpriteManager for custom gotchi: ${player.characterId}`
          );
          try {
            const gotchiId = String(player.characterId.split(':')[1]);
            const imagePath = await this.resolveGotchiSpritesheetUrl(gotchiId);
            if (imagePath) {
              // Register/refresh runtime override so registry resolves to server spritesheet
              setCharacterSpriteOverride(player.characterId, {
                imagePath,
                frameWidth: 100,
                frameHeight: 100,
              } as any);
            }
          } catch (e) {
            console.warn('Failed to set gotchi spritesheet override', e);
          }
          await this.loadCharacterSprite(sessionId, player);
        }
      } else if (
        this.config.useCharacterSprites &&
        this.characterSpriteManager
      ) {
        // Regular characters use character sprites
        debugLog(
          `🎭 Using character sprite for: ${player?.characterId || 'no characterId'}`
        );
        await this.loadCharacterSprite(sessionId, player);
      } else {
        console.warn('🎭 No sprite managers available');
      }
    }

    /**
     * Load character sprite with animations
     */
    async loadCharacterSprite(sessionId: string, player: any): Promise<void> {
      if (!this.characterSpriteManager || !this.entityManager) {
        console.warn(
          '🎭 CharacterSpriteManager or EntityManager not available'
        );
        return;
      }

      debugLog(`🎭 loadCharacterSprite called for ${sessionId}:`, {
        characterId: player?.characterId,
        hasCharacterId: !!player?.characterId,
        isCustomGotchi: player?.characterId?.startsWith('gotchi:'),
      });

      try {
        // Get the player container (EntityManager stores it here for compatibility)
        const playerContainer = this.playerEntities[sessionId];
        if (!playerContainer) {
          console.warn(`🎭 No player container found for ${sessionId}`);
          return;
        }

        // Get the current placeholder sprite from the container
        let oldPlayerSprite = playerContainer.getData('playerSprite');
        if (!oldPlayerSprite) {
          // Build a temporary placeholder if the container has none
          oldPlayerSprite = this.add.rectangle(0, 0, 64, 64, 0x00ff00, 0.8);
          playerContainer.add(oldPlayerSprite);
          playerContainer.setData('playerSprite', oldPlayerSprite);
        }

        // Use character ID from server, or default for main player
        let characterId: string | undefined;
        if (
          typeof player.characterId === 'string' &&
          player.characterId.length > 0
        ) {
          // Server assigned a character ID - use it
          characterId = player.characterId;
          debugLog(`🎭 Using character ID: ${characterId}`);

          if ((characterId as string).startsWith('gotchi:')) {
            // Load gotchi spritesheet from Supabase via server resolver
            const gotchiId = (characterId || '').split(':')[1];
            const sheetUrl = await this.resolveGotchiSpritesheetUrl(gotchiId);
            if (!sheetUrl) {
              console.error(
                'Failed to resolve gotchi spritesheet URL from server',
                {
                  gotchiId,
                }
              );
              return;
            }

            // Build external spritesheet config using character manager defaults
            const baseCfg =
              this.characterSpriteManager.getDefaultSpriteConfig();
            // For custom gotchis, override animations to match gotchi row layout
            // and ensure grenade 'throw' uses melee attack row (index 3)
            const gotchiAnimations = Array.isArray(baseCfg.animations)
              ? baseCfg.animations.map((anim: any) => {
                  const key = String(anim?.key || '');
                  if (key.startsWith('throw_')) {
                    return { ...anim, row: 3, startFrame: 0, endFrame: 5 };
                  }
                  if (key.startsWith('attack_ranged_')) {
                    return { ...anim, row: 2, startFrame: 0, endFrame: 2 };
                  }
                  if (key.startsWith('attack_')) {
                    return { ...anim, row: 3, startFrame: 0, endFrame: 5 };
                  }
                  if (key.startsWith('hurt_')) {
                    return { ...anim, row: 4, startFrame: 0, endFrame: 3 };
                  }
                  return anim;
                })
              : baseCfg.animations;
            const cfg = {
              ...baseCfg,
              key: `gotchi_${gotchiId}`,
              imagePath: sheetUrl,
              // Default 100x100 frame size unless overridden by server env
              frameWidth: 100,
              frameHeight: 100,
              animations: gotchiAnimations,
            };

            try {
              await this.characterSpriteManager.loadSpriteSheet(cfg);
            } catch (e) {
              console.error('Failed loading gotchi spritesheet', cfg, e);
              return;
            }
          } else {
            await this.characterSpriteManager.loadCharacterForPlayer(
              sessionId,
              characterId
            );
          }
        } else if (sessionId !== this.room?.sessionId) {
          // This is a bot without character ID - assign random character
          debugLog(`🎭 Assigning random character for bot ${sessionId}`);
          await this.characterSpriteManager.loadCharacterForPlayer(sessionId);
          characterId =
            this.characterSpriteManager.getPlayerCharacter(sessionId) ||
            undefined;
        }

        // Create character sprite at container's position (0,0 relative to container)
        let newSprite: any;
        const charIdSafe: string =
          typeof characterId === 'string' ? characterId : '';
        if (charIdSafe.startsWith('gotchi:')) {
          const gotchiId = charIdSafe.split(':')[1];
          const textureKey = `gotchi_${gotchiId}`;
          newSprite = this.add.sprite(0, 0, textureKey);
          const idleKey = `${textureKey}_idle_down`;
          if (this.anims.exists(idleKey)) newSprite.play(idleKey);
        } else {
          newSprite =
            this.characterSpriteManager.createCharacterSpriteForPlayer(
              sessionId,
              0,
              0,
              characterId
            );
        }

        //make aavegotchis slightly bigger
        newSprite.setScale(2.0);

        // Set initial animation based on player state
        const initialAnimation = this.characterSpriteManager.getAnimationKey(
          player.anim || 'idle',
          player.dir || 'down'
        );

        if (this.anims.exists(initialAnimation)) {
          newSprite.play(initialAnimation);
        } else {
          console.warn(
            `Animation ${initialAnimation} does not exist, trying idle_down`
          );
          if (this.anims.exists('idle_down')) {
            newSprite.play('idle_down');
          }
        }

        // Mark as character sprite
        newSprite.setData('isCharacterSprite', true);
        newSprite.setData('sessionId', sessionId);

        // Replace the old sprite with new one
        playerContainer.remove(oldPlayerSprite);
        oldPlayerSprite.destroy();
        playerContainer.add(newSprite);
        playerContainer.setData('playerSprite', newSprite);

        // Update camera follow if this is the current player - follow the container
        if (this.room && sessionId === this.room.sessionId) {
          this.cameras.main.startFollow(playerContainer, true, 1, 1);
          this.cameras.main.setFollowOffset(0, 0);
          this.cameras.main.setDeadzone(0, 0);
        }
      } catch (error) {
        console.error(
          `Error loading character sprite for player ${sessionId}:`,
          error
        );
      }
    }

    // Resolve gotchi spritesheet URL via server with exponential backoff
    private async resolveGotchiSpritesheetUrl(
      gotchiId: string
    ): Promise<string | null> {
      return resolveGotchiSpritesheetUrlApi(gotchiId, this.config.serverUrl);
    }

    /**
     * Load all enemy sprites that have sprite configurations
     */
    async loadAnimatedEnemySprites(): Promise<void> {
      if (!this.enemySpriteManager) return;

      // Get all enemies that have animated sprites and sprite configurations
      const animatedEnemies = Object.entries(ENEMY_TYPES).filter(
        ([_, stats]: [string, EnemyStats]) =>
          stats.animated && stats.spriteConfig
      );

      // Also load projectile sprites (like cactus_bullet)
      const projectileSprites = ['cactus_bullet'];

      const totalSprites = animatedEnemies.length + projectileSprites.length;
      debugLog(
        `🎯 Loading ${totalSprites} animated enemy and projectile sprites...`
      );

      // Load each animated enemy sprite
      for (const [enemyType, stats] of animatedEnemies as [
        string,
        EnemyStats,
      ][]) {
        try {
          await this.enemySpriteManager.loadEnemySprite(enemyType);
          debugLog(
            `✅ ${stats.name} (${enemyType}) sprite loaded successfully`
          );
        } catch (error) {
          console.warn(
            `⚠️ Failed to load ${stats.name} (${enemyType}) sprite:`,
            error
          );
        }
      }

      // Load projectile sprites
      for (const projectileType of projectileSprites) {
        try {
          await this.enemySpriteManager.loadEnemySprite(projectileType);
          debugLog(
            `✅ Projectile (${projectileType}) sprite loaded successfully`
          );
        } catch (error) {
          console.warn(
            `⚠️ Failed to load projectile (${projectileType}) sprite:`,
            error
          );
        }
      }

      debugLog('🎯 Enemy and projectile sprite loading completed');
    }

    /**
     * Load all portal sprites and animations
     */
    async loadPortalSprites(): Promise<void> {
      if (!this.portalSpriteManager) return;

      try {
        debugLog('🌀 Loading portal sprites and animations...');
        await this.portalSpriteManager.preloadPortalSprites();
        debugLog('✅ All portal sprites loaded successfully');
      } catch (error) {
        console.warn('⚠️ Failed to load portal sprites:', error);
      }
    }

    /**
     * Create treasure chest animations from the loaded spritesheet
     */
    createTreasureChestAnimations(): void {
      try {
        // Calculate frames per row based on sprite sheet dimensions
        const texture = this.textures.get(TREASURE_CHEST_SPRITE_CONFIG.key);
        if (!texture || !texture.source[0]) {
          console.warn(
            '⚠️ Treasure chest texture not found, skipping animations'
          );
          return;
        }

        const textureWidth = texture.source[0].width;
        const textureHeight = texture.source[0].height;
        const framesPerRow = Math.floor(
          textureWidth / TREASURE_CHEST_SPRITE_CONFIG.frameWidth
        );

        // Create animations from config
        TREASURE_CHEST_SPRITE_CONFIG.animations.forEach((animConfig) => {
          // Calculate actual frame numbers based on row and column
          const startFrameNumber =
            animConfig.row * framesPerRow + animConfig.startFrame;
          const endFrameNumber =
            animConfig.row * framesPerRow + animConfig.endFrame;

          const animationKey = `${TREASURE_CHEST_SPRITE_CONFIG.key}_${animConfig.key}`;

          // Create the animation
          this.anims.create({
            key: animationKey,
            frames: this.anims.generateFrameNumbers(
              TREASURE_CHEST_SPRITE_CONFIG.key,
              {
                start: startFrameNumber,
                end: endFrameNumber,
              }
            ),
            frameRate: animConfig.frameRate,
            repeat: animConfig.repeat,
            duration: animConfig.duration,
          });

          console.log(`✅ Created treasure chest animation: ${animationKey}`);
        });

        // Set texture filtering to nearest for crisp pixel art
        if (texture.source[0]) {
          texture.source[0].scaleMode = Phaser.ScaleModes.NEAREST;
        }

        console.log('🎁 Treasure chest animations created successfully');
      } catch (error) {
        console.error('❌ Failed to create treasure chest animations:', error);
      }
    }

    private normalizeGotchiDirection(
      direction: string | null | undefined
    ): GotchiAnimationDirection {
      switch (direction) {
        case 'up':
        case 'down':
        case 'left':
        case 'right':
          return direction;
        default:
          return 'down';
      }
    }

    private resolveGotchiStaticTextureKey(
      sessionId: string,
      direction: GotchiAnimationDirection
    ): string | null {
      const suffixMap: Record<GotchiAnimationDirection, string> = {
        down: 'front',
        up: 'back',
        left: 'left',
        right: 'right',
      };
      const suffix = suffixMap[direction] ?? 'front';
      const candidates = [
        `${sessionId}_${suffix}`,
        `default_aavegotchi_${suffix}`,
      ];

      for (const key of candidates) {
        if (this.textures.exists(key)) {
          return key;
        }
      }

      return null;
    }

    private mapAavegotchiAction(
      animation: string | null | undefined
    ): GotchiAnimationAction | null {
      const normalized = (animation || '').toLowerCase();
      switch (normalized) {
        case 'idle':
        case 'walk':
        case 'sprint':
        case 'attack':
        case 'attack_ranged':
        case 'throw':
        case 'death':
          return normalized as GotchiAnimationAction;
        case 'run':
        case 'fly':
          return 'sprint';
        case 'die':
        case 'dead':
          return 'death';
        case 'hurt':
          return null;
        default:
          return 'idle';
      }
    }

    private stopGotchiFloat(sprite: Phaser.GameObjects.GameObject): void {
      const floatTween = sprite.getData(
        'floatTween'
      ) as Phaser.Tweens.Tween | null;
      if (floatTween) {
        this.tweens.remove(floatTween);
        sprite.setData('floatTween', null);
      }

      const shadowTween = sprite.getData(
        'shadowTween'
      ) as Phaser.Tweens.Tween | null;
      if (shadowTween) {
        this.tweens.remove(shadowTween);
        sprite.setData('shadowTween', null);
      }

      const container = (sprite as any)
        .parentContainer as Phaser.GameObjects.Container | null;
      const baseY = sprite.getData('baseY');
      if (container && typeof baseY === 'number') {
        container.y = baseY;
      }
    }

    private applyGotchiAnimationLock(
      sprite: Phaser.GameObjects.Sprite,
      durationMs: number
    ): void {
      if (!Number.isFinite(durationMs) || durationMs <= 0) return;

      const existing = sprite.getData(
        GOTCHI_ANIMATION_TIMER_KEY
      ) as Phaser.Time.TimerEvent | null;
      if (existing) {
        existing.remove(false);
      }

      sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, true);

      const timer = this.time.delayedCall(
        Math.max(50, Math.floor(durationMs)),
        () => {
          if (!sprite.scene) return;
          sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, false);
          sprite.setData(GOTCHI_ANIMATION_TIMER_KEY, null);
        }
      );

      sprite.setData(GOTCHI_ANIMATION_TIMER_KEY, timer);
    }

    private clearGotchiAnimationLock(sprite: Phaser.GameObjects.Sprite): void {
      const existing = sprite.getData(
        GOTCHI_ANIMATION_TIMER_KEY
      ) as Phaser.Time.TimerEvent | null;
      if (existing) {
        existing.remove(false);
      }
      sprite.setData(GOTCHI_ANIMATION_TIMER_KEY, null);
      sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, false);
    }

    private scheduleGotchiDeathFade(sprite: Phaser.GameObjects.Sprite): void {
      const existing = sprite.getData(
        GOTCHI_DEATH_TIMER_KEY
      ) as Phaser.Time.TimerEvent | null;
      if (existing) {
        existing.remove(false);
      }

      const timer = this.time.delayedCall(GOTCHI_DEATH_FADE_DELAY_MS, () => {
        if (!sprite.scene) return;
        const shadow = sprite.getData(
          'shadow'
        ) as Phaser.GameObjects.GameObject | null;
        const targets = shadow ? [sprite, shadow] : [sprite];
        this.tweens.add({
          targets,
          alpha: 0,
          duration: 800,
          onComplete: () => {
            sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, true);
            sprite.setData(GOTCHI_DEATH_TIMER_KEY, null);
          },
        });
      });

      sprite.setData(GOTCHI_DEATH_TIMER_KEY, timer);
    }

    private handleGotchiDeathAnimation(
      sprite: Phaser.GameObjects.Sprite,
      direction: GotchiAnimationDirection
    ): void {
      const alreadyFlagged = sprite.getData(GOTCHI_DEATH_FLAG_KEY) as boolean;
      if (!alreadyFlagged) {
        sprite.setData(GOTCHI_DEATH_FLAG_KEY, true);
        this.stopGotchiFloat(sprite);
        sprite.setAlpha(1);
        this.scheduleGotchiDeathFade(sprite);
      }

      this.clearGotchiAnimationLock(sprite);
      sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, true);
      playAavegotchiAnimation(sprite, 'death', direction);
    }

    /**
     * Update player animation based on current state
     */
    updatePlayerAnimation(
      sessionId: string,
      animation: string,
      direction: string,
      intervalMs?: number
    ): void {
      const playerContainer = this.playerEntities[sessionId];
      if (!playerContainer) return;

      // Get the actual sprite from the container
      const playerSprite = playerContainer.getData('playerSprite');
      if (!playerSprite) return;

      // Check if this is a custom gotchi
      const playerState = this.room?.state.players.get(sessionId);
      const characterId = playerState?.characterId;
      const isCustomGotchi = characterId && characterId.startsWith('gotchi:');

      if (playerSprite.getData('isCharacterSprite')) {
        // Update character sprite animation
        if (this.characterSpriteManager) {
          this.characterSpriteManager.updateCharacterAnimation(
            playerSprite,
            animation,
            direction,
            characterId,
            intervalMs
          );
        }
      } else if (playerSprite.getData('isAavegotchi') || isCustomGotchi) {
        if (!this.spriteManager) return;

        const normalizedDirection = this.normalizeGotchiDirection(direction);
        const mappedAction = this.mapAavegotchiAction(animation);
        const playerState = this.room?.state.players.get(sessionId);

        if (
          mappedAction === null &&
          'anims' in playerSprite &&
          playerSprite.anims
        ) {
          const sprite = playerSprite as Phaser.GameObjects.Sprite;
          sprite.setFlipX(normalizedDirection === 'left');
          const sprinting =
            mappedAction === 'sprint' || Boolean(playerState?.isSprinting);
          sprite.setAlpha(sprinting ? GOTCHI_SPRINT_ALPHA : 1);
          return;
        }

        if ('anims' in playerSprite && playerSprite.anims) {
          const sprite = playerSprite as Phaser.GameObjects.Sprite;
          const spritesheetKey =
            sprite.getData('gotchiSpritesheetKey') ??
            this.spriteManager.getSpritesheetKey(sessionId);

          if (spritesheetKey && this.textures.exists(spritesheetKey)) {
            if (sprite.texture?.key !== spritesheetKey) {
              sprite.setTexture(spritesheetKey);
            }
            sprite.setData('gotchiSpritesheetKey', spritesheetKey);

            if (mappedAction === 'death') {
              this.handleGotchiDeathAnimation(sprite, normalizedDirection);
              return;
            }

            if (mappedAction) {
              if (GOTCHI_LOCK_ACTIONS.has(mappedAction)) {
                const lockDuration =
                  intervalMs && intervalMs > 0
                    ? intervalMs
                    : GOTCHI_DEFAULT_ATTACK_LOCK_MS;
                this.applyGotchiAnimationLock(sprite, lockDuration);
              } else if (!sprite.getData(GOTCHI_ANIMATION_TIMER_KEY)) {
                sprite.setData(GOTCHI_ANIMATION_LOCK_KEY, false);
              }

              playAavegotchiAnimation(
                sprite,
                mappedAction,
                normalizedDirection,
                intervalMs
              );
            }

            const sprinting =
              mappedAction === 'sprint' || Boolean(playerState?.isSprinting);
            sprite.setAlpha(sprinting ? GOTCHI_SPRINT_ALPHA : 1);
          } else {
            const fallbackTextureKey = this.resolveGotchiStaticTextureKey(
              sessionId,
              normalizedDirection
            );
            if (
              fallbackTextureKey &&
              this.textures.exists(fallbackTextureKey)
            ) {
              sprite.setTexture(fallbackTextureKey);
            }
          }
        } else {
          const fallbackTextureKey =
            this.spriteManager.getTextureKeyForDirection(
              sessionId,
              normalizedDirection
            ) ||
            this.resolveGotchiStaticTextureKey(sessionId, normalizedDirection);
          if (fallbackTextureKey && this.textures.exists(fallbackTextureKey)) {
            (playerSprite as Phaser.GameObjects.Image).setTexture(
              fallbackTextureKey
            );
          }
          const sprinting = Boolean(playerState?.isSprinting);
          (playerSprite as Phaser.GameObjects.Image).setAlpha(
            sprinting ? GOTCHI_SPRINT_ALPHA : 1
          );
        }
      }
    }

    async initializeServerConnection() {
      // Base implementation - can be overridden by extending classes
      debugLog('🔌 Attempting to connect to Colyseus server...');
      debugLog('📍 Server URL:', (this.client as any).endpoint || 'Unknown');
      debugLog('🌐 Connection timeout will be 20 seconds');

      // Add connection timeout
      const connectionPromise = this.connectToRoom();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Connection timeout after 20 seconds'));
        }, 20000);
      });

      try {
        await Promise.race([connectionPromise, timeoutPromise]);
      } catch (error) {
        console.error('🚫 Connection failed or timed out:', error);
        throw error;
      }
    }

    async connectToRoom() {
      try {
        // Get room connection parameters from config
        const effectivePlayerName =
          this.config.playerName.trim() !== ''
            ? this.config.playerName.trim()
            : 'Player' + Math.floor(Math.random() * 1000);

        // Check if user is trying to use a custom gotchi and needs authentication
        const isDynamicGotchi =
          typeof this.config.selectedCharacterId === 'string' &&
          this.config.selectedCharacterId.startsWith('gotchi:');
        const gotchiId = isDynamicGotchi
          ? this.config.selectedCharacterId!.split(':')[1]
          : undefined;

        const roomOptions: any = {
          name: effectivePlayerName,
          wallet: this.config.walletAddress,
          avatarId: this.config.avatarId,
          // Send either gotchiId or characterId, not both
          ...(gotchiId
            ? { gotchiId }
            : { characterId: this.config.selectedCharacterId }),
          difficultyTier: (this.config.difficultyTier || 'normal_1')
            .toLowerCase()
            .replace(/-/g, '_'), // Pass normalized difficulty tier
        };

        // no admin-preview passthroughs

        debugLog('👤 Player options:', roomOptions);

        // Get session token for authentication
        let authorizationHeader = '';
        const requireAuth = isDynamicGotchi || this.config.debugTreasureRoom;
        if (requireAuth) {
          // For custom gotchis, we need authentication
          let hasValidSession = false;
          try {
            // Get server URL from config or fallback methods
            let serverUrl = this.config.serverUrl;

            if (!serverUrl) {
              // Fallback: try to get from window.location for development
              serverUrl =
                typeof window !== 'undefined' &&
                window.location.hostname === 'localhost'
                  ? `http://${window.location.hostname}:1999`
                  : '';
            }

            if (!serverUrl) {
              console.warn(
                'Could not determine server URL for authentication check'
              );
              throw new Error('Could not determine server URL');
            }

            debugLog('🔐 Checking authentication with server:', serverUrl);

            const sessionResponse = await fetch(
              `${serverUrl}/api/auth/session`,
              {
                credentials: 'include',
              }
            );

            debugLog('🔐 Session response status:', sessionResponse.status);

            if (sessionResponse.ok) {
              const sessionData = await sessionResponse.json();
              debugLog('🔐 Session data:', sessionData);

              if (sessionData.address) {
                hasValidSession = true;
                if (
                  typeof sessionData.token === 'string' &&
                  sessionData.token
                ) {
                  authorizationHeader = `Bearer ${sessionData.token}`;
                  debugLog('🔐 Using session token from API response');
                } else {
                  // Fallback to cookie (legacy)
                  const cookies = document.cookie
                    .split(';')
                    .find((c) => c.trim().startsWith('dd-session='));
                  if (cookies) {
                    const token = cookies.split('=')[1];
                    authorizationHeader = `Bearer ${token}`;
                    debugLog('🔐 Using session token from cookie');
                  } else {
                    console.warn('🔐 No session token available');
                  }
                }
              } else {
                console.warn(
                  '🔐 Session response ok but no address in data:',
                  sessionData
                );
              }
            } else {
              console.warn(
                '🔐 Session check failed with status:',
                sessionResponse.status
              );
              const errorText = await sessionResponse.text();
              console.warn('🔐 Session check error response:', errorText);
            }
          } catch (error) {
            console.warn('Failed to get session token:', error);
          }

          if (!hasValidSession) {
            throw new Error(
              'Authentication required to use custom Aavegotchis. Please connect your wallet and sign the authentication message.'
            );
          }
        }

        // Configure client with authorization header if available
        if (authorizationHeader) {
          (this.client as any).authorization = authorizationHeader;
        }

        // Prepare connection options with authorization if available
        const connectionOptions = authorizationHeader
          ? {
              ...roomOptions,
              authorization: authorizationHeader,
            }
          : roomOptions;
        const isJoiningExistingRoom = Boolean(this.config.joinRoomId);

        if (isJoiningExistingRoom && this.config.joinRoomId) {
          console.log(`🔗 Joining room by ID: ${this.config.joinRoomId}`);
          try {
            this.room = await this.client.joinById(
              this.config.joinRoomId,
              connectionOptions
            );
          } catch (e) {
            console.error('❌ Failed to join room by ID:', e);
            throw new Error(
              'Unable to join this room. It may be full or inactive.'
            );
          }
        } else if (this.config.debugTreasureRoom) {
          console.log('🗝️ Creating debug treasure room...');
          this.room = await this.client.create('game_room', {
            ...connectionOptions,
            isPrivate: true,
            debugTreasureRoom: true, // Special flag for treasure room
          });
        } else {
          console.log('🆕 Creating new room via Play Now...');
          this.room = await this.client.create('game_room', {
            ...connectionOptions,
            isPrivate: true,
            region: this.config.regionId,
          });
        }

        console.log('🎉 Room connection successful!');
        console.log('🏠 Room ID:', this.room.id);
        console.log('👥 Session ID:', this.room.sessionId);

        console.log('✅ Joined room successfully!', this.room);
        console.log(
          '🔌 Room connection state:',
          (this.room.connection as any)?.transport.ws?.readyState
        );

        // Set up all room handlers
        this.setupRoomHandlers();
        this.syncProgressionProfile(this.config.progressionProfile);

        // Set up click-to-move
        this.setupClickToMove();

        // Enable minimap now that we're connected and ready
        this.minimapEnabled = true;
        this.initializeMinimap();

        // Enable collision zone debugging (after a short delay to ensure scene is ready)
        this.time.delayedCall(100, () => {
          this.setupCollisionDebug();
        });

        // // Add test rectangle for debug visualization
        // this.testRect = this.add.rectangle(300, 200, 150, 100, 0xff0000, 0.8);
        // if (this.testRect) {
        //   this.testRect.setStrokeStyle(5, 0xffffff);
        //   this.testRect.setDepth(1500);
        //   this.testRect.setVisible(false); // Start hidden, B key will show
        // }

        // // Add collision rectangles around all interactive objects
        // this.time.delayedCall(500, () => {
        //   this.createInteractiveObjectRectangles();
        // });

        // Set up path visualization
        this.setupPathVisualization();

        // Initialize grenade system listeners
        this.setupGrenadeSystem();
        this.setupSpellSystem();
        this.setupScoreListeners();
        this.setupEnemyDifficultyListeners();
        this.setupHuntedListeners();

        console.log('🎮 Game initialization completed successfully!');
      } catch (error) {
        console.error('💥 Error during room connection:', error);
        this.handleConnectionError(error);
        throw error;
      }
    }

    setupPathVisualization() {
      console.log('🛤️ Setting up path visualization');

      // Create graphics object for drawing paths
      this.pathGraphics = this.add.graphics();
      this.pathGraphics.setDepth(1200); // Above collision zones but below UI
      this.pathGraphics.setScrollFactor(1); // Follow camera
      this.registerMinimapIgnore(this.pathGraphics);

      // Set up path visualization listeners using proper event-driven approach
      this.setupPathVisualizationListeners();
    }

    setupPathVisualizationListeners() {
      // Listen for room state changes to update path visualization
      if (this.room && this.room.state && this.room.state.players) {
        this.room.state.players.onAdd((player: any, sessionId: string) => {
          // Listen for path changes on this player
          if (sessionId === this.room!.sessionId) {
            player.onChange(() => {
              this.updatePathVisualization(player);
            });
          }
        });
      } else if (this.room) {
        console.log(
          '🛤️ Room state not ready for path visualization, waiting for onStateChange...'
        );

        // Use Colyseus onStateChange to wait for state initialization
        const handleStateChange = () => {
          console.log(
            '🛤️ Room state now ready, setting up path visualization listeners'
          );
          this.setupPathVisualizationListeners();
        };

        // Listen for the first state change which means state is ready
        this.room.onStateChange.once(handleStateChange);
      }
    }

    private getLocalPlayerState(): any | null {
      if (!this.room || !this.room.state?.players) return null;
      return this.room.state.players.get(this.room.sessionId) || null;
    }

    private getGrenadeDefinition(slug: string): GrenadeDefinitionEntry | null {
      const normalized = typeof slug === 'string' ? slug : String(slug ?? '');
      const trimmed = normalized.trim();
      if (!trimmed) return null;
      const wearable = getWearableBySlug(trimmed);
      const grenade = wearable?.weapon?.grenade;
      if (!wearable || wearable.weapon?.weaponType !== 'grenades' || !grenade) {
        return null;
      }
      return {
        slug: trimmed,
        name: wearable.name,
        svgId: wearable.svgId,
        grenade,
      };
    }

    private buildWeaponHudState(player: any): WeaponHudState {
      try {
        const derivedRaw = player?.derivedStats;
        let derived: any = null;
        if (typeof derivedRaw === 'string' && derivedRaw.trim().length) {
          derived = JSON.parse(derivedRaw);
        } else if (derivedRaw && typeof derivedRaw === 'object') {
          derived = derivedRaw;
        }

        const equipmentItems = Array.isArray(derived?.equipment?.items)
          ? derived.equipment.items
          : [];
        const weaponsSource = Array.isArray(derived?.weapons)
          ? derived.weapons
          : [];

        const weapons: WeaponHudEntry[] = [];
        for (const weapon of weaponsSource) {
          if (
            !weapon ||
            (weapon.weaponType !== 'melee' && weapon.weaponType !== 'ranged')
          ) {
            continue;
          }
          const slugValue = weapon.slug;
          const slug =
            typeof slugValue === 'string'
              ? slugValue
              : typeof slugValue === 'number'
                ? String(slugValue)
                : '';
          if (!slug) continue;
          const equipment = equipmentItems.find(
            (item: any) => item && item.slug === slug
          );
          const slot = equipment?.slot;
          let hudSlot: 'left' | 'right';
          if (slot === 'handLeft') {
            hudSlot = 'left';
          } else if (slot === 'handRight') {
            hudSlot = 'right';
          } else {
            continue;
          }
          const wearable = getWearableBySlug(slug);
          const name =
            typeof weapon.name === 'string'
              ? weapon.name
              : wearable?.name || slug.replace(/[-_]/g, ' ');
          let iconUrl = '';
          if (wearable && typeof wearable.svgId === 'number') {
            iconUrl = `/wearables/${wearable.svgId}.svg`;
          } else if (typeof weapon.iconUrl === 'string') {
            iconUrl = weapon.iconUrl;
          } else if (typeof weapon.icon === 'string') {
            iconUrl = weapon.icon;
          }
          weapons.push({
            slot: hudSlot,
            slug,
            name,
            iconUrl,
            weaponType: weapon.weaponType,
          });
        }

        if (weapons.length === 0 && equipmentItems.length > 0) {
          for (const item of equipmentItems) {
            if (!item) continue;
            const slot = item.slot;
            if (slot !== 'handLeft' && slot !== 'handRight') continue;
            const slug = typeof item.slug === 'string' ? item.slug : null;
            if (!slug) continue;
            const wearable = getWearableBySlug(slug);
            const weaponProfile = wearable?.weapon;
            if (!weaponProfile) continue;
            if (
              weaponProfile.weaponType !== 'melee' &&
              weaponProfile.weaponType !== 'ranged'
            ) {
              continue;
            }
            weapons.push({
              slot: slot === 'handLeft' ? 'left' : 'right',
              slug,
              name: wearable?.name || slug.replace(/[-_]/g, ' '),
              iconUrl:
                wearable && typeof wearable.svgId === 'number'
                  ? `/wearables/${wearable.svgId}.svg`
                  : '/wearables/0.svg',
              weaponType: weaponProfile.weaponType,
            });
          }
        }

        weapons.sort((a, b) =>
          a.slot === b.slot ? 0 : a.slot === 'left' ? -1 : 1
        );

        const rawIndex =
          typeof player?.activeWeaponIndex === 'number'
            ? Math.floor(player.activeWeaponIndex)
            : -1;
        let activeIndex = rawIndex;
        if (weapons.length === 0) {
          activeIndex = -1;
        } else if (activeIndex < 0 || activeIndex >= weapons.length) {
          const leftIndex = weapons.findIndex((entry) => entry.slot === 'left');
          activeIndex = leftIndex >= 0 ? leftIndex : 0;
        }

        return {
          weapons,
          activeIndex,
        };
      } catch (error) {
        console.warn('Failed to build weapon HUD state', error);
        return { weapons: [], activeIndex: -1 };
      }
    }

    private syncWeaponModeFromHud(state: WeaponHudState) {
      const active =
        state.activeIndex >= 0 ? state.weapons[state.activeIndex] : null;
      const newMode =
        active &&
        (active.weaponType === 'ranged' || active.weaponType === 'melee')
          ? active.weaponType
          : 'melee';
      if (newMode !== this.weaponMode) {
        this.weaponMode = newMode;
        this.updateRangeIndicator();
      }
    }

    private refreshWeaponHudStateFromPlayer(player: any, force = false) {
      const state = this.buildWeaponHudState(player);
      const serialized = JSON.stringify(state);
      if (!force && serialized === this.weaponHudStateSnapshot) {
        return;
      }
      this.weaponHudStateSnapshot = serialized;
      this.weaponHudState = {
        weapons: state.weapons.slice(),
        activeIndex: state.activeIndex,
      };
      this.syncWeaponModeFromHud(state);
      this.events.emit('weapon:hud-update', this.weaponHudState);
    }

    private applyOptimisticWeaponSelection(index: number) {
      if (!this.weaponHudState || this.weaponHudState.weapons.length === 0) {
        return;
      }
      const weapons = this.weaponHudState.weapons.slice();
      const boundedIndex = Math.max(0, Math.min(index, weapons.length - 1));
      if (boundedIndex === this.weaponHudState.activeIndex) {
        return;
      }
      const nextState: WeaponHudState = {
        weapons,
        activeIndex: boundedIndex,
      };
      this.weaponHudState = nextState;
      this.weaponHudStateSnapshot = JSON.stringify(nextState);
      this.syncWeaponModeFromHud(nextState);
      this.events.emit('weapon:hud-update', nextState);
    }

    private applyOptimisticWeaponCycle() {
      if (!this.weaponHudState || this.weaponHudState.weapons.length === 0) {
        return;
      }
      const count = this.weaponHudState.weapons.length;
      const current =
        this.weaponHudState.activeIndex >= 0
          ? this.weaponHudState.activeIndex
          : 0;
      const nextIndex = count <= 1 ? current : (current + 1) % count;
      this.applyOptimisticWeaponSelection(nextIndex);
    }

    private refreshGrenadeDefinitionsFromSignature(signature: unknown) {
      let wearableSlugs: string[] = [];

      if (typeof signature === 'string') {
        try {
          const parsed = JSON.parse(signature);
          if (Array.isArray(parsed)) {
            wearableSlugs = parsed
              .map((value) =>
                typeof value === 'string' ? value : String(value ?? '')
              )
              .map((slug) => slug.trim())
              .filter((slug) => slug.length > 0)
              .map((slug) => {
                const parts = slug.split('::');
                return parts.length >= 2 ? parts[1] : slug;
              });
          }
        } catch (error) {
          console.warn('🧨 Failed to parse equippedWearables signature', error);
        }
      } else if (Array.isArray(signature)) {
        wearableSlugs = (signature as any[])
          .map((value) =>
            typeof value === 'string' ? value : String(value ?? '')
          )
          .map((slug) => slug.trim())
          .filter((slug) => slug.length > 0)
          .map((slug) => {
            const parts = slug.split('::');
            return parts.length >= 2 ? parts[1] : slug;
          });
      }

      const grenadeDefs: GrenadeDefinitionEntry[] = [];
      for (const slug of wearableSlugs) {
        const def = this.getGrenadeDefinition(slug);
        if (def) {
          grenadeDefs.push(def);
          this.queueGrenadeTexture(def);
        }
      }

      const newSlugSet = new Set(grenadeDefs.map((entry) => entry.slug));

      if (this.armedGrenadeSlug && !newSlugSet.has(this.armedGrenadeSlug)) {
        this.disarmGrenade();
      }

      this.grenadeDefinitions = grenadeDefs;

      for (const key of Array.from(this.grenadeCooldowns.keys())) {
        if (!newSlugSet.has(key)) {
          this.grenadeCooldowns.delete(key);
        }
      }

      if (grenadeDefs.length === 0) {
        this.grenadeHudStateSnapshot = null;
        this.nextGrenadeHudEmitAt = 0;
      }

      this.emitGrenadeHudState(true);
    }

    private getSpellStorageKey(spellId: string): string | null {
      const base =
        this.spellStoragePrefix ||
        (this.room?.sessionId
          ? `spell-autocast:${this.room.sessionId}:`
          : null);
      if (!base) {
        return null;
      }
      return `${base}${spellId}`;
    }

    private persistSpellAutocastPreference(spellId: string, enabled: boolean) {
      const key = this.getSpellStorageKey(spellId);
      if (!key || typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(key, enabled ? '1' : '0');
      } catch {}
    }

    private loadSpellAutocastPreference(
      spellId: string,
      fallback: boolean
    ): boolean {
      const key = this.getSpellStorageKey(spellId);
      if (!key || typeof window === 'undefined') {
        return fallback;
      }
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === '1') return true;
        if (raw === '0') return false;
      } catch {}
      return fallback;
    }

    private updateSpellAutocastInternal(
      spellId: string,
      enabled: boolean,
      options: { notifyServer?: boolean; persist?: boolean } = {}
    ) {
      const normalized = spellId.trim();
      if (!normalized) return;

      const previous = this.spellAutocastMap.get(normalized);
      this.spellAutocastMap.set(normalized, enabled);

      if (options.persist !== false) {
        this.persistSpellAutocastPreference(normalized, enabled);
      }

      if (options.notifyServer && this.room) {
        const fallbackDefault =
          SPELLS_BY_ID[normalized]?.autocastEnabledByDefault ?? false;
        const previousValue =
          typeof previous === 'boolean' ? previous : fallbackDefault;
        this.pendingSpellAutocastUpdates.set(normalized, {
          requested: enabled,
          previous: previousValue,
        });
        this.room.send('spell_autocast', {
          spellId: normalized,
          enabled,
        });
      }

      if (previous !== enabled || options.notifyServer === false) {
        this.emitSpellHudState(true);
      }
    }

    private resolveWeaponCategoryFromSlug(
      slug: string | undefined
    ): string | undefined {
      if (!slug) return undefined;
      const trimmed = slug.trim();
      if (!trimmed) return undefined;

      // First try direct lookup with original slug
      let weaponDefinition = WEAPON_DEFINITIONS[trimmed];
      if (weaponDefinition?.weaponCategory) {
        return weaponDefinition.weaponCategory;
      }

      // Try normalized slug (in case quality prefix was needed for lookup)
      const normalized = normalizeWearableSlug(trimmed);
      if (normalized !== trimmed) {
        weaponDefinition = WEAPON_DEFINITIONS[normalized];
        if (weaponDefinition?.weaponCategory) {
          return weaponDefinition.weaponCategory;
        }
      }

      // Fallback to wearable lookup (which handles normalization internally)
      const wearable = getWearableBySlug(trimmed);
      const category = wearable?.weapon?.weaponCategory;
      if (typeof category === 'string' && category.length > 0) {
        return category;
      }

      return undefined;
    }

    private resolveActiveWeaponSlug(
      derived: any,
      player: any
    ): string | undefined {
      try {
        const fromDerived =
          typeof derived?.activeWeaponSlug === 'string'
            ? derived.activeWeaponSlug.trim()
            : '';
        if (fromDerived) {
          return fromDerived;
        }

        // Fallback: some server paths include the full activeWeapon object instead of the slug
        const fromActiveWeaponObj =
          typeof derived?.activeWeapon?.slug === 'string'
            ? String(derived.activeWeapon.slug).trim()
            : '';
        if (fromActiveWeaponObj) {
          return fromActiveWeaponObj;
        }

        if (
          Array.isArray(derived?.weapons) &&
          typeof player?.activeWeaponIndex === 'number'
        ) {
          const rawIndex = Math.floor(player.activeWeaponIndex);
          const index = Number.isFinite(rawIndex) ? Math.max(0, rawIndex) : 0;
          const entry = derived.weapons[index];
          if (entry && typeof entry.slug === 'string') {
            const trimmed = entry.slug.trim();
            if (trimmed) return trimmed;
          }
        }

        if (
          this.weaponHudState &&
          Array.isArray(this.weaponHudState.weapons) &&
          this.weaponHudState.weapons.length > 0
        ) {
          const index =
            this.weaponHudState.activeIndex >= 0
              ? this.weaponHudState.activeIndex
              : 0;
          const entry = this.weaponHudState.weapons[index];
          if (entry && typeof entry.slug === 'string') {
            const trimmed = entry.slug.trim();
            if (trimmed) return trimmed;
          }
        }

        if (typeof player?.activeWeaponSlug === 'string') {
          const trimmed = player.activeWeaponSlug.trim();
          if (trimmed) return trimmed;
        }

        // Last resort: if weapons are present, assume the first one is active
        if (Array.isArray(derived?.weapons) && derived.weapons.length > 0) {
          const first = derived.weapons[0];
          if (first && typeof first.slug === 'string') {
            const trimmed = first.slug.trim();
            if (trimmed) return trimmed;
          }
        }
      } catch {}

      return undefined;
    }

    private refreshSpellStoragePrefix(player: any) {
      const wallet =
        typeof player?.wallet === 'string' && player.wallet.trim().length > 0
          ? player.wallet.trim()
          : null;
      const characterId =
        typeof player?.characterId === 'string' &&
        player.characterId.trim().length > 0
          ? player.characterId.trim()
          : null;
      const base = wallet || characterId || this.room?.sessionId || 'local';
      this.spellStoragePrefix = `spell-autocast:${base}:`;
    }

    private refreshSpellAvailability(player: any, force = false) {
      if (!player) return;

      try {
        const derivedRaw = player?.derivedStats;
        let derived: any = null;
        if (typeof derivedRaw === 'string' && derivedRaw.trim().length > 0) {
          derived = JSON.parse(derivedRaw);
        } else if (derivedRaw && typeof derivedRaw === 'object') {
          derived = derivedRaw;
        }

        this.refreshSpellStoragePrefix(player);

        const activeSlug = this.resolveActiveWeaponSlug(derived, player);
        const weaponCategory = this.resolveWeaponCategoryFromSlug(activeSlug);

        const allowedSpells = SPELLS.filter((spell) => {
          if (spell.enabled === false) return false;
          if (
            !spell.allowedWeaponTypes ||
            spell.allowedWeaponTypes.length === 0
          ) {
            return true;
          }
          if (!weaponCategory) return false;
          return spell.allowedWeaponTypes.includes(weaponCategory);
        });

        const snapshot = allowedSpells.map((spell) => spell.id).join('|');
        if (!force && snapshot === this.spellDefinitionsSnapshot) {
          return;
        }

        this.spellDefinitionsSnapshot = snapshot;
        this.spellDefinitions = allowedSpells.slice();

        const allowedIds = new Set(allowedSpells.map((spell) => spell.id));
        for (const spellId of Array.from(this.spellAutocastMap.keys())) {
          if (!allowedIds.has(spellId)) {
            this.spellAutocastMap.delete(spellId);
            this.spellCooldowns.delete(spellId);
            this.pendingSpellAutocastUpdates.delete(spellId);
          }
        }

        for (const spell of allowedSpells) {
          if (!this.spellAutocastMap.has(spell.id)) {
            const defaultValue = this.loadSpellAutocastPreference(
              spell.id,
              spell.autocastEnabledByDefault ?? false
            );
            this.updateSpellAutocastInternal(spell.id, defaultValue, {
              notifyServer: true,
              persist: false,
            });
          }
        }

        this.emitSpellHudState(true);
        this.nextSpellHudEmitAt = Date.now() + 100;
      } catch (error) {
        console.warn('Failed to refresh spell availability', error);
      }
    }

    private updateSpellRuntimeFromPlayer(player: any) {
      const manaRaw = Number(player?.mana ?? 0);
      const maxManaRaw = Number(player?.maxMana ?? 0);
      const mana = Number.isFinite(manaRaw)
        ? Math.max(0, Math.floor(manaRaw))
        : 0;
      const maxMana = Number.isFinite(maxManaRaw)
        ? Math.max(0, Math.floor(maxManaRaw))
        : 0;

      if (mana === this.currentMana && maxMana === this.currentMaxMana) {
        return;
      }

      this.currentMana = mana;
      this.currentMaxMana = maxMana;
      this.emitSpellHudState(true);
    }

    private emitSpellHudState(force = false) {
      const now = Date.now();
      const spells: SpellHudEntry[] = this.spellDefinitions.map((spell) => {
        const cooldownMs = spell.cooldownMs ?? 0;
        const cooldownUntil = this.spellCooldowns.get(spell.id) ?? 0;
        const remainingMs = Math.max(0, cooldownUntil - now);
        const autocast = this.spellAutocastMap.get(spell.id);
        const insufficientMana =
          spell.manaCost > 0 && this.currentMana < spell.manaCost;
        return {
          id: spell.id,
          name: spell.name,
          description: spell.description,
          manaCost: spell.manaCost,
          cooldownMs,
          cooldownRemainingMs: remainingMs,
          isCoolingDown: remainingMs > 10,
          autocastEnabled: autocast ?? spell.autocastEnabledByDefault ?? false,
          insufficientMana,
          icon:
            typeof spell.icon === 'string' && spell.icon.length > 0
              ? spell.icon
              : undefined,
        };
      });

      const payload: SpellHudState = { spells };
      const serialized = JSON.stringify(payload);
      if (!force && serialized === this.spellHudStateSnapshot) {
        return;
      }

      this.spellHudStateSnapshot = serialized;
      this.spellHudState = payload;
      this.events.emit('spell:hud-update', payload);
    }

    private setupSpellSystem() {
      const player = this.getLocalPlayerState();
      if (player) {
        this.refreshSpellAvailability(player, true);
        this.updateSpellRuntimeFromPlayer(player);
      } else {
        this.emitSpellHudState(true);
      }
    }

    private handleSpellProcMessage(data: ServerToClientMessages['spell_proc']) {
      if (!data || data.playerId !== this.room?.sessionId) {
        return;
      }
      const spell = SPELLS_BY_ID[data.spellId];
      if (!spell) {
        return;
      }
      const cooldownMs = spell.cooldownMs ?? 0;
      if (cooldownMs > 0) {
        this.spellCooldowns.set(spell.id, Date.now() + cooldownMs);
      } else {
        this.spellCooldowns.delete(spell.id);
      }
      this.emitSpellHudState(true);
      this.nextSpellHudEmitAt = Date.now() + 100;

      try {
        const playerEntity = this.playerEntities[data.playerId];
        if (playerEntity) {
          this.spawnFloatingText(
            playerEntity.container ?? playerEntity,
            spell.name,
            {
              fontSize: '16px',
              color: '#60A5FA',
              fontStyle: 'bold',
            },
            { startY: -75, endY: -105, duration: 650 }
          );
        }
      } catch {}
    }

    private handleSpellCastResult(
      data: ServerToClientMessages['spell_cast_result']
    ) {
      if (!data || data.ok || !data.reason) {
        return;
      }
      if (data.reason === 'insufficient_mana') {
        try {
          const playerEntity = this.playerEntities[this.room?.sessionId ?? ''];
          if (playerEntity) {
            this.spawnFloatingText(
              playerEntity.container ?? playerEntity,
              'Not enough mana',
              { fontSize: '14px', color: '#ff6b6b', fontStyle: 'bold' },
              { startY: -70, endY: -90, duration: 600 }
            );
          }
        } catch {}
      }
    }

    private handleSpellAutocastResult(
      data: ServerToClientMessages['spell_autocast_result']
    ) {
      if (!data || !data.spellId) {
        return;
      }

      const normalized = data.spellId.trim();
      if (!normalized) {
        return;
      }

      const pending = this.pendingSpellAutocastUpdates.get(normalized);
      this.pendingSpellAutocastUpdates.delete(normalized);

      if (!data.ok) {
        if (pending) {
          this.updateSpellAutocastInternal(normalized, pending.previous, {
            notifyServer: false,
          });
        }
        return;
      }

      const resolvedEnabled =
        typeof data.enabled === 'boolean'
          ? data.enabled
          : (pending?.requested ??
            this.spellAutocastMap.get(normalized) ??
            false);

      this.updateSpellAutocastInternal(normalized, resolvedEnabled, {
        notifyServer: false,
      });
      this.nextSpellHudEmitAt = Date.now() + 100;
    }
    private emitGrenadeHudState(force = false) {
      const now = Date.now();
      const grenades: GrenadeHudEntry[] = this.grenadeDefinitions.map(
        (entry) => {
          const cooldown = this.grenadeCooldowns.get(entry.slug);
          const readyAt = cooldown?.readyAt ?? 0;
          const cooldownMs = cooldown?.cooldownMs ?? entry.grenade.cooldownMs;
          const remainingMs = Math.max(0, readyAt - now);
          const manaCost = Math.max(
            0,
            Math.floor(Number(entry.grenade.manaCost || 0))
          );
          const insufficientMana =
            manaCost > 0 && (this.currentMana || 0) < manaCost;
          return {
            slug: entry.slug,
            name: entry.name,
            svgId: entry.svgId,
            cooldownMs,
            readyAt,
            remainingMs,
            isCoolingDown: remainingMs > 10,
            maxRangePx: entry.grenade.maxRangePx ?? 1000,
            damageCenter: entry.grenade.damageCenter,
            damageEdge: entry.grenade.damageEdge,
            fuseMs: entry.grenade.fuseMs ?? 0,
            throwSpeedPxPerSec: entry.grenade.throwSpeedPxPerSec,
            healingSplash: entry.grenade.healingSplash,
            manaCost,
            insufficientMana,
          };
        }
      );

      const payload: GrenadeHudState = {
        grenades,
        armedGrenadeSlug: this.armedGrenadeSlug,
      };

      const serialized = JSON.stringify(payload);
      if (!force && serialized === this.grenadeHudStateSnapshot) {
        return;
      }

      this.grenadeHudStateSnapshot = serialized;
      this.nextGrenadeHudEmitAt = Date.now() + 100;
      this.events.emit('grenade:hud-update', payload);
    }

    private emitScoreHudUpdate(force = false) {
      if (!this.room) {
        return;
      }
      const playerState = this.getLocalPlayerState();
      if (!playerState) {
        return;
      }

      const payload = {
        score: Number.isFinite(playerState.score)
          ? Math.max(0, Math.floor(playerState.score))
          : 0,
        eligible: Boolean(playerState.scoreEligible),
      };

      const serialized = JSON.stringify(payload);
      if (!force && serialized === this.scoreHudSnapshot) {
        return;
      }

      this.scoreHudSnapshot = serialized;
      this.events.emit('score:update', payload);
    }

    private queueGrenadeTexture(entry: GrenadeDefinitionEntry) {
      const textureKey = `grenade-icon-${entry.svgId}`;
      this.grenadeTextureKeys.set(entry.slug, textureKey);
      if (this.textures.exists(textureKey)) {
        return;
      }

      this.load.svg(textureKey, `/wearables/${entry.svgId}.svg`, {
        scale: 0.6,
      });
      if (!this.load.isLoading()) {
        this.load.start();
      }
    }

    private handleLocalPlayerWearables(player: any) {
      if (!player) return;
      this.refreshWeaponHudStateFromPlayer(player);
      const signature = player.equippedWearables ?? '[]';
      const signatureChanged = signature !== this.grenadeWearablesSignature;
      if (signatureChanged) {
        this.grenadeWearablesSignature = signature;
        this.refreshGrenadeDefinitionsFromSignature(signature);
      }
      this.refreshSpellAvailability(player, signatureChanged);
      this.updateSpellRuntimeFromPlayer(player);
    }

    private setupGrenadeSystem() {
      if (!this.room) return;

      const players: any = this.room.state?.players;
      if (players) {
        players.onAdd((player: any, sessionId: string) => {
          if (sessionId === this.room!.sessionId) {
            this.refreshWeaponHudStateFromPlayer(player, true);
            this.handleLocalPlayerWearables(player);
            player.onChange(() => {
              this.handleLocalPlayerWearables(player);
            });
          }
        });

        const existing = players.get(this.room.sessionId);
        if (existing) {
          this.refreshWeaponHudStateFromPlayer(existing, true);
          this.handleLocalPlayerWearables(existing);
        }
      }

      this.input.mouse?.disableContextMenu();

      this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (!this.armedGrenadeSlug) return;
        this.updateGrenadeAimPointer(pointer);
      });

      this.input.keyboard?.on('keydown-ESC', () => {
        if (this.armedGrenadeSlug) {
          this.disarmGrenade();
        }
      });

      this.emitGrenadeHudState(true);
    }

    private setupScoreListeners() {
      if (!this.room) return;
      const players: any = this.room.state?.players;
      if (!players) return;

      const watchLocal = (player: any, sessionId: string) => {
        if (sessionId !== this.room!.sessionId) {
          return;
        }
        player.onChange((changes?: Array<{ field: string }>) => {
          if (Array.isArray(changes)) {
            const relevant = changes.some((change) =>
              change
                ? change.field === 'score' || change.field === 'scoreEligible'
                : false
            );
            if (!relevant) {
              return;
            }
          }
          this.emitScoreHudUpdate();
        });
        this.emitScoreHudUpdate(true);
      };

      players.onAdd(watchLocal);

      const existing = players.get(this.room.sessionId);
      if (existing) {
        watchLocal(existing, this.room.sessionId);
      }
    }

    getGrenadeHudState(): GrenadeHudState {
      const now = Date.now();
      const grenades: GrenadeHudEntry[] = this.grenadeDefinitions.map(
        (entry) => {
          const cooldown = this.grenadeCooldowns.get(entry.slug);
          const readyAt = cooldown?.readyAt ?? 0;
          const cooldownMs = cooldown?.cooldownMs ?? entry.grenade.cooldownMs;
          const remainingMs = Math.max(0, readyAt - now);
          const manaCost = Math.max(
            0,
            Math.floor(Number(entry.grenade.manaCost || 0))
          );
          const insufficientMana =
            manaCost > 0 && (this.currentMana || 0) < manaCost;
          return {
            slug: entry.slug,
            name: entry.name,
            svgId: entry.svgId,
            cooldownMs,
            readyAt,
            remainingMs,
            isCoolingDown: remainingMs > 10,
            maxRangePx: entry.grenade.maxRangePx ?? 1000,
            damageCenter: entry.grenade.damageCenter,
            damageEdge: entry.grenade.damageEdge,
            fuseMs: entry.grenade.fuseMs ?? 0,
            throwSpeedPxPerSec: entry.grenade.throwSpeedPxPerSec,
            healingSplash: entry.grenade.healingSplash,
            manaCost,
            insufficientMana,
          };
        }
      );

      return {
        grenades,
        armedGrenadeSlug: this.armedGrenadeSlug,
      };
    }

    getWeaponHudState(): WeaponHudState {
      const state = this.weaponHudState;
      if (!state) {
        return { weapons: [], activeIndex: -1 };
      }
      return {
        weapons: state.weapons.slice(),
        activeIndex:
          typeof state.activeIndex === 'number' ? state.activeIndex : -1,
      };
    }

    getScoreHudState(): ScoreHudState {
      const playerState = this.getLocalPlayerState();
      return {
        score:
          playerState && Number.isFinite(playerState.score)
            ? Math.max(0, Math.floor(playerState.score))
            : 0,
        eligible: playerState ? Boolean(playerState.scoreEligible) : true,
      };
    }

    private isGrenadeOnCooldown(slug: string): boolean {
      const info = this.grenadeCooldowns.get(slug);
      if (!info) return false;
      return Date.now() < info.readyAt;
    }

    private updateGrenadeCooldown(
      slug: string,
      readyAt: number,
      cooldownMs: number
    ) {
      this.grenadeCooldowns.set(slug, {
        readyAt,
        cooldownMs,
      });
      this.emitGrenadeHudState(true);
    }

    public armGrenade(slug: string | null): void {
      if (!slug) {
        this.disarmGrenade();
        return;
      }

      if (this.armedGrenadeSlug === slug) {
        this.disarmGrenade();
        return;
      }

      const definition = this.grenadeDefinitions.find(
        (entry) => entry.slug === slug
      );
      if (!definition) {
        console.warn(`🧨 Attempted to arm unknown grenade ${slug}`);
        this.disarmGrenade();
        return;
      }

      if (this.isGrenadeOnCooldown(slug)) {
        return;
      }

      this.armedGrenadeSlug = slug;
      this.ensureGrenadeRangeGraphics(definition.grenade.maxRangePx ?? 1000);
      if (this.input?.activePointer) {
        this.updateGrenadeAimPointer(this.input.activePointer);
      }
      this.emitGrenadeHudState(true);
    }

    public disarmGrenade(): void {
      if (!this.armedGrenadeSlug) return;
      this.armedGrenadeSlug = null;
      this.grenadeAimPointer = null;
      this.grenadeRangeGraphics?.destroy();
      this.grenadeRangeGraphics = null;
      this.grenadeTargetGraphics?.destroy();
      this.grenadeTargetGraphics = null;
      this.emitGrenadeHudState(true);
    }

    public castSpell(spellId: string, targetId?: string): void {
      if (!this.room) return;
      const normalized = typeof spellId === 'string' ? spellId.trim() : '';
      if (!normalized) return;

      if (
        this.spellDefinitions.length > 0 &&
        !this.spellDefinitions.some((spell) => spell.id === normalized)
      ) {
        return;
      }

      const payload: Record<string, unknown> = { spellId: normalized };
      const resolvedTarget =
        typeof targetId === 'string' && targetId.trim().length > 0
          ? targetId.trim()
          : (this.currentSelectedTargetId ?? undefined);
      if (resolvedTarget) {
        payload.targetId = resolvedTarget;
      }

      this.room.send('startAction', {
        type: 'cast_spell',
        targetId: resolvedTarget,
        payload,
      });
    }

    public setSpellAutocast(spellId: string, enabled: boolean): void {
      const normalized = typeof spellId === 'string' ? spellId.trim() : '';
      if (!normalized) return;
      this.updateSpellAutocastInternal(normalized, !!enabled, {
        notifyServer: true,
      });
    }

    private ensureGrenadeRangeGraphics(range: number) {
      let graphics: Phaser.GameObjects.Graphics | null =
        this.grenadeRangeGraphics;
      if (!graphics) {
        const created = this.add.graphics();
        created.setDepth(1200);
        created.setScrollFactor(1);
        this.registerMinimapIgnore(created);
        this.grenadeRangeGraphics = created;
        graphics = created;
      }
      const readyGraphics = this.grenadeRangeGraphics;
      if (!readyGraphics) return;
      readyGraphics.clear();
      readyGraphics.lineStyle(2, 0x66e0ff, 0.6);
      readyGraphics.strokeCircle(0, 0, range);
      this.updateGrenadeGraphicsPosition();
    }

    private drawGrenadeTargetIndicator() {
      if (!this.grenadeAimPointer) {
        this.grenadeTargetGraphics?.clear();
        return;
      }

      let targetGraphics: Phaser.GameObjects.Graphics | null =
        this.grenadeTargetGraphics;
      if (!targetGraphics) {
        const created = this.add.graphics();
        created.setDepth(1300);
        created.setScrollFactor(1);
        this.registerMinimapIgnore(created);
        this.grenadeTargetGraphics = created;
        targetGraphics = created;
      }

      const readyTargetGraphics = this.grenadeTargetGraphics;
      if (!readyTargetGraphics) return;
      const { x, y } = this.grenadeAimPointer;
      readyTargetGraphics.clear();
      readyTargetGraphics.lineStyle(2, 0xffffff, 0.85);
      readyTargetGraphics.strokeCircle(x, y, 12);
      readyTargetGraphics.lineBetween(x - 8, y, x + 8, y);
      readyTargetGraphics.lineBetween(x, y - 8, x, y + 8);
    }

    private updateGrenadeAimPointer(pointer: Phaser.Input.Pointer | undefined) {
      if (!pointer) return;
      if (!this.armedGrenadeSlug) return;
      const definition = this.grenadeDefinitions.find(
        (entry) => entry.slug === this.armedGrenadeSlug
      );
      if (!definition) return;

      const player = this.getLocalPlayerState();
      if (!player) return;

      const clamped = this.clampPointToGrenadeRange(
        pointer.worldX,
        pointer.worldY,
        player.x,
        player.y,
        definition.grenade.maxRangePx ?? 1000
      );

      this.grenadeAimPointer = { x: clamped.x, y: clamped.y };
      this.drawGrenadeTargetIndicator();
    }

    private clampPointToGrenadeRange(
      targetX: number,
      targetY: number,
      originX: number,
      originY: number,
      maxRange: number
    ) {
      const dx = targetX - originX;
      const dy = targetY - originY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!Number.isFinite(distance) || distance <= 0) {
        return { x: originX, y: originY, distance: 0 };
      }
      if (distance <= maxRange) {
        return { x: targetX, y: targetY, distance };
      }
      const ratio = maxRange / distance;
      return {
        x: originX + dx * ratio,
        y: originY + dy * ratio,
        distance: maxRange,
      };
    }

    private handleGrenadePointerDown(pointer: Phaser.Input.Pointer) {
      if (!this.armedGrenadeSlug || !this.room) return;

      if (pointer.button === 2) {
        this.disarmGrenade();
        return;
      }

      if (pointer.button !== 0) {
        return;
      }

      const definition = this.grenadeDefinitions.find(
        (entry) => entry.slug === this.armedGrenadeSlug
      );
      if (!definition) {
        this.disarmGrenade();
        return;
      }

      if (this.isGrenadeOnCooldown(this.armedGrenadeSlug)) {
        return;
      }

      const player = this.getLocalPlayerState();
      if (!player) return;

      const clamped = this.clampPointToGrenadeRange(
        pointer.worldX,
        pointer.worldY,
        player.x,
        player.y,
        definition.grenade.maxRangePx ?? 1000
      );

      this.room.send('startAction', {
        type: 'throw_grenade',
        payload: {
          wearableSlug: this.armedGrenadeSlug,
          target: { x: clamped.x, y: clamped.y },
        },
      });

      const localCooldown = definition.grenade.cooldownMs ?? 0;
      if (localCooldown > 0) {
        this.updateGrenadeCooldown(
          this.armedGrenadeSlug,
          Date.now() + localCooldown,
          localCooldown
        );
      }

      this.disarmGrenade();
    }

    private armGrenadeByIndex(index: number): void {
      const grenade = this.grenadeDefinitions[index];
      if (!grenade) return;
      this.armGrenade(grenade.slug);
    }

    private handleServerGrenadeThrown(data: GrenadeThrownMessage) {
      if (!data || !data.grenadeId) return;

      const isLocalPlayer = data.playerId === this.room?.sessionId;
      if (isLocalPlayer && data.wearableSlug) {
        const readyAt =
          (typeof data.timestamp === 'number' ? data.timestamp : Date.now()) +
          (data.cooldownMs ?? 0);
        this.updateGrenadeCooldown(
          data.wearableSlug,
          readyAt,
          data.cooldownMs ?? 0
        );
      }

      if (isLocalPlayer) {
        this.disarmGrenade();
      }

      const origin = data.origin || { x: 0, y: 0 };
      const target = data.target || origin;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      let direction = 'down';
      if (Math.abs(dx) > Math.abs(dy)) {
        direction = dx >= 0 ? 'right' : 'left';
      } else {
        direction = dy >= 0 ? 'down' : 'up';
      }
      const animDuration = Math.max(350, data.travelTimeMs || 0);
      // Lock animation to prevent premature idle resets from player_action_complete
      const lockKey = `animLock_${data.playerId}`;
      const existingLock = this.registry.get(lockKey);
      if (existingLock) {
        this.time.removeEvent(existingLock);
      }
      this.updatePlayerAnimation(
        data.playerId,
        'throw',
        direction,
        animDuration
      );
      if (animDuration > 0) {
        const timer = this.time.delayedCall(animDuration, () => {
          this.registry.set(lockKey, null);
          const p = this.room?.state.players.get(data.playerId);
          if (p) {
            this.updatePlayerAnimation(
              data.playerId,
              p.anim || 'idle',
              p.dir || 'down'
            );
          }
        });
        this.registry.set(lockKey, timer);
      }

      this.spawnGrenadeProjectile(data);
      // Play throw SFX when a grenade is launched
      this.playSFX('grenade_throw', 0.8);
    }

    private handleServerGrenadeExploded(data: GrenadeExplodedMessage) {
      if (!data) return;
      if (data.grenadeId) {
        this.clearGrenadeProjectile(data.grenadeId);
      }
      this.runGrenadeExplosionEffect(data);
    }

    private spawnGrenadeProjectile(data: GrenadeThrownMessage) {
      const origin = data.origin || { x: 0, y: 0 };
      const target = data.target || origin;
      const travelTime = Math.max(120, data.travelTimeMs || 0);
      const peakHeight = Math.max(32, (data.blastRadius ?? 80) * 0.3);

      const textureKey = data.wearableSlug
        ? this.grenadeTextureKeys.get(data.wearableSlug)
        : undefined;
      let sprite: Phaser.GameObjects.GameObject & {
        x: number;
        y: number;
      };

      if (textureKey && this.textures.exists(textureKey)) {
        const image = this.add.image(origin.x, origin.y, textureKey);
        image.setDepth(1400);
        image.setScrollFactor(1);
        image.setDisplaySize(24, 24);
        sprite = image;
      } else {
        const circle = this.add.circle(origin.x, origin.y, 8, 0xffd166, 0.9);
        circle.setDepth(1400);
        circle.setScrollFactor(1);
        sprite = circle;
      }

      this.grenadeProjectileSprites.set(
        data.grenadeId,
        sprite as Phaser.GameObjects.GameObject
      );

      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: travelTime,
        ease: 'Linear',
        onUpdate: (tween: Phaser.Tweens.Tween) => {
          const value = tween.getValue();
          const t = typeof value === 'number' ? value : 0;
          sprite.x = Phaser.Math.Linear(origin.x, target.x, t);
          sprite.y =
            Phaser.Math.Linear(origin.y, target.y, t) -
            Math.sin(Math.PI * t) * peakHeight;
        },
        onComplete: () => {
          sprite.x = target.x;
          sprite.y = target.y;
        },
      });
    }

    private clearGrenadeProjectile(grenadeId: string) {
      const obj = this.grenadeProjectileSprites.get(grenadeId);
      if (obj) {
        obj.destroy();
        this.grenadeProjectileSprites.delete(grenadeId);
      }
    }

    private runGrenadeExplosionEffect(data: GrenadeExplodedMessage) {
      const position = data.position || { x: 0, y: 0 };
      const radius = data.radius ?? 100;
      const effectType = data.effect || 'damage';
      const isHealing = effectType === 'healing';
      const fillColor = isHealing ? 0x4ade80 : 0xffe08a;
      const fillAlpha = isHealing ? 0.45 : 0.35;
      const circle = this.add.circle(
        position.x,
        position.y,
        Math.max(32, radius),
        fillColor,
        fillAlpha
      );
      circle.setDepth(1250);
      circle.setScrollFactor(1);

      this.tweens.add({
        targets: circle,
        alpha: 0,
        scale: isHealing ? 1.25 : 1.4,
        duration: isHealing ? 280 : 220,
        ease: 'Cubic.easeOut',
        onComplete: () => circle.destroy(),
      });

      if (isHealing) {
        this.playSFX('healsplash', 0.95);
      } else {
        this.cameras.main?.shake(140, 0.0025);
        // Play explosion SFX for damaging grenades
        this.playSFX('grenade_explode', 0.95);
      }
    }

    private updateGrenadeGraphicsPosition() {
      const player = this.getLocalPlayerState();
      if (!player) return;

      if (this.grenadeRangeGraphics) {
        this.grenadeRangeGraphics.setPosition(player.x, player.y);
      }

      this.drawGrenadeTargetIndicator();
    }

    setupEnemyDifficultyListeners() {
      if (!this.room || !this.room.state) return;
      const callback = this.config.onEnemyDifficultyUpdate;
      if (typeof callback !== 'function') {
        return;
      }

      const state: any = this.room.state;
      const fields = [
        'enemyDifficultyLevel',
        'enemyDifficultyNextAt',
        'enemyDifficultyEnabled',
      ];

      const dispatch = () => {
        const levelRaw = Number(state.enemyDifficultyLevel ?? 0);
        const nextRaw = Number(state.enemyDifficultyNextAt ?? 0);
        const enabled = Boolean(state.enemyDifficultyEnabled);
        callback({
          level: Number.isFinite(levelRaw)
            ? Math.max(0, Math.floor(levelRaw))
            : 0,
          nextAt: Number.isFinite(nextRaw) ? nextRaw : 0,
          enabled,
        });
      };

      dispatch();

      if (typeof state.listen === 'function') {
        for (const field of fields) {
          try {
            state.listen(field, () => dispatch());
          } catch (error) {
            if (process.env.NEXT_PUBLIC_DEBUG === '1') {
              console.warn('enemy difficulty listen failed', {
                field,
                error,
              });
            }
          }
        }
      }

      if (typeof state.onChange === 'function') {
        state.onChange((changes: any) => {
          if (!Array.isArray(changes)) {
            dispatch();
            return;
          }
          for (const change of changes) {
            if (fields.includes(change?.field)) {
              dispatch();
              break;
            }
          }
        });
      }
    }

    setupHuntedListeners() {
      if (!this.room || !this.room.state) return;
      const callback = this.config.onHuntedUpdate;
      if (typeof callback !== 'function') {
        return;
      }

      const state: any = this.room.state;
      const fields = [
        'huntedIntensityLevel',
        'huntedNextSpawnAt',
        'huntedEnabled',
      ];

      const dispatch = () => {
        const levelRaw = Number(state.huntedIntensityLevel ?? 0);
        const nextRaw = Number(state.huntedNextSpawnAt ?? 0);
        const enabled = Boolean(state.huntedEnabled);
        callback({
          intensityLevel: Number.isFinite(levelRaw)
            ? Math.max(0, Math.floor(levelRaw))
            : 0,
          nextSpawnAt: Number.isFinite(nextRaw) ? nextRaw : 0,
          enabled,
        });
      };

      dispatch();

      if (typeof state.listen === 'function') {
        for (const field of fields) {
          try {
            state.listen(field, () => dispatch());
          } catch (error) {
            if (process.env.NEXT_PUBLIC_DEBUG === '1') {
              console.warn('hunted listen failed', {
                field,
                error,
              });
            }
          }
        }
      }

      if (typeof state.onChange === 'function') {
        state.onChange((changes: any) => {
          if (!Array.isArray(changes)) {
            dispatch();
            return;
          }
          for (const change of changes) {
            if (fields.includes(change?.field)) {
              dispatch();
              break;
            }
          }
        });
      }
    }

    updatePathVisualization(player: any) {
      if (!this.pathGraphics || !player) return;

      // Clear previous path
      this.pathGraphics.clear();

      // Only draw path when debug mode is enabled
      const debugEnabled = (this as any).debugEnabled || false;
      if (!debugEnabled) return;

      // Only draw path for auto-walking players
      if (!player.isAutoWalking || !player.currentPath) return;

      try {
        // Parse the path from the player state
        const pathNodes = JSON.parse(player.currentPath);
        this.currentPath = pathNodes;

        if (pathNodes.length < 2) return;

        console.log(
          `🛤️ Drawing path with ${pathNodes.length} nodes, current index: ${player.pathIndex}`
        );

        // Draw the complete path
        this.drawCompletePath(pathNodes, player.pathIndex);

        // Draw current position and target
        this.drawPathMarkers(pathNodes, player);
      } catch (error) {
        console.error('❌ Error visualizing path:', error);
      }
    }

    drawCompletePath(pathNodes: any[], currentIndex: number) {
      if (pathNodes.length < 2) return;

      // Draw completed path (gray)
      this.pathGraphics.lineStyle(3, 0x888888, 0.8);
      for (let i = 0; i < Math.min(currentIndex, pathNodes.length - 1); i++) {
        const node = pathNodes[i];
        const nextNode = pathNodes[i + 1];
        this.pathGraphics.lineBetween(
          node.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          node.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          nextNode.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          nextNode.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2
        );
      }

      // Draw remaining path (bright blue)
      this.pathGraphics.lineStyle(4, 0x00aaff, 1.0);
      for (let i = currentIndex; i < pathNodes.length - 1; i++) {
        const node = pathNodes[i];
        const nextNode = pathNodes[i + 1];
        this.pathGraphics.lineBetween(
          node.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          node.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          nextNode.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          nextNode.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2
        );
      }

      // Draw path nodes as dots
      pathNodes.forEach((node: any, index: number) => {
        const x = node.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;
        const y = node.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2;

        if (index < currentIndex) {
          // Completed nodes (gray)
          this.pathGraphics.fillStyle(0x888888, 0.8);
        } else if (index === currentIndex) {
          // Current target node (bright green)
          this.pathGraphics.fillStyle(0x00ff00, 1.0);
        } else {
          // Future nodes (blue)
          this.pathGraphics.fillStyle(0x00aaff, 0.8);
        }

        this.pathGraphics.fillCircle(x, y, index === currentIndex ? 6 : 4);
      });
    }

    drawPathMarkers(pathNodes: any[], player: any) {
      // Draw start position (green circle)
      if (pathNodes.length > 0) {
        const startNode = pathNodes[0];
        this.pathGraphics.lineStyle(3, 0x00ff00, 1.0);
        this.pathGraphics.strokeCircle(
          startNode.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          startNode.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          10
        );
      }

      // Draw end position (red circle)
      if (pathNodes.length > 1) {
        const endNode = pathNodes[pathNodes.length - 1];
        this.pathGraphics.lineStyle(3, 0xff0000, 1.0);
        this.pathGraphics.strokeCircle(
          endNode.x * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          endNode.y * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
          10
        );
      }

      // Draw player current position (yellow circle)
      this.pathGraphics.lineStyle(2, 0xffff00, 1.0);
      this.pathGraphics.strokeCircle(player.x, player.y, 8);
    }

    setupRoomHandlers() {
      console.log('Setting up room handlers...');
      if (!this.room) return;

      // Silence common preview-only messages
      const noop = () => {};
      this.room.onMessage('weapon_switched', noop);
      this.room.onMessage('enemy_damaged', noop);
      this.room.onMessage('player_died', noop);

      this.room.onMessage(
        'damage_applied',
        (payload: ServerToClientMessages['damage_applied']) => {
          if (!payload || payload.attackerId !== this.room?.sessionId) return;
          const container = this.enemyEntities[payload.targetId];
          if (!container) return;
          this.spawnFloatingText(
            container,
            `-${payload.damage}`,
            {
              fontSize: '16px',
              color: '#f87171',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 3,
            },
            {
              startY: -70,
              endY: -100,
              duration: 650,
            }
          );
        }
      );

      this.room.onMessage(
        'chain_hit',
        (data: ServerToClientMessages['chain_hit']) => {
          if (!data || data.playerId !== this.room?.sessionId) return;
          const target = this.enemyEntities[data.toId];
          if (!target) return;
          // Visual bounce indicator only; damage numbers arrive via damage_applied
          this.spawnFloatingText(
            target,
            '↯',
            {
              fontSize: '18px',
              color: '#60A5FA',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 3,
            },
            {
              startY: -60,
              endY: -95,
              duration: 450,
            }
          );
        }
      );

      this.room.onMessage(
        'fog_state',
        (payload: ServerToClientMessages['fog_state']) => {
          if (!FOG_OF_WAR_ENABLED) return;
          this.fogOfWarSystem?.applyState(payload);
        }
      );

      this.room.onMessage(
        'fog_reveal',
        (payload: ServerToClientMessages['fog_reveal']) => {
          if (!FOG_OF_WAR_ENABLED) return;
          if (Array.isArray(payload.tiles)) {
            this.fogOfWarSystem?.applyReveal(payload.tiles);
          }
        }
      );

      this.room.onMessage('grenade_thrown', (data: GrenadeThrownMessage) => {
        this.handleServerGrenadeThrown(data);
      });

      this.room.onMessage(
        'grenade_exploded',
        (data: GrenadeExplodedMessage) => {
          this.handleServerGrenadeExploded(data);
        }
      );

      this.room.onMessage(
        'progression:profile',
        (data: ProgressionProfileMessage) => {
          if (data?.profile) {
            this.currentProgressionProfile = data.profile;
          }
          this.config.onProgressionProfile?.(data);
        }
      );

      this.room.onMessage(
        'progression:xp_awarded',
        (data: ProgressionXpAwardMessage) => {
          try {
            const ups = Number((data as any)?.levelUps || 0);
            if (Number.isFinite(ups) && ups > 0) {
              this.playSFX('playerlevelup', 0.9);
            }
          } catch {}
          this.config.onProgressionXpAward?.(data);
          this.onProgressionXpAward(data);
        }
      );

      this.room.onMessage(
        'progression:level_lost',
        (data: ProgressionLevelLostMessage) => {
          this.config.onProgressionLevelLost?.(data);
        }
      );

      this.room.onMessage(
        'kill_streak:profile',
        (data: KillStreakProfileMessage) => {
          this.config.onKillStreakProfile?.(data);
        }
      );

      this.room.onMessage(
        'kill_streak:updated',
        (data: KillStreakUpdatedMessage) => {
          this.config.onKillStreakUpdated?.(data);
        }
      );

      this.room.onMessage(
        'kill_streak:reset',
        (data: KillStreakResetMessage) => {
          this.config.onKillStreakReset?.(data);
        }
      );

      this.room.onMessage('boss_special_state', (data: any) => {
        this.handleBossSpecialStateMessage(data);
      });

      // Entered Boss Room: switch to boss theme immediately
      this.room.onMessage(
        'entered_boss_room',
        (_payload: ServerToClientMessages['entered_boss_room']) => {
          // Start boss theme immediately; fade out current theme only
          this.switchMusicNoFadeInFadeOutCurrent('boss1', 1200);
        }
      );

      // Boss defeated: switch to victory theme with cross-fade
      // For Portal Guardian, delay until 'boss_loot_ready'
      this.room.onMessage(
        'boss_room_cleared',
        (payload: ServerToClientMessages['boss_room_cleared']) => {
          if (!payload || payload.enemyType !== 'portal_guardian') {
            this.crossFadeBackgroundMusic('victory1', 1200);
          }
        }
      );
      this.room.onMessage(
        'boss_loot_ready',
        (_payload: ServerToClientMessages['boss_loot_ready']) => {
          this.crossFadeBackgroundMusic('victory1', 1200);
        }
      );

      this.room.onMessage(
        'spell_proc',
        (data: ServerToClientMessages['spell_proc']) => {
          this.handleSpellProcMessage(data);
        }
      );

      this.room.onMessage(
        'spell_cast_result',
        (data: ServerToClientMessages['spell_cast_result']) => {
          this.handleSpellCastResult(data);
        }
      );

      this.room.onMessage(
        'spell_autocast_result',
        (data: ServerToClientMessages['spell_autocast_result']) => {
          this.handleSpellAutocastResult(data);
        }
      );
    }

    protected onProgressionXpAward(_data: ProgressionXpAwardMessage): void {
      // Default implementation is a no-op; subclasses can override.
    }

    public syncProgressionProfile(profile?: ProgressionProfile | null) {
      if (profile) {
        this.currentProgressionProfile = profile;
      }

      const payload =
        this.currentProgressionProfile || this.config.progressionProfile;

      if (!payload || !this.room) {
        return;
      }

      try {
        const serialized = JSON.parse(JSON.stringify(payload));
        this.room.send('progression_sync', { profile: serialized });
      } catch (error) {
        console.warn('Failed to sync progression profile', error);
      }
    }

    public updateProgressionProfile(profile: ProgressionProfile) {
      this.config.progressionProfile = profile;
      this.syncProgressionProfile(profile);
    }

    setupClickToMove() {
      console.log('🎮 Setting up click-to-move handler');

      // Enable pointer events on the entire scene
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (this.armedGrenadeSlug) {
          this.handleGrenadePointerDown(pointer);
          return;
        }

        console.log('👆 Pointer down detected:', {
          x: pointer.x,
          y: pointer.y,
          worldX: pointer.worldX,
          worldY: pointer.worldY,
          button: pointer.button,
        });

        // Get world coordinates from the pointer
        const worldX = pointer.worldX;
        const worldY = pointer.worldY;

        // Check if click was on UI elements by checking if pointer is over any interactive objects
        const objectsUnderPointer = this.input.hitTestPointer(pointer);
        console.log('🔍 Objects under pointer:', objectsUnderPointer.length);

        let hasBlockingObjects = false;
        let hasObstacleObjects = false;

        objectsUnderPointer.forEach((obj: any) => {
          const isInteractive = obj.input && obj.input.enabled;
          if (isInteractive) {
            const objName = obj.name || obj.constructor.name || 'Unknown';
            console.log('🎯 Found interactive object:', objName);

            // Check if it's an obstacle (tree, stone) vs other interactive objects (enemies)
            if (
              objName.includes('tree') ||
              objName.includes('stone') ||
              objName.includes('Tree') ||
              objName.includes('Stone')
            ) {
              hasObstacleObjects = true;
              console.log('🪨 Detected obstacle object:', objName);
            } else {
              hasBlockingObjects = true;
              console.log(
                '⚔️ Detected blocking object (enemy/other):',
                objName
              );
            }
          }
        });

        console.log('❓ Has blocking objects:', hasBlockingObjects);
        console.log('🪨 Has obstacle objects:', hasObstacleObjects);
        console.log('🏠 Room connected:', !!this.room);

        // Send move command only if clicking on a floor tile and no blocking objects
        const isOnFloor = this.environmentSystem?.isFloorAtWorldXY(
          worldX,
          worldY
        );

        if (!hasBlockingObjects && this.room && isOnFloor) {
          if (hasObstacleObjects) {
            console.log(
              `🪨 Sending click-to-move for obstacle: ${worldX}, ${worldY}`
            );
          } else {
            console.log(
              `🎯 Sending click-to-move command: ${worldX}, ${worldY}`
            );
          }

          // Create click animation at the target location
          this.createClickAnimation(worldX, worldY);

          // Immediate click SFX for user feedback on each valid click-to-move
          this.playSFX('clicksound', 0.6);

          this.room.send('moveTo', { x: worldX, y: worldY });
        } else {
          console.log('❌ Click-to-move blocked:', {
            hasBlockingObjects,
            hasObstacleObjects,
            roomConnected: !!this.room,
            isOnFloor: !!isOnFloor,
          });
        }
      });
    }

    /**
     * Create a click animation at the specified world coordinates
     */
    createClickAnimation(worldX: number, worldY: number) {
      // Create a graphics object for the click indicator
      const clickIndicator = this.add.graphics();
      clickIndicator.setDepth(1000); // High depth to appear above everything
      this.registerMinimapIgnore(clickIndicator);

      // Animation state object
      const animState = { scale: 0.8, alpha: 1.0 };

      // Draw a circle with expanding rings
      const drawClickIndicator = () => {
        clickIndicator.clear();

        // Outer ring
        clickIndicator.lineStyle(3, 0x00ff00, animState.alpha * 0.8);
        clickIndicator.strokeCircle(worldX, worldY, 25 * animState.scale);

        // Inner ring
        clickIndicator.lineStyle(2, 0xffffff, animState.alpha);
        clickIndicator.strokeCircle(worldX, worldY, 15 * animState.scale);

        // Center dot
        clickIndicator.fillStyle(0x00ff00, animState.alpha);
        clickIndicator.fillCircle(worldX, worldY, 4 * animState.scale);
      };

      // Initial draw
      drawClickIndicator();

      // Store in our array for cleanup
      this.clickIndicators.push(clickIndicator);

      // Create expanding animation
      this.tweens.add({
        targets: animState,
        scale: 1.8,
        alpha: 0,
        duration: 2000,
        ease: 'Power2.easeOut',
        onUpdate: () => {
          drawClickIndicator();
        },
        onComplete: () => {
          // Clean up
          const index = this.clickIndicators.indexOf(clickIndicator);
          if (index > -1) {
            this.clickIndicators.splice(index, 1);
          }
          clickIndicator.destroy();
        },
      });
    }

    setupCollisionDebug() {
      console.log('🔍 Setting up collision zone debugging');

      // Check if input system is available
      if (!this.input) {
        console.warn(
          '⚠️ Input system not ready, skipping collision debug setup'
        );
        return;
      }

      try {
        // Create a graphics object for drawing collision zones
        const debugGraphics = this.add.graphics();
        debugGraphics.setDepth(1000); // Render on top
        debugGraphics.setScrollFactor(1); // Follow camera
        this.registerMinimapIgnore(debugGraphics);

        // Store reference for updating
        (this as any).debugGraphics = debugGraphics;
        (this as any).debugEnabled = false; // Start disabled, B key will enable

        // Draw collision zones every frame
        this.events.on('postupdate', () => {
          this.updateCollisionDebug();
        });

        console.log(
          '✅ Collision zone debugging system ready (Press B to toggle)'
        );
      } catch (error) {
        console.error('❌ Failed to setup collision debugging:', error);
      }
    }

    updateCollisionDebug() {
      const debugGraphics = (this as any).debugGraphics;
      const debugEnabled = (this as any).debugEnabled || false;

      if (!debugGraphics || !debugEnabled) return;

      debugGraphics.clear();

      // Update aggro range graphics
      this.updateAggroRangeGraphics();

      // Update vacuum radius graphics
      this.updateVacuumRadiusGraphics();

      // Count interactive objects
      let interactiveCount = 0;
      let totalCount = 0;

      // Draw interactive object bounds
      this.children.list.forEach((child: any) => {
        totalCount++;
        if (child.input && child.input.enabled) {
          interactiveCount++;
          const bounds = child.getBounds();

          // Different colors for different object types
          let color = 0x00ff00; // Green for default
          const name = child.name || child.constructor.name || '';

          if (name.includes('tree') || name.includes('Tree')) {
            color = 0x00ff00; // Green for trees
          } else if (name.includes('stone') || name.includes('Stone')) {
            color = 0x888888; // Gray for stones
          } else if (name.includes('enemy') || name.includes('Enemy')) {
            color = 0xff0000; // Red for enemies
          } else if (name.includes('treasure') || name.includes('chest')) {
            color = 0xffff00; // Yellow for chests
          }

          // Draw collision box with thick, visible lines
          debugGraphics.lineStyle(4, color, 1.0); // Thick, fully opaque
          debugGraphics.strokeRect(
            bounds.x - 2,
            bounds.y - 2,
            bounds.width + 4,
            bounds.height + 4
          );

          // Draw semi-transparent fill
          debugGraphics.fillStyle(color, 0.15);
          debugGraphics.fillRect(
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height
          );

          // Draw large center point
          debugGraphics.fillStyle(color, 1);
          debugGraphics.fillCircle(bounds.centerX, bounds.centerY, 6);

          // Add label
          if (!child._debugLabel) {
            child._debugLabel = this.add
              .text(bounds.centerX, bounds.y - 10, name, {
                fontSize: '10px',
                color: '#ffffff',
                backgroundColor: '#000000',
                padding: { x: 2, y: 1 },
              })
              .setOrigin(0.5, 1)
              .setDepth(1001);
          }
        }
      });

      // Log debug info every few seconds
      if (
        (this as any).lastDebugLog === undefined ||
        Date.now() - (this as any).lastDebugLog > 3000
      ) {
        console.log(
          `🔍 Debug update: ${interactiveCount} interactive objects out of ${totalCount} total objects`
        );
        (this as any).lastDebugLog = Date.now();
      }

      // Always draw tile grid overlay
      this.drawTileGrid(debugGraphics);

      // Draw a test rectangle to verify graphics are working
      debugGraphics.lineStyle(3, 0xff00ff, 1); // Bright magenta
      debugGraphics.strokeRect(50, 50, 100, 100);
      debugGraphics.fillStyle(0xff00ff, 0.1);
      debugGraphics.fillRect(50, 50, 100, 100);
    }

    toggleCollisionDebug() {
      const debugEnabled = (this as any).debugEnabled || false;
      (this as any).debugEnabled = !debugEnabled;

      console.log(
        `🔍 Debug mode ${debugEnabled ? 'DISABLED' : 'ENABLED'} (Press B to toggle)`
      );

      if (!(this as any).debugEnabled) {
        // Clear all debug elements when disabling debug

        // Clear debug graphics (collision zones, tile grid, test rectangles)
        const debugGraphics = (this as any).debugGraphics;
        if (debugGraphics) {
          debugGraphics.clear();
        }

        // Clear path graphics
        if (this.pathGraphics) {
          this.pathGraphics.clear();
        }

        // Clear test rectangle
        if (this.testRect) {
          this.testRect.setVisible(false);
        }

        // Clear interactive object rectangles
        this.interactiveObjectRects.forEach((rect) => {
          if (rect && rect.setVisible) {
            rect.setVisible(false);
          }
        });

        // Clear debug instruction text
        if (this.debugInstructionText) {
          this.debugInstructionText.setVisible(false);
        }

        // Hide player aggro range
        if (this.aggroRangeGraphics) {
          this.aggroRangeGraphics.clear();
          this.aggroRangeGraphics.setVisible(false);

          // Clean up aggro range label
          if (this.aggroRangeGraphics._aggroLabel) {
            this.aggroRangeGraphics._aggroLabel.destroy();
            this.aggroRangeGraphics._aggroLabel = null;
          }
        }

        // Hide vacuum radius
        if (this.vacuumRadiusGraphics) {
          this.vacuumRadiusGraphics.clear();
          this.vacuumRadiusGraphics.setVisible(false);

          // Clean up vacuum radius label
          if (this.vacuumRadiusGraphics._vacuumLabel) {
            this.vacuumRadiusGraphics._vacuumLabel.destroy();
            this.vacuumRadiusGraphics._vacuumLabel = null;
          }
        }

        // Hide enemy debug auras and range text using EntityManager
        if (this.entityManager) {
          Object.keys(this.enemyEntities).forEach((enemyId) => {
            const aggroAura = this.entityManager?.getEntityElement(
              enemyId,
              'aggroAura'
            );
            const attackAura = this.entityManager?.getEntityElement(
              enemyId,
              'attackAura'
            );
            const rangeText = this.entityManager?.getEntityElement(
              enemyId,
              'rangeText'
            );
            const attackTypeText = this.entityManager?.getEntityElement(
              enemyId,
              'attackTypeText'
            );

            if (aggroAura) aggroAura.setVisible(false);
            if (attackAura) attackAura.setVisible(false);
            if (rangeText) rangeText.setVisible(false);
            if (attackTypeText) attackTypeText.setVisible(false);
          });
        }

        // Clear debug labels
        this.children.list.forEach((child: any) => {
          if (child._debugLabel) {
            child._debugLabel.destroy();
            child._debugLabel = null;
          }
        });

        console.log('🔍 All debug elements hidden');
      } else {
        // Enable all debug elements when enabling debug

        // Show test rectangle
        if (this.testRect) {
          this.testRect.setVisible(true);
        }

        // Show interactive object rectangles
        this.interactiveObjectRects.forEach((rect) => {
          if (rect && rect.setVisible) {
            rect.setVisible(true);
          }
        });

        // Show debug instruction text
        if (this.debugInstructionText) {
          this.debugInstructionText.setVisible(true);
        }

        // Show player aggro range
        this.createAggroRangeGraphics();

        // Show vacuum radius
        this.createVacuumRadiusGraphics();

        // Show enemy debug auras and range text using EntityManager
        if (this.entityManager) {
          Object.keys(this.enemyEntities).forEach((enemyId) => {
            const aggroAura = this.entityManager?.getEntityElement(
              enemyId,
              'aggroAura'
            ) as Phaser.GameObjects.Graphics;
            const attackAura = this.entityManager?.getEntityElement(
              enemyId,
              'attackAura'
            ) as Phaser.GameObjects.Graphics;
            const rangeText = this.entityManager?.getEntityElement(
              enemyId,
              'rangeText'
            ) as Phaser.GameObjects.Text;
            const attackTypeText = this.entityManager?.getEntityElement(
              enemyId,
              'attackTypeText'
            ) as Phaser.GameObjects.Text;

            if (aggroAura) aggroAura.setVisible(true);
            if (attackAura) attackAura.setVisible(true);
            if (rangeText) rangeText.setVisible(true);
            if (attackTypeText) attackTypeText.setVisible(true);
          });
        }

        console.log('🔍 All debug elements shown');
      }
    }

    // Auto-attack toggle removed; auto-attack remains always enabled

    spawnTestItems() {
      if (!this.room) return;

      console.log('🎁 Requesting test items spawn from server... (Press T)');
      this.room.send('spawnTestItems');

      // Show current sprite count for performance monitoring
      const currentItemCount = Object.keys(this.droppedItemEntities).length;
      console.log(`📊 Current item sprites: ${currentItemCount}`);

      // Show status message in game
      const statusText = this.add
        .text(
          this.cameras.main.centerX,
          this.cameras.main.centerY - 50,
          'Spawning 100 Test Items!',
          {
            fontSize: '24px',
            color: '#00ff88',
            backgroundColor: '#000000',
            padding: { x: 8, y: 4 },
          }
        )
        .setOrigin(0.5)
        .setDepth(2000)
        .setScrollFactor(0); // Stay fixed to camera

      // Auto-remove the status text after 3 seconds
      this.time.delayedCall(3000, () => {
        if (statusText) {
          statusText.destroy();
        }
      });
    }

    clearTestItems() {
      if (!this.room) return;

      console.log('🧹 Requesting test items cleanup from server... (Press C)');
      this.room.send('clearTestItems');

      // Also kill all item bounce animations on client for immediate performance improvement
      for (const itemId in this.droppedItemEntities) {
        const item = this.droppedItemEntities[itemId];
        if (item && item.sprite) {
          this.tweens.killTweensOf(item.sprite);
        }
      }
      console.log('🛑 Killed all item bounce animations for performance');

      // Show status message in game
      const statusText = this.add
        .text(
          this.cameras.main.centerX,
          this.cameras.main.centerY - 50,
          'Clearing Test Items!',
          {
            fontSize: '24px',
            color: '#ff6666',
            backgroundColor: '#000000',
            padding: { x: 8, y: 4 },
          }
        )
        .setOrigin(0.5)
        .setDepth(2000)
        .setScrollFactor(0); // Stay fixed to camera

      // Auto-remove the status text after 2 seconds
      this.time.delayedCall(2000, () => {
        if (statusText) {
          statusText.destroy();
        }
      });
    }

    spawnTestEnemies() {
      if (!this.room) return;

      console.log('👹 Requesting test enemies spawn from server... (Press E)');
      this.room.send('spawnTestEnemies', { count: 20 });

      // Show current enemy count for performance monitoring
      const currentEnemyCount = Object.keys(this.enemyEntities).length;
      console.log(`📊 Current enemy sprites: ${currentEnemyCount}`);

      // Show status message in game
      const statusText = this.add
        .text(
          this.cameras.main.centerX,
          this.cameras.main.centerY - 50,
          'Spawning 20 Test Enemies!',
          {
            fontSize: '24px',
            color: '#ff8800',
            backgroundColor: '#000000',
            padding: { x: 8, y: 4 },
          }
        )
        .setOrigin(0.5)
        .setDepth(2000)
        .setScrollFactor(0); // Stay fixed to camera

      // Auto-remove the status text after 3 seconds
      this.time.delayedCall(3000, () => {
        if (statusText) {
          statusText.destroy();
        }
      });
    }

    createAggroRangeGraphics() {
      // Create or update the aggro range graphics
      if (!this.aggroRangeGraphics) {
        this.aggroRangeGraphics = this.add.graphics();
        this.aggroRangeGraphics.setDepth(999); // Render below other debug elements
        this.aggroRangeGraphics.setScrollFactor(1); // Follow camera
      }

      // The actual drawing will be done in updateCollisionDebug
      this.aggroRangeGraphics.setVisible(true);
    }

    createVacuumRadiusGraphics() {
      // Create or update the vacuum radius graphics
      if (!this.vacuumRadiusGraphics) {
        this.vacuumRadiusGraphics = this.add.graphics();
        this.vacuumRadiusGraphics.setDepth(998); // Render below aggro graphics
        this.vacuumRadiusGraphics.setScrollFactor(1); // Follow camera
      }

      // The actual drawing will be done in updateVacuumRadiusGraphics
      this.vacuumRadiusGraphics.setVisible(true);
    }

    /**
     * Get vacuum radius for current player based on character stats
     */
    getPlayerVacuumRadius(): number {
      const currentPlayerData = this.room?.state.players.get(
        this.room.sessionId
      );

      // Use character-specific vacuum radius if available, otherwise default
      if (currentPlayerData?.characterId) {
        const characterStats = getCharacterStats(currentPlayerData.characterId);
        return characterStats.vacuumRadius;
      }

      // Fallback to default if no character ID
      return 100;
    }

    /**
     * Get attack range for current player based on server-derived stats when available.
     * Falls back to character base stats, then to hard defaults.
     */
    getPlayerAttackRange(): number {
      const currentPlayerData = this.room?.state.players.get(
        this.room.sessionId
      );
      const weaponType = this.weaponMode as 'melee' | 'ranged';

      // 1) Prefer server-derived stats attached to the player (authoritative)
      try {
        const raw = (currentPlayerData as any)?.derivedStats;
        if (typeof raw === 'string' && raw.length > 0) {
          const ds = JSON.parse(raw);
          const fromDerived =
            weaponType === 'ranged'
              ? Number(ds?.rangedAttackRange)
              : Number(ds?.meleeAttackRange);
          if (Number.isFinite(fromDerived) && fromDerived > 0) {
            return Math.floor(fromDerived);
          }
        }
      } catch {}

      // 2) Fallback to character base stats
      if (currentPlayerData?.characterId) {
        const attackRange = getAttackRange(
          currentPlayerData.characterId,
          weaponType
        );
        if (Number.isFinite(attackRange) && attackRange > 0) {
          return Math.floor(attackRange);
        }
      }

      // 3) Hard defaults
      return weaponType === 'melee' ? 80 : 110;
    }

    updateAggroRangeGraphics() {
      // Return early if debug is not enabled
      if (!(this as any).debugEnabled) return;

      // Create graphics object if it doesn't exist
      if (!this.aggroRangeGraphics) {
        this.aggroRangeGraphics = this.add.graphics();
        this.aggroRangeGraphics.setDepth(999);
        this.aggroRangeGraphics.setScrollFactor(1);
        this.registerMinimapIgnore(this.aggroRangeGraphics);
      }

      const currentPlayer = this.room
        ? this.playerEntities[this.room.sessionId]
        : null;
      if (!currentPlayer) return;

      this.aggroRangeGraphics.clear();

      // Debug graphics are now only for enemy aggro ranges and auto-attack status

      // Highlight current auto-attack target if any
      if (
        this.currentAutoTarget &&
        this.enemyEntities[this.currentAutoTarget]
      ) {
        const target = this.enemyEntities[this.currentAutoTarget];
        this.aggroRangeGraphics.lineStyle(3, 0xff0000, 1.0); // Red highlight
        this.aggroRangeGraphics.strokeCircle(target.x, target.y, 20);
      }

      // Add auto-attack status label
      const attackRange = this.getPlayerAttackRange();
      const labelY = currentPlayer.y - 60;
      const statusText = this.autoAttackEnabled ? 'ON' : 'OFF';
      const statusColor = this.autoAttackEnabled ? '#00ff00' : '#ff0000';
      const labelText = `Auto-Attack: ${statusText} | Range: ${Math.round(attackRange)}px`;

      if (!this.aggroRangeGraphics._aggroLabel) {
        this.aggroRangeGraphics._aggroLabel = this.add
          .text(currentPlayer.x, labelY, labelText, {
            fontSize: '12px',
            color: statusColor,
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(1001);
        this.registerMinimapIgnore(this.aggroRangeGraphics._aggroLabel);
      } else {
        this.aggroRangeGraphics._aggroLabel.setPosition(
          currentPlayer.x,
          labelY
        );
        this.aggroRangeGraphics._aggroLabel.setText(labelText);
        this.aggroRangeGraphics._aggroLabel.setColor(statusColor);
      }
    }

    updateVacuumRadiusGraphics() {
      // Return early if debug is not enabled
      if (!(this as any).debugEnabled) return;

      // Create graphics object if it doesn't exist
      if (!this.vacuumRadiusGraphics) {
        this.vacuumRadiusGraphics = this.add.graphics();
        this.vacuumRadiusGraphics.setDepth(998);
        this.vacuumRadiusGraphics.setScrollFactor(1);
        this.registerMinimapIgnore(this.vacuumRadiusGraphics);
      }

      const currentPlayer = this.room
        ? this.playerEntities[this.room.sessionId]
        : null;
      if (!currentPlayer) return;

      this.vacuumRadiusGraphics.clear();

      // Draw vacuum radius circle
      const vacuumRadius = this.getPlayerVacuumRadius();
      this.vacuumRadiusGraphics.lineStyle(2, 0x9966ff, 0.6); // Purple with transparency
      this.vacuumRadiusGraphics.strokeCircle(
        currentPlayer.x,
        currentPlayer.y,
        vacuumRadius
      );

      // Add subtle fill
      this.vacuumRadiusGraphics.fillStyle(0x9966ff, 0.1);
      this.vacuumRadiusGraphics.fillCircle(
        currentPlayer.x,
        currentPlayer.y,
        vacuumRadius
      );

      // Add vacuum radius label
      const labelY = currentPlayer.y + 70; // Position below player
      const labelText = `Vacuum Radius: ${Math.round(vacuumRadius)}px`;

      if (!this.vacuumRadiusGraphics._vacuumLabel) {
        this.vacuumRadiusGraphics._vacuumLabel = this.add
          .text(currentPlayer.x, labelY, labelText, {
            fontSize: '12px',
            color: '#9966ff',
            backgroundColor: '#000000',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(1001);
        this.registerMinimapIgnore(this.vacuumRadiusGraphics._vacuumLabel);
      } else {
        this.vacuumRadiusGraphics._vacuumLabel.setPosition(
          currentPlayer.x,
          labelY
        );
        this.vacuumRadiusGraphics._vacuumLabel.setText(labelText);
      }
    }

    createInteractiveObjectRectangles() {
      console.log(
        '🎯 Creating colored rectangles around ALL interactive objects...'
      );

      // Clear existing interactive object rectangles
      this.interactiveObjectRects.forEach((rect) => {
        if (rect && rect.destroy) {
          rect.destroy();
        }
      });
      this.interactiveObjectRects = [];

      let rectangleCount = 0;
      this.children.list.forEach((child: any, index: number) => {
        if (child.input && child.input.enabled) {
          const bounds = child.getBounds();
          const name = child.name || child.constructor.name || '';

          // Determine color based on object type
          let color = 0x00ffff; // Cyan for unknown
          if (name.includes('tree') || name.includes('Tree')) {
            color = 0x00ff00; // Green for trees
          } else if (name.includes('stone') || name.includes('Stone')) {
            color = 0x888888; // Gray for stones
          } else if (name.includes('enemy') || name.includes('Enemy')) {
            color = 0xff0000; // Red for enemies
          } else if (name.includes('treasure') || name.includes('chest')) {
            color = 0xffff00; // Yellow for chests
          } else if (name.includes('Image')) {
            color = 0x00ff00; // Default green for Image objects (likely trees/stones)
          }

          // Create a rectangle around the object
          const debugRect = this.add.rectangle(
            bounds.centerX,
            bounds.centerY,
            bounds.width + 6,
            bounds.height + 6,
            color,
            0.15 // Semi-transparent fill
          );

          // Add thick border
          debugRect.setStrokeStyle(3, color);
          debugRect.setDepth(1000); // Render on top
          debugRect.setScrollFactor(1); // Follow camera
          debugRect.setVisible(false); // Start hidden, B key will show

          // Store reference for cleanup
          this.interactiveObjectRects.push(debugRect);

          rectangleCount++;
        }
      });

      console.log(
        `✅ Created ${rectangleCount} collision zone rectangles around interactive objects!`
      );

      // Update the instructions
      if (rectangleCount > 0) {
        this.debugInstructionText = this.add
          .text(
            this.cameras.main.centerX,
            90,
            `🎯 ${rectangleCount} collision zones now visible! Green=Trees, Gray=Stones, Red=Enemies`,
            {
              fontSize: '12px',
              color: '#ffffff',
              backgroundColor: '#000000',
              padding: { x: 4, y: 2 },
            }
          )
          .setOrigin(0.5)
          .setDepth(1600);
        if (this.debugInstructionText) {
          this.debugInstructionText.setVisible(false); // Start hidden, B key will show
        }
      }
    }

    drawTileGrid(graphics: any) {
      const tileSize = GAME_CONFIG.TILE_SIZE;
      const camera = this.cameras.main;

      // Calculate visible area
      const startX = Math.floor(camera.scrollX / tileSize) * tileSize;
      const startY = Math.floor(camera.scrollY / tileSize) * tileSize;
      const endX = startX + camera.width + tileSize;
      const endY = startY + camera.height + tileSize;

      // Draw grid lines
      graphics.lineStyle(1, 0x444444, 0.3);

      // Vertical lines
      for (let x = startX; x <= endX; x += tileSize) {
        graphics.lineBetween(x, startY, x, endY);
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += tileSize) {
        graphics.lineBetween(startX, y, endX, y);
      }
    }

    handleConnectionError(error: any) {
      console.error('❌ Failed to connect to Colyseus server:', error);
      console.error('📋 Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        serverUrl: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:1999',
      });

      // Do not render an in-canvas error overlay; rely on the React error banner

      // Call error callback if provided
      if (this.config.onError) {
        this.config.onError(
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    private updateEdgePanning(): void {
      // Desktop only, requires a camera and an active pointer
      if (!this.edgePanEnabled || this.isMobileControlled) return;
      if (!this.cameras || !this.cameras.main) return;

      const cam = this.cameras.main;
      const pointer = this.input?.activePointer;
      if (!pointer) return;

      const width = cam.width;
      const height = cam.height;
      const margin = Math.max(8, Math.min(128, this.edgePanMarginPx));

      // Pointer screen-space position (0..width/height)
      const px = typeof pointer.x === 'number' ? pointer.x : width / 2;
      const py = typeof pointer.y === 'number' ? pointer.y : height / 2;

      // Compute target offsets based on proximity to edges
      let targetOffsetX = 0;
      let targetOffsetY = 0;

      if (px <= margin) {
        const t = 1 - Math.max(0, px) / margin; // 0..1
        targetOffsetX = -Math.floor(width * this.edgePanMaxRatioX) * t;
      } else if (px >= width - margin) {
        const t = 1 - Math.max(0, width - px) / margin; // 0..1
        targetOffsetX = Math.floor(width * this.edgePanMaxRatioX) * t;
      }

      if (py <= margin) {
        const t = 1 - Math.max(0, py) / margin; // 0..1
        targetOffsetY = -Math.floor(height * this.edgePanMaxRatioY) * t;
      } else if (py >= height - margin) {
        const t = 1 - Math.max(0, height - py) / margin; // 0..1
        targetOffsetY = Math.floor(height * this.edgePanMaxRatioY) * t;
      }

      // Smoothly interpolate current offsets toward target
      const lerp = Math.max(0.01, Math.min(1, this.edgePanLerp));
      this.edgePanCurrentOffsetX +=
        (targetOffsetX - this.edgePanCurrentOffsetX) * lerp;
      this.edgePanCurrentOffsetY +=
        (targetOffsetY - this.edgePanCurrentOffsetY) * lerp;

      const appliedX = this.edgePanCurrentOffsetX | 0;
      const appliedY = this.edgePanCurrentOffsetY | 0;
      cam.setFollowOffset(appliedX, appliedY);
    }

    update(time: number, delta: number): void {
      // Skip loop if not connected with room yet
      if (!this.room) {
        return;
      }

      // Use mobile input if available, otherwise use keyboard
      if (this.isMobileControlled) {
        this.inputPayload = { ...this.mobileInputPayload };
      } else {
        this.inputPayload.left =
          this.cursors!.left.isDown || !!this.aKey?.isDown;
        this.inputPayload.right =
          this.cursors!.right.isDown || !!this.dKey?.isDown;
        this.inputPayload.up = this.cursors!.up.isDown || !!this.wKey?.isDown;
        this.inputPayload.down =
          this.cursors!.down.isDown || !!this.sKey?.isDown;
        this.inputPayload.sprint = this.shiftKey.isDown;
      }

      // Throttle/coalesce input sends
      const now =
        (this.time && typeof this.time.now === 'number'
          ? this.time.now
          : time) | 0;
      const elapsedSinceLast = now - this.lastInputSentAt;

      // Compute a cheap, stable signature for payload values
      const sig = `${this.inputPayload.left ? 1 : 0}|${this.inputPayload.right ? 1 : 0}|${
        this.inputPayload.up ? 1 : 0
      }|${this.inputPayload.down ? 1 : 0}|${this.inputPayload.sprint ? 1 : 0}`;

      const unchanged = sig === this.lastInputSignature;
      const dueInterval = elapsedSinceLast >= this.inputSendIntervalMs;
      const dueKeepalive = elapsedSinceLast >= this.inputKeepaliveMs;
      const isActive =
        !!this.inputPayload.left ||
        !!this.inputPayload.right ||
        !!this.inputPayload.up ||
        !!this.inputPayload.down ||
        !!this.inputPayload.sprint;

      if (
        (dueInterval && (this.inputDirty || !unchanged || isActive)) ||
        dueKeepalive
      ) {
        try {
          this.room.send(0, this.inputPayload);
          this.lastInputSentAt = now;
          this.lastInputSignature = sig;
          this.inputDirty = false;
        } catch (e) {
          // Swallow transient send errors in update loop
        }
      }

      // Handle space key for attacking nearest enemy (detect key press, not hold)
      const spacePressed = this.spaceKey.isDown && !this.lastSpaceKeyState;
      this.lastSpaceKeyState = this.spaceKey.isDown;

      // Handle N key for weapon switching
      const nPressed = this.nKey.isDown && !this.lastNKeyState;
      if (nPressed) {
        this.switchWeapon();
      }
      this.lastNKeyState = this.nKey.isDown;

      // Handle I key for inventory
      const iPressed = this.iKey.isDown && !this.lastIKeyState;
      if (iPressed) {
        this.handleInventoryToggle();
      }
      this.lastIKeyState = this.iKey.isDown;

      // Handle P key: Shift+P = shop, otherwise try portal hotkey (fallback to shop if unhandled)
      const pPressed = this.pKey.isDown && !this.lastPKeyState;
      if (pPressed) {
        if (this.shiftKey?.isDown) {
          this.handleShopToggle();
        } else {
          const handled = this.handlePortalHotkey();
          if (handled === false) {
            this.handleShopToggle();
          }
        }
      }
      this.lastPKeyState = this.pKey.isDown;

      // Handle B key for debug toggle
      const bPressed = this.bKey.isDown && !this.lastBKeyState;
      if (bPressed) {
        const DEV_HOTKEYS_ENABLED = process.env.NODE_ENV !== 'production';
        if (DEV_HOTKEYS_ENABLED) {
          this.toggleCollisionDebug();
        }
      }
      this.lastBKeyState = this.bKey.isDown;

      // Auto-attack toggle removed

      // Handle T key for test items spawning
      const tPressed = this.tKey.isDown && !this.lastTKeyState;
      if (tPressed) {
        this.spawnTestItems();
      }
      this.lastTKeyState = this.tKey.isDown;

      // Handle C key for clearing test items
      const cPressed = this.cKey.isDown && !this.lastCKeyState;
      if (cPressed) {
        this.clearTestItems();
      }
      this.lastCKeyState = this.cKey.isDown;

      // Handle E key for test enemies spawning
      const ePressed = this.eKey.isDown && !this.lastEKeyState;
      if (ePressed) {
        this.spawnTestEnemies();
      }
      this.lastEKeyState = this.eKey.isDown;

      // Handle G key for dev invincibility toggle
      const gPressed = this.gKey?.isDown && !this.lastGKeyState;
      if (gPressed) {
        const DEV_HOTKEYS_ENABLED = process.env.NODE_ENV !== 'production';
        if (DEV_HOTKEYS_ENABLED && this.room) {
          try {
            const players = (this.room.state as any)?.players;
            const get =
              players && typeof players.get === 'function'
                ? players.get.bind(players)
                : null;
            const sessionId = this.room.sessionId;
            const player = get && sessionId ? get(sessionId) : null;
            const currentlyInvincible =
              !!player && (player as any).devInvincible === true;

            this.room.send('debug_toggle_invincibility', {
              enabled: !currentlyInvincible,
            });

            const message = !currentlyInvincible
              ? 'Dev invincibility: ON'
              : 'Dev invincibility: OFF';

            // Lightweight in-canvas status blip near player
            try {
              const cam = this.cameras?.main;
              const x = cam ? cam.centerX : this.scale.width / 2;
              const y = cam ? cam.centerY - 80 : this.scale.height / 2 - 80;
              const statusText = this.add
                .text(x, y, message, {
                  fontSize: '16px',
                  color: '#e4fffb',
                  fontStyle: 'bold',
                  backgroundColor: '#064e3b',
                  padding: { x: 8, y: 4 },
                })
                .setOrigin(0.5)
                .setDepth(2200)
                .setScrollFactor(0);

              this.time.delayedCall(1600, () => {
                if (statusText && !statusText.destroyed) {
                  statusText.destroy();
                }
              });
            } catch {
              // ignore visual errors, server flag is the important part
            }
          } catch (err) {
            console.warn('Failed to toggle dev invincibility', err);
          }
        }
      }
      this.lastGKeyState = !!this.gKey?.isDown;

      const fPressed = this.fKey.isDown && !this.lastFKeyState;
      if (fPressed) {
        const DEV_HOTKEYS_ENABLED = process.env.NODE_ENV !== 'production';
        if (DEV_HOTKEYS_ENABLED) {
          this.fogOfWarSystem?.toggleDebug();
        }
      }
      this.lastFKeyState = this.fKey.isDown;

      this.updateGrenadeGraphicsPosition();

      const onePressed = this.oneKey?.isDown && !this.lastOneKeyState;
      if (onePressed) {
        this.armGrenadeByIndex(0);
      }
      this.lastOneKeyState = !!this.oneKey?.isDown;

      const twoPressed = this.twoKey?.isDown && !this.lastTwoKeyState;
      if (twoPressed) {
        this.armGrenadeByIndex(1);
      }
      this.lastTwoKeyState = !!this.twoKey?.isDown;

      if (this.grenadeDefinitions.length > 0) {
        const now = Date.now();
        if (now >= this.nextGrenadeHudEmitAt) {
          this.emitGrenadeHudState();
          this.nextGrenadeHudEmitAt = now + 100;
        }
      }

      if (this.spellDefinitions.length > 0) {
        const now = Date.now();
        if (now >= this.nextSpellHudEmitAt) {
          this.emitSpellHudState();
          this.nextSpellHudEmitAt = now + 100;
        }
      }

      // Check for auto-attack aggro
      this.checkAutoAttackAggro(time);

      // Check for map edge transitions
      this.checkMapEdgeTransitions();

      if (
        this.environmentSystem &&
        this.cameras &&
        this.cameras.main &&
        time >= this.nextFloorVisibilityUpdateAt
      ) {
        this.environmentSystem.updateVisibleFloors(this.cameras.main);
        this.nextFloorVisibilityUpdateAt =
          time + this.floorVisibilityThrottleMs;
      }

      // Camera edge panning (desktop)
      this.updateEdgePanning();

      if (this.minimapCamera && time >= this.nextMinimapUpdateAt) {
        this.updateMinimapPlayerMarker();
        this.nextMinimapUpdateAt = time + this.minimapUpdateThrottleMs;
      }

      // Fog-of-war world overlay does not require per-frame camera updates
    }

    // Base implementation - to be overridden by extending classes
    handleInventoryToggle() {
      console.log('Inventory toggle - override in extending class');
    }

    // Base implementation - to be overridden by extending classes
    handleShopToggle() {
      console.log('Shop toggle - override in extending class');
    }

    // Base implementation - to be overridden by extending classes
    handlePortalHotkey(): boolean {
      // Default no-op; extended scenes can implement quick portal behavior
      try {
        // Keep previous dev helper available as a fallback
        debugLog('🌀 Dev: Requesting portals to spawn near player (P)');
        if (!this.room) return false;
        this.room.send('debug_spawn_portals_here');
        return true;
      } catch (e) {
        console.warn('Failed to send debug_spawn_portals_here', e);
        return false;
      }
    }

    switchWeapon() {
      if (!this.room) return;

      const now = Date.now();
      if (now - this.lastWeaponCycleAt < this.weaponCycleDebounceMs) {
        return;
      }
      this.lastWeaponCycleAt = now;

      if (!this.weaponHudState || this.weaponHudState.weapons.length === 0) {
        return;
      }
      this.applyOptimisticWeaponCycle();
      try {
        this.room.send('cycle_weapon');
      } catch (error) {
        console.warn('Failed to send cycle_weapon message', error);
      }
    }

    setActiveWeaponIndex(index: number) {
      if (!this.room) return;
      if (!this.weaponHudState || this.weaponHudState.weapons.length === 0) {
        return;
      }
      const boundedIndex = Math.max(
        0,
        Math.min(index, this.weaponHudState.weapons.length - 1)
      );
      if (boundedIndex === this.weaponHudState.activeIndex) {
        return;
      }
      this.lastWeaponCycleAt = Date.now();
      this.applyOptimisticWeaponSelection(boundedIndex);
      try {
        this.room.send('set_active_weapon', { index: boundedIndex });
      } catch (error) {
        console.warn('Failed to send set_active_weapon message', error);
      }
    }

    handleServerWeaponSelection(index: number) {
      if (!this.weaponHudState || this.weaponHudState.weapons.length === 0) {
        return;
      }
      this.applyOptimisticWeaponSelection(index);
    }

    checkAutoAttackAggro(currentTime: number) {
      if (!this.room || !this.autoAttackEnabled) return;
      // If we were just hit, pause auto-attack to avoid thrash/doubles
      if (Date.now() < this.recentlyHitUntil) {
        return;
      }

      const currentPlayer = this.playerEntities[this.room.sessionId];
      if (!currentPlayer) return;

      // Don't auto-attack if player is manually pathfinding (click-to-move)
      const playerState = this.room.state.players.get(this.room.sessionId);
      if (playerState && playerState.isAutoWalking) {
        return;
      }

      // Note: Don't gate by cooldown yet; we'll only gate when continuing the same target

      // Find enemies within attack range - detection range equals attack range
      const attackRange = this.getPlayerAttackRange();
      let nearestEnemy = null;
      let nearestDistance = Infinity;

      // Check room state enemies, not just visual entities
      for (const [enemyId, enemyState] of this.room.state.enemies) {
        // Skip enemies that are dying or dead
        if (enemyState.anim === 'death' || enemyState.hp <= 0) {
          continue;
        }

        const distance = Math.sqrt(
          Math.pow(enemyState.x - currentPlayer.x, 2) +
            Math.pow(enemyState.y - currentPlayer.y, 2)
        );

        // Check if enemy is within attack range
        if (distance <= attackRange && distance < nearestDistance) {
          nearestDistance = distance;
          nearestEnemy = enemyId;
        }
      }

      // Auto-attack if enemy found within attack range
      if (nearestEnemy) {
        // Calculate direction to enemy for proper attack animation
        const enemyState = this.room.state.enemies.get(nearestEnemy);
        if (!enemyState) return; // Safety check

        const deltaX = enemyState.x - currentPlayer.x;
        const deltaY = enemyState.y - currentPlayer.y;

        let direction = 'down'; // default
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          direction = deltaX > 0 ? 'right' : 'left';
        } else {
          direction = deltaY > 0 ? 'down' : 'up';
        }

        // Gate cooldown only if we're continuing to attack the same target
        const continuingSameTarget = this.currentAutoTarget === nearestEnemy;
        // Use selected character's attackSpeed from @characters.ts (no hardcoded default)
        let attackIntervalMs = 0;
        const playerStateForCooldown = this.room.state.players.get(
          this.room.sessionId
        );
        const selectedCharacterId =
          playerStateForCooldown?.characterId ||
          this.config.selectedCharacterId;
        if (selectedCharacterId) {
          const stats = getCharacterStats(selectedCharacterId);
          attackIntervalMs = stats.attackSpeed;
        }
        if (
          continuingSameTarget &&
          attackIntervalMs > 0 &&
          currentTime - this.lastAutoAttackTime < attackIntervalMs
        ) {
          return;
        }

        // Update current target and attack immediately
        this.currentAutoTarget = nearestEnemy;
        this.room.send('startAction', {
          type: 'attack_enemy',
          targetId: nearestEnemy,
        });
        this.lastAutoAttackTime = currentTime;
        debugLog(
          `🎯 Auto-attacking enemy ${nearestEnemy} at distance ${Math.round(nearestDistance)}px facing ${direction}`
        );
      } else {
        // Clear target if no enemies in attack range
        this.currentAutoTarget = null;
        // Allow instant reacquire when re-entering range
        this.lastAutoAttackTime = 0;
      }
    }

    // Base implementation - to be overridden by extending classes
    checkMapEdgeTransitions() {
      // No-op in base class - LocalGameScene will implement room transitions
      // console.log('checkMapEdgeTransitions - override in extending class');
    }

    // Map edge transition methods are implemented in extending classes (LocalGameScene)
    // Base GameScene provides the framework, specific scenes handle room transitions

    // Public method to allow React components to use items
    useItem(
      item: InventoryItem,
      onItemUsed?: (itemId: string, quantity: number) => void
    ): boolean {
      return this.itemSystem.useItem(item, onItemUsed);
    }

    // Public getters for environment properties (for backward compatibility)
    get treeEntities() {
      return this.environmentSystem.treeEntities;
    }

    get treePositions() {
      return this.environmentSystem.treePositions;
    }

    get stoneEntities() {
      return this.environmentSystem.stoneEntities;
    }

    get stonePositions() {
      return this.environmentSystem.stonePositions;
    }

    resize(gameSize: any) {
      console.log('GameScene: resize called', gameSize);

      const width = Math.max(1, Math.floor(Number(gameSize?.width) || 0));
      const height = Math.max(1, Math.floor(Number(gameSize?.height) || 0));
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return; // ignore invalid resize payloads
      }

      // Update camera viewport to match new size
      if (this.cameras && this.cameras.main) {
        this.cameras.main.setViewport(0, 0, width, height);
      }

      this.initializeMinimap();
    }

    clearAllEntities() {
      console.log('Clearing all entities...');

      this.setMinimapFollowTarget(null);

      // Use ItemSystem to clean up items
      if (this.itemSystem) {
        this.itemSystem.destroy();
      }

      // Use EnvironmentSystem to clean up environment
      if (this.environmentSystem) {
        this.environmentSystem.destroy();
      }

      // Clean up click indicators
      if (this.clickIndicators) {
        this.clickIndicators.forEach((indicator) => {
          if (indicator) {
            indicator.destroy();
          }
        });
        this.clickIndicators = [];
      }

      // Clean up EntityManager
      if (this.entityManager) {
        this.entityManager.clearAllEntities();
      }

      // Clear other entities (placeholder for future implementation)
    }

    // Mobile input methods
    handleMobileInput(input: {
      left: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
      sprint: boolean;
    }) {
      this.mobileInputPayload = { ...input };
      this.isMobileControlled = true;
      this.inputDirty = true;
    }

    setSprintMode(isSprinting: boolean) {
      this.mobileInputPayload.sprint = isSprinting;
      // Also update the main input payload if we're in mobile mode
      if (this.isMobileControlled) {
        this.inputPayload.sprint = isSprinting;
      }
      this.inputDirty = true;
    }
  }; // End of GameScene class
} // End of createGameScene function
