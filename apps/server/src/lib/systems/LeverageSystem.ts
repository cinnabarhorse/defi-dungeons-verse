import type { Client } from 'colyseus';
import { LEVERAGE_CONFIG } from '../constants';
import type { LeverageStatePayload } from '../../types/messages';
import type { GameRoom } from '../../rooms/GameRoom';

function leverageEnabled(): boolean {
  return LEVERAGE_CONFIG.enabled;
}

export function normalizeLeverageValue(value: number): number {
  if (!leverageEnabled()) return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  // Per-floor and per-room multipliers are limited to 10x, while the cumulative
  // total leverage can reach LEVERAGE_CONFIG.max (e.g. 100x) via stacking.
  const MULTIPLIER_MAX = Math.min(10, LEVERAGE_CONFIG.max);
  const clamped = Math.max(1, Math.min(MULTIPLIER_MAX, numeric));
  return Math.round(clamped * 10) / 10;
}

export function recomputeLeverageTotal(room: GameRoom): number {
  if (!leverageEnabled()) {
    room.state.floorLeverage = 1;
    room.state.roomLeverage = 1;
    room.state.leverageTotal = 1;
    return 1;
  }
  const prevFloor = Math.max(1, Number(room.state.floorLeverage) || 1);
  const prevRoom = Math.max(1, Number(room.state.roomLeverage) || 1);

  const normFloor = normalizeLeverageValue(prevFloor);
  const normRoom = normalizeLeverageValue(prevRoom);

  // Components themselves should never decrease once set
  const floor = Math.max(prevFloor, normFloor);
  const leverageRoom = Math.max(prevRoom, normRoom);

  room.state.floorLeverage = floor;
  room.state.roomLeverage = leverageRoom;

  const rawTotal = floor * leverageRoom;
  const clampedTotal = Math.max(1, Math.min(LEVERAGE_CONFIG.max, rawTotal));

  const prevTotal = Math.max(1, Number(room.state.leverageTotal) || 1);
  const total = Math.max(prevTotal, clampedTotal);
  room.state.leverageTotal = total;
  return total;
}

export function initializeLeverageState(room: GameRoom): void {
  if (!leverageEnabled()) {
    room.state.floorLeverage = 1;
    room.state.roomLeverage = 1;
    room.state.leverageTotal = 1;
    room.state.floorLeverageLocked = true;
    room.state.roomLeverageLocked = true;
    room.state.floorLeverageSetAt = 0;
    room.state.roomLeverageSetAt = 0;
    (room.state as any).staniActive = false;
    return;
  }
  resetLeverageForNewFloor(room, { broadcast: false });
}

export function openFloorLeverageForNewFloor(
  room: GameRoom,
  options: { broadcast?: boolean } = {}
): void {
  if (!leverageEnabled()) return;
  room.state.floorLeverageLocked = false;
  room.state.floorLeverageSetAt = 0;
  (room.state as any).staniActive = true;
  // Keep existing floorLeverage / roomLeverage / leverageTotal; only reopen the
  // floor leverage window for the new floor.
  if (options.broadcast !== false) {
    broadcastLeverageState(room);
  }
}

export function resetLeverageForNewFloor(
  room: GameRoom,
  options: { broadcast?: boolean } = {}
): void {
  if (!leverageEnabled()) {
    room.state.floorLeverage = 1;
    room.state.roomLeverage = 1;
    room.state.floorLeverageLocked = true;
    room.state.roomLeverageLocked = true;
    room.state.floorLeverageSetAt = 0;
    room.state.roomLeverageSetAt = 0;
    (room.state as any).staniActive = false;
    recomputeLeverageTotal(room);
    if (options.broadcast !== false) {
      broadcastLeverageState(room);
    }
    return;
  }

  room.state.floorLeverage = 1;
  room.state.floorLeverageLocked = false;
  room.state.floorLeverageSetAt = 0;
  (room.state as any).staniActive = true;
  resetRoomLeverageState(room, { broadcast: false });
  recomputeLeverageTotal(room);
  reapplyLeverageModifiersToPlayers(room);
  if (options.broadcast !== false) {
    broadcastLeverageState(room);
  }
}

export function resetRoomLeverageState(
  room: GameRoom,
  options: { broadcast?: boolean } = {}
): void {
  clearRoomLeverageLockTimer(room);
  if (!leverageEnabled()) {
    room.state.roomLeverage = 1;
    room.state.roomLeverageLocked = true;
    room.state.roomLeverageSetAt = 0;
    recomputeLeverageTotal(room);
    if (options.broadcast !== false) {
      broadcastLeverageState(room);
    }
    return;
  }

  room.state.roomLeverage = 1;
  room.state.roomLeverageLocked = false;
  room.state.roomLeverageSetAt = 0;
  recomputeLeverageTotal(room);
  scheduleRoomLeverageLockTimeout(room);
  if (options.broadcast !== false) {
    broadcastLeverageState(room);
  }
}

export function scheduleRoomLeverageLockTimeout(room: GameRoom): void {
  if (!leverageEnabled()) return;
  if (room.state.roomLeverageLocked) return;
  if ((room as any).phase !== 'in_game') return;
  if (room.state.players.size === 0) return;
  const timeout = LEVERAGE_CONFIG.roomTimeoutMs;
  if (!timeout || timeout <= 0) return;
  clearRoomLeverageLockTimer(room);
  (room as any).roomLeverageLockTimer = setTimeout(() => {
    lockRoomLeverage(room, 'timeout');
  }, timeout);
}

