import { Room, Client } from 'colyseus';
import { MapSchema } from '@colyseus/schema';
import { readSessionFromRequest, getSessionSecret } from '../lib/auth/session';
import { verifySessionToken, SESSION_COOKIE_NAME } from '../lib/auth/token';
import { parse as parseCookie } from 'cookie';
import {
  authSessionsRepo,
  progressionRepo,
  inventoryRepo,
  inventoryEventsRepo,
  playersRepo,
  gamesRepo,
  gamePlayersRepo,
  enemyKillsRepo,
  enemyDropsRepo,
  lootDistributionsRepo,
  lootCatalogRepo,
  economyRepo,
  equipmentRepo,
  chestsRepo,
  runScoresRepo,
  dailyHighStakesStateRepo,
  dailyBossHighScoresRepo,
  tokenWithdrawalsRepo,
  progressionRecordToProfile,
  inventoryRecordToItem,
  sanitizeInventoryItems as sanitizeInventoryPayloads,
  getLickTongueCount,
  type InventoryItemPayload,
  type LootCatalogRecord,
  type LootDistributionRecord,
  type PlayerInventoryRecord,
  runTransaction,
} from '../lib/db';
import {
  formatBaseUnits,
  getWithdrawalTokenConfig,
  parseAmountToBaseUnits,
} from '../lib/withdrawals/token-config';
import {
  executeInventoryRemoval,
  InventoryRemovalError,
  type InventoryRemoveRequest,
  type AppliedInventoryRemoval,
} from '../lib/inventory-removal';
import {
  GameRoomState,
  PlayerSchema,
  EntitySchema,
  EnemySchema,
  NPCSchema,
  ProjectileSchema,
} from '../schemas';
import { MapGenerator } from '../utils/MapGenerator';
import {
  GAME_CONFIG,
  SCORE_CONFIG,
  FOG_OF_WAR_ENABLED,
  INITIAL_ENEMY_COUNT,
  TIMED_SPAWN,
  LEVERAGE_CONFIG,
} from '../lib/constants';
import {
  computeHighStakesBossPayout,
  getDailyDate,
  getDailyRunsConfig,
  getReferenceScore,
} from '../lib/daily-runs';
import { generateRoomId } from '../lib/utils';
import { findPath } from '../lib/pathfinding';
import { ActionManager } from '../lib/actions/manager';
import { ActionFactory } from '../lib/actions/factory';
import { getDifficultyTier } from '../data/difficulty-tiers';
import {
  rollChestItems,
  rollChestCurrency,
  LOOT_SOURCE_IDS,
  type DroppedItemData,
} from '../data/loot-table';
import {
  getEntryFeeCentsForPlayer,
  getMaxEquippedRarityForPlayer,
  getWearableCostBracket,
} from '../lib/economy/entry-cost';
import { SPELLS_BY_ID } from '../data/spells';

import { normalizeQualityTier } from '../data/wearable-quality';
import { syncPlayerCharacterStats } from '../lib/player-stats';
import { emitGameLog, flushGameLogs } from '../lib/logging';
import { resolvePreferredHandWeaponIndex } from '../lib/hand-weapon-utils';
import {
  handleManualSpellCast,
  setSpellAutocast,
  getSpellAutocast,
  processScheduledSpellFollowups,
} from '../lib/spell-system';
import {
  ProgressionProfile,
  createDefaultProfile,
  sanitizeProfile,
  applyXp as applyXpToProfile,
  computeProgressionModifiers,
  cloneProfile,
  toSerializableProfile,
  getLevelProgress,
} from '@gotchiverse/progression';
import {
  createKillStreakProfile,
  applyKillStreakIncrement,
  applyKillStreakDecay,
  computeKillStreakModifiers,
  resolveArchetypeForCharacter,
  getKillStreakUnitDeltaForClassification,
  type KillStreakProfile,
} from '../lib/progression/killStreak';
import {
  getEnemyStats,
  ELITE_ARCHETYPES,
  EliteArchetype,
} from '../data/enemies';
import { ITEM_COLORS } from '../data/items';
import type { EmoteInput } from '../types';
import { setupDebugHandlers } from '../lib/debug';
import { clearAuraEffects } from '../lib/systems/AuraSystem';

import {
  isOnFloor,
  checkObstacleCollision as mapCheckObstacleCollision,
} from '../lib/systems/MapCollisionSystem';
import {
  setGotchiWearables,
  setGotchiWearableAssignments,
} from '../data/characters';
import {
  buildObstacleSet as pfBuildObstacleSet,
  updateAutoWalking as pfUpdateAutoWalking,
} from '../lib/systems/PathfindingSystem';
import { updateEnemyMovement } from '../lib/systems/EnemySystem';
import { updateProjectiles } from '../lib/systems/ProjectileSystem';
import { updateVacuumSystem } from '../lib/systems/VacuumSystem';
import { updatePlayerRegen } from '../lib/systems/PlayerRegenSystem';
import {
  getMovementSpeedScalar,
  isEntityStunned,
  updateStatusSystem,
} from '../lib/systems/StatusSystem';
import {
  handlePortalInteraction as sysHandlePortalInteraction,
  handleEnemyDeath as sysHandleEnemyDeath,
} from '../lib/systems/EnemyDeathSystem';
import {
  spawnEnemyOfType as sysSpawnEnemyOfType,
  getRandomEnemyType as sysGetRandomEnemyType,
  setPlayerSpawnPosition as sysSetPlayerSpawnPosition,
  spawnEliteGroup as sysSpawnEliteGroup,
  EliteChunkInfo,
} from '../lib/systems/EnemySpawnSystem';
import { performResourceHarvest as sysPerformResourceHarvest } from '../lib/systems/ResourceSystem';
import { spawnFloorPortals } from '../lib/systems/PortalSystem';
import {
  spawnNPCs as sysSpawnNPCs,
  spawnNPCsFromConfigs as sysSpawnNPCsFromConfigs,
  handleNPCInteraction as sysHandleNPCInteraction,
} from '../lib/systems/NPCSystem';
import { respawnBot as sysRespawnBot } from '../lib/systems/BotSystem';
import type { EntityKind as EntityKindType } from '../types';
import { FogOfWarSystem } from '../lib/systems/FogOfWarSystem';
import type { GameRoomApi } from '../types/game-room-api';
import {
  ensureServerBroadcaster,
  type ServerBroadcaster,
} from '../lib/messaging';
import type { FogStatePayload } from '../types/messages';
import {
  initializeLeverageState as leverageInitializeLeverageState,
  resetLeverageForNewFloor as leverageResetLeverageForNewFloor,
  openFloorLeverageForNewFloor as leverageOpenFloorLeverageForNewFloor,
  scheduleRoomLeverageLockTimeout as leverageScheduleRoomLeverageLockTimeout,
  clearRoomLeverageLockTimer as leverageClearRoomLeverageLockTimer,
  handleRoomLeverageEngagement as leverageHandleRoomLeverageEngagement,
  getLeverageTotal as leverageGetLeverageTotal,
  sendLeverageStateToClient as leverageSendLeverageStateToClient,
  handleSetFloorLeverage as leverageHandleSetFloorLeverage,
  handleSetRoomLeverage as leverageHandleSetRoomLeverage,
} from '../lib/systems/LeverageSystem';
import {
  buildEquipmentStateForCharacter,
  normalizeEquipmentSlotName,
  normalizeStoredWearableList,
  extractWearableSlugs,
  serializeStoredWearable,
  type EquipmentOverride,
  type EquipmentBroadcastPayload,
  type StoredWearableEntry,
} from '../lib/equipment-service';
import {
  getEnemyDifficultyConfig,
  getRoomEnemyDifficultyMultipliers,
  type EnemyDifficultyConfig,
  type EnemyDifficultyMultipliers,
} from '../lib/enemy-difficulty';
import {
  initializeStagingEnvironment as stagingInitializeStagingEnvironment,
  handleStagingPortalInteraction as stagingHandleStagingPortalInteraction,
  startStagingCountdown as stagingStartStagingCountdown,
  beginDungeonRun as stagingBeginDungeonRun,
  scheduleStagingAutoClose as stagingScheduleStagingAutoClose,
  clearStagingAutoCloseTimer as stagingClearStagingAutoCloseTimer,
  trackEntryFeeCharge as stagingTrackEntryFeeCharge,
  markEntryFeesNonRefundable as stagingMarkEntryFeesNonRefundable,
  refundEntryFee as stagingRefundEntryFee,
  scheduleLateJoinCutoff as stagingScheduleLateJoinCutoff,
  clearLateJoinTimer as stagingClearLateJoinTimer,
} from './StagingRoom';
import { verifyGotchiOwnership } from '../lib/aavegotchi';
import {
  fetchGeneratedDungeonChunks,
  loadMapChunks,
} from '../data/maps-loader';
import {
  PORTAL_MAGE_SHOP_BY_ID,
  type ShopItemDefinition,
} from '../data/npc-shops/portalmage';
import {
  computeHealthPotionHeal,
  computeManaPotionRestore,
} from '../lib/potion-utils';

const DEBUG = process.env.DEBUG === '1';
const DEFAULT_UNLOCKED_TIERS = ['normal_1'];
const USDC_LOOT_CATALOG_NAME = 'USDC Airdrop';
const GHST_LOOT_CATALOG_NAME = 'GHST Airdrop';
const STAGING_AUTO_CLOSE_MS = 15 * 60 * 1000;
const STAGING_LATE_JOIN_WINDOW_MS = 60 * 1000;
const PORTAL_START_COUNTDOWN_MS = 3000;
const DEFAULT_VISION_RADIUS_TILES = 8;
const NPC_INTERACTION_RANGE_PX = 100;
const NPC_PURCHASE_COOLDOWN_MS = 250;
const GOLD_NAME_ALIASES = new Set(['gold', 'gold coin']);
const GOLD_CURRENCY_TYPES = new Set(['coin', 'gold_coin', 'gold']);

type RoomPhase = 'staging' | 'countdown' | 'in_game' | 'ended';

function safeParseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function parseWearableArray(raw: unknown): string[] {
  return extractWearableSlugs(raw);
}

interface TreasureLootSummaryEntry {
  [key: string]: unknown;
  category: string;
  name?: string;
  quantity?: number;
  rarity?: string;
  usdcAmount?: number;
}
interface ChestLootAllocation {
  amount: number;
  distribution: LootDistributionRecord;
  lootId: string;
  lootName: string | null;
  decimals: number | null;
  remainingAfter: number | null;
  requestedAmount: number;
  precision: number;
}

interface GamePlayerRuntimeStats {
  playerId: string;
  gamePlayerId: string;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  coinsCollected: number;
  usdcEarnedBaseUnits: number;
  xpGained: number;
  levelStart: number;
  levelEnd: number;
}

interface PlayerRuntimeScoreState {
  score: number;
  eligible: boolean;
  enteredTreasureAt: number | null;
}

interface DungeonChunkLayoutEntry {
  x: number;
  y: number;
  chunkName: string;
  role?: string;
  tags?: string[];
  anchorX?: number;
  anchorY?: number;
  widthTiles?: number;
  heightTiles?: number;
  worldWidthPx?: number;
  worldHeightPx?: number;
  ports?: Array<{
    side: 'N' | 'S' | 'E' | 'W';
    centerOffsetTiles?: number;
    widthTiles?: number;
  }>;
}

export interface GameRoomOptions {
  region?: string;
  isPrivate?: boolean;
  roomCode?: string;
  maxPlayers?: number;
  difficultyTier?: string;
  // Admin/dev preview options
  seed?: number;
  skipStaging?: boolean;
  preferredChunkName?: string;
  // Admin-only room: require admin wallet session to join
  adminOnly?: boolean;
}

export class GameRoom extends Room<GameRoomState> {
  public msg!: ServerBroadcaster;
  public now: number = 0;
  private mapGenerator!: MapGenerator;
  private chunkLayoutData: Array<{ x: number; y: number; chunkName: string }> =
    [];
  private dungeonChunkLayoutData: DungeonChunkLayoutEntry[] = [];
  private stagingChunkLayoutData: Array<{
    x: number;
    y: number;
    chunkName: string;
  }> = [];

  // Server-side inventory tracking (not synchronized to clients to prevent large payloads)
  private playerInventories: Map<string, InventoryItemPayload[]> = new Map();
  private playerProgression: Map<string, ProgressionProfile> = new Map();
  private killStreakBySession: Map<string, KillStreakProfile> = new Map();
  private sessionPlayerIds: Map<string, string> = new Map();
  private playerEquipmentSnapshots: Map<string, string[]> = new Map();
  private progressionWriteQueues: Map<string, Promise<void>> = new Map();
  private recentEnemyKillIds: Map<
    string,
    { id: string | null; timeout: NodeJS.Timeout | null }
  > = new Map();
  private entityLootDistributions: Map<
    string,
    {
      distributionId: string | null;
      timeout: NodeJS.Timeout | null;
      source?: string;
      metadata?: Record<string, unknown>;
      playerId?: string | null;
    }
  > = new Map();
  private playerDeathsThisRun: Set<string> = new Set();
  private currentGameId: string | null = null;
  private gamePlayerStats: Map<string, GamePlayerRuntimeStats> = new Map();
  private gameStatusFinalized = false;
  private hadAnyPlayers = false;
  private tickInterval!: NodeJS.Timeout;
  private snapshotInterval!: NodeJS.Timeout;
  private timedSpawnInterval: NodeJS.Timeout | null = null;
  private roomLeverageLockTimer: NodeJS.Timeout | null = null;
  private treePositions: Array<{ x: number; y: number }> = [];
  private actionManager = new ActionManager();
  private lastVacuumUpdate: number = 0; // Performance optimization for vacuum system
  private isRoomTransitioning: boolean = false; // pause timed spawns during transitions
  private isPrivateRoom: boolean = false;
  private isAdminOnly: boolean = false;
  private phase: RoomPhase = 'staging';
  private phaseChangedAt: number = 0;
  private runStartedAt: number | null = null;
  private stagingAutoCloseTimer: NodeJS.Timeout | null = null;
  private portalCountdownTimer: NodeJS.Timeout | null = null;
  private lateJoinTimer: NodeJS.Timeout | null = null;
  private entryFeeLedger: Map<
    string,
    { amountCents: number; chargedAtIso: string | null; refundable: boolean }
  > = new Map();
  private playerScoreStateByPlayerId: Map<string, PlayerRuntimeScoreState> =
    new Map();
  private pendingScoreDeltas: Map<string, number> = new Map();
  private npcPurchaseCooldowns: Map<string, number> = new Map();
  private playersDiedThisRunByPlayerId: Set<string> = new Set();
  private persistedScorePlayerIds: Set<string> = new Set();
  private highStakesPlayerIds: Set<string> = new Set();
  private highStakesDateByPlayerId: Map<string, string> = new Map();
  private highStakesBossBonusByPlayerId: Map<
    string,
    { usdc: number; ghst: number }
  > = new Map();
  private stagingEnabled: boolean = true;
  private hasSpawnedDungeonPopulation: boolean = false;
  private initialEnemySpawns: Array<{ type: string; x: number; y: number }> =
    [];
  // Cache of latest continuous input per client to apply on tick
  private latestInputByClientId: Map<
    string,
    {
      left: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
      sprint: boolean;
    }
  > = new Map();
  private dungeonEntityBlueprints: Array<{
    id: string;
    kind: EntityKindType;
    x: number;
    y: number;
    state: string;
  }> = [];
  private stagingSpawnPoints: Array<{ x: number; y: number }> = [];
  private eliteGroupsByRoom: Map<
    string,
    Array<{
      leaderId: string;
      archetypeId: string;
      centerX: number;
      centerY: number;
      minionIds: string[];
      roomTier: string;
      source?: 'hunted' | 'natural';
      spawnedAt?: number;
    }>
  > = new Map();
  private elitesSpawnedThisFloor = 0;
  private huntedLastSpawnAt = 0;
  private currentFloor = 0;
  private floorReached = 0;
  private bossKilled = false;
  private preferredChunkName: string | undefined;
  private fogOfWarSystem: FogOfWarSystem | null = null;

  private logGameEvent(
    event: string,
    message: string,
    extra: {
      level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
      playerId?: string | null;
      sessionId?: string | null;
      details?: Record<string, unknown>;
      gameId?: string | null;
    } = {}
  ) {
    const resolvedGameId = extra.gameId ?? this.currentGameId;
    if (!resolvedGameId) {
      return;
    }
    emitGameLog({
      event,
      message,
      level: extra.level,
      gameId: resolvedGameId,
      playerId: extra.playerId ?? undefined,
      sessionId: extra.sessionId ?? undefined,
      details: extra.details,
    });
  }
  private fogActiveForClients = false;
  private visibleEnemyIds: Set<string> = new Set();
  private visibleNpcIds: Set<string> = new Set();
  private visibleProjectileIds: Set<string> = new Set();
  private dungeonGroupSpawnAnchor: { x: number; y: number } | null = null;
  private enemyDifficultyConfig: EnemyDifficultyConfig =
    getEnemyDifficultyConfig();
  private enemyDifficultyRescaleQueue: string[] = [];
  private enemyDifficultyRescaleMultipliers: EnemyDifficultyMultipliers = {
    damageMultiplier: 1,
    hpMultiplier: 1,
    speedMultiplier: 1,
  };
  private enemyDifficultyRescaleNextProcessAt = 0;
  private enemyDifficultyPausedRemainingMs: number | null = null;

  private getInventoryKey(item: InventoryItemPayload) {
    const type = String(item.type ?? item.itemType ?? 'unknown').toLowerCase();
    const name = String(item.name ?? item.id ?? 'item').toLowerCase();
    if (type === 'wearable') {
      const instanceKey = String(
        item.inventoryItemId ?? item.instanceId ?? item.id ?? name
      );
      return `${type}::${instanceKey}`;
    }
    const wearable =
      item.wearableId != null ? `::wearable:${item.wearableId}` : '';
    return `${type}::${name}${wearable}`;
  }

  private resetEnemyDifficultyQueueState(): void {
    this.enemyDifficultyRescaleQueue = [];
    this.enemyDifficultyRescaleNextProcessAt = 0;
    this.enemyDifficultyRescaleMultipliers = {
      damageMultiplier: 1,
      hpMultiplier: 1,
      speedMultiplier: 1,
    };
  }

  public markFloorReached(floorIndex: number): number {
    const normalized = Math.max(1, Math.floor(Number(floorIndex) || 0));
    if (!(normalized > 0)) {
      return this.floorReached;
    }
    if (normalized > this.floorReached) {
      this.floorReached = normalized;
      this.state.floorReached = normalized;
    }
    return this.floorReached;
  }

  public getFloorReached(): number {
    return Math.max(0, Number(this.floorReached) || 0);
  }

  public handleFloorAdvanced(nextFloor: number): number {
    const normalized =
      nextFloor > 0 ? Math.max(1, Math.floor(Number(nextFloor) || 0)) : 1;
    this.currentFloor = normalized;
    this.state.currentFloor = normalized;
    this.markFloorReached(normalized);
    return normalized;
  }

  public resetLeverageForNewFloor(options: { broadcast?: boolean } = {}) {
    leverageResetLeverageForNewFloor(this, options);
  }

  public openFloorLeverageForNewFloor(options: { broadcast?: boolean } = {}) {
    leverageOpenFloorLeverageForNewFloor(this, options);
  }

  public handleRoomLeverageEngagement(reason: 'combat' | 'timeout' = 'combat') {
    leverageHandleRoomLeverageEngagement(this, reason);
  }

  public getLeverageTotal(): number {
    return leverageGetLeverageTotal(this);
  }

  private handleSetFloorLeverage(client: Client, data?: { value?: number }) {
    leverageHandleSetFloorLeverage(this, client, data);
  }

  private handleSetRoomLeverage(client: Client, data?: { value?: number }) {
    leverageHandleSetRoomLeverage(this, client, data);
  }

  public resetEnemyDifficultyMeter(now = Date.now()): void {
    const config = this.enemyDifficultyConfig;
    this.enemyDifficultyPausedRemainingMs = null;
    this.resetEnemyDifficultyQueueState();
    this.state.enemyDifficultyStartedAt = now;
    this.state.enemyDifficultyLevel = 0;
    if (config.enabled && this.phase === 'in_game') {
      this.state.enemyDifficultyEnabled = true;
      this.state.enemyDifficultyNextAt = now + config.tickIntervalMs;
    } else {
      this.state.enemyDifficultyEnabled = false;
      this.state.enemyDifficultyNextAt = 0;
    }
  }

  public incrementEnemyDifficultyLevel(
    delta = 1,
    reason: string = 'manual',
    now = Date.now()
  ): { previous: number; current: number } {
    const previous = Math.max(
      0,
      Math.floor(Number(this.state.enemyDifficultyLevel) || 0)
    );
    const safeDelta = Math.max(0, Math.floor(Number(delta) || 0));
    if (!(safeDelta > 0)) {
      return { previous, current: previous };
    }
    const nextLevel = previous + safeDelta;
    this.state.enemyDifficultyLevel = nextLevel;
    if (
      this.enemyDifficultyConfig.enabled &&
      this.state.enemyDifficultyEnabled &&
      this.phase === 'in_game'
    ) {
      try {
        const multipliers = getRoomEnemyDifficultyMultipliers(
          this.state as any
        );
        this.enqueueEnemyDifficultyRescale(nextLevel, multipliers, now);
      } catch (error) {
        console.warn('Failed to rescale enemies after difficulty increment', {
          reason,
          error,
        });
      }
    }
    return { previous, current: nextLevel };
  }

  public suspendEnemyDifficultyMeter(
    options: { resetLevel?: boolean } = {},
    now = Date.now()
  ): void {
    this.state.enemyDifficultyEnabled = false;
    this.state.enemyDifficultyNextAt = 0;
    this.enemyDifficultyPausedRemainingMs = null;
    this.resetEnemyDifficultyQueueState();
    if (options.resetLevel) {
      this.state.enemyDifficultyLevel = 0;
      this.state.enemyDifficultyStartedAt = now;
    }
  }

  public pauseEnemyDifficultyMeter(reason?: string, now = Date.now()): void {
    if (!this.state.enemyDifficultyEnabled) {
      return;
    }
    const nextAt =
      this.state.enemyDifficultyNextAt > 0
        ? this.state.enemyDifficultyNextAt
        : now + this.enemyDifficultyConfig.tickIntervalMs;
    this.enemyDifficultyPausedRemainingMs = Math.max(0, nextAt - now);
    this.state.enemyDifficultyEnabled = false;
  }

  public resumeEnemyDifficultyMeter(reason?: string, now = Date.now()): void {
    if (this.state.enemyDifficultyEnabled) {
      return;
    }
    if (this.phase !== 'in_game') {
      return;
    }
    if (!this.enemyDifficultyConfig.enabled) {
      return;
    }
    const interval = this.enemyDifficultyConfig.tickIntervalMs;
    const pauseRemainder = this.enemyDifficultyPausedRemainingMs;
    let delay = interval;
    if (typeof pauseRemainder === 'number') {
      delay = Math.max(0, pauseRemainder);
    } else if (this.state.enemyDifficultyNextAt > now) {
      delay = Math.max(0, this.state.enemyDifficultyNextAt - now);
    }
    this.state.enemyDifficultyNextAt = now + delay;
    if (!this.state.enemyDifficultyStartedAt) {
      this.state.enemyDifficultyStartedAt = now;
    }
    this.enemyDifficultyPausedRemainingMs = null;
    this.state.enemyDifficultyEnabled = true;
  }

  private updateEnemyDifficultyMeter(now: number): void {
    this.processEnemyDifficultyRescaleQueue(now);

    if (!this.state.enemyDifficultyEnabled) {
      return;
    }
    if (this.phase !== 'in_game') {
      return;
    }
    if (this.isRoomTransitioning) {
      return;
    }
    if (this.state.players.size === 0) {
      this.pauseEnemyDifficultyMeter('empty_room', now);
      return;
    }

    if (this.state.enemyDifficultyNextAt <= 0) {
      this.state.enemyDifficultyNextAt =
        now + this.enemyDifficultyConfig.tickIntervalMs;
      return;
    }

    const maxCatchUp = 10;
    let iterations = 0;
    while (now >= this.state.enemyDifficultyNextAt) {
      iterations += 1;
      if (iterations > maxCatchUp) {
        this.state.enemyDifficultyNextAt =
          now + this.enemyDifficultyConfig.tickIntervalMs;
        break;
      }

      const nextLevel = this.state.enemyDifficultyLevel + 1;
      this.state.enemyDifficultyLevel = nextLevel;
      this.state.enemyDifficultyNextAt +=
        this.enemyDifficultyConfig.tickIntervalMs;

      const multipliers = getRoomEnemyDifficultyMultipliers(this.state as any);
      this.enqueueEnemyDifficultyRescale(nextLevel, multipliers, now);
    }
  }

  private enqueueEnemyDifficultyRescale(
    level: number,
    multipliers: EnemyDifficultyMultipliers,
    now: number
  ): void {
    this.enemyDifficultyRescaleMultipliers = multipliers;
    this.enemyDifficultyRescaleQueue = Array.from(this.state.enemies.keys());
    this.enemyDifficultyRescaleNextProcessAt = now;
    this.emitMatchEvent('enemy_meter_tick', {
      level,
      damageMul: multipliers.damageMultiplier,
      hpMul: multipliers.hpMultiplier,
      enemyCount: this.state.enemies.size,
    });
  }

  private processEnemyDifficultyRescaleQueue(now: number): void {
    if (!this.state.enemyDifficultyEnabled) {
      return;
    }
    if (!this.enemyDifficultyRescaleQueue.length) {
      return;
    }
    if (now < this.enemyDifficultyRescaleNextProcessAt) {
      return;
    }

    const batchSize = this.enemyDifficultyConfig.rescaleBatchSize;
    const delayMs = this.enemyDifficultyConfig.rescaleBatchDelayMs;
    const ids = this.enemyDifficultyRescaleQueue.splice(0, batchSize);
    for (const enemyId of ids) {
      const enemy = this.state.enemies.get(enemyId);
      if (!enemy) continue;
      this.applyEnemyDifficultyScalingToEnemy(enemy);
    }

    if (this.enemyDifficultyRescaleQueue.length === 0) {
      this.enemyDifficultyRescaleNextProcessAt = 0;
    } else {
      this.enemyDifficultyRescaleNextProcessAt = now + delayMs;
    }
  }

  private applyEnemyDifficultyScalingToEnemy(enemy: EnemySchema): void {
    const { hpMultiplier, damageMultiplier, speedMultiplier } =
      this.enemyDifficultyRescaleMultipliers;
    const safeHpMultiplier = Math.max(1e-6, hpMultiplier || 1);
    const safeDamageMultiplier = Math.max(1e-6, damageMultiplier || 1);
    const safeSpeedMultiplier = Math.max(1e-6, speedMultiplier || 1);

    const baseMaxHpRaw = (enemy as any)._tierScaledMaxHpBase;
    const baseDamageRaw = (enemy as any)._tierScaledDamageBase;
    const baseSpeedRaw = (enemy as any)._tierScaledSpeedBase;
    let baseMaxHp =
      typeof baseMaxHpRaw === 'number' && Number.isFinite(baseMaxHpRaw)
        ? baseMaxHpRaw
        : enemy.maxHp / safeHpMultiplier;
    let baseDamage =
      typeof baseDamageRaw === 'number' && Number.isFinite(baseDamageRaw)
        ? baseDamageRaw
        : enemy.damage / safeDamageMultiplier;
    let baseSpeed =
      typeof baseSpeedRaw === 'number' && Number.isFinite(baseSpeedRaw)
        ? baseSpeedRaw
        : (Number((enemy as any).speed) || 0) / safeSpeedMultiplier;

    if (!Number.isFinite(baseMaxHp) || baseMaxHp <= 0) {
      baseMaxHp = 1;
    }
    if (!Number.isFinite(baseDamage) || baseDamage < 0) {
      baseDamage = 0;
    }
    if (!Number.isFinite(baseSpeed) || baseSpeed < 0) {
      baseSpeed = 0;
    }

    (enemy as any)._tierScaledMaxHpBase = baseMaxHp;
    (enemy as any)._tierScaledDamageBase = baseDamage;
    (enemy as any)._tierScaledSpeedBase = baseSpeed;

    const previousMaxHp = Math.max(1, Number(enemy.maxHp) || 1);
    const wasDead = enemy.hp <= 0;
    const hpRatio = wasDead
      ? 0
      : Math.max(0, Math.min(1, enemy.hp / previousMaxHp));

    const newMaxHp = Math.max(1, Math.round(baseMaxHp * safeHpMultiplier));
    enemy.maxHp = newMaxHp;
    if (wasDead) {
      enemy.hp = 0;
    } else {
      const nextHp = Math.round(newMaxHp * hpRatio);
      enemy.hp = Math.max(1, nextHp);
    }

    const nextDamage = Math.max(
      0,
      Math.round(baseDamage * safeDamageMultiplier)
    );
    enemy.damage = nextDamage;

    const nextSpeed = Math.max(0, baseSpeed * safeSpeedMultiplier);
    (enemy as any).speed = nextSpeed;
    // Align aura base speed to include meter scaling so aura recalculations preserve meter effects
    if (typeof (enemy as any)._baseSpeed === 'number') {
      (enemy as any)._baseSpeed = nextSpeed;
    }
  }

  static filterBy(
    options: Partial<GameRoomOptions>,
    rooms: Array<{ metadata?: { roomCode?: string; isPrivate?: boolean } }>
  ) {
    // If joining by room code, filter to match the specific room
    if (options.roomCode) {
      return rooms.filter(
        (room) => room.metadata?.roomCode === options.roomCode
      );
    }

    // Default filter for regular joinOrCreate - exclude private rooms
    return rooms.filter((room) => !room.metadata?.isPrivate);
  }

  public checkObstacleCollision(
    x: number,
    y: number,
    radius: number = 20
  ): boolean {
    return mapCheckObstacleCollision(this as any, x, y, radius);
  }

