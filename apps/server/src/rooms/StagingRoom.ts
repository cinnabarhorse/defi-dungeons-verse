import { EntitySchema, NPCSchema, PlayerSchema } from '../schemas';
import { EntityKind } from '../types';
import { PortalEntityState } from '../types';
import { loadStagingChunks } from '../data/maps-loader';
import { getCharacterStats } from '../lib/character-registry';
import { playersRepo, gamePlayersRepo } from '../lib/db';
import { spawnNPCsFromConfigs } from '../lib/systems/NPCSystem';
import { OBSTACLE_CONFIGS } from '../data/obstacles';
import { ensureServerBroadcaster } from '../lib/messaging';

/**
 * Initialize the staging environment inside an existing GameRoom instance.
 * Keeps all authoritative state/timers on the room; this module is stateless.
 */
export function initializeStagingEnvironment(
  room: any,
  countdownMs: number
): void {
  const STAGING_CHUNKS = loadStagingChunks();
  const cellSize = 32;
  const DEFAULT_STAGING_PORTAL_SOUND_RADIUS = 420;
  room.state.entities.clear();
  room.state.npcs.clear();
  room.state.enemies.clear();
  room.state.projectiles.clear();

  // Expand chunks by instances and arrange into a simple grid
  const expanded: Array<{ chunk: any }> = [];
  (STAGING_CHUNKS as any[]).forEach((c: any) => {
    const count = Math.max(0, Number(c?.instances) || 0);
    for (let i = 0; i < count; i++) expanded.push({ chunk: c });
  });

  // Fallback: if no instances specified, use a single default chunk
  if (expanded.length === 0) {
    const fallbackChunk =
      (STAGING_CHUNKS as any[]).find((c: any) => c?.name === 'staging-room') ||
      (STAGING_CHUNKS as any[])[0];
    if (!fallbackChunk) {
      console.warn('⚠️ No staging chunk data available.');
      return;
    }
    expanded.push({ chunk: fallbackChunk });
  }

  // Compute grid size (square-ish)
  const total = expanded.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / columns));

  // Build layout data and place non-floor assets with proper offsets
  room.stagingSpawnPoints = [];
  room.stagingChunkLayoutData = [];

  let portalWorldX: number | null = null;
  let portalWorldY: number | null = null;
  // Source-of-truth for staging entry: prefer explicit wooden_entrance placement
  let portalAssetId: string | undefined;
  let portalSprite: string | undefined;
  let portalFrameCount: number | undefined;
  let portalSoundRadius: number | undefined;
  let portalSoundHysteresis: number | undefined;
  let portalSoundBaseVolume: number | undefined;

  const npcSpawns: Array<{
    characterId: string;
    x: number;
    y: number;
    dialogueId?: string;
  }> = [];

  expanded.forEach(({ chunk }, index) => {
    const gridX = index % columns;
    const gridY = Math.floor(index / columns);
    room.stagingChunkLayoutData.push({
      x: gridX,
      y: gridY,
      chunkName: chunk.name,
    });

    const offsetX = gridX * (chunk.width * cellSize);
    const offsetY = gridY * (chunk.height * cellSize);

    (chunk.assets as any[]).forEach((asset: any) => {
      if (!asset || asset.category === 'floors') return;

      // Compute both tile-origin (top-left) and tile-center coordinates.
      // For obstacle entities, we use tile-origin to match MapGenerator expectations
      // so server collision math (which adds width/height offsets) remains correct.
      const tileOriginX = asset.x * cellSize + offsetX;
      const tileOriginY = asset.y * cellSize + offsetY;
      const tileCenterX = tileOriginX + cellSize / 2;
      const tileCenterY = tileOriginY + cellSize / 2;

      if (asset.isSpawnPoint) {
        room.stagingSpawnPoints.push({ x: tileCenterX, y: tileCenterY });
        return;
      }

      if (asset.isCharacter) {
        npcSpawns.push({
          characterId: asset.assetId,
          x: tileCenterX,
          y: tileCenterY,
        });
        return;
      }

      // Use explicit spawn-portals category first (legacy), but prefer wooden_entrance
      if (asset.category === 'spawn-portals' && portalWorldX === null) {
        portalWorldX = tileCenterX;
        portalWorldY = tileCenterY;
        portalAssetId = asset.assetId as any;
        portalSprite = asset.sprite as any;
        portalFrameCount = (asset as any)?.frameCount as any;
        if (typeof (asset as any).soundRadius !== 'undefined') {
          const sr = Number((asset as any).soundRadius);
          if (Number.isFinite(sr)) {
            portalSoundRadius = sr;
          }
        }
        if (typeof (asset as any).soundHysteresis !== 'undefined') {
          const sh = Number((asset as any).soundHysteresis);
          if (Number.isFinite(sh)) {
            portalSoundHysteresis = sh;
          }
        }
        if (typeof (asset as any).soundBaseVolume !== 'undefined') {
          const sbv = Number((asset as any).soundBaseVolume);
          if (Number.isFinite(sbv)) {
            portalSoundBaseVolume = sbv;
          }
        }
        return;
      }

      // Prefer a specifically authored wooden_entrance as the staging portal entry
      if (
        asset.category === 'special' &&
        asset.assetId === 'wooden_entrance' &&
        portalWorldX === null
      ) {
        portalWorldX = tileCenterX;
        portalWorldY = tileCenterY;
        portalAssetId = asset.assetId as any;
        portalSprite = asset.sprite as any;
        portalFrameCount = (asset as any)?.frameCount as any;
        if (typeof (asset as any).soundRadius !== 'undefined') {
          const sr = Number((asset as any).soundRadius);
          if (Number.isFinite(sr)) {
            portalSoundRadius = sr;
          }
        }
        if (typeof (asset as any).soundHysteresis !== 'undefined') {
          const sh = Number((asset as any).soundHysteresis);
          if (Number.isFinite(sh)) {
            portalSoundHysteresis = sh;
          }
        }
        if (typeof (asset as any).soundBaseVolume !== 'undefined') {
          const sbv = Number((asset as any).soundBaseVolume);
          if (Number.isFinite(sbv)) {
            portalSoundBaseVolume = sbv;
          }
        }
        // Do NOT return here; we still want the visual obstacle entity skipped below
        // by early-exiting its addition so we don't duplicate visuals.
      }

      // If this asset is the wooden_entrance designated as portal, skip spawning it as an obstacle entity.
      if (
        !(
          asset.category === 'special' &&
          asset.assetId === 'wooden_entrance' &&
          portalWorldX === tileCenterX &&
          portalWorldY === tileCenterY
        )
      ) {
        const entity = new EntitySchema();
        entity.id = `${chunk.name}_${gridX}_${gridY}_${asset.id}`;
        entity.kind = EntityKind.OBSTACLE as any;
        entity.x = tileOriginX;
        entity.y = tileOriginY;

        // Classify asset similar to MapGenerator for correct client rendering
        let type: string = 'special';
        let stateExtra: any = {};
        const assetId = String(asset.assetId || '');

        if (assetId.includes('tree')) {
          type = 'tree';
          stateExtra = {
            treeType: 'green',
            health: 3,
            maxHealth: 3,
            choppedBy: null,
            lastChopTime: 0,
          };
        } else if (assetId.includes('rock') || assetId.includes('crystal')) {
          type = 'stone';
          stateExtra = {
            stoneType: 'rock',
            health: 6,
            maxHealth: 6,
            choppedBy: null,
            lastChopTime: 0,
          };
        } else if (asset.category === 'walls') {
          type = 'special';
          stateExtra = { hasCollision: true };
        } else if (asset.category === 'structures') {
          type = 'structure';
        } else if (asset.category === 'special') {
          type = 'special';
        }

        // Merge obstacle config hints (render layer, collision, depth)
        const conf = OBSTACLE_CONFIGS[assetId as keyof typeof OBSTACLE_CONFIGS];
        if (conf) {
          if (typeof (conf as any).hasCollision !== 'undefined') {
            stateExtra.hasCollision = (conf as any).hasCollision;
          }
          if (typeof (conf as any).renderLayer === 'string') {
            stateExtra.renderLayer = (conf as any).renderLayer;
          }
          if (typeof (conf as any).depthHint === 'number') {
            stateExtra.depthHint = (conf as any).depthHint;
          }
        }

        entity.state = JSON.stringify({
          type,
          assetId: asset.assetId,
          sprite: asset.sprite,
          indestructible: true,
          fromChunk: true,
          // If authored with pixel offsets, forward them so client places
          // visuals exactly as in the editor
          ...(asset &&
          (asset.positionMode === 'pixel' ||
            typeof (asset as any).offsetX === 'number' ||
            typeof (asset as any).offsetY === 'number')
            ? {
                offsetX: Number((asset as any).offsetX || 0),
                offsetY: Number((asset as any).offsetY || 0),
              }
            : {}),
          ...stateExtra,
          chunkName: chunk.name,
          chunkGridX: gridX,
          chunkGridY: gridY,
        });
        room.state.entities.set(entity.id, entity);
      }
    });
  });

  room.chunkLayoutData = room.stagingChunkLayoutData.map((layout: any) => ({
    x: layout.x,
    y: layout.y,
    chunkName: layout.chunkName,
  }));

  // Compute portal fallback to center of the full staging layout
  const firstChunk = expanded[0].chunk;
  const fullWidthPx = columns * (firstChunk.width * cellSize);
  const fullHeightPx = rows * (firstChunk.height * cellSize);
  const portalX = portalWorldX ?? fullWidthPx / 2;
  const portalY = portalWorldY ?? fullHeightPx / 2 - 64;

  const portalEntity = new EntitySchema();
  portalEntity.id = 'staging_portal';
  portalEntity.kind = EntityKind.PORTAL as any;
  portalEntity.x = portalX;
  portalEntity.y = portalY;
  const resolvedPortalSoundRadius =
    typeof portalSoundRadius === 'number' &&
    Number.isFinite(portalSoundRadius) &&
    portalSoundRadius > 0
      ? portalSoundRadius
      : DEFAULT_STAGING_PORTAL_SOUND_RADIUS;
  const resolvedPortalSoundHysteresis =
    typeof portalSoundHysteresis === 'number' &&
    Number.isFinite(portalSoundHysteresis)
      ? portalSoundHysteresis
      : undefined;
  const resolvedPortalSoundBaseVolume =
    typeof portalSoundBaseVolume === 'number' &&
    Number.isFinite(portalSoundBaseVolume)
      ? portalSoundBaseVolume
      : undefined;
  const stagingPortalState: PortalEntityState = {
    label: 'Hold to Enter Dungeon', // action prompt shown near the portal
    interactionRadius: 200, // px distance to allow interaction
    soundRadius: resolvedPortalSoundRadius, // px max audible distance
    ...(typeof resolvedPortalSoundHysteresis === 'number'
      ? { soundHysteresis: resolvedPortalSoundHysteresis }
      : {}),
    ...(typeof resolvedPortalSoundBaseVolume === 'number'
      ? { soundBaseVolume: resolvedPortalSoundBaseVolume }
      : {}),
  };

  portalEntity.state = JSON.stringify({
    type: 'portal',
    portalType: 'staging',
    hasCollision: true,
    staging: true,
    countdownMs,
    assetId: portalAssetId,
    sprite: portalSprite,
    frameCount: portalFrameCount,
    ...stagingPortalState,
  });
  room.state.entities.set(portalEntity.id, portalEntity);

  // Spawn NPCs from chunk assets
  if (npcSpawns.length > 0) {
    spawnNPCsFromConfigs(room, npcSpawns);
  } else {
    // Fallback to legacy staging NPC positions around portal
    spawnStagingNpcs(room, portalX, portalY - 80);
  }
}

