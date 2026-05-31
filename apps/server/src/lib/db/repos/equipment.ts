import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type { PlayerEquipmentRecord, PlayerEquipmentRow } from '../types';

function mapRow(row: PlayerEquipmentRow): PlayerEquipmentRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    characterId: row.character_id,
    slot: row.slot,
    wearableSlug: row.wearable_slug,
    source: row.source,
    inventoryItemId: row.inventory_item_id,
    updatedAt: row.updated_at,
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export async function getEquipment(playerId: string, client?: PoolClient) {
  const pool = getPool(client);
  const result = await pool.query<PlayerEquipmentRow>(
    'select * from player_equipment where player_id = $1 order by slot',
    [playerId]
  );
  return result.rows.map(mapRow);
}

export async function getEquipmentByPlayer(
  playerId: string,
  characterId?: string | null,
  client?: PoolClient
): Promise<
  Array<{ slot: string; wearableSlug: string; inventoryItemId: string | null }>
> {
  const pool = getPool(client);
  const params: any[] = [playerId];
  let query = `select slot, wearable_slug, inventory_item_id
       from player_equipment
      where player_id = $1`;
  if (characterId !== undefined) {
    params.push(characterId);
    query += ` and character_id = $2`;
  }
  query += ` order by slot`;
  const result = await pool.query<
    Pick<PlayerEquipmentRow, 'slot' | 'wearable_slug' | 'inventory_item_id'>
  >(query, params);
  return result.rows.map((row) => ({
    slot: row.slot,
    wearableSlug: row.wearable_slug,
    inventoryItemId: row.inventory_item_id,
  }));
}

export async function getEquippedCountBySlug(
  playerId: string,
  slug: string,
  client?: PoolClient
): Promise<number> {
  const pool = getPool(client);
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from player_equipment
      where player_id = $1
        and wearable_slug = $2`,
    [playerId, slug]
  );
  const countValue = result.rows[0]?.count;
  const numeric = Number(countValue);
  return Number.isFinite(numeric) ? numeric : 0;
}

export interface SetEquipmentInput {
  playerId: string;
  characterId?: string | null;
  slot: string;
  wearableSlug: string;
  source?: string;
  inventoryItemId?: string | null;
  client?: PoolClient;
}

export async function setEquipment(input: SetEquipmentInput) {
  const pool = getPool(input.client);
  const query = `
    insert into player_equipment (
      player_id,
      character_id,
      slot,
      wearable_slug,
      source,
      inventory_item_id,
      updated_at
    ) values ($1,$2,$3,$4,$5,$6,now())
    on conflict (player_id, character_id, slot) do update set
      wearable_slug = excluded.wearable_slug,
      source = excluded.source,
      inventory_item_id = excluded.inventory_item_id,
      updated_at = now()
    returning *
  `;

  const result: QueryResult<PlayerEquipmentRow> = await pool.query(query, [
    input.playerId,
    input.characterId ?? null,
    input.slot,
    input.wearableSlug,
    input.source ?? 'inventory',
    input.inventoryItemId ?? null,
  ]);
  return mapRow(result.rows[0]);
}

export async function removeEquipment(
  playerId: string,
  slot: string,
  characterId?: string | null,
  client?: PoolClient
) {
  const pool = getPool(client);
  const params: any[] = [playerId];
  let paramIndex = 2;
  let sql = 'delete from player_equipment where player_id = $1';

  sql += ` and slot = $${paramIndex}`;
  params.push(slot);
  paramIndex += 1;

  if (characterId) {
    sql += ` and character_id = $${paramIndex}`;
    params.push(characterId);
  }
  await pool.query(sql, params);
}

export async function clearEquipment(
  playerId: string,
  characterId?: string | null,
  client?: PoolClient
) {
  const pool = getPool(client);
  if (characterId) {
    await pool.query(
      'delete from player_equipment where player_id = $1 and character_id = $2',
      [playerId, characterId]
    );
  } else {
    await pool.query('delete from player_equipment where player_id = $1', [
      playerId,
    ]);
  }
}

export async function getEquippedWithInstances(
  playerId: string,
  characterId?: string | null,
  client?: PoolClient
): Promise<
  Array<{
    slot: string;
    wearableSlug: string;
    inventoryItemId: string | null;
    quality: string | null;
  }>
> {
  const pool = getPool(client);
  const params: any[] = [playerId];

  let query = `
    select
      eq.slot,
      eq.wearable_slug,
      eq.inventory_item_id,
      inv.quality
      from player_equipment eq
 left join player_inventories inv
        on inv.id = eq.inventory_item_id
     where eq.player_id = $1
  `;
  if (characterId !== undefined) {
    params.push(characterId);
    query += ` and eq.character_id = $2`;
  }
  query += ` order by eq.slot`;

  const result = await pool.query<{
    slot: string;
    wearable_slug: string;
    inventory_item_id: string | null;
    quality: string | null;
  }>(query, params);

  return result.rows.map((row) => ({
    slot: row.slot,
    wearableSlug: row.wearable_slug,
    inventoryItemId: row.inventory_item_id,
    quality: row.quality,
  }));
}

/**
 * Returns a summarized view of equipped items for convenience in API layers.
 * - idSet: inventory item IDs that are currently equipped
 * - countBySlug: number of equipped items per wearable slug
 */
export async function getEquippedSummary(
  playerId: string,
  client?: PoolClient
): Promise<{ idSet: Set<string>; countBySlug: Map<string, number> }> {
  const rows = await getEquippedWithInstances(playerId, undefined, client);
  const idSet = new Set<string>();
  const countBySlug = new Map<string, number>();
  for (const row of rows) {
    const id = row.inventoryItemId;
    if (typeof id === 'string' && id) idSet.add(id);
    const slug = String(row.wearableSlug || '').trim();
    if (!slug) continue;
    countBySlug.set(slug, (countBySlug.get(slug) ?? 0) + 1);
  }
  return { idSet, countBySlug };
}