  // Authenticate websocket using session cookie from the HTTP upgrade request
  async onAuth(client: Client, _options: any, request?: any) {
    try {
      const hdrs: any = (request as any)?.headers || {};
      const hasCookie =
        typeof hdrs.cookie === 'string' && hdrs.cookie.length > 0;

      if (hasCookie) {
        try {
          // Cookie parsing logic would go here if needed
        } catch (e) {
          console.log('WS cookie debug: failed to parse cookies', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      } else {
        console.log('WS cookie debug: no cookie header present');
      }
    } catch {
      // Ignore errors in cookie parsing
    }

    const assignAuth = (
      address: string,
      playerId?: string | null,
      isAuthorized?: boolean,
      username?: string | null
    ) => {
      const authData = {
        address: address.toLowerCase(),
        playerId: playerId ?? null,
        isAuthorized: Boolean(isAuthorized),
        username: username ?? null,
      };
      (client as any).auth = authData;
      return authData;
    };

    const tryResolveSession = async (sessionId: string, address: string) => {
      const record = await authSessionsRepo.getValidAuthSessionById(sessionId);
      if (!record) {
        console.warn('WS auth: session not found or expired', { sessionId });
        return false;
      }
      if (record.walletAddress !== address.toLowerCase()) {
        console.warn('WS auth: wallet mismatch', {
          expected: record.walletAddress,
          provided: address,
        });
        return false;
      }
      if (!record.playerId) {
        console.warn('WS auth: session missing playerId', { sessionId });
        return false;
      }
      const player = await playersRepo.getPlayerById(record.playerId);
      if (!player || !player.isAuthorized) {
        console.warn('WS auth: player not authorized', {
          playerId: record.playerId,
          hasPlayer: Boolean(player),
        });
        return false;
      }
      assignAuth(
        record.walletAddress,
        record.playerId,
        player.isAuthorized,
        player.username ?? null
      );
      return true;
    };

    const tryBearerToken = async (bearer: string) => {
      if (!bearer || !bearer.startsWith('Bearer ')) {
        return false;
      }
      const token = bearer.substring(7);
      try {
        const payload = verifySessionToken(token, getSessionSecret());
        if (!payload?.sessionId || !payload.address) {
          console.warn('WS auth: invalid bearer payload');
          return false;
        }
        return await tryResolveSession(payload.sessionId, payload.address);
      } catch (error) {
        console.warn('WS auth: invalid authorization token', {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

    try {
      const hdrs: any = (request as any)?.headers || {};
      const cookieHeader: string | undefined =
        typeof hdrs.cookie === 'string' ? hdrs.cookie : undefined;

      const session = readSessionFromRequest(request as any);
      if (session) {
        // Session found
      } else {
        console.log('WS auth: readSessionFromRequest returned null');
      }
      if (session?.sessionId && session.address) {
        const resolved = await tryResolveSession(
          session.sessionId,
          session.address
        );
        if (resolved) {
          return (client as any).auth;
        }
        console.warn('WS auth: cookie present but session resolution failed');
      }

      // Manual fallback: parse cookie header and verify token directly
      if (!session?.sessionId && cookieHeader) {
        try {
          const cookies = parseCookie(cookieHeader);
          const token = cookies[SESSION_COOKIE_NAME];
          if (token) {
            try {
              const payload = verifySessionToken(token, getSessionSecret());

              if (payload?.sessionId && (payload as any).address) {
                const resolved = await tryResolveSession(
                  (payload as any).sessionId,
                  (payload as any).address
                );
                if (resolved) {
                  return (client as any).auth;
                }
              }
            } catch (e) {
              console.warn('WS auth: manual cookie verify failed', {
                error: e instanceof Error ? e.message : String(e),
              });
            }
          } else {
            console.warn(
              'WS auth: session cookie not found in parsed cookies',
              {
                expectedName: SESSION_COOKIE_NAME,
                cookieKeys: Object.keys(cookies),
              }
            );
          }
        } catch (e) {
          console.warn('WS auth: manual cookie parse failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const authorization = (request as any)?.headers?.authorization;
      if (authorization && (await tryBearerToken(authorization))) {
        return (client as any).auth;
      }

      const optionsAuth =
        (request as any)?.body?.authorization ||
        (request as any)?.query?.authorization ||
        (_options as any)?.authorization;
      if (optionsAuth && (await tryBearerToken(optionsAuth))) {
        return (client as any).auth;
      }

      // Allow unauthenticated connections; onJoin will enforce access for
      // features (like custom gotchis) that require a signed session.
      console.warn(
        'WS auth: no valid session found; allowing anonymous connection'
      );

      console.log('UNAUTHORIZED CONNECTION');
      console.log('resolved:', session);

      return true;
    } catch (error) {
      console.warn('WS auth: unexpected error during authentication', {
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }

  public cancelPlayerAction(
    player: PlayerSchema,
    reason: string = 'Cancelled'
  ): boolean {
    return this.actionManager.cancelAction(player, this, reason);
  }

  private buildObstacleSet(): Set<string> {
    return pfBuildObstacleSet(this as any);
  }

  async onCreate(options: GameRoomOptions = {}) {
    console.log('GameRoom created with options:', options);

    this.setState(new GameRoomState());
    this.state.attachRoom(this);
    this.msg = ensureServerBroadcaster(this);
    // Start perf sampler broadcast
    this.startPerfSampler();

    if (FOG_OF_WAR_ENABLED) {
      this.fogOfWarSystem = new FogOfWarSystem({
        tileSize: GAME_CONFIG.TILE_SIZE,
        mapWidth: GAME_CONFIG.MAP_WIDTH,
        mapHeight: GAME_CONFIG.MAP_HEIGHT,
        visionRadiusTiles: DEFAULT_VISION_RADIUS_TILES,
      });
    } else {
      this.fogOfWarSystem = null;
      this.fogActiveForClients = false;
    }

    // Initialize room state
    this.state.id = generateRoomId(); // Always use generated ID for room ID
    this.isPrivateRoom = Boolean(options.isPrivate);
    // Admin-only rooms are implicitly private and gated by wallet allowlist
    this.isAdminOnly = Boolean(options.adminOnly);
    if (this.isAdminOnly) {
      this.isPrivateRoom = true;
    }
    this.state.roomCode =
      options.roomCode || (this.isPrivateRoom ? this.generateRoomCode() : '');
    this.state.seed = Number.isFinite(options.seed as any)
      ? Math.floor(Number(options.seed))
      : Math.floor(Math.random() * 1000000);
    this.state.region = options.region || 'us-east';
    this.state.difficultyTier = (
      (options.difficultyTier as string) || 'normal_1'
    )
      .toLowerCase()
      .replace(/-/g, '_');
    this.state.startedAt = Date.now();
    // Initialize deterministic tick clock
    this.now = this.state.startedAt;
    this.state.hostSessionId = '';
    this.preferredChunkName =
      typeof options.preferredChunkName === 'string'
        ? options.preferredChunkName
        : undefined;
    // Allow admin/dev to bypass staging and go straight in-game
    // Also honor global STAGING_ENABLED flag from game-config
    const stagingGloballyEnabled = Boolean(
      (GAME_CONFIG as any)?.STAGING_ENABLED
    );
    this.stagingEnabled = stagingGloballyEnabled && !options.skipStaging;
    this.phase = this.stagingEnabled ? 'staging' : 'in_game';
    this.currentFloor = this.stagingEnabled ? 0 : 1;
    this.floorReached = this.currentFloor;
    this.state.currentFloor = this.currentFloor;
    this.state.floorReached = this.floorReached;
    this.state.phase = this.phase;
    this.phaseChangedAt = this.state.startedAt;
    this.runStartedAt = this.stagingEnabled ? null : this.state.startedAt;
    this.state.countdownEndsAt = 0;
    this.state.lateJoinCutoffAt = 0;
    this.state.startedByPlayerId = '';
    this.state.autoCloseAt = 0;
    leverageInitializeLeverageState(this);

    if (FOG_OF_WAR_ENABLED) {
      if (this.phase === 'in_game') {
        this.enableFogForClients({ broadcast: false, reset: true });
      } else {
        this.disableFogForClients({ broadcast: false });
      }
    } else {
      this.disableFogForClients({ broadcast: false });
    }

    // Set max clients (clamp to server-enforced maximum)
    const requestedMax = Number(options.maxPlayers);
    this.maxClients = Number.isFinite(requestedMax)
      ? Math.max(1, Math.min(GAME_CONFIG.MAX_PLAYERS, Math.floor(requestedMax)))
      : GAME_CONFIG.MAX_PLAYERS;

    await this.createGameRecord(options).catch((error) => {
      console.error('Failed to create game record', {
        roomId: this.state.id,
        error,
      });
    });

    // Set room metadata for filtering
    this.updateMetadata();

    // Initialize entities array for logging
    let entities: any[] = [];

    // Generate basic chunk layout
    this.mapGenerator = new MapGenerator(
      this.state.seed,
      GAME_CONFIG.MAP_WIDTH,
      GAME_CONFIG.MAP_HEIGHT,
      this.state.difficultyTier,
      await this.loadChunkSetsForRuntime()
    );
    const mapResult = this.mapGenerator.generateEntities();
    this.dungeonChunkLayoutData = mapResult.chunkLayout.map((layout) => ({
      x: layout.x,
      y: layout.y,
      chunkName: layout.chunkName,
    }));
    // If a preferred chunk name was requested, bias the first grid cell to that chunk
    if (
      options.preferredChunkName &&
      typeof options.preferredChunkName === 'string'
    ) {
      const idx = this.dungeonChunkLayoutData.findIndex(
        (c) => c.chunkName === options.preferredChunkName
      );
      if (idx > 0) {
        const first = this.dungeonChunkLayoutData[0];
        this.dungeonChunkLayoutData[0] = this.dungeonChunkLayoutData[idx];
        this.dungeonChunkLayoutData[idx] = first;
        this.chunkLayoutData = this.dungeonChunkLayoutData.map((layout) => ({
          x: layout.x,
          y: layout.y,
          chunkName: layout.chunkName,
        }));
      }
    }
    this.chunkLayoutData = this.dungeonChunkLayoutData.map((layout) => ({
      x: layout.x,
      y: layout.y,
      chunkName: layout.chunkName,
    }));
    if (!this.stagingEnabled) {
      // Only pre-generate dungeon layout for non-staging rooms
      await this.generateDungeonLayout(this.state.difficultyTier);
      entities = this.dungeonEntityBlueprints.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        x: entity.x,
        y: entity.y,
        state: entity.state,
      }));
    } else {
      // Staging: defer dungeon generation until the run actually starts
      entities = [];
    }

    if (!this.stagingEnabled) {
      await this.spawnInitialDungeonPopulation();
      // this.addSimulatedPlayers();
    } else {
      this.initializeStagingEnvironment();
      // For logging, reflect staging entities instead of dungeon blueprints
      entities = Array.from(this.state.entities.values());
    }

    console.log(
      `🏗️ Room onCreate: Total enemies after spawn: ${this.state.enemies.size}`
    );

    // Setup game loop
    this.setupGameLoop();

    // Setup message handlers
    this.setupMessageHandlers();

    // Count different entity types for debugging
    const entityCounts = {
      obstacles: entities.filter((e: any) => e.kind === 'obstacle').length,
      spawnPoints: entities.filter((e: any) => e.kind === 'spawn_point').length,
      treasureChests: entities.filter((e: any) => e.kind === 'treasure_chest')
        .length,
      collectibles: entities.filter((e: any) => e.kind === 'collectible')
        .length,
    };

    const roomType = 'GameRoom';
    console.log(
      `🏗️ ${roomType} ${this.state.id} initialized with ${entities.length} entities:`,
      entityCounts
    );

    // Log all treasure chests for debugging
    entities
      .filter((e: any) => e.kind === 'treasure_chest')
      .forEach((chest: any) => {
        console.log(
          `💰 Treasure chest created: ${chest.id} at (${Math.floor(chest.x)}, ${Math.floor(chest.y)})`
        );
      });

    if (!this.stagingEnabled) {
      void this.applyHighStakesAttunementsForRun();
    }
  }

  async onJoin(client: Client, options: any = {}) {
    console.log(`Player ${client.sessionId} joined room ${this.state.id}`);

    // Enforce capacity server-side
    // Enforce admin-only access if configured
    if (this.isAdminOnly) {
      const address: string | undefined = (client as any).auth?.address;
      // Lazy import to avoid express types at runtime; the function is pure
      const { isAdminAddress } = await import('../routes/admin-auth');
      if (!address || !isAdminAddress(address)) {
        throw new Error('Forbidden: admin-only room');
      }
    }
    const current = this.getCurrentClientCount();
    // Note: during onJoin, Colyseus already counts this connecting client
    // in the current clients set. Allow the last seat by only rejecting when
    // the count exceeds maxClients (not equals).
    if (current > this.maxClients) {
      throw new Error('Room is full');
    }

    if (this.stagingEnabled && this.phase === 'in_game') {
      const now = Date.now();
      if (
        this.state.lateJoinCutoffAt > 0 &&
        now > this.state.lateJoinCutoffAt
      ) {
        throw new Error('Run already in progress');
      }
    }

    const requestedDifficultyTierRaw =
      typeof options?.difficultyTier === 'string'
        ? options.difficultyTier
        : null;

    if (
      requestedDifficultyTierRaw &&
      this.phase !== 'in_game' &&
      this.phase !== 'ended' &&
      this.state.players.size === 0
    ) {
      this.applyRequestedDifficultyTier(requestedDifficultyTierRaw);
    }

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.name = options.name || `Player_${client.sessionId.slice(0, 6)}`;
    player.avatarId = options.avatarId || 'default';

    const authData = (client as any).auth || {};
    const playerId: string | undefined = authData.playerId;
    const walletAddress: string | undefined = authData.address;
    const isAuthorized: boolean = Boolean(authData.isAuthorized);

    console.log('authData', authData);
    console.log('playerId', playerId);
    console.log('walletAddress', walletAddress);
    console.log('isAuthorized', isAuthorized);

    if (!isAuthorized) {
      throw new Error('Player is not authorized');
    }

    if (!playerId || !walletAddress) {
      throw new Error('Unauthorized: missing player identity');
    }

    this.sessionPlayerIds.set(client.sessionId, playerId);
    player.wallet = walletAddress;
    this.hadAnyPlayers = true;

    // Resolve effective display name with precedence:
    // 1) DB username (provided via client.auth.username from onAuth)
    // 2) ENS name from client (passed via options.name)
    // 3) Random fallback
    try {
      const requestedName =
        typeof options?.name === 'string' ? options.name.trim() : '';
      // Heuristic: ENS names include a dot (e.g., myname.eth)
      const looksLikeEns = requestedName.includes('.');
      const authUsername =
        typeof (client as any).auth?.username === 'string'
          ? (client as any).auth.username.trim()
          : '';
      if (authUsername.length > 0) {
        player.name = authUsername;
      } else if (looksLikeEns && requestedName) {
        player.name = requestedName;
      } else {
        player.name = `Player_${client.sessionId.slice(0, 6)}`;
      }
    } catch {
      // If anything fails, keep existing player.name
    }

    // Support dynamic gotchi selection via gotchiId (string or number). Only one of gotchiId | characterId is expected.
    const requestedGotchiId = options.gotchiId;
    const requestedCharacterId = options.characterId;

    // If both are provided, reject
    if (requestedGotchiId != null && requestedCharacterId) {
      throw new Error('Provide only one of gotchiId or characterId');
    }

    if (requestedGotchiId != null && requestedGotchiId !== '') {
      // Verify session via cookie in onAuth; must have client.auth.address
      const sessionWallet: string | undefined = (client as any).auth?.address;
      if (!sessionWallet) {
        throw new Error('Unauthorized: missing session');
      }

      const gotchiIdStr = String(requestedGotchiId);
      const { owned, slugs, assignments } = await verifyGotchiOwnership(
        sessionWallet,
        gotchiIdStr
      );

      if (!owned) {
        throw new Error('Unauthorized: gotchi not owned by session wallet');
      }

      // Register or update a dynamic character entry
      const dynamicId = `gotchi:${gotchiIdStr}`;

      // Cache wearables/assignments for stat derivation (empty arrays allowed)
      setGotchiWearables(gotchiIdStr, slugs || []);
      if (assignments && assignments.length > 0) {
        setGotchiWearableAssignments(gotchiIdStr, assignments);
      }

      player.characterId = dynamicId;
    } else {
      player.characterId = requestedCharacterId || 'coderdan';
    }
    player.isBot = false; // Mark as real player

    const runtimeScoreState = this.ensurePlayerScoreState(playerId);
    player.score = SCORE_CONFIG.enabled ? runtimeScoreState.score : 0;
    player.scoreEligible = SCORE_CONFIG.enabled
      ? runtimeScoreState.eligible
      : true;

    const progressionRecord = await progressionRepo.getProgression(playerId);
    const initialProfile = progressionRecordToProfile(progressionRecord);
    const equipmentRecords = await equipmentRepo.getEquippedWithInstances(
      playerId,
      player.characterId || null
    );
    const equipmentOverrides: EquipmentOverride[] = [];
    for (const record of equipmentRecords) {
      try {
        equipmentOverrides.push({
          slot: normalizeEquipmentSlotName(record.slot),
          slug: record.wearableSlug,
          inventoryItemId: record.inventoryItemId ?? null,
          quality: normalizeQualityTier(record.quality),
        });
      } catch (error) {
        console.warn('Skipping equipment with invalid slot', {
          playerId,
          slot: record.slot,
          wearable: record.wearableSlug,
          error,
        });
      }
    }

    const equipmentState = buildEquipmentStateForCharacter(
      player.characterId || 'coderdan',
      equipmentOverrides
    );

    const storageAssignments: StoredWearableEntry[] =
      equipmentState.equipment.map((assignment) => ({
        slot: assignment.slot,
        slug: assignment.slug,
        quality: assignment.quality,
      }));

    const equippedWearablesFromRecord = progressionRecord
      ? normalizeStoredWearableList(
          progressionRecord.equippedWearables,
          storageAssignments
        )
      : [];

    const runtimeWearables =
      equippedWearablesFromRecord.length > 0
        ? equippedWearablesFromRecord
        : storageAssignments.map(serializeStoredWearable);

    if (!progressionRecord) {
      await progressionRepo.upsertProgression({
        playerId,
        level: initialProfile.level,
        totalXp: initialProfile.totalXp,
        unspentPoints: initialProfile.unspentPoints,
        unlockedTiers: DEFAULT_UNLOCKED_TIERS,
        lickTongueCount: 0,
        statAllocations: initialProfile.stats,
        derivedStats: {},
        equippedWearables: [],
        allocationHistory: initialProfile.allocationHistory,
        lastSyncedAt: null,
      });
    }

    const unlockedTiersArray = progressionRecord?.unlockedTiers?.length
      ? progressionRecord.unlockedTiers
      : DEFAULT_UNLOCKED_TIERS;
    player.unlockedTiers = JSON.stringify(unlockedTiersArray);
    player.lickTongueCount = progressionRecord?.lickTongueCount ?? 0;
    const derivedStatsFromRecord = progressionRecord?.derivedStats;
    player.derivedStats = JSON.stringify(
      derivedStatsFromRecord && typeof derivedStatsFromRecord === 'object'
        ? derivedStatsFromRecord
        : equipmentState.derivedStats
    );
    player.equippedWearables = JSON.stringify(runtimeWearables);

    const snapshotSignature = equipmentState.equipment
      .map((entry) => `${entry.slot}::${entry.slug}`)
      .sort();
    this.playerEquipmentSnapshots.set(playerId, snapshotSignature);

    this.setProgressionProfile(client.sessionId, initialProfile, {
      persist: false,
    });
    const modifiers = computeProgressionModifiers(initialProfile.stats);
    syncPlayerCharacterStats(player, {
      fullHeal: true,
      progressionModifiers: modifiers,
    });

    try {
      await this.registerGamePlayer(
        client.sessionId,
        playerId,
        initialProfile,
        player
      );
    } catch (error) {
      console.error('Failed to register game player', {
        sessionId: client.sessionId,
        playerId,
        error,
      });
      throw error;
    }

    console.log(
      `🎭 Player ${player.name} selected character: ${player.characterId} with weapon type: ${player.attackType}`
    );

    // Set spawn position in center area
    this.setPlayerSpawnPosition(player);

    player.dir = 'down';
    player.anim = 'idle';
    player.lastMoveTime = 0;
    player.lastAttackTime = 0;

    let killStreakProfile: KillStreakProfile | null = null;
    this.state.players.set(client.sessionId, player);
    this.logGameEvent('player.joined', `${player.name} joined room`, {
      playerId,
      sessionId: client.sessionId,
      details: {
        walletAddress,
        characterId: player.characterId,
        difficultyTier: this.state.difficultyTier,
        phase: this.state.phase,
      },
    });

    if (this.phase === 'in_game') {
      killStreakProfile =
        this.ensureKillStreakForPlayer(client.sessionId, player, {
          reset: true,
          sendProfile: false,
        }) ?? null;
      if (killStreakProfile) {
        this.applyProgressionToPlayer(client.sessionId, { fullHeal: true });
      }
    } else {
      this.killStreakBySession.delete(client.sessionId);
      this.applyProgressionToPlayer(client.sessionId, { fullHeal: true });
    }

    if (this.phase === 'in_game' && this.state.players.size > 0) {
      this.resumeEnemyDifficultyMeter('player_join');
      // Immediately rescale existing enemies based on new party size
      try {
        if (this.state.enemyDifficultyEnabled) {
          const multipliers = getRoomEnemyDifficultyMultipliers(
            this.state as any
          );
          this.enqueueEnemyDifficultyRescale(
            this.state.enemyDifficultyLevel,
            multipliers,
            Date.now()
          );
        }
      } catch {
        // Ignore errors in difficulty rescale
      }
    }

    if (
      LEVERAGE_CONFIG.enabled &&
      this.phase === 'in_game' &&
      !this.state.roomLeverageLocked
    ) {
      leverageScheduleRoomLeverageLockTimeout(this);
    }

    // Removed Portal Guardian spawn timer broadcast

    if (
      this.stagingEnabled &&
      this.phase === 'staging' &&
      this.state.players.size === 1
    ) {
      const autoCloseAt = Date.now() + STAGING_AUTO_CLOSE_MS;
      this.state.autoCloseAt = autoCloseAt;
      this.scheduleStagingAutoClose(autoCloseAt);
      this.persistGameMetrics({ syncState: true });
      this.msg.broadcast('staging_auto_close', {
        autoCloseAt,
      });
    }

    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }

    this.updateMetadata();

    if (this.phase === 'in_game' && playerId) {
      void this.applyHighStakesAttunementsForRun(playerId);
    }

    const inventoryRecords = await inventoryRepo.getInventory(playerId);
    const inventoryItems = inventoryRecords.map(inventoryRecordToItem);
    const sanitizedInventory = sanitizeInventoryPayloads(inventoryItems);
    player.lickTongueCount = getLickTongueCount(sanitizedInventory);
    this.playerInventories.set(client.sessionId, sanitizedInventory);

    // Send initial game state to client, including existing tree positions
    // This prevents tree duplication when players return to visited rooms
    client.send('room_joined', {
      playerId: client.sessionId,
      roomId: this.state.id,
      roomCode: this.state.roomCode,
      mapSeed: this.state.seed,
      difficultyTier: this.state.difficultyTier, // Send difficulty tier for chunk selection
      currentFloor: this.currentFloor, // Current dungeon floor index
      floorReached: this.floorReached,
      maxPlayers: this.maxClients,
      playerCount: this.getCurrentClientCount(),
      region: this.state.region,
      hostSessionId: this.state.hostSessionId,
      existingTrees: this.treePositions, // Send existing trees for restoration
      chunkLayout: this.chunkLayoutData, // Send chunk layout for proper floor rendering
      progressionProfile: toSerializableProfile(initialProfile),
      inventory: sanitizedInventory,
      phase: this.state.phase,
      phaseChangedAt: this.phaseChangedAt,
      countdownEndsAt: this.state.countdownEndsAt,
      autoCloseAt: this.state.autoCloseAt,
      lateJoinCutoffAt: this.state.lateJoinCutoffAt,
      startedByPlayerId: this.state.startedByPlayerId,
      runStartedAt: this.runStartedAt,
    });

    leverageSendLeverageStateToClient(this, client);

    if (killStreakProfile) {
      this.sendKillStreakProfileToClient(client.sessionId, killStreakProfile);
    } else {
      this.sendKillStreakResetToClient(
        client.sessionId,
        this.phase === 'in_game' ? 'streak_inactive' : 'awaiting_run'
      );
    }

    this.sendFogStateToClient(client, true);

    // Send initial weapon type to client
    client.send('weapon_switched', { attackType: player.attackType });

    void this.persistProgression(client.sessionId, initialProfile);
  }

  async onLeave(client: Client, consented: boolean) {
    console.log(`Player ${client.sessionId} left room ${this.state.id}`, {
      consented,
    });
    const playerIdForSession = this.getPlayerIdForSession(client.sessionId);
    const statsSnapshot = this.cloneRuntimeStats(client.sessionId);
    const partySizeBeforeLeave = this.state.players.size;
    if (playerIdForSession && this.stagingEnabled && this.phase !== 'in_game') {
      await this.refundEntryFee(playerIdForSession, 'disconnect');
    }
    await Promise.allSettled([
      this.persistProgression(client.sessionId),
      this.persistInventory(client.sessionId),
      this.flushGamePlayerStats(client.sessionId, { markLeft: true }),
    ]);

    this.killStreakBySession.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.pendingScoreDeltas.delete(client.sessionId);
    this.npcPurchaseCooldowns.delete(client.sessionId);

    if (this.phase === 'in_game' && this.state.players.size === 0) {
      this.pauseEnemyDifficultyMeter('no_players');
    }

    // Clean up server-side tracking
    this.playerInventories.delete(client.sessionId);
    this.playerProgression.delete(client.sessionId);
    this.playerDeathsThisRun.delete(client.sessionId);
    if (playerIdForSession) {
      this.playerEquipmentSnapshots.delete(playerIdForSession);
    }
    this.sessionPlayerIds.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const nextHost = Array.from(this.state.players.keys())[0];
      this.state.hostSessionId = nextHost || '';
    }

    if (
      this.stagingEnabled &&
      this.phase !== 'in_game' &&
      this.state.players.size === 0
    ) {
      this.clearStagingAutoCloseTimer();
      this.state.autoCloseAt = 0;
      this.persistGameMetrics({ syncState: true });
      this.msg.broadcast('staging_auto_close', {
        autoCloseAt: 0,
      });
    }

    const playersRemaining = this.state.players.size;
    this.logGameEvent('player.left', 'Player left room', {
      playerId: playerIdForSession,
      sessionId: client.sessionId,
      details: {
        consented,
        partySizeBeforeLeave,
        playersRemaining,
      },
    });
    if (playersRemaining === 0) {
      const status = this.bossKilled ? 'completed' : 'abandoned';
      await this.finalizeGameStatus(status);
    }

    this.persistGameMetrics({ syncState: true });
    this.updateMetadata();

    if (playerIdForSession) {
      await this.persistPlayerRunScore({
        playerId: playerIdForSession,
        sessionId: client.sessionId,
        statsSnapshot,
        partySize: partySizeBeforeLeave,
        reason: 'leave',
      });
    }

    // If players remain in-game, immediately rescale existing enemies
    if (this.phase === 'in_game' && this.state.players.size > 0) {
      try {
        if (this.state.enemyDifficultyEnabled) {
          const multipliers = getRoomEnemyDifficultyMultipliers(
            this.state as any
          );
          this.enqueueEnemyDifficultyRescale(
            this.state.enemyDifficultyLevel,
            multipliers,
            Date.now()
          );
        }
      } catch {
        // Ignore errors in difficulty rescale
      }
    }
  }

  async onDispose() {
    console.log(`GameRoom ${this.state.id} disposed`);
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    if (this.timedSpawnInterval) clearInterval(this.timedSpawnInterval);
    this.clearStagingAutoCloseTimer();
    this.clearLateJoinTimer();
    if (this.portalCountdownTimer) {
      clearTimeout(this.portalCountdownTimer);
      this.portalCountdownTimer = null;
    }
    leverageClearRoomLeverageLockTimer(this);
    // Removed Portal Guardian spawn timer
    this.clearLateJoinTimer();
    await this.clearHighStakesForRun();

    const sessions = Array.from(this.sessionPlayerIds.keys());
    const sessionSnapshots = sessions.map((sessionId) => ({
      sessionId,
      playerId: this.getPlayerIdForSession(sessionId) ?? '',
      stats: this.cloneRuntimeStats(sessionId),
      partySize: this.state.players.size,
    }));
    await Promise.allSettled([
      ...sessions.map((sessionId) => this.persistProgression(sessionId)),
      ...sessions.map((sessionId) => this.persistInventory(sessionId)),
      ...sessions.map((sessionId) =>
        this.flushGamePlayerStats(sessionId, { markLeft: true })
      ),
    ]);

    for (const snapshot of sessionSnapshots) {
      if (!snapshot.playerId) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await this.persistPlayerRunScore({
        playerId: snapshot.playerId,
        sessionId: snapshot.sessionId,
        statsSnapshot: snapshot.stats,
        partySize: snapshot.partySize,
        reason: 'dispose',
      });
    }

    this.sessionPlayerIds.clear();
    this.playerDeathsThisRun.clear();
    this.gamePlayerStats.clear();
    this.playerEquipmentSnapshots.clear();
    this.entryFeeLedger.clear();
    this.playerScoreStateByPlayerId.clear();
    this.pendingScoreDeltas.clear();
    this.playersDiedThisRunByPlayerId.clear();
    this.persistedScorePlayerIds.clear();
    this.persistedScorePlayerIds.clear();
    this.recentEnemyKillIds.forEach((entry) => {
      if (entry.timeout) {
        clearTimeout(entry.timeout);
      }
    });
    this.recentEnemyKillIds.clear();
    this.entityLootDistributions.forEach((entry) => {
      if (entry.timeout) {
        clearTimeout(entry.timeout);
      }
    });
    this.entityLootDistributions.clear();

    // Drop any pending scheduled spell follow-ups
    try {
      const state: any = this.state as any;
      if (Array.isArray(state._scheduledSpellFollowups)) {
        state._scheduledSpellFollowups.length = 0;
      }
    } catch {
      // Ignore errors clearing spell followups
    }

    if (!this.gameStatusFinalized) {
      const status = this.bossKilled
        ? 'completed'
        : this.hadAnyPlayers
          ? 'terminated'
          : 'abandoned';
      await this.finalizeGameStatus(status);
    }
  }

  private setupGameLoop() {
    // Game simulation tick at 30Hz
    this.tickInterval = setInterval(() => {
      const startHr = process.hrtime.bigint();
      this.gameTick();
      const endHr = process.hrtime.bigint();
      const elapsedMs = Number(endHr - startHr) / 1_000_000; // ns → ms
      this.recordTickSample(elapsedMs);
    }, 1000 / GAME_CONFIG.SERVER_TICK_HZ);

    // Snapshot broadcast at 15Hz
    this.snapshotInterval = setInterval(() => {
      this.broadcastSnapshot();
    }, 1000 / GAME_CONFIG.SNAPSHOT_HZ);

    // Timed enemy spawn every interval
    const scheduleNextSpawn = () => {
      if (TIMED_SPAWN.pauseDuringTransition && this.isRoomTransitioning) {
        this.state.nextTimedSpawnAt = 0;
        return;
      }
      if (this.phase !== 'in_game') {
        this.state.nextTimedSpawnAt = 0;
        return;
      }
      const now = Date.now();
      this.state.nextTimedSpawnAt = now + TIMED_SPAWN.intervalMs;
    };
  }

  // --- Performance sampling ---
  private tickSamples: number[] = [];
  private perfInterval: NodeJS.Timeout | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTimeMs: number = Date.now();

  private recordTickSample(ms: number) {
    const samples = this.tickSamples;
    samples.push(ms);
    if (samples.length > 300) samples.shift(); // keep last ~10s at 30Hz
  }

  private startPerfSampler() {
    if (this.perfInterval) return;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTimeMs = Date.now();
    this.perfInterval = setInterval(() => {
      // Compute CPU% (user+system) over last interval
      const now = Date.now();
      const elapsedMs = Math.max(1, now - this.lastCpuTimeMs);
      const usage = process.cpuUsage(this.lastCpuUsage || undefined);
      const cpuMs = (usage.user + usage.system) / 1000; // microseconds → ms
      const cpuPct = Math.max(0, Math.min(100, (cpuMs / elapsedMs) * 100));
      this.lastCpuUsage = process.cpuUsage();
      this.lastCpuTimeMs = now;

      // Compute avg/p95 tick
      const arr = this.tickSamples.slice();
      let avg = 0;
      if (arr.length) {
        avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const sorted = arr.slice().sort((a, b) => a - b);
        const idx = Math.floor(sorted.length * 0.95);
        const p95 = sorted[Math.min(sorted.length - 1, Math.max(0, idx))] || 0;
        this.msg.broadcast('server_perf', {
          avgTickMs: Number(avg.toFixed(2)),
          p95TickMs: Number(p95.toFixed(2)),
          cpuPct: Number(cpuPct.toFixed(1)),
          enemies: this.state.enemies.size,
          projectiles: this.state.projectiles.size,
          activeEnemies: Number((this as any).lastActiveEnemies || 0),
        });
      } else {
        this.msg.broadcast('server_perf', {
          avgTickMs: 0,
          p95TickMs: 0,
          cpuPct: Number(cpuPct.toFixed(1)),
          enemies: this.state.enemies.size,
          projectiles: this.state.projectiles.size,
          activeEnemies: Number((this as any).lastActiveEnemies || 0),
        });
      }
    }, 1000);
  }

  private setupMessageHandlers() {
    // Handle continuous input (type 0) from official tutorial pattern
    this.onMessage(
      0,
      (
        client,
        payload: {
          left: boolean;
          right: boolean;
          up: boolean;
          down: boolean;
          sprint: boolean;
        }
      ) => {
        // Cache latest input by client; applied in gameTick
        this.latestInputByClientId.set(client.sessionId, {
          left: !!payload.left,
          right: !!payload.right,
          up: !!payload.up,
          down: !!payload.down,
          sprint: !!payload.sprint,
        });
      }
    );

    this.onMessage('emote', (client, input: EmoteInput) => {
      this.handleEmote(client, input);
    });

    this.onMessage('chat', (client, message: { text: string }) => {
      this.handleChat(client, message);
    });

    this.onMessage('cycle_weapon', (client) => {
      this.handleWeaponCycle(client);
    });

    this.onMessage('set_active_weapon', (client, data: { index?: number }) => {
      this.handleSetActiveWeapon(client, data);
    });

    this.onMessage('heal_player', (client, data: { healAmount: number }) => {
      this.handleHealPlayer(client, data);
    });

    this.onMessage('use_mana_potion', (client) => {
      this.handleUseManaPotion(client);
    });

    this.onMessage('use_health_potion', (client) => {
      this.handleUseHealthPotion(client);
    });

    this.onMessage('open_chest', (client, data: { chestId: string }) => {
      void this.handleOpenChest(client, data).catch((error) => {
        console.error('Failed to handle chest open', {
          sessionId: client.sessionId,
          chestId: data?.chestId,
          error,
        });
      });
    });

    this.onMessage(
      'progression_sync',
      (client, data: { profile?: unknown }) => {
        void this.handleProgressionSync(client, data).catch((error) => {
          console.error('Failed to handle progression sync', {
            sessionId: client.sessionId,
            error,
          });
        });
      }
    );

    //todo: do we still need this? tree positions are now coming server side
    this.onMessage(
      'tree_positions',
      (client, positions: Array<{ x: number; y: number }>) => {
        this.treePositions = positions;
        console.log(`Received ${positions.length} tree positions from client`);
      }
    );

    // Handle ping for connection diagnostics
    this.onMessage('ping', (client, data: { timestamp: number }) => {
      // Immediately respond with pong containing the original timestamp
      client.send('pong', { timestamp: data.timestamp });
    });

    // Handle click-to-move commands
    this.onMessage('moveTo', (client, data: { x: number; y: number }) => {
      this.handleMoveTo(client, data);
    });

    // Handle action system commands
    //todo: "type" should be typed
    this.onMessage(
      'startAction',
      (client, data: { type: string; targetId?: string; payload?: any }) => {
        this.handleStartAction(client, data);
      }
    );

    // Handle NPC interactions
    this.onMessage(
      'npc_interact',
      (client, data: { npcId: string; dialogueId: string }) => {
        this.handleNPCInteraction(client, data);
      }
    );

    this.onMessage('leverage:set_floor', (client, data: { value?: number }) => {
      this.handleSetFloorLeverage(client, data);
    });

    this.onMessage('leverage:set_room', (client, data: { value?: number }) => {
      this.handleSetRoomLeverage(client, data);
    });

    this.onMessage(
      'npc_purchase',
      (client, data: { npcId: string; itemId: string }) => {
        void this.handleNpcPurchase(client, data);
      }
    );

    // Handle portal interactions
    this.onMessage('portal_interact', (client, data: { portalId: string }) => {
      this.handlePortalInteraction(client, data);
    });

    this.onMessage('destroy_item', (client, data: Record<string, unknown>) => {
      void this.handleDestroyItem(client, data).catch((error) => {
        console.error('Failed to handle destroy_item message', {
          sessionId: client.sessionId,
          error,
        });
      });
    });

    this.onMessage('drop_item', (client, data: Record<string, unknown>) => {
      void this.handleDropItem(client, data).catch((error) => {
        console.error('Failed to handle drop_item message', {
          sessionId: client.sessionId,
          error,
        });
      });
    });

    this.onMessage(
      'spell_autocast',
      (
        client,
        data: { spellId?: string; enabled?: boolean } | null | undefined
      ) => {
        const player = this.state.players.get(client.sessionId);
        if (!player) {
          return;
        }

        const rawSpellId =
          typeof data?.spellId === 'string' ? data.spellId : '';
        const spellId = rawSpellId.trim();
        if (!spellId) {
          this.msg.sendTo(client, 'spell_autocast_result', {
            ok: false,
            spellId: rawSpellId ?? '',
            enabled: false,
            reason: 'invalid_spell',
          });
          return;
        }

        const spell = SPELLS_BY_ID[spellId];
        if (!spell) {
          this.msg.sendTo(client, 'spell_autocast_result', {
            ok: false,
            spellId,
            enabled: false,
            reason: 'unknown_spell',
          });
          return;
        }

        const current = getSpellAutocast(player, spellId);
        const next =
          typeof data?.enabled === 'boolean' ? Boolean(data.enabled) : !current;
        setSpellAutocast(player, spellId, next);

        this.msg.sendTo(client, 'spell_autocast_result', {
          ok: true,
          spellId,
          enabled: next,
        });
      }
    );

    // Setup all debug message handlers
    setupDebugHandlers(this);
  }

  private handleContinuousInput(
    client: Client,
    payload: {
      left: boolean;
      right: boolean;
      up: boolean;
      down: boolean;
      sprint: boolean;
    }
  ) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.hp <= 0) return;
    const now = Date.now();

    if (isEntityStunned(player, now)) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      player.targetX = -1;
      player.targetY = -1;
      player.isSprinting = false;
      if (player.anim !== ('death' as any) && player.anim !== ('hurt' as any)) {
        player.anim = 'idle';
      }
      return;
    }

    // Check if any manual input is provided
    const hasManualInput =
      payload.left || payload.right || payload.up || payload.down;

    // Update sprint state for pathfinding (even if not manually moving)
    player.isSprinting = payload.sprint;

    // Interrupt auto-walking if manual input detected
    if (hasManualInput && player.isAutoWalking) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      console.log(`🛑 Auto-walking interrupted for player ${player.name}`);
    }

    // Cancel any active action if manual input detected
    if (hasManualInput && this.actionManager.hasActiveAction(player)) {
      this.actionManager.cancelAction(player, this, 'Manual movement detected');
    }

    // Store previous position for collision rollback
    const prevX = player.x;
    const prevY = player.y;

    // Check if player is on road for speed bonus
    const wasOnRoad = player.onRoad;
    player.onRoad = this.isOnRoad(player.x, player.y);

    // Velocity in pixels per tick derived from tiles/sec and tick rate
    // MOVEMENT_SPEED is tiles/sec, TILE_SIZE px/tile, SERVER_TICK_HZ ticks/sec
    let velocity =
      (GAME_CONFIG.MOVEMENT_SPEED * GAME_CONFIG.TILE_SIZE) /
      GAME_CONFIG.SERVER_TICK_HZ;
    // Double only manual input speed per user request; sprint still doubles further
    velocity *= 2;
    if (payload.sprint) velocity *= 2; // sprint is 2x on top

    // Apply road bonus: 25% speed increase when on road
    if (player.onRoad) {
      velocity *= 1.25;
    }

    const slowScalar = getMovementSpeedScalar(player, now);
    velocity *= slowScalar;

    let moved = false;

    // Update position and track direction
    if (payload.left) {
      player.x -= velocity;
      player.dir = 'left';
      moved = true;
    } else if (payload.right) {
      player.x += velocity;
      player.dir = 'right';
      moved = true;
    }

    if (payload.up) {
      player.y -= velocity;
      player.dir = 'up';
      moved = true;
    } else if (payload.down) {
      player.y += velocity;
      player.dir = 'down';
      moved = true;
    }

    // Check for obstacle collisions (trees and stones) and revert if necessary
    if (moved && this.checkObstacleCollision(player.x, player.y, 20)) {
      player.x = prevX;
      player.y = prevY;
      console.log('did not move');
      moved = false; // Player didn't actually move due to collision
    }

    // Update animation based on movement
    if (moved) {
      player.anim = payload.sprint ? 'sprint' : 'walk';
      player.lastMoveTime = now;
    }

    // Keep player within bounds (full screen with padding)
    // Using larger bounds to accommodate various screen sizes
    player.x = Math.max(
      GAME_CONFIG.TILE_SIZE,
      Math.min(GAME_CONFIG.WORLD_WIDTH - GAME_CONFIG.TILE_SIZE, player.x)
    );
    player.y = Math.max(
      GAME_CONFIG.TILE_SIZE,
      Math.min(GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.TILE_SIZE, player.y)
    );
  }

  private handleEmote(client: Client, input: EmoteInput) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Broadcast emote to all players
    this.msg.broadcast('player_emote', {
      playerId: client.sessionId,
      emoteId: input.id,
      x: player.x,
      y: player.y,
    });
  }

  private handleChat(client: Client, message: { text: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !message.text || message.text.length > 200) return;

    // Broadcast chat message
    this.msg.broadcast('chat_message', {
      playerId: client.sessionId,
      playerName: player.name,
      text: message.text,
      timestamp: Date.now(),
    });
  }

  private handleMoveTo(
    client: Client,
    data: { x: number; y: number },
    skipActionDetection: boolean = false
  ) {
    console.log(
      `📨 Received moveTo command from ${client.sessionId}: x=${data.x}, y=${data.y}`
    );

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      console.log(`❌ Player not found for session ${client.sessionId}`);
      return;
    }
    if (player.hp <= 0) {
      return;
    }
    if (isEntityStunned(player, Date.now())) {
      player.isAutoWalking = false;
      player.currentPath = '';
      player.pathIndex = 0;
      player.targetX = -1;
      player.targetY = -1;
      return;
    }

    // Cancel any active action when player manually clicks to move (unless it's from action pathfinding)
    if (!skipActionDetection && this.actionManager.hasActiveAction(player)) {
      this.actionManager.cancelAction(player, this, 'Player clicked to move');
      console.log(
        `🛑 Cancelled active action for player ${player.name} due to manual move command`
      );
    }

    console.log(
      `👤 Player ${player.name} current position: (${player.x}, ${player.y})`
    );

    // Convert screen coordinates to tile coordinates
    let targetX = Math.floor(data.x / GAME_CONFIG.TILE_SIZE);
    let targetY = Math.floor(data.y / GAME_CONFIG.TILE_SIZE);
    const currentX = Math.floor(player.x / GAME_CONFIG.TILE_SIZE);
    const currentY = Math.floor(player.y / GAME_CONFIG.TILE_SIZE);

    console.log(
      `🎯 Target: screen(${data.x}, ${data.y}) -> tiles(${targetX}, ${targetY})`
    );
    console.log(
      `📍 Current: screen(${player.x}, ${player.y}) -> tiles(${currentX}, ${currentY})`
    );

    // Check if target is valid and reachable (use same bounds as pathfinding algorithm)
    if (
      targetX < 0 ||
      targetY < 0 ||
      targetX >= GAME_CONFIG.MAP_WIDTH ||
      targetY >= GAME_CONFIG.MAP_HEIGHT
    ) {
      console.log(
        `❌ Target out of bounds: (${targetX}, ${targetY}), map size: ${GAME_CONFIG.MAP_WIDTH}x${GAME_CONFIG.MAP_HEIGHT}`
      );
      return;
    }

    // Build obstacle set from trees and stones - match collision detection
    const obstacles = this.buildObstacleSet();

    // console.log(`🚧 Found ${obstacles.size} obstacles`);

    // Check if player clicked on an obstacle
    const targetKey = `${targetX},${targetY}`;
    if (obstacles.has(targetKey)) {
      console.log(`🪨 Clicked on obstacle at (${targetX}, ${targetY})`);

      // Find the specific entity that was clicked
      let clickedEntity: EntitySchema | null = null;
      for (const entity of this.state.entities.values()) {
        if (entity.kind === 'obstacle') {
          const entityTileX = Math.floor(entity.x / GAME_CONFIG.TILE_SIZE);
          const entityTileY = Math.floor(entity.y / GAME_CONFIG.TILE_SIZE);
          if (entityTileX === targetX && entityTileY === targetY) {
            clickedEntity = entity;
            break;
          }
        }
      }

      if (clickedEntity) {
        const entityState = JSON.parse(clickedEntity.state || '{}');
        console.log(
          `🎯 Clicked on ${entityState.type} entity: ${clickedEntity.id}`
        );

        // If it's a tree or stone, start the appropriate action (unless we're skipping action detection)
        if (!skipActionDetection) {
          if (entityState.type === 'tree') {
            console.log(
              `🌳 Starting tree chop action for tree ${clickedEntity.id}`
            );

            const action = ActionFactory.createAction(
              'chop_tree',
              clickedEntity.id
            );
            if (action) {
              const success = this.actionManager.startAction(
                player,
                action,
                this
              );
              if (success) {
                console.log(`✅ TreeChopAction started successfully`);
                return; // Action system will handle pathfinding and chopping
              } else {
                console.log(`❌ Failed to start TreeChopAction`);
              }
            }
          } else if (entityState.type === 'stone') {
            console.log(
              `🪨 Starting stone mine action for stone ${clickedEntity.id}`
            );

            const action = ActionFactory.createAction(
              'mine_stone',
              clickedEntity.id
            );
            if (action) {
              const success = this.actionManager.startAction(
                player,
                action,
                this
              );
              if (success) {
                console.log(`✅ StoneMineAction started successfully`);
                return; // Action system will handle pathfinding and mining
              } else {
                console.log(`❌ Failed to start StoneMineAction`);
              }
            }
          }
        }
      }

      // Fallback to regular pathfinding if not a tree or action failed
      console.log(`🚶 Using regular pathfinding to approach obstacle`);

      // Check if player is already adjacent to the obstacle
      const isAdjacent = this.isPlayerAdjacentToTile(
        currentX,
        currentY,
        targetX,
        targetY
      );

      if (isAdjacent) {
        console.log(
          `✋ Player is already adjacent to obstacle, should perform action instead of moving`
        );
        // Only send message if we have a real client (not from action system)
        if (client && typeof client.send === 'function') {
          client.send('obstacle_action', {
            obstacleX: targetX,
            obstacleY: targetY,
            action: 'chop',
          });
        }
        return;
      }

      // Find the closest walkable tile adjacent to the obstacle
      const adjacentTile = this.findAdjacentWalkableTile(
        targetX,
        targetY,
        currentX,
        currentY,
        obstacles
      );

      if (adjacentTile) {
        console.log(
          `✅ Found adjacent walkable tile: (${adjacentTile.x}, ${adjacentTile.y})`
        );
        targetX = adjacentTile.x;
        targetY = adjacentTile.y;
      } else {
        console.log(
          `❌ No adjacent walkable tile found for obstacle at (${targetX}, ${targetY})`
        );
        return;
      }
    }

    // Check if it's a simple straight-line path first
    const isHorizontalLine = currentY === targetY;
    const isVerticalLine = currentX === targetX;
    const isDiagonalOrZigzag = !isHorizontalLine && !isVerticalLine;

    console.log(`🔍 Path type analysis:`);
    console.log(`  - Horizontal line: ${isHorizontalLine}`);
    console.log(`  - Vertical line: ${isVerticalLine}`);
    console.log(`  - Diagonal/Zigzag: ${isDiagonalOrZigzag}`);

    if (isHorizontalLine || isVerticalLine) {
      console.log(
        `🔄 Checking straight-line path (horizontal: ${isHorizontalLine}, vertical: ${isVerticalLine})`
      );

      // Check if straight path is clear
      let pathClear = true;
      if (isHorizontalLine) {
        const startX = Math.min(currentX, targetX);
        const endX = Math.max(currentX, targetX);
        for (let x = startX; x <= endX; x++) {
          if (obstacles.has(`${x},${currentY}`)) {
            console.log(`🚧 Obstacle found at (${x}, ${currentY})`);
            pathClear = false;
            break;
          }
        }
      } else {
        const startY = Math.min(currentY, targetY);
        const endY = Math.max(currentY, targetY);
        for (let y = startY; y <= endY; y++) {
          if (obstacles.has(`${currentX},${y}`)) {
            console.log(`🚧 Obstacle found at (${currentX}, ${y})`);
            pathClear = false;
            break;
          }
        }
      }

      if (pathClear) {
        console.log(`✅ Straight-line path is clear, creating simple path`);
        // Create simple path
        const simplePath = {
          nodes: [
            { x: currentX, y: currentY, g: 0, h: 0, f: 0 },
            { x: targetX, y: targetY, g: 1, h: 0, f: 1 },
          ],
          length: 2,
        };

        // Store path in player state
        player.targetX = targetX * GAME_CONFIG.TILE_SIZE;
        player.targetY = targetY * GAME_CONFIG.TILE_SIZE;

        console.log('path length:', simplePath.length);

        if (simplePath.length > 10 && !skipActionDetection) {
          console.log('path length is too long, skipping');
          return;
        }

        player.currentPath = JSON.stringify(simplePath.nodes);
        player.pathIndex = 1; // Skip first node (current position)
        player.isAutoWalking = true;

        console.log(
          `✅ Player ${player.name} starting simple auto-walk to (${targetX}, ${targetY})`
        );
        return;
      }
    }

    // Detailed pathfinding debug
    console.log(`🔍 PATHFINDING DEBUG:`);
    console.log(`  Start: (${currentX}, ${currentY})`);
    console.log(`  Goal: (${targetX}, ${targetY})`);
    console.log(
      `  Distance: ${Math.abs(targetX - currentX) + Math.abs(targetY - currentY)} tiles`
    );
    console.log(
      `  Obstacles in path area: ${Array.from(obstacles)
        .filter((obs) => {
          const [x, y] = obs.split(',').map(Number);
          return (
            x >= Math.min(currentX, targetX) - 1 &&
            x <= Math.max(currentX, targetX) + 1 &&
            y >= Math.min(currentY, targetY) - 1 &&
            y <= Math.max(currentY, targetY) + 1
          );
        })
        .join(', ')}`
    );

    const path = findPath(currentX, currentY, targetX, targetY, obstacles);

    // console.log(
    //   `🔍 A* Result: ${path ? `SUCCESS with ${path.nodes.length} nodes` : 'FAILED'}`
    // );
    if (path) {
      // console.log(
      // `🛤️ Path nodes: ${path.nodes.map((n) => `(${n.x},${n.y})`).join(' -> ')}`
      // );
    } else {
      console.log('no path found');
    }

    if (path && path.nodes.length > 1) {
      // Store path in player state
      player.targetX = targetX * GAME_CONFIG.TILE_SIZE;
      player.targetY = targetY * GAME_CONFIG.TILE_SIZE;

      if (path.nodes.length > 10 && !skipActionDetection) {
        console.log('path length is too long, skipping');
        return;
      }

      player.currentPath = JSON.stringify(path.nodes);
      player.pathIndex = 1; // Skip first node (current position)
      player.isAutoWalking = true;

      // console.log(
      //   `✅ Player ${player.name} starting auto-walk to (${targetX}, ${targetY}) with ${path.nodes.length} nodes`
      // );
      // console.log(
      //   `🛤️ Path nodes:`,
      //   path.nodes.map((n) => `(${n.x},${n.y})`).join(' -> ')
      // );
    } else {
      console.log(
        `❌ No path found for player ${player.name} to (${targetX}, ${targetY})`
      );
    }
  }

  public movePlayerTo(
    playerId: string,
    data: { x: number; y: number },
    skipActionDetection: boolean = false
  ) {
    // Some runtimes expose clients as an array without getById; fall back to a client-like object
    const clientsAny: any = (this as any).clients;
    const realClient =
      clientsAny && typeof clientsAny.find === 'function'
        ? clientsAny.find((c: any) => c && c.sessionId === playerId)
        : null;
    const clientLike = realClient ?? ({ sessionId: playerId } as any);
    this.handleMoveTo(clientLike, data, skipActionDetection);
  }

  private updateAutoWalking(player: PlayerSchema, now: number) {
    pfUpdateAutoWalking(this as any, player, now);
  }

  private findAdjacentWalkableTile(
    obstacleX: number,
    obstacleY: number,
    playerX: number,
    playerY: number,
    obstacles: Set<string>
  ): { x: number; y: number } | null {
    // Try expanding rings around the obstacle to find accessible locations
    for (let radius = 1; radius <= 4; radius++) {
      const candidates: Array<{ x: number; y: number; distance: number }> = [];

      // Check all positions in the current radius ring
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          // Only check perimeter of current radius (not interior)
          if (radius > 1 && Math.abs(dx) < radius && Math.abs(dy) < radius) {
            continue;
          }

          const candidateX = obstacleX + dx;
          const candidateY = obstacleY + dy;

          // Check bounds
          if (
            candidateX < 0 ||
            candidateY < 0 ||
            candidateX >= GAME_CONFIG.MAP_WIDTH ||
            candidateY >= GAME_CONFIG.MAP_HEIGHT
          ) {
            continue;
          }

          // Skip if it's an obstacle
          if (obstacles.has(`${candidateX},${candidateY}`)) {
            continue;
          }

          // Calculate distance to player
          const distance = Math.sqrt(
            Math.pow(candidateX - playerX, 2) +
              Math.pow(candidateY - playerY, 2)
          );

          candidates.push({ x: candidateX, y: candidateY, distance });
        }
      }

      // If we found candidates at this radius, pick the closest to player
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.distance - b.distance);
        const chosen = candidates[0];