export function spawnStagingNpcs(
  room: any,
  centerX: number,
  centerY: number
): void {
  const configs = [
    {
      characterId: 'stani',
      dialogueId: 'stani',
      x: 0,
      y: -60,
      dir: 'down',
    },
  ];

  configs.forEach((config, index) => {
    const npc = new NPCSchema();
    npc.id = `staging_npc_${index}`;
    npc.characterId = config.characterId as any;
    npc.dialogueId = config.dialogueId as any;
    npc.name = config.characterId as any;
    npc.x = centerX + config.x;
    npc.y = centerY + config.y;
    npc.dir = (config.dir as any) ?? 'down';
    npc.anim = 'idle';
    const stats = getCharacterStats(config.characterId);
    npc.hp = stats.maxHealth;
    npc.maxHp = stats.maxHealth;
    npc.attackType = stats.weaponType as any;
    npc.lastAttackTime = 0;
    room.state.npcs.set(npc.id, npc);
  });
}

export function handleStagingPortalInteraction(
  room: any,
  client: any,
  data: { portalId: string },
  countdownMs: number,
  lateJoinMs: number
): void {
  if (!room.stagingEnabled) {
    return;
  }
  if (room.phase === 'ended') {
    return;
  }

  const player = room.state.players.get(client.sessionId);
  if (!player) {
    return;
  }

  const portal = room.state.entities.get(data.portalId);
  if (!portal) {
    console.warn('Staging portal interaction failed: portal missing', {
      roomId: room.state.id,
      portalId: data.portalId,
    });
    return;
  }

  // Use portal-configured interaction radius if provided; default to a generous value
  let configuredRadius = 0;
  try {
    const ps = portal.state ? JSON.parse(portal.state) : {};
    configuredRadius = Number(ps.interactionRadius) || 0;
  } catch {
    // Ignore JSON parse errors, use default radius
  }
  const interactionRadius = Math.max(200, configuredRadius || 0); // default 200px

  // Compare portal center (already centered) to player center (player.x/y is top-left)
  const halfTile = 16; // 32px tiles
  const playerCenterX = (player.x || 0) + halfTile;
  const playerCenterY = (player.y || 0) + halfTile;
  const distance = Math.sqrt(
    Math.pow(playerCenterX - portal.x, 2) +
      Math.pow(playerCenterY - portal.y, 2)
  );
  if (distance > interactionRadius) {
    console.log('Staging portal interaction denied: player too far', {
      playerId: client.sessionId,
      distance,
    });
    return;
  }

  // Require brief idle and disallow auto-walk to avoid accidental activation
  const now = Date.now();
  const idleWindowMs = 250;
  if (now - (player.lastMoveTime || 0) < idleWindowMs) {
    if (room.DEBUG) {
      console.log(
        'Staging portal interaction denied: player not idle long enough',
        {
          playerId: client.sessionId,
        }
      );
    }
    return;
  }
  if (player.isAutoWalking) {
    if (room.DEBUG) {
      console.log('Staging portal interaction denied: player auto-walking', {
        playerId: client.sessionId,
      });
    }
    return;
  }

  if (room.phase === 'countdown') {
    const broadcaster = ensureServerBroadcaster(room);
    broadcaster.sendTo(client, 'staging_countdown', {
      countdownEndsAt: room.state.countdownEndsAt,
      startedByPlayerId: room.state.startedByPlayerId || null,
    });
    return;
  }

  startStagingCountdown(room, client, countdownMs, lateJoinMs);
}