export function clearRoomLeverageLockTimer(room: GameRoom): void {
  const timer: NodeJS.Timeout | null =
    (room as any).roomLeverageLockTimer ?? null;
  if (timer) {
    clearTimeout(timer);
    (room as any).roomLeverageLockTimer = null;
  }
}

export function lockRoomLeverage(
  room: GameRoom,
  _reason: 'timeout' | 'combat' | 'manual'
): void {
  if (!leverageEnabled()) return;
  if (room.state.roomLeverageLocked) return;
  room.state.roomLeverageLocked = true;
  if (!room.state.roomLeverageSetAt) {
    room.state.roomLeverageSetAt = Date.now();
  }
  clearRoomLeverageLockTimer(room);
  recomputeLeverageTotal(room);
  broadcastLeverageState(room);
}

export function handleRoomLeverageEngagement(
  room: GameRoom,
  reason: 'combat' | 'timeout' = 'combat'
): void {
  lockRoomLeverage(room, reason);
}

export function getLeverageTotal(room: GameRoom): number {
  if (!leverageEnabled()) return 1;
  const total = Number(room.state.leverageTotal);
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.min(LEVERAGE_CONFIG.max, total));
}

function removeStaniNPCs(room: GameRoom): void {
  for (const [npcId, npc] of room.state.npcs) {
    if (npc && (npc as any).characterId === 'stani') {
      room.state.npcs.delete(npcId);
    }
  }
}

function buildLeverageStatePayload(room: GameRoom): LeverageStatePayload {
  return {
    floor: room.state.floorLeverage || 1,
    room: room.state.roomLeverage || 1,
    total: room.state.leverageTotal || 1,
    floorLocked: Boolean(room.state.floorLeverageLocked),
    roomLocked: Boolean(room.state.roomLeverageLocked),
    staniActive: Boolean((room.state as any).staniActive),
    floorSetAt: room.state.floorLeverageSetAt || undefined,
    roomSetAt: room.state.roomLeverageSetAt || undefined,
  };
}

export function broadcastLeverageState(
  room: GameRoom,
  target?: Client | null
): void {
  const payload = leverageEnabled()
    ? buildLeverageStatePayload(room)
    : {
        floor: 1,
        room: 1,
        total: 1,
        floorLocked: true,
        roomLocked: true,
        staniActive: false,
      };
  if (target) {
    (room.msg as any).sendTo(target, 'leverage:state', payload);
  } else {
    (room.msg as any).broadcast('leverage:state', payload);
  }
}

export function sendLeverageError(
  room: GameRoom,
  client: Client,
  reason: string
): void {
  (room.msg as any).sendTo(client, 'leverage:error', { reason });
}

export function isHostClient(room: GameRoom, client: Client): boolean {
  return room.state.hostSessionId === client.sessionId;
}

export function handleSetFloorLeverage(
  room: GameRoom,
  client: Client,
  data?: { value?: number }
): void {
  if (!leverageEnabled()) {
    sendLeverageError(room, client, 'leverage_disabled');
    return;
  }
  if (!isHostClient(room, client)) {
    sendLeverageError(room, client, 'not_host');
    return;
  }
  if (room.state.floorLeverageLocked) {
    sendLeverageError(room, client, 'floor_locked');
    return;
  }
  const prevFloor = Math.max(1, Number(room.state.floorLeverage) || 1);
  const multiplier = normalizeLeverageValue(data?.value ?? 1);

  // Compute new cumulative floor leverage as prev * multiplier, capped at global max.
  const rawTotal = prevFloor * multiplier;
  const newFloorTotal = Math.max(1, Math.min(LEVERAGE_CONFIG.max, rawTotal));

  if (newFloorTotal <= prevFloor) {
    // No effective increase (e.g. already at cap); treat as error.
    sendLeverageError(room, client, 'max_reached');
    return;
  }

  room.state.floorLeverage = newFloorTotal;
  room.state.floorLeverageLocked = true;
  room.state.floorLeverageSetAt = Date.now();
  (room.state as any).staniActive = false;
  recomputeLeverageTotal(room);
  removeStaniNPCs(room);
  reapplyLeverageModifiersToPlayers(room);
  broadcastLeverageState(room);
}

export function handleSetRoomLeverage(
  room: GameRoom,
  client: Client,
  data?: { value?: number }
): void {
  if (!leverageEnabled()) {
    sendLeverageError(room, client, 'leverage_disabled');
    return;
  }
  if (!isHostClient(room, client)) {
    sendLeverageError(room, client, 'not_host');
    return;
  }
  if (room.state.roomLeverageLocked) {
    sendLeverageError(room, client, 'room_locked');
    return;
  }
  const prevRoom = Math.max(1, Number(room.state.roomLeverage) || 1);
  const requested = normalizeLeverageValue(data?.value ?? 1);

  // Room leverage can only increase; ignore attempts to lower it.
  const nextRoom = Math.max(prevRoom, requested);
  room.state.roomLeverage = nextRoom;
  room.state.roomLeverageLocked = true;
  room.state.roomLeverageSetAt = Date.now();
  clearRoomLeverageLockTimer(room);
  recomputeLeverageTotal(room);
  reapplyLeverageModifiersToPlayers(room);
  broadcastLeverageState(room);
}

export function sendLeverageStateToClient(
  room: GameRoom,
  client: Client
): void {
  broadcastLeverageState(room, client);
}

export function reapplyLeverageModifiersToPlayers(room: GameRoom): void {
  if (!leverageEnabled()) return;
  if (room.state.players.size === 0) return;
  for (const sessionId of room.state.players.keys()) {
    (room as any).applyProgressionToPlayer(sessionId, { fullHeal: false });
  }
}
