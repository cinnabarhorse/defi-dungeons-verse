import { getPgPool } from '../client';
import type {
  PlayerAllowlistRecord,
  PlayerAllowlistRow,
} from '../types';

export function normalizeWallet(address: string | null | undefined): string {
  if (address == null) return '';
  return String(address).trim().toLowerCase();
}

function mapRow(row: PlayerAllowlistRow): PlayerAllowlistRecord {
  return {
    walletAddress: row.wallet_address,
    note: row.note,
    addedByAddress: row.added_by_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListAllowlistParams {
  limit?: number;
  offset?: number;
  query?: string | null;
}

export async function list(params: ListAllowlistParams) {
  const pool = getPgPool();
  const limit = Math.max(1, Math.min(200, Number(params?.limit) || 25));
  const offset = Math.max(0, Number(params?.offset) || 0);
  const query = (params?.query || '').trim();

  const values: Array<string | number> = [];
  let whereClause = '';
  if (query.length > 0) {
    values.push(`%${query.toLowerCase()}%`);
    whereClause = `where wallet_address ilike $${values.length}`;
  }

  const countSql = `select count(*)::bigint as total from public.player_allowlist ${whereClause}`;
  const countRes = await pool.query<{ total: string }>(countSql, values);
  const total = Number(countRes.rows[0]?.total || 0);

  values.push(limit);
  values.push(offset);
  const limitIndex = values.length - 1;
  const offsetIndex = values.length;

  const dataSql = `select *
                     from public.player_allowlist
                     ${whereClause}
                 order by created_at desc
                    limit $${limitIndex}
                   offset $${offsetIndex}`;
  const dataRes = await pool.query<PlayerAllowlistRow>(dataSql, values);
  return {
    entries: dataRes.rows.map(mapRow),
    pagination: { limit, offset, total },
  };
}

interface AddInput {
  walletAddress: string;
  addedByAddress: string;
  note?: string | null;
}

export async function add(input: AddInput) {
  const pool = getPgPool();
  const wallet = normalizeWallet(input.walletAddress);
  if (!wallet) {
    throw new Error('walletAddress is required');
  }
  const addedBy = normalizeWallet(input.addedByAddress);
  if (!addedBy) {
    throw new Error('addedByAddress is required');
  }
  const note = input.note?.trim() || null;
  const result = await pool.query<PlayerAllowlistRow>(
    `insert into public.player_allowlist (wallet_address, note, added_by_address)
     values ($1, $2, $3)
     on conflict (wallet_address) do nothing
     returning *`,
    [wallet, note, addedBy]
  );
  if (result.rows.length === 0) {
    return { created: false as const, entry: null };
  }
  return { created: true as const, entry: mapRow(result.rows[0]) };
}

export async function remove(walletAddress: string) {
  const pool = getPgPool();
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    return false;
  }
  const result = await pool.query<PlayerAllowlistRow>(
    `delete from public.player_allowlist
      where wallet_address = $1
      returning *`,
    [wallet]
  );
  return result.rows.length > 0;
}

export async function isAllowlisted(walletAddress: string) {
  const pool = getPgPool();
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    return false;
  }
  const result = await pool.query(
    `select 1
       from public.player_allowlist
      where wallet_address = $1
      limit 1`,
    [wallet]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function get(walletAddress: string) {
  const pool = getPgPool();
  const wallet = normalizeWallet(walletAddress);
  if (!wallet) {
    return null;
  }
  const result = await pool.query<PlayerAllowlistRow>(
    `select *
       from public.player_allowlist
      where wallet_address = $1
      limit 1`,
    [wallet]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}
