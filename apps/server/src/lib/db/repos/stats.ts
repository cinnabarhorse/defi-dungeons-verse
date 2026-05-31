import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import { DEFAULT_ADMIN_ADDRESS } from '../../constants';

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export interface MatchesPerDayRow {
  day: string;
  count: number;
}

export interface GetMatchesPerDayInput {
  fromIso?: string;
  toIso?: string;
  client?: PoolClient;
}

export async function getMatchesPerDay(
  input: GetMatchesPerDayInput = {}
): Promise<MatchesPerDayRow[]> {
  const pool = getPool(input.client);
  // Normalize admin allowlist to lowercase for comparison
  const adminAllowlist = (
    process.env.ADMIN_WALLET_ALLOWLIST || DEFAULT_ADMIN_ADDRESS
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const nowIso = new Date().toISOString();
  const toIso = input.toIso ?? nowIso;
  const fromIso =
    input.fromIso ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    with day_series as (
      select generate_series(
        $1::timestamptz::date,
        $2::timestamptz::date,
        interval '1 day'
      )::date as day
    ),
    counts as (
      select
        date_trunc('day', coalesce(g.run_started_at, g.started_at))::date as day,
        count(*)::int as count
      from games g
      where coalesce(g.run_started_at, g.started_at) is not null
        and coalesce(g.run_started_at, g.started_at) >= $1::timestamptz
        and coalesce(g.run_started_at, g.started_at) <= $2::timestamptz
        and not exists (
          select 1
          from game_players gp
          join players p on p.id = gp.player_id
          where gp.game_id = g.id
            and lower(p.wallet_address) = any($3::text[])
        )
      group by 1
    )
    select
      to_char(ds.day, 'YYYY-MM-DD') as day,
      coalesce(c.count, 0) as count
    from day_series ds
    left join counts c on c.day = ds.day
    order by ds.day asc
  `;

  const result: QueryResult<{ day: string; count: number }> = await pool.query(
    query,
    [fromIso, toIso, adminAllowlist]
  );
  return result.rows.map((r) => ({
    day: r.day,
    count: Number(r.count) || 0,
  }));
}

export interface TokenAllocationsPerDayRow {
  day: string;
  usdc: number;
  ghst: number;
}

export interface GetTokenAllocationsPerDayInput {
  fromIso?: string;
  toIso?: string;
  client?: PoolClient;
}

export async function getTokenAllocationsPerDay(
  input: GetTokenAllocationsPerDayInput = {}
): Promise<TokenAllocationsPerDayRow[]> {
  const pool = getPool(input.client);
  const adminAllowlist = (
    process.env.ADMIN_WALLET_ALLOWLIST || DEFAULT_ADMIN_ADDRESS
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const nowIso = new Date().toISOString();
  const toIso = input.toIso ?? nowIso;
  const fromIso =
    input.fromIso ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    with day_series as (
      select generate_series(
        $1::timestamptz::date,
        $2::timestamptz::date,
        interval '1 day'
      )::date as day
    ),
    sums as (
      select
        date_trunc('day', et.created_at)::date as day,
        sum(case when et.currency = 'USDC' then et.amount::numeric else 0 end) as usdc,
        sum(case when et.currency = 'GHST' then et.amount::numeric else 0 end) as ghst
      from economy_transactions et
      join players p on p.id = et.player_id
      where et.created_at >= $1::timestamptz
        and et.created_at <= $2::timestamptz
        and not (lower(p.wallet_address) = any($3::text[]))
        and et.currency in ('USDC','GHST')
        and et.amount is not null
      group by 1
    )
    select
      to_char(ds.day, 'YYYY-MM-DD') as day,
      coalesce(s.usdc, 0)::float8 as usdc,
      coalesce(s.ghst, 0)::float8 as ghst
    from day_series ds
    left join sums s on s.day = ds.day
    order by ds.day asc
  `;

  const result: QueryResult<{ day: string; usdc: number; ghst: number }> =
    await pool.query(query, [fromIso, toIso, adminAllowlist]);
  return result.rows.map((r) => ({
    day: r.day,
    usdc: Number(r.usdc) || 0,
    ghst: Number(r.ghst) || 0,
  }));
}

export interface ActiveUsersPerDayRow {
  day: string;
  dau: number;
  mau: number;
}

export interface GetActiveUsersPerDayInput {
  fromIso?: string;
  toIso?: string;
  windowDays?: number; // MAU window, default 30 days
  client?: PoolClient;
}

export async function getActiveUsersPerDay(
  input: GetActiveUsersPerDayInput = {}
): Promise<ActiveUsersPerDayRow[]> {
  const pool = getPool(input.client);
  const adminAllowlist = (
    process.env.ADMIN_WALLET_ALLOWLIST || DEFAULT_ADMIN_ADDRESS
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const nowIso = new Date().toISOString();
  const toIso = input.toIso ?? nowIso;
  const fromIsoDefault = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  const fromIso = input.fromIso ?? fromIsoDefault;
  const windowDays = Math.max(1, Math.min(60, input.windowDays ?? 30)); // clamp 1..60
  const baseFromIso = new Date(
    new Date(fromIso).getTime() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const query = `
    with day_series as (
      select generate_series(
        $1::timestamptz::date,
        $2::timestamptz::date,
        interval '1 day'
      )::date as day
    ),
    per_day_players as (
      select distinct
        date_trunc('day', coalesce(g.run_started_at, g.started_at))::date as day,
        p.id as player_id
      from games g
      join game_players gp on gp.game_id = g.id
      join players p on p.id = gp.player_id
      where coalesce(g.run_started_at, g.started_at) is not null
        and coalesce(g.run_started_at, g.started_at) >= $3::timestamptz
        and coalesce(g.run_started_at, g.started_at) <= $2::timestamptz
        and not exists (
          select 1
          from game_players gp2
          join players p2 on p2.id = gp2.player_id
          where gp2.game_id = g.id
            and lower(p2.wallet_address) = any($4::text[])
        )
    )
    select
      to_char(ds.day, 'YYYY-MM-DD') as day,
      coalesce((
        select count(distinct pdp.player_id) from per_day_players pdp
        where pdp.day = ds.day
      ), 0)::int as dau,
      coalesce((
        select count(distinct pdp.player_id) from per_day_players pdp
        where pdp.day between (ds.day - ($5::int - 1) * interval '1 day') and ds.day
      ), 0)::int as mau
    from day_series ds
    order by ds.day asc
  `;

  const result: QueryResult<{ day: string; dau: number; mau: number }> =
    await pool.query(query, [
      fromIso,
      toIso,
      baseFromIso,
      adminAllowlist,
      windowDays,
    ]);
  return result.rows.map((r) => ({
    day: r.day,
    dau: Number(r.dau) || 0,
    mau: Number(r.mau) || 0,
  }));
}

export interface TopUpsPerDayRow {
  day: string;
  credits: number;
  count: number;
}

export interface GetTopUpsPerDayInput {
  fromIso?: string;
  toIso?: string;
  client?: PoolClient;
}

export async function getTopUpsPerDay(
  input: GetTopUpsPerDayInput = {}
): Promise<TopUpsPerDayRow[]> {
  const pool = getPool(input.client);
  const nowIso = new Date().toISOString();
  const toIso = input.toIso ?? nowIso;
  const fromIso =
    input.fromIso ??
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const query = `
    with day_series as (
      select generate_series(
        $1::timestamptz::date,
        $2::timestamptz::date,
        interval '1 day'
      )::date as day
    ),
    sums as (
      select
        date_trunc('day', et.created_at)::date as day,
        count(*)::int as count,
        sum(et.amount::numeric) as credits
      from economy_transactions et
      where et.created_at >= $1::timestamptz
        and et.created_at <= $2::timestamptz
        and et.currency = 'CREDITS'
        and et.source = 'deposit'
        and coalesce((et.metadata->>'initiatedBy')::text, '') <> 'manual_ui'
      group by 1
    )
    select
      to_char(ds.day, 'YYYY-MM-DD') as day,
      coalesce(s.credits, 0)::float8 as credits,
      coalesce(s.count, 0)::int as count
    from day_series ds
    left join sums s on s.day = ds.day
    order by ds.day asc
  `;

  const result: QueryResult<{ day: string; credits: number; count: number }> =
    await pool.query(query, [fromIso, toIso]);
  return result.rows.map((r) => ({
    day: r.day,
    credits: Number(r.credits) || 0,
    count: Number(r.count) || 0,
  }));
}