export function startStagingCountdown(
  room: any,
  client: any,
  countdownMs: number,
  lateJoinMs: number
): void {
  if (!room.stagingEnabled || room.phase !== 'staging') {
    return;
  }

  const starterPlayerId = room.getPlayerIdForSession
    ? room.getPlayerIdForSession(client.sessionId) || null
    : null;
  const countdownEndsAt = Date.now() + countdownMs;

  if (room.clearStagingAutoCloseTimer) {
    room.clearStagingAutoCloseTimer();
  }
  if (room.portalCountdownTimer) {
    clearTimeout(room.portalCountdownTimer);
  }
  room.portalCountdownTimer = setTimeout(() => {
    room.portalCountdownTimer = null;
    beginDungeonRun(room, client.sessionId, lateJoinMs);
  }, countdownMs);

  if (room.setPhase) {
    room.setPhase('countdown', {
      countdownEndsAt,
      startedByPlayerId: starterPlayerId,
      autoCloseAt: 0,
    });
  }

  const broadcaster = ensureServerBroadcaster(room);
  broadcaster.broadcast('staging_countdown', {
    countdownEndsAt,
    startedByPlayerId: starterPlayerId,
    startedBySessionId: client.sessionId,
  });
}

export function beginDungeonRun(
  room: any,
  starterSessionId?: string | null,
  lateJoinMs: number = 60_000
): void {
  if (!room.stagingEnabled) {
    return;
  }
  if (room.phase === 'in_game') {
    return;
  }

  if (room.portalCountdownTimer) {
    clearTimeout(room.portalCountdownTimer);
    room.portalCountdownTimer = null;
  }

  const starterPlayerId =
    room.state.startedByPlayerId ||
    (starterSessionId && room.getPlayerIdForSession
      ? room.getPlayerIdForSession(starterSessionId) || null
      : null);

  const startedAt = Date.now();
  const lateJoinCutoffAt = startedAt + lateJoinMs;

  if (room.markEntryFeesNonRefundable) {
    room.markEntryFeesNonRefundable();
  }
  if (room.setPhase) {
    room.setPhase('in_game', {
      countdownEndsAt: 0,
      startedByPlayerId: starterPlayerId,
      lateJoinCutoffAt,
      autoCloseAt: 0,
      runStartedAt: startedAt,
    });
  }

  if (room.clearLateJoinTimer) room.clearLateJoinTimer();
  if (room.scheduleLateJoinCutoff) {
    room.scheduleLateJoinCutoff(lateJoinCutoffAt);
  }

  if (typeof room.scheduleNextTimedSpawn === 'function') {
    room.scheduleNextTimedSpawn();
  }

  if (room.spawnInitialDungeonPopulation) {
    room.spawnInitialDungeonPopulation();
  }

  room.state.players.forEach((player: PlayerSchema) => {
    if (room.setPlayerSpawnPosition) {
      room.setPlayerSpawnPosition(player);
    }
    player.hp = player.maxHp;
    if (typeof room.isOnRoad === 'function') {
      player.onRoad = room.isOnRoad(player.x, player.y);
    }
  });

  const broadcaster = ensureServerBroadcaster(room);
  broadcaster.broadcast('staging_run_started', {
    runStartedAt: startedAt,
    lateJoinCutoffAt,
    startedByPlayerId: starterPlayerId,
    chunkLayout: room.chunkLayoutData,
    difficultyTier: room.state.difficultyTier,
    phase: room.state.phase,
  });
}

