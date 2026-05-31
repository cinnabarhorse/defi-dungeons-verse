import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type { PlayerRecord, PlayerRow } from '../types';
import { normalizeWallet } from './player-allowlist';

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function toArrayOfRecords(
  value: unknown
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v) => v && typeof v === 'object') as Record<
    string,
    unknown
  >[];
}

export function mapPlayerRow(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    username: row.username,
    region: row.region,
    creditsCents: Number(row.credits_cents),
    lastSeen: row.last_seen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isBanned: row.is_banned,
    isAuthorized: row.is_authorized,
    accessGrantedAt: row.access_granted_at,
    // progression
    level: toNumber(row.level),
    totalXp: toNumber(row.total_xp),
    unspentPoints: toNumber(row.unspent_points),
    unlockedTiers: toStringArray(row.unlocked_tiers),
    unlockedCharacters: toStringArray(row.unlocked_characters),
    lickTongueCount: toNumber(row.lick_tongue_count),
    statAllocations: toRecord(row.stat_allocations) ?? {},
    derivedStats: toRecord(row.derived_stats) ?? {},
    equippedWearables: toArrayOfRecords(row.equipped_wearables) ?? [],
    allocationHistory: Array.isArray(row.allocation_history)
      ? (row.allocation_history as Record<string, unknown>[])
      : [],
    lastSyncedAt: row.last_synced_at ?? null,
    highestScore: toNumber(row.highest_score) ?? 0,
    // preferences
    selectedCharacterId: toStringOrNull(row.selected_character_id),
    selectedDifficultyTier: toStringOrNull(row.selected_difficulty_tier),
    gotchiSpriteUrl: toStringOrNull(row.gotchi_sprite_url),
    avatarId: toStringOrNull(row.avatar_id),
    audioSettings: toRecord(row.audio_settings) as any,
  };
}

export async function getPlayerByWallet(walletAddress: string) {
  const pool = getPgPool();
  const normalized = normalizeWallet(walletAddress);
  const result = await pool.query<PlayerRow>(
    'select * from players where wallet_address = $1 limit 1',
    [normalized]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function getPlayerById(id: string, client?: PoolClient) {
  const pool = client ?? getPgPool();
  const result = await pool.query<PlayerRow>(
    'select * from players where id = $1 limit 1',
    [id]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function getPlayerByValidSession(
  sessionId: string,
  walletAddress: string
) {
  const pool = getPgPool();
  const normalized = normalizeWallet(walletAddress);
  const result = await pool.query<PlayerRow>(
    `select p.*
       from auth_sessions s
       join players p on p.id = s.player_id
      where s.id = $1
        and s.valid = true
        and (s.expires_at is null or s.expires_at > now())
        and s.wallet_address = $2
      limit 1`,
    [sessionId, normalized]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export interface UpsertPlayerInput {
  walletAddress: string;
  username?: string | null;
  region?: string | null;
  client?: PoolClient;
}

export async function upsertPlayerByWallet(input: UpsertPlayerInput) {
  const pool = input.client ?? getPgPool();
  const normalized = normalizeWallet(input.walletAddress);
  const params = [normalized, input.username ?? null, input.region ?? null];

  const insertResult: QueryResult<PlayerRow> = await pool.query(
    `
      with allowlist as (
        select exists(
          select 1 from public.player_allowlist
           where wallet_address = $1
        ) as is_allowlisted
      )
      insert into public.players (
        wallet_address,
        username,
        region,
        is_authorized,
        access_granted_at,
        last_seen
      )
      select
        $1,
        $2,
        $3,
        allowlist.is_allowlisted,
        case when allowlist.is_allowlisted then now() else null end,
        now()
      from allowlist
      on conflict (wallet_address) do nothing
      returning *
    `,
    params
  );

  let row = insertResult.rows[0];

  if (!row) {
    const updateResult: QueryResult<PlayerRow> = await pool.query(
      `
        with allowlist as (
          select exists(
            select 1 from public.player_allowlist
             where wallet_address = $1
          ) as is_allowlisted
        )
        update public.players
           set username = coalesce($2, public.players.username),
               region = coalesce($3, public.players.region),
               last_seen = now(),
               updated_at = now(),
               is_authorized = case
                 when public.players.is_authorized = false and allowlist.is_allowlisted
                   then true
                 else public.players.is_authorized
               end,
               access_granted_at = case
                 when public.players.is_authorized = false and allowlist.is_allowlisted
                   then now()
                 else public.players.access_granted_at
               end
         from allowlist
         where wallet_address = $1
         returning public.players.*
      `,
      params
    );
    row = updateResult.rows[0];
  }

  if (!row) {
    throw new Error('Failed to upsert player record');
  }

  return mapPlayerRow(row);
}

export async function touchLastSeen(playerId: string) {
  const pool = getPgPool();
  await pool.query('update players set last_seen = now() where id = $1', [
    playerId,
  ]);
}

export async function updateCredits(
  playerId: string,
  deltaCents: number,
  client?: PoolClient
) {
  const pool = client ?? getPgPool();
  const result = await pool.query<PlayerRow>(
    `update players
       set credits_cents = credits_cents + $2,
           updated_at = now()
     where id = $1
     returning *`,
    [playerId, deltaCents]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function setBanStatus(playerId: string, isBanned: boolean) {
  const pool = getPgPool();
  const result = await pool.query<PlayerRow>(
    `update players
       set is_banned = $2,
           updated_at = now()
     where id = $1
     returning *`,
    [playerId, isBanned]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function authorizePlayer(playerId: string) {
  const pool = getPgPool();
  const result = await pool.query<PlayerRow>(
    `update players
       set is_authorized = true,
           access_granted_at = now(),
           updated_at = now()
     where id = $1
     returning *`,
    [playerId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function deauthorizePlayer(playerId: string) {
  const pool = getPgPool();
  const result = await pool.query<PlayerRow>(
    `update players
        set is_authorized = false,
            access_granted_at = null,
            updated_at = now()
      where id = $1
      returning *`,
    [playerId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

export async function updateHighestScore(
  playerId: string,
  score: number,
  client?: PoolClient
) {
  const pool = client ?? getPgPool();
  const result = await pool.query<PlayerRow>(
    `update players
        set highest_score = $2,
            updated_at = now()
      where id = $1
        and highest_score < $2
      returning *`,
    [playerId, score]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}

function sanitizeUsername(username: string | null): string | null {
  if (!username) return null;
  const trimmed = username.trim();
  if (trimmed.length === 0) return null;
  // Limit to 50 characters
  if (trimmed.length > 50) return trimmed.substring(0, 50);
  return trimmed;
}

export async function updateUsername(
  playerId: string,
  username: string | null
) {
  const pool = getPgPool();
  const sanitized = sanitizeUsername(username);
  const result = await pool.query<PlayerRow>(
    `update players
       set username = $2,
           updated_at = now()
     where id = $1
     returning *`,
    [playerId, sanitized]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapPlayerRow(result.rows[0]);
}
