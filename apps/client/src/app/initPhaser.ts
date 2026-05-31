import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { AavegotchiSpriteManager } from '../lib/sprite-manager';
import { HUD_PHASER_FONT_FAMILY } from '../lib/fonts';
import { renderTokenCollectible } from '../lib/token-sprites';
import { renderWearableCollectible } from '../lib/wearable-sprites';
import type { InventoryItem, DroppedItem } from '../types/inventory';
import { mapInventoryMessagesToClientItems } from '../lib/mappers';
import type { AudioSettings } from '../types/preferences';
import {
  createGameScene,
  type GrenadeHudState,
  type ScoreHudState,
  type WeaponHudState,
  type SpellHudState,
  type GameSceneConfig,
} from '../game/GameScene';
export type { ScoreHudState } from '../game/GameScene';
import { EntityFactory } from '../lib/entity-manager';
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
import type { ProgressionProfile } from '../lib/progression';
import type {
  ServerToClientMessages,
  LeverageStatePayload,
} from '../types/messages';
import { SERVER_REGIONS, getServerUrlForRegion } from '../lib/server-regions';
import {
  renderEnemySprite,
  renderNPCSprite,
  renderProjectileSprite,
  renderRoadSprite,
  renderSpecialSprite,
  renderStoneSprite,
  renderTreasureChestSprite,
  renderTreeSprite,
} from './helpers';
import {
  renderDebugRectangle,
  removeDebugRectangle,
  toggleDebugRectangles,
  silenceConsoleLogsUnlessDebug,
} from '../lib/debug';
import type { IGameScene } from '../types/game-scene';
import {
  loadSelectedMapChunks,
  getChunkSetKeyForDifficulty,
  loadMapChunks,
} from '../data/maps-loader';
import { ENEMY_TYPES as CLIENT_ENEMY_TYPES } from '../data/enemies';
import { GAME_CONFIG } from '../data/game-config';
import { createLoadingScene } from '../game/LoadingScene';

export type JoinTarget = {
  roomId: string;
  colyseusRoomId: string;
  regionId: string;
  regionName: string;
  playerCount: number;
  maxPlayers: number;
  difficultyTier?: string;
  hostSessionId?: string;
  isFull: boolean;
};

export type ToastNotification = {
  id: string;
  type:
    | 'portal_guardian_spawn'
    | 'portals_opened'
    | 'treasure_chest'
    | 'error'
    | 'success'
    | 'info';
  message: string;
};

type SpatialFalloff = (distance: number, maxRadius: number) => number;

interface SpatialSoundSource {
  id: string;
  key: string;
  sound: Phaser.Sound.BaseSound;
  x: number;
  y: number;
  maxRadius: number;
  baseVolume: number;
  falloff: SpatialFalloff;
  hysteresis: number;
  isAudible: boolean;
  startOnUnlock: boolean;
  currentVolume: number;
}

const DEFAULT_SPATIAL_MAX_RADIUS = 380;
const DEFAULT_SPATIAL_BASE_VOLUME = 0.9;
const DEFAULT_SPATIAL_HYSTERESIS = 20;
const SPATIAL_VOLUME_EPSILON = 0.0005;
const SPATIAL_VOLUME_LERP = 0.12;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value ?? 0));

const quadraticSpatialFalloff: SpatialFalloff = (
  distance: number,
  maxRadius: number
): number => {
  if (!Number.isFinite(distance) || !Number.isFinite(maxRadius)) {
    return 0;
  }
  if (maxRadius <= 0) {
    return 0;
  }
  if (distance >= maxRadius) {
    return 0;
  }
  const t = 1 - distance / maxRadius;
  return clamp01(t * t);
};

export type InitPhaserOptions = {
  playerName: string;
  joinTarget: JoinTarget | null;
  selectedRegionId: string;
  selectedDifficultyTier: string;
  isWalletConnected: boolean;
  walletAddress: string | null;
  isMobile: boolean;
  playerAvatarId: string | null;
  selectedCharacterId: string;
  debugTreasureRoom?: boolean;
  audioSettings: AudioSettings;
  progressionProfile: ProgressionProfile;
  handleServerProfileMessage: (message: ProgressionProfileMessage) => void;
  handleServerXpAward: (message: ProgressionXpAwardMessage) => void;
  handleServerLevelLoss: (message: ProgressionLevelLostMessage) => void;
  handleKillStreakProfile: (message: KillStreakProfileMessage) => void;
  handleKillStreakUpdate: (message: KillStreakUpdatedMessage) => void;
  handleKillStreakReset: (message: KillStreakResetMessage) => void;
  setCurrentRoomId: (value: string) => void;
  setHostSessionId: (value: string) => void;
  setPlayerCount: (value: number) => void;
  setMaxPlayers?: (value: number | null) => void;
  setRoomPhase?: (value: 'staging' | 'countdown' | 'in_game' | 'ended') => void;
  setCountdownEndsAt?: (value: number) => void;
  setAutoCloseAt?: (value: number) => void;
  setLateJoinCutoffAt?: (value: number) => void;
  setStartedByPlayerId?: (value: string | null) => void;
  setRunStartedAt?: (value: number) => void;
  requiredCredits: number;
  consumeCredits: (amount: number) => boolean;
  pendingCreditsRef: MutableRefObject<{
    amount: number;
    timeoutId: number | null;
  } | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsStarting: Dispatch<SetStateAction<boolean>>;
  setGameStarted: Dispatch<SetStateAction<boolean>>;
  handleDisconnect: () => void;
  setConnectionStatus: Dispatch<
    SetStateAction<'connected' | 'disconnected' | 'reconnecting'>
  >;
  setPing: (value: number) => void;
  setPacketLoss: Dispatch<SetStateAction<number>>;
  setServerRegion: Dispatch<SetStateAction<string>>;
  setNextTimedSpawnAt: Dispatch<SetStateAction<number>>;
  setEnemyCount: Dispatch<SetStateAction<number>>;
  setEnemyDifficultyLevel: Dispatch<SetStateAction<number>>;
  setEnemyDifficultyNextAt: Dispatch<SetStateAction<number>>;
  setEnemyDifficultyEnabled: Dispatch<SetStateAction<boolean>>;
  setHuntedIntensityLevel: Dispatch<SetStateAction<number>>;
  setHuntedNextSpawnAt: Dispatch<SetStateAction<number>>;
  setHuntedEnabled: Dispatch<SetStateAction<boolean>>;
  setPortalQuestLabel: Dispatch<SetStateAction<string>>;
  // Floor index state for HUD
  setFloorIndex?: Dispatch<SetStateAction<number>>;
  // Whether current floor portals are available
  setPortalsOpened?: Dispatch<SetStateAction<boolean>>;
  // Increment per-run tongue count
  incrementRunTongues?: (amount: number) => void;
  setPlayerAvatarId: Dispatch<SetStateAction<string | null>>;
  addItemToInventory: (item: InventoryItem) => void;
  showPickupToast: (item: InventoryItem) => void;
  setDroppedItems: Dispatch<SetStateAction<DroppedItem[]>>;
  startDialogue: (
    npcId: string,
    npcName: string,
    npcCharacterId: string,
    dialogueId: string
  ) => void;
  resolveDialogueAction: (nextDialogue: string | null) => Promise<void>;
  setToastNotification: Dispatch<SetStateAction<ToastNotification | null>>;
  setToastItem: Dispatch<SetStateAction<InventoryItem | null>>;
  setGrenadeState: Dispatch<SetStateAction<GrenadeHudState>>;
  setScoreState: Dispatch<SetStateAction<ScoreHudState>>;
  setWeaponHudState: Dispatch<SetStateAction<WeaponHudState>>;
  setSpellState: Dispatch<SetStateAction<SpellHudState>>;
  setLeverageState: Dispatch<SetStateAction<LeverageStatePayload>>;
  setLeverageError?: Dispatch<SetStateAction<string | null>>;
  setClientSessionId: Dispatch<SetStateAction<string>>;
  setInventoryItems: (items: InventoryItem[]) => void;
  setHasVictory: Dispatch<SetStateAction<boolean>>;
  handleInventoryToggle: () => void;
  handleShopToggle: () => void;
  setPhaserGame: Dispatch<SetStateAction<any>>;
  setRunKills?: Dispatch<SetStateAction<number>>;
};

const CREDITS_COMMIT_DELAY_MS = 5000;
const isCoinType = (value: unknown) => {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (
    normalized === 'coin' || normalized === 'gold_coin' || normalized === 'gold'
  );
};