export function scheduleStagingAutoClose(room: any, deadlineMs: number): void {
  if (room.stagingAutoCloseTimer) {
    clearTimeout(room.stagingAutoCloseTimer);
    room.stagingAutoCloseTimer = null;
  }

  if (
    !room.stagingEnabled ||
    room.phase !== 'staging' ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0
  ) {
    return;
  }

  const now = Date.now();
  const delay = Math.max(0, deadlineMs - now);
  room.stagingAutoCloseTimer = setTimeout(() => {
    handleStagingAutoClose(room, 'timeout').catch((error: any) => {
      console.error('Failed to auto-close staging room', {
        roomId: room.state.id,
        error,
      });
    });
  }, delay);
}

export function clearStagingAutoCloseTimer(room: any): void {
  if (room.stagingAutoCloseTimer) {
    clearTimeout(room.stagingAutoCloseTimer);
    room.stagingAutoCloseTimer = null;
  }
}

export async function handleStagingAutoClose(
  room: any,
  reason: 'timeout' | 'manual'
): Promise<void> {
  if (!room.stagingEnabled || room.phase !== 'staging') {
    return;
  }

  console.log('Staging auto-close triggered', {
    reason,
    roomId: room.state.id,
  });

  clearStagingAutoCloseTimer(room);

  const refundPromises: Array<Promise<boolean>> = [];
  room.entryFeeLedger.forEach((_entry: any, playerId: string) => {
    refundPromises.push(refundEntryFee(room, playerId, reason));
  });
  await Promise.allSettled(refundPromises);

  if (room.setPhase) {
    room.setPhase('ended', {
      countdownEndsAt: 0,
      autoCloseAt: 0,
      startedByPlayerId: null,
    });
  }

  const broadcaster = ensureServerBroadcaster(room);
  broadcaster.broadcast('staging_cancelled', {
    reason,
    refunded: true,
  });

  if (!room.gameStatusFinalized && room.finalizeGameStatus) {
    await room.finalizeGameStatus('cancelled', { reason });
  }

  try {
    if (room.lock) {
      room.lock();
    }
  } catch (error) {
    console.warn('Failed to lock room after staging cancellation', error);
  }

  const clientSnapshot = Array.from(room.clients);
  clientSnapshot.forEach((client: any) => {
    try {
      broadcaster.sendTo(client, 'staging_cancelled', { reason });
      void client.leave();
    } catch (error) {
      console.warn('Failed to notify client about staging cancellation', {
        error,
      });
    }
  });
}

