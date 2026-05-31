import type { PoolClient, QueryResult } from 'pg';
import { getPgPool, runTransaction } from '../client';
import type { PlayerInventoryRecord, PlayerInventoryRow } from '../types';

function mapRow(row: PlayerInventoryRow): PlayerInventoryRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    itemType: row.item_type,
    itemName: row.item_name,
    quantity: Number(row.quantity),
    itemData: row.item_data ?? {},
    instanceId: row.instance_id,
    wearableSlug: row.wearable_slug ?? null,
    quality: row.quality,
    qualityScore:
      typeof row.quality_score === 'number' ? row.quality_score : null,
    durabilityScore: Number(row.durability_score) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

const inventoryWriteQueues = new Map<string, Promise<void>>();

async function withInventoryWriteLock<T>(
  playerId: string,
  task: (client: PoolClient) => Promise<T>
): Promise<T> {
  const previous =
    inventoryWriteQueues.get(playerId) ?? Promise.resolve<void>(undefined);
  const runPromise = previous.then(() => runTransaction(task));
  const finalPromise = runPromise.then(
    () => undefined,
    () => undefined
  );
  inventoryWriteQueues.set(playerId, finalPromise);
  try {
    return await runPromise;
  } finally {
    if (inventoryWriteQueues.get(playerId) === finalPromise) {
      inventoryWriteQueues.delete(playerId);
    }
  }
}