export const initPhaser = async ({
  playerName,
  joinTarget,
  selectedRegionId,
  selectedDifficultyTier,
  isWalletConnected,
  walletAddress,
  isMobile,
  playerAvatarId,
  selectedCharacterId,
  audioSettings,
  progressionProfile,
  handleServerProfileMessage,
  handleServerXpAward,
  handleServerLevelLoss,
  handleKillStreakProfile,
  handleKillStreakUpdate,
  handleKillStreakReset,
  setCurrentRoomId,
  setHostSessionId,
  setPlayerCount,
  setRoomPhase,
  setCountdownEndsAt,
  setAutoCloseAt,
  setLateJoinCutoffAt,
  setStartedByPlayerId,
  setRunStartedAt,
  requiredCredits,
  consumeCredits,
  pendingCreditsRef,
  setError,
  setIsStarting,
  setGameStarted,
  handleDisconnect,
  setConnectionStatus,
  setPing,
  setPacketLoss,
  setServerRegion,
  setNextTimedSpawnAt,
  setEnemyCount,
  setEnemyDifficultyLevel,
  setEnemyDifficultyNextAt,
  setEnemyDifficultyEnabled,
  setHuntedIntensityLevel,
  setHuntedNextSpawnAt,
  setHuntedEnabled,
  setPortalQuestLabel,
  setFloorIndex,
  setPortalsOpened,
  setPlayerAvatarId,
  addItemToInventory,
  showPickupToast,
  setDroppedItems,
  startDialogue,
  resolveDialogueAction,
  setToastNotification,
  setToastItem,
  setGrenadeState,
  setScoreState,
  setWeaponHudState,
  setSpellState,
  setLeverageState,
  setLeverageError,
  setClientSessionId,
  setInventoryItems,
  setHasVictory,
  handleInventoryToggle,
  handleShopToggle,
  setPhaserGame,
  debugTreasureRoom,
  incrementRunTongues,
  setRunKills,
}: InitPhaserOptions) => {
  // Silence console.log/debug unless client debug flag is enabled
  silenceConsoleLogsUnlessDebug();
  const DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
  function debugLog(...args: unknown[]) {
    if (DEBUG) console.log(...args);
  }
  // Removed Portal Guardian spawn timer handling

  try {
    const Phaser = await import('phaser');
    const { Client } = await import('colyseus.js');

    debugLog('🏷️ Using player name:', playerName);

    // Load only the required chunk set for the current join target
    const activeRegionId = joinTarget?.regionId || selectedRegionId;
    const activeDifficultyTier =
      joinTarget?.difficultyTier || selectedDifficultyTier;
    // Load chunk sets; if staging is enabled, ensure staging set is loaded too
    let mapChunks = await loadSelectedMapChunks(
      activeDifficultyTier,
      (joinTarget as any)?.phase
    );
    const dungeonChunks = mapChunks.dungeon ?? [];
    const grassChunks = mapChunks.grass ?? [];
    let stagingChunks = mapChunks.staging ?? [];
    let bossChunks = mapChunks.boss ?? [];

    if (GAME_CONFIG.STAGING_ENABLED && stagingChunks.length === 0) {
      try {
        stagingChunks = await loadMapChunks('chunks-staging.ts');
      } catch (e) {
        console.warn('Failed to pre-load staging chunk set:', e);
      }
    }

    // If staging is enabled and we have staging chunks, merge them into the
    // mapChunks passed to the GameScene so special textures are discovered
    // by the dynamic sprite loader ahead of time.
    if (GAME_CONFIG.STAGING_ENABLED && stagingChunks.length > 0) {
      mapChunks = { ...mapChunks, staging: stagingChunks } as typeof mapChunks;
    }

    if (bossChunks.length === 0) {
      try {
        bossChunks = await loadMapChunks('chunks-boss.ts');
        if (bossChunks.length > 0) {
          mapChunks = { ...mapChunks, boss: bossChunks };
        }
      } catch (error) {
        console.warn('Failed to pre-load boss chunk set:', error);
      }
    }

    // Create GameScene configuration
    // activeRegionId and activeDifficultyTier declared above
    const gameSceneConfig: GameSceneConfig = {
      playerName,
      isWalletConnected,
      walletAddress: walletAddress ?? '',
      joinRoomId: joinTarget?.colyseusRoomId,
      regionId: activeRegionId,
      debugTreasureRoom: Boolean(debugTreasureRoom),
      isMobile,
      avatarId: playerAvatarId,
      selectedCharacterId, // Pass selected character to game
      useCharacterSprites: true, // Enable character sprite animations!
      difficultyTier: activeDifficultyTier,
      serverUrl: getServerUrlForRegion(activeRegionId),
      audioSettings,
      progressionProfile: progressionProfile,
      mapChunks,
      onProgressionProfile: handleServerProfileMessage,
      onProgressionXpAward: handleServerXpAward,
      onProgressionLevelLost: handleServerLevelLoss,
      onKillStreakProfile: handleKillStreakProfile,
      onKillStreakUpdated: handleKillStreakUpdate,
      onKillStreakReset: handleKillStreakReset,
      onEnemyDifficultyUpdate: ({ level, nextAt, enabled }) => {
        try {
          setEnemyDifficultyLevel(level);
          setEnemyDifficultyNextAt(nextAt);
          setEnemyDifficultyEnabled(enabled);
        } catch {}
      },
      onHuntedUpdate: ({ intensityLevel, nextSpawnAt, enabled }) => {
        try {
          setHuntedIntensityLevel(intensityLevel);
          setHuntedNextSpawnAt(nextSpawnAt);
          setHuntedEnabled(enabled);
        } catch {}
      },
      onRoomJoined: (info: {
        roomId: string;
        roomCode?: string;
        hostSessionId?: string;
        maxPlayers?: number;
        playerCount?: number;
        region?: string;
        difficultyTier?: string;
      }) => {
        setCurrentRoomId(info.roomId);
        setHostSessionId(info.hostSessionId ?? '');
        if (typeof info.playerCount === 'number') {
          setPlayerCount(info.playerCount);
        }

        if (requiredCredits > 0) {
          const didConsume = consumeCredits(requiredCredits);

          if (didConsume) {
            if (pendingCreditsRef.current?.timeoutId != null) {
              window.clearTimeout(pendingCreditsRef.current.timeoutId);
            }

            if (typeof window !== 'undefined') {
              const timeoutId = window.setTimeout(() => {
                if (pendingCreditsRef.current?.timeoutId === timeoutId) {
                  pendingCreditsRef.current = null;
                }
              }, CREDITS_COMMIT_DELAY_MS);

              pendingCreditsRef.current = {
                amount: requiredCredits,
                timeoutId,
              };
            } else {
              pendingCreditsRef.current = {
                amount: requiredCredits,
                timeoutId: null,
              };
            }
          } else {
            pendingCreditsRef.current = null;
            setError('Insufficient credits');
            setIsStarting(false);
            setGameStarted(false);
            setTimeout(() => {
              handleDisconnect();
            }, 0);
          }
        }

        // Notify LoadingScene so it can close once assets + room are ready
        try {
          (this as any).game?.events?.emit('loading:room-joined');
        } catch {}
      },
      onPlayerCountChange: setPlayerCount,
      onConnectionStatusChange: setConnectionStatus,
      onPingUpdate: setPing,
      onPacketLossUpdate: setPacketLoss,
      onServerRegionUpdate: setServerRegion,
      onTimedSpawnInfoUpdate: (info: {
        nextTimedSpawnAt: number;
        enemyCount: number;
      }) => {
        try {
          setNextTimedSpawnAt(info.nextTimedSpawnAt);
          setEnemyCount(info.enemyCount);
        } catch {}
      },
      onAvatarIdUpdate: (avatarId: string) => {
        setPlayerAvatarId(avatarId);
      },
      onItemPickup: (item: InventoryItem) => {
        // Add to inventory
        addItemToInventory(item);

        // Track per-run tongue pickups
        try {
          const isTongue =
            String(item?.type || '').toLowerCase() === 'material' &&
            String(item?.name || '').toLowerCase() === 'lick tongue';
          if (
            isTongue &&
            typeof (this as any).incrementRunTongues === 'function'
          ) {
            (this as any).incrementRunTongues(
              Math.max(1, Math.floor(item.quantity || 1))
            );
          }
        } catch {}

        // Tokens (coins) should not trigger toasts; floating text is handled in-scene
        if (item.type !== 'coin') {
          showPickupToast(item);
        }

        // Remove from dropped items state (cleanup for UI)
        setDroppedItems((prev) =>
          prev.filter((droppedItem) => droppedItem.item.id !== item.id)
        );
      },
      onNPCInteraction: (
        npcId: string,
        npcName: string,
        npcCharacterId: string,
        dialogueId: string
      ) => {
        startDialogue(npcId, npcName, npcCharacterId, dialogueId);
      },
      onError: (err: string) => setError(err),
    };

    // Create GameScene and LoadingScene classes using factories
    const GameScene = createGameScene(Phaser);
    const LoadingScene = createLoadingScene(Phaser);

    // Function to select correct chunk set. Prefer inferring from layout when provided
    const selectChunksByDifficulty = (
      difficultyTier: string,
      phase?: string,
      layout?: Array<{ x: number; y: number; chunkName: string }>
    ) => {
      const inferredKey = Array.isArray(layout)
        ? layout.some(
            (c) => String(c?.chunkName || '').toLowerCase() === 'staging'
          )
          ? 'staging'
          : null
        : null;
      const key =
        (inferredKey as any) ??
        getChunkSetKeyForDifficulty(difficultyTier, phase);

      const base =
        key === 'staging'
          ? stagingChunks
          : key === 'grass'
            ? grassChunks
            : key === 'boss'
              ? bossChunks
              : dungeonChunks;

      if (
        Array.isArray(layout) &&
        inferredKey === 'staging' &&
        base !== stagingChunks
      ) {
        const merged = new Map<string, any>();
        stagingChunks.forEach((c) => merged.set(String(c?.name || ''), c));
        base.forEach((c) => merged.set(String(c?.name || ''), c));
        return Array.from(merged.values());
      }

      return base;
    };

    // Use external GameScene class
    class LocalGameScene extends GameScene {
      client = new Client(getServerUrlForRegion(activeRegionId));
      lastCritShakeAt = 0;
      room: any = null;
      playerEntities: { [sessionId: string]: any } = {};
      enemyEntities: { [enemyId: string]: any } = {};
      projectileEntities: { [projectileId: string]: any } = {};
      droppedItemEntities: { [itemId: string]: any } = {};
      treasureChestEntities: { [chestId: string]: any } = {};
      portalInteractTimer: any = null;
      portalInfo: Record<
        string,
        {
          labelText: Phaser.GameObjects.Text;
          radius: number;
          x: number;
          y: number;
          isPointerHovering: boolean;
        }
      > = {};
      private spatialSoundSources: Map<string, SpatialSoundSource> = new Map();
      private spatialNeedsImmediateVolumeUpdate = false;
      private spatialUnlockListenerBound = false;
      debugEntities: { [debugId: string]: any } = {};
      cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
      spaceKey: any = null;
      nKey: any = null;
      iKey: any = null;
      pKey: any = null;
      shiftKey: any = null;
      lastSpaceKeyState = false;
      lastNKeyState = false;
      lastIKeyState = false;
      lastPKeyState = false;
      weaponMode: string = 'melee';
      rangeIndicator: any = null;
      lastTransitionTime: number = 0;
      isTransitioning: boolean = false;
      spriteManager: AavegotchiSpriteManager | null = null;
      currentSelectedTargetId: string | null = null;
      // Cache resolved attack range from server-derived stats to avoid using defaults
      serverAttackRangeCache: number | null = null;
      // Track death SFX played for enemy IDs to avoid duplicates when container is missing
      playedDeathSfxEnemyIds: Set<string> = new Set();

      inputPayload = {
        left: false,
        right: false,
        up: false,
        down: false,
        sprint: false,
      };

      // Mobile input state
      mobileInputPayload = {
        left: false,
        right: false,
        up: false,
        down: false,
        sprint: false,
      };
      isMobileControlled = false;

      constructor() {
        super(gameSceneConfig);
      }

      // Prefer server-derived stats for attack range; fallback to base implementation
      getPlayerAttackRange(): number {
        try {
          const me = this.room?.state.players.get(this.room?.sessionId);
          const type = (this.weaponMode as 'melee' | 'ranged') || 'melee';
          // Try cached value first (kept fresh on state changes)
          if (
            Number.isFinite(this.serverAttackRangeCache) &&
            (this.serverAttackRangeCache as number) > 0
          ) {
            return Math.floor(this.serverAttackRangeCache as number);
          }
          if (me && typeof (me as any).derivedStats === 'string') {
            const ds = JSON.parse((me as any).derivedStats || '{}');
            const v =
              type === 'ranged'
                ? Number(ds?.rangedAttackRange)
                : Number(ds?.meleeAttackRange);
            if (Number.isFinite(v) && v > 0) {
              return Math.floor(v);
            }
          }
        } catch {}
        // Fallback to base behavior (character stats or defaults)
        return super.getPlayerAttackRange();
      }

      private spawnFloatingText(
        container: any,
        text: string,
        style: Phaser.Types.GameObjects.Text.TextStyle,
        options?: { startY?: number; endY?: number; duration?: number }
      ) {
        if (!container || !this.add) return;
        const { startY = -55, endY = -75, duration = 600 } = options || {};
        const textObject = this.add.text(0, startY, text, style).setOrigin(0.5);
        container.add(textObject);
        this.registerMinimapIgnore(textObject);
        this.tweens.add({
          targets: textObject,
          y: endY,
          alpha: 0,
          duration,
          ease: 'Cubic.easeOut',
          onComplete: () => textObject.destroy(),
        });
      }

      private spawnFloatingTextAt(
        position: { x: number; y: number },
        text: string,
        style: Phaser.Types.GameObjects.Text.TextStyle,
        options?: {
          startOffsetY?: number;
          endOffsetY?: number;
          duration?: number;
          depth?: number;
        }
      ) {
        if (!this.add) return;
        const startOffsetY = options?.startOffsetY ?? -55;
        const endOffsetY = options?.endOffsetY ?? -75;
        const duration = options?.duration ?? 600;
        const depth = options?.depth ?? position.y;

        const textObject = this.add
          .text(position.x, position.y + startOffsetY, text, style)
          .setOrigin(0.5)
          .setDepth(depth);
        this.registerMinimapIgnore(textObject);

        this.tweens.add({
          targets: textObject,
          y: position.y + endOffsetY,
          alpha: 0,
          duration,
          ease: 'Cubic.easeOut',
          onComplete: () => textObject.destroy(),
        });
      }

      private createPortalLabel(
        portalId: string,
        x: number,
        y: number,
        label: string,
        radius: number,
        offsetY: number = 90
      ) {
        const existing = this.portalInfo[portalId];
        if (existing?.labelText) {
          existing.labelText.destroy();
        }

        const labelText = this.add
          .text(x, y - offsetY, label, {
            fontFamily: 'Rubik, Arial, sans-serif',
            fontSize: '16px',
            color: '#ffffff',
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            padding: { left: 8, right: 8, top: 4, bottom: 4 },
            align: 'center',
          })
          .setOrigin(0.5, 1)
          .setDepth(y + 5)
          .setVisible(false);

        labelText.setStroke('#000000', 4);

        if (typeof this.registerMinimapIgnore === 'function') {
          this.registerMinimapIgnore(labelText);
        }

        this.portalInfo[portalId] = {
          labelText,
          radius,
          x,
          y,
          isPointerHovering: existing?.isPointerHovering ?? false,
        };

        return this.portalInfo[portalId];
      }

      private isPlayerWithinPortalRadius(info: {
        x: number;
        y: number;
        radius: number;
        labelText: Phaser.GameObjects.Text;
      }): boolean {
        const currentSessionId = this.room?.sessionId;
        if (!currentSessionId) return false;
        const currentPlayer = this.playerEntities[currentSessionId];
        if (!currentPlayer) return false;
        const dx = currentPlayer.x - info.x;
        const dy = currentPlayer.y - info.y;
        return Math.sqrt(dx * dx + dy * dy) <= info.radius;
      }

      private updatePortalLabelVisibility() {
        const currentSessionId = this.room?.sessionId;
        if (!currentSessionId) return;
        const currentPlayer = this.playerEntities[currentSessionId];
        if (!currentPlayer) return;

        Object.entries(this.portalInfo).forEach(([portalId, info]) => {
          if (!info?.labelText || !info.labelText.active) return;
          const visible = this.isPlayerWithinPortalRadius(info);
          if (visible) {
            if (!info.labelText.visible) info.labelText.setVisible(true);
          } else if (!info.isPointerHovering) {
            if (info.labelText.visible) info.labelText.setVisible(false);
          }
        });
      }

      private getSpatialMixGain(): number {
        if (!this.audioSettings || this.audioSettings.muted) {
          return 0;
        }
        const master = Number(this.audioSettings.masterVolume ?? 0);
        const sfx = Number(this.audioSettings.sfxVolume ?? 0);
        if (!Number.isFinite(master) || !Number.isFinite(sfx)) {
          return 0;
        }
        return clamp01((master / 100) * (sfx / 100));
      }

      private registerSpatialLoop(
        entityId: string,
        x: number,
        y: number,
        key: string,
        options: {
          maxRadius?: number;
          baseVolume?: number;
          falloff?: SpatialFalloff;
          hysteresis?: number;
        } = {}
      ): void {
        const existing = this.spatialSoundSources.get(entityId);
        const maxRadius = Math.max(
          0,
          options.maxRadius ?? DEFAULT_SPATIAL_MAX_RADIUS
        );
        const baseVolume = clamp01(
          options.baseVolume ?? DEFAULT_SPATIAL_BASE_VOLUME
        );
        const falloff = options.falloff ?? quadraticSpatialFalloff;
        const hysteresis = Math.max(
          0,
          options.hysteresis ?? DEFAULT_SPATIAL_HYSTERESIS
        );

        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.maxRadius = maxRadius;
          existing.baseVolume = baseVolume;
          existing.falloff = falloff;
          existing.hysteresis = hysteresis;
          this.spatialNeedsImmediateVolumeUpdate = true;
          return;
        }

        if (!this.sound) {
          return;
        }

        let phaserSound: Phaser.Sound.BaseSound | null = null;
        try {
          phaserSound = this.sound.add(key, { loop: true, volume: 0 });
        } catch (error) {
          console.warn(
            `Failed to register spatial sound for ${entityId} using ${key}:`,
            error
          );
          return;
        }

        if (!phaserSound) {
          return;
        }

        const source: SpatialSoundSource = {
          id: entityId,
          key,
          sound: phaserSound,
          x,
          y,
          maxRadius,
          baseVolume,
          falloff,
          hysteresis,
          isAudible: false,
          startOnUnlock: false,
          currentVolume: 0,
        };

        if (this.sound.locked) {
          source.startOnUnlock = true;
          this.attachSpatialUnlockListener();
        } else {
          try {
            phaserSound.play({ loop: true, volume: 0 });
          } catch (error) {
            console.warn(`Failed to start spatial sound ${key}:`, error);
          }
        }

        this.spatialSoundSources.set(entityId, source);
        this.spatialNeedsImmediateVolumeUpdate = true;
      }

      private updateSpatialSource(
        entityId: string,
        x: number,
        y: number,
        options: {
          maxRadius?: number;
          baseVolume?: number;
          falloff?: SpatialFalloff;
          hysteresis?: number;
        } = {}
      ): void {
        const source = this.spatialSoundSources.get(entityId);
        if (!source) return;

        source.x = x;
        source.y = y;
        if (typeof options.maxRadius === 'number') {
          source.maxRadius = Math.max(0, options.maxRadius);
        }
        if (typeof options.baseVolume === 'number') {
          source.baseVolume = clamp01(options.baseVolume);
        }
        if (options.falloff) {
          source.falloff = options.falloff;
        }
        if (typeof options.hysteresis === 'number') {
          source.hysteresis = Math.max(0, options.hysteresis);
        }
        this.spatialNeedsImmediateVolumeUpdate = true;
      }

      private unregisterSpatialSource(entityId: string): void {
        const source = this.spatialSoundSources.get(entityId);
        if (!source) {
          return;
        }

        try {
          if (source.sound.isPlaying || source.sound.isPaused) {
            source.sound.stop();
          }
        } catch {}

        try {
          source.sound.destroy();
        } catch {}

        this.spatialSoundSources.delete(entityId);
        this.spatialNeedsImmediateVolumeUpdate = true;
      }

      private attachSpatialUnlockListener(): void {
        if (!this.sound || this.spatialUnlockListenerBound) {
          return;
        }
        this.sound.once(
          Phaser.Sound.Events.UNLOCKED,
          this.handleSpatialSoundUnlock,
          this
        );
        this.spatialUnlockListenerBound = true;
      }

      private handleSpatialSoundUnlock(): void {
        this.spatialUnlockListenerBound = false;
        this.spatialSoundSources.forEach((source) => {
          source.startOnUnlock = false;
          source.currentVolume = 0;
          try {
            if (!source.sound.isPlaying) {
              source.sound.play({ loop: true, volume: 0 });
            } else {
              (source.sound as any).setVolume(0);
            }
          } catch (error) {
            console.warn(
              `Failed to start spatial sound ${source.key} after unlock:`,
              error
            );
          }
        });
        this.spatialNeedsImmediateVolumeUpdate = true;
      }

      private applySpatialVolume(
        source: SpatialSoundSource,
        targetVolume: number
      ): void {
        const sound = source.sound;
        if (!sound || !this.sound) {
          return;
        }

        if (this.sound.locked && source.startOnUnlock) {
          source.currentVolume = 0;
          return;
        }

        const clampedTarget = clamp01(targetVolume);
        const nextVolume = this.spatialNeedsImmediateVolumeUpdate
          ? clampedTarget
          : Phaser.Math.Linear(
              source.currentVolume,
              clampedTarget,
              SPATIAL_VOLUME_LERP
            );

        source.currentVolume = nextVolume;

        if (nextVolume <= SPATIAL_VOLUME_EPSILON) {
          try {
            (sound as any).setVolume(0);
          } catch {}
          try {
            if (sound.isPlaying && !sound.isPaused) {
              sound.pause();
            }
          } catch {}
          return;
        }

        try {
          (sound as any).setVolume(nextVolume);
        } catch {}

        if (sound.isPaused) {
          try {
            sound.resume();
          } catch {}
        } else if (!sound.isPlaying) {
          try {
            sound.play({ loop: true, volume: nextVolume });
          } catch (error) {
            console.warn(
              `Failed to resume spatial sound ${source.key}:`,
              error
            );
          }
        }
      }

      private updateSpatialSounds(): void {
        if (this.spatialSoundSources.size === 0) {
          return;
        }

        const gain = this.getSpatialMixGain();
        const sessionId = this.room?.sessionId;
        const player =
          sessionId && this.playerEntities
            ? this.playerEntities[sessionId]
            : null;

        if (
          !player ||
          !Number.isFinite(player.x) ||
          !Number.isFinite(player.y) ||
          gain <= 0
        ) {
          this.spatialSoundSources.forEach((source) => {
            this.applySpatialVolume(source, 0);
          });
          this.spatialNeedsImmediateVolumeUpdate = false;
          return;
        }

        this.spatialSoundSources.forEach((source) => {
          const radius = Math.max(0, source.maxRadius);
          if (radius <= 0) {
            this.applySpatialVolume(source, 0);
            return;
          }

          const distance = Phaser.Math.Distance.Between(
            player.x,
            player.y,
            source.x,
            source.y
          );

          if (!source.isAudible) {
            const enterThreshold = Math.max(0, radius - source.hysteresis);
            if (distance <= enterThreshold) {
              source.isAudible = true;
            }
          } else {
            const exitThreshold = radius + source.hysteresis;
            if (distance >= exitThreshold) {
              source.isAudible = false;
            }
          }

          const falloffValue = source.isAudible
            ? clamp01(source.falloff(distance, radius))
            : 0;
          const target = gain * source.baseVolume * falloffValue;
          this.applySpatialVolume(source, target);
        });

        this.spatialNeedsImmediateVolumeUpdate = false;
      }

      private teardownSpatialSounds(): void {
        if (this.sound && this.spatialUnlockListenerBound) {
          this.sound.off(
            Phaser.Sound.Events.UNLOCKED,
            this.handleSpatialSoundUnlock,
            this
          );
          this.spatialUnlockListenerBound = false;
        }

        this.spatialSoundSources.forEach((source) => {
          try {
            if (source.sound.isPlaying || source.sound.isPaused) {
              source.sound.stop();
            }
          } catch {}
          try {
            source.sound.destroy();
          } catch {}
        });
        this.spatialSoundSources.clear();
        this.spatialNeedsImmediateVolumeUpdate = false;
      }

      private bindHoldToActivateHandlers(
        sprite: any,
        getTarget: () => { x: number; y: number; radius: number } | null,
        onActivate: () => void,
        options: {
          holdMs?: number;
          idleWindowMs?: number;
          sfxKey?: string;
          sfxVolume?: number;
          ringRadius?: number;
          ringColor?: number;
        } = {}
      ) {
        let holdTimer: Phaser.Time.TimerEvent | null = null;
        let ring: Phaser.GameObjects.Graphics | null = null;
        let holdStart = 0;

        const getPlayerState = () => {
          return this.room?.state.players.get(this.room?.sessionId || '');
        };

        const holdMs = options.holdMs ?? 2000;
        const idleWindowMs = options.idleWindowMs ?? 250;
        const ringRadius = options.ringRadius ?? 42;
        const ringColor = options.ringColor ?? 0x49cc90;

        const isIdle = () => {
          const player = getPlayerState();
          if (!player) return false;
          return Date.now() - (player.lastMoveTime || 0) >= idleWindowMs;
        };

        const inRange = () => {
          const target = getTarget();
          if (!target) return false;
          const me = this.playerEntities?.[this.room?.sessionId || ''];
          if (!me) return false;
          const d = Math.hypot(me.x - target.x, me.y - target.y);
          return d <= target.radius;
        };

        const cleanup = () => {
          if (holdTimer) {
            holdTimer.remove(false);
            holdTimer = null;
          }
          if (ring) {
            ring.destroy();
            ring = null;
          }
          holdStart = 0;
        };

        const drawRing = (t: number) => {
          const target = getTarget();
          if (!target) return;
          const g =
            ring ?? (ring = this.add.graphics({ x: target.x, y: target.y }));
          g.setDepth(target.y + 10);
          g.clear();
          g.lineStyle(6, ringColor, 1);
          g.beginPath();
          g.arc(
            0,
            0,
            ringRadius,
            -Math.PI / 2,
            -Math.PI / 2 + t * Math.PI * 2,
            false
          );
          g.strokePath();
        };

        const onDown = () => {
          const target = getTarget();
          if (!target) return;
          if (options.sfxKey) {
            try {
              this.playSFX(options.sfxKey, options.sfxVolume ?? 0.6);
            } catch {}
          }
          // If out of range, path to target center on click
          if (!inRange()) {
            this.room?.send('moveTo', { x: target.x, y: target.y });
            return; // do not start hold until in-range
          }
          // Require short idle before starting a hold
          if (!isIdle()) return;
          holdStart = Date.now();
          holdTimer = this.time.addEvent({
            delay: 16,
            loop: true,
            callback: () => {
              if (!inRange() || !isIdle()) {
                cleanup();
                return;
              }
              const t = Math.min(1, (Date.now() - holdStart) / holdMs);
              drawRing(t);
              if (t >= 1) {
                cleanup();
                onActivate();
              }
            },
          });
        };

        const onUpOrCancel = () => {
          cleanup();
        };

        sprite.on('pointerdown', onDown);
        sprite.on('pointerup', onUpOrCancel);
        sprite.on('pointerout', onUpOrCancel);
        sprite.on('pointerupoutside', onUpOrCancel);
      }

      protected onProgressionXpAward(data: ProgressionXpAwardMessage) {
        super.onProgressionXpAward(data);

        if (!data || typeof data.amount !== 'number') {
          return;
        }

        const xpAmount = Math.round(data.amount);
        if (xpAmount <= 0) {
          return;
        }

        const sessionId = this.room?.sessionId;
        if (!sessionId) {
          return;
        }

        const text = `+${xpAmount} XP`;
        const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
          fontSize: '18px',
          color: '#55ff55',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4,
        };

        const container =
          this.entityManager?.getEntity(sessionId) ||
          this.playerEntities?.[sessionId];

        if (container && typeof (container as any).add === 'function') {
          this.spawnFloatingText(container, text, textStyle, {
            startY: -80,
            endY: -40,
            duration: 700,
          });
          return;
        }

        const playerState = this.room?.state.players.get(sessionId);
        if (!playerState) {
          return;
        }

        this.spawnFloatingTextAt(
          { x: playerState.x, y: playerState.y },
          text,
          textStyle,
          {
            startOffsetY: -80,
            endOffsetY: -40,
            duration: 700,
            depth: playerState.y,
          }
        );
      }

      private showTokenPickupFloatingText(container: any, item: any) {
        if (!container) return;
        const isUsdc =
          item?.type === 'coin' &&
          typeof item?.usdcAmount === 'number' &&
          Number.isFinite(item.usdcAmount);

        const duration = 2000;
        const fontSize = '18px';

        if (isUsdc) {
          const usdc = Number(item.usdcAmount);
          const text = `+$${usdc.toFixed(2)} USDC`;
          this.spawnFloatingText(
            container,
            text,
            { fontSize, color: '#66E0FF', fontStyle: 'bold' },
            { startY: -60, endY: -100, duration }
          );
          return;
        }

        const tokenName = String(item?.name || 'Token');
        const qty = Number(item?.quantity ?? 0);
        const color =
          tokenName.toUpperCase() === 'GHST' ? '#A78BFA' : '#FFD966';
        const text = `+${qty} ${tokenName}`;

        this.spawnFloatingText(
          container,
          text,
          { fontSize, color, fontStyle: 'bold' },
          { startY: -60, endY: -100, duration }
        );
      }

      async create() {
        try {
          debugLog('🎮 LocalGameScene: Starting creation...');

          (this as any).setHostSessionIdCallback = setHostSessionId;
          (this as any).setClientSessionIdCallback = setClientSessionId;

          // Call parent create method first (handles world setup and server connection)
          await super.create();

          debugLog('✅ LocalGameScene: Parent create completed successfully');

          // Store React state setters for UI communication (LocalGameScene specific)
          // Allow scene to update floor index back to React state
          (this as any).setFloorIndexCallback = setFloorIndex;
          // Track portals opened state for quest logic
          (this as any).setPortalsOpenedCallback = setPortalsOpened;
          // Hook to increment per-run tongues from scene
          (this as any).incrementRunTongues = (amount: number) => {
            try {
              if (typeof incrementRunTongues === 'function') {
                incrementRunTongues(amount);
              }
            } catch {}
          };

          if (process.env.NODE_ENV !== 'production' && this.input.keyboard) {
            const rKey = this.input.keyboard.addKey('R');
            rKey.on('down', () => {
              if (
                this.room?.state?.phase === 'in_game' &&
                this.room?.state?.runStartedAt > 0
              ) {
                window.dispatchEvent(new CustomEvent('show-run-summary'));
              }
            });
          }

          this.events.on('weapon:hud-update', (state: WeaponHudState) => {
            setWeaponHudState(state);
          });
          this.events.on('grenade:hud-update', (state: GrenadeHudState) => {
            setGrenadeState(state);
          });
          this.events.on('score:update', (state: ScoreHudState) => {
            setScoreState(state);
          });
          this.events.on('spell:hud-update', (state: SpellHudState) => {
            setSpellState(state);
          });
          if ((this as any).setupEnemyDifficultyListeners) {
            (this as any).setupEnemyDifficultyListeners();
          }
          // Clear any legacy Portal Guardian quest label on create
          setPortalQuestLabel('');

          this.events.once('shutdown', this.teardownSpatialSounds, this);
          this.events.once('destroy', this.teardownSpatialSounds, this);
          this.events.once('destroy', () => setSpellState({ spells: [] }));

          debugLog('🎮 LocalGameScene: Creation completed successfully');
        } catch (error) {
          console.error('❌ LocalGameScene: Failed to create scene:', error);

          // Surface error via React banner only; do not render in-canvas overlay
          if (typeof setError === 'function') {
            setError(
              error instanceof Error
                ? error.message
                : 'Failed to connect to game server'
            );
          }
        }
      }

      renderOfflineMode() {
        // Suppressed: no offline placeholder UI; background stays as-is
      }

      // Override to call React state handlers
      handleInventoryToggle() {
        handleInventoryToggle();
      }

      // Override to call React state handlers
      handleShopToggle() {
        handleShopToggle();
      }

      refreshAudioSettings(settings?: AudioSettings) {
        super.refreshAudioSettings(settings);
        this.spatialNeedsImmediateVolumeUpdate = true;
      }

      update(time: number, delta: number) {
        super.update(time, delta);
        this.updateSpatialSounds();
        this.updatePortalLabelVisibility();
      }

      attackEnemy(enemyId: string) {
        if (!this.room) return;

        debugLog('🗡️ Sending attack request to server for enemy:', enemyId);
        // Send attack request - server will validate and broadcast animation
        this.room.send('attack', {
          targetId: enemyId,
          seq: Date.now(),
          ts: Date.now(),
        });
      }

      getEnemyColor(enemyName: string): number {
        // Assign colors based on enemy names
        const colorMap: { [key: string]: number } = {
          'Boss Enemy': 0xff0000, // Red
          'Goblin Warrior': 0x00ff00, // Green
          'Shadow Beast': 0x444444, // Dark Gray
          'Fire Demon': 0xff4400, // Orange-Red
          'Ice Troll': 0x00ffff, // Cyan
          'Dark Wizard': 0x8800ff, // Purple
          'Stone Golem': 0x888888, // Gray
          'Poison Spider': 0x88ff00, // Lime Green
          'Lightning Wolf': 0xffff00, // Yellow
          'Bone Knight': 0xffffff, // White
          'Crystal Dragon': 0xff00ff, // Magenta
        };

        return colorMap[enemyName] || 0xff0000; // Default to red if name not found
      }

      // switchWeapon method removed - using inherited version from GameScene
      // The first switchWeapon override (line 210) calls super.switchWeapon() properly

      updateRangeIndicator() {
        const currentPlayer = this.entityManager?.getEntity(
          this.room?.sessionId
        );
        if (!currentPlayer) return;

        // Remove existing range indicator
        if (this.rangeIndicator) {
          this.rangeIndicator.destroy();
          this.rangeIndicator = null;
        }

        // Show range indicator for ranged weapon only
        if (this.weaponMode === 'ranged') {
          // Get character-specific attack range
          const attackRange = this.getPlayerAttackRange();

          this.rangeIndicator = this.add.circle(
            currentPlayer.x,
            currentPlayer.y,
            attackRange, // Use character-specific range
            0x00ff00, // Green color
            0.1 // Low alpha for transparency
          );
          this.rangeIndicator.setStrokeStyle(2, 0x00ff00, 0.5);
          this.registerMinimapIgnore(this.rangeIndicator);

          debugLog(
            `🎯 Created range indicator with ${attackRange}px range for ${this.weaponMode} mode`
          );
        }
      }

      // Create a red aura under the enemy (intense selection indicator)
      createSelectedIndicatorForEnemy(enemyId: string) {
        if (!this.entityManager || !this.entityManager.hasEntity(enemyId)) {
          return null;
        }
        // Ensure any previous selection visuals are removed
        this.clearSelectedIndicatorForEnemy(enemyId);

        // Add a red aura using the same system as players, but stronger
        this.entityManager.addAuraToEntity(enemyId, {
          color: '#ff3333',
          level: 4,
        });

        // Intensify aura visuals
        const aura: any = this.entityManager.getEntityElement(enemyId, 'light');
        if (aura && typeof aura.setAlpha === 'function') {
          aura.setAlpha(1.0);
          this.tweens.add({
            targets: aura,
            scale: 1.15,
            duration: 450,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }

        return aura;
      }

      // Remove selection indicator from an enemy (aura or FX)
      clearSelectedIndicatorForEnemy(enemyId: string) {
        if (!this.entityManager || !this.entityManager.hasEntity(enemyId)) {
          return;
        }
        // Remove aura if present
        this.entityManager.removeElementFromEntity(enemyId, 'light');
        // Clear preFX outlines if present
        const sprite: any = this.entityManager.getEntityElement(
          enemyId,
          'enemySprite'
        );
        try {
          const preFX = (sprite as any)?.preFX;
          if (preFX && typeof preFX.clear === 'function') {
            preFX.clear();
          }
        } catch {}
      }

      private applyEnemyDeathInstant(enemyId: string) {
        try {
          // Check if this is the Portal Guardian; if so, hold the sprite with flicker/shake until loot is ready.
          let isPortalGuardian = false;
          try {
            const enemyState = this.room?.state.enemies.get(enemyId);
            const enemyType = enemyState?.enemyType as string | undefined;
            isPortalGuardian =
              enemyType === 'portal_guardian' ||
              (enemyState?.name as any) === 'Portal Guardian';
          } catch {}

          // Play death animation immediately if available
          const hasSprite =
            this.enemySpriteManager &&
            typeof this.enemySpriteManager.getEnemySprite === 'function' &&
            this.enemySpriteManager.getEnemySprite(enemyId);
          if (hasSprite && this.enemySpriteManager) {
            if (isPortalGuardian) {
              this.startPortalGuardianDeathHold(enemyId);
            } else {
              this.enemySpriteManager.playEnemyAnimation(enemyId, 'death');
            }
          }

          // Fade out HP bar smoothly
          const hpBarContainer = this.entityManager?.getEntityElement(
            enemyId,
            'hpBarContainer'
          );
          if (
            hpBarContainer &&
            typeof hpBarContainer.setAlpha === 'function' &&
            !hpBarContainer.getData('deathFadeStarted')
          ) {
            hpBarContainer.setData('deathFadeStarted', true);
            this.tweens.add({
              targets: hpBarContainer,
              alpha: 0,
              duration: 1000,
              ease: 'Power2.easeOut',
            });
          }

          // Play a per-enemy death SFX once, matching helper behavior
          const container = this.entityManager?.getEntity(enemyId);
          const schedulePlay = (key: string) => {
            const tryPlay = () => this.playSFX(key, 0.8);
            try {
              if (this.time && typeof this.time.delayedCall === 'function') {
                this.time.delayedCall(60, tryPlay);
              } else {
                setTimeout(tryPlay, 60);
              }
            } catch {
              tryPlay();
            }
          };

          if (container) {
            if (!container.getData('deathSoundPlayed')) {
              let deathSfxKey: string = 'enemy_dead';
              try {
                const enemyState = this.room?.state.enemies.get(enemyId);
                const enemyType = enemyState?.enemyType as string | undefined;
                const mapped = enemyType
                  ? (CLIENT_ENEMY_TYPES?.[enemyType]?.deathSound as
                      | string
                      | undefined)
                  : undefined;
                if (mapped && typeof mapped === 'string') deathSfxKey = mapped;
              } catch {}
              // Mark as played before scheduling to avoid double scheduling
              container.setData('deathSoundPlayed', true);
              this.playedDeathSfxEnemyIds.add(enemyId);
              schedulePlay(deathSfxKey);
            }
          } else {
            // If entity container was already destroyed, ensure we still play once per enemy
            if (!this.playedDeathSfxEnemyIds.has(enemyId)) {
              let deathSfxKey: string = 'enemy_dead';
              try {
                const enemyState = this.room?.state.enemies.get(enemyId);
                const enemyType = enemyState?.enemyType as string | undefined;
                const mapped = enemyType
                  ? (CLIENT_ENEMY_TYPES?.[enemyType]?.deathSound as
                      | string
                      | undefined)
                  : undefined;
                if (mapped && typeof mapped === 'string') deathSfxKey = mapped;
              } catch {}
              this.playedDeathSfxEnemyIds.add(enemyId);
              schedulePlay(deathSfxKey);
            }
          }

          // Clear selection indicator if this was the current target
          if (this.currentSelectedTargetId === enemyId) {
            this.clearSelectedIndicatorForEnemy(enemyId);
            this.currentSelectedTargetId = null;
          }
        } catch {}
      }

      private startPortalGuardianDeathHold(enemyId: string) {
        const sprite: any =
          this.enemySpriteManager?.getEnemySprite(enemyId) ||
          this.entityManager?.getEntityElement(enemyId, 'enemySprite');
        if (!sprite) return;
        if (sprite.getData && sprite.getData('pgDeathHoldActive')) return;

        try {
          sprite.setData?.('pgDeathHoldActive', true);
        } catch {}

        // Subtle flicker tween
        const flicker = this.tweens.add({
          targets: sprite,
          alpha: { from: 1, to: 0.4 },
          duration: 160,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        // Gentle shake tween (angle oscillation)
        const shake = this.tweens.add({
          targets: sprite,
          angle: { from: -2, to: 2 },
          duration: 140,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        try {
          sprite.setData?.('pgFlickerTween', flicker);
          sprite.setData?.('pgShakeTween', shake);
        } catch {}
      }

      private stopPortalGuardianDeathHoldAndFade(enemyId: string) {
        const sprite: any =
          this.enemySpriteManager?.getEnemySprite(enemyId) ||
          this.entityManager?.getEntityElement(enemyId, 'enemySprite');
        if (sprite) {
          try {
            const flicker = sprite.getData?.('pgFlickerTween');
            const shake = sprite.getData?.('pgShakeTween');
            if (flicker && typeof flicker.stop === 'function') flicker.stop();
            if (shake && typeof shake.stop === 'function') shake.stop();
            sprite.setData?.('pgFlickerTween', null);
            sprite.setData?.('pgShakeTween', null);
            sprite.setData?.('pgDeathHoldActive', false);
            // Reset visual state before final fade
            if (typeof sprite.setAlpha === 'function') sprite.setAlpha(1);
            if (typeof sprite.setAngle === 'function') sprite.setAngle(0);
          } catch {}
        }
        // Play the standard death fade now
        try {
          this.enemySpriteManager?.playEnemyAnimation(enemyId, 'death');
        } catch {}
      }

      // Helper function to calculate normalized scale for wearables
      calculateWearableScale(texture: Phaser.Textures.Texture): number {
        const targetSize = 64; // Target size in pixels
        const textureWidth = texture.source[0].width;
        const textureHeight = texture.source[0].height;
        const maxDimension = Math.max(textureWidth, textureHeight);
        // The texture is now 4x larger than the original SVG, so we need to scale it down
        // to achieve the target size. The original logic still applies, just with the larger dimensions.
        return targetSize / maxDimension;
      }

      // Clear all tree data and visual elements for room transitions
      clearTrees() {
        // Clear position data
        this.environmentSystem.treePositions = [];

        // Clear all tree visual elements (they have depth -0.5)
        const allChildren = this.children.getAll();
        let treeElementsRemoved = 0;

        allChildren.forEach((child: any) => {
          if (child.depth === -0.5) {
            child.destroy();
            treeElementsRemoved++;
          }
        });

        debugLog(
          `🌳 Cleared ${treeElementsRemoved} tree elements for room transition`
        );
      }

      // Helper function to load SVG at high resolution for crisp rendering
      loadHighResSVG(textureKey: string, svgUrl: string, callback: () => void) {
        const img = new Image();
        img.onload = () => {
          // Create a high-resolution canvas (4x the original size for crisp rendering)
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const scale = 4; // 4x resolution for crisp rendering

          canvas.width = img.width * scale;
          canvas.height = img.height * scale;

          if (ctx) {
            // Enable high-quality rendering
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Draw the SVG at high resolution
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            // Convert canvas to data URL and load as texture
            const dataUrl = canvas.toDataURL('image/png');
            this.load.image(textureKey, dataUrl);
            this.load.once('complete', callback);
            this.load.start();
          }
        };
        img.src = svgUrl;
      }

      createDroppedItem(x: number, y: number, item: InventoryItem) {
        const droppedItemId = `dropped_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let itemSprite: Phaser.GameObjects.GameObject;

        // Create visual representation of dropped item
        if (item.type === 'wearable' && item.imageUrl && item.wearableId) {
          // Try to load and display the wearable image
          const textureKey = `wearable_${item.wearableId}`;

          // Check if texture is already loaded
          if (this.textures.exists(textureKey)) {
            // Use existing texture
            itemSprite = this.add.image(x, y, textureKey);
            // Scale to fit within 64x64 while preserving aspect ratio
            const texture = this.textures.get(textureKey);
            const normalizedScale = this.calculateWearableScale(texture);
            (itemSprite as Phaser.GameObjects.Image).setScale(normalizedScale);
            debugLog(
              `✅ Using cached texture for wearable ${item.wearableId} with scale ${normalizedScale}`
            );
          } else {
            // Create placeholder first
            itemSprite = this.add.rectangle(
              x,
              y,
              32,
              32,
              parseInt(item.color.replace('#', '0x'))
            );
            (itemSprite as Phaser.GameObjects.Rectangle).setStrokeStyle(
              1,
              0xffffff
            );

            // Add star indicator for wearables
            const star = this.add
              .text(x + 8, y - 8, '★', {
                fontSize: '8px',
                color: '#FFD700',
              })
              .setOrigin(0.5);
            itemSprite.setData('starIndicator', star);

            // Load the SVG at high resolution for crisp rendering
            this.loadHighResSVG(textureKey, item.imageUrl, () => {
              if (
                this.droppedItemEntities[droppedItemId] &&
                this.textures.exists(textureKey)
              ) {
                const oldSprite = this.droppedItemEntities[droppedItemId];
                const itemData = oldSprite.getData('itemData');
                const starIndicator = oldSprite.getData('starIndicator');

                // Destroy old elements
                if (starIndicator) starIndicator.destroy();
                oldSprite.destroy();

                // Create new image sprite
                const imageSprite = this.add.image(x, y, textureKey);
                // Scale to fit within 64x64 while preserving aspect ratio
                const texture = this.textures.get(textureKey);
                const normalizedScale = this.calculateWearableScale(texture);
                imageSprite.setScale(normalizedScale);
                imageSprite.setData('itemData', itemData);

                // Update reference with correct format
                this.droppedItemEntities[droppedItemId] = {
                  sprite: imageSprite,
                  x: x,
                  y: y,
                  type: item.type,
                  itemData: itemData,
                };

                debugLog(`✅ Loaded wearable image for ${item.name}`);
              }
            });
          }
        } else {
          // Use colored rectangle for non-wearable items
          itemSprite = this.add.rectangle(
            x,
            y,
            32,
            32,
            parseInt(item.color.replace('#', '0x'))
          );
          (itemSprite as Phaser.GameObjects.Rectangle).setStrokeStyle(
            1,
            0xffffff
          );
        }

        // Store references
        itemSprite.setData('itemData', item);

        // Store in the format expected by ItemSystem.pickupItem()
        this.droppedItemEntities[droppedItemId] = {
          sprite: itemSprite,
          x: x,
          y: y,
          type: item.type,
          itemData: item,
        };

        // Add to dropped items state
        const droppedItem: DroppedItem = {
          id: droppedItemId,
          x: x,
          y: y,
          item: item,
        };
        setDroppedItems((prev) => [...prev, droppedItem]);
      }

      // checkItemPickup method inherited from base GameScene which uses ItemSystem

      async loadPlayerSprite(sessionId: string, player: any) {
        // Use the parent class method that handles both character and Aavegotchi sprites
        await super.loadPlayerSprite(sessionId, player);
        return; // Exit early to avoid the Aavegotchi-only code below
      }

      // Mobile input handlers
      handleMobileInput(input: {
        left: boolean;
        right: boolean;
        up: boolean;
        down: boolean;
        sprint: boolean;
      }) {
        // Delegate to base without additional flags
        super.handleMobileInput(input);
      }

      handleMobileAttack() {}

      setSprintMode(isSprinting: boolean) {
        // Delegate to base without additional flags
        super.setSprintMode(isSprinting);
      }

      clearAllEntities() {
        debugLog('Clearing all entities before room transition...');

        this.setMinimapFollowTarget(null);

        if (this.entityManager) {
          debugLog(
            'Entity count to clear:',
            this.entityManager.getEntityCount()
          );

          // Clean up special data before clearing entities
          const allEntityIds = this.entityManager.getAllEntityIds();
          allEntityIds.forEach((entityId) => {
            const playerSprite = this.entityManager!.getEntityElement(
              entityId,
              'playerSprite'
            );
            const container = this.entityManager!.getEntity(entityId);

            if (playerSprite) {
              const flashTimeout = container?.getData('flashTimeout');
              const shadow = playerSprite.getData('shadow');
              const floatTween = playerSprite.getData('floatTween');
              const shadowTween = playerSprite.getData('shadowTween');

              // Clean up timeout to prevent memory leaks
              if (flashTimeout) {
                clearTimeout(flashTimeout);
              }

              // Clean up tweens to prevent memory leaks
              if (floatTween) {
                this.tweens.remove(floatTween);
              }
              if (shadowTween) {
                this.tweens.remove(shadowTween);
              }

              if (shadow) shadow.destroy();
            }
          });

          // Clear all entities at once
          this.entityManager.clearAllEntities();
          this.slowTintedEntities.clear();
          this.pendingSlowTintIds.clear();
          this.clearAllStunLabels();
          this.pendingStunLabelIds.clear();
        }

        // Clear legacy entity references
        this.playerEntities = {};
        this.enemyEntities = {};

        // Clear projectile entities
        for (const projectileId in this.projectileEntities) {
          if (this.projectileEntities[projectileId]) {
            this.projectileEntities[projectileId].destroy();
          }
        }
        this.projectileEntities = {};

        // Clear dropped item entities
        for (const itemId in this.droppedItemEntities) {
          if (this.droppedItemEntities[itemId]) {
            const itemData = this.droppedItemEntities[itemId];
            // Handle both old format (direct sprite) and new format (object with sprite property)
            if (
              itemData.sprite &&
              typeof itemData.sprite.destroy === 'function'
            ) {
              itemData.sprite.destroy();
            } else if (typeof itemData.destroy === 'function') {
              // Legacy format - direct sprite reference
              itemData.destroy();
            }
          }
        }
        this.droppedItemEntities = {};

        // Clear treasure chest entities
        for (const chestId in this.treasureChestEntities) {
          if (this.treasureChestEntities[chestId]) {
            this.treasureChestEntities[chestId].destroy();
          }
        }
        this.treasureChestEntities = {};

        // Clear special/wall entities rendered via renderSpecial
        if (this.specialEntities) {
          for (const specialId in this.specialEntities) {
            const sprite = this.specialEntities[specialId];
            if (sprite && typeof sprite.destroy === 'function') {
              sprite.destroy();
            }
          }
          this.specialEntities = {};
        }

        // Clear server-side tree entities
        for (const treeId in this.treeEntities) {
          if (this.treeEntities[treeId]) {
            this.treeEntities[treeId].destroy();
          }
        }
        this.environmentSystem.treeEntities = {};

        // Clear range indicator
        if (this.rangeIndicator) {
          this.rangeIndicator.destroy();
          this.rangeIndicator = null;
        }

        // Clear tree data and visual elements for room transition
        this.clearTrees();

        // Comprehensive cleanup: Remove any leftover dynamic visual elements
        debugLog('🧹 Performing comprehensive visual cleanup...');
        const remainingChildren = this.children.getAll();
        let removedCount = 0;

        remainingChildren.forEach((child: any) => {
          // Only destroy dynamic objects, not static background elements
          if (child.type === 'Text') {
            // Remove any text that looks like player/enemy labels
            const text = child.text || '';
            if (
              text.includes('HP:') ||
              text.includes('Player') ||
              text.includes('YOU') ||
              text.includes('Bot') ||
              text.includes('MELEE') ||
              text.includes('RANGED') ||
              text.includes('Wolf') ||
              text.includes('Spider') ||
              text.includes('Demon') ||
              text.includes('Golem') ||
              text.includes('Knight')
            ) {
              child.destroy();
              removedCount++;
            }
          } else if (child.type === 'Shape') {
            // Remove circles that might be leftover auras (but keep static elements)
            if (child.geom && child.geom.type === 1) {
              // Circle type
              // Check if it's likely an aura (large radius)
              if (child.radius && child.radius > 50) {
                child.destroy();
                removedCount++;
              }
            }
          }
        });

        debugLog(`🗑️ Removed ${removedCount} leftover visual elements`);
        debugLog('✅ Entity clearing complete');
      }

      // hashString method inherited from base GameScene via EnvironmentSystem

      setupRoomHandlers() {
        if (!this.room) return;

        super.setupRoomHandlers();

        // Set up non-state-dependent handlers immediately
        this.setupMessageHandlers();

        // Set up state listeners immediately with null checks for problematic collections
        debugLog('🎯 Setting up state listeners with defensive checks...');
        this.setupStateListeners();
      }

      setupMessageHandlers() {
        debugLog('🔧 Setting up room handlers...');

        // Clear transition flag - we're setting up a new room
        this.isTransitioning = false;

        // Set connection status to connected since we successfully joined
        if (typeof this.config.onConnectionStatusChange === 'function') {
          debugLog('🟢 Setting connection status to connected');
          this.config.onConnectionStatusChange('connected');
        }

        this.room.onMessage('player_action_animation', (data: any) => {
          const {
            sessionId,
            timestamp,
            direction,
            actionType,
            animation,
            targetId,
            interval,
          } = data;

          // For attacks, rely on attack_started/damage_applied model
          if (actionType === 'attack_enemy') {
            return;
          }

          // Play the action's specified animation when server confirms
          // Lock player animation to prevent overrides until interval elapses
          const lockKey = `animLock_${sessionId}`;
          const existingLock = this.registry.get(lockKey);
          if (existingLock) {
            this.time.removeEvent(existingLock);
          }
          this.updatePlayerAnimation(sessionId, animation, direction, interval);
          if (typeof interval === 'number' && interval > 0) {
            const timer = this.time.delayedCall(interval, () => {
              this.registry.set(lockKey, null);
              // Immediately resync to authoritative server state after lock ends
              const p = this.room?.state.players.get(sessionId);
              if (p) {
                this.updatePlayerAnimation(
                  sessionId,
                  p.anim || 'idle',
                  p.dir || 'down'
                );
              }
            });
            this.registry.set(lockKey, timer);
          }

          // Play character-specific attack sounds
          const playerState = this.room?.state.players.get(sessionId);

          //todo: refactor this into character.ts later
          if (
            playerState &&
            actionType === 'attack_enemy' &&
            animation === 'attack'
          ) {
            // Play slash sound for bushidogotchi melee attacks
            if (playerState.characterId === 'bushidogotchi') {
              this.playSFX('slash', 0.8);
            }
          }
        });

        this.room.onMessage('player_action_complete', (data: any) => {
          const { sessionId, timestamp, actionType } = data;

          // Return to idle when action completes
          const playerState = this.room.state.players.get(sessionId);
          if (playerState) {
            // Respect animation lock
            const lockKey = `animLock_${sessionId}`;
            if (this.registry.get(lockKey)) {
              return;
            }
            this.updatePlayerAnimation(
              sessionId,
              'idle',
              playerState.dir,
              undefined
            );
          }
        });

        this.room.onMessage('weapon_switched', (data: any) => {
          if (data && typeof data.attackType === 'string') {
            this.weaponMode = data.attackType;
            // Refresh cached range from server-derived stats when weapon changes
            try {
              const me = this.room?.state.players.get(this.room?.sessionId);
              const ds =
                me && typeof (me as any).derivedStats === 'string'
                  ? JSON.parse((me as any).derivedStats || '{}')
                  : null;
              if (ds) {
                const v =
                  this.weaponMode === 'ranged'
                    ? Number(ds?.rangedAttackRange)
                    : Number(ds?.meleeAttackRange);
                if (Number.isFinite(v) && v > 0) {
                  this.serverAttackRangeCache = Math.floor(v);
                }
              }
            } catch {}
            this.updateRangeIndicator();
          }
          if (data && typeof data.activeIndex === 'number') {
            try {
              this.handleServerWeaponSelection(data.activeIndex);
            } catch (error) {
              console.warn('Failed to apply server weapon selection', error);
            }
          }
        });

        this.room.onMessage(
          'player_healed',
          (data: ServerToClientMessages['player_healed']) => {
            const { playerId, healAmount, currentHp, maxHp, source } = data;

            if (
              playerId &&
              typeof healAmount === 'number' &&
              Number.isFinite(healAmount) &&
              healAmount > 0
            ) {
              const container = this.entityManager?.getEntity(playerId);
              if (container) {
                this.spawnFloatingText(
                  container,
                  `+${healAmount}`,
                  {
                    fontSize: '16px',
                    color: '#4ADE80',
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 3,
                  },
                  { startY: -70, endY: -95 }
                );
              }
            }

            debugLog(
              `🍷 Player healed: +${healAmount} HP (${currentHp}/${maxHp}) via ${source || 'unknown'}`
            );
          }
        );

        this.room.onMessage(
          'player_mana_restored',
          (data: ServerToClientMessages['player_mana_restored']) => {
            const { playerId, manaAmount, currentMana, maxMana } = data;
            if (
              playerId &&
              typeof manaAmount === 'number' &&
              Number.isFinite(manaAmount) &&
              manaAmount > 0
            ) {
              const container = this.entityManager?.getEntity(playerId);
              if (container) {
                this.spawnFloatingText(
                  container,
                  `+${manaAmount}`,
                  {
                    fontSize: '16px',
                    color: '#60A5FA',
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 3,
                  },
                  { startY: -70, endY: -95 }
                );
              }
            }

            debugLog(
              `🔮 Player mana restored: +${manaAmount} MP (${currentMana}/${maxMana})`
            );
          }
        );

        // Life Steal heal feedback for players
        this.room.onMessage(
          'life_steal_heal',
          (data: ServerToClientMessages['life_steal_heal']) => {
            const { playerId, healAmount } = data;
            if (!playerId || typeof healAmount !== 'number') return;
            const container = this.entityManager?.getEntity(playerId);
            if (container && healAmount > 0) {
              this.spawnFloatingText(
                container,
                `+${healAmount}`,
                {
                  fontSize: '16px',
                  color: '#55ff55',
                  fontStyle: 'bold',
                  stroke: '#000000',
                  strokeThickness: 3,
                },
                { startY: -70, endY: -90 }
              );
            }
            // Player HUD will update from authoritative state; this shows visual feedback only
          }
        );

        // Life Steal heal feedback for enemies
        this.room.onMessage(
          'life_steal_heal_enemy',
          (data: ServerToClientMessages['life_steal_heal_enemy']) => {
            const { enemyId, healAmount } = data;
            if (!enemyId || typeof healAmount !== 'number') return;
            const container = this.entityManager?.getEntity(enemyId);
            if (container && healAmount > 0) {
              this.spawnFloatingText(container, `+${healAmount}`, {
                fontSize: '16px',
                color: '#55ff55',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 3,
              });
            }
          }
        );

        this.room.onMessage(
          'status_applied',
          (data: ServerToClientMessages['status_applied']) => {
            if (!data || !data.targetId) return;
            const targetId = String(data.targetId);
            switch (data.type) {
              case 'slow':
                this.applySlowTint(targetId);
                break;
              case 'stun':
                this.showStunLabel(targetId);
                break;
              default:
                break;
            }
          }
        );

        this.room.onMessage(
          'status_removed',
          (data: ServerToClientMessages['status_removed']) => {
            if (!data || !data.targetId) return;
            const targetId = String(data.targetId);
            switch (data.type) {
              case 'slow':
                this.clearSlowTint(targetId);
                break;
              case 'stun':
                this.clearStunLabel(targetId);
                break;
              default:
                break;
            }
          }
        );

        // Replace enemy_damaged flow with start+apply model
        this.room.onMessage(
          'attack_started',
          (data: ServerToClientMessages['attack_started']) => {
            const {
              attackerId,
              targetId,
              timestamp,
              durationMs,
              hitOffsetMs,
              direction,
              weaponType,
            } = data;

            if (!attackerId || !targetId) {
              return;
            }

            const lastKey = `lastAttackStart_${attackerId}`;
            const lastTs = this.registry.get(lastKey) || 0;
            if (lastTs && lastTs === timestamp) {
              return;
            }
            this.registry.set(lastKey, timestamp);

            const anim = weaponType === 'ranged' ? 'attack_ranged' : 'attack';
            this.updatePlayerAnimation(attackerId, anim, direction, durationMs);

            const lockKey = `animLock_${attackerId}`;
            const existingLock = this.registry.get(lockKey);
            if (existingLock) {
              this.time.removeEvent(existingLock);
            }

            if (typeof durationMs === 'number' && durationMs > 0) {
              const timer = this.time.delayedCall(durationMs, () => {
                this.registry.set(lockKey, null);
                const p = this.room?.state.players.get(attackerId);
                if (p) {
                  this.updatePlayerAnimation(
                    attackerId,
                    p.anim || 'idle',
                    p.dir || 'down'
                  );
                }
              });
              this.registry.set(lockKey, timer);
            }

            const attackerContainer = this.entityManager?.getEntity(attackerId);
            const attackerSprite = attackerContainer?.getData('playerSprite');
            if (
              attackerSprite &&
              attackerSprite.anims &&
              typeof durationMs === 'number' &&
              durationMs > 0
            ) {
              const clientNow = Date.now();
              const norm = Math.max(
                0,
                Math.min(0.99, (clientNow - timestamp) / durationMs)
              );
              try {
                attackerSprite.anims.setProgress(norm);
              } catch {}
            }

            if (weaponType !== 'ranged') {
              const clientNow = Date.now();
              const delay = Math.max(0, timestamp + hitOffsetMs - clientNow);
              this.time.delayedCall(delay, () => {
                try {
                  this.playSFX('fastwoosh', 0.8);
                } catch {}

                const enemyState = this.room?.state.enemies.get(targetId);
                if (!enemyState) {
                  return;
                }

                const enemySprite =
                  this.enemySpriteManager?.getEnemySprite(targetId);
                if (enemySprite && this.enemySpriteManager) {
                  this.enemySpriteManager.playEnemyAnimation(targetId, 'hurt');
                } else {
                  const container = this.entityManager?.getEntity(targetId);
                  const rect = container?.getData('enemySprite');
                  if (rect && rect.setFillStyle) {
                    const originalColor =
                      rect.getData('originalColor') ||
                      this.getEnemyColor(enemyState.name);
                    if (!rect.getData('originalColor')) {
                      rect.setData('originalColor', originalColor);
                    }
                    rect.setFillStyle(0xcc4444);
                    setTimeout(() => {
                      if (rect && rect.setFillStyle) {
                        rect.setFillStyle(originalColor);
                      }
                    }, 150);
                  }
                }
              });
            }
          }
        );

        this.room.onMessage(
          'damage_applied',
          (data: ServerToClientMessages['damage_applied']) => {
            const {
              attackerId,
              targetId,
              timestamp,
              damage,
              hp,
              maxHp,
              weaponType,
              isCrit,
              killed,
            } = data;

            if (!targetId) {
              return;
            }

            const container = this.entityManager?.getEntity(targetId);
            if (container && typeof damage === 'number') {
              const lastHp = container.getData('lastHp') ?? hp + damage;
              if (lastHp - hp === damage) {
                const textStyle = isCrit
                  ? { fontSize: '20px', color: '#ff2222' }
                  : { fontSize: '16px', color: '#ff5555' };
                this.spawnFloatingText(
                  container,
                  `-${damage}${isCrit ? ' CRIT!' : ''}`,
                  {
                    fontSize: textStyle.fontSize,
                    color: textStyle.color,
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 4,
                  }
                );
              }
              container.setData('lastHp', hp);
            }

            const hpBarContainer = this.entityManager?.getEntityElement(
              targetId,
              'hpBarContainer'
            );
            if (hpBarContainer) {
              const hpBarFill = hpBarContainer.getData('hpBarFill');
              const percent =
                maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
              if (hpBarFill) {
                hpBarFill.scaleX = percent;
              }
              hpBarContainer.setVisible(percent < 1);
            }

            if (
              targetId === this.room?.sessionId &&
              typeof damage === 'number' &&
              damage > 0
            ) {
              this.playSFX('gotchihit', 0.8);
            }

            if (
              targetId === this.room?.sessionId &&
              weaponType === 'boss_charge' &&
              typeof damage === 'number' &&
              damage > 0
            ) {
              this.cameras.main?.shake(220, 0.006);
            }

            if (isCrit && attackerId === this.room?.sessionId) {
              const now = Date.now();
              if (!this.lastCritShakeAt || now - this.lastCritShakeAt > 120) {
                this.playSFX('crit', 0.9);
                this.cameras.main?.shake(140, 0.0025);
                this.lastCritShakeAt = now;
              }
            }

            if (killed && targetId && String(targetId).startsWith('enemy_')) {
              this.applyEnemyDeathInstant(targetId);
            }
          }
        );

        // Ranged path: server emits 'enemy_damaged' (includes isCrit)
        this.room.onMessage(
          'enemy_damaged',
          (data: ServerToClientMessages['enemy_damaged']) => {
            const { attackerId, isCrit, enemyId, killed } = data;

            if (isCrit && attackerId === this.room?.sessionId) {
              const now = Date.now();
              if (!this.lastCritShakeAt || now - this.lastCritShakeAt > 120) {
                this.playSFX('crit', 0.9);
                this.lastCritShakeAt = now;
              }
            }

            if (killed && enemyId) {
              this.applyEnemyDeathInstant(enemyId);
            }
          }
        );

        this.room.onMessage(
          'leverage:state',
          (data: ServerToClientMessages['leverage:state']) => {
            setLeverageState(data);
          }
        );

        this.room.onMessage(
          'leverage:error',
          (data: ServerToClientMessages['leverage:error']) => {
            if (typeof setLeverageError === 'function') {
              setLeverageError(data?.reason ?? 'leverage_error');
            }
          }
        );

        this.room.onMessage(
          'kill_count_updated',
          (data: ServerToClientMessages['kill_count_updated']) => {
            setRunKills?.(data.kills);
          }
        );

        this.room.onMessage(
          'attack_evaded',
          (data: ServerToClientMessages['attack_evaded']) => {
            const { targetId } = data;
            const container = this.entityManager?.getEntity(targetId);
            if (!container) {
              return;
            }

            this.spawnFloatingText(container, 'MISS', {
              fontSize: '16px',
              color: '#ff2222',
              fontStyle: 'bold',
              stroke: '#000000',
              strokeThickness: 4,
            });
          }
        );

        this.room.onMessage('player_auto_healed', (data: any) => {
          debugLog(
            `🚑 Player auto-healed: +${data.healAmount} HP (${data.currentHp}/${data.maxHp})`
          );

          // Show toast notification for auto-healing
          if (data.playerId === this.room?.sessionId) {
            // Create a special auto-heal toast item using HP potion sprite
            const autoHealToast: InventoryItem = {
              id: `auto_heal_${Date.now()}`,
              name: 'Auto-Heal',
              type: 'potion',
              quantity: data.healAmount,
              color: '#ff6b6b', // Red color to match the potion
              description: `Emergency healing activated! Restored ${data.healAmount} HP`,
              spriteId: 126, // Use HP potion sprite (126.svg)
            };
            setToastItem(autoHealToast);
            setTimeout(() => setToastItem(null), 4000); // Show for 4 seconds (longer than normal)
          }
        });

        this.room.onMessage(
          'inventory_updated',
          (data: ServerToClientMessages['inventory_updated']) => {
            debugLog('📦 Inventory updated from server:', data.inventory);
            // Sync the inventory from the server (this handles auto-healing inventory changes)
            setInventoryItems(
              mapInventoryMessagesToClientItems(data.inventory)
            );
          }
        );

        // Removed Portal Guardian quest flow

        this.room.onMessage(
          'portals_opened',
          (data: ServerToClientMessages['portals_opened']) => {
            debugLog('🌀 Portals opened!', data.message);

            // Only show a notification if a message was provided
            if (
              data &&
              typeof data.message === 'string' &&
              data.message.length > 0
            ) {
              const portalsOpenedNotification = {
                id: `portals_opened_${Date.now()}`,
                type: 'portals_opened' as const,
                message: data.message,
              };
              setToastNotification(portalsOpenedNotification);
              setTimeout(() => setToastNotification(null), 5000); // Show for 5 seconds
            }

            try {
              const floor = Number(data?.floorIndex) || 1;
              if (typeof (this as any).setFloorIndexCallback === 'function') {
                (this as any).setFloorIndexCallback(floor);
              }
              if (
                typeof (this as any).setPortalsOpenedCallback === 'function'
              ) {
                (this as any).setPortalsOpenedCallback(true);
              }
              if (floor <= 1) {
                setPortalQuestLabel('Quest: Find the next floor');
              } else {
                setPortalQuestLabel('Quest: Choose your path');
              }
            } catch {
              setPortalQuestLabel('Quest: Choose your path');
            }
          }
        );

        this.room.onMessage(
          'entered_new_map',
          (payload: ServerToClientMessages['entered_new_map']) => {
            // Clear quest label on new map; it will be set by portals_opened
            setPortalQuestLabel('');
            try {
              const nextFloor = Number(payload?.floorIndex);
              if (Number.isFinite(nextFloor) && nextFloor > 0) {
                setFloorIndex?.(Math.floor(nextFloor));
              }
            } catch {}
            if (typeof (this as any).setPortalsOpenedCallback === 'function') {
              (this as any).setPortalsOpenedCallback(false);
            }
          }
        );

        // Removed Portal Guardian spawn timer handling

        // Handle treasure chest opened confirmation
        this.room.onMessage('chest_opened', (data: any) => {
          const {
            chestId,
            lootSummary,
            rewardResult,
            spawnedItemCount,
            coins,
            loot,
            usdcReward,
          } = data || {};

          if (lootSummary) {
            debugLog('💥 Treasure chest erupted with loot!', {
              lootSummary,
              rewardResult,
            });
          } else {
          }

          // Ensure local sprite removal in case onRemove hasn't fired yet
          if (chestId && this.treasureChestEntities[chestId]) {
            this.treasureChestEntities[chestId].destroy();
            delete this.treasureChestEntities[chestId];
          }

          try {
            const state: any = this.room?.state;
            if (state?.inTreasureRoom) {
              setHasVictory(true);
            }
          } catch (error) {
            console.warn('Unable to determine treasure room state', error);
          }
        });

        // Handle boss room cleared (boss defeated)
        this.room.onMessage(
          'boss_room_cleared',
          (data: ServerToClientMessages['boss_room_cleared']) => {
            try {
              // For Portal Guardian we delay the dialog until 'boss_loot_ready'
              if (!data || data.enemyType !== 'portal_guardian') {
                setHasVictory(true);
              }
            } catch {}
          }
        );

        // Portal Guardian: loot ready -> stop flicker/shake and fade out the boss now
        this.room.onMessage(
          'boss_loot_ready',
          (data: ServerToClientMessages['boss_loot_ready']) => {
            if (data?.enemyId) {
              this.stopPortalGuardianDeathHoldAndFade(data.enemyId);
            }
            try {
              setHasVictory(true);
            } catch {}
          }
        );

        // Handle server-side item pickup (vacuum system)
        this.room.onMessage('item_pickup', (data: any) => {
          debugLog('🧲 Received item_pickup message from server:', data);

          const { itemId, item } = data || {};
          if (!item) {
            console.error('❌ item_pickup message missing item data');
            return;
          }

          debugLog(`✅ Processing pickup for item: ${item.name} (${itemId})`);

          // Track per-run tongue pickups (server-driven vacuum pickup)
          try {
            const isTongue =
              String(item?.type || '').toLowerCase() === 'material' &&
              (String(item?.name || '').toLowerCase() === 'lick tongue' ||
                String((item as any)?.itemType || '').toLowerCase() ===
                  'lick_tongue');
            if (
              isTongue &&
              typeof (this as any).incrementRunTongues === 'function'
            ) {
              (this as any).incrementRunTongues(
                Math.max(1, Math.floor((item as any).quantity || 1))
              );
            }
          } catch {}

          // Play pickup sound effect
          debugLog('🔊 Playing itempickup sound for item pickup');
          this.playSFX('itempickup', 0.6); // 60% volume for the pickup sound

          // Animate item to player before adding to inventory
          const localItem = this.droppedItemEntities[itemId];
          if (localItem && localItem.sprite) {
            const currentPlayer = this.playerEntities[this.room.sessionId];
            if (currentPlayer) {
              // Animate item flying to player
              this.tweens.add({
                targets: localItem.sprite,
                x: currentPlayer.x,
                y: currentPlayer.y,
                alpha: 0, // Fade out during pickup
                duration: 500, // Smooth pickup animation
                ease: 'Power2',
                onComplete: () => {
                  // Add to inventory after animation
                  addItemToInventory(item);
                  // Coins: show floating text (standardized) and suppress toasts
                  if (isCoinType(item.type)) {
                    const container = this.playerEntities[this.room.sessionId];
                    if (container)
                      this.showTokenPickupFloatingText(container, item);
                  } else {
                    showPickupToast(item);
                  }

                  // Clean up sprite
                  const starIndicator =
                    localItem.sprite.getData('starIndicator');
                  if (starIndicator) starIndicator.destroy();
                  localItem.sprite.destroy();
                  delete this.droppedItemEntities[itemId];
                  debugLog(
                    `🗑️ Cleaned up sprite for ${itemId} after animation`
                  );
                },
              });

              // Also animate star indicator if it exists
              const starIndicator = localItem.sprite.getData('starIndicator');
              if (starIndicator) {
                this.tweens.add({
                  targets: starIndicator,
                  x: currentPlayer.x,
                  y: currentPlayer.y - 20,
                  alpha: 0, // Fade out during pickup
                  duration: 500,
                  ease: 'Power2',
                });
              }
            } else {
              // Fallback: if player container isn't available, do not mutate
              // local inventory; rely on subsequent inventory_updated sync.
              const starIndicator = localItem.sprite.getData('starIndicator');
              if (starIndicator) starIndicator.destroy();
              localItem.sprite.destroy();
              delete this.droppedItemEntities[itemId];
            }
          } else {
            // No local sprite (shouldn't happen), just add to inventory
            debugLog(
              `ℹ️ No local sprite found for ${itemId}, adding directly to inventory`
            );
            addItemToInventory(item);
            if (isCoinType(item.type)) {
              const container = this.playerEntities[this.room.sessionId];
              if (container) this.showTokenPickupFloatingText(container, item);
            } else {
              showPickupToast(item);
            }
          }

          // Remove from dropped items state (cleanup for UI)
          setDroppedItems((prev) =>
            prev.filter((droppedItem) => droppedItem.item.id !== itemId)
          );
        });

        // Handle tree chopping feedback
        this.room.onMessage(
          'tree_chopped',
          (data: ServerToClientMessages['tree_chopped']) => {
            const { treeId, health, maxHealth } = data;
            debugLog(
              `🪓 Tree ${treeId} chopped: ${health}/${maxHealth} health remaining`
            );

            const treeSprite = this.treeEntities[treeId];
            if (treeSprite) {
              const chopText = this.add
                .text(treeSprite.x, treeSprite.y - 50, '🪓', {
                  fontSize: '20px',
                  color: '#ffffff',
                })
                .setOrigin(0.5);

              this.tweens.add({
                targets: chopText,
                y: treeSprite.y - 70,
                alpha: 0,
                duration: 800,
                onComplete: () => chopText.destroy(),
              });

              this.tweens.add({
                targets: treeSprite,
                x: treeSprite.x + 5,
                duration: 100,
                yoyo: true,
                repeat: 3,
                onComplete: () => {
                  treeSprite.x = treeSprite.x;
                },
              });
            }
          }
        );

        this.room.onMessage(
          'tree_cut_down',
          (data: ServerToClientMessages['tree_cut_down']) => {
            const { treeId, woodId, choppedBy } = data;
            debugLog(
              `🌳 Tree ${treeId} was cut down by ${choppedBy}, wood item: ${woodId}`
            );

            const treeSprite = this.treeEntities[treeId];
            if (treeSprite) {
              for (let i = 0; i < 5; i++) {
                const leaf = this.add.circle(
                  treeSprite.x + (Math.random() - 0.5) * 50,
                  treeSprite.y + (Math.random() - 0.5) * 50,
                  3,
                  0x228b22
                );

                this.tweens.add({
                  targets: leaf,
                  y: leaf.y + 50 + Math.random() * 50,
                  x: leaf.x + (Math.random() - 0.5) * 100,
                  alpha: 0,
                  duration: 1000 + Math.random() * 500,
                  onComplete: () => leaf.destroy(),
                });
              }

              const currentPlayerNameText =
                this.entityManager?.getEntityElement(
                  this.room.sessionId,
                  'nameText'
                );
              const currentPlayerName = currentPlayerNameText?.text;
              if (choppedBy === currentPlayerName) {
                const timberText = this.add
                  .text(treeSprite.x, treeSprite.y - 40, 'TIMBER!', {
                    fontSize: '24px',
                    color: '#ff6600',
                    fontWeight: 'bold',
                  })
                  .setOrigin(0.5);

                this.tweens.add({
                  targets: timberText,
                  y: timberText.y - 30,
                  alpha: 0,
                  duration: 1500,
                  onComplete: () => timberText.destroy(),
                });
              }
            }
          }
        );

        this.room.onMessage(
          'stone_chopped',
          (data: ServerToClientMessages['stone_chopped']) => {
            const { stoneId, health, maxHealth } = data;
            debugLog(
              `⛏️ Stone ${stoneId} chopped: ${health}/${maxHealth} health remaining`
            );

            const stoneSprite = this.stoneEntities[stoneId];
            if (stoneSprite) {
              const chopText = this.add
                .text(stoneSprite.x, stoneSprite.y - 50, '⛏️', {
                  fontSize: '20px',
                  color: '#ffffff',
                })
                .setOrigin(0.5);

              this.tweens.add({
                targets: chopText,
                y: stoneSprite.y - 70,
                alpha: 0,
                duration: 800,
                onComplete: () => chopText.destroy(),
              });

              this.tweens.add({
                targets: stoneSprite,
                x: stoneSprite.x + 3,
                duration: 80,
                yoyo: true,
                repeat: 4,
                onComplete: () => {
                  stoneSprite.x = stoneSprite.x;
                },
              });
            }
          }
        );

        this.room.onMessage(
          'stone_broken',
          (data: ServerToClientMessages['stone_broken']) => {
            const { stoneId, stoneDropId, brokenBy } = data;
            debugLog(
              `🪨 Stone ${stoneId} was broken by ${brokenBy}, stone drop: ${stoneDropId}`
            );

            const stoneSprite = this.stoneEntities[stoneId];
            if (stoneSprite) {
              for (let i = 0; i < 8; i++) {
                const debris = this.add.circle(
                  stoneSprite.x + (Math.random() - 0.5) * 50,
                  stoneSprite.y + (Math.random() - 0.5) * 50,
                  2 + Math.random() * 3,
                  0x696969
                );

                this.tweens.add({
                  targets: debris,
                  y: debris.y + 30 + Math.random() * 40,
                  x: debris.x + (Math.random() - 0.5) * 80,
                  alpha: 0,
                  duration: 1200 + Math.random() * 600,
                  onComplete: () => debris.destroy(),
                });
              }

              const currentPlayerNameText =
                this.entityManager?.getEntityElement(
                  this.room.sessionId,
                  'nameText'
                );
              const currentPlayerName = currentPlayerNameText?.text;
              if (brokenBy === currentPlayerName) {
                const smashText = this.add
                  .text(stoneSprite.x, stoneSprite.y - 40, 'SMASH!', {
                    fontSize: '24px',
                    color: '#ff8c00',
                    fontWeight: 'bold',
                  })
                  .setOrigin(0.5);

                this.tweens.add({
                  targets: smashText,
                  y: smashText.y - 30,
                  alpha: 0,
                  duration: 1500,
                  onComplete: () => smashText.destroy(),
                });
              }
            }
          }
        );
        // Handle room joined message
        this.room.onMessage('room_joined', (data: any) => {
          debugLog('Room joined:', data);
          if (typeof setCurrentRoomId === 'function') {
            setCurrentRoomId(data.roomId);
          }
          if (typeof setHostSessionId === 'function') {
            setHostSessionId(data.hostSessionId || '');
          }
          if (typeof setClientSessionId === 'function') {
            setClientSessionId(data.playerId || '');
          }
          if (typeof setPlayerCount === 'function') {
            const playerCountValue = Array.isArray(data.playerCount)
              ? data.playerCount.length
              : typeof data.playerCount === 'number'
                ? data.playerCount
                : this.room.state.players.size;
            setPlayerCount(playerCountValue);
          }

          if (typeof this.config.setMaxPlayers === 'function') {
            const maxPlayersValue = Number.isFinite(Number(data.maxPlayers))
              ? Number(data.maxPlayers)
              : null;
            this.config.setMaxPlayers(maxPlayersValue);
          }

          if (
            typeof setInventoryItems === 'function' &&
            Array.isArray(data.inventory)
          ) {
            setInventoryItems(data.inventory);
          }

          if (typeof this.config.onRoomJoined === 'function') {
            this.config.onRoomJoined({
              roomId: data.roomId,
              roomCode: data.roomCode,
              hostSessionId: data.hostSessionId,
              maxPlayers: data.maxPlayers,
              playerCount: data.playerCount,
              region: data.region,
              difficultyTier: data.difficultyTier,
            });
          }

          // Inform LoadingScene that the room is ready (sticky flag + event)
          try {
            this.game?.registry?.set('roomJoined', 1);
            this.game?.events?.emit('loading:room-joined');
          } catch {}

          const normalizedPhase =
            typeof data.phase === 'string' ? data.phase : 'in_game';
          if (typeof setRoomPhase === 'function') {
            const allowedPhases = new Set([
              'staging',
              'countdown',
              'in_game',
              'ended',
            ]);
            setRoomPhase(
              allowedPhases.has(normalizedPhase)
                ? (normalizedPhase as
                    | 'staging'
                    | 'countdown'
                    | 'in_game'
                    | 'ended')
                : 'in_game'
            );
          }

          if (typeof setCountdownEndsAt === 'function') {
            setCountdownEndsAt(Number(data.countdownEndsAt) || 0);
          }
          if (typeof setAutoCloseAt === 'function') {
            setAutoCloseAt(Number(data.autoCloseAt) || 0);
          }
          if (typeof setLateJoinCutoffAt === 'function') {
            setLateJoinCutoffAt(Number(data.lateJoinCutoffAt) || 0);
          }
          if (typeof setRunStartedAt === 'function') {
            setRunStartedAt(Number(data.runStartedAt) || 0);
          }
          if (typeof setStartedByPlayerId === 'function') {
            const starterId =
              typeof data.startedByPlayerId === 'string'
                ? data.startedByPlayerId
                : null;
            setStartedByPlayerId(starterId);
          }

          // Re-render floors with chunk layout from server
          if (data.chunkLayout && data.chunkLayout.length > 0) {
            const selectedChunks = selectChunksByDifficulty(
              data.difficultyTier || 'normal_1',
              data.phase,
              data.chunkLayout
            );
            // Determine chunk set key for debug display using the same helper
            const debugChunkSetKey = getChunkSetKeyForDifficulty(
              data.difficultyTier || 'normal_1',
              data.phase
            );

            debugLog(
              '🎯 Rendering floors with chunk layout from room_joined:',
              data.chunkLayout.length,
              'chunks for difficulty:',
              data.difficultyTier,
              'using',
              debugChunkSetKey
            );
            this.applyFloorLayout(selectedChunks, data.chunkLayout);
          } else {
            console.warn(
              '⚠️ No chunk layout in room_joined message - floor tiles will not be rendered'
            );
          }

          // Trees are now generated server-side, so we don't need client-side generation
          debugLog('🌳 Trees will be rendered from server entities');

          // Terrain is now handled by chunk-based floor system

          // Set connection status to connected
          if (typeof this.config.onConnectionStatusChange === 'function') {
            this.config.onConnectionStatusChange('connected');
          }

          // Update server region based on selected region
          if (typeof this.config.onServerRegionUpdate === 'function') {
            const regionIdFromData = data.region || selectedRegionId;
            const selectedRegion = SERVER_REGIONS.find(
              (r) => r.id === regionIdFromData
            );
            this.config.onServerRegionUpdate(selectedRegion?.name || 'Unknown');
          }

          // Update initial floor index for HUD if provided by server
          try {
            const floorFromServer = Number(data?.currentFloor);
            if (Number.isFinite(floorFromServer) && floorFromServer > 0) {
              setFloorIndex?.(Math.floor(floorFromServer));
            }
          } catch {}
        });

        this.room.onMessage(
          'staging_countdown',
          (payload: ServerToClientMessages['staging_countdown']) => {
            setRoomPhase?.('countdown');
            setCountdownEndsAt?.(payload.countdownEndsAt);
            setAutoCloseAt?.(0);
            setStartedByPlayerId?.(payload.startedByPlayerId ?? null);
            if (typeof setToastNotification === 'function') {
              setToastNotification({
                id: 'staging-countdown',
                type: 'info',
                message: 'Portal activated! Preparing to teleport...',
              });
              setTimeout(() => setToastNotification(null), 3200);
            }
          }
        );

        this.room.onMessage(
          'staging_run_started',
          (payload: ServerToClientMessages['staging_run_started']) => {
            if (typeof setRoomPhase === 'function') {
              setRoomPhase('in_game');
            }
            if (typeof setCountdownEndsAt === 'function') {
              setCountdownEndsAt(0);
            }
            if (typeof setAutoCloseAt === 'function') {
              setAutoCloseAt(0);
            }
            if (typeof setLateJoinCutoffAt === 'function') {
              setLateJoinCutoffAt(payload.lateJoinCutoffAt ?? 0);
            }
            if (typeof setRunStartedAt === 'function') {
              setRunStartedAt(payload.runStartedAt ?? Date.now());
            }
            if (typeof setStartedByPlayerId === 'function') {
              setStartedByPlayerId(payload.startedByPlayerId ?? null);
            }
            if (typeof setToastNotification === 'function') {
              setToastNotification({
                id: 'staging-started',
                type: 'success',
                message: 'Run started! Teleporting to dungeon...',
              });
              setTimeout(() => setToastNotification(null), 3600);
            }
            if (typeof this.playStagingTransition === 'function') {
              this.playStagingTransition();
            }
            if (
              payload?.chunkLayout &&
              Array.isArray(payload.chunkLayout) &&
              this.environmentSystem
            ) {
              const difficultyTier =
                payload.difficultyTier ??
                this.config.difficultyTier ??
                'normal_1';
              const chunks = selectChunksByDifficulty(
                difficultyTier,
                payload.phase,
                payload.chunkLayout
              );
              this.applyFloorLayout(chunks, payload.chunkLayout);
            }
          }
        );

        this.room.onMessage(
          'staging_cancelled',
          (payload: ServerToClientMessages['staging_cancelled']) => {
            if (typeof setRoomPhase === 'function') {
              setRoomPhase('ended');
            }
            if (typeof setCountdownEndsAt === 'function') {
              setCountdownEndsAt(0);
            }
            if (typeof setAutoCloseAt === 'function') {
              setAutoCloseAt(0);
            }
            if (typeof setLateJoinCutoffAt === 'function') {
              setLateJoinCutoffAt(0);
            }
            if (typeof setRunStartedAt === 'function') {
              setRunStartedAt(0);
            }
            if (typeof setToastNotification === 'function') {
              const reason = payload.reason ?? 'manual';
              setToastNotification({
                id: 'staging-cancelled',
                type: 'error',
                message:
                  reason === 'timeout'
                    ? 'Staging timed out. Credits refunded.'
                    : 'Run cancelled. Credits refunded.',
              });
              setTimeout(() => setToastNotification(null), 4800);
            }
          }
        );

        this.room.onMessage(
          'late_join_closed',
          (_payload: ServerToClientMessages['late_join_closed']) => {
            if (typeof setLateJoinCutoffAt === 'function') {
              setLateJoinCutoffAt(0);
            }
          }
        );

        this.room.onMessage(
          'staging_auto_close',
          (payload: ServerToClientMessages['staging_auto_close']) => {
            setAutoCloseAt?.(payload.autoCloseAt);
          }
        );

        this.room.onMessage(
          'chunk_layout_update',
          (payload: ServerToClientMessages['chunk_layout_update']) => {
            if (!payload || !this.environmentSystem) {
              return;
            }
            const layout = Array.isArray(payload.chunkLayout)
              ? payload.chunkLayout
              : null;
            if (!layout || layout.length === 0) {
              return;
            }
            const difficultyTier =
              (typeof payload.difficultyTier === 'string'
                ? payload.difficultyTier
                : this.config.difficultyTier) ?? 'normal_1';
            const chunks = selectChunksByDifficulty(
              difficultyTier,
              payload.phase,
              layout
            );
            this.applyFloorLayout(chunks, layout);
          }
        );

        // Add ping measurement
        let pingStartTime = 0;
        let pingCount = 0;
        let pingSum = 0;
        let failedPings = 0;

        // Debug: Log when ping setup starts
        console.log('🚀 Setting up ping system...');

        // Send first ping after a short delay, then every 2 seconds
        setTimeout(() => {
          if (this.room && this.room.connection.readyState === 1) {
            pingStartTime = Date.now();
            console.log(
              '🏓 Sending initial ping with timestamp:',
              pingStartTime
            );
            this.room.send('ping', { timestamp: pingStartTime });
          }
        }, 1000);

        // Send ping every 2 seconds
        const pingInterval = setInterval(() => {
          if (
            this.room &&
            this.room.connection &&
            this.room.connection.transport.ws
          ) {
            const readyState = this.room.connection.transport.ws.readyState;

            if (readyState === 1 && this.room.hasJoined) {
              // Connection is open and room is joined
              pingStartTime = Date.now();

              try {
                this.room.send('ping', { timestamp: pingStartTime });
              } catch (error) {
                console.error('❌ Failed to send ping:', error);
                failedPings++;
              }
            } else {
              console.log(
                '❌ Cannot send ping - readyState:',
                readyState,
                'hasJoined:',
                this.room.hasJoined
              );
              // If connection is closed, mark as failed ping
              if (readyState === 3) {
                failedPings++;
              }
            }
          } else {
            console.log(
              '❌ Cannot send ping - no room, connection, or websocket available'
            );
            failedPings++;
          }
        }, 2000);

        // Handle ping response
        this.room.onMessage('pong', (data: any) => {
          const pingTime = Date.now() - data.timestamp;
          pingCount++;
          pingSum += pingTime;

          if (typeof this.config.onPingUpdate === 'function') {
            this.config.onPingUpdate(pingTime);
          } else {
            console.log('❌ onPingUpdate callback not available');
          }

          // Calculate packet loss
          const totalAttempts = pingCount + failedPings;
          const lossRate =
            totalAttempts > 0 ? (failedPings / totalAttempts) * 100 : 0;
          if (typeof this.config.onPacketLossUpdate === 'function') {
            this.config.onPacketLossUpdate(lossRate);
          }
        });

        // Server performance telemetry (avgTickMs, p95TickMs, cpuPct, enemies, projectiles, activeEnemies)
        this.room.onMessage(
          'server_perf',
          (data: ServerToClientMessages['server_perf']) => {
            try {
              const {
                avgTickMs,
                p95TickMs,
                cpuPct,
                enemies,
                projectiles,
                activeEnemies,
              } = data;
              const text = `TICK: ${Number(avgTickMs ?? 0).toFixed(1)}ms p95=${Number(p95TickMs ?? 0).toFixed(1)} CPU: ${(cpuPct ?? 0).toFixed(1)}% E:${Number(enemies ?? 0)} A:${Number(activeEnemies ?? 0)} P:${Number(projectiles ?? 0)}`;
              // Store in registry so HUD can render it in the debug line
              this.registry.set('serverPerfText', text);
            } catch {}
          }
        );

        // Handle NPC interactions
        this.room.onMessage('npc_dialogue', (data: any) => {
          console.log('🎭 Received NPC dialogue:', data);
          if (typeof startDialogue === 'function') {
            startDialogue(
              data.npcId,
              data.npcName,
              data.npcCharacterId,
              data.dialogueId
            );
          } else {
            console.warn('startDialogue function not available');
          }
        });

        this.room.onMessage('npc_purchase_result', (data: any) => {
          debugLog('🛒 Received npc_purchase_result:', data);
          const ok = data?.ok === true;
          const rawDialogueKey =
            typeof data?.dialogueKey === 'string' ? data.dialogueKey : null;
          const reason = typeof data?.reason === 'string' ? data.reason : null;
          const resolvedDialogueKey =
            rawDialogueKey ||
            (ok
              ? 'purchase_ok'
              : reason === 'insufficient_funds'
                ? 'purchase_insufficient'
                : reason === 'out_of_range'
                  ? 'purchase_out_of_range'
                  : 'purchase_fail');

          if (typeof resolveDialogueAction === 'function') {
            resolveDialogueAction(resolvedDialogueKey).catch((error) => {
              console.error('Failed to resolve dialogue action', error);
            });
          }

          const currencyName =
            typeof data?.currency === 'string' && data.currency.length > 0
              ? data.currency
              : 'Gold';
          const priceValue = Number(data?.price);
          const balanceValue = Number(data?.balance);

          const itemData =
            data?.item && typeof data.item === 'object' ? data.item : null;
          const purchasedItem: InventoryItem | null = itemData
            ? {
                id:
                  typeof itemData.id === 'string'
                    ? itemData.id
                    : `npc_purchase_${Date.now()}`,
                name:
                  typeof itemData.name === 'string' ? itemData.name : 'Item',
                type:
                  typeof itemData.type === 'string'
                    ? itemData.type
                    : 'material',
                quantity: Number.isFinite(Number(itemData.quantity))
                  ? Math.max(1, Math.floor(Number(itemData.quantity)))
                  : 1,
                color:
                  typeof itemData.color === 'string'
                    ? itemData.color
                    : '#ffffff',
                description:
                  typeof itemData.description === 'string'
                    ? itemData.description
                    : undefined,
                rarity:
                  typeof itemData.rarity === 'string'
                    ? itemData.rarity
                    : undefined,
                wearableId:
                  typeof itemData.wearableId === 'number'
                    ? itemData.wearableId
                    : undefined,
                imageUrl:
                  typeof itemData.imageUrl === 'string'
                    ? itemData.imageUrl
                    : undefined,
                spriteId:
                  typeof itemData.spriteId === 'number'
                    ? itemData.spriteId
                    : undefined,
              }
            : null;

          if (ok) {
            const priceText = Number.isFinite(priceValue)
              ? `${Math.max(0, Math.floor(priceValue))} ${currencyName}`
              : currencyName;
            const balanceText = Number.isFinite(balanceValue)
              ? ` (Remaining: ${Math.max(
                  0,
                  Math.floor(balanceValue)
                )} ${currencyName})`
              : '';
            if (typeof setToastNotification === 'function') {
              setToastNotification({
                id: `npc_purchase_success_${Date.now()}`,
                type: 'success',
                message: `Purchased ${purchasedItem?.name ?? 'item'} for ${priceText}${balanceText}`,
              });
              setTimeout(() => setToastNotification(null), 3600);
            }
            if (purchasedItem && typeof setToastItem === 'function') {
              setToastItem(purchasedItem);
              setTimeout(() => setToastItem(null), 3600);
            }
          } else {
            if (typeof setToastNotification === 'function') {
              let errorMessage = 'Trade failed. Please try again.';
              if (reason === 'insufficient_funds') {
                errorMessage = 'Not enough Gold for that purchase.';
              } else if (reason === 'out_of_range') {
                errorMessage = 'Move closer to Nyx to trade.';
              }

              setToastNotification({
                id: `npc_purchase_error_${Date.now()}`,
                type: 'error',
                message: errorMessage,
              });
              setTimeout(() => setToastNotification(null), 3600);
            }
          }
        });

        // Handle connection state changes
        this.room.onLeave(() => {
          if (typeof this.config.onConnectionStatusChange === 'function') {
            this.config.onConnectionStatusChange('disconnected');
          }
          clearInterval(pingInterval);
        });

        this.room.onError(() => {
          if (typeof this.config.onConnectionStatusChange === 'function') {
            this.config.onConnectionStatusChange('reconnecting');
          }
          failedPings++;
        });
      }

      setupStateListeners() {
        if (!this.room || !this.room.state) {
          console.error(
            '❌ Cannot setup state listeners - room or state not available'
          );
          return;
        }

        console.log('🎯 Setting up room state listeners...');

        const setHostSessionIdCb = (this as any).setHostSessionIdCallback;
        if (typeof setHostSessionIdCb === 'function') {
          setHostSessionIdCb(this.room.state.hostSessionId || '');
        }
        if (
          typeof this.room.state.listen === 'function' &&
          typeof setHostSessionIdCb === 'function'
        ) {
          this.room.state.listen('hostSessionId', (value: any) => {
            setHostSessionIdCb(typeof value === 'string' ? value : '');
          });
        }

        if (typeof setPlayerCount === 'function') {
          setPlayerCount(this.room.state.players?.size ?? 0);
        }

        console.log('players');
        console.log(this.room.state.players);
        console.log(this.room.state.players.onAdd);

        //enemies
        console.log('enemies');
        console.log(this.room.state.enemies);
        console.log(this.room.state.enemies.onAdd);

        //npcs

        console.log(this.room.state.npcs);

        //projectiles

        console.log(this.room.state.projectiles);
        console.log(this.room.state.projectiles.onAdd);

        //entities

        console.log(this.room.state.entities);
        console.log(this.room.state.entities.onAdd);

        // Listen for players joining
        this.room.state.players.onAdd((player: any, sessionId: string) => {
          // Skip entity creation if we're transitioning
          if (this.isTransitioning) {
            console.log(
              '⏸️ Skipping player creation during transition:',
              sessionId
            );
            return;
          }

          console.log(
            'Player joined:',
            sessionId,
            'at position:',
            player.x,
            player.y
          );

          // EntityManager is already initialized in the parent GameScene

          // Create player entity configuration using EntityFactory
          const isCurrentPlayer = sessionId === this.room.sessionId;
          const playerConfig = EntityFactory.createPlayerConfig(
            this as any,
            sessionId,
            player,
            isCurrentPlayer
          );

          // Create the player entity using EntityManager
          if (!this.entityManager) {
            console.error('EntityManager not available!');
            return;
          }

          const playerContainer = this.entityManager.createEntity(
            sessionId,
            player.x || this.cameras.main.centerX,
            player.y || this.cameras.main.centerY,
            playerConfig
          );
          this.registerMinimapIgnore(playerContainer);

          // Add a soft pink aura under the player
          this.entityManager.addAuraToEntity(sessionId, {
            color: '#ffb6c1',
            level: typeof player.level === 'number' ? player.level : 1,
          });

          // Store container reference for compatibility with sprite loading methods
          this.playerEntities[sessionId] = playerContainer;
          this.tryApplyPendingSlowTint(sessionId);
          this.tryApplyPendingStunLabel(sessionId);

          // Load unique Aavegotchi sprite for this player asynchronously
          this.loadPlayerSprite(sessionId, player);

          // Camera follow for current player
          if (sessionId === this.room.sessionId) {
            this.cameras.main.startFollow(playerContainer, true, 1, 1);
            this.cameras.main.setFollowOffset(0, 0);
            this.cameras.main.setDeadzone(0, 0);
            this.setMinimapFollowTarget(playerContainer);
          }

          // Listen for player updates
          player.onChange(() => {
            // Use EntityManager for position updates
            if (!this.entityManager || !this.entityManager.hasEntity(sessionId))
              return;

            // Get elements from EntityManager
            const playerSprite = this.entityManager.getEntityElement(
              sessionId,
              'playerSprite'
            );
            const hpBarContainer = this.entityManager.getEntityElement(
              sessionId,
              'hpBarContainer'
            );

            // Update entity position (this moves all elements together)
            const isAavegotchi = playerSprite?.getData('isAavegotchi');

            if (isAavegotchi && playerSprite) {
              // For Aavegotchi sprites, update the entity base position and restart animation
              const floatTween = playerSprite.getData('floatTween');
              if (floatTween) {
                // Remove current tween
                this.tweens.remove(floatTween);

                // Set new entity position using EntityManager
                this.entityManager.updateEntityPosition(
                  sessionId,
                  player.x,
                  player.y
                );

                // Store new base Y on the sprite
                playerSprite.setData('baseY', player.y);

                // Restart floating animation on the entire entity
                const currentContainer =
                  this.entityManager.getEntity(sessionId);
                const newFloatTween = this.tweens.add({
                  targets: currentContainer,
                  y: player.y - 2, // 2 pixel floating range
                  duration: 1000, // 1 second each direction (2s total cycle)
                  yoyo: true,
                  repeat: -1,
                  ease: 'Linear',
                });
                playerSprite.setData('floatTween', newFloatTween);
              }
            } else {
              // Regular positioning - use EntityManager
              this.entityManager.updateEntityPosition(
                sessionId,
                player.x,
                player.y
              );

              // Ensure camera follows container for current player
              if (
                sessionId === this.room.sessionId &&
                playerSprite?.getData('isCharacterSprite')
              ) {
                const currentContainer =
                  this.entityManager.getEntity(sessionId);
                if (this.cameras.main.followTarget !== currentContainer) {
                  this.cameras.main.startFollow(currentContainer, true, 1, 1);
                  this.cameras.main.setFollowOffset(0, 0);
                  this.cameras.main.setDeadzone(0, 0);
                }
              }
            }

            // Optionally play auto-walk start SFX (kept as-is but not required to click)
            if (sessionId === this.room.sessionId) {
              try {
                const container = this.entityManager.getEntity(sessionId);
                if (container && container.setData) {
                  container.setData('lastAutoWalking', !!player.isAutoWalking);
                }
              } catch {}
            }

            // Update shadow position if it exists - shadow stays at ground level
            const shadow = playerSprite?.getData('shadow');
            if (shadow) {
              shadow.x = player.x;
              shadow.y = player.y + 42; // Fixed ground level
            }

            // Update HP bar fill, color, and visibility
            if (hpBarContainer) {
              const hpBarFill = hpBarContainer.getData('hpBarFill');
              const maxHp = player.maxHp ?? 0;
              const hpPercent =
                maxHp > 0 ? Math.max(0, Math.min(1, player.hp / maxHp)) : 1;
              if (hpBarFill) {
                hpBarFill.scaleX = hpPercent;
                // Update fill color thresholds: <33% red, <66% yellow, else green
                const setFill = (color: number) =>
                  (hpBarFill as any).setFillStyle?.(color, 0.9);
                if (hpPercent < 0.33) setFill(0xaa0000);
                else if (hpPercent < 0.66) setFill(0xffcc00);
                else setFill(0x00aa00);
              }
              hpBarContainer.setVisible(hpPercent < 1);
            }

            // Floating damage numbers when player HP decreases
            const playerContainer = this.entityManager.getEntity(sessionId);
            if (playerContainer) {
              const lastHp = playerContainer.getData('lastHp') ?? player.hp;
              if (typeof lastHp === 'number' && player.hp < lastHp) {
                // Local player took damage: play hit sound
                if (sessionId === this.room?.sessionId) {
                  this.playSFX('gotchihit', 0.8);
                }
                const damageAmount = lastHp - player.hp;
                const dmgText = this.add
                  .text(0, -55, `-${damageAmount}`, {
                    fontSize: '16px',
                    color: '#ff5555',
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 3,
                  })
                  .setOrigin(0.5);

                playerContainer.add(dmgText);

                this.tweens.add({
                  targets: dmgText,
                  y: -75,
                  alpha: 0,
                  duration: 600,
                  ease: 'Cubic.easeOut',
                  onComplete: () => dmgText.destroy(),
                });
              }
              // Update lastHp snapshot
              playerContainer.setData('lastHp', player.hp);
            }

            // Action status display
            let actionText = this.entityManager.getEntityElement(
              sessionId,
              'actionText'
            );
            if (player.currentAction && player.currentAction !== '') {
              if (!actionText) {
                actionText = this.add
                  .text(0, -60, '', {
                    fontSize: '12px',
                    color: '#ffff00',
                    backgroundColor: '#000000',
                    padding: { x: 4, y: 2 },
                  })
                  .setOrigin(0.5);
                this.entityManager.addElementToEntity(
                  sessionId,
                  'actionText',
                  actionText
                );
              }

              // Display action status with emoji (hide for combat)
              if (player.currentAction === 'attack_enemy') {
                if (actionText && actionText.setVisible) {
                  actionText.setVisible(false);
                }
              } else {
                const actionDisplay =
                  player.currentAction === 'chop_tree'
                    ? '🪓 Chopping...'
                    : player.currentAction === 'mine_stone'
                      ? '⛏️ Mining...'
                      : `⚡ ${player.currentAction}...`;
                if (actionText && actionText.setText) {
                  actionText.setText(actionDisplay);
                  actionText.setVisible(true);
                }
              }
            } else {
              // Hide action text when no action
              if (actionText && actionText.setVisible) {
                actionText.setVisible(false);
              }
            }

            // Update selected enemy indicator for the local player
            if (sessionId === this.room.sessionId) {
              const newTargetId =
                player.currentAction === 'attack_enemy'
                  ? player.actionTarget || null
                  : null;

              if (newTargetId !== this.currentSelectedTargetId) {
                // Clear old selection
                if (
                  this.currentSelectedTargetId &&
                  this.entityManager?.hasEntity(this.currentSelectedTargetId)
                ) {
                  this.clearSelectedIndicatorForEnemy(
                    this.currentSelectedTargetId
                  );
                }

                this.currentSelectedTargetId = newTargetId;

                // Apply new selection
                if (newTargetId && this.entityManager?.hasEntity(newTargetId)) {
                  this.createSelectedIndicatorForEnemy(newTargetId);
                }
              }
            }

            // Game over check
            if (sessionId === this.room.sessionId && player.hp <= 0) {
              console.log('GAME OVER! Player died! HP:', player.hp);
              this.showGameOver();
              return;
            }

            // Visual feedback for player damage (enhanced flash effect)
            if (player.anim === 'hurt') {
              console.log(
                `🔴 PLAYER HIT! Starting flash effect for ${sessionId}`
              );

              // Briefly pause auto-attack on the local scene to avoid doubles during damage windows
              try {
                const sceneAny: any = this as any;
                if (
                  sessionId === this.room.sessionId &&
                  typeof sceneAny.recentlyHitUntil === 'number'
                ) {
                  sceneAny.recentlyHitUntil = Date.now() + 150; // 150ms grace
                }
              } catch {}

              // Clear any existing flash timeouts to prevent conflicts
              const currentContainer = this.entityManager.getEntity(sessionId);
              const existingTimeout = currentContainer?.getData('flashTimeout');
              if (existingTimeout) {
                clearTimeout(existingTimeout);
              }

              // Store original color
              const originalColor =
                sessionId === this.room.sessionId ? 0x00ff00 : 0x8a2be2;
              const storedOriginalColor =
                currentContainer?.getData('originalColor') || originalColor;
              if (
                currentContainer &&
                !currentContainer.getData('originalColor')
              ) {
                currentContainer.setData('originalColor', originalColor);
              }

              // Immediate flash to red (only for rectangles)
              if (playerSprite && playerSprite.type === 'Rectangle') {
                (playerSprite as Phaser.GameObjects.Rectangle).setFillStyle(
                  0xdd4444
                );
              }

              // Set timeout to restore original color
              const flashTimeout = setTimeout(() => {
                if (
                  this.entityManager &&
                  this.entityManager.hasEntity(sessionId)
                ) {
                  const sprite = this.entityManager.getEntityElement(
                    sessionId,
                    'playerSprite'
                  );
                  if (sprite && sprite.type === 'Rectangle') {
                    (sprite as Phaser.GameObjects.Rectangle).setFillStyle(
                      storedOriginalColor
                    );
                  }
                  const container = this.entityManager.getEntity(sessionId);
                  if (container) {
                    container.setData('flashTimeout', null);
                  }
                }
              }, 150);

              if (currentContainer) {
                currentContainer.setData('flashTimeout', flashTimeout);
              }
            }

            // Update direction indicator (no need to position since it's in the container)
            const directionIndicator = this.entityManager.getEntityElement(
              sessionId,
              'directionIndicator'
            );
            if (directionIndicator) {
              // Rotate based on direction
              switch (player.dir) {
                case 'up':
                  directionIndicator.setRotation(Math.PI);
                  break;
                case 'down':
                  directionIndicator.setRotation(0);
                  break;
                case 'left':
                  directionIndicator.setRotation(Math.PI / 2);
                  break;
                case 'right':
                  directionIndicator.setRotation(-Math.PI / 2);
                  break;
              }
            }

            // Update sprite direction and animation
            if (playerSprite?.getData('isAavegotchi')) {
              this.updatePlayerAnimation(
                sessionId,
                player.anim || 'idle',
                player.dir || 'down'
              );
            } else if (playerSprite?.getData('isCharacterSprite')) {
              // Update character sprite animation
              const isCurrentPlayer = sessionId === this.room.sessionId;
              const logPrefix = isCurrentPlayer
                ? '👤 YOU'
                : `🤖 Bot ${sessionId.slice(-4)}`;
              // Server-driven animations: Use server's animation state directly
              const effectiveAnimation = player.anim || 'idle';

              // Respect attack animation lock: don't override any animation while locked
              const lockKey = `animLock_${sessionId}`;
              const hasLock = this.registry.get(lockKey);
              if (!hasLock) {
                this.updatePlayerAnimation(
                  sessionId,
                  effectiveAnimation,
                  player.dir || 'down'
                );
              } else {
                // console.log(`⏭️ Skipping anim '${effectiveAnimation}' for ${sessionId} due to attack lock`);
              }
            }

            // Update range indicator if this is the current player
            if (sessionId === this.room.sessionId) {
              this.updateRangeIndicator();

              // Add sprint visual effect
              if (player.anim === 'sprint') {
                playerSprite.setAlpha(0.8); // Slightly transparent when sprinting
              } else {
                playerSprite.setAlpha(1.0); // Normal opacity
              }

              // Add road bonus visual effect (blue glow when on road)
              // Only call setStrokeStyle on Rectangle objects, not Sprite objects
              if (playerSprite?.setStrokeStyle) {
                if (player.onRoad) {
                  playerSprite.setStrokeStyle(3, 0x00aaff); // Blue outline when on road
                } else {
                  // Restore normal appearance
                  playerSprite.setStrokeStyle(2, 0xffffff); // White border
                }
              }
            }
          });

          // Update player count
          if (typeof setPlayerCount === 'function') {
            setPlayerCount(this.room.state.players.size);
          }
        });

        // Listen for players leaving
        this.room.state.players.onRemove((player: any, sessionId: string) => {
          console.log('Player left:', sessionId);
          this.clearSlowTint(sessionId);
          this.clearStunLabel(sessionId);

          if (sessionId === this.room.sessionId) {
            this.setMinimapFollowTarget(null);
          }

          // Use EntityManager for cleanup if available
          if (this.entityManager && this.entityManager.hasEntity(sessionId)) {
            // Get player sprite for special cleanup
            const playerSprite = this.entityManager.getEntityElement(
              sessionId,
              'playerSprite'
            );

            // Clean up timeout to prevent memory leaks
            const playerContainer = this.entityManager.getEntity(sessionId);
            const flashTimeout = playerContainer?.getData('flashTimeout');
            if (flashTimeout) {
              clearTimeout(flashTimeout);
            }

            // Clean up Aavegotchi sprite data
            if (this.spriteManager) {
              this.spriteManager.cleanupPlayerSprite(sessionId);
            }

            // Clean up Aavegotchi shadow and animation tweens
            if (playerSprite) {
              const shadow = playerSprite.getData('shadow');
              const floatTween = playerSprite.getData('floatTween');
              const shadowTween = playerSprite.getData('shadowTween');

              if (shadow) shadow.destroy();
              if (floatTween) this.tweens.remove(floatTween);
              if (shadowTween) this.tweens.remove(shadowTween);
            }

            // Destroy the entity using EntityManager
            this.entityManager.destroyEntity(sessionId);
          }

          if (typeof setPlayerCount === 'function') {
            setPlayerCount(this.room.state.players.size);
          }
        });

        this.room.state.enemies.onAdd((enemy: any, enemyId: string) => {
          // Skip entity creation if we're transitioning
          if (this.isTransitioning) {
            console.log(
              '⏸️ Skipping enemy creation during transition:',
              enemyId
            );
            return;
          }
          this.renderEnemy(enemy, enemyId);
          this.tryApplyPendingSlowTint(enemyId);
          this.tryApplyPendingStunLabel(enemyId);
        });

        this.room.state.enemies.onRemove((enemy: any, enemyId: string) => {
          console.log('💀 Removing enemy:', enemyId);
          this.clearSlowTint(enemyId);
          this.clearStunLabel(enemyId);

          // Use EntityManager for cleanup if available
          if (this.entityManager && this.entityManager.hasEntity(enemyId)) {
            // If this enemy was selected, clear selection state and outline FX
            if (this.currentSelectedTargetId === enemyId) {
              this.clearSelectedIndicatorForEnemy(enemyId);
              this.currentSelectedTargetId = null;
            }
            // Clean up enemy sprite manager reference
            if (this.enemySpriteManager) {
              this.enemySpriteManager.removeEnemySprite(enemyId);
            }

            // Destroy the entity using EntityManager
            this.entityManager.destroyEntity(enemyId);
            delete this.enemyEntities[enemyId];
            console.log('✅ Enemy removed successfully:', enemyId);
          } else {
            // Fallback to old cleanup method
            const enemyContainer = this.enemyEntities[enemyId];
            if (enemyContainer) {
              enemyContainer.destroy();
              delete this.enemyEntities[enemyId];
            }
            console.warn('⚠️ Tried to remove non-existent enemy:', enemyId);
          }
        });

        // Listen for NPCs spawning
        if (this.room.state.npcs && this.room.state.npcs.onAdd) {
          this.room.state.npcs.onAdd((npc: any, npcId: string) => {
            console.log('🎭 Rendering NPC:', npc.name, npcId);

            // Skip entity creation if we're transitioning
            if (this.isTransitioning) {
              console.log('⏸️ Skipping NPC creation during transition:', npcId);
              return;
            }
            this.renderNPC(npc, npcId);

            // Handle Stani fade-out
            if (npc.characterId === 'stani') {
              const container =
                this.entityManager?.getEntity(npcId) || this.npcEntities[npcId];
              if (container) {
                // Ensure full opacity initially
                container.setAlpha(1);

                // Fade Stani out over 30s (visual only, server handles hard cleanup)
                this.tweens.add({
                  targets: container,
                  alpha: 0,
                  duration: 30000,
                  ease: 'Linear',
                  onComplete: () => {
                    if (container.active) container.setVisible(false);
                  },
                });
              }
            }
          });

          // Listen for NPCs being removed
          this.room.state.npcs.onRemove((npc: any, npcId: string) => {
            console.log('🎭 Removing NPC:', npcId);

            // Use EntityManager for cleanup if available
            if (this.entityManager && this.entityManager.hasEntity(npcId)) {
              // Destroy the entity using EntityManager
              this.entityManager.destroyEntity(npcId);
              delete this.npcEntities[npcId];
              console.log('✅ NPC removed successfully:', npcId);
            } else {
              // Fallback to old cleanup method
              const npcContainer = this.npcEntities[npcId];
              if (npcContainer) {
                npcContainer.destroy();
                delete this.npcEntities[npcId];
              }
              console.warn('⚠️ Tried to remove non-existent NPC:', npcId);
            }
          });
        } else {
          console.warn('⚠️ NPCs collection not ready, skipping NPC listeners');
        }

        // Listen for projectiles
        this.room.state.projectiles.onAdd(
          (projectile: any, projectileId: string) => {
            this.renderProjectile(projectile, projectileId);

            // Listen for position changes
            projectile.onChange(() => {
              const projectileSprite = this.projectileEntities[projectileId];
              if (projectileSprite) {
                projectileSprite.x = projectile.x;
                projectileSprite.y = projectile.y;

                // Handle cactus projectile rotation and explosion
                if (
                  projectile.ownerId &&
                  projectile.ownerId.startsWith('enemy_')
                ) {
                  const ownerEnemy = this.room?.state.enemies.get(
                    projectile.ownerId
                  );
                  if (ownerEnemy && ownerEnemy.enemyType === 'cactus') {
                    if (projectile.exploding) {
                      // Stop rotation and play explosion animation
                      projectileSprite.rotation = 0;
                      if (projectileSprite.play) {
                        projectileSprite.play('cactus_bullet_explode');
                        console.log('💥 Cactus bullet exploding!');
                      }
                    } else {
                      // Apply rotation based on velocity direction for flying bullets
                      if (
                        projectile.velocityX !== undefined &&
                        projectile.velocityY !== undefined
                      ) {
                        const angle = Math.atan2(
                          projectile.velocityY,
                          projectile.velocityX
                        );
                        // Add 180 degrees (π radians) to flip the projectile direction
                        projectileSprite.rotation = angle + Math.PI;
                      }
                    }
                  }
                }
              }
            });
          }
        );

        this.room.state.projectiles.onRemove(
          (projectile: any, projectileId: string) => {
            const projectileSprite = this.projectileEntities[projectileId];
            if (projectileSprite) {
              projectileSprite.destroy();
              delete this.projectileEntities[projectileId];
            }
          }
        );

        // Listen for server entities
        this.room.state.entities.onAdd((entity: any, entityId: string) => {
          const entityHandlers = {
            obstacle: (entity: any, entityId: string) => {
              const state = JSON.parse(entity.state || '{}');
              if (state.type === 'tree') {
                this.renderTree(entity, entityId);
              } else if (state.type === 'stone') {
                this.renderStone(entity, entityId);
              } else if (state.type === 'special' || state.type === 'wall') {
                this.renderSpecial(entity, entityId);
              }
            },
            treasure_chest: (entity: any, entityId: string) => {
              this.renderTreasureChest(entity, entityId);
            },
            road: (entity: any, entityId: string) => {
              this.renderRoad(entity, entityId);
            },
            collectible: (entity: any, entityId: string) => {
              this.renderCollectible(entity, entityId);
              // No position change animation needed - items are picked up immediately on server
              // Animation happens in item_pickup message handler
            },
            portal: (entity: any, entityId: string) => {
              this.renderPortal(entity, entityId);
            },
            debug_rectangle: (entity: any, entityId: string) => {
              this.renderDebugRectangle(entity, entityId);
            },
          };

          const handler =
            entityHandlers[entity.kind as keyof typeof entityHandlers];
          if (handler) {
            handler(entity, entityId);
          }
        });

        this.room.state.entities.onRemove((entity: any, entityId: string) => {
          const entityCleanupHandlers = {
            treasure_chest: (entity: any, entityId: string) => {
              const chestSprite = this.treasureChestEntities[entityId];
              if (chestSprite) {
                chestSprite.destroy();
                delete this.treasureChestEntities[entityId];
              }
            },
            collectible: (entity: any, entityId: string) => {
              // Mark item for cleanup, but don't destroy immediately
              // The item_pickup message handler will handle animation if it's our pickup
              // Otherwise, we'll clean up after a short delay
              setTimeout(() => {
                const itemData = this.droppedItemEntities[entityId];
                if (itemData && itemData.sprite) {
                  // If sprite still exists after delay, it means no pickup animation started
                  // This happens when other players pick up items
                  const starIndicator =
                    itemData.sprite.getData('starIndicator');
                  if (starIndicator) starIndicator.destroy();
                  itemData.sprite.destroy();
                  delete this.droppedItemEntities[entityId];
                  console.log(
                    `🗑️ Cleaned up collectible ${entityId} (other player pickup)`
                  );
                }
              }, 100); // Small delay to allow pickup message to arrive first
            },
            road: (entity: any, entityId: string) => {
              const roadSprite = this.roadEntities?.[entityId];
              if (roadSprite) {
                roadSprite.destroy();
                delete this.roadEntities[entityId];
                console.log(`🗑️ Removed road ${entityId} from client`);
              }
            },
            obstacle: (entity: any, entityId: string) => {
              const state = JSON.parse(entity.state || '{}');
              if (state.type === 'tree') {
                const treeSprite = this.treeEntities[entityId];
                if (treeSprite) {
                  // Clean up health text if it exists
                  const healthText = treeSprite.getData('healthText');
                  if (healthText) {
                    healthText.destroy();
                  }
                  treeSprite.destroy();
                  delete this.treeEntities[entityId];
                }
              } else if (state.type === 'stone') {
                const stoneSprite = this.stoneEntities[entityId];
                if (stoneSprite) {
                  // Clean up health text if it exists
                  const healthText = stoneSprite.getData('healthText');
                  if (healthText) {
                    healthText.destroy();
                  }
                  stoneSprite.destroy();
                  delete this.stoneEntities[entityId];
                }
              } else if (state.type === 'special' || state.type === 'wall') {
                // Clean up any special/wall sprites created via renderSpecial
                const specialSprite = this.specialEntities?.[entityId];
                if (specialSprite) {
                  specialSprite.destroy();
                  delete this.specialEntities[entityId];
                }
              }
            },
            portal: (entity: any, entityId: string) => {
              this.unregisterSpatialSource(entityId);
              const portalContainer = this.portalEntities[entityId];
              if (portalContainer) {
                portalContainer.destroy();
                delete this.portalEntities[entityId];
                const info = this.portalInfo?.[entityId];
                if (info?.labelText) {
                  info.labelText.destroy();
                }
                if (this.portalInfo) {
                  delete this.portalInfo[entityId];
                }
                console.log(`🌀 Removed portal ${entityId} from client`);
              }
            },
            debug_rectangle: (entity: any, entityId: string) => {
              removeDebugRectangle(this, entityId);
              console.log(`🟩 Removed debug rectangle ${entityId} from client`);
            },
          };

          const cleanupHandler =
            entityCleanupHandlers[
              entity.kind as keyof typeof entityCleanupHandlers
            ];
          if (cleanupHandler) {
            cleanupHandler(entity, entityId);
          }
        });
      }

      renderTree(entity: any, entityId: string) {
        const state = JSON.parse(entity.state || '{}');

        if (state.type === 'tree') {
          const treeSprite = renderTreeSprite(this, entity, entityId);

          // Store tree sprite for cleanup
          if (!this.environmentSystem.treeEntities)
            this.environmentSystem.treeEntities = {};
          this.environmentSystem.treeEntities[entityId] = treeSprite;
        }
      }

      renderStone(entity: any, entityId: string) {
        const state = JSON.parse(entity.state || '{}');
        if (state.type === 'stone') {
          const stoneSprite = renderStoneSprite(this, entity, entityId);

          // Store stone sprite for cleanup
          if (!this.environmentSystem.stoneEntities)
            this.environmentSystem.stoneEntities = {};
          this.environmentSystem.stoneEntities[entityId] = stoneSprite;
        }
      }

      renderSpecial(entity: any, entityId: string) {
        const state = JSON.parse(entity.state || '{}');
        if (state.type !== 'special') return;

        const spriteKey = state.assetId;
        const attemptRender = () => {
          const { x, y } = this.getPixelAdjustedPosition(
            state.assetId,
            entity.x,
            entity.y,
            state
          );
          const entityWithOffset =
            x !== entity.x || y !== entity.y ? { ...entity, x, y } : entity;

          const specialSprite = renderSpecialSprite(
            this,
            entityWithOffset,
            entityId
          );

          if (specialSprite) {
            if (!this.specialEntities) this.specialEntities = {};
            this.specialEntities[entityId] = specialSprite;
          }
        };

        // If texture isn't loaded (can happen on next floors with new assets),
        // load it on-demand using the sprite path provided by the server.
        if (!this.textures.exists(spriteKey)) {
          const spritePath: string | undefined =
            typeof state.sprite === 'string' && state.sprite
              ? String(state.sprite)
              : `walls/${spriteKey}.png`;
          try {
            this.load.image(
              spriteKey,
              `/sprites/env/${spritePath.toLowerCase()}`
            );
            this.load.once('complete', attemptRender);
            this.load.start();
          } catch (e) {
            console.warn('Failed to load special texture on-demand', {
              assetId: spriteKey,
              spritePath,
              error: e,
            });
          }
          return;
        }

        attemptRender();
      }

      renderTreasureChest(entity: any, entityId: string) {
        console.log(
          '💰 Treasure chest spawned:',
          entityId,
          'at',
          entity.x,
          entity.y
        );

        renderTreasureChestSprite(
          this as unknown as IGameScene,
          entity,
          entityId
        );
      }

      renderRoad(entity: any, entityId: string) {
        const roadSprite = renderRoadSprite(this, entity);

        // Store reference for cleanup
        if (!this.roadEntities) {
          this.roadEntities = {};
        }
        this.roadEntities[entityId] = roadSprite;
      }

      renderCollectible(entity: any, entityId: string) {
        console.log(
          '🎁 Collectible item spawned:',
          entityId,
          'at',
          entity.x,
          entity.y
        );

        const itemState = JSON.parse(entity.state || '{}');
        const itemType: InventoryItem['type'] = itemState.type;

        // Create simple colored circles for different item types
        const colors = {
          sword: 0xc0c0c0, // Silver
          shield: 0x8b4513, // Brown
          potion: 0xff69b4, // Pink
          gem: 0x00ced1, // Turquoise
          wearable: 0x9370db, // Purple for wearables
        };

        let itemSprite: any;

        // Handle items with SVG sprites (wearables and custom sprites like potions/materials)
        const spriteId = itemState.wearableId || itemState.spriteId;
        const isWearable = itemType === 'wearable' && itemState.wearableId;
        const isCustomSprite = !!itemState.spriteId;

        if (spriteId && (isWearable || isCustomSprite)) {
          // Use the wearable renderer for both wearables and custom spriteId-based items
          itemSprite = renderWearableCollectible({
            scene: this as any,
            x: entity.x,
            y: entity.y,
            wearableId: spriteId,
            entityId,
            droppedItemEntities: this.droppedItemEntities,
            placeholderColor:
              colors[itemType as keyof typeof colors] || 0xffffff,
          }) as any;
        } else if (itemType === 'coin' && itemState.name) {
          // Any ERC20-style token collectible (e.g., USDC, GHST, etc.)
          itemSprite = renderTokenCollectible({
            scene: this as any,
            x: entity.x,
            y: entity.y,
            tokenName: String(itemState.name),
            entityId,
            amount:
              typeof itemState.usdcAmount === 'number'
                ? Number(itemState.usdcAmount)
                : undefined,
            droppedItemEntities: this.droppedItemEntities,
          }) as any;
        } else {
          // Regular items - use colored circles
          itemSprite = this.add.circle(
            entity.x,
            entity.y,
            8,
            colors[itemType as keyof typeof colors] || 0xffffff
          );
          itemSprite.setStrokeStyle(1, 0x000000);
        }

        itemSprite.setDepth(1);

        // Removed bounce animations for better performance
        // Static items are cleaner and don't impact FPS

        // Store in droppedItemEntities for pickup handling
        // Create consistent IDs for materials, coins, wearables, potions, and weapons so they can stack in inventory
        let inventoryId = entityId;
        if (itemType === 'material' && itemState.name) {
          // Use material name for consistent grouping (e.g., "material_Stone", "material_Wood")
          inventoryId = `material_${itemState.name}`;
        } else if (itemType === 'coin' && itemState.name) {
          // Use coin name for consistent grouping (e.g., "coin_GHST", "coin_Gold")
          inventoryId = `coin_${itemState.name}`;
        } else if (itemType === 'wearable' && itemState.wearableId) {
          // Use wearable ID for consistent grouping (e.g., "wearable_123", "wearable_456")
          inventoryId = `wearable_${itemState.wearableId}`;
        } else if (itemType === 'potion' && itemState.name) {
          // Use potion name for consistent grouping (e.g., "potion_Health Potion", "potion_Mana Potion")
          inventoryId = `potion_${itemState.name}`;
        } else if (itemType === 'weapon' && itemState.name) {
          // Use weapon name for consistent grouping (e.g., "weapon_Wooden Sword", "weapon_Iron Sword")
          inventoryId = `weapon_${itemState.name}`;
        }

        const inventoryItemData: any = {
          id: inventoryId,
          type: this.mapItemTypeToInventoryType(itemType),
          name: itemState.name || itemType,
          quantity: itemState.quantity || 1,
          color:
            itemState.color ||
            (itemType === 'wearable' ? '#9370DB' : '#ffffff'),
          rarity: itemState.rarity || 'common',
          description: itemState.description,
        };

        // Bubble up usdcAmount for downstream UI/floaters
        if (itemType === 'coin' && typeof itemState.usdcAmount === 'number') {
          inventoryItemData.usdcAmount = Number(
            Number(itemState.usdcAmount).toFixed(2)
          );
        }

        // Add wearable-specific data
        if (itemType === 'wearable' && itemState.wearableId) {
          inventoryItemData.wearableId = itemState.wearableId;
          inventoryItemData.imageUrl = `/wearables/${itemState.wearableId}.svg`;

          // Try to get the real wearable name from wearables data
          try {
            const { itemTypes } = require('../data/wearables');
            const wearableData = itemTypes[itemState.wearableId];
            inventoryItemData.name =
              wearableData?.name || `Wearable ${itemState.wearableId}`;

            // Derive rarity from trait modifiers magnitude
            if (wearableData?.traitModifiers) {
              const sum = (wearableData.traitModifiers as number[]).reduce(
                (acc: number, val: number) => acc + Math.abs(val || 0),
                0
              );
              if (sum >= 6) {
                inventoryItemData.rarity = 'godlike';
              } else if (sum >= 5) {
                inventoryItemData.rarity = 'mythical';
              } else if (sum >= 4) {
                inventoryItemData.rarity = 'legendary';
              } else if (sum >= 3) {
                inventoryItemData.rarity = 'rare';
              } else if (sum >= 2) {
                inventoryItemData.rarity = 'uncommon';
              } else {
                inventoryItemData.rarity = 'common';
              }
            }
          } catch (error) {
            console.log('Could not load wearable data:', error);
            inventoryItemData.name = `Wearable ${itemState.wearableId}`;
          }
        }

        // Add spriteId for items with custom sprites
        if (itemState.spriteId) {
          inventoryItemData.spriteId = itemState.spriteId;
        }

        this.droppedItemEntities[entityId] = {
          sprite: itemSprite,
          x: entity.x,
          y: entity.y,
          type: itemType,
          id: entityId,
          itemData: inventoryItemData,
        };

        console.log(
          `🎁 Stored collectible ${entityId} (${itemType}) in droppedItemEntities`
        );
      }

      // P hotkey: spawn portals near the player (dev parity)
      handlePortalHotkey(): boolean {
        try {
          debugLog('🌀 P hotkey pressed: spawning portals near player');
          if (!this.room) return false;
          this.room.send('debug_spawn_portals_here');
          return true;
        } catch (error) {
          console.warn('Failed to handle portal hotkey', error);
          return false;
        }
      }

      renderPortal(entity: any, entityId: string) {
        console.log('🌀 Portal spawned:', entityId, 'at', entity.x, entity.y);

        const state = JSON.parse(entity.state || '{}');
        const customAssetId = state.assetId as string | undefined;
        const portalType = state.portalType || 'alpha';
        const destination = String(state.destination || '').toLowerCase();
        const inferredLabel =
          typeof state.label === 'string' && state.label.trim().length > 0
            ? state.label.trim()
            : destination === 'boss_room'
              ? 'Hold to Fight Boss'
              : 'Hold to Descend';
        const interactionRadius = Number(state.interactionRadius) || 110;
        const labelOffset = Number(state.labelOffset) || 90;
        const configuredSoundRadius = Number(state.soundRadius);
        const resolvedSoundRadius = Number.isFinite(configuredSoundRadius)
          ? Math.max(0, configuredSoundRadius)
          : Math.max(DEFAULT_SPATIAL_MAX_RADIUS, interactionRadius + 200);
        const configuredBaseVolume = Number(state.soundBaseVolume);
        const resolvedBaseVolume = Number.isFinite(configuredBaseVolume)
          ? clamp01(configuredBaseVolume)
          : DEFAULT_SPATIAL_BASE_VOLUME;
        const configuredHysteresis = Number(state.soundHysteresis);
        const resolvedHysteresis = Number.isFinite(configuredHysteresis)
          ? Math.max(0, configuredHysteresis)
          : DEFAULT_SPATIAL_HYSTERESIS;
        const spatialOptions = {
          maxRadius: resolvedSoundRadius,
          baseVolume: resolvedBaseVolume,
          hysteresis: resolvedHysteresis,
        };

        // Allow server to override ambient portal SFX via state.soundKey or state.sound
        const providedAmbientKey =
          (typeof state.soundKey === 'string' &&
          state.soundKey.trim().length > 0
            ? state.soundKey.trim()
            : undefined) ??
          (typeof state.sound === 'string' && state.sound.trim().length > 0
            ? state.sound.trim()
            : undefined);
        let resolvedAmbientKey = 'portalpulsating';
        if (providedAmbientKey) {
          const audioExists =
            (this as any).cache?.audio?.exists?.(providedAmbientKey) === true;
          if (audioExists) {
            resolvedAmbientKey = providedAmbientKey;
          } else if (this.sound) {
            // As a secondary check, attempt to add then immediately destroy; if it works, consider it valid
            try {
              const testSound = this.sound.add(providedAmbientKey);
              try {
                (testSound as any)?.destroy?.();
              } catch {}
              resolvedAmbientKey = providedAmbientKey;
            } catch {}
          }
        }

        // Helper to toggle hover label visibility
        const handlePointerOver = () => {
          this.input.setDefaultCursor('pointer');
          const info = this.portalInfo[entityId];
          if (info) {
            info.isPointerHovering = true;
            info.labelText.setVisible(true);
          }
        };

        const handlePointerOut = () => {
          this.input.setDefaultCursor('auto');
          const info = this.portalInfo[entityId];
          if (info) {
            info.isPointerHovering = false;
            if (!this.isPlayerWithinPortalRadius(info)) {
              info.labelText.setVisible(false);
            }
          }
        };

        // Prefer a custom asset-based portal if provided by the server (from spawn-portals)
        if (customAssetId && this.textures.exists(customAssetId)) {
          // Use animated sprite if frames/animation were registered; otherwise static image
          const animKey = `${customAssetId}_anim`;
          let portalSprite: any;
          if (this.anims.exists(animKey)) {
            portalSprite = this.add.sprite(entity.x, entity.y, customAssetId);
            portalSprite.setOrigin(0, 0).play(animKey);
          } else {
            portalSprite = this.add.image(entity.x, entity.y, customAssetId);
            portalSprite.setOrigin(0, 0);
          }

          portalSprite.setDepth(entity.y);
          portalSprite.setInteractive();

          const centerX =
            portalSprite.x +
            (portalSprite.displayWidth ?? portalSprite.width ?? 0) / 2;
          const centerY =
            portalSprite.y +
            (portalSprite.displayHeight ?? portalSprite.height ?? 0) / 2;
          const portalGO = portalSprite;
          const portalInfo = this.createPortalLabel(
            entityId,
            centerX,
            centerY,
            inferredLabel,
            interactionRadius,
            labelOffset
          );
          portalGO.on('pointerover', () => handlePointerOver());
          portalGO.on('pointerout', () => handlePointerOut());
          this.bindHoldToActivateHandlers(
            portalGO,
            () => {
              const info = this.portalInfo?.[entityId];
              if (!info) return null;
              return { x: info.x, y: info.y, radius: info.radius };
            },
            () => this.room?.send('portal_interact', { portalId: entityId }),
            {
              holdMs: 2000,
              idleWindowMs: 250,
              sfxKey: 'clicksound',
              sfxVolume: 0.6,
            }
          );
          this.portalEntities[entityId] = portalGO;
          const spatialCenter = portalInfo ?? {
            x: centerX,
            y: centerY,
          };
          this.registerSpatialLoop(
            entityId,
            spatialCenter.x,
            spatialCenter.y,
            resolvedAmbientKey,
            spatialOptions
          );
          console.log(
            `✅ Custom portal (${customAssetId}) rendered: ${entityId}`
          );
          return;
        }

        // Fallback: Use the legacy portal sprite manager types
        if (!this.portalSpriteManager) {
          console.error('❌ PortalSpriteManager not initialized');
          return;
        }

        const portalContainer = this.portalSpriteManager.createPortalSprite(
          entity.x,
          entity.y,
          portalType,
          entityId
        );

        const portalGO = portalContainer;
        const portalInfo = this.createPortalLabel(
          entityId,
          entity.x,
          entity.y,
          inferredLabel,
          interactionRadius,
          labelOffset
        );

        portalGO.setDepth(entity.y);
        portalGO.setInteractive(
          new Phaser.Geom.Rectangle(-88, -52, 176, 104),
          Phaser.Geom.Rectangle.Contains
        );
        portalGO.on('pointerover', () => handlePointerOver());
        portalGO.on('pointerout', () => handlePointerOut());
        this.bindHoldToActivateHandlers(
          portalGO,
          () => {
            const info = this.portalInfo?.[entityId];
            if (!info) return null;
            return { x: info.x, y: info.y, radius: info.radius };
          },
          () => this.room?.send('portal_interact', { portalId: entityId }),
          {
            holdMs: 2000,
            idleWindowMs: 250,
            sfxKey: 'clicksound',
            sfxVolume: 0.6,
          }
        );
        this.portalEntities[entityId] = portalGO;
        const spatialCenter = portalInfo ?? {
          x: entity.x,
          y: entity.y,
        };
        this.registerSpatialLoop(
          entityId,
          spatialCenter.x,
          spatialCenter.y,
          resolvedAmbientKey,
          spatialOptions
        );
        console.log(
          `✅ Portal ${portalType} (${entityId}) rendered successfully`
        );
      }

      playStagingTransition() {
        const cam = this.cameras?.main;
        if (!cam) {
          return;
        }
        cam.fadeOut(400, 0, 0, 0);
        cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          cam.fadeIn(400, 0, 0, 0);
        });
      }

      renderDebugRectangle(entity: any, entityId: string) {
        renderDebugRectangle(this, entity, entityId);
      }

      toggleCollisionDebug() {
        // Call parent method to handle existing debug functionality
        super.toggleCollisionDebug();

        // Toggle debug rectangles visibility
        const debugEnabled = (this as any).debugEnabled || false;
        toggleDebugRectangles(this, debugEnabled);

        console.log(
          `🟩 Chunk debug rectangles ${debugEnabled ? 'ENABLED' : 'DISABLED'}`
        );
      }

      renderEnemy(enemy: any, enemyId: string) {
        // Check if enemy already exists
        if (this.enemyEntities[enemyId]) {
          console.warn('🚨 Duplicate enemy creation detected:', enemyId);
          console.warn('Existing enemy:', this.enemyEntities[enemyId]);
          return;
        }

        renderEnemySprite(this, enemy, enemyId);

        // If this enemy is the current selected target, apply indicator now
        const me = this.room?.state.players.get(this.room?.sessionId);
        if (
          me &&
          me.currentAction === 'attack_enemy' &&
          me.actionTarget === enemyId
        ) {
          if (this.entityManager && this.entityManager.hasEntity(enemyId)) {
            this.createSelectedIndicatorForEnemy(enemyId);
            this.currentSelectedTargetId = enemyId;
          }
        }
      }

      renderNPC(npc: any, npcId: string) {
        console.log('🎭 Rendering NPC:', npc.name, npcId);

        // Check if NPC already exists
        if (this.npcEntities[npcId]) {
          console.warn('🚨 Duplicate NPC creation detected:', npcId);
          return;
        }

        renderNPCSprite(this, npc, npcId);
      }

      renderProjectile(projectile: any, projectileId: string) {
        renderProjectileSprite(this, projectile, projectileId);

        // Play projectile SFX for player-owned projectiles
        if (projectile.ownerId && !projectile.ownerId.startsWith('enemy_')) {
          this.playSFX('pewpew', 0.7);
        }
      }

      renderPlayer() {}
      // createProceduralTerrain method inherited from base GameScene via EnvironmentSystem

      // Helper method to map item types to inventory types
      mapItemTypeToInventoryType(
        itemType: string
      ): 'coin' | 'potion' | 'weapon' | 'material' | 'wearable' {
        const typeMap: Record<
          string,
          'coin' | 'potion' | 'weapon' | 'material' | 'wearable'
        > = {
          sword: 'weapon',
          shield: 'weapon',
          potion: 'potion',
          gem: 'material',
          wearable: 'wearable',
        };
        return typeMap[itemType] || 'material';
      }

      // generateTrees method removed - trees are now server-managed entities
      // Trees are spawned by MapGenerator.ts and rendered via room.state.entities.onAdd

      // createTree method removed - trees are now server-managed entities
      // Tree rendering handled automatically via room.state.entities.onAdd listener

      showGameOver() {
        console.log('Showing Game Over screen...');

        // Pause the game (but keep input active)
        this.scene.pause();

        // Ensure input is still active even when paused
        this.input.enabled = true;

        // Create dark overlay
        const overlay = this.add.rectangle(
          this.cameras.main.centerX,
          this.cameras.main.centerY,
          this.cameras.main.width,
          this.cameras.main.height,
          0x000000,
          0.8
        );
        overlay.setScrollFactor(0); // Stay fixed on screen
        overlay.setDepth(1000); // On top of everything

        // Game Over text
        const gameOverText = this.add.text(
          this.cameras.main.centerX,
          this.cameras.main.centerY - 60,
          'GAME OVER',
          {
            fontSize: '48px',
            color: '#ff0000',
            fontFamily: HUD_PHASER_FONT_FAMILY,
            align: 'center',
          }
        );
        gameOverText.setOrigin(0.5);
        gameOverText.setScrollFactor(0);
        gameOverText.setDepth(1001);

        // Subtitle text
        const subtitleText = this.add.text(
          this.cameras.main.centerX,
          this.cameras.main.centerY + 10,
          'You were defeated by the enemies!',
          {
            fontSize: '18px',
            color: '#ffffff',
            fontFamily: HUD_PHASER_FONT_FAMILY,
            align: 'center',
          }
        );
        subtitleText.setOrigin(0.5);
        subtitleText.setScrollFactor(0);
        subtitleText.setDepth(1001);

        // Create DOM-based Play Again button (works even when Phaser is paused)
        const domButton = document.createElement('button');
        domButton.innerHTML = 'PLAY AGAIN';
        domButton.style.cssText = `
                position: fixed;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -30px);
                z-index: 9999;
                background: #4CAF50;
                color: white;
                border: 2px solid white;
                padding: 12px 24px;
                font-size: 18px;
                font-family: Sixtyfour, system-ui, sans-serif;
                font-weight: bold;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.2s ease;
                pointer-events: auto;
              `;

        // Add hover effects
        domButton.addEventListener('mouseenter', () => {
          console.log('🖱️ DOM Button hover detected');
          domButton.style.background = '#45a049';
          domButton.style.transform = 'translate(-50%, -30px) scale(1.05)';
        });

        domButton.addEventListener('mouseleave', () => {
          console.log('🖱️ DOM Button hover ended');
          domButton.style.background = '#4CAF50';
          domButton.style.transform = 'translate(-50%, -30px) scale(1)';
        });

        // Add click handler
        domButton.addEventListener('click', () => {
          console.log('🔄 DOM Play Again button CLICKED! Reloading page...');
          window.location.reload();
        });

        // Add button to DOM
        document.body.appendChild(domButton);

        // Store reference for cleanup (optional - will be removed on page reload anyway)
        (this as any).domButton = domButton;

        // Alternative keyboard shortcut instruction
        const shortcutText = this.add.text(
          this.cameras.main.centerX,
          this.cameras.main.centerY + 120,
          'Or press R to restart',
          {
            fontSize: '14px',
            color: '#aaaaaa',
            fontFamily: 'Sixtyfour, system-ui, sans-serif',
            align: 'center',
          }
        );
        shortcutText.setOrigin(0.5);
        shortcutText.setScrollFactor(0);
        shortcutText.setDepth(1001);

        // Keyboard shortcut handler with debugging
        const rKey = this.input.keyboard!.addKey('R');
        rKey.on('down', () => {
          console.log('⌨️ R key pressed - reloading page...');
          window.location.reload();
        });

        // Also try listening to global keyboard events as backup
        document.addEventListener('keydown', (event) => {
          if (event.key.toLowerCase() === 'r') {
            console.log('⌨️ Global R key pressed - reloading page...');
            window.location.reload();
          }
        });

        // Add pulsing effect to Game Over text
        this.tweens.add({
          targets: gameOverText,
          scaleX: 1.1,
          scaleY: 1.1,
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }

    // Detect mobile device for renderer configuration
    const isMobileDevice = () => {
      if (typeof navigator === 'undefined') return false;
      const userAgent = navigator.userAgent.toLowerCase();
      return (
        /android|webos|iphone|ipad|ipod|blackberry|windows phone|mobile/.test(
          userAgent
        ) ||
        (window.innerWidth <= 1024 && 'ontouchstart' in window)
      );
    };

    // Configure renderer type based on device capabilities
    let rendererType = Phaser.default.AUTO;
    let rendererConfig = {
      pixelArt: true,
      antialias: false, // Disable AA to prevent 1px seams on tilemaps
    };

    if (isMobileDevice()) {
      // Try WebGL first on mobile with mobile-optimized settings
      rendererType = Phaser.default.WEBGL;

      // Mobile-optimized WebGL settings
      rendererConfig = {
        pixelArt: true, // Enable pixel art mode for crisp scaling
        antialias: false, // Disable AA to prevent 1px seams on tilemaps
        //@ts-ignore
        depth: false, // Disable depth buffer if not needed
        stencil: false, // Disable stencil buffer if not needed
        premultipliedAlpha: false, // Avoid alpha blending issues
        preserveDrawingBuffer: false, // Don't preserve framebuffer
        failIfMajorPerformanceCaveat: false, // Allow WebGL even with performance caveats
      };

      debugLog(
        '📱 Mobile device detected, using WebGL renderer with mobile optimizations'
      );
    }

    // Helper function to create game with fallback
    const createGameWithFallback = (config: any): any => {
      try {
        const game = new Phaser.default.Game(config);

        // Check if the game initialized properly
        if (!game.renderer) {
          throw new Error('Renderer failed to initialize');
        }

        return game;
      } catch (error) {
        console.warn('Game creation failed:', error);

        // If WebGL failed, fallback to Canvas
        if (config.type !== Phaser.default.CANVAS) {
          console.log(
            '🔄 Falling back to Canvas renderer for compatibility...'
          );
          const fallbackConfig = {
            ...config,
            type: Phaser.default.CANVAS,
            render: {}, // Clear render config for Canvas
          };
          return new Phaser.default.Game(fallbackConfig);
        }

        throw error; // Re-throw if Canvas also fails
      }
    };

    // Create scale configuration (guard against zero/NaN sizes on desktop)
    const baseWidth = Math.max(320, Math.floor(Number(window.innerWidth) || 1));
    const baseHeight = Math.max(
      240,
      Math.floor(Number(window.innerHeight) || 1)
    );
    const scaleConfig = isMobileDevice()
      ? {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          // Use larger game resolution on mobile to show more world (maintain aspect ratio)
          width: Math.max(320, Math.floor(window.innerWidth * 1.5)),
          height: Math.max(240, Math.floor(window.innerHeight * 1.5)),
          // Less aggressive device pixel ratio handling for better zoom control
          zoom: 1,
        }
      : {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: baseWidth,
          height: baseHeight,
          min: { width: 320, height: 240 },
        };

    console.log('📱 Mobile scale config:', scaleConfig);

    // Add a DOM splash overlay immediately to avoid initial gray frames
    try {
      const container = document.getElementById('game-container');
      const hasReactOverlay = document.getElementById('react-splash-overlay');
      const hasPhaserOverlay = document.getElementById('phaser-splash-overlay');
      if (container && !hasReactOverlay && !hasPhaserOverlay) {
        const style = window.getComputedStyle(container);
        if (style.position === 'static') {
          (container as HTMLElement).style.position = 'relative';
        }
        const overlay = document.createElement('div');
        overlay.id = 'phaser-splash-overlay';
        overlay.style.position = 'absolute';
        overlay.style.inset = '0';
        overlay.style.backgroundImage = 'url(/images/splash.png)';
        overlay.style.backgroundSize = 'cover';
        overlay.style.backgroundPosition = 'center';
        overlay.style.zIndex = '1';
        overlay.style.opacity = '1';
        container.appendChild(overlay);
      }
    } catch {}

    // Create Phaser game with GameScene and fallback support
    const gameConfig = {
      type: rendererType,
      width: isMobileDevice()
        ? Math.max(320, Math.floor(window.innerWidth * 1.5))
        : baseWidth,
      height: isMobileDevice()
        ? Math.max(240, Math.floor(window.innerHeight * 1.5))
        : baseHeight,
      parent: 'game-container',
      backgroundColor: '#000000',
      scale: scaleConfig,
      scene: [LoadingScene, LocalGameScene],
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      render: {
        ...rendererConfig,
      },
    };

    const game = createGameWithFallback(gameConfig);

    console.log(
      'Phaser game created successfully with Colyseus integration:',
      game,
      'Renderer type:',
      game.renderer?.type === 0
        ? 'Canvas'
        : game.renderer?.type === 1
          ? 'WebGL'
          : 'Unknown'
    );

    // Add global debug functions (dev only)
    if (typeof window !== 'undefined') {
      // Spawn two portals next to player (server-side placement)
      (window as any).spawnPortalsHere = () => {
        const gameScene = game.scene.getScene('GameScene');
        if (gameScene && (gameScene as any).room) {
          console.log('🌀 Requesting portals to spawn near player...');
          (gameScene as any).room.send('debug_spawn_portals_here');
        } else {
          console.error('❌ Game scene or room not available');
        }
      };

      (window as any).spawnRektDoggos = (count: number = 3) => {
        console.log(`🐕 Spawning ${count} RektDoggos via debug command...`);
        const gameScene = game.scene.getScene('GameScene');
        if (gameScene && (gameScene as any).room) {
          (gameScene as any).room.send('debug_spawn_doggos', { count });
        } else {
          console.error('❌ Game scene or room not available');
        }
      };

      console.log('🌀 Debug function added: window.spawnPortalsHere()');
      console.log('🐕 Debug function added: window.spawnRektDoggos(count)');
    }

    setPhaserGame(game);
    // Make game accessible to HUD for audio settings updates
    (window as any).phaserGame = game;
  } catch (error) {
    console.error('Failed to create Phaser game:', error);
    setError(error instanceof Error ? error.message : 'Failed to create game');
  }
};