export function scheduleLateJoinCutoff(room: any, deadlineMs: number): void {
  clearLateJoinTimer(room);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return;
  }
  const now = Date.now();
  const delay = Math.max(0, deadlineMs - now);
  room.lateJoinTimer = setTimeout(() => {
    room.lateJoinTimer = null;
    handleLateJoinCutoff(room);
  }, delay);
}

export function clearLateJoinTimer(room: any): void {
  if (room.lateJoinTimer) {
    clearTimeout(room.lateJoinTimer);
    room.lateJoinTimer = null;
  }
}

export function handleLateJoinCutoff(room: any): void {
  if (room.state.phase !== 'in_game') {
    return;
  }
  room.state.lateJoinCutoffAt = 0;
  if (room.persistGameMetrics) {
    room.persistGameMetrics({ syncState: true });
  }
  if (room.updateMetadata) {
    room.updateMetadata();
  }
  const broadcaster = ensureServerBroadcaster(room);
  broadcaster.broadcast('late_join_closed', {
    roomId: room.state.id,
    closedAt: Date.now(),
  });
}

export function trackEntryFeeCharge(
  room: any,
  playerId: string,
  amountCents: number,
  chargedAtIso: string | null,
  refundable: boolean
): void {
  if (!playerId || !Number.isFinite(amountCents) || amountCents <= 0) {
    return;
  }

  room.entryFeeLedger.set(playerId, {
    amountCents: Math.floor(amountCents),
    chargedAtIso,
    refundable,
  });
}