        console.log(
          `🎯 Found accessible location at radius ${radius}: (${chosen.x}, ${chosen.y}) distance ${chosen.distance.toFixed(1)}`
        );

        return { x: chosen.x, y: chosen.y };
      }
    }

    console.log(
      `❌ No accessible location found around obstacle (${obstacleX}, ${obstacleY})`
    );
    return null;
  }

  private isPlayerAdjacentToTile(
    playerX: number,
    playerY: number,
    tileX: number,
    tileY: number
  ): boolean {
    // Check if player is within 1 tile (adjacent including diagonals)
    const distX = Math.abs(playerX - tileX);
    const distY = Math.abs(playerY - tileY);
    return distX <= 1 && distY <= 1 && !(distX === 0 && distY === 0);
  }

  private gameTick() {
    // Advance deterministic tick clock by fixed delta per server tick
    const tickMs = Math.round(1000 / GAME_CONFIG.SERVER_TICK_HZ);
    this.now = this.now > 0 ? this.now + tickMs : Date.now();
    const now = this.now;
    this.state.lastTick = now;

    // Process any tick-scheduled spell follow-ups (e.g., bounce hops)
    processScheduledSpellFollowups(this as any, now);

    this.updateEnemyDifficultyMeter(now);
    this.updateHunted(now);
    this.updateKillStreakDecay(now);
    updateStatusSystem(this as any, now);

    // Apply cached player inputs per tick and handle bot respawning
    for (const [playerId, player] of this.state.players) {
      // Handle bot respawning when they die
      if (player.isBot && player.hp <= 0) {
        console.log(`Bot ${player.name} died, respawning...`);
        this.respawnBot(player);
      }

      // Skip movement and input processing for dead players
      if (player.hp <= 0) {
        continue;
      }

      // Handle auto-walking
      if (player.isAutoWalking && player.currentPath) {
        this.updateAutoWalking(player, now);
      }

      // Apply latest input if present to make movement independent of input rate
      const input = this.latestInputByClientId.get(playerId);
      if (input) {
        // Reuse existing handler for collision/dir/anim logic
        // Note: we pass a fake client-like object with sessionId
        const fakeClient = { sessionId: playerId } as Client;
        this.handleContinuousInput(fakeClient, input);
      }
    }

    // Update all active actions
    this.actionManager.updateActions(this);

    // Update bot AI movement
    this.updateBotMovement(now);

    // Update enemy AI movement
    {
      updateEnemyMovement(this as any, now);
    }

    // Update projectiles
    {
      updateProjectiles(this as any, now);
    }

    // Update vacuum system for all players
    {
      updateVacuumSystem(this as any, now);
    }

    // Apply player HP regen from abilities/wearables
    {
      updatePlayerRegen(this as any, now);
    }

    // Update fog-of-war after processing movement and interactions
    this.updateFogOfWar();
  }

  private updateFogOfWar(): void {
    if (
      !FOG_OF_WAR_ENABLED ||
      !this.isFogActiveForClients() ||
      !this.fogOfWarSystem
    ) {
      return;
    }

    if (this.state.players.size === 0) {
      return;
    }

    // Rollback: compute reveal every tick; no throttling/visibility sets
    // Apply per-player Augmented Vision multiplier by scaling the base radius
    const baseRadius = this.fogOfWarSystem.getVisionRadiusTiles();
    const scaledPlayers: any[] = [];
    for (const [, p] of this.state.players) {
      const mult = Math.max(0, Number((p as any).visionRadiusMultiplier) || 1);
      (p as any)._visionRadiusTiles = Math.max(
        1,
        Math.floor(baseRadius * mult)
      );
      scaledPlayers.push(p);
    }

    const result = this.fogOfWarSystem.update({
      players: scaledPlayers as any,
      enemies: [],
      npcs: [],
      projectiles: [],
      entities: [],
    } as any);

    if (result.newlyDiscoveredTiles.length > 0) {
      this.broadcastFogReveal(result.newlyDiscoveredTiles);
    }
  }

  public isTileDiscovered(tileX: number, tileY: number): boolean {
    try {
      if (!FOG_OF_WAR_ENABLED || !this.fogOfWarSystem) return true;
      // Use public API to avoid relying on internals
      const all = this.fogOfWarSystem.getAllDiscoveredTiles();
      for (let i = 0; i < all.length; i++) {
        const t = all[i];
        if (t.x === tileX && t.y === tileY) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private markAllEntitiesDirty(): void {
    this.state.entities.forEach((entity) => entity.setDirty('x'));
    this.state.enemies.forEach((enemy) => enemy.setDirty('x'));
    this.state.npcs.forEach((npc) => npc.setDirty('x'));
    this.state.projectiles.forEach((projectile) => projectile.setDirty('x'));
  }

  private broadcastFogReveal(tiles: Array<{ x: number; y: number }>): void {
    if (!tiles.length) {
      return;
    }
    this.msg.broadcast('fog_reveal', { tiles });
  }

  private broadcastFogState(includeTiles: boolean): void {
    if (!FOG_OF_WAR_ENABLED) {
      return;
    }
    if (!this.clients || this.clients.length === 0) {
      return;
    }
    for (const client of this.clients) {
      this.sendFogStateToClient(client, includeTiles);
    }
  }

  private sendFogStateToClient(client: Client, includeTiles: boolean): void {
    if (!FOG_OF_WAR_ENABLED) {
      this.msg.sendTo(client, 'fog_state', {
        enabled: false,
        tileSize: GAME_CONFIG.TILE_SIZE,
        mapWidth: GAME_CONFIG.MAP_WIDTH,
        mapHeight: GAME_CONFIG.MAP_HEIGHT,
        radiusTiles: DEFAULT_VISION_RADIUS_TILES,
      });
      return;
    }
    const enabled = this.isFogActiveForClients();
    const payload: FogStatePayload = {
      enabled,
      tileSize: GAME_CONFIG.TILE_SIZE,
      mapWidth: GAME_CONFIG.MAP_WIDTH,
      mapHeight: GAME_CONFIG.MAP_HEIGHT,
      radiusTiles:
        this.fogOfWarSystem?.getVisionRadiusTiles() ??
        DEFAULT_VISION_RADIUS_TILES,
    };

    if (enabled && includeTiles && this.fogOfWarSystem) {
      payload.discovered = this.fogOfWarSystem.getAllDiscoveredTiles();
    }

    this.msg.sendTo(client, 'fog_state', payload);
  }

  private enableFogForClients(
    options: {
      broadcast?: boolean;
      reset?: boolean;
    } = {}
  ): void {
    if (!FOG_OF_WAR_ENABLED || !this.fogOfWarSystem) {
      this.fogActiveForClients = false;
      return;
    }

    const broadcast = options.broadcast ?? true;
    const reset = options.reset ?? true;

    this.fogActiveForClients = true;

    if (reset) {
      this.fogOfWarSystem.reset();
      this.visibleEnemyIds.clear();
      this.visibleNpcIds.clear();
      this.visibleProjectileIds.clear();
      this.markAllEntitiesDirty();
    }

    if (broadcast) {
      this.broadcastFogState(true);
    }
  }

  private disableFogForClients(options: { broadcast?: boolean } = {}): void {
    const broadcast = options.broadcast ?? true;

    if (!this.fogActiveForClients) {
      if (broadcast) {
        if (FOG_OF_WAR_ENABLED) {
          this.broadcastFogState(false);
        }
      }
      return;
    }

    this.fogActiveForClients = false;
    this.visibleEnemyIds.clear();
    this.visibleNpcIds.clear();
    this.visibleProjectileIds.clear();
    this.markAllEntitiesDirty();

    if (broadcast) {
      if (FOG_OF_WAR_ENABLED) {
        this.broadcastFogState(false);
      }
    }
  }

  public isFogActiveForClients(): boolean {
    if (!FOG_OF_WAR_ENABLED) return false;
    return Boolean(this.fogActiveForClients && this.fogOfWarSystem);
  }

  private updateBotMovement(now: number) {
    for (const [playerId, player] of this.state.players) {
      if (!player.isBot) continue; // Skip real players

      // Simple AI: Move randomly every 2-4 seconds
      if (
        !player.lastMoveTime ||
        now - player.lastMoveTime > 2000 + Math.random() * 2000
      ) {
        // Choose a random direction and move a bit
        const directions = ['up', 'down', 'left', 'right'];
        const randomDir =
          directions[Math.floor(Math.random() * directions.length)];

        const moveDistance = 20 + Math.random() * 40; // Move 20-60 pixels
        const prevX = player.x;
        const prevY = player.y;

        switch (randomDir) {
          case 'up':
            player.y -= moveDistance;
            break;
          case 'down':
            player.y += moveDistance;
            break;
          case 'left':
            player.x -= moveDistance;
            break;
          case 'right':
            player.x += moveDistance;
            break;
        }

        // Check for obstacle collision and revert if necessary
        if (this.checkObstacleCollision(player.x, player.y, 20)) {
          player.x = prevX;
          player.y = prevY;
        } else {
          player.dir = randomDir as any;
          player.anim = 'walk';
          player.lastMoveTime = now;
        }

        // Keep within bounds
        player.x = Math.max(
          GAME_CONFIG.TILE_SIZE,
          Math.min(GAME_CONFIG.WORLD_WIDTH - GAME_CONFIG.TILE_SIZE, player.x)
        );
        player.y = Math.max(
          GAME_CONFIG.TILE_SIZE,
          Math.min(GAME_CONFIG.WORLD_HEIGHT - GAME_CONFIG.TILE_SIZE, player.y)
        );

        // Update road status
        player.onRoad = this.isOnRoad(player.x, player.y);
      }
    }
  }

  /**
   * Handle portal interaction - transition all players to new map or boss room
   */
  private handlePortalInteraction(client: Client, data: { portalId: string }) {
    if (this.stagingEnabled && this.phase !== 'in_game') {
      this.handleStagingPortalInteraction(client, data);
      return;
    }

    sysHandlePortalInteraction(this as any, client, data);
  }

  private handleStagingPortalInteraction(
    client: Client,
    data: { portalId: string }
  ) {
    stagingHandleStagingPortalInteraction(
      this as any,
      client,
      data,
      PORTAL_START_COUNTDOWN_MS,
      STAGING_LATE_JOIN_WINDOW_MS
    );
  }

  private startStagingCountdown(client: Client) {
    stagingStartStagingCountdown(
      this as any,
      client,
      PORTAL_START_COUNTDOWN_MS,
      STAGING_LATE_JOIN_WINDOW_MS
    );
  }

  private beginDungeonRun(starterSessionId?: string | null) {
    stagingBeginDungeonRun(
      this as any,
      starterSessionId,
      STAGING_LATE_JOIN_WINDOW_MS
    );
  }

  public setEnemyAggro(enemyId: string, playerId: string) {
    const enemy = this.state.enemies.get(enemyId);
    if (!enemy) return;
    enemy.forcedAggro = true as any;
    enemy.aggroTargetPlayerId = playerId as any;
    enemy.targetPlayerId = playerId as any;
  }

  public hasLineOfSight(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ): boolean {
    if (!this.mapGenerator) {
      return true;
    }
    const tileSize = GAME_CONFIG.TILE_SIZE || 32;
    let x0 = Math.floor(fromX / tileSize);
    let y0 = Math.floor(fromY / tileSize);
    const x1 = Math.floor(toX / tileSize);
    const y1 = Math.floor(toY / tileSize);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let first = true;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!first && this.mapGenerator.isSolid(x0, y0)) {
        return false;
      }
      if (x0 === x1 && y0 === y1) {
        break;
      }
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      first = false;
    }
    return true;
  }

  public async handleEnemyDeath(
    enemy: any,
    enemyId: string,
    attackType: 'melee' | 'ranged' | 'grenades' = 'melee',
    killerId?: string
  ) {
    // If the boss has already been killed, ignore further kill processing for non-boss enemies
    // and hard-remove the entity to prevent post-boss kill farming.
    try {
      const isBossFlag = Boolean((enemy as any)?.isBossEncounter);
      if (!isBossFlag && this.bossKilled) {
        try {
          if (this.state.enemies.has(enemyId)) {
            this.state.enemies.delete(enemyId);
          }
          // Also drop any pending scheduled removals/followups referencing this enemy
          const s: any = this.state as any;
          if (Array.isArray(s._scheduledEnemyRemovals)) {
            s._scheduledEnemyRemovals = s._scheduledEnemyRemovals.filter(
              (t: any) => t && t.id !== enemyId
            );
          }
          if (Array.isArray(s._scheduledSpellFollowups)) {
            s._scheduledSpellFollowups = s._scheduledSpellFollowups.filter(
              (t: any) => t && t.fromId !== enemyId && t.toId !== enemyId
            );
          }
        } catch {}
        return;
      }
    } catch {}

    // Drop any scheduled spell follow-ups targeting or originating from this enemy
    try {
      const state: any = this.state as any;
      if (Array.isArray(state._scheduledSpellFollowups)) {
        state._scheduledSpellFollowups = state._scheduledSpellFollowups.filter(
          (t: any) =>
            t &&
            t.kind === 'spell_bounce' &&
            t.fromId !== enemyId &&
            t.toId !== enemyId
        );
      }
    } catch {
      // Ignore errors filtering scheduled followups
    }

    // Track boss kills for completion status
    const isBossEncounter = Boolean((enemy as any).isBossEncounter);
    if (isBossEncounter) {
      this.bossKilled = true;
      // Clear boss aura effects immediately
      try {
        clearAuraEffects(enemy as any);
      } catch {}
      // Immediately despawn all remaining enemies in the boss room and clear scheduled spawns/projectiles
      try {
        // Remove all non-boss enemies
        if (this.state.enemies && this.state.enemies.size > 0) {
          const toRemove: string[] = [];
          this.state.enemies.forEach((_e, id) => {
            if (id !== enemyId) toRemove.push(id);
          });
          for (const id of toRemove) {
            try {
              const e = this.state.enemies.get(id);
              if (e) clearAuraEffects(e as any);
            } catch {}
            this.state.enemies.delete(id);
          }
        }
        // Clear any scheduled enemy removals/spawn followups and spell followups to prevent post-boss spawns
        const s: any = this.state as any;
        if (Array.isArray(s._scheduledEnemyRemovals)) {
          s._scheduledEnemyRemovals = s._scheduledEnemyRemovals.filter(
            (t: any) => t && t.id === enemyId
          );
        }
        if (Array.isArray(s._scheduledEnemyFollowups)) {
          s._scheduledEnemyFollowups = [];
        }
        if (Array.isArray(s._scheduledSpellFollowups)) {
          s._scheduledSpellFollowups = s._scheduledSpellFollowups.filter(
            (t: any) => t && t.fromId === enemyId && t.toId === enemyId
          );
        }
        // Remove any remaining projectiles to avoid stray kills after boss death
        try {
          this.state.projectiles.clear();
        } catch {}
      } catch {}
    }

    const xpAwarded = this.awardXpForEnemyDefeat(
      enemy,
      enemyId,
      attackType,
      killerId
    );
    if (killerId) {
      this.recordKill(killerId);
    }
    await this.recordEnemyKill(enemy, enemyId, attackType, killerId, xpAwarded);
    this.persistGameMetrics({ totalEnemyKillsDelta: 1 });
    this.handleEliteDeathCleanup(enemy as EnemySchema, enemyId);

    if (isBossEncounter) {
      await this.handleHighStakesBossKill(killerId);
    }

    sysHandleEnemyDeath(this as any, enemy, enemyId, attackType, killerId);
  }

  public clearDailyQuestPayoutGuarantees() {
    this.highStakesBossBonusByPlayerId.clear();
  }

  public getDailyQuestBossBonus(playerId: string): {
    usdc: number;
    ghst: number;
  } {
    return (
      this.highStakesBossBonusByPlayerId.get(playerId) ?? { usdc: 0, ghst: 0 }
    );
  }

  private broadcastSnapshot() {
    this.flushPendingScores();
  }

  private emitMatchEvent(
    eventName: string,
    _payload: Record<string, unknown> = {}
  ) {
    // Handle internal server-side hooks for world transitions
    try {
      if (eventName === 'new_map_entered') {
        // Reset and recompute group anchor for new floor, then group-spawn everyone
        this.dungeonGroupSpawnAnchor = null;
        this.dungeonGroupSpawnAnchor = this.computeDungeonGroupSpawnAnchor();
        this.state.players.forEach((player) => {
          this.setPlayerSpawnPosition(player);
        });
      }
    } catch (error) {
      if (DEBUG) {
        console.warn('emitMatchEvent handler failed', {
          eventName,
          error,
        });
      }
    }
  }

  private async generateDungeonLayout(difficultyTier: string) {
    const chunkSets = await this.loadChunkSetsForRuntime();
    this.mapGenerator = new MapGenerator(
      this.state.seed,
      GAME_CONFIG.MAP_WIDTH,
      GAME_CONFIG.MAP_HEIGHT,
      difficultyTier,
      chunkSets as any
    );
    const mapResult = this.mapGenerator.generateEntities();
    this.resetEliteSpawnState();
    this.dungeonChunkLayoutData = mapResult.chunkLayout.map((layout) => ({
      ...layout,
      tags: Array.isArray((layout as any).tags)
        ? [...((layout as any).tags as string[])]
        : undefined,
      ports: Array.isArray((layout as any).ports)
        ? ((layout as any).ports as any[]).map((port: any) => ({ ...port }))
        : undefined,
    }));
    this.chunkLayoutData = this.dungeonChunkLayoutData.map((layout) => ({
      x: layout.x,
      y: layout.y,
      chunkName: layout.chunkName,
    }));
    this.dungeonEntityBlueprints = mapResult.entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      state: entity.state,
    }));
    this.initialEnemySpawns = mapResult.enemySpawns.map((spawn) => ({
      type: spawn.type,
      x: spawn.x,
      y: spawn.y,
    }));
    // Spawn NPCs from chunk data immediately
    if ((mapResult as any).npcSpawns && (mapResult as any).npcSpawns.length) {
      sysSpawnNPCsFromConfigs(
        this as any,
        (mapResult as any).npcSpawns.map((n: any) => ({
          characterId: n.characterId,
          dialogueId: n.dialogueId,
          x: n.x,
          y: n.y,
        }))
      );
    }
  }

  private resetEliteSpawnState() {
    this.eliteGroupsByRoom.clear();
    this.elitesSpawnedThisFloor = 0;
  }

  public resetEliteStateForNewMap(): void {
    this.resetEliteSpawnState();
  }

  public resetHuntedForNewFloor(now = Date.now()): void {
    const huntedConfig = (GAME_CONFIG as any).hunted || {};
    const enabled =
      huntedConfig.enabled !== false &&
      this.phase === 'in_game' &&
      !this.isRoomTransitioning;
    this.state.huntedEnabled = enabled;
    this.state.huntedFloorStartedAt = now;
    this.state.huntedIntensityLevel = 0;
    this.state.huntedGroupsSpawnedThisFloor = 0;
    const grace = Math.max(0, Number(huntedConfig.floorGracePeriodMs) || 0);
    this.state.huntedNextSpawnAt = enabled ? now + grace : 0;
    this.huntedLastSpawnAt = 0;
  }

  private resetEliteMinionState(minion: EnemySchema) {
    const baseDamage = (minion as any)._baseDamage;
    if (typeof baseDamage === 'number') minion.damage = baseDamage;
    const baseSpeed = (minion as any)._baseSpeed;
    if (typeof baseSpeed === 'number') minion.speed = baseSpeed;
    const baseCooldown = (minion as any)._baseAttackCooldownMs;
    if (typeof baseCooldown === 'number')
      (minion as any).attackCooldownMs = baseCooldown;
    const auraState = (minion as any)._auraState;
    if (auraState) {
      auraState.active = false;
      auraState.damageReduction = 0;
      auraState.regenPerSecond = 0;
      auraState.nextRegenAt = 0;
      auraState.appliedVisualTags = [];
    }
    (minion as any)._auraCrit = undefined;
    (minion as any)._auraEvadeState = undefined;
    (minion as any)._activeAuraAbilities = undefined;
    (minion as any)._lifeStealCapPerHit = 0;
    if (typeof (minion as any)._baseLifeStealMeleePct === 'number') {
      minion.lifeStealMeleePct = (minion as any)._baseLifeStealMeleePct;
    }
    const visualTags = minion.visualTags as any;
    if (visualTags && typeof visualTags.length === 'number') {
      for (let i = visualTags.length - 1; i >= 0; i--) {
        const tag = visualTags[i];
        if (
          typeof tag === 'string' &&
          (tag === 'aura:buffed' || tag.startsWith('aura:'))
        ) {
          visualTags.splice(i, 1);
        }
      }
    }
  }

  private handleEliteDeathCleanup(enemy: EnemySchema, enemyId: string) {
    for (const [roomKey, groups] of this.eliteGroupsByRoom.entries()) {
      let updated = false;
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (group.leaderId === enemyId) {
          updated = true;
          groups.splice(i, 1);
          for (const minionId of group.minionIds) {
            const minion = this.state.enemies.get(minionId);
            if (!minion) continue;
            this.resetEliteMinionState(minion);
            minion.leaderId = '';
          }
          break;
        }
        if (group.minionIds.includes(enemyId)) {
          updated = true;
          group.minionIds = group.minionIds.filter((id) => id !== enemyId);
          break;
        }
      }
      if (updated) {
        if (groups.length > 0) {
          this.eliteGroupsByRoom.set(roomKey, groups);
        } else {
          this.eliteGroupsByRoom.delete(roomKey);
        }
        break;
      }
    }
  }

  private isRoomChunk(entry: DungeonChunkLayoutEntry): boolean {
    const role = String(entry.role || 'room').toLowerCase();
    return role === 'room';
  }

  private classifyRoomTier(
    entry: DungeonChunkLayoutEntry
  ): 'small' | 'medium' | 'large' {
    const tileSize = GAME_CONFIG.TILE_SIZE;
    const widthTiles = Math.max(
      1,
      entry.widthTiles ??
        Math.floor((entry.worldWidthPx ?? tileSize * 20) / tileSize)
    );
    const heightTiles = Math.max(
      1,
      entry.heightTiles ??
        Math.floor((entry.worldHeightPx ?? tileSize * 20) / tileSize)
    );
    const area = widthTiles * heightTiles;
    if (area <= 900) return 'small';
    if (area <= 1600) return 'medium';
    return 'large';
  }

  private getEliteSpawnChance(roomTier: string): number {
    const config = (GAME_CONFIG as any).eliteSpawnChanceByRoomTier || {};
    const normalizedTier = String(roomTier).toLowerCase();
    const defaultChance =
      typeof config.default === 'number' ? config.default : 0;
    const tierChance =
      typeof config[normalizedTier] === 'number'
        ? config[normalizedTier]
        : undefined;
    return Math.min(1, Math.max(0, tierChance ?? defaultChance));
  }

  private getChunkCenter(entry: DungeonChunkLayoutEntry): {
    x: number;
    y: number;
  } {
    const info = this.toEliteChunkInfo(entry);
    return {
      x: info.anchorX + info.worldWidthPx / 2,
      y: info.anchorY + info.worldHeightPx / 2,
    };
  }

  private toEliteChunkInfo(entry: DungeonChunkLayoutEntry): EliteChunkInfo {
    const tileSize = GAME_CONFIG.TILE_SIZE;
    const widthTiles = Math.max(
      1,
      entry.widthTiles ??
        Math.floor((entry.worldWidthPx ?? tileSize * 20) / tileSize)
    );
    const heightTiles = Math.max(
      1,
      entry.heightTiles ??
        Math.floor((entry.worldHeightPx ?? tileSize * 20) / tileSize)
    );
    const worldWidthPx = entry.worldWidthPx ?? widthTiles * tileSize;
    const worldHeightPx = entry.worldHeightPx ?? heightTiles * tileSize;
    const anchorX = entry.anchorX ?? entry.x * widthTiles * tileSize;
    const anchorY = entry.anchorY ?? entry.y * heightTiles * tileSize;
    return {
      anchorX,
      anchorY,
      widthTiles,
      heightTiles,
      worldWidthPx,
      worldHeightPx,
      ports: entry.ports ? entry.ports.map((port) => ({ ...port })) : undefined,
      gridX: entry.x,
      gridY: entry.y,
      tags: entry.tags ? [...entry.tags] : undefined,
    };
  }

  private getNearestRoomChunkToPosition(
    x: number,
    y: number
  ): DungeonChunkLayoutEntry | null {
    if (
      !this.dungeonChunkLayoutData ||
      this.dungeonChunkLayoutData.length === 0
    )
      return null;
    const roomEntries = this.dungeonChunkLayoutData.filter((entry) =>
      this.isRoomChunk(entry)
    );
    if (roomEntries.length === 0) return null;
    const tileSize = GAME_CONFIG.TILE_SIZE;
    const chunkSize = this.mapGenerator?.getChunkPixelSize
      ? this.mapGenerator.getChunkPixelSize()
      : { widthPx: tileSize * 20, heightPx: tileSize * 20 };
    const widthPx =
      Number((chunkSize as any).widthPx) > 0
        ? Number((chunkSize as any).widthPx)
        : tileSize * 20;
    const heightPx =
      Number((chunkSize as any).heightPx) > 0
        ? Number((chunkSize as any).heightPx)
        : tileSize * 20;

    let best: DungeonChunkLayoutEntry | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const entry of roomEntries) {
      const cx = entry.x * widthPx + widthPx / 2;
      const cy = entry.y * heightPx + heightPx / 2;
      const dx = cx - x;
      const dy = cy - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = entry;
      }
    }
    return best;
  }

  private clampPointToChunk(
    chunk: EliteChunkInfo,
    x: number,
    y: number,
    margin: number
  ): { x: number; y: number } {
    const left = chunk.anchorX + margin;
    const right = chunk.anchorX + Math.max(margin, chunk.worldWidthPx - margin);
    const top = chunk.anchorY + margin;
    const bottom =
      chunk.anchorY + Math.max(margin, chunk.worldHeightPx - margin);
    return {
      x: Math.max(left, Math.min(right, x)),
      y: Math.max(top, Math.min(bottom, y)),
    };
  }

  private createSeededRng(key: string): () => number {
    let hash = this.state.seed || 0;
    const salt = String(key);
    for (let i = 0; i < salt.length; i++) {
      hash = Math.imul(hash ^ salt.charCodeAt(i), 16777619);
    }
    let state = hash >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private pickEliteArchetype(
    archetypes: EliteArchetype[],
    rng: () => number
  ): EliteArchetype | null {
    if (archetypes.length === 0) return null;
    const weights = archetypes.map((archetype) =>
      Math.max(0, Number(archetype.spawnWeight) || 1)
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return archetypes[0];
    let roll = rng() * total;
    for (let i = 0; i < archetypes.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return archetypes[i];
    }
    return archetypes[archetypes.length - 1];
  }

  private getEligibleEliteArchetypesForChunk(
    entry: DungeonChunkLayoutEntry,
    roomTier?: string
  ): EliteArchetype[] {
    const tier = roomTier || this.classifyRoomTier(entry);
    return Object.values(ELITE_ARCHETYPES).filter((archetype) => {
      const tiers = archetype.allowedRoomTiers || [];
      const tierOk =
        tiers.length === 0 ||
        tiers.some((allowedTier) => {
          const normalized = String(allowedTier).toLowerCase();
          return (
            normalized === 'any' || normalized === 'all' || normalized === tier
          );
        });
      if (!tierOk) return false;
      const biomes = archetype.allowedBiomes || [];
      const biomeOk =
        biomes.length === 0 ||
        biomes.some((biome) => {
          const normalized = String(biome).toLowerCase();
          return normalized === 'any' || normalized === 'dungeon';
        });
      return biomeOk;
    });
  }

  private registerEliteGroupSpawn(
    entry: DungeonChunkLayoutEntry,
    spawnResult: { leader: EnemySchema; minions: EnemySchema[] },
    archetype: EliteArchetype,
    roomTier: string,
    source: 'natural' | 'hunted' = 'natural',
    spawnedAt?: number
  ): void {
    const roomKey = `${entry.x},${entry.y}`;
    const groups = this.eliteGroupsByRoom.get(roomKey) || [];
    const timestamp =
      typeof spawnedAt === 'number' ? spawnedAt : this.now || Date.now();
    groups.push({
      leaderId: spawnResult.leader.id,
      archetypeId: archetype.id,
      centerX: spawnResult.leader.x,
      centerY: spawnResult.leader.y,
      minionIds: spawnResult.minions.map((minion) => minion.id),
      roomTier,
      source,
      spawnedAt: timestamp,
    });
    this.eliteGroupsByRoom.set(roomKey, groups);
    this.elitesSpawnedThisFloor += 1;
  }

  private trySpawnEliteInChunk(
    entry: DungeonChunkLayoutEntry,
    options: { force?: boolean } = {}
  ): boolean {
    if (!this.isRoomChunk(entry)) return false;

    const forceSpawn = options.force === true;
    const roomTier = this.classifyRoomTier(entry);
    const spawnChance = this.getEliteSpawnChance(roomTier);

    const maxPerFloorRaw = Math.max(
      0,
      Number((GAME_CONFIG as any).eliteMaxPerFloor) || 0
    );
    const floorCap = maxPerFloorRaw > 0 ? maxPerFloorRaw : Infinity;
    if (this.elitesSpawnedThisFloor >= floorCap) {
      return false;
    }

    if (!forceSpawn && spawnChance <= 0) return false;

    const roomKey = `${entry.x},${entry.y}`;
    const perRoomCapConfig = (GAME_CONFIG as any).maxElitesPerRoomBySize || {};
    const perRoomCap = Math.max(1, Number(perRoomCapConfig[roomTier]) || 1);
    const existing = this.eliteGroupsByRoom.get(roomKey) || [];
    if (existing.length >= perRoomCap) {
      return false;
    }

    const rng = this.createSeededRng(`elite:${roomKey}:${this.state.seed}`);
    if (!forceSpawn) {
      if (rng() > spawnChance) {
        return false;
      }
    } else {
      rng();
    }

    const center = this.getChunkCenter(entry);
    const minDistanceTiles = Math.max(
      0,
      Number((GAME_CONFIG as any).minDistanceBetweenElites) || 0
    );
    if (minDistanceTiles > 0) {
      const minDistancePx = minDistanceTiles * GAME_CONFIG.TILE_SIZE;
      const minDistanceSq = minDistancePx * minDistancePx;
      for (const groups of this.eliteGroupsByRoom.values()) {
        for (const group of groups) {
          const dx = group.centerX - center.x;
          const dy = group.centerY - center.y;
          if (dx * dx + dy * dy < minDistanceSq) {
            return false;
          }
        }
      }
    }

    const eligibleArchetypes = this.getEligibleEliteArchetypesForChunk(
      entry,
      roomTier
    );

    if (eligibleArchetypes.length === 0) {
      return false;
    }

    const archetype = this.pickEliteArchetype(eligibleArchetypes, rng);
    if (!archetype) return false;

    const spawnResult = sysSpawnEliteGroup(this as any, {
      chunk: this.toEliteChunkInfo(entry),
      archetype,
      rng,
      roomTier,
    });

    if (!spawnResult) {
      return false;
    }

    this.registerEliteGroupSpawn(
      entry,
      spawnResult,
      archetype,
      roomTier,
      'natural'
    );
    return true;
  }

  private spawnElitesForDungeon() {
    if (
      !this.dungeonChunkLayoutData ||
      this.dungeonChunkLayoutData.length === 0
    ) {
      return;
    }
    const roomEntries = this.dungeonChunkLayoutData.filter((entry) =>
      this.isRoomChunk(entry)
    );
    if (roomEntries.length === 0) {
      return;
    }

    const maxPerFloorRaw = Math.max(
      0,
      Number((GAME_CONFIG as any).eliteMaxPerFloor) || 0
    );
    const floorCap = maxPerFloorRaw > 0 ? maxPerFloorRaw : Infinity;

    for (const entry of roomEntries) {
      if (this.elitesSpawnedThisFloor >= floorCap) {
        break;
      }
      const spawned = this.trySpawnEliteInChunk(entry);
      if (spawned && this.elitesSpawnedThisFloor >= floorCap) {
        break;
      }
    }

    const desiredMinimum = floorCap === 0 ? 0 : 1;
    if (this.elitesSpawnedThisFloor < desiredMinimum) {
      for (const entry of roomEntries) {
        if (this.trySpawnEliteInChunk(entry, { force: true })) {
          break;
        }
      }
    }
  }

  private getDungeonChunkEntryForWorldPosition(
    x: number,
    y: number
  ): DungeonChunkLayoutEntry | null {
    if (
      !this.dungeonChunkLayoutData ||
      this.dungeonChunkLayoutData.length === 0
    )
      return null;
    let chunkWidthPx = GAME_CONFIG.TILE_SIZE * 20;
    let chunkHeightPx = GAME_CONFIG.TILE_SIZE * 20;
    try {
      if (
        this.mapGenerator &&
        typeof this.mapGenerator.getChunkPixelSize === 'function'
      ) {
        const size = this.mapGenerator.getChunkPixelSize();
        const w = Number((size as any)?.widthPx);
        const h = Number((size as any)?.heightPx);
        if (Number.isFinite(w) && w > 0) chunkWidthPx = w;
        if (Number.isFinite(h) && h > 0) chunkHeightPx = h;
      }
    } catch {}
    const gridX = Math.floor(x / Math.max(1, chunkWidthPx));
    const gridY = Math.floor(y / Math.max(1, chunkHeightPx));
    const entry = this.dungeonChunkLayoutData.find(
      (c) => c.x === gridX && c.y === gridY
    );
    return entry || null;
  }

  private pickRandomRoomChunk(
    rng: () => number
  ): DungeonChunkLayoutEntry | null {
    if (
      !this.dungeonChunkLayoutData ||
      this.dungeonChunkLayoutData.length === 0
    )
      return null;
    const roomEntries = this.dungeonChunkLayoutData.filter((entry) =>
      this.isRoomChunk(entry)
    );
    const pool =
      roomEntries.length > 0 ? roomEntries : this.dungeonChunkLayoutData;
    if (pool.length === 0) return null;
    const idx = Math.floor(rng() * pool.length);
    return pool[Math.max(0, Math.min(pool.length - 1, idx))] || null;
  }

  private pickDistinctRoomChunk(
    rng: () => number,
    exclude?: DungeonChunkLayoutEntry | null
  ): DungeonChunkLayoutEntry | null {
    const primary = this.pickRandomRoomChunk(rng);
    if (!primary) return null;
    if (!exclude) return primary;
    if (primary.x !== exclude.x || primary.y !== exclude.y) return primary;
    const rooms = (this.dungeonChunkLayoutData || []).filter((entry) =>
      this.isRoomChunk(entry)
    );
    if (rooms.length <= 1) return primary;
    const idx = Math.floor(rng() * rooms.length);
    return rooms[Math.max(0, Math.min(rooms.length - 1, idx))] || primary;
  }

  private applyHuntedAggro(
    leader: EnemySchema,
    minions: EnemySchema[],
    targetPlayerId: string | null,
    now: number
  ): void {
    const mapDiag = Math.sqrt(
      GAME_CONFIG.WORLD_WIDTH * GAME_CONFIG.WORLD_WIDTH +
        GAME_CONFIG.WORLD_HEIGHT * GAME_CONFIG.WORLD_HEIGHT
    );
    const hyperAggroRange = Math.max(mapDiag * 2, 50_000);
    const assign = (enemy: EnemySchema) => {
      enemy.aggroRange = Math.max(
        hyperAggroRange,
        Number(enemy.aggroRange) || 0
      );
      enemy.forcedAggro = true as any;
      if (targetPlayerId) {
        enemy.aggroTargetPlayerId = targetPlayerId as any;
        enemy.targetPlayerId = targetPlayerId as any;
      }
      (enemy as any).isDormant = false;
      (enemy as any).stayActiveUntil = now + 5000;
      (enemy as any).nextTargetScanAt = now;
      (enemy as any).nextProximityCheckAt = now;
    };
    assign(leader);
    for (const m of minions) assign(m);
  }

  private countActiveHuntedGroups(): number {
    let count = 0;
    for (const groups of this.eliteGroupsByRoom.values()) {
      for (const group of groups) {
        if (group && group.source === 'hunted') {
          count += 1;
        }
      }
    }
    return count;
  }

  private getHuntedEliteCap(): number {
    const baseCap = Math.max(
      0,
      Number((GAME_CONFIG as any).eliteMaxPerFloor) || 0
    );
    const extraCap = Math.max(
      0,
      Number(((GAME_CONFIG as any).hunted || {}).huntedExtraEliteCap) || 0
    );
    const combined = baseCap + extraCap;
    return combined > 0 ? combined : Infinity;
  }

  private getHuntedSpawnIntervalMs(
    wavesSpawned: number,
    huntedConfig: any
  ): number {
    const base = Math.max(
      1000,
      Number(huntedConfig.baseSpawnIntervalMs) || 60_000
    );
    const min = Math.max(
      500,
      Number(huntedConfig.minSpawnIntervalMs) || 15_000
    );
    const step = Math.max(0, Number(huntedConfig.waveIntervalStepMs) || 0);
    const interval = base - wavesSpawned * step;
    return Math.max(min, interval);
  }

  private computeHuntedIntensityLevel(
    elapsedMs: number,
    huntedConfig: any,
    wavesSpawned: number
  ): number {
    const graceMs = Math.max(
      0,
      Number(huntedConfig.floorGracePeriodMs) || 180_000
    );
    const maxLevel = Math.max(1, Number(huntedConfig.maxIntensityLevel) || 5);
    if (elapsedMs < graceMs) {
      return 0;
    }
    const waves = Math.max(0, wavesSpawned);
    const level = 1 + Math.floor(waves / 3);
    return Math.min(maxLevel, Math.max(1, level));
  }

  private getHuntedPacksPerWave(
    intensityLevel: number,
    maxConcurrent: number
  ): number {
    const huntedConfig = (GAME_CONFIG as any).hunted || {};
    if (huntedConfig.soloHunterMode) {
      return Math.max(0, Math.min(1, maxConcurrent));
    }
    if (intensityLevel <= 0) return 0;
    const packs = 1 + Math.floor(Math.max(0, intensityLevel - 1) / 2);
    return Math.max(1, Math.min(maxConcurrent, packs));
  }

  private applyHuntedStatScaling(
    enemy: EnemySchema,
    hpMultiplier: number,
    damageMultiplier: number,
    speedMultiplier: number,
    minSpeed?: number
  ): void {
    const hpMul = Math.max(0.01, hpMultiplier || 1);
    const dmgMul = Math.max(0.01, damageMultiplier || 1);
    const spdMul = Math.max(0.01, speedMultiplier || 1);
    enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * hpMul));
    enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
    enemy.damage = Math.max(0, Math.round(enemy.damage * dmgMul));
    const newSpeed = (enemy as any).speed * spdMul;
    const flooredSpeed =
      typeof minSpeed === 'number' && minSpeed > 0
        ? Math.max(newSpeed, minSpeed)
        : newSpeed;
    enemy.speed = flooredSpeed;
    if (typeof (enemy as any)._baseSpeed === 'number') {
      (enemy as any)._baseSpeed = Math.max(
        (enemy as any)._baseSpeed * spdMul,
        flooredSpeed
      );
    }
  }

  private pickHuntedAnchors(desiredCount: number, now: number): PlayerSchema[] {
    const count = Math.max(1, Math.floor(desiredCount));
    const players = Array.from(this.state.players.values());
    if (players.length === 0) return [];
    const alive = players.filter((p) => p.hp > 0);
    const pool = alive.length > 0 ? alive : players;
    const rng = this.createSeededRng(
      `hunted:anchors:${this.currentFloor}:${this.state.seed}:${now}`
    );
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }

  private spawnHuntedEliteWave(
    packsToSpawn: number,
    now: number,
    intensityLevel: number
  ): number {
    const huntedConfig = (GAME_CONFIG as any).hunted || {};
    const maxConcurrent = Math.max(
      1,
      Number(huntedConfig.maxConcurrentHuntedGroups) || 1
    );
    const maxPerFloor = Math.max(
      0,
      Number(huntedConfig.maxHuntedGroupsPerFloor) || 0
    );
    const spawnedSoFar = Math.max(
      0,
      Number(this.state.huntedGroupsSpawnedThisFloor) || 0
    );
    const remainingAllowed =
      maxPerFloor > 0 ? Math.max(0, maxPerFloor - spawnedSoFar) : Infinity;
    const activeHunted = this.countActiveHuntedGroups();
    const availableConcurrent = Math.max(0, maxConcurrent - activeHunted);
    const eliteCap = this.getHuntedEliteCap();
    const waveIndex = spawnedSoFar;
    const hpScalePerWave = Math.max(
      0,
      Number(huntedConfig.perWaveHpMultiplier) || 0
    );
    const dmgScalePerWave = Math.max(
      0,
      Number(huntedConfig.perWaveDamageMultiplier) || 0
    );
    const speedPerIntensity = Math.max(
      0,
      Number(huntedConfig.perIntensitySpeedMultiplier) || 0
    );
    const minSpeedMultiplierVsPlayer = Math.max(
      1,
      Number(huntedConfig.minSpeedMultiplierVsPlayer) || 1
    );
    const minSpeed =
      (GAME_CONFIG.MOVEMENT_SPEED || 4) * minSpeedMultiplierVsPlayer;
    const hpMultiplier = 1 + waveIndex * hpScalePerWave;
    const dmgMultiplier = 1 + waveIndex * dmgScalePerWave;
    const speedMultiplier =
      1 + Math.max(0, intensityLevel - 1) * speedPerIntensity;

    let targetPacks = Math.max(0, Math.floor(packsToSpawn));
    if (Number.isFinite(remainingAllowed)) {
      targetPacks = Math.min(targetPacks, remainingAllowed as number);
    }
    targetPacks = Math.min(targetPacks, availableConcurrent);
    if (eliteCap !== Infinity && this.elitesSpawnedThisFloor >= eliteCap) {
      return 0;
    }
    if (targetPacks <= 0) {
      console.log(
        `[HUNTED] Wave skipped: target packs ${targetPacks}, activeHunted ${activeHunted}, remainingAllowed ${remainingAllowed}, concurrent cap ${maxConcurrent}`
      );
      return 0;
    }

    const anchors = this.pickHuntedAnchors(targetPacks, now);
    if (anchors.length === 0) {
      return 0;
    }

    console.log(
      `[HUNTED] Spawning wave L${intensityLevel} packs=${targetPacks}, anchors=${anchors.length}, activeHunted=${activeHunted}, spawnedSoFar=${spawnedSoFar}, eliteCap=${eliteCap}`
    );

    const seededRng = this.createSeededRng(
      `hunted:${this.currentFloor}:${spawnedSoFar}:${now}`
    );
    let spawned = 0;
    for (const anchor of anchors) {
      if (eliteCap !== Infinity && this.elitesSpawnedThisFloor >= eliteCap) {
        break;
      }
      const anchorChunk =
        this.getDungeonChunkEntryForWorldPosition(anchor.x, anchor.y) || null;
      const attemptChunks: DungeonChunkLayoutEntry[] = [];
      if (anchorChunk && this.isRoomChunk(anchorChunk)) {
        attemptChunks.push(anchorChunk);
      } else {
        const nearestRoom = this.getNearestRoomChunkToPosition(
          anchor.x,
          anchor.y
        );
        if (nearestRoom) {
          attemptChunks.push(nearestRoom);
        }
      }
      const fallbackChunk = this.pickDistinctRoomChunk(seededRng, anchorChunk);
      if (fallbackChunk) attemptChunks.push(fallbackChunk);

      let spawnedThisAnchor = false;
      for (const chunk of attemptChunks) {
        if (!chunk || !this.isRoomChunk(chunk)) continue;
        const roomTier = this.classifyRoomTier(chunk);
        const eligibleArchetypes = this.getEligibleEliteArchetypesForChunk(
          chunk,
          roomTier
        );
        if (eligibleArchetypes.length === 0) continue;
        const rng = this.createSeededRng(
          `hunted:${this.currentFloor}:${anchor.id || anchor.name}:${now}:${spawned}`
        );
        const archetype = this.pickEliteArchetype(eligibleArchetypes, rng);
        if (!archetype) continue;
        const baseChunkInfo = this.toEliteChunkInfo(chunk);
        const radiusPx = Math.max(GAME_CONFIG.TILE_SIZE * 18, 520);
        const anchorChunkInfo = {
          ...baseChunkInfo,
          anchorX: Math.max(
            0,
            Math.min(
              GAME_CONFIG.WORLD_WIDTH - radiusPx * 2,
              anchor.x - radiusPx
            )
          ),
          anchorY: Math.max(
            0,
            Math.min(
              GAME_CONFIG.WORLD_HEIGHT - radiusPx * 2,
              anchor.y - radiusPx
            )
          ),
          worldWidthPx: radiusPx * 2,
          worldHeightPx: radiusPx * 2,
          widthTiles: Math.max(
            6,
            Math.round((radiusPx * 2) / GAME_CONFIG.TILE_SIZE)
          ),
          heightTiles: Math.max(
            6,
            Math.round((radiusPx * 2) / GAME_CONFIG.TILE_SIZE)
          ),
        };
        const margin = GAME_CONFIG.TILE_SIZE * 2;
        const primaryRadius = 300;
        const baseAngle = rng() * Math.PI * 2;
        const baseR = primaryRadius * (0.6 + rng() * 0.4); // 60–100% of radius
        const offsetBase = {
          x: anchor.x + Math.cos(baseAngle) * baseR,
          y: anchor.y + Math.sin(baseAngle) * baseR,
        };
        const basePoint = this.clampPointToChunk(
          anchorChunkInfo,
          offsetBase.x,
          offsetBase.y,
          margin
        );
        const candidates: Array<{ x: number; y: number }> = [basePoint];
        const baseRadius = primaryRadius;
        for (let i = 0; i < 3; i++) {
          const angle = rng() * Math.PI * 2;
          const r = baseRadius * (0.4 + rng() * 0.8); // 40–120% of radius
          candidates.push(
            this.clampPointToChunk(
              anchorChunkInfo,
              anchor.x + Math.cos(angle) * r,
              anchor.y + Math.sin(angle) * r,
              margin
            )
          );
        }
        let spawnResult = sysSpawnEliteGroup(this as any, {
          chunk: anchorChunkInfo,
          archetype,
          rng,
          roomTier,
          leaderPositionHint: candidates.shift(),
        });
        if (!spawnResult) {
          for (const alt of candidates) {
            const altResult = sysSpawnEliteGroup(this as any, {
              chunk: anchorChunkInfo,
              archetype,
              rng,
              roomTier,
              leaderPositionHint: alt,
            });
            if (altResult) {
              spawnResult = altResult;
              break;
            }
          }
        }
        if (!spawnResult) continue;
        // Apply per-wave scaling
        this.applyHuntedStatScaling(
          spawnResult.leader,
          hpMultiplier,
          dmgMultiplier,
          speedMultiplier,
          minSpeed
        );
        for (const minion of spawnResult.minions) {
          this.applyHuntedStatScaling(
            minion,
            hpMultiplier,
            dmgMultiplier,
            speedMultiplier,
            minSpeed
          );
        }
        // Solo mode: remove minions to keep perf in check
        if (huntedConfig.soloHunterMode && spawnResult.minions.length > 0) {
          for (const minion of spawnResult.minions) {
            try {
              if (this.state.enemies.has(minion.id)) {
                this.state.enemies.delete(minion.id);
              }
            } catch {}
          }
          spawnResult.minions = [];
        }
        const targetPlayerId = anchor?.id || anchor?.name || '';
        this.applyHuntedAggro(
          spawnResult.leader,
          spawnResult.minions,
          targetPlayerId,
          now
        );
        const anchorPos = { x: anchor.x, y: anchor.y };
        const dx = spawnResult.leader.x - anchor.x;
        const dy = spawnResult.leader.y - anchor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        console.log(
          `[HUNTED] Spawned elite group ${archetype.id} in chunk (${chunk.x},${chunk.y}) tier=${roomTier} at (${spawnResult.leader.x.toFixed(1)},${spawnResult.leader.y.toFixed(1)}) near anchor (${anchorPos.x.toFixed(1)},${anchorPos.y.toFixed(1)}) dist=${dist.toFixed(1)} (anchorChunk=${anchorChunk ? `${anchorChunk.x},${anchorChunk.y}` : 'none'})`
        );
        this.registerEliteGroupSpawn(
          chunk,
          spawnResult,
          archetype,
          roomTier,
          'hunted',
          now
        );
        spawned += 1;
        spawnedThisAnchor = true;
        break;
      }
      if (!spawnedThisAnchor) {
        continue;
      }
      if (spawned >= targetPacks) {
        break;
      }
    }

    return spawned;
  }

  private updateHunted(now: number): void {
    const huntedConfig = (GAME_CONFIG as any).hunted || {};
    if (!huntedConfig || huntedConfig.enabled === false) {
      this.state.huntedEnabled = false;
      this.state.huntedIntensityLevel = 0;
      this.state.huntedNextSpawnAt = 0;
      return;
    }

    const bossActive = Boolean((this as any).bossEncounterActive);
    if (this.phase !== 'in_game' || bossActive) {
      this.state.huntedEnabled = false;
      this.state.huntedIntensityLevel = 0;
      this.state.huntedNextSpawnAt = 0;
      return;
    }

    if (this.isRoomTransitioning || this.state.players.size === 0) {
      this.state.huntedEnabled = false;
      this.state.huntedNextSpawnAt = 0;
      return;
    }

    if (!this.state.huntedFloorStartedAt) {
      this.resetHuntedForNewFloor(now);
    }

    this.state.huntedEnabled = true;
    const floorStartedAt =
      this.state.huntedFloorStartedAt || this.state.startedAt || now;
    const elapsedMs = Math.max(0, now - floorStartedAt);
    const wavesSpawned = Math.max(
      0,
      Number(this.state.huntedGroupsSpawnedThisFloor) || 0
    );
    const intensityLevel = this.computeHuntedIntensityLevel(
      elapsedMs,
      huntedConfig,
      wavesSpawned
    );
    this.state.huntedIntensityLevel = intensityLevel;

    if (intensityLevel <= 0) {
      const graceMs = Math.max(
        0,
        Number(huntedConfig.floorGracePeriodMs) || 180_000
      );
      const nextAt = floorStartedAt + graceMs;
      if (this.state.huntedNextSpawnAt <= 0) {
        this.state.huntedNextSpawnAt = nextAt;
      }
      return;
    }

    const maxPerFloor = Math.max(
      0,
      Number(huntedConfig.maxHuntedGroupsPerFloor) || 0
    );
    const spawnedSoFar = Math.max(
      0,
      Number(this.state.huntedGroupsSpawnedThisFloor) || 0
    );
    if (maxPerFloor > 0 && spawnedSoFar >= maxPerFloor) {
      this.state.huntedEnabled = false;
      this.state.huntedNextSpawnAt = 0;
      return;
    }

    const eliteCap = this.getHuntedEliteCap();
    if (eliteCap !== Infinity && this.elitesSpawnedThisFloor >= eliteCap) {
      this.state.huntedEnabled = false;
      this.state.huntedNextSpawnAt = 0;
      return;
    }

    if (this.state.huntedNextSpawnAt <= 0) {
      this.state.huntedNextSpawnAt =
        now + this.getHuntedSpawnIntervalMs(wavesSpawned, huntedConfig);
      return;
    }

    if (now < this.state.huntedNextSpawnAt) {
      return;
    }

    const packsThisWave = this.getHuntedPacksPerWave(
      intensityLevel,
      Math.max(1, Number(huntedConfig.maxConcurrentHuntedGroups) || 1)
    );
    const spawned = this.spawnHuntedEliteWave(
      packsThisWave,
      now,
      intensityLevel
    );
    if (spawned > 0) {
      this.state.huntedGroupsSpawnedThisFloor = spawnedSoFar + spawned;
      this.huntedLastSpawnAt = now;
      try {
        this.emitMatchEvent('hunted_spawn', {
          floorIndex: this.state.currentFloor,
          intensity: intensityLevel,
          packs: spawned,
          elapsedMs,
        });
      } catch {}
    }

    this.state.huntedNextSpawnAt =
      now +
      this.getHuntedSpawnIntervalMs(
        Math.max(0, Number(this.state.huntedGroupsSpawnedThisFloor) || 0),
        huntedConfig
      );
  }

  private applyDungeonLayoutToState() {
    this.state.entities.clear();
    for (const blueprint of this.dungeonEntityBlueprints) {
      const entity = new EntitySchema();
      entity.id = blueprint.id;
      entity.kind = blueprint.kind;
      entity.x = blueprint.x;
      entity.y = blueprint.y;
      entity.state = blueprint.state;
      this.state.entities.set(entity.id, entity);
    }
  }

  private computeDungeonGroupSpawnAnchor(): { x: number; y: number } {
    try {
      if (
        this.mapGenerator &&
        typeof this.mapGenerator.getSpawnPoints === 'function'
      ) {
        let pts: Array<{ x: number; y: number }> =
          this.mapGenerator.getSpawnPoints();
        // If a preferred chunk is requested, bias anchor to a spawn inside it
        try {
          if (
            this.preferredChunkName &&
            typeof this.mapGenerator.getChunkPixelSize === 'function'
          ) {
            const { widthPx, heightPx } = this.mapGenerator.getChunkPixelSize();
            const layout = this.chunkLayoutData || [];
            const preferred = pts.filter((pt) => {
              const gx = Math.floor(pt.x / Math.max(1, widthPx));
              const gy = Math.floor(pt.y / Math.max(1, heightPx));
              const cell = layout.find((c) => c.x === gx && c.y === gy);
              return cell && cell.chunkName === this.preferredChunkName;
            });
            if (preferred.length > 0) {
              pts = preferred;
            }
          }
        } catch {}
        if (Array.isArray(pts) && pts.length > 0) {
          const cx = GAME_CONFIG.WORLD_WIDTH / 2;
          const cy = GAME_CONFIG.WORLD_HEIGHT / 2;
          let best = pts[0];
          let bestD2 =
            (best.x - cx) * (best.x - cx) + (best.y - cy) * (best.y - cy);
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i];
            const d2 = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
            if (d2 < bestD2) {
              best = p;
              bestD2 = d2;
            }
          }
          // Nudge to a safe nearby spot if necessary
          const clamp = (v: number, min: number, max: number) =>
            Math.max(min, Math.min(max, v));
          const collisionRadius = 40;
          let ax = clamp(best.x, 50, GAME_CONFIG.WORLD_WIDTH - 50);
          let ay = clamp(best.y, 50, GAME_CONFIG.WORLD_HEIGHT - 50);
          if (
            mapCheckObstacleCollision(this as any, ax, ay, collisionRadius) ||
            !isOnFloor(this as any, ax, ay)
          ) {
            let attempts = 0;
            const maxAttempts = 18;
            const offsetDistance = 56;
            while (
              (mapCheckObstacleCollision(
                this as any,
                ax,
                ay,
                collisionRadius
              ) ||
                !isOnFloor(this as any, ax, ay)) &&
              attempts < maxAttempts
            ) {
              const angle = (attempts / maxAttempts) * Math.PI * 2;
              ax = clamp(
                best.x + Math.cos(angle) * offsetDistance,
                50,
                GAME_CONFIG.WORLD_WIDTH - 50
              );
              ay = clamp(
                best.y + Math.sin(angle) * offsetDistance,
                50,
                GAME_CONFIG.WORLD_HEIGHT - 50
              );
              attempts += 1;
            }
          }
          return { x: ax, y: ay };
        }
      }
    } catch {}
    throw new Error(
      'GameRoom: No authored player spawn points available to compute group spawn anchor.'
    );
  }

  public spawnEnemyOfType(
    enemyType: string,
    forcePosition?: { x: number; y: number }
  ) {
    return sysSpawnEnemyOfType(this as any, enemyType, forcePosition);
  }

  // Removed Portal Guardian spawn timer helpers and scheduling

  private async spawnInitialDungeonPopulation() {
    if (this.hasSpawnedDungeonPopulation) {
      return;
    }
    this.hasSpawnedDungeonPopulation = true;

    // Lazily generate dungeon layout if not prepared (staging defers generation)
    if (
      !this.dungeonEntityBlueprints ||
      this.dungeonEntityBlueprints.length === 0 ||
      !this.dungeonChunkLayoutData ||
      this.dungeonChunkLayoutData.length === 0
    ) {
      await this.generateDungeonLayout(this.state.difficultyTier);
    }

    this.state.enemies = new MapSchema<EnemySchema>();
    this.state.npcs = new MapSchema<NPCSchema>();
    this.state.projectiles = new MapSchema<ProjectileSchema>();
    this.applyDungeonLayoutToState();
    this.resetHuntedForNewFloor(this.now || Date.now());

    // Prepare a fresh group spawn anchor for this floor
    this.dungeonGroupSpawnAnchor = this.computeDungeonGroupSpawnAnchor();

    if (this.initialEnemySpawns.length > 0) {
      console.log(
        `🏰 Staging -> Dungeon: spawning ${this.initialEnemySpawns.length} fortress enemies`
      );
      this.initialEnemySpawns.forEach((spawn) => {
        this.spawnEnemyOfType(spawn.type, { x: spawn.x, y: spawn.y });
      });
    }

    const initialEnemyCount = INITIAL_ENEMY_COUNT;
    console.log(
      `⚔️ Staging -> Dungeon: spawning ${initialEnemyCount} roaming enemies`
    );
    for (let i = 0; i < initialEnemyCount; i++) {
      this.spawnEnemyOfType(this.getRandomEnemyType());
    }

    this.spawnElitesForDungeon();

    // Always ensure Stani is spawned near the party anchor for this floor,
    // overriding any chunk-placed Stani.
    try {
      const anchor = this.dungeonGroupSpawnAnchor ||
        this.computeDungeonGroupSpawnAnchor() || {
          x: GAME_CONFIG.WORLD_WIDTH / 2,
          y: GAME_CONFIG.WORLD_HEIGHT / 2,
        };
      this.spawnNPCsNearAnchor(anchor);
    } catch (error) {
      console.warn('Failed to spawn NPCs near party anchor', error);
      this.spawnNPCs();
    }

    this.chunkLayoutData = this.dungeonChunkLayoutData.map((layout) => ({
      x: layout.x,
      y: layout.y,
      chunkName: layout.chunkName,
    }));

    this.msg.broadcast('chunk_layout_update', {
      chunkLayout: this.chunkLayoutData,
      difficultyTier: this.state.difficultyTier,
      phase: this.state.phase,
    });

    if (this.phase === 'in_game') {
      try {
        spawnFloorPortals(this as any, {
          floorIndex: this.currentFloor > 0 ? this.currentFloor : 1,
        });
      } catch (error) {
        console.warn(
          'Failed to spawn floor portals during dungeon initialization',
          error
        );
      }
    }

    // Removed Portal Guardian spawn scheduling
  }

  private applyRequestedDifficultyTier(requestedTier: string) {
    const normalized = String(requestedTier || '')
      .trim()
      .toLowerCase();
    if (!normalized) {
      return false;
    }

    const tier = getDifficultyTier(normalized);
    if (!tier) {
      console.warn('Ignoring unknown difficulty tier request', {
        requestedTier,
      });
      return false;
    }

    if (normalized === this.state.difficultyTier) {
      return false;
    }

    console.log('🎚️ Applying requested difficulty tier', {
      from: this.state.difficultyTier,
      to: normalized,
    });

    this.state.difficultyTier = normalized;
    this.generateDungeonLayout(normalized);
    this.hasSpawnedDungeonPopulation = false;

    if (this.stagingEnabled && this.phase !== 'in_game') {
      this.initializeStagingEnvironment();
    } else {
      this.spawnInitialDungeonPopulation();
    }

    this.updateMetadata({ difficultyTier: normalized });
    this.persistGameMetrics({ syncState: true });

    return true;
  }

  private initializeStagingEnvironment() {
    stagingInitializeStagingEnvironment(this as any, PORTAL_START_COUNTDOWN_MS);
  }

  private scheduleStagingAutoClose(deadlineMs: number) {
    stagingScheduleStagingAutoClose(this as any, deadlineMs);
  }

  public clearStagingAutoCloseTimer() {
    stagingClearStagingAutoCloseTimer(this as any);
  }

  private trackEntryFeeCharge(
    playerId: string,
    amountCents: number,
    chargedAtIso: string | null,
    refundable: boolean
  ) {
    stagingTrackEntryFeeCharge(
      this as any,
      playerId,
      amountCents,
      chargedAtIso,
      refundable
    );
  }

  public markEntryFeesNonRefundable() {
    stagingMarkEntryFeesNonRefundable(this as any);
  }

  public setPhase(
    nextPhase: RoomPhase,
    options: {
      countdownEndsAt?: number;
      startedByPlayerId?: string | null;
      lateJoinCutoffAt?: number;
      autoCloseAt?: number | null;
      runStartedAt?: number | null;
    } = {}
  ) {
    const previousPhase = this.phase;
    let phaseChanged = false;
    if (previousPhase !== nextPhase) {
      this.phase = nextPhase;
      this.state.phase = nextPhase;
      this.phaseChangedAt = Date.now();
      phaseChanged = true;
      if (phaseChanged && nextPhase === 'in_game') {
        this.resetScoreTrackingForRun();
        this.currentFloor = 1;
        this.floorReached = this.currentFloor;
        this.state.currentFloor = this.currentFloor;
        this.state.floorReached = this.floorReached;
        this.resetHuntedForNewFloor(this.now || Date.now());
      } else if (
        phaseChanged &&
        SCORE_CONFIG.enabled &&
        nextPhase !== 'in_game'
      ) {
        this.pendingScoreDeltas.clear();
      }
      if (phaseChanged && nextPhase !== 'in_game') {
      }
    }

    if (options.countdownEndsAt !== undefined) {
      this.state.countdownEndsAt = options.countdownEndsAt;
    } else if (nextPhase !== 'countdown') {
      this.state.countdownEndsAt = 0;
    }

    if (options.startedByPlayerId !== undefined) {
      this.state.startedByPlayerId = options.startedByPlayerId ?? '';
    } else if (phaseChanged && nextPhase !== 'countdown') {
      // keep existing startedByPlayerId unless explicitly cleared
      if (nextPhase !== 'in_game') {
        this.state.startedByPlayerId = '';
      }
    }

    if (options.lateJoinCutoffAt !== undefined) {
      this.state.lateJoinCutoffAt = options.lateJoinCutoffAt;
    } else if (nextPhase !== 'in_game') {
      this.state.lateJoinCutoffAt = 0;
    }

    if (options.autoCloseAt !== undefined) {
      this.state.autoCloseAt = options.autoCloseAt ?? 0;
    }

    if (options.runStartedAt !== undefined) {
      this.runStartedAt = options.runStartedAt;
      this.state.runStartedAt = options.runStartedAt ?? 0;
    } else if (nextPhase !== 'in_game') {
      this.runStartedAt = null;
      this.state.runStartedAt = 0;
    }

    this.persistGameMetrics({ syncState: true });
    this.updateMetadata();

    if (phaseChanged) {
      if (nextPhase === 'in_game') {
        this.resetEnemyDifficultyMeter();
        this.enableFogForClients({ broadcast: true, reset: true });
        this.state.players.forEach((player, sessionId) => {
          const profile = this.ensureKillStreakForPlayer(sessionId, player, {
            reset: true,
            sendProfile: true,
          });
          if (profile) {
            this.applyProgressionToPlayer(sessionId, { fullHeal: true });
          }
        });
        void this.applyHighStakesAttunementsForRun();
      } else {
        if (previousPhase === 'in_game') {
          this.resetKillStreakForAllPlayers({ reason: 'run_end' });
          // Finalize per-game debug logs into a single shard on run end
          if (this.currentGameId) {
            void flushGameLogs(this.currentGameId, 'manual');
          }
        }
        this.suspendEnemyDifficultyMeter({ resetLevel: true });
        this.disableFogForClients({ broadcast: true });
        this.state.huntedEnabled = false;
        this.state.huntedIntensityLevel = 0;
        this.state.huntedNextSpawnAt = 0;
        this.state.huntedFloorStartedAt = 0;
        this.state.huntedGroupsSpawnedThisFloor = 0;
        this.huntedLastSpawnAt = 0;
      }
    }
  }

  private async refundEntryFee(
    playerId: string,
    reason: 'timeout' | 'manual' | 'disconnect',
    extraMetadata: Record<string, unknown> = {}
  ): Promise<boolean> {
    return await stagingRefundEntryFee(
      this as any,
      playerId,
      reason,
      extraMetadata
    );
  }

  public scheduleLateJoinCutoff(deadlineMs: number) {
    stagingScheduleLateJoinCutoff(this as any, deadlineMs);
  }

  public clearLateJoinTimer() {
    stagingClearLateJoinTimer(this as any);
  }

  public getRandomEnemyType(): string {
    return sysGetRandomEnemyType();
  }

  public isOnRoad(x: number, y: number): boolean {
    // Road runs horizontally across the center of the screen
    const roadCenterY = GAME_CONFIG.WORLD_HEIGHT / 2; // Center of world height
    const roadWidth = 60; // 60 pixels wide road

    return y >= roadCenterY - roadWidth / 2 && y <= roadCenterY + roadWidth / 2;
  }

  public setPlayerSpawnPosition(player: PlayerSchema) {
    if (this.stagingEnabled && this.phase !== 'in_game') {
      const fallbackCenterX = GAME_CONFIG.WORLD_WIDTH / 2;
      const fallbackCenterY = GAME_CONFIG.WORLD_HEIGHT / 2 + 140;
      const fallbackOffsets = [
        { x: -140, y: 0 },
        { x: 0, y: 40 },
        { x: 140, y: 0 },
      ];
      const spawnPoints =
        this.stagingSpawnPoints.length > 0
          ? this.stagingSpawnPoints
          : fallbackOffsets.map((offset) => ({
              x: fallbackCenterX + offset.x,
              y: fallbackCenterY + offset.y,
            }));
      const index = Math.min(
        this.state.players.size,
        Math.max(spawnPoints.length - 1, 0)
      );
      const spawn = spawnPoints[index] ?? spawnPoints[0];
      player.x = spawn.x;
      player.y = spawn.y;
      player.dir = 'up';
      player.onRoad = false;
      console.log(
        `🎯 Staging spawn for ${player.name} at (${Math.floor(
          player.x
        )}, ${Math.floor(player.y)})`
      );
      return;
    }
    // Dungeon: group players tightly around a shared anchor per floor
    const anchor =
      this.dungeonGroupSpawnAnchor ||
      (this.dungeonGroupSpawnAnchor = this.computeDungeonGroupSpawnAnchor());

    const ids = Array.from(this.state.players.keys()).sort();
    const idx = Math.max(0, ids.indexOf(player.id));
    const total = Math.max(1, ids.length);

    // Arrange players in small rings around the anchor (8 per ring)
    const ringIndex = Math.floor(idx / 8);
    const withinRingIndex = idx % 8;
    const baseRadius = 60; // px
    const radius = baseRadius + ringIndex * 48;
    const angle = (withinRingIndex / 8) * Math.PI * 2;
    let targetX = anchor.x + Math.cos(angle) * radius;
    let targetY = anchor.y + Math.sin(angle) * radius;

    // Finalize with safety checks and gentle spiral nudge if needed
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));
    const collisionRadius = 40;
    const maxAttempts = 18;
    let attempts = 0;
    const nudge = Math.max(36, radius * 0.4);
    while (
      attempts < maxAttempts &&
      (mapCheckObstacleCollision(
        this as any,
        targetX,
        targetY,
        collisionRadius
      ) ||
        !isOnFloor(this as any, targetX, targetY))
    ) {
      const a = (attempts / maxAttempts) * Math.PI * 2;
      targetX = anchor.x + Math.cos(a) * nudge;
      targetY = anchor.y + Math.sin(a) * nudge;
      attempts += 1;
    }

    if (
      attempts >= maxAttempts &&
      (mapCheckObstacleCollision(
        this as any,
        targetX,
        targetY,
        collisionRadius
      ) ||
        !isOnFloor(this as any, targetX, targetY))
    ) {
      // As a last resort, fall back to default system spawn
      sysSetPlayerSpawnPosition(this as any, player);
      return;
    }

    player.x = clamp(targetX, 50, GAME_CONFIG.WORLD_WIDTH - 50);
    player.y = clamp(targetY, 50, GAME_CONFIG.WORLD_HEIGHT - 50);
    player.dir = 'down';
    console.log(
      `🎯 Dungeon spawn for ${player.name} at (${Math.floor(
        player.x
      )}, ${Math.floor(player.y)}) anchor=(${Math.floor(
        this.dungeonGroupSpawnAnchor?.x ?? targetX
      )}, ${Math.floor(this.dungeonGroupSpawnAnchor?.y ?? targetY)})`
    );
  }

  private getHandWeaponEntriesForPlayer(
    player: PlayerSchema
  ): Array<{ slot: 'handLeft' | 'handRight'; slug: string }> {
    const derived = safeParseJson<any>(player.derivedStats, null);
    if (!derived) {
      return [];
    }

    const weaponsSource = Array.isArray(derived.weapons) ? derived.weapons : [];
    const equipmentItems = Array.isArray(derived.equipment?.items)
      ? derived.equipment.items
      : [];

    const entries: Array<{ slot: 'handLeft' | 'handRight'; slug: string }> = [];
    const usedSlots = new Set<'handLeft' | 'handRight'>();

    for (const weapon of weaponsSource) {
      if (
        !weapon ||
        (weapon.weaponType !== 'melee' && weapon.weaponType !== 'ranged')
      ) {
        continue;
      }
      const slug =
        typeof weapon.slug === 'string'
          ? weapon.slug
          : String(weapon.slug ?? '');
      if (!slug) continue;
      const equipment = equipmentItems.find(
        (item: any) => item && item.slug === slug
      );
      const slotRaw = equipment?.slot as 'handLeft' | 'handRight' | undefined;
      if (slotRaw === 'handLeft' || slotRaw === 'handRight') {
        usedSlots.add(slotRaw);
        entries.push({ slot: slotRaw, slug });
      }
    }

    entries.sort((a, b) =>
      a.slot === b.slot ? 0 : a.slot === 'handLeft' ? -1 : 1
    );

    return entries;
  }

  private resolveCurrentHandWeaponIndex(
    player: PlayerSchema,
    weapons: Array<{ slot: 'handLeft' | 'handRight'; slug: string }>
  ): number {
    return resolvePreferredHandWeaponIndex(player.activeWeaponIndex, weapons);
  }

  private selectActiveWeaponByIndex(
    player: PlayerSchema,
    weapons: Array<{ slot: 'handLeft' | 'handRight'; slug: string }>,
    index: number
  ) {
    if (weapons.length === 0) {
      player.activeWeaponIndex = -1;
      syncPlayerCharacterStats(player, {
        fullHeal: false,
        preserveHealthRatio: true,
      });
      return;
    }
    const boundedIndex = Math.max(0, Math.min(index, weapons.length - 1));
    player.activeWeaponIndex = boundedIndex;
    syncPlayerCharacterStats(player, {
      fullHeal: false,
      preserveHealthRatio: true,
    });
  }

  private handleWeaponCycle(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const weapons = this.getHandWeaponEntriesForPlayer(player);
    if (weapons.length === 0) {
      this.selectActiveWeaponByIndex(player, weapons, -1);
      return;
    }

    const currentIndex = this.resolveCurrentHandWeaponIndex(player, weapons);
    const nextIndex =
      weapons.length <= 1 ? currentIndex : (currentIndex + 1) % weapons.length;

    this.selectActiveWeaponByIndex(player, weapons, nextIndex);
    client.send('weapon_switched', {
      attackType: player.attackType,
      activeIndex: player.activeWeaponIndex,
    });
  }

  private handleSetActiveWeapon(client: Client, data: { index?: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const weapons = this.getHandWeaponEntriesForPlayer(player);
    if (weapons.length === 0) {
      this.selectActiveWeaponByIndex(player, weapons, -1);
      return;
    }

    const requested =
      data && typeof data.index === 'number' && Number.isFinite(data.index)
        ? Math.floor(data.index)
        : 0;
    const boundedIndex = Math.max(0, Math.min(requested, weapons.length - 1));
    const currentIndex = this.resolveCurrentHandWeaponIndex(player, weapons);
    if (boundedIndex === currentIndex) {
      return;
    }

    this.selectActiveWeaponByIndex(player, weapons, boundedIndex);
    client.send('weapon_switched', {
      attackType: player.attackType,
      activeIndex: player.activeWeaponIndex,
    });
  }

  public getFogVisionRadiusTiles(): number {
    return DEFAULT_VISION_RADIUS_TILES;
  }

  private handleHealPlayer(client: Client, data: { healAmount: number }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.hp <= 0) return;

    // Validate heal amount (prevent cheating). Clamp to our potion cap.
    const maxHealAmount = computeHealthPotionHeal(player.maxHp);
    const healAmount = Math.min(
      Math.max(0, Math.floor(Number(data.healAmount) || 0)),
      maxHealAmount
    );

    // Calculate new HP (don't exceed max HP)
    const oldHp = player.hp;
    player.hp = Math.min(player.hp + healAmount, player.maxHp);
    const actualHealed = player.hp - oldHp;

    console.log(
      `Player ${player.id} healed for ${actualHealed} HP (${oldHp} -> ${player.hp})`
    );

    // Broadcast healing effect to all clients (including the healer)
    this.msg.broadcast('player_healed', {
      playerId: client.sessionId,
      healAmount: actualHealed,
      currentHp: player.hp,
      maxHp: player.maxHp,
    });
  }

  private handleUseManaPotion(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.hp <= 0) return;

    if (player.maxMana <= 0) {
      return;
    }

    if (player.mana >= player.maxMana) {
      return;
    }

    const inventory = this.playerInventories.get(client.sessionId);
    if (!inventory || inventory.length === 0) {
      return;
    }

    const potion = inventory.find((item) => {
      if (!item) return false;
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return false;
      const type = String(item.type ?? item.itemType ?? '').toLowerCase();
      if (type !== 'potion') return false;
      const name = String(item.name ?? item.itemType ?? '').toLowerCase();
      return name.includes('mana');
    });

    if (!potion) {
      return;
    }

    const previousMana = Math.max(0, Number(player.mana) || 0);
    const restoreAmount = computeManaPotionRestore(player.maxMana);
    const nextMana = Math.min(player.maxMana, previousMana + restoreAmount);
    const restored = nextMana - previousMana;
    if (restored <= 0) {
      return;
    }

    player.mana = nextMana;

    void this.applyInventoryDelta(client.sessionId, potion, -1);

    this.msg.broadcast('player_mana_restored', {
      playerId: client.sessionId,
      manaAmount: restored,
      currentMana: player.mana,
      maxMana: player.maxMana,
    });
  }

  private handleUseHealthPotion(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (player.hp <= 0) return;

    // Already at full HP
    if (player.hp >= player.maxHp) {
      return;
    }

    const inventory = this.playerInventories.get(client.sessionId);
    if (!inventory || inventory.length === 0) {
      return;
    }

    const potion = inventory.find((item) => {
      if (!item) return false;
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return false;
      const type = String(
        item.type ?? (item as any).itemType ?? ''
      ).toLowerCase();
      if (type !== 'potion') return false;
      const name = String(
        (item as any).name ?? (item as any).itemType ?? ''
      ).toLowerCase();
      return name.includes('health');
    });

    if (!potion) {
      return;
    }

    const healAmount = computeHealthPotionHeal(player.maxHp);
    const previousHp = Math.max(0, player.hp);
    const nextHp = Math.min(player.maxHp, previousHp + Math.floor(healAmount));
    const actualHealed = Math.max(0, nextHp - previousHp);

    if (actualHealed <= 0) {
      return;
    }

    player.hp = nextHp;

    void this.applyInventoryDelta(client.sessionId, potion, -1);

    this.msg.broadcast('player_healed', {
      playerId: client.sessionId,
      healAmount: actualHealed,
      currentHp: player.hp,
      maxHp: player.maxHp,
      source: 'potion',
    });
  }

  public tryAutoHeal(player: PlayerSchema): boolean {
    if (!player || player.isBot || player.hp > 0) {
      return false;
    }

    const sessionId = player.id;
    if (!sessionId) {
      return false;
    }

    const inventory = this.playerInventories.get(sessionId);
    if (!inventory || inventory.length === 0) {
      return false;
    }

    const potion = inventory.find((item) => {
      if (!item) return false;
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return false;
      const type = String(item.type ?? item.itemType ?? '').toLowerCase();
      if (type !== 'potion') return false;
      const name = String(item.name ?? '').toLowerCase();
      return name.includes('health');
    });

    if (!potion) {
      return false;
    }

    const healAmount = computeHealthPotionHeal(player.maxHp);
    const previousHp = Math.max(0, player.hp);
    const nextHp = Math.max(
      1,
      Math.min(player.maxHp, previousHp + Math.floor(healAmount))
    );

    if (nextHp <= previousHp) {
      return false;
    }

    player.hp = nextHp;
    const actualHealed = nextHp - previousHp;

    void this.applyInventoryDelta(sessionId, potion, -1);

    this.msg.broadcast('player_healed', {
      playerId: sessionId,
      healAmount: actualHealed,
      currentHp: player.hp,
      maxHp: player.maxHp,
      source: 'auto_heal',
    });

    return true;
  }

  public tryAutoRestoreMana(player: PlayerSchema): boolean {
    if (!player || player.isBot) {
      return false;
    }
    if (player.maxMana <= 0) {
      return false;
    }
    if (player.mana > 0) {
      return false;
    }

    const sessionId = player.id;
    if (!sessionId) {
      return false;
    }

    const inventory = this.playerInventories.get(sessionId);
    if (!inventory || inventory.length === 0) {
      return false;
    }

    const potion = inventory.find((item) => {
      if (!item) return false;
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return false;
      const type = String(
        item.type ?? (item as any).itemType ?? ''
      ).toLowerCase();
      if (type !== 'potion') return false;
      const name = String(
        (item as any).name ?? (item as any).itemType ?? ''
      ).toLowerCase();
      return name.includes('mana');
    });

    if (!potion) {
      return false;
    }

    const previousMana = Math.max(0, Number(player.mana) || 0);
    const restoreAmount = computeManaPotionRestore(player.maxMana);
    const nextMana = Math.min(player.maxMana, previousMana + restoreAmount);
    const restored = nextMana - previousMana;
    if (restored <= 0) {
      return false;
    }

    player.mana = nextMana;

    void this.applyInventoryDelta(sessionId, potion, -1);

    this.msg.broadcast('player_mana_restored', {
      playerId: sessionId,
      manaAmount: restored,
      currentMana: player.mana,
      maxMana: player.maxMana,
      source: 'auto_mana',
    });

    return true;
  }

  public async applyInventoryDelta(
    sessionId: string,
    rawItem: InventoryItemPayload,
    delta: number,
    options: { entityId?: string | null; distributionId?: string | null } = {}
  ) {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }

    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      return;
    }

    const sanitizedItem = sanitizeInventoryPayloads([rawItem])[0];
    if (!sanitizedItem) {
      return;
    }

    let distributionId = options.distributionId ?? null;
    let distributionMetadata: Record<string, unknown> | null = null;
    let lootSource = options.entityId ? 'enemy_drop' : 'inventory_delta';
    let mappedPlayerId: string | null = null;

    if (!distributionId && options.entityId) {
      const mapping = this.entityLootDistributions.get(options.entityId);
      if (mapping) {
        distributionId = mapping.distributionId;
        distributionMetadata = mapping.metadata ?? null;
        lootSource = mapping.source ?? lootSource;
        mappedPlayerId = mapping.playerId ?? null;

        if (mapping.timeout) {
          clearTimeout(mapping.timeout);
        }
        this.entityLootDistributions.delete(options.entityId);
      }
    }

    const normalizedType = String(
      sanitizedItem.type ?? sanitizedItem.itemType ?? 'unknown'
    ).toLowerCase();
    const isWearable = normalizedType === 'wearable';

    const resolvedDelta = isWearable
      ? delta > 0
        ? Math.max(1, Math.floor(delta))
        : Math.min(-1, Math.ceil(delta))
      : delta;

    if (!Number.isFinite(resolvedDelta) || resolvedDelta === 0) {
      return;
    }

    const previous = this.playerInventories.get(sessionId) || [];
    const wearableEvents: Array<{
      record: PlayerInventoryRecord;
      delta: number;
      reason: string;
      metadata?: Record<string, unknown>;
    }> = [];

    let next: InventoryItemPayload[];

    if (isWearable) {
      const unitsToProcess = Math.abs(resolvedDelta);
      const targetSlugRaw =
        sanitizedItem.wearableSlug ??
        sanitizedItem.itemName ??
        sanitizedItem.name ??
        '';
      const wearableSlug = String(targetSlugRaw || '').trim();
      if (!wearableSlug) {
        console.warn('Wearable slug missing for inventory delta', {
          sessionId,
          playerId,
          rawItem,
        });
        return;
      }

      const allowedQualities = new Set([
        'broken',
        'budget',
        'average',
        'excellent',
        'flawless',
      ]);
      const resolveQuality = (
        quality: unknown
      ): 'broken' | 'budget' | 'average' | 'excellent' | 'flawless' => {
        const lowered =
          typeof quality === 'string' ? quality.toLowerCase() : '';
        return allowedQualities.has(lowered as any)
          ? (lowered as
              | 'broken'
              | 'budget'
              | 'average'
              | 'excellent'
              | 'flawless')
          : 'average';
      };
      const resolveDurability = (value: unknown) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
          return 1000;
        }
        return Math.max(1, Math.min(1000, Math.floor(numeric)));
      };

      if (resolvedDelta > 0) {
        const createdItems: InventoryItemPayload[] = [];
        const reason = options.entityId ? 'pickup' : 'server_delta';
        for (let index = 0; index < unitsToProcess; index += 1) {
          const {
            inventoryItemId: _ignored,
            id: _ignoredId,
            quantity: _ignoredQty,
            ...dataForStorage
          } = sanitizedItem;
          const record = await inventoryRepo.createInventoryInstance({
            playerId,
            wearableSlug,
            quality: resolveQuality(sanitizedItem.quality),
            qualityScore:
              typeof sanitizedItem.qualityScore === 'number'
                ? sanitizedItem.qualityScore
                : null,
            durabilityScore: resolveDurability(sanitizedItem.durabilityScore),
            itemData: {
              ...dataForStorage,
              quantity: 1,
            },
          });
          createdItems.push(inventoryRecordToItem(record));
          wearableEvents.push({
            record,
            delta: 1,
            reason,
            metadata: {
              entityId: options.entityId ?? null,
              lootDistributionId: distributionId,
            },
          });
        }
        next = sanitizeInventoryPayloads([...previous, ...createdItems]);
      } else {
        let remainingToRemove = unitsToProcess;
        const targetIdRaw =
          sanitizedItem.inventoryItemId ??
          sanitizedItem.id ??
          sanitizedItem.instanceId ??
          null;
        const targetId =
          targetIdRaw && typeof targetIdRaw === 'string' ? targetIdRaw : null;
        const targetSlug = wearableSlug.toLowerCase();
        const updated: InventoryItemPayload[] = [];

        for (const item of previous) {
          const itemType = String(
            item.type ?? item.itemType ?? 'unknown'
          ).toLowerCase();
          if (itemType !== 'wearable') {
            updated.push(item);
            continue;
          }
          if (remainingToRemove <= 0) {
            updated.push(item);
            continue;
          }

          const candidateId =
            (typeof item.inventoryItemId === 'string' &&
              item.inventoryItemId) ||
            (typeof item.id === 'string' && item.id) ||
            (typeof item.instanceId === 'string' && item.instanceId) ||
            null;
          const itemSlug = String(
            item.wearableSlug ?? item.name ?? ''
          ).toLowerCase();

          const matchesId = targetId ? candidateId === targetId : false;
          const matchesSlug =
            !targetId && targetSlug
              ? itemSlug === targetSlug
              : !targetId && !targetSlug;

          if (!matchesId && !matchesSlug) {
            updated.push(item);
            continue;
          }

          if (!candidateId) {
            updated.push(item);
            continue;
          }

          const removedRecord = await inventoryRepo.removeInventoryItemById(
            playerId,
            candidateId
          );
          if (removedRecord) {
            wearableEvents.push({
              record: removedRecord,
              delta: -1,
              reason: 'server_delta',
              metadata: {
                removedVia: 'applyInventoryDelta',
              },
            });
            remainingToRemove -= 1;
            continue;
          }

          updated.push(item);
        }

        if (remainingToRemove > 0) {
          console.warn('Requested wearable removals unavailable', {
            playerId,
            requested: unitsToProcess,
            remaining: remainingToRemove,
            targetId,
            targetSlug,
          });
        }

        next = sanitizeInventoryPayloads(updated);
      }
    } else {
      const working = previous.map((item) => ({ ...item }));
      const key = this.getInventoryKey(sanitizedItem);

      const index = working.findIndex(
        (existing) => this.getInventoryKey(existing) === key
      );
      const currentQuantity =
        index >= 0 ? Number(working[index].quantity) || 0 : 0;
      const updatedQuantity = Math.max(0, currentQuantity + resolvedDelta);

      if (updatedQuantity === 0) {
        if (index >= 0) {
          working.splice(index, 1);
        }
      } else {
        const updatedItem = { ...sanitizedItem, quantity: updatedQuantity };
        if (index >= 0) {
          working[index] = updatedItem;
        } else {
          working.push(updatedItem);
        }
      }

      next = sanitizeInventoryPayloads(working);
    }

    this.playerInventories.set(sessionId, next);

    const player = this.state.players.get(sessionId);
    if (player) {
      player.lickTongueCount = getLickTongueCount(next);
    }

    try {
      await this.logInventoryDiff(playerId, previous, next);
      await this.persistInventory(sessionId, next);
    } catch (error) {
      console.error('Failed to apply inventory delta', {
        sessionId,
        playerId,
        error,
      });
    }

    if (wearableEvents.length > 0) {
      await Promise.all(
        wearableEvents.map(async (event) => {
          try {
            await inventoryEventsRepo.logInventoryEvent({
              playerId,
              itemType: 'wearable',
              itemName: event.record.wearableSlug ?? event.record.itemName,
              delta: event.delta,
              reason: event.reason,
              gameId: this.currentGameId ?? null,
              inventoryItemId: event.record.id,
              metadata: {
                quality: event.record.quality,
                durabilityScore: event.record.durabilityScore,
                ...(event.metadata ?? {}),
              },
            });
          } catch (eventError) {
            console.error('Failed to log wearable inventory event', {
              playerId,
              inventoryItemId: event.record.id,
              delta: event.delta,
              error: eventError,
            });
          }
        })
      );
    }

    if (distributionId && resolvedDelta > 0) {
      const claimMetadata: Record<string, unknown> = {
        ...(distributionMetadata ?? {}),
        claimedByPlayerId: playerId,
        claimedBySessionId: sessionId,
        claimedQuantity: resolvedDelta,
        claimSource: lootSource,
      };

      void lootDistributionsRepo
        .markClaimed({
          id: distributionId,
          metadata: claimMetadata,
        })
        .catch((error) => {
          console.error('Failed to mark loot distribution claimed', {
            distributionId,
            playerId,
            sessionId,
            error,
          });
        });
    }

    if (
      resolvedDelta > 0 &&
      normalizedType === 'coin' &&
      options.entityId &&
      Number.isFinite(resolvedDelta) &&
      typeof sanitizedItem.usdcAmount !== 'number'
    ) {
      this.recordCoinsCollected(sessionId, resolvedDelta);
      this.logEconomyTransaction({
        playerId,
        currency: sanitizedItem.name ?? 'COIN',
        amount: resolvedDelta,
        source: lootSource,
        lootDistributionId: distributionId ?? undefined,
        metadata: {
          ...(distributionMetadata ?? {}),
          mappedPlayerId,
          quantity: resolvedDelta,
        },
      });
    }

    if (resolvedDelta > 0 && typeof sanitizedItem.usdcAmount === 'number') {
      const usdcAmount = Number(sanitizedItem.usdcAmount);
      if (Number.isFinite(usdcAmount) && usdcAmount > 0) {
        const usdcConfig = getWithdrawalTokenConfig('USDC');
        const baseUnits = parseAmountToBaseUnits(
          usdcAmount,
          usdcConfig.decimals
        );
        if (baseUnits > 0n) {
          this.recordUsdcEarned(sessionId, Number(baseUnits));
        }
        const amountString = formatBaseUnits(baseUnits, usdcConfig.decimals);
        const sharedMetadata: Record<string, unknown> = {
          ...(distributionMetadata ?? {}),
          mappedPlayerId,
          claimedQuantity: resolvedDelta,
          usdcAmount,
          usdcBaseUnits: Number(baseUnits),
          entityId: options.entityId ?? null,
          tokenDecimals: usdcConfig.decimals,
        };

        let economyTransactionId: string | null = null;
        try {
          const economyTransaction = await economyRepo.logTransaction({
            playerId,
            currency: 'USDC',
            amount: usdcAmount,
            source: lootSource,
            gameId: this.currentGameId,
            lootDistributionId: distributionId ?? undefined,
            metadata: sharedMetadata,
          });
          economyTransactionId = economyTransaction.id;
        } catch (error) {
          console.error('Failed to log USDC economy transaction', {
            playerId,
            lootSource,
            usdcAmount,
            error,
          });
        }

        if (baseUnits > 0n) {
          try {
            await tokenWithdrawalsRepo.createTokenWithdrawal({
              playerId,
              currency: 'USDC',
              amount: amountString,
              amountBaseUnits: baseUnits,
              source: lootSource,
              gameId: this.currentGameId ?? null,
              lootDistributionId: distributionId ?? undefined,
              economyTransactionId: economyTransactionId ?? undefined,
              metadata: sharedMetadata,
              chainId: usdcConfig.defaultChainId,
              tokenContractAddress: usdcConfig.tokenAddress,
            });
          } catch (error) {
            console.error('Failed to create token withdrawal record', {
              playerId,
              lootSource,
              usdcAmount,
              error,
            });
          }
        }
      }
    }

    if (resolvedDelta > 0 && typeof sanitizedItem.ghstAmount === 'number') {
      const ghstAmount = Number(sanitizedItem.ghstAmount);
      if (Number.isFinite(ghstAmount) && ghstAmount > 0) {
        const ghstConfig = getWithdrawalTokenConfig('GHST');
        const baseUnits = parseAmountToBaseUnits(
          ghstAmount,
          ghstConfig.decimals
        );
        const sharedMetadata: Record<string, unknown> = {
          ...(distributionMetadata ?? {}),
          mappedPlayerId,
          claimedQuantity: resolvedDelta,
          ghstAmount,
          ghstBaseUnits: baseUnits.toString(),
          entityId: options.entityId ?? null,
          tokenDecimals: ghstConfig.decimals,
        };

        let economyTransactionId: string | null = null;
        try {
          const economyTransaction = await economyRepo.logTransaction({
            playerId,
            currency: 'GHST',
            amount: ghstAmount,
            source: lootSource,
            gameId: this.currentGameId,
            lootDistributionId: distributionId ?? undefined,
            metadata: sharedMetadata,
          });
          economyTransactionId = economyTransaction.id;
        } catch (error) {
          console.error('Failed to log GHST economy transaction', {
            playerId,
            lootSource,
            ghstAmount,
            error,
          });
        }

        if (baseUnits > 0n) {
          const amountString = formatBaseUnits(baseUnits, ghstConfig.decimals);
          try {
            await tokenWithdrawalsRepo.createTokenWithdrawal({
              playerId,
              currency: 'GHST',
              amount: amountString,
              amountBaseUnits: baseUnits,
              source: lootSource,
              gameId: this.currentGameId ?? null,
              lootDistributionId: distributionId ?? undefined,
              economyTransactionId: economyTransactionId ?? undefined,
              metadata: sharedMetadata,
              chainId: ghstConfig.defaultChainId,
              tokenContractAddress: ghstConfig.tokenAddress,
            });
          } catch (error) {
            console.error('Failed to create GHST token withdrawal record', {
              playerId,
              lootSource,
              ghstAmount,
              error,
            });
          }
        }
      }
    }

    const client = this.getClientBySessionId(sessionId);
    if (client) {
      this.msg.sendTo(client, 'inventory_updated', { inventory: next });
    }
  }

  private buildInventoryRemovalRequests(
    payload: Record<string, unknown> | null | undefined
  ): InventoryRemoveRequest[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    if (
      typeof payload.inventoryItemId === 'string' &&
      payload.inventoryItemId.trim().length > 0
    ) {
      return [{ inventoryItemId: payload.inventoryItemId.trim() }];
    }

    const itemType =
      typeof payload.itemType === 'string' ? payload.itemType.trim() : '';
    const itemName =
      typeof payload.itemName === 'string' ? payload.itemName.trim() : '';
    if (itemType && itemName) {
      const quantityRaw = Number((payload as any).quantity);
      const quantity =
        Number.isFinite(quantityRaw) && quantityRaw > 0
          ? Math.floor(quantityRaw)
          : 1;
      return [
        {
          itemType,
          itemName,
          quantity,
        },
      ];
    }

    return [];
  }

  private applyRemovedItemsToSessionInventory(
    sessionId: string,
    removals: AppliedInventoryRemoval[]
  ): InventoryItemPayload[] {
    if (!removals.length) {
      return this.playerInventories.get(sessionId) ?? [];
    }

    const previous = this.playerInventories.get(sessionId) ?? [];
    const working = previous.map((item) => ({ ...item }));
    const toLower = (value: unknown) =>
      typeof value === 'string' ? value.toLowerCase() : '';

    for (const removal of removals) {
      if (removal.type === 'fungible') {
        const targetType = removal.itemType.toLowerCase();
        const targetName = removal.itemName.toLowerCase();
        const index = working.findIndex((entry) => {
          const entryType = toLower(entry.type ?? (entry as any).itemType);
          const entryName = toLower(entry.name ?? (entry as any).itemName);
          return entryType === targetType && entryName === targetName;
        });
        if (index < 0) {
          console.warn('Fungible removal not found in cached inventory', {
            sessionId,
            removal,
          });
          continue;
        }
        const currentQuantity = Number(working[index].quantity) || 0;
        const nextQuantity = Math.max(0, currentQuantity - removal.quantity);
        if (nextQuantity <= 0) {
          working.splice(index, 1);
        } else {
          working[index] = {
            ...working[index],
            quantity: nextQuantity,
          };
        }
      } else {
        const index = working.findIndex((entry) => {
          const candidateId =
            (typeof entry.inventoryItemId === 'string' &&
              entry.inventoryItemId) ||
            (typeof entry.id === 'string' && entry.id) ||
            (typeof entry.instanceId === 'string' && entry.instanceId) ||
            null;
          return candidateId === removal.inventoryItemId;
        });
        if (index < 0) {
          console.warn('Wearable removal not found in cached inventory', {
            sessionId,
            removal,
          });
          continue;
        }
        working.splice(index, 1);
      }
    }

    const sanitized = sanitizeInventoryPayloads(working);
    this.playerInventories.set(sessionId, sanitized);
    return sanitized;
  }

  private async handleDestroyItem(
    client: Client,
    payload: Record<string, unknown>
  ) {
    const sessionId = client.sessionId;
    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      this.msg.sendTo(client, 'inventory_remove_error', {
        code: 'UNAUTHORIZED',
        message: 'Player not linked to session',
      });
      return;
    }

    const requests = this.buildInventoryRemovalRequests(payload);
    if (requests.length === 0) {
      this.msg.sendTo(client, 'inventory_remove_error', {
        code: 'INVENTORY_INVALID_REQUEST',
        message: 'Invalid destroy request',
      });
      return;
    }

    let removals: AppliedInventoryRemoval[];
    try {
      removals = await executeInventoryRemoval(playerId, requests, {
        reason: 'destroy_user',
        metadata: {
          source: 'game_room',
          sessionId,
          roomId: this.state.id,
        },
      });
    } catch (error) {
      if (error instanceof InventoryRemovalError) {
        this.msg.sendTo(client, 'inventory_remove_error', {
          code: error.code,
          message: error.message,
          detail: error.detail ?? null,
        });
        return;
      }
      console.error('Failed to destroy inventory item', {
        sessionId,
        playerId,
        payload,
        error,
      });
      this.msg.sendTo(client, 'inventory_remove_error', {
        code: 'UNKNOWN',
        message: 'Failed to destroy item',
      });
      return;
    }

    const updatedInventory = this.applyRemovedItemsToSessionInventory(
      sessionId,
      removals
    );

    const player = this.state.players.get(sessionId);
    if (player) {
      player.lickTongueCount = getLickTongueCount(updatedInventory);
    }

    this.msg.sendTo(client, 'inventory_removed', {
      removed: removals as Array<Record<string, unknown>>,
      inventory: updatedInventory,
      action: 'destroy',
    });
  }

  private async handleDropItem(
    client: Client,
    _payload: Record<string, unknown>
  ) {
    this.msg.sendTo(client, 'inventory_remove_error', {
      code: 'NOT_IMPLEMENTED',
      message: 'Drop action not yet implemented',
    });
  }

  private async handleProgressionSync(
    client: Client,
    data: { profile?: unknown }
  ) {
    const sanitized = sanitizeProfile(
      (data?.profile as ProgressionProfile) || undefined
    );
    sanitized.lastSyncedAt = Date.now();
    this.setProgressionProfile(client.sessionId, sanitized, { persist: false });
    this.recordLevelSnapshot(client.sessionId, sanitized.level);
    this.applyProgressionToPlayer(client.sessionId, { fullHeal: true });
    await this.persistProgression(client.sessionId, sanitized);

    this.msg.sendTo(client, 'progression:profile', {
      profile: toSerializableProfile(sanitized),
      source: 'server_ack',
    });
  }

  private async allocateChestUsdcLoot(options: {
    playerId: string;
    gameId: string;
    chestId: string;
    difficultyTier: string;
    requestedAmount: number;
    probability: number;
    expectedValue: number;
    entityId: string;
  }): Promise<ChestLootAllocation | null> {
    const requestedAmountRaw = Number(options.requestedAmount);
    if (!Number.isFinite(requestedAmountRaw) || requestedAmountRaw <= 0) {
      return null;
    }

    const probability = Number.isFinite(options.probability)
      ? options.probability
      : null;
    const expectedValue = Number.isFinite(options.expectedValue)
      ? options.expectedValue
      : null;

    const allocation = await runTransaction(async (client) => {
      const lootRecord: LootCatalogRecord | null =
        await lootCatalogRepo.getActiveByName(USDC_LOOT_CATALOG_NAME, {
          client,
          forUpdate: true,
        });

      if (!lootRecord) {
        return null;
      }

      const availableRaw = lootRecord.remaining ?? 0;
      const available = Number(availableRaw);
      if (!Number.isFinite(available) || available <= 0) {
        return null;
      }

      const decimalsRaw = lootRecord.decimals;
      const decimals =
        typeof decimalsRaw === 'number' && Number.isFinite(decimalsRaw)
          ? Math.max(0, Math.min(8, Math.floor(decimalsRaw)))
          : 6;

      // Enforce minimum of 0.1 for any positive request; do not round
      const normalizedRequested = Math.max(0, requestedAmountRaw);
      const requested =
        normalizedRequested > 0 ? Math.max(0.1, normalizedRequested) : 0;
      if (requested <= 0) {
        return null;
      }

      const grantedAmount = Math.min(available, requested);

      const updatedRecord = await lootCatalogRepo.decrementRemaining({
        lootId: lootRecord.id,
        amount: grantedAmount,
        client,
      });

      if (!updatedRecord) {
        throw new Error('Failed to decrement USDC loot catalog remaining');
      }

      const distribution = await lootDistributionsRepo.createPending({
        client,
        gameId: options.gameId,
        playerId: options.playerId,
        lootId: lootRecord.id,
        source: 'treasure_chest',
        amount: grantedAmount,
        probability,
        expectedValue,
        entityId: options.entityId,
        metadata: {
          chestId: options.chestId,
          difficultyTier: options.difficultyTier,
          requestedAmount: requested,
          grantedAmount,
          remainingBefore: available,
          remainingAfter: updatedRecord.remaining,
          lootName: lootRecord.name,
          lootId: lootRecord.id,
          precision: -1,
        },
        claimed: false,
      });

      return {
        amount: grantedAmount,
        distribution,
        lootId: lootRecord.id,
        lootName: lootRecord.name ?? null,
        decimals: lootRecord.decimals ?? null,
        remainingAfter: updatedRecord.remaining ?? null,
        requestedAmount: requested,
        precision: -1,
      } satisfies ChestLootAllocation;
    });

    return allocation;
  }

  private async allocateChestGhstLoot(options: {
    playerId: string;
    gameId: string;
    chestId: string;
    difficultyTier: string;
    requestedAmount: number; // interpreted as tokens, clamped to integer
    probability: number;
    expectedValue: number;
    entityId: string;
  }): Promise<ChestLootAllocation | null> {
    const requestedRaw = Number(options.requestedAmount);
    const requestedNormalized = Number.isFinite(requestedRaw)
      ? Math.max(0, requestedRaw)
      : 0;
    const requested =
      requestedNormalized > 0 ? Math.max(0.1, requestedNormalized) : 0;

    if (!Number.isFinite(requested) || requested <= 0) {
      return null;
    }

    const probability = Number.isFinite(options.probability)
      ? options.probability
      : null;
    const expectedValue = Number.isFinite(options.expectedValue)
      ? options.expectedValue
      : null;

    const allocation = await runTransaction(async (client) => {
      const lootRecord: LootCatalogRecord | null =
        await lootCatalogRepo.getActiveByName(GHST_LOOT_CATALOG_NAME, {
          client,
          forUpdate: true,
        });

      if (!lootRecord) {
        return null;
      }

      const availableRaw = lootRecord.remaining ?? 0;
      const available = Number(availableRaw);
      if (!Number.isFinite(available) || available <= 0) {
        return null;
      }

      // Allow fractional GHST; enforce minimum of 0.1 for any positive request; do not round
      const grantedUnits = Math.min(available, requested);

      const updatedRecord = await lootCatalogRepo.decrementRemaining({
        lootId: lootRecord.id,
        amount: grantedUnits,
        client,
      });
      if (!updatedRecord) {
        throw new Error('Failed to decrement GHST loot catalog remaining');
      }

      const distribution = await lootDistributionsRepo.createPending({
        client,
        gameId: options.gameId,
        playerId: options.playerId,
        lootId: lootRecord.id,
        source: 'treasure_chest',
        amount: grantedUnits,
        probability,
        expectedValue,
        entityId: options.entityId,
        metadata: {
          chestId: options.chestId,
          difficultyTier: options.difficultyTier,
          requestedAmount: requested,
          grantedAmount: grantedUnits,
          remainingBefore: available,
          remainingAfter: updatedRecord.remaining,
          lootName: lootRecord.name,
          lootId: lootRecord.id,
          token: 'GHST',
          tokenDecimals: lootRecord.decimals ?? 18,
        },
        claimed: false,
      });

      return {
        amount: grantedUnits,
        distribution,
        lootId: lootRecord.id,
        lootName: lootRecord.name ?? null,
        decimals: lootRecord.decimals ?? null,
        remainingAfter: updatedRecord.remaining ?? null,
        requestedAmount: requested,
        precision: -1,
      } satisfies ChestLootAllocation;
    });

    return allocation;
  }

  private async handleOpenChest(client: Client, data: { chestId: string }) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const chestEntity = this.state.entities.get(data.chestId);
    if (!chestEntity || chestEntity.kind !== 'treasure_chest') {
      console.warn(`Chest ${data.chestId} not found or not a treasure chest`);
      return;
    }

    const chestState = JSON.parse(chestEntity.state || '{}');
    if (chestState.opened) {
      console.log(`Chest ${data.chestId} is already opened`);
      return;
    }

    const distance = Math.hypot(
      player.x - chestEntity.x,
      player.y - chestEntity.y
    );
    if (distance > 100) {
      console.log(
        `Player ${player.name} too far from chest ${data.chestId} (distance: ${distance})`
      );
      return;
    }

    chestState.opened = true;
    chestEntity.state = JSON.stringify(chestState);

    const difficultyTier = this.state.difficultyTier || 'normal_1';

    const explicitCount =
      typeof chestState.itemCount === 'number'
        ? Math.max(1, Math.floor(chestState.itemCount))
        : null;
    const fallbackCount = Array.isArray(chestState.loot)
      ? Math.max(1, chestState.loot.length)
      : 3;
    const chestItemCount = explicitCount ?? fallbackCount;

    const chestDrops = rollChestItems({
      count: chestItemCount,
      difficultyTierId: difficultyTier,
      sourceId: LOOT_SOURCE_IDS.treasureChest,
    });

    const usdcReward = rollChestCurrency({
      difficultyTierId: difficultyTier,
      currency: 'USDC',
    });
    const ghstReward = rollChestCurrency({
      difficultyTierId: difficultyTier,
      currency: 'GHST',
    });

    const usdcRaw = Number(usdcReward.amount) || 0;
    const normalizedUsdcRequested = usdcRaw > 0 ? Math.max(0.1, usdcRaw) : 0;
    const ghstRaw = Number(ghstReward.amount) || 0;
    const normalizedGhstRequested = ghstRaw > 0 ? Math.max(0.1, ghstRaw) : 0;

    const playerDbId = this.getPlayerIdForSession(client.sessionId);
    const gameId = this.currentGameId;
    const spawnRadius = 140;
    const entityIdBase = `treasure_drop_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 6)}`;

    let ghstAllocation: ChestLootAllocation | null = null;
    let usdcAllocation: ChestLootAllocation | null = null;

    if (playerDbId && gameId) {
      try {
        [ghstAllocation, usdcAllocation] = await Promise.all([
          normalizedGhstRequested > 0
            ? this.allocateChestGhstLoot({
                playerId: playerDbId,
                gameId,
                chestId: data.chestId,
                difficultyTier,
                requestedAmount: normalizedGhstRequested,
                probability: ghstReward.probability,
                expectedValue: ghstReward.expectedValue,
                entityId: `${entityIdBase}_ghst`,
              })
            : Promise.resolve(null),
          normalizedUsdcRequested > 0
            ? this.allocateChestUsdcLoot({
                playerId: playerDbId,
                gameId,
                chestId: data.chestId,
                difficultyTier,
                requestedAmount: normalizedUsdcRequested,
                probability: usdcReward.probability,
                expectedValue: usdcReward.expectedValue,
                entityId: `${entityIdBase}_usdc`,
              })
            : Promise.resolve(null),
        ]);
      } catch (error) {
        console.error('Failed to allocate loot for treasure chest', {
          gameId,
          playerId: playerDbId,
          chestId: data.chestId,
          error,
        });
      }
    } else {
      console.warn('Treasure chest opened without persisted player/game id', {
        chestId: data.chestId,
        playerDbId,
        gameId,
      });
    }

    // Spawn currency collectibles in-world so they can be vacuumed and credited via inventory pipeline
    // Resolve granted amounts now for spawning
    const grantedUsdc = Number(usdcAllocation?.amount ?? 0);
    const grantedGhst = Number(ghstAllocation?.amount ?? 0);

    // Collect all spawned items (currency + non-currency) for summary/logging
    const spawnedItems: Array<{
      entityId: string;
      category: string;
      item: InventoryItemPayload;
    }> = [];

    const registerCurrencyMapping = (
      entityId: string,
      allocation: ChestLootAllocation,
      currency: 'USDC' | 'GHST'
    ) => {
      const timeout = setTimeout(() => {
        this.entityLootDistributions.delete(entityId);
      }, 10 * 60_000);
      this.entityLootDistributions.set(entityId, {
        distributionId: allocation.distribution.id,
        timeout,
        source: 'treasure_chest',
        metadata: {
          chestId: data.chestId,
          difficultyTier,
          currency,
          amount: allocation.amount,
        },
        playerId: playerDbId ?? null,
      });
    };

    const spawnCurrencyDrop = (
      currency: 'USDC' | 'GHST',
      amount: number,
      allocation: ChestLootAllocation
    ) => {
      if (!(amount > 0)) return;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spawnRadius * 0.75 + spawnRadius * 0.25;
      const entityId = `${entityIdBase}_${currency.toLowerCase()}`;

      const payload: any = {
        itemType: 'coin',
        type: 'coin',
        name: currency,
        quantity: 1,
        origin: 'treasure_chest',
        chestId: data.chestId,
        category: 'coin',
        difficultyTier,
      };
      if (currency === 'USDC') {
        payload.usdcAmount = amount;
      } else if (currency === 'GHST') {
        payload.ghstAmount = amount;
      }

      const entity = new EntitySchema();
      entity.id = entityId;
      entity.kind = 'collectible' as any;
      entity.x = chestEntity.x + Math.cos(angle) * radius;
      entity.y = chestEntity.y + Math.sin(angle) * radius;
      entity.state = JSON.stringify(payload);
      this.state.entities.set(entityId, entity);

      registerCurrencyMapping(entityId, allocation, currency);

      spawnedItems.push({
        entityId,
        category: 'coin',
        item: payload,
      });
    };

    if (playerDbId && gameId) {
      if (usdcAllocation && grantedUsdc > 0) {
        spawnCurrencyDrop('USDC', grantedUsdc, usdcAllocation);
      }
      if (ghstAllocation && grantedGhst > 0) {
        spawnCurrencyDrop('GHST', grantedGhst, ghstAllocation);
      }
    }

    let totalGoldCoins = 0;
    let spawnIndex = 0;

    const registerEntityMapping = (entityId: string, drop: DroppedItemData) => {
      const timeout = setTimeout(() => {
        this.entityLootDistributions.delete(entityId);
      }, 10 * 60_000);

      this.entityLootDistributions.set(entityId, {
        distributionId: null,
        timeout,
        source: 'treasure_chest',
        metadata: {
          chestId: data.chestId,
          difficultyTier,
          dropType: drop.type ?? 'item',
          dropName: drop.name,
          quantity: drop.quantity ?? 1,
        },
        playerId: playerDbId ?? null,
      });
    };

    const spawnChestDrop = (drop: DroppedItemData) => {
      const quantity = Number.isFinite(drop.quantity)
        ? Number(drop.quantity)
        : 1;
      const payload: InventoryItemPayload = {
        ...drop,
        itemType: drop.type ?? 'item',
        type: drop.type ?? 'item',
        quantity,
        origin: 'treasure_chest',
        chestId: data.chestId,
        category: drop.type ?? 'item',
        difficultyTier,
      };

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * spawnRadius * 0.75 + spawnRadius * 0.25;
      const entityId = `${entityIdBase}_${spawnIndex++}`;

      const entity = new EntitySchema();
      entity.id = entityId;
      entity.kind = 'collectible' as any;
      entity.x = chestEntity.x + Math.cos(angle) * radius;
      entity.y = chestEntity.y + Math.sin(angle) * radius;
      entity.state = JSON.stringify(payload);
      this.state.entities.set(entityId, entity);

      registerEntityMapping(entityId, drop);

      spawnedItems.push({
        entityId,
        category: drop.type ?? 'item',
        item: payload,
      });

      if ((drop.type ?? '').toLowerCase() === 'coin') {
        totalGoldCoins += quantity;
      }
    };

    chestDrops.forEach(spawnChestDrop);

    const itemSummaries: TreasureLootSummaryEntry[] = chestDrops.map(
      (drop) => ({
        category: drop.type ?? 'item',
        name: drop.name,
        quantity: drop.quantity ?? 1,
        rarity: drop.rarity,
      })
    );

    const currencySummaries: TreasureLootSummaryEntry[] = [];
    if (grantedUsdc > 0) {
      currencySummaries.push({
        category: 'usdc',
        name: 'USDC',
        quantity: grantedUsdc,
        usdcAmount: grantedUsdc,
      });
    }
    if (grantedGhst > 0) {
      currencySummaries.push({
        category: 'ghst',
        name: 'GHST',
        quantity: grantedGhst,
      });
    }

    const lootSummary = {
      totalUsdc: grantedUsdc,
      totalGhst: grantedGhst,
      totalGoldCoins,
      items: [...itemSummaries, ...currencySummaries],
      itemCount: itemSummaries.length,
      requestedUsdc: normalizedUsdcRequested,
      requestedGhst: normalizedGhstRequested,
    };

    const rewardDetails = {
      ...usdcReward,
      amount: normalizedUsdcRequested,
      grantedAmount: lootSummary.totalUsdc,
    };

    const rewardSummaryLog: Record<string, unknown>[] = [
      {
        category: 'summary',
        totalUsdc: lootSummary.totalUsdc,
        totalGhst: lootSummary.totalGhst,
        totalGoldCoins: lootSummary.totalGoldCoins,
        itemCount: lootSummary.itemCount,
        requestedUsdc: lootSummary.requestedUsdc,
        requestedGhst: lootSummary.requestedGhst,
      },
      ...itemSummaries,
      ...currencySummaries,
    ];

    if (playerDbId && gameId) {
      void chestsRepo
        .logOpen({
          gameId,
          playerId: playerDbId,
          chestEntityId: data.chestId,
          difficultyTier,
          rewardSummary: rewardSummaryLog,
        })
        .catch((error) => {
          console.error('Failed to log chest open', {
            gameId,
            playerId: playerDbId,
            chestId: data.chestId,
            error,
          });
        });
    }

    const rewardLines = [
      `💰 Player ${player.name} opened treasure chest ${data.chestId}:`,
      `\n  - Spawned items: ${spawnedItems.length}`,
      `\n  - Gold coins: ${lootSummary.totalGoldCoins}`,
      `\n  - Wearables: ${spawnedItems.filter((s) => s.category === 'wearable').length}`,
      `\n  - USDC granted: ${lootSummary.totalUsdc} (requested ${lootSummary.requestedUsdc})`,
      `\n  - GHST granted: ${lootSummary.totalGhst}`,
      `\n  - Reward odds (tier ${difficultyTier}): ${(rewardDetails.probability * 100).toFixed(1)}% chance, expected ${rewardDetails.expectedValue} USDC`,
    ];
    console.log(...rewardLines);

    this.msg.broadcast('chest_opened', {
      chestId: data.chestId,
      playerId: client.sessionId,
      difficultyTier,
      lootSummary,
      rewardResult: rewardDetails,
      spawnedItemCount: spawnedItems.length,
      usdcReward: lootSummary.totalUsdc,
      ghstReward: lootSummary.totalGhst,
    });

    setTimeout(() => {
      if (this.state.entities.has(data.chestId)) {
        this.state.entities.delete(data.chestId);
        console.log(
          `🗑️ Removed treasure chest ${data.chestId} from room state`
        );
      }
    }, 3000);
  }

  private getProgressionProfile(sessionId: string): ProgressionProfile {
    const stored = this.playerProgression.get(sessionId);
    return stored ? cloneProfile(stored) : createDefaultProfile();
  }

  private setProgressionProfile(
    sessionId: string,
    profile: ProgressionProfile,
    options: { persist?: boolean } = {}
  ) {
    this.playerProgression.set(sessionId, cloneProfile(profile));
    if (options.persist) {
      void this.persistProgression(sessionId, profile);
    }
  }

  private applyProgressionToPlayer(
    sessionId: string,
    options: { fullHeal?: boolean } = {}
  ) {
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const profile = this.getProgressionProfile(sessionId);
    const modifiers = computeProgressionModifiers(profile.stats);
    const killStreakProfile = this.killStreakBySession.get(sessionId);
    const leverage = this.getLeverageTotal();
    const killStreakModifiers = killStreakProfile
      ? computeKillStreakModifiers(
          killStreakProfile.archetypeId,
          killStreakProfile.units,
          leverage
        )
      : undefined;
    syncPlayerCharacterStats(player, {
      fullHeal: options.fullHeal,
      preserveHealthRatio: !options.fullHeal,
      progressionModifiers: modifiers,
      killStreakModifiers,
    });
  }

  private ensureKillStreakForPlayer(
    sessionId: string,
    player: PlayerSchema,
    options: { reset?: boolean; sendProfile?: boolean } = {}
  ): KillStreakProfile | null {
    if (this.phase !== 'in_game') {
      if (options.reset) {
        this.killStreakBySession.delete(sessionId);
      }
      return null;
    }

    const archetypeId = resolveArchetypeForCharacter(player.characterId);
    const existing = this.killStreakBySession.get(sessionId);
    const shouldReset =
      options.reset || !existing || existing.archetypeId !== archetypeId;

    const profile = shouldReset
      ? createKillStreakProfile(archetypeId)
      : existing!;

    if (shouldReset) {
      this.killStreakBySession.set(sessionId, profile);
    }

    if (options.sendProfile !== false) {
      this.sendKillStreakProfileToClient(sessionId, profile);
    }

    return profile;
  }

  private sendKillStreakProfileToClient(
    sessionId: string,
    profileInput?: KillStreakProfile
  ) {
    const client = this.getClientBySessionId(sessionId);
    if (!client) return;
    const profile = profileInput ?? this.killStreakBySession.get(sessionId);
    if (!profile) return;
    this.msg.sendTo(client, 'kill_streak:profile', {
      units: profile.units,
      archetypeId: profile.archetypeId,
    });
  }

  private sendKillStreakResetToClient(sessionId: string, reason?: string) {
    const client = this.getClientBySessionId(sessionId);
    if (!client) return;
    this.msg.sendTo(client, 'kill_streak:reset', {
      reason: reason ?? 'reset',
    });
  }

  public equipmentCanModify(playerId: string) {
    const sessions = this.getSessionIdsForPlayer(playerId);
    if (sessions.length === 0) {
      return { allowed: true, phase: this.phase };
    }

    if (this.phase === 'in_game') {
      return {
        allowed: false,
        phase: this.phase,
        reason: 'Equipment changes are disabled during an active run',
      };
    }

    return { allowed: true, phase: this.phase };
  }

  public equipmentBroadcastUpdate(payload: EquipmentBroadcastPayload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const sessions = this.getSessionIdsForPlayer(payload.playerId);
    if (sessions.length === 0) {
      return;
    }

    const signature = payload.equipment
      .map((entry) => `${entry.slot}::${entry.slug}`)
      .sort();
    this.playerEquipmentSnapshots.set(payload.playerId, signature);

    for (const sessionId of sessions) {
      const player = this.state.players.get(sessionId);
      if (!player) {
        continue;
      }

      player.equippedWearables = JSON.stringify(payload.equippedWearables);
      player.derivedStats = JSON.stringify(payload.derivedStats);

      this.applyProgressionToPlayer(sessionId, { fullHeal: false });

      const client = this.getClientBySessionId(sessionId);
      if (client) {
        this.msg.sendTo(client, 'equipment_updated', {
          equipment: payload.equipment,
          overrides: payload.overrides,
          version: payload.version,
        });
        this.msg.sendTo(client, 'stats_updated', {
          derivedStats: payload.derivedStats,
        });
      }
    }
  }

  private resetKillStreakForSession(
    sessionId: string,
    options: { reason?: string; reinitialize?: boolean } = {}
  ): KillStreakProfile | null {
    const player = this.state.players.get(sessionId);
    if (options.reason) {
      this.sendKillStreakResetToClient(sessionId, options.reason);
    } else {
      this.sendKillStreakResetToClient(sessionId);
    }
    this.killStreakBySession.delete(sessionId);
    if (player) {
      this.applyProgressionToPlayer(sessionId, { fullHeal: false });
    }

    const shouldReinitialize =
      options.reinitialize === true && this.phase === 'in_game' && player;

    if (shouldReinitialize && player) {
      return this.ensureKillStreakForPlayer(sessionId, player, {
        reset: true,
        sendProfile: true,
      });
    }

    return null;
  }

  private resetKillStreakForAllPlayers(options: { reason?: string } = {}) {
    const reason = options.reason;
    this.state.players.forEach((_player, sessionId) => {
      this.killStreakBySession.delete(sessionId);
      this.sendKillStreakResetToClient(sessionId, reason);
      this.applyProgressionToPlayer(sessionId, { fullHeal: false });
    });
    this.killStreakBySession.clear();
  }

  private awardKillStreakUnitsToPlayer(
    sessionId: string,
    unitDelta: number,
    context: {
      enemyId?: string;
      enemyType?: string;
      attackType?: string;
      classification?: string;
    }
  ) {
    if (unitDelta <= 0) return;
    if (this.phase !== 'in_game') return;
    const player = this.state.players.get(sessionId);
    if (!player) return;

    const profile =
      this.ensureKillStreakForPlayer(sessionId, player, {
        sendProfile: false,
      }) ?? undefined;
    if (!profile) return;

    const { profile: nextProfile, deltaUnits } = applyKillStreakIncrement(
      profile,
      unitDelta
    );
    if (deltaUnits === 0) {
      this.killStreakBySession.set(sessionId, nextProfile);
      return;
    }

    this.killStreakBySession.set(sessionId, nextProfile);
    this.applyProgressionToPlayer(sessionId, { fullHeal: false });

    const client = this.getClientBySessionId(sessionId);
    if (client) {
      this.msg.sendTo(client, 'kill_streak:updated', {
        units: nextProfile.units,
        deltaUnits,
        archetypeId: nextProfile.archetypeId,
        source: {
          ...context,
          type: 'kill',
        },
      });
    }
  }

  private updateKillStreakDecay(now: number) {
    if (this.killStreakBySession.size === 0) {
      return;
    }

    this.killStreakBySession.forEach((profile, sessionId) => {
      const previousUnits = profile.units;
      const previousFloor = Math.floor(previousUnits);
      const { profile: nextProfile, deltaUnits } = applyKillStreakDecay(
        profile,
        now
      );

      this.killStreakBySession.set(sessionId, nextProfile);

      if (deltaUnits === 0) {
        return;
      }

      const nextFloor = Math.floor(nextProfile.units);
      const shouldBroadcast =
        nextFloor !== previousFloor || nextProfile.units <= 0;

      this.applyProgressionToPlayer(sessionId, { fullHeal: false });

      if (shouldBroadcast) {
        const client = this.getClientBySessionId(sessionId);
        if (client && shouldBroadcast) {
          this.msg.sendTo(client, 'kill_streak:updated', {
            units: nextProfile.units,
            deltaUnits,
            archetypeId: nextProfile.archetypeId,
            source: {
              type: 'decay',
            },
          });
        }
      }
    });
  }

  private getClientBySessionId(sessionId: string): Client | undefined {
    return this.clients.find((client) => client.sessionId === sessionId);
  }

  // (reverted) no coalescing helpers

  private getPlayerIdForSession(sessionId: string) {
    return this.sessionPlayerIds.get(sessionId);
  }

  private getSessionIdsForPlayer(playerId: string): string[] {
    const sessions: string[] = [];
    for (const [sessionId, mappedPlayerId] of this.sessionPlayerIds.entries()) {
      if (mappedPlayerId === playerId) {
        sessions.push(sessionId);
      }
    }
    return sessions;
  }

  private getUnlockedTiersFromPlayer(sessionId: string) {
    const player = this.state.players.get(sessionId);
    if (!player) {
      return DEFAULT_UNLOCKED_TIERS;
    }
    const parsed = safeParseJson<string[]>(
      player.unlockedTiers,
      DEFAULT_UNLOCKED_TIERS
    );
    return parsed.length > 0 ? parsed : DEFAULT_UNLOCKED_TIERS;
  }

  private async withProgressionWriteLock<T>(
    playerId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous =
      this.progressionWriteQueues.get(playerId) ?? Promise.resolve();
    const runPromise = previous.then(
      () => task(),
      () => task()
    );
    const finalPromise = runPromise.then(
      () => undefined,
      () => undefined
    );
    this.progressionWriteQueues.set(playerId, finalPromise);
    try {
      return await runPromise;
    } finally {
      if (this.progressionWriteQueues.get(playerId) === finalPromise) {
        this.progressionWriteQueues.delete(playerId);
      }
    }
  }

  private async persistProgression(
    sessionId: string,
    profileInput?: ProgressionProfile
  ) {
    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      return;
    }

    const profile = profileInput ?? this.playerProgression.get(sessionId);
    if (!profile) {
      return;
    }

    const player = this.state.players.get(sessionId);
    const lickTongueCount = player?.lickTongueCount ?? 0;
    const unlockedTiers = this.getUnlockedTiersFromPlayer(sessionId);
    if (player) {
      player.unlockedTiers = JSON.stringify(unlockedTiers);
    }
    const derivedStats = player
      ? safeParseJson<Record<string, unknown>>(player.derivedStats, {})
      : {};
    const equippedWearables = player
      ? parseWearableArray(player.equippedWearables)
      : [];

    const equipmentItemsRaw = Array.isArray(
      (derivedStats as { equipment?: { items?: unknown } }).equipment?.items
    )
      ? ((derivedStats as { equipment?: { items?: unknown } }).equipment!
          .items as Array<{ slug?: unknown; slot?: unknown }>)
      : [];

    const equipmentItems = equipmentItemsRaw
      .map((item) => ({
        slug: typeof item.slug === 'string' ? item.slug : null,
        slot: typeof item.slot === 'string' ? item.slot : null,
      }))
      .filter(
        (item): item is { slug: string; slot: string } =>
          Boolean(item.slug) && Boolean(item.slot)
      );

    const equipmentSignature = equipmentItems
      .map((item) => `${item.slot}::${item.slug}`)
      .sort();
    const previousSignature = this.playerEquipmentSnapshots.get(playerId);
    const equipmentChanged =
      !previousSignature ||
      previousSignature.length !== equipmentSignature.length ||
      previousSignature.some(
        (value, index) => value !== equipmentSignature[index]
      );

    const lastSyncedAtIso =
      typeof profile.lastSyncedAt === 'number'
        ? new Date(profile.lastSyncedAt).toISOString()
        : null;

    await this.withProgressionWriteLock(playerId, async () => {
      try {
        // Do not update unlocked_tiers from the room to avoid overwriting
        // server-authoritative difficulty unlocks. Persist only other fields.
        await progressionRepo.updateProgression(playerId, {
          level: profile.level,
          totalXp: profile.totalXp,
          unspentPoints: profile.unspentPoints,
          // unlockedTiers intentionally omitted
          lickTongueCount,
          statAllocations: profile.stats,
          derivedStats,
          equippedWearables,
          allocationHistory: profile.allocationHistory,
          lastSyncedAt: lastSyncedAtIso,
        });

        if (equipmentChanged) {
          try {
            const characterId = player?.characterId ?? null;
            await equipmentRepo.clearEquipment(playerId, characterId);
            if (equipmentItems.length > 0) {
              await Promise.all(
                equipmentItems.map((item) =>
                  equipmentRepo.setEquipment({
                    playerId,
                    characterId,
                    slot: item.slot,
                    wearableSlug: item.slug,
                    source: 'derived',
                  })
                )
              );
            }
            this.playerEquipmentSnapshots.set(playerId, equipmentSignature);
          } catch (equipmentError) {
            console.error('Failed to persist equipment snapshot', {
              playerId,
              sessionId,
              equipmentItems: equipmentSignature,
              error: equipmentError,
            });
          }
        }
      } catch (error) {
        console.error('Failed to persist progression', {
          playerId,
          sessionId,
          error,
        });
      }
    });
  }

  private async persistInventory(
    sessionId: string,
    itemsInput?: InventoryItemPayload[]
  ) {
    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      return;
    }

    const items = itemsInput ?? this.playerInventories.get(sessionId) ?? [];

    const normalized = sanitizeInventoryPayloads(items);

    if (!itemsInput) {
      this.playerInventories.set(sessionId, normalized);
    }

    const mapped = normalized.map((item) => {
      const rawQuantity = Number(item.quantity);
      const quantity = Number.isFinite(rawQuantity)
        ? Math.max(0, Math.floor(rawQuantity))
        : 0;
      return {
        itemType: String(item.type ?? item.itemType ?? 'unknown'),
        itemName: String(item.name ?? item.id ?? 'item'),
        quantity,
        itemData: { ...item, quantity },
      };
    });

    try {
      await inventoryRepo.replaceInventory(playerId, mapped);
    } catch (error) {
      console.error('Failed to persist inventory', {
        playerId,
        sessionId,
        error,
      });
    }
  }

  private async logInventoryDiff(
    playerId: string,
    previous: InventoryItemPayload[],
    next: InventoryItemPayload[]
  ) {
    const buildMap = (items: InventoryItemPayload[]) => {
      const map = new Map<
        string,
        { quantity: number; type: string; name: string }
      >();
      items.forEach((item) => {
        const type = String(item.type ?? item.itemType ?? 'unknown');
        const name = String(item.name ?? item.id ?? 'item');
        const key = `${type}::${name}`;
        const quantity = Number.isFinite(item.quantity)
          ? Number(item.quantity)
          : 0;
        map.set(key, { quantity, type, name });
      });
      return map;
    };

    const prevMap = buildMap(previous);
    const nextMap = buildMap(next);
    const keys = new Set([...prevMap.keys(), ...nextMap.keys()]);

    await Promise.all(
      Array.from(keys).map(async (key) => {
        const [typeKey, nameKey = 'item'] = key.split('::');
        const prev = prevMap.get(key) || {
          quantity: 0,
          type: typeKey || 'unknown',
          name: nameKey,
        };
        const curr = nextMap.get(key) || {
          quantity: 0,
          type: prev.type,
          name: prev.name,
        };
        if (String(curr.type ?? '').toLowerCase() === 'wearable') {
          return;
        }
        const delta = curr.quantity - prev.quantity;
        if (delta === 0) {
          return;
        }
        try {
          await inventoryEventsRepo.logInventoryEvent({
            playerId,
            itemType: curr.type,
            itemName: curr.name,
            delta,
            reason: 'server_delta',
            gameId: this.currentGameId ?? null,
            metadata: {
              previousQuantity: prev.quantity,
              newQuantity: curr.quantity,
              roomId: this.state.id,
            },
          });
        } catch (error) {
          console.error('Failed to log inventory event', {
            playerId,
            itemType: curr.type,
            itemName: curr.name,
            delta,
            error,
          });
        }
      })
    );
  }

  private getGroupXpMultiplier(partySize: number): number {
    if (partySize <= 1) return 1;
    const bonus = Math.min(0.75, (partySize - 1) * 0.15);
    return 1 + bonus;
  }

  private getDifficultyXpMultiplier(): number {
    const difficulty = getDifficultyTier(this.state.difficultyTier);
    return difficulty?.xpMultiplier ?? 1;
  }

  private ensurePlayerScoreState(playerId: string): PlayerRuntimeScoreState {
    let state = this.playerScoreStateByPlayerId.get(playerId);
    if (!state) {
      state = { score: 0, eligible: true, enteredTreasureAt: null };
      this.playerScoreStateByPlayerId.set(playerId, state);
    }
    return state;
  }

  private resetScoreTrackingForRun() {
    this.playerScoreStateByPlayerId.clear();
    this.pendingScoreDeltas.clear();
    this.playersDiedThisRunByPlayerId.clear();

    this.state.players.forEach((player, sessionId) => {
      const playerId = this.getPlayerIdForSession(sessionId);
      if (SCORE_CONFIG.enabled && playerId) {
        const state = this.ensurePlayerScoreState(playerId);
        state.score = 0;
        state.eligible = true;
        state.enteredTreasureAt = null;
        player.score = 0;
        player.scoreEligible = true;
        this.scheduleScoreSync(sessionId);
      } else {
        player.score = 0;
        player.scoreEligible = true;
      }
    });
  }

  private scheduleScoreSync(sessionId: string) {
    if (!SCORE_CONFIG.enabled) {
      return;
    }
    if (!this.pendingScoreDeltas.has(sessionId)) {
      this.pendingScoreDeltas.set(sessionId, 0);
    }
  }

  private queueScoreDelta(sessionId: string, amount: number) {
    if (!SCORE_CONFIG.enabled) {
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      return;
    }

    const state = this.ensurePlayerScoreState(playerId);
    const rounded = Math.round(amount);
    const nextScore = Math.min(
      SCORE_CONFIG.maxValue,
      state.score + (rounded > 0 ? rounded : 0)
    );
    state.score = nextScore;
    const previous = this.pendingScoreDeltas.get(sessionId) ?? 0;
    this.pendingScoreDeltas.set(sessionId, previous + rounded);
  }

  private setPlayerScoreEligibilityByPlayerId(
    playerId: string,
    eligible: boolean
  ): boolean {
    if (!SCORE_CONFIG.enabled) {
      return false;
    }
    const state = this.ensurePlayerScoreState(playerId);
    if (state.eligible === eligible) {
      return false;
    }
    state.eligible = eligible;
    if (!eligible) {
      this.playersDiedThisRunByPlayerId.add(playerId);
    } else {
      this.playersDiedThisRunByPlayerId.delete(playerId);
    }
    return true;
  }

  private markPlayerScoreIneligible(sessionId: string) {
    if (!SCORE_CONFIG.enabled) {
      return;
    }
    const playerId = this.getPlayerIdForSession(sessionId);
    if (!playerId) {
      return;
    }
    const changed = this.setPlayerScoreEligibilityByPlayerId(playerId, false);
    if (changed) {
      this.scheduleScoreSync(sessionId);
    }
  }

  private flushPendingScores() {
    if (!SCORE_CONFIG.enabled) {
      this.pendingScoreDeltas.clear();
      return;
    }
    if (this.pendingScoreDeltas.size === 0) {
      return;
    }

    this.pendingScoreDeltas.forEach((_delta, sessionId) => {
      const player = this.state.players.get(sessionId);
      if (!player) {
        return;
      }
      const playerId = this.getPlayerIdForSession(sessionId);
      if (!playerId) {
        return;
      }
      const state = this.playerScoreStateByPlayerId.get(playerId);
      if (!state) {
        return;
      }
      player.score = state.score;
      player.scoreEligible = state.eligible;
    });

    this.pendingScoreDeltas.clear();
  }

  private cloneRuntimeStats(sessionId: string): GamePlayerRuntimeStats | null {
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) {
      return null;
    }
    return { ...stats };
  }

  private async persistPlayerRunScore(options: {
    playerId: string;
    sessionId?: string;
    statsSnapshot?: GamePlayerRuntimeStats | null;
    partySize?: number;
    reason: 'leave' | 'dispose' | 'boss_kill';
    extraMetadata?: Record<string, unknown>;
  }) {
    if (!SCORE_CONFIG.enabled && options.reason !== 'boss_kill') {
      return;
    }
    if (!this.currentGameId) {
      return;
    }

    const { playerId } = options;
    if (!playerId) {
      return;
    }

    if (this.persistedScorePlayerIds.has(playerId)) {
      return;
    }

    const scoreState = this.playerScoreStateByPlayerId.get(playerId);
    if (!scoreState) {
      return;
    }

    const score = Math.max(0, Math.floor(scoreState.score ?? 0));
    const validForHighScore =
      score > 0 &&
      scoreState.eligible &&
      scoreState.enteredTreasureAt != null &&
      !this.playersDiedThisRunByPlayerId.has(playerId);

    const durationMs =
      this.runStartedAt != null && this.runStartedAt > 0
        ? Math.max(0, Date.now() - this.runStartedAt)
        : null;

    const stats = options.statsSnapshot ?? null;

    const metadata: Record<string, unknown> = {
      ...(options.extraMetadata ?? {}),
      reason: options.reason,
      enteredTreasureAt: scoreState.enteredTreasureAt,
      partySize: options.partySize ?? this.state.players.size,
      sessionId: options.sessionId ?? null,
    };

    if (stats) {
      metadata.gamePlayerId = stats.gamePlayerId;
      metadata.kills = stats.kills;
      metadata.xpGained = stats.xpGained;
    }

    // Capture leverage snapshot for this run
    const leverageSnapshot = {
      floor: (this.state as any).floorLeverage || 1,
      room: (this.state as any).roomLeverage || 1,
      total: (this.state as any).leverageTotal || 1,
      floorSetAt: (this.state as any).floorLeverageSetAt || undefined,
      roomSetAt: (this.state as any).roomLeverageSetAt || undefined,
    };
    (metadata as any).leverage = leverageSnapshot;

    try {
      await runTransaction(async (client) => {
        // Always persist the score, even if not valid for high score
        await runScoresRepo.recordRunScore({
          playerId,
          gameId: this.currentGameId!,
          score,
          difficultyTier: this.state.difficultyTier,
          durationMs,
          kills: stats?.kills ?? null,
          xpEarned: stats?.xpGained ?? null,
          validForHighScore,
          metadata,
          client,
        });

        // Only update highest score if valid for high score
        if (validForHighScore) {
          await playersRepo.updateHighestScore(playerId, score, client);
        }

        // Always save score metadata to game_players for fallback
        if (stats?.gamePlayerId) {
          await gamePlayersRepo.applyStats({
            gamePlayerId: stats.gamePlayerId,
            metadata: {
              score: {
                final: score,
                eligible: validForHighScore,
                submittedAt: new Date().toISOString(),
                durationMs,
                difficultyTier: this.state.difficultyTier,
              },
              leverage: leverageSnapshot,
            },
            client,
          });
        }
      });

      this.persistedScorePlayerIds.add(playerId);
    } catch (error) {
      console.error('Failed to persist run score', {
        playerId,
        gameId: this.currentGameId,
        score,
        error,
      });
    }
  }

  private getDailyRunDate(nowMs?: number): string {
    const config = getDailyRunsConfig();
    return getDailyDate({ nowMs, resetHour: config.resetTimeUtcHour });
  }

  private computeRunScoreForPlayer(
    playerId: string,
    stats?: GamePlayerRuntimeStats | null
  ): number {
    const scoreState = this.ensurePlayerScoreState(playerId);
    const baseScore = Math.max(0, Math.floor(scoreState.score ?? 0));
    const floorCleared = Math.max(0, this.getFloorReached());
    const kills = Math.max(0, Math.floor(stats?.kills ?? 0));
    const deaths = Math.max(0, Math.floor(stats?.deaths ?? 0));
    const noDeath =
      deaths <= 0 && !this.playersDiedThisRunByPlayerId.has(playerId);

    const computed =
      floorCleared * 1000 +
      kills * 10 +
      (this.bossKilled ? 5000 : 0) +
      (noDeath ? 2000 : 0);

    return Math.max(baseScore, computed);
  }

  private async applyHighStakesAttunementsForRun(
    targetPlayerId?: string | null
  ) {
    const config = getDailyRunsConfig();
    if (!config.enabled || !this.currentGameId) {
      this.highStakesPlayerIds.clear();
      this.highStakesDateByPlayerId.clear();
      this.highStakesBossBonusByPlayerId.clear();
      return;
    }

    const date = this.getDailyRunDate();
    const difficultyId = this.state.difficultyTier;
    const playerIds = targetPlayerId
      ? [targetPlayerId]
      : Array.from(this.state.players.keys())
          .map((sessionId) => this.getPlayerIdForSession(sessionId))
          .filter((id): id is string => Boolean(id));

    if (!targetPlayerId) {
      this.highStakesPlayerIds.clear();
      this.highStakesDateByPlayerId.clear();
      this.highStakesBossBonusByPlayerId.clear();
    }

    for (const playerId of playerIds) {
      try {
        await dailyHighStakesStateRepo.ensureState({
          date,
          accountId: playerId,
          attunementsPerDay: config.attunementsPerDay,
        });
        const state = await dailyHighStakesStateRepo.markRunActive({
          date,
          accountId: playerId,
          difficultyId,
          runId: this.currentGameId!,
        });
        if (state && state.activeRunId === this.currentGameId) {
          this.highStakesPlayerIds.add(playerId);
          this.highStakesDateByPlayerId.set(playerId, date);
        }
      } catch (error) {
        console.error('Failed to mark high-stakes run active', {
          playerId,
          difficultyId,
          date,
          error,
        });
      }
    }
  }

  private async clearHighStakesForRun() {
    if (this.highStakesPlayerIds.size === 0) {
      return;
    }

    const config = getDailyRunsConfig();
    if (!config.enabled) {
      this.highStakesPlayerIds.clear();
      this.highStakesDateByPlayerId.clear();
      return;
    }

    const runId = this.currentGameId;
    const fallbackDate = this.getDailyRunDate();
    for (const playerId of Array.from(this.highStakesPlayerIds)) {
      const date = this.highStakesDateByPlayerId.get(playerId) ?? fallbackDate;
      try {
        await dailyHighStakesStateRepo.clearActiveRun({
          date,
          accountId: playerId,
          runId: runId ?? undefined,
        });
      } catch (error) {
        console.error('Failed to clear high-stakes state', {
          playerId,
          date,
          runId,
          error,
        });
      } finally {
        this.highStakesPlayerIds.delete(playerId);
        this.highStakesDateByPlayerId.delete(playerId);
      }
    }
  }

  private async handleHighStakesBossKill(_killerSessionId?: string) {
    const config = getDailyRunsConfig();
    if (!config.enabled || !this.currentGameId) {
      return;
    }

    const difficultyId = this.state.difficultyTier;
    const todayDate = this.getDailyRunDate();

    // Reset any previous bonuses for this run; we'll recompute them below.
    this.highStakesBossBonusByPlayerId.clear();

    const reference = await getReferenceScore({
      difficultyId,
    });

    const entries: Array<{
      playerId: string;
      sessionId: string;
      stats: GamePlayerRuntimeStats | null;
      runScore: number;
      isHighStakes: boolean;
    }> = [];

    this.state.players.forEach((_player, sessionId) => {
      const playerId = this.getPlayerIdForSession(sessionId);
      if (!playerId) {
        return;
      }
      const stats = this.cloneRuntimeStats(sessionId);
      const runScore = this.computeRunScoreForPlayer(playerId, stats);
      entries.push({
        playerId,
        sessionId,
        stats,
        runScore,
        isHighStakes: this.highStakesPlayerIds.has(playerId),
      });
    });

    let bestScore = 0;
    let bestPlayerId: string | null = null;
    for (const entry of entries) {
      if (entry.runScore > bestScore) {
        bestScore = entry.runScore;
        bestPlayerId = entry.playerId;
      }
    }

    if (bestScore > 0) {
      try {
        await dailyBossHighScoresRepo.upsertHighScore({
          date: todayDate,
          difficultyId,
          score: bestScore,
          accountId: bestPlayerId,
          runId: this.currentGameId,
        });
      } catch (error) {
        console.error('Failed to upsert daily boss high score', {
          difficultyId,
          score: bestScore,
          playerId: bestPlayerId,
          runId: this.currentGameId,
          error,
        });
      }
    }

    const thresholdScore = reference.thresholdScore;

    for (const entry of entries) {
      const dailyRunsMeta: Record<string, unknown> = {
        runScore: entry.runScore,
        referenceScore: reference.referenceScore,
        referenceDate: reference.referenceDate,
        referenceSource: reference.source,
        thresholdScore,
        thresholdFraction: reference.thresholdFraction,
        isHighStakes: entry.isHighStakes,
      };

      if (entry.isHighStakes) {
        const payout = computeHighStakesBossPayout({
          difficultyId,
          runScore: entry.runScore,
          referenceScore: reference.referenceScore,
          thresholdFraction: reference.thresholdFraction,
        });

        const payoutUsdc = Math.max(0, payout.usdc);
        const payoutGhst = Math.max(0, payout.ghst);

        if (payoutUsdc > 0 || payoutGhst > 0) {
          this.highStakesBossBonusByPlayerId.set(entry.playerId, {
            usdc: payoutUsdc,
            ghst: payoutGhst,
          });
        }

        dailyRunsMeta.payoutUSDC = payoutUsdc;
        dailyRunsMeta.payoutGHST = payoutGhst;
        dailyRunsMeta.ratio = payout.ratio;
        dailyRunsMeta.consumed = true;

        await this.persistPlayerRunScore({
          playerId: entry.playerId,
          sessionId: entry.sessionId,
          statsSnapshot: entry.stats,
          partySize: this.state.players.size,
          reason: 'boss_kill',
          extraMetadata: { dailyRuns: dailyRunsMeta },
        });

        const trackedDate =
          this.highStakesDateByPlayerId.get(entry.playerId) ?? todayDate;
        try {
          await dailyHighStakesStateRepo.clearActiveRun({
            date: trackedDate,
            accountId: entry.playerId,
            runId: this.currentGameId,
          });
        } catch (error) {
          console.error('Failed to clear consumed high-stakes attunement', {
            playerId: entry.playerId,
            trackedDate,
            runId: this.currentGameId,
            error,
          });
        } finally {
          this.highStakesPlayerIds.delete(entry.playerId);
          this.highStakesDateByPlayerId.delete(entry.playerId);
        }
      } else {
        await this.persistPlayerRunScore({
          playerId: entry.playerId,
          sessionId: entry.sessionId,
          statsSnapshot: entry.stats,
          partySize: this.state.players.size,
          reason: 'boss_kill',
          extraMetadata: { dailyRuns: dailyRunsMeta },
        });
      }
    }

    // Clear any attuned players who were not present for the boss kill
    if (this.highStakesPlayerIds.size > 0) {
      await this.clearHighStakesForRun();
    }
  }

  private awardXpForEnemyDefeat(
    enemy: any,
    enemyId: string,
    attackType: 'melee' | 'ranged' | 'grenades',
    killerId?: string
  ): Map<string, number> {
    const xpAwardedBySession = new Map<string, number>();
    const partySize = this.state.players.size;
    if (partySize <= 0) {
      return xpAwardedBySession;
    }

    const enemyType = enemy?.enemyType || enemy?.name || 'unknown';
    const enemyStats = getEnemyStats(enemyType);
    const baseXp = Math.max(0, enemyStats.baseXp || 0);
    if (baseXp <= 0) {
      return xpAwardedBySession;
    }

    const totalXpPool =
      baseXp *
      this.getDifficultyXpMultiplier() *
      this.getGroupXpMultiplier(partySize);
    if (!Number.isFinite(totalXpPool) || totalXpPool <= 0) {
      return xpAwardedBySession;
    }

    const sessionIds = Array.from(this.state.players.keys());
    const normalizedKiller =
      killerId && sessionIds.includes(killerId) ? killerId : undefined;
    const leverageForScore = this.getLeverageTotal();

    const shares = new Map<string, number>();
    if (!normalizedKiller || partySize <= 1) {
      const share = totalXpPool / partySize;
      sessionIds.forEach((id) => shares.set(id, share));
    } else {
      const others = sessionIds.filter((id) => id !== normalizedKiller);
      const killerShare = totalXpPool * 0.6;
      shares.set(normalizedKiller, killerShare);

      if (others.length === 0) {
        shares.set(normalizedKiller, totalXpPool);
      } else {
        const perMember = (totalXpPool * 0.4) / others.length;
        others.forEach((id) => shares.set(id, perMember));
      }
    }

    const shouldAwardScore = SCORE_CONFIG.enabled && Boolean(killerId);
    const xpSource = {
      enemyId,
      enemyType: enemyStats.enemyType,
      attackType,
      classification: enemyStats.classification,
    };

    shares.forEach((rawShare, sessionId) => {
      const profile = this.getProgressionProfile(sessionId);
      const xpAmount = Math.round(rawShare);

      // Award score based on raw share so that killing an enemy always increases score
      if (shouldAwardScore && xpAmount > 0) {
        this.queueScoreDelta(sessionId, xpAmount * leverageForScore);
      }

      if (xpAmount <= 0) {
        return;
      }

      const result = applyXpToProfile(profile, xpAmount);
      this.setProgressionProfile(sessionId, result.profile, { persist: false });
      this.recordXpGain(sessionId, xpAmount, result.profile.level);
      this.recordLevelSnapshot(sessionId, result.profile.level);

      xpAwardedBySession.set(sessionId, xpAmount);
      if (result.levelUps > 0) {
        this.applyProgressionToPlayer(sessionId, { fullHeal: true });
      }

      void this.persistProgression(sessionId, result.profile);

      const client = this.getClientBySessionId(sessionId);
      if (client) {
        const levelProgress = getLevelProgress(result.profile.totalXp);
        this.msg.sendTo(client, 'progression:xp_awarded', {
          amount: xpAmount,
          totalXp: result.profile.totalXp,
          level: result.currentLevel,
          levelUps: result.levelUps,
          unspentPoints: result.profile.unspentPoints,
          stats: result.profile.stats,
          allocationHistory: result.profile.allocationHistory,
          levelProgress,
          source: xpSource,
        });
      }
    });

    if (normalizedKiller) {
      const unitDelta = getKillStreakUnitDeltaForClassification(
        enemyStats.classification
      );
      if (unitDelta > 0) {
        this.awardKillStreakUnitsToPlayer(normalizedKiller, unitDelta, {
          enemyId,
          enemyType: enemyStats.enemyType,
          attackType,
          classification: enemyStats.classification,
        });
      }
    }

    return xpAwardedBySession;
  }

  public handlePlayerDeath(sessionId: string, cause: string = 'unknown') {
    if (this.playerDeathsThisRun.has(sessionId)) {
      return;
    }

    const player = this.state.players.get(sessionId);
    if (!player) return;

    this.playerDeathsThisRun.add(sessionId);
    this.recordPlayerDeathStat(sessionId);
    this.markPlayerScoreIneligible(sessionId);

    // Reset kill streak on death
    this.resetKillStreakForSession(sessionId, {
      reason: 'death',
      reinitialize: false,
    });

    this.msg.broadcast('player_died', {
      playerId: sessionId,
      cause,
    });
    const playerId = this.getPlayerIdForSession(sessionId);
    this.logGameEvent('player.death', `${player.name} was defeated`, {
      level: 'warn',
      playerId,
      sessionId,
      details: {
        cause,
        hpAtDeath: player.hp,
      },
    });
  }

  /**
   * Generic resource harvesting method - replaces performTreeChop and performStoneChop
   * Works for any resource type defined in resource-config.ts
   */
  public performResourceHarvest(
    playerId: string,
    resourceId: string,
    resourceType: string
  ): boolean {
    return sysPerformResourceHarvest(
      this as any,
      playerId,
      resourceId,
      resourceType
    );
  }

  private spawnNPCs() {
    sysSpawnNPCs(this as any);
  }

  private spawnNPCsNearAnchor(anchor: { x: number; y: number }) {
    sysSpawnNPCs(this as any, { anchor });
  }

  private getCurrentClientCount(): number {
    const clientsAny = this.clients as any;
    if (Array.isArray(clientsAny)) return clientsAny.length;
    if (typeof clientsAny?.size === 'number') return clientsAny.size;
    if (typeof clientsAny?.length === 'number') return clientsAny.length;
    return this.state?.players?.size || 0;
  }

  private updateMetadata(extra: Record<string, unknown> = {}) {
    this.setMetadata({
      roomId: this.state.id,
      roomCode: this.state.roomCode,
      isPrivate: this.isPrivateRoom,
      region: this.state.region,
      difficultyTier: this.state.difficultyTier,
      hostSessionId: this.state.hostSessionId,
      playerCount: this.getCurrentClientCount(),
      maxPlayers: this.maxClients,
      colyseusRoomId: this.roomId,
      gameId: this.currentGameId,
      phase: this.state.phase,
      autoCloseAt: this.state.autoCloseAt,
      lateJoinCutoffAt: this.state.lateJoinCutoffAt,
      ...extra,
    });
  }

  private async createGameRecord(options: GameRoomOptions = {}) {
    if (this.currentGameId) {
      this.gameStatusFinalized = false;
      this.persistGameMetrics({ syncState: true });
      return;
    }

    const startedAt = this.state.startedAt || Date.now();
    const record = await gamesRepo.create({
      roomId: this.state.id,
      seed: this.state.seed,
      region: this.state.region,
      difficultyTier: this.state.difficultyTier,
      status: 'active',
      isPrivate: this.isPrivateRoom,
      maxPlayers: this.maxClients,
      startedAtIso: new Date(startedAt).toISOString(),
      phase: this.phase,
      phaseChangedAtIso: new Date(this.phaseChangedAt).toISOString(),
      runStartedAtIso: this.runStartedAt
        ? new Date(this.runStartedAt).toISOString()
        : null,
      lateJoinCutoffAtIso:
        this.state.lateJoinCutoffAt > 0
          ? new Date(this.state.lateJoinCutoffAt).toISOString()
          : null,
      autoCloseAtIso:
        this.state.autoCloseAt > 0
          ? new Date(this.state.autoCloseAt).toISOString()
          : null,
      startedByPlayerId: this.state.startedByPlayerId || null,
      metadata: {
        roomCode: this.state.roomCode,
        colyseusRoomId: this.roomId,
      },
    });

    this.currentGameId = record.id;
    this.gameStatusFinalized = false;
    this.persistGameMetrics({ syncState: true });
    this.logGameEvent('game.record.created', 'Game record created', {
      details: {
        roomId: this.state.id,
        region: this.state.region,
        difficultyTier: this.state.difficultyTier,
        isPrivate: this.isPrivateRoom,
        stagingEnabled: this.stagingEnabled,
        maxPlayers: this.maxClients,
      },
    });
  }

  private async registerGamePlayer(
    sessionId: string,
    playerId: string,
    profile: ProgressionProfile,
    player: PlayerSchema
  ) {
    if (!this.currentGameId) {
      return;
    }

    const existingRecord = await gamePlayersRepo.getByGameAndPlayer(
      this.currentGameId,
      playerId
    );

    const existingMetadata = (existingRecord?.metadata ?? {}) as Record<
      string,
      unknown
    >;

    // Note: tier.levelCost is kept for potential future use but not used for pricing
    const tier = getDifficultyTier(this.state.difficultyTier);

    let entryFeeCharged = existingMetadata.entryFeeCharged === true;
    let entryFeeChargedAt =
      typeof existingMetadata.entryFeeChargedAt === 'string'
        ? (existingMetadata.entryFeeChargedAt as string)
        : null;
    const entryFeeCentsRaw = existingMetadata.entryFeeCents;
    let entryFeeCents =
      typeof entryFeeCentsRaw === 'number'
        ? entryFeeCentsRaw
        : typeof entryFeeCentsRaw === 'string'
          ? Number(entryFeeCentsRaw)
          : null;
    if (entryFeeCents != null && !Number.isFinite(entryFeeCents)) {
      entryFeeCents = null;
    }
    const entryFeeRefunded =
      existingMetadata.entryFeeRefunded === true ||
      existingMetadata.entryFeeRefunded === 'true';

    if (
      entryFeeCharged &&
      entryFeeCents != null &&
      !entryFeeRefunded &&
      !this.entryFeeLedger.has(playerId)
    ) {
      this.trackEntryFeeCharge(
        playerId,
        entryFeeCents,
        entryFeeChargedAt,
        this.phase !== 'in_game' && this.phase !== 'ended'
      );
    }

    // Charge entry fee based on wearable rarity (not difficulty)
    if (!entryFeeCharged) {
      const costCents = await getEntryFeeCentsForPlayer(playerId);
      const maxRarity = await getMaxEquippedRarityForPlayer(playerId);
      const wearableCostBracket = getWearableCostBracket(maxRarity);

      // Always charge entry fee (minimum 1 credit for naked players)
      const playerRecord = await playersRepo.getPlayerById(playerId);
      if (!playerRecord) {
        throw new Error('Player not found when charging entry fee');
      }
      if (playerRecord.creditsCents < costCents) {
        const insufficientError: any = new Error('INSUFFICIENT_CREDITS');
        insufficientError.code = 'INSUFFICIENT_CREDITS';
        throw insufficientError;
      }

      const updated = await playersRepo.updateCredits(playerId, -costCents);
      if (!updated) {
        throw new Error('Failed to deduct credits for entry fee');
      }

      entryFeeCharged = true;
      entryFeeChargedAt = new Date().toISOString();
      entryFeeCents = costCents;
      this.trackEntryFeeCharge(
        playerId,
        entryFeeCents,
        entryFeeChargedAt,
        this.phase !== 'in_game' && this.phase !== 'ended'
      );

      const entryCredits = costCents / 100;
      this.logEconomyTransaction({
        playerId,
        currency: 'CREDITS',
        amount: -entryCredits,
        source: 'game_entry',
        gameId: this.currentGameId,
        metadata: {
          difficultyTier: this.state.difficultyTier,
          entryFeeCents: costCents,
          wearableCostBracket,
          entryCredits,
        },
      });
    }

    const joinMetadata: Record<string, unknown> = {
      wallet: player.wallet || null,
      sessionId,
    };

    if (entryFeeCharged) {
      joinMetadata.entryFeeCharged = true;
      if (entryFeeChargedAt) {
        joinMetadata.entryFeeChargedAt = entryFeeChargedAt;
      }
      if (entryFeeCents != null) {
        joinMetadata.entryFeeCents = entryFeeCents;
      }
      joinMetadata.entryFeeDifficulty = this.state.difficultyTier;
    }

    const record = await gamePlayersRepo.join({
      gameId: this.currentGameId,
      playerId,
      characterId: player.characterId,
      levelBefore: profile.level,
      metadata: joinMetadata,
    });

    this.gamePlayerStats.set(sessionId, {
      playerId,
      gamePlayerId: record.id,
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      damageTaken: 0,
      coinsCollected: 0,
      usdcEarnedBaseUnits: 0,
      xpGained: 0,
      levelStart: record.levelBefore ?? profile.level,
      levelEnd: profile.level,
    });

    this.sendKillCountUpdate(sessionId, 0);

    this.recordLevelSnapshot(sessionId, profile.level);
  }

  private sendKillCountUpdate(sessionId: string, kills: number) {
    const client = this.getClientBySessionId(sessionId);
    if (client) {
      this.msg.sendTo(client, 'kill_count_updated', { kills });
    }
  }

  private recordKill(sessionId: string) {
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.kills += 1;
    this.sendKillCountUpdate(sessionId, stats.kills);
  }

  private recordPlayerDeathStat(sessionId: string) {
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.deaths += 1;
  }

  private recordXpGain(
    sessionId: string,
    amount: number,
    resultingLevel: number
  ) {
    if (amount <= 0) return;
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.xpGained += amount;
    stats.levelEnd = resultingLevel;
  }

  private recordLevelSnapshot(sessionId: string, level: number) {
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.levelEnd = level;
  }

  private recordCoinsCollected(sessionId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.coinsCollected += Math.round(amount);
  }

  private recordUsdcEarned(sessionId: string, amountBaseUnits: number) {
    if (!Number.isFinite(amountBaseUnits) || amountBaseUnits <= 0) return;
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) return;
    stats.usdcEarnedBaseUnits += Math.round(amountBaseUnits);
  }

  private logEconomyTransaction(options: {
    playerId: string;
    currency: string;
    amount: number;
    source: string;
    gameId?: string | null;
    lootDistributionId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    if (!options.playerId) return;
    void economyRepo
      .logTransaction({
        playerId: options.playerId,
        currency: options.currency,
        amount: options.amount,
        source: options.source,
        gameId: options.gameId ?? this.currentGameId,
        lootDistributionId: options.lootDistributionId ?? null,
        metadata: options.metadata,
      })
      .catch((error) => {
        console.error('Failed to log economy transaction', {
          playerId: options.playerId,
          currency: options.currency,
          source: options.source,
          error,
        });
      });
  }

  private async flushGamePlayerStats(
    sessionId: string,
    options: { markLeft?: boolean } = {}
  ) {
    const stats = this.gamePlayerStats.get(sessionId);
    if (!stats) {
      return;
    }

    const payload: gamePlayersRepo.ApplyStatsInput = {
      gamePlayerId: stats.gamePlayerId,
      killsDelta: stats.kills || undefined,
      deathsDelta: stats.deaths || undefined,
      damageDealtDelta: stats.damageDealt || undefined,
      damageTakenDelta: stats.damageTaken || undefined,
      coinsCollectedDelta: stats.coinsCollected || undefined,
      usdcEarnedBaseUnitsDelta: stats.usdcEarnedBaseUnits || undefined,
      xpGainedDelta: stats.xpGained || undefined,
      levelAfter: stats.levelEnd,
      markLeft: options.markLeft,
    };

    const shouldUpdate =
      options.markLeft === true ||
      stats.kills !== 0 ||
      stats.deaths !== 0 ||
      stats.damageDealt !== 0 ||
      stats.damageTaken !== 0 ||
      stats.coinsCollected !== 0 ||
      stats.usdcEarnedBaseUnits !== 0 ||
      stats.xpGained !== 0 ||
      stats.levelEnd !== stats.levelStart;

    if (shouldUpdate) {
      try {
        await gamePlayersRepo.applyStats(payload);
      } catch (error) {
        console.error('Failed to persist game player stats', {
          gamePlayerId: stats.gamePlayerId,
          sessionId,
          error,
        });
      }
    }

    if (options.markLeft) {
      this.gamePlayerStats.delete(sessionId);
    } else {
      stats.kills = 0;
      stats.deaths = 0;
      stats.damageDealt = 0;
      stats.damageTaken = 0;
      stats.coinsCollected = 0;
      stats.usdcEarnedBaseUnits = 0;
      stats.xpGained = 0;
      stats.levelStart = stats.levelEnd;
    }
  }

  private persistGameMetrics(
    options: { totalEnemyKillsDelta?: number; syncState?: boolean } = {}
  ) {
    if (!this.currentGameId || this.gameStatusFinalized) {
      return;
    }

    const payload: gamesRepo.UpdateMetricsInput = {
      gameId: this.currentGameId,
      floorReached: this.getFloorReached(),
    };

    if (
      typeof options.totalEnemyKillsDelta === 'number' &&
      options.totalEnemyKillsDelta !== 0
    ) {
      payload.totalEnemyKillsDelta = options.totalEnemyKillsDelta;
    }

    if (options.syncState) {
      payload.nextTimedSpawnAt =
        this.state.nextTimedSpawnAt && this.state.nextTimedSpawnAt > 0
          ? new Date(this.state.nextTimedSpawnAt).toISOString()
          : null;
      payload.difficultyTier = this.state.difficultyTier;
      payload.phase = this.state.phase;
      payload.phaseChangedAtIso = new Date(this.phaseChangedAt).toISOString();
      payload.runStartedAtIso = this.runStartedAt
        ? new Date(this.runStartedAt).toISOString()
        : null;
      payload.lateJoinCutoffAtIso =
        this.state.lateJoinCutoffAt > 0
          ? new Date(this.state.lateJoinCutoffAt).toISOString()
          : null;
      payload.autoCloseAtIso =
        this.state.autoCloseAt > 0
          ? new Date(this.state.autoCloseAt).toISOString()
          : null;
      payload.startedByPlayerId = this.state.startedByPlayerId || null;
    }

    if (payload.totalEnemyKillsDelta === undefined && !options.syncState) {
      return;
    }

    void gamesRepo.updateMetrics(payload).catch((error) => {
      console.error('Failed to update game metrics', {
        gameId: this.currentGameId,
        error,
      });
    });
  }

  private async syncGameMetricsImmediate() {
    if (!this.currentGameId) {
      return;
    }
    try {
      await gamesRepo.updateMetrics({
        gameId: this.currentGameId,
        floorReached: this.getFloorReached(),
        nextTimedSpawnAt:
          this.state.nextTimedSpawnAt && this.state.nextTimedSpawnAt > 0
            ? new Date(this.state.nextTimedSpawnAt).toISOString()
            : null,
        difficultyTier: this.state.difficultyTier,
        phase: this.state.phase,
        phaseChangedAtIso: new Date(this.phaseChangedAt).toISOString(),
        runStartedAtIso: this.runStartedAt
          ? new Date(this.runStartedAt).toISOString()
          : null,
        lateJoinCutoffAtIso:
          this.state.lateJoinCutoffAt > 0
            ? new Date(this.state.lateJoinCutoffAt).toISOString()
            : null,
        autoCloseAtIso:
          this.state.autoCloseAt > 0
            ? new Date(this.state.autoCloseAt).toISOString()
            : null,
        startedByPlayerId: this.state.startedByPlayerId || null,
      });
    } catch (error) {
      console.error('Failed to sync game metrics immediately', {
        gameId: this.currentGameId,
        error,
      });
    }
  }

  public recordPostKillMetrics() {
    this.persistGameMetrics({ syncState: true });
  }

  public syncGameMetrics() {
    this.persistGameMetrics({ syncState: true });
  }

  private async recordEnemyKill(
    enemy: any,
    enemyId: string,
    attackType: 'melee' | 'ranged' | 'grenades',
    killerSessionId?: string,
    scoreAwardedBySession?: Map<string, number>
  ): Promise<string | null> {
    if (!this.currentGameId) {
      return null;
    }

    const playerId = killerSessionId
      ? this.getPlayerIdForSession(killerSessionId)
      : undefined;
    const location = {
      x: typeof enemy?.x === 'number' ? enemy.x : 0,
      y: typeof enemy?.y === 'number' ? enemy.y : 0,
    };

    const scoreAwarded =
      killerSessionId && scoreAwardedBySession
        ? (scoreAwardedBySession.get(killerSessionId) ?? null)
        : null;
    let scoreTotal: number | null = null;
    if (killerSessionId && playerId) {
      const scoreState = this.playerScoreStateByPlayerId.get(playerId);
      if (scoreState) {
        scoreTotal = Math.max(0, Math.floor(scoreState.score ?? 0));
      }
    }

    try {
      const record = await enemyKillsRepo.logKill({
        gameId: this.currentGameId,
        playerId: playerId ?? null,
        enemyType: enemy?.enemyType || enemy?.name || 'unknown',
        enemyId,
        attackType,
        weaponType: enemy?.weaponType ?? null,
        location,
        metadata: {
          killerSessionId: killerSessionId ?? null,
          scoreAwarded,
          scoreTotal,
          isBossEncounter: Boolean((enemy as any)?.isBossEncounter),
        },
      });

      const previous = this.recentEnemyKillIds.get(enemyId);
      if (previous?.timeout) {
        clearTimeout(previous.timeout);
      }
      const timeout = setTimeout(() => {
        this.recentEnemyKillIds.delete(enemyId);
      }, 60_000);
      this.recentEnemyKillIds.set(enemyId, { id: record.id, timeout });

      return record.id;
    } catch (error) {
      console.error('Failed to log enemy kill', {
        gameId: this.currentGameId,
        enemyId,
        error,
      });
      return null;
    }
  }

  public async registerEnemyDrop(options: {
    entityId: string;
    enemyId: string;
    enemyType: string;
    dropTable?: string | null;
    rolledWeight?: number | null;
    item?: InventoryItemPayload;
  }) {
    if (!this.currentGameId) {
      return;
    }

    const killEntry = this.recentEnemyKillIds.get(options.enemyId);
    const enemyKillId = killEntry?.id ?? null;

    let distributionId: string | null = null;

    try {
      const distribution = await lootDistributionsRepo.createPending({
        source: 'enemy_drop',
        gameId: this.currentGameId,
        playerId: null,
        lootId: null,
        amount: Number(options.item?.quantity) || 1,
        probability: null,
        expectedValue: null,
        entityId: options.entityId,
        claimed: false,
        metadata: {
          item: options.item ?? null,
          enemyType: options.enemyType,
          dropTable: options.dropTable ?? null,
        },
      });

      distributionId = distribution.id;

      const existing = this.entityLootDistributions.get(options.entityId);
      if (existing?.timeout) {
        clearTimeout(existing.timeout);
      }
      const timeout = setTimeout(() => {
        this.entityLootDistributions.delete(options.entityId);
      }, 10 * 60_000);
      this.entityLootDistributions.set(options.entityId, {
        distributionId,
        timeout,
        source: 'enemy_drop',
        metadata: {
          enemyType: options.enemyType,
          dropTable: options.dropTable ?? null,
          item: options.item ?? null,
        },
      });
    } catch (error) {
      console.error('Failed to create loot distribution for enemy drop', {
        gameId: this.currentGameId,
        enemyId: options.enemyId,
        entityId: options.entityId,
        error,
      });
    }

    try {
      await enemyDropsRepo.logDrop({
        gameId: this.currentGameId,
        enemyKillId,
        lootDistributionId: distributionId,
        enemyType: options.enemyType,
        dropTable: options.dropTable ?? null,
        rolledWeight: options.rolledWeight ?? null,
      });
    } catch (error) {
      console.error('Failed to log enemy drop', {
        gameId: this.currentGameId,
        enemyId: options.enemyId,
        entityId: options.entityId,
        error,
      });
    }
  }

  private async finalizeGameStatus(
    status: string,
    metadata: Record<string, unknown> = {}
  ) {
    if (!this.currentGameId || this.gameStatusFinalized) {
      return;
    }

    await this.syncGameMetricsImmediate();
    await this.clearHighStakesForRun();

    const durationMs = Date.now() - (this.state.startedAt || Date.now());

    try {
      await gamesRepo.markStatus({
        gameId: this.currentGameId,
        status,
        metadata: {
          totalEnemyKills: this.state.totalEnemyKills,
          durationMs,
          hadPlayers: this.hadAnyPlayers,
          bossKilled: this.bossKilled,
          ...metadata,
        },
      });
      this.gameStatusFinalized = true;
    } catch (error) {
      console.error('Failed to finalize game status', {
        gameId: this.currentGameId,
        status,
        error,
      });
    }
  }

  private generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private respawnBot(bot: PlayerSchema) {
    sysRespawnBot(this as any, bot);
  }

  private handleStartAction(
    client: Client,
    data: { type: string; targetId?: string; payload?: any }
  ) {
    if (DEBUG) {
      console.log(
        `🎬 Received startAction command from ${client.sessionId}: type=${data.type}, targetId=${data.targetId ?? 'n/a'}`
      );
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) {
      console.warn(`❌ Player not found for session ${client.sessionId}`);
      return;
    }

    if (data.type === 'cast_spell') {
      const payload = (
        data && typeof data.payload === 'object' ? data.payload : {}
      ) as Record<string, unknown>;
      const rawSpellId = payload?.spellId;
      const spellId =
        typeof rawSpellId === 'string' && rawSpellId.trim().length > 0
          ? rawSpellId.trim()
          : null;
      const targetIdRaw =
        typeof payload?.targetId === 'string' &&
        payload.targetId.trim().length > 0
          ? payload.targetId.trim()
          : typeof data.targetId === 'string'
            ? data.targetId
            : undefined;

      if (!spellId) {
        client.send('spell_cast_result', {
          ok: false,
          spellId: rawSpellId ?? '',
          reason: 'missing_spell',
        });
        return;
      }

      const result = handleManualSpellCast(this, player, {
        spellId,
        targetId: targetIdRaw,
      });

      client.send('spell_cast_result', {
        ok: result.ok,
        spellId,
        reason: result.reason,
      });
      return;
    }

    // Prevent duplicate attack starts: if already attacking same target, ignore
    if (
      data.type === 'attack_enemy' &&
      typeof data.targetId === 'string' &&
      player.currentAction === 'attack_enemy' &&
      player.actionTarget === data.targetId
    ) {
      if (DEBUG) {
        console.log(
          `🛑 Ignoring duplicate attack start for ${player.name} on ${data.targetId}`
        );
      }
      return;
    }

    // Skip starting new actions while transitioning rooms
    if ((this as any).isRoomTransitioning) {
      if (DEBUG) {
        console.log(
          `🧭 Ignoring ${data.type} during room transition for ${player.name}`
        );
      }
      return;
    }

    // Cancel any existing action first
    if (this.actionManager.hasActiveAction(player)) {
      this.actionManager.cancelAction(player, this, 'Starting new action');
    }

    // Create the requested action with character-specific stats and weapon type
    let derivedStats: Record<string, any> | null = null;
    if (player.derivedStats) {
      try {
        derivedStats = JSON.parse(player.derivedStats);
      } catch (error) {
        console.warn('Failed to parse player derivedStats JSON', error);
      }
    }

    const action = ActionFactory.createAction(
      data.type,
      data.targetId,
      player.characterId,
      player.attackType,
      data.payload,
      { derivedStats }
    );
    if (!action) {
      console.warn(`❌ Unknown action type: ${data.type}`);
      return;
    }

    // Start the action
    const success = this.actionManager.startAction(player, action, this);

    if (success) {
      console.log(`✅ Action ${data.type} started for player ${player.name}`);
    } else {
      console.warn(
        `❌ Failed to start action ${data.type} for player ${player.name}`
      );
    }
  }

  private async handleNpcPurchase(
    client: Client,
    rawData: { npcId: string; itemId: string }
  ) {
    const sessionId = client.sessionId;
    const npcId =
      rawData && typeof rawData.npcId === 'string' ? rawData.npcId : null;
    const itemId =
      rawData && typeof rawData.itemId === 'string' ? rawData.itemId : null;

    const respond = (response: {
      ok: boolean;
      reason?: string;
      dialogueKey?: string;
      item?: Record<string, unknown>;
      price?: number;
      currency?: string;
      balance?: number;
    }) => {
      client.send('npc_purchase_result', {
        npcId,
        itemId,
        ...response,
      });
    };

    if (!npcId || !itemId) {
      respond({
        ok: false,
        reason: 'invalid_request',
        dialogueKey: 'purchase_fail',
        currency: 'Gold',
      });
      return;
    }

    const now = Date.now();
    const lastAttempt = this.npcPurchaseCooldowns.get(sessionId) ?? 0;
    if (now - lastAttempt < NPC_PURCHASE_COOLDOWN_MS) {
      return;
    }
    this.npcPurchaseCooldowns.set(sessionId, now);

    const player = this.state.players.get(sessionId);
    if (!player) {
      respond({
        ok: false,
        reason: 'player_not_found',
        dialogueKey: 'purchase_fail',
        currency: 'Gold',
      });
      return;
    }

    const npc = this.state.npcs.get(npcId);
    if (!npc) {
      respond({
        ok: false,
        reason: 'npc_not_found',
        dialogueKey: 'purchase_fail',
        currency: 'Gold',
      });
      return;
    }

    const npcCharacterId = String((npc as any).characterId ?? '');
    const npcDialogueId = String((npc as any).dialogueId ?? npcCharacterId);
    if (npcCharacterId !== 'portalmage' && npcDialogueId !== 'portalmage') {
      respond({
        ok: false,
        reason: 'invalid_npc',
        dialogueKey: 'purchase_fail',
        currency: 'Gold',
      });
      return;
    }

    const dx = player.x - (npc as any).x;
    const dy = player.y - (npc as any).y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > NPC_INTERACTION_RANGE_PX * NPC_INTERACTION_RANGE_PX) {
      respond({
        ok: false,
        reason: 'out_of_range',
        dialogueKey: 'purchase_out_of_range',
        currency: 'Gold',
      });
      return;
    }

    const shopItem: ShopItemDefinition | undefined =
      PORTAL_MAGE_SHOP_BY_ID.get(itemId);
    if (!shopItem) {
      respond({
        ok: false,
        reason: 'not_for_sale',
        dialogueKey: 'purchase_fail',
        currency: 'Gold',
      });
      return;
    }

    const currencyName = shopItem.currency.name;
    const inventory = this.playerInventories.get(sessionId) ?? [];
    const availableCurrency = this.getCurrencyQuantity(inventory, currencyName);

    if (availableCurrency < shopItem.price) {
      respond({
        ok: false,
        reason: 'insufficient_funds',
        dialogueKey: 'purchase_insufficient',
        price: shopItem.price,
        currency: currencyName,
        balance: availableCurrency,
      });
      return;
    }

    const currencyInventoryItem = this.findCurrencyInventoryItem(
      inventory,
      currencyName
    );
    if (!currencyInventoryItem) {
      respond({
        ok: false,
        reason: 'insufficient_funds',
        dialogueKey: 'purchase_insufficient',
        price: shopItem.price,
        currency: currencyName,
        balance: availableCurrency,
      });
      return;
    }

    const normalizedCurrencyType = this.normalizeCurrencyType(
      currencyInventoryItem.type ?? currencyInventoryItem.itemType
    );
    const currencyItemName =
      currencyInventoryItem.name ?? shopItem.currency.name;

    const currencyPayload: InventoryItemPayload = {
      ...currencyInventoryItem,
      type: normalizedCurrencyType,
      itemType: normalizedCurrencyType,
      name: currencyItemName,
    };

    const spendAmount = Number(shopItem.price);
    const grantQuantity = Number(shopItem.grant.quantity) || 1;
    const grantPayload: InventoryItemPayload = {
      ...shopItem.grant,
    };

    try {
      await this.applyInventoryDelta(sessionId, currencyPayload, -spendAmount);
    } catch (error) {
      console.error('Failed to deduct currency for NPC purchase', {
        sessionId,
        npcId,
        itemId,
        spendAmount,
        error,
      });
      respond({
        ok: false,
        reason: 'transaction_failed',
        dialogueKey: 'purchase_fail',
        price: shopItem.price,
        currency: currencyName,
        balance: availableCurrency,
      });
      return;
    }

    try {
      await this.applyInventoryDelta(sessionId, grantPayload, grantQuantity);
    } catch (error) {
      console.error('Failed to grant item for NPC purchase', {
        sessionId,
        npcId,
        itemId,
        error,
      });
      try {
        await this.applyInventoryDelta(sessionId, currencyPayload, spendAmount);
      } catch (refundError) {
        console.error(
          'Failed to refund currency after purchase grant failure',
          {
            sessionId,
            npcId,
            itemId,
            refundError,
          }
        );
      }

      respond({
        ok: false,
        reason: 'grant_failed',
        dialogueKey: 'purchase_fail',
        price: shopItem.price,
        currency: currencyName,
        balance: this.getCurrencyQuantity(
          this.playerInventories.get(sessionId),
          currencyName
        ),
      });
      return;
    }

    const updatedInventory = this.playerInventories.get(sessionId) ?? [];
    const updatedBalance = this.getCurrencyQuantity(
      updatedInventory,
      currencyName
    );
    const resultItem = this.mapShopItemToResult(shopItem, grantQuantity);

    const playerId = this.getPlayerIdForSession(sessionId);
    if (playerId) {
      this.logEconomyTransaction({
        playerId,
        currency: currencyName,
        amount: -spendAmount,
        source: 'npc_shop:portalmage',
        metadata: {
          npcId,
          shopItemId: shopItem.id,
          shopItemName: shopItem.label,
          currencyItemName,
        },
      });
    }

    respond({
      ok: true,
      dialogueKey: 'purchase_ok',
      item: resultItem,
      price: shopItem.price,
      currency: currencyName,
      balance: updatedBalance,
    });
  }

  private handleNPCInteraction(
    client: Client,
    data: { npcId: string; dialogueId: string }
  ) {
    sysHandleNPCInteraction(this as any, client, data);
  }

  private getCurrencyQuantity(
    inventory: InventoryItemPayload[] | undefined,
    currencyName: string
  ): number {
    if (!inventory || inventory.length === 0) {
      return 0;
    }

    return inventory.reduce((total, item) => {
      if (!this.isGoldCurrencyItem(item, currencyName)) {
        return total;
      }
      const quantity = Number(item?.quantity);
      if (!Number.isFinite(quantity)) {
        return total;
      }
      return total + Math.max(0, Math.floor(quantity));
    }, 0);
  }

  private findCurrencyInventoryItem(
    inventory: InventoryItemPayload[] | undefined,
    currencyName: string
  ): InventoryItemPayload | undefined {
    if (!inventory) {
      return undefined;
    }

    return inventory.find((item) =>
      this.isGoldCurrencyItem(item, currencyName)
    );
  }

  private isGoldCurrencyItem(
    item: InventoryItemPayload | null | undefined,
    currencyName?: string | null
  ): boolean {
    if (!item) {
      return false;
    }
    const typeRaw = item.type ?? item.itemType;
    const normalizedType =
      typeof typeRaw === 'string' ? typeRaw.trim().toLowerCase() : '';
    if (normalizedType && GOLD_CURRENCY_TYPES.has(normalizedType)) {
      if (!currencyName) {
        return true;
      }
      return this.currencyNamesMatch(item.name ?? item.id, currencyName);
    }
    if (!currencyName) {
      return false;
    }
    // Fallback to name-based matching for legacy data.
    return this.currencyNamesMatch(item.name ?? item.id, currencyName);
  }

  private normalizeCurrencyType(value: unknown): string {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized) {
        return normalized;
      }
    }
    return 'coin';
  }

  private currencyNamesMatch(
    existingName: string | null | undefined,
    targetName: string | null | undefined
  ): boolean {
    const normalizedExisting = this.normalizeCurrencyName(existingName);
    const normalizedTarget = this.normalizeCurrencyName(targetName);
    if (!normalizedExisting || !normalizedTarget) {
      return false;
    }
    if (normalizedExisting === normalizedTarget) {
      return true;
    }
    if (
      GOLD_NAME_ALIASES.has(normalizedExisting) &&
      GOLD_NAME_ALIASES.has(normalizedTarget)
    ) {
      return true;
    }
    return false;
  }

  private normalizeCurrencyName(
    value: string | null | undefined
  ): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = String(value).trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }

  private mapShopItemToResult(
    shopItem: ShopItemDefinition,
    quantity: number
  ): Record<string, unknown> {
    const type = String(
      shopItem.grant.type ?? shopItem.grant.itemType ?? 'material'
    ).toLowerCase();

    const color =
      (typeof shopItem.grant.color === 'string'
        ? shopItem.grant.color
        : undefined) ?? this.getDefaultItemColor(type);

    const wearableSlug =
      (shopItem.grant as Record<string, unknown>).wearableSlug &&
      typeof (shopItem.grant as Record<string, unknown>).wearableSlug ===
        'string'
        ? ((shopItem.grant as Record<string, unknown>).wearableSlug as string)
        : undefined;

    return {
      id:
        shopItem.grant.id ?? `${type}:${shopItem.grant.name ?? shopItem.label}`,
      name: shopItem.grant.name ?? shopItem.label,
      type,
      quantity,
      color,
      description: shopItem.description ?? shopItem.grant.description,
      rarity: shopItem.grant.rarity,
      wearableId: shopItem.grant.wearableId,
      wearableSlug,
      imageUrl: shopItem.grant.imageUrl,
      spriteId: shopItem.grant.spriteId,
    };
  }

  private getDefaultItemColor(type: string): string {
    const normalized = String(type ?? '').toLowerCase();
    const palette = ITEM_COLORS as Record<string, string>;
    return palette[normalized] ?? '#ffffff';
  }

  private async loadChunkSetsForRuntime(): Promise<{
    dungeon: any[];
    grass: any[];
    staging?: any[];
  }> {
    // Prefer generated dungeon chunks from blueprints via client API
    const apiBase = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
    try {
      const dungeon = await fetchGeneratedDungeonChunks(apiBase);
      const grass = loadMapChunks('chunks-grass.ts');
      const staging = loadMapChunks('chunks-staging.ts');
      return { dungeon, grass, staging };
    } catch (error) {
      console.error(
        'Failed to fetch generated dungeon chunks; falling back to disk files',
        error
      );
      return {
        dungeon: [],
        grass: loadMapChunks('chunks-grass.ts'),
        staging: loadMapChunks('chunks-staging.ts'),
      };
    }
  }
}
