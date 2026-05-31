import type { PoolClient } from 'pg';
import { getPgPool } from '../client';
import type {
  PlayerInventoryEventRecord,
  PlayerInventoryEventRow,
} from '../types';

function mapRow(row: PlayerInventoryEventRow): PlayerInventoryEventRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    itemType: row.item_type,
    itemName: row.item_name,
    delta: Number(row.delta),
    reason: row.reason,
    gameId: row.game_id,
    metadata: row.metadata ?? {},
    inventoryItemId: row.inventory_item_id,
    createdAt: row.created_at,
  };
}

export interface LogInventoryEventInput {
  playerId: string;
  itemType: string;
  itemName: string;
  delta: number;
  reason: string;
  gameId?: string | null;
  metadata?: unknown;
  inventoryItemId?: string | null;
}

export async function logInventoryEvent(
  input: LogInventoryEventInput,
  client?: PoolClient
) {
  const runner = client ?? getPgPool();
  const query = `
    insert into player_inventory_events (
      player_id,
      item_type,
      item_name,
      delta,
      reason,
      game_id,
      metadata,
      inventory_item_id
    ) values ($1,$2,$3,$4,$5,$6,$7,$8)
    returning *
  `;

  const result = await runner.query<PlayerInventoryEventRow>(query, [
    input.playerId,
    input.itemType,
    input.itemName,
    input.delta,
    input.reason,
    input.gameId ?? null,
    input.metadata ?? {},
    input.inventoryItemId ?? null,
  ]);

  return mapRow(result.rows[0]);
}