export function markEntryFeesNonRefundable(room: any): void {
  room.entryFeeLedger.forEach((entry: any, playerId: string) => {
    if (entry.refundable) {
      room.entryFeeLedger.set(playerId, {
        ...entry,
        refundable: false,
      });
    }
  });
}

export async function refundEntryFee(
  room: any,
  playerId: string,
  reason: 'timeout' | 'manual' | 'disconnect',
  extraMetadata: Record<string, unknown> = {}
): Promise<boolean> {
  const ledgerEntry = room.entryFeeLedger.get(playerId);
  if (!ledgerEntry || !ledgerEntry.refundable || ledgerEntry.amountCents <= 0) {
    return false;
  }

  try {
    const updated = await playersRepo.updateCredits(
      playerId,
      ledgerEntry.amountCents
    );
    if (!updated) {
      throw new Error('Failed to update credits during refund');
    }
  } catch (error) {
    console.error('Failed to refund entry fee credits', {
      playerId,
      reason,
      error,
    });
    return false;
  }

  const refundAmount = ledgerEntry.amountCents / 100;
  if (room.logEconomyTransaction) {
    room.logEconomyTransaction({
      playerId,
      currency: 'CREDITS',
      amount: refundAmount,
      source: 'staging_refund',
      metadata: {
        reason,
        ...extraMetadata,
      },
    });
  }

  room.entryFeeLedger.set(playerId, {
    amountCents: 0,
    chargedAtIso: ledgerEntry.chargedAtIso,
    refundable: false,
  });
  room.entryFeeLedger.delete(playerId);

  if (room.currentGameId) {
    try {
      const record = await gamePlayersRepo.getByGameAndPlayer(
        room.currentGameId,
        playerId
      );
      if (record) {
        await gamePlayersRepo.applyStats({
          gamePlayerId: record.id,
          metadata: {
            entryFeeRefunded: true,
            entryFeeRefundedAt: new Date().toISOString(),
            entryFeeRefundReason: reason,
            ...extraMetadata,
          },
        });
      }
    } catch (error) {
      console.error('Failed to record entry fee refund metadata', {
        playerId,
        reason,
        error,
      });
    }
  }

  return true;
}