async function replaceInventoryInternal(
  playerId: string,
  items: BulkReplaceInputItem[],
  client: PoolClient
) {
  const fungibleItems = items.filter(
    (item) => String(item.itemType ?? '').toLowerCase() !== 'wearable'
  );

  await client.query(
    'delete from player_inventories where player_id = $1 and item_type <> $2',
    [playerId, 'wearable']
  );

  if (fungibleItems.length === 0) {
    return [] as PlayerInventoryRecord[];
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  fungibleItems.forEach((item, index) => {
    const base = index * 4;
    placeholders.push(
      `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, now(), now())`
    );
    values.push(
      item.itemType,
      item.itemName,
      item.quantity,
      item.itemData ?? {}
    );
  });

  const query = `
    insert into player_inventories (
      player_id,
      item_type,
      item_name,
      quantity,
      item_data,
      created_at,
      updated_at
    ) values ${placeholders.join(', ')}
    returning *
  `;

  const result = await client.query<PlayerInventoryRow>(query, [
    playerId,
    ...values,
  ]);
  return result.rows.map(mapRow);
}

export async function getInventory(playerId: string) {
  const pool = getPgPool();
  const result = await pool.query<PlayerInventoryRow>(
    `
      select *
        from player_inventories
       where player_id = $1
       order by
         case when item_type = 'wearable' then 0 else 1 end,
         case
           when item_type = 'wearable' and quality = 'flawless' then 0
           when item_type = 'wearable' and quality = 'excellent' then 1
           when item_type = 'wearable' and quality = 'average' then 2
           when item_type = 'wearable' and quality = 'budget' then 3
           when item_type = 'wearable' and quality = 'broken' then 4
           else 5
         end,
         durability_score desc,
         created_at asc,
         item_type,
         item_name
    `,
    [playerId]
  );
  return result.rows.map(mapRow);
}

export interface UpsertInventoryItemInput {
  playerId: string;
  itemType: string;
  itemName: string;
  quantity: number;
  itemData?: unknown;
  client?: PoolClient;
}

export async function upsertInventoryItem(input: UpsertInventoryItemInput) {
  if (
    String(input.itemType ?? '')
      .toLowerCase()
      .trim() === 'wearable' ||
    String(input.itemName ?? '').startsWith('wearable:')
  ) {
    throw new Error(
      'Wearable items must be inserted via createInventoryInstance'
    );
  }

  const pool = getPool(input.client);
  const query = `
    insert into player_inventories (
      player_id,
      item_type,
      item_name,
      quantity,
      item_data,
      created_at,
      updated_at
    ) values ($1,$2,$3,$4,$5,now(),now())
    on conflict (player_id, item_type, item_name)
      where lower(item_type) <> 'wearable'
    do update set
      quantity = player_inventories.quantity + excluded.quantity,
      item_data = excluded.item_data,
      updated_at = now()
    returning *
  `;

  const result: QueryResult<PlayerInventoryRow> = await pool.query(query, [
    input.playerId,
    input.itemType,
    input.itemName,
    input.quantity,
    input.itemData ?? {},
  ]);
  return mapRow(result.rows[0]);
}

export interface CreateInventoryInstanceInput {
  playerId: string;
  wearableSlug: string;
  quality: 'broken' | 'budget' | 'average' | 'excellent' | 'flawless';
  durabilityScore: number;
  qualityScore?: number | null;
  itemData?: unknown;
  client?: PoolClient;
}

export async function createInventoryInstance(
  input: CreateInventoryInstanceInput
) {
  const pool = getPool(input.client);

  const sanitizedDurability = Number.isFinite(input.durabilityScore)
    ? Math.max(1, Math.min(1000, Math.floor(input.durabilityScore)))
    : 1000;
  const qualityScore =
    typeof input.qualityScore === 'number' &&
    Number.isFinite(input.qualityScore)
      ? Math.max(0, Math.floor(input.qualityScore))
      : null;

  const itemData = {
    wearableSlug: input.wearableSlug,
    quality: input.quality,
    qualityScore,
    durabilityScore: sanitizedDurability,
    ...(input.itemData && typeof input.itemData === 'object'
      ? input.itemData
      : {}),
  };

  const result = await pool.query<PlayerInventoryRow>(
    `
      insert into player_inventories (
        player_id,
        item_type,
        item_name,
        quantity,
        item_data,
        wearable_slug,
        quality,
        quality_score,
        durability_score,
        created_at,
        updated_at
      ) values (
        $1,
        'wearable',
        $2,
        1,
        $6,
        $2,
        $3,
        $4,
        $5,
        now(),
        now()
      )
      returning *
    `,
    [
      input.playerId,
      input.wearableSlug,
      input.quality,
      qualityScore,
      sanitizedDurability,
      itemData,
    ]
  );

  return mapRow(result.rows[0]);
}

export async function setInventoryQuantity(
  playerId: string,
  itemType: string,
  itemName: string,
  quantity: number,
  client?: PoolClient
) {
  const pool = getPool(client);
  const result = await pool.query<PlayerInventoryRow>(
    `update player_inventories
        set quantity = $4,
            updated_at = now()
      where player_id = $1 and item_type = $2 and item_name = $3
      returning *`,
    [playerId, itemType, itemName, quantity]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export async function removeInventoryItem(
  playerId: string,
  itemType: string,
  itemName: string,
  client?: PoolClient
) {
  const pool = getPool(client);
  await pool.query(
    'delete from player_inventories where player_id = $1 and item_type = $2 and item_name = $3',
    [playerId, itemType, itemName]
  );
}

export async function removeInventoryItemById(
  playerId: string,
  inventoryItemId: string,
  client?: PoolClient
) {
  const pool = getPool(client);
  const result = await pool.query<PlayerInventoryRow>(
    'delete from player_inventories where player_id = $1 and id = $2 returning *',
    [playerId, inventoryItemId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export interface DecrementInventoryItemResult {
  quantityBefore: number;
  quantityAfter: number;
  deleted: boolean;
  record: PlayerInventoryRecord | null;
}

export async function decrementInventoryItem(
  playerId: string,
  itemType: string,
  itemName: string,
  amount: number,
  client: PoolClient
): Promise<DecrementInventoryItemResult | null> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Decrement amount must be a positive number');
  }

  const result = await client.query<PlayerInventoryRow>(
    `select *
       from player_inventories
      where player_id = $1
        and item_type = $2
        and item_name = $3
      for update`,
    [playerId, itemType, itemName]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const currentQuantity = Number(row.quantity) || 0;
  if (currentQuantity < amount) {
    throw new Error('Insufficient quantity to decrement inventory item');
  }

  const nextQuantity = currentQuantity - amount;

  if (nextQuantity === 0) {
    await client.query(
      `delete from player_inventories
        where id = $1`,
      [row.id]
    );
    return {
      quantityBefore: currentQuantity,
      quantityAfter: 0,
      deleted: true,
      record: null,
    };
  }

  const updateResult = await client.query<PlayerInventoryRow>(
    `update player_inventories
        set quantity = $2,
            updated_at = now()
      where id = $1
      returning *`,
    [row.id, nextQuantity]
  );

  const updatedRow = updateResult.rows[0];
  return {
    quantityBefore: currentQuantity,
    quantityAfter: nextQuantity,
    deleted: false,
    record: mapRow(updatedRow),
  };
}

export interface BulkReplaceInputItem {
  itemType: string;
  itemName: string;
  quantity: number;
  itemData?: unknown;
}

export async function replaceInventory(
  playerId: string,
  items: BulkReplaceInputItem[],
  client?: PoolClient
) {
  if (client) {
    return replaceInventoryInternal(playerId, items, client);
  }

  return withInventoryWriteLock(playerId, (tx) =>
    replaceInventoryInternal(playerId, items, tx)
  );
}

export async function getInventoryQuantity(
  playerId: string,
  slug: string,
  client?: PoolClient
): Promise<number> {
  const pool = getPool(client);
  const result = await pool.query<{ quantity: string | number }>(
    `select coalesce(sum(quantity), 0)::numeric as quantity
       from player_inventories
      where player_id = $1
        and item_type = 'wearable'
        and item_name = $2`,
    [playerId, slug]
  );
  const value = result.rows[0]?.quantity;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function getInventoryByIds(
  ids: string[],
  client?: PoolClient
): Promise<PlayerInventoryRecord[]> {
  const uniqueIds = Array.from(
    new Set(ids.filter((value) => typeof value === 'string' && value.trim()))
  );
  if (uniqueIds.length === 0) {
    return [];
  }

  const pool = getPool(client);
  const result = await pool.query<PlayerInventoryRow>(
    `
      select *
        from player_inventories
       where id = any($1::uuid[])
    `,
    [uniqueIds]
  );
  return result.rows.map(mapRow);
}

export async function getInventoryMapByIds(
  ids: string[],
  client?: PoolClient
): Promise<Map<string, PlayerInventoryRecord>> {
  const records = await getInventoryByIds(ids, client);
  const map = new Map<string, PlayerInventoryRecord>();
  for (const record of records) {
    map.set(record.id, record);
  }
  return map;
}

export async function getWearableInventoryBySlug(
  playerId: string,
  slug: string,
  client?: PoolClient
): Promise<PlayerInventoryRecord[]> {
  const pool = getPool(client);
  const result = await pool.query<PlayerInventoryRow>(
    `
      select *
        from player_inventories
       where player_id = $1
         and wearable_slug = $2
       order by
         case
           when quality = 'flawless' then 0
           when quality = 'excellent' then 1
           when quality = 'average' then 2
           when quality = 'budget' then 3
           when quality = 'broken' then 4
           else 5
         end,
         durability_score desc,
         created_at asc
    `,
    [playerId, slug]
  );
  return result.rows.map(mapRow);
}
