import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type { RunScoreRow, RunScoreRecord } from '../types';

function mapRow(row: RunScoreRow): RunScoreRecord {
  return {
    id: row.id,
    playerId: row.player_id,
    gameId: row.game_id,
    score: Number(row.score) || 0,
    difficultyTier: row.difficulty_tier,
    completedAt: row.completed_at,
    durationMs: row.duration_ms ?? null,
    kills: row.kills ?? null,
    xpEarned: row.xp_earned ?? null,
    validForHighScore: Boolean(row.valid_for_high_score),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export interface RecordRunScoreInput {
  playerId: string;
  gameId: string;
  score: number;
  difficultyTier?: string | null;
  durationMs?: number | null;
  kills?: number | null;
  xpEarned?: number | null;
  validForHighScore?: boolean;
  metadata?: Record<string, unknown>;
  client?: PoolClient;
}

export async function recordRunScore(input: RecordRunScoreInput) {
  const pool = getPool(input.client);
  const query = `
    insert into run_scores (
      player_id,
      game_id,
      score,
      difficulty_tier,
      completed_at,
      duration_ms,
      kills,
      xp_earned,
      valid_for_high_score,
      metadata
    ) values ($1,$2,$3,$4,now(),$5,$6,$7,$8,$9)
    returning *
  `;

  const params = [
    input.playerId,
    input.gameId,
    input.score,
    input.difficultyTier ?? null,
    input.durationMs ?? null,
    input.kills ?? null,
    input.xpEarned ?? null,
    Boolean(input.validForHighScore),
    JSON.stringify(input.metadata ?? {}),
  ];

  const result: QueryResult<RunScoreRow> = await pool.query(query, params);
  return mapRow(result.rows[0]);
}

export interface GetRunsByPlayerInput {
  playerId: string;
  limit?: number;
  offset?: number;
  client?: PoolClient;
}

export interface GetRunsByPlayerResult {
  runs: PlayerRunWithStats[];
  total: number;
}

export interface DailyRunsSummary {
  isHighStakes: boolean;
  runScore: number | null;
  thresholdScore: number | null;
}

export interface PlayerRunWithStats {
  id: string;
  gameId: string;
  playerId: string;
  playerWalletAddress?: string | null;
  playerUsername?: string | null;
  score: number | null;
  difficultyTier: string | null;
  completedAt: string | null;
  durationMs: number | null;
  kills: number | null;
  floorReached: number | null;
  xpEarned: number | null;
  validForHighScore: boolean;
  lickTonguesCollected: number;
  characterId: string | null;
  deaths: number | null;
  damageDealt: number | null;
  damageTaken: number | null;
  coinsCollected: number | null;
  usdcEarned: number | null;
  ghstEarned: number | null;
  levelBefore: number | null;
  levelAfter: number | null;
  status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
  region: string | null;
  dailyRuns?: DailyRunsSummary | null;
}

function extractDailyRunsSummaryFromMetadata(
  rawMetadata: unknown
): DailyRunsSummary | null {
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    return null;
  }

  const metadata = rawMetadata as { dailyRuns?: unknown };
  const dailyRaw = metadata.dailyRuns;

  if (!dailyRaw || typeof dailyRaw !== 'object') {
    return null;
  }

  const daily = dailyRaw as {
    isHighStakes?: unknown;
    runScore?: unknown;
    thresholdScore?: unknown;
  };

  const isHighStakes = Boolean(daily.isHighStakes);
  const runScore =
    typeof daily.runScore === 'number' && Number.isFinite(daily.runScore)
      ? daily.runScore
      : null;
  const thresholdScore =
    typeof daily.thresholdScore === 'number' &&
    Number.isFinite(daily.thresholdScore)
      ? daily.thresholdScore
      : null;

  if (!isHighStakes && runScore == null && thresholdScore == null) {
    return null;
  }

  return {
    isHighStakes,
    runScore,
    thresholdScore,
  };
}

export async function getRunsByPlayerId(
  input: GetRunsByPlayerInput
): Promise<GetRunsByPlayerResult> {
  const pool = getPool(input.client);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);

  // Get total count from game_players (all runs, not just high-score eligible)
  const countQuery = `
    select count(*) as total
    from game_players gp
    where gp.player_id = $1
  `;
  const countResult = await pool.query<{ total: string }>(countQuery, [
    input.playerId,
  ]);
  const total = Number(countResult.rows[0]?.total ?? 0);

  // Get all runs from game_players joined with games
  // Order by left_at (when they left) or joined_at (if still in game), descending
  const runsQuery = `
    select 
      gp.id as game_player_id,
      gp.game_id,
      gp.player_id,
      gp.character_id,
      gp.joined_at,
      gp.left_at,
      gp.kills,
      gp.deaths,
      gp.damage_dealt,
      gp.damage_taken,
      gp.coins_collected,
      gp.usdc_earned_base_units,
      gp.xp_gained,
      gp.level_before,
      gp.level_after,
      gp.metadata as game_player_metadata,
      g.difficulty_tier,
      g.region,
      g.started_at as game_started_at,
      g.ended_at as game_ended_at,
      g.status as game_status,
      g.metadata as game_metadata,
      g.floor_reached,
      rs.score,
      rs.completed_at as score_completed_at,
      rs.duration_ms as score_duration_ms,
      rs.valid_for_high_score,
      rs.metadata as score_metadata
    from game_players gp
    left join games g on g.id = gp.game_id
    left join run_scores rs on rs.game_id = gp.game_id and rs.player_id = gp.player_id
    where gp.player_id = $1
    order by coalesce(gp.left_at, gp.joined_at) desc nulls last
    limit $2 offset $3
  `;

  const runsResult = await pool.query<{
    game_player_id: string;
    game_id: string;
    player_id: string;
    character_id: string | null;
    joined_at: string | null;
    left_at: string | null;
    kills: number;
    deaths: number;
    damage_dealt: number;
    damage_taken: number;
    coins_collected: number;
    usdc_earned_base_units: string;
    xp_gained: string;
    level_before: number | null;
    level_after: number | null;
    game_player_metadata: unknown;
    difficulty_tier: string | null;
    region: string | null;
    game_started_at: string | null;
    game_ended_at: string | null;
    game_status: string | null;
    game_metadata: unknown;
    floor_reached: number | null;
    score: number | null;
    score_completed_at: string | null;
    score_duration_ms: number | null;
    valid_for_high_score: boolean | null;
    score_metadata: unknown;
  }>(runsQuery, [input.playerId, limit, offset]);

  if (runsResult.rows.length === 0) {
    return { runs: [], total };
  }

  const gameIds = runsResult.rows.map((row) => row.game_id);
  // Sum GHST earned per game for this player from economy_transactions
  const ghstQuery = `
    select 
      game_id,
      coalesce(sum(amount)::float8, 0) as ghst
    from economy_transactions
    where player_id = $1
      and game_id = any($2::uuid[])
      and currency = 'GHST'
    group by game_id
  `;
  const ghstResult = await pool.query<{ game_id: string; ghst: string | null }>(
    ghstQuery,
    [input.playerId, gameIds]
  );
  const ghstByGameId = new Map<string, number>();
  for (const row of ghstResult.rows) {
    const v = Number(row.ghst);
    ghstByGameId.set(row.game_id, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Get lick tongues collected per game from inventory events
  const lickTonguesQuery = `
    select 
      game_id,
      sum(delta) as total_tongues
    from player_inventory_events
    where player_id = $1
      and game_id = any($2::uuid[])
      and item_type = 'material'
      and item_name = 'Lick Tongue'
      and delta > 0
    group by game_id
  `;

  const lickTonguesResult = await pool.query<{
    game_id: string;
    total_tongues: string;
  }>(lickTonguesQuery, [input.playerId, gameIds]);

  const lickTonguesByGameId = new Map<string, number>();
  for (const row of lickTonguesResult.rows) {
    lickTonguesByGameId.set(
      row.game_id,
      Math.max(0, Number(row.total_tongues) || 0)
    );
  }

  // Sum USDC earned per game for this player from economy_transactions.
  // This is treated as the source of truth for per-run USDC, with a fallback
  // to game_players.usdc_earned_base_units for legacy data.
  const usdcQuery = `
    select 
      game_id,
      coalesce(sum(amount)::float8, 0) as usdc
    from economy_transactions
    where player_id = $1
      and game_id = any($2::uuid[])
      and currency = 'USDC'
    group by game_id
  `;
  const usdcResult = await pool.query<{ game_id: string; usdc: string | null }>(
    usdcQuery,
    [input.playerId, gameIds]
  );
  const usdcByGameId = new Map<string, number>();
  for (const row of usdcResult.rows) {
    const v = Number(row.usdc);
    usdcByGameId.set(row.game_id, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Combine all data
  const runs: PlayerRunWithStats[] = runsResult.rows.map((row) => {
    const lickTongues = lickTonguesByGameId.get(row.game_id) ?? 0;

    // Calculate duration: use score duration if available, otherwise calculate from joined/left times
    let durationMs: number | null = row.score_duration_ms ?? null;
    if (durationMs == null) {
      const leftAt = row.left_at ? Date.parse(row.left_at) : null;
      const joinedAt = row.joined_at ? Date.parse(row.joined_at) : null;
      if (leftAt && joinedAt && !isNaN(leftAt) && !isNaN(joinedAt)) {
        durationMs = Math.max(0, leftAt - joinedAt);
      }
    }

    // Use score completed_at if available, otherwise use left_at or game_ended_at
    const completedAt =
      row.score_completed_at ?? row.left_at ?? row.game_ended_at ?? null;

    // Determine run status
    // Check if boss was killed from game metadata
    let bossKilled = false;
    try {
      const metadata =
        row.game_metadata && typeof row.game_metadata === 'object'
          ? (row.game_metadata as Record<string, unknown>)
          : {};
      bossKilled = Boolean(metadata.bossKilled);
    } catch {
      // Ignore errors parsing metadata
    }

    let status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
    if (row.score_completed_at) {
      status = 'completed';
    } else if (bossKilled && row.game_ended_at) {
      // Boss was killed, so this is a completed run even without score record
      status = 'completed';
    } else if (
      row.left_at &&
      (!row.game_ended_at ||
        new Date(row.left_at) < new Date(row.game_ended_at))
    ) {
      status = 'abandoned';
    } else if (row.game_ended_at) {
      status = 'game_ended';
    } else if (row.game_status === 'active') {
      status = 'in_progress';
    } else {
      // Default to abandoned if player left, otherwise game_ended
      status = row.left_at ? 'abandoned' : 'game_ended';
    }

    // Extract score and daily-runs metadata from run_scores first, fallback to game_players metadata
    let score: number | null = row.score ?? null;
    const dailyRuns = extractDailyRunsSummaryFromMetadata(row.score_metadata);

    if (score == null && row.game_player_metadata) {
      try {
        const metadata =
          row.game_player_metadata &&
          typeof row.game_player_metadata === 'object'
            ? (row.game_player_metadata as Record<string, unknown>)
            : {};
        const scoreData = metadata.score as
          | { final?: number }
          | null
          | undefined;
        if (scoreData && typeof scoreData.final === 'number') {
          score = scoreData.final;
        }
      } catch {
        // Ignore errors parsing metadata
      }
    }

    return {
      id: row.game_player_id,
      gameId: row.game_id,
      playerId: row.player_id,
      score,
      difficultyTier: row.difficulty_tier,
      completedAt,
      durationMs,
      kills: row.kills ?? null,
      floorReached:
        row.floor_reached != null
          ? Math.max(0, Math.floor(Number(row.floor_reached) || 0))
          : null,
      xpEarned: row.xp_gained ? Number(row.xp_gained) : null,
      validForHighScore: Boolean(row.valid_for_high_score),
      lickTonguesCollected: lickTongues,
      characterId: row.character_id ?? null,
      deaths: row.deaths ?? null,
      damageDealt: row.damage_dealt ?? null,
      damageTaken: row.damage_taken ?? null,
      coinsCollected: row.coins_collected ?? null,
      usdcEarned: (() => {
        const usdcTokens = usdcByGameId.get(row.game_id) ?? 0;
        if (usdcTokens > 0) {
          // Store in base units (6 decimals) to match existing conventions.
          return Math.round(usdcTokens * 1_000_000);
        }
        if (row.usdc_earned_base_units) {
          const v = Number(row.usdc_earned_base_units);
          return Number.isFinite(v) && v > 0 ? v : null;
        }
        return null;
      })(),
      ghstEarned: (() => {
        const v = ghstByGameId.get(row.game_id) ?? 0;
        return v > 0 ? v : null;
      })(),
      levelBefore: row.level_before ?? null,
      levelAfter: row.level_after ?? null,
      status,
      region: row.region ?? null,
      dailyRuns,
    };
  });

  return { runs, total };
}

export interface GetAllRunsInput {
  limit?: number;
  offset?: number;
  client?: PoolClient;
}

export interface GetAllRunsResult {
  runs: PlayerRunWithStats[];
  total: number;
}

export async function getAllRuns(
  input: GetAllRunsInput = {}
): Promise<GetAllRunsResult> {
  const pool = getPool(input.client);
  const limit = Math.max(1, Math.min(100, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);

  // Get total count from game_players (all runs, not just high-score eligible)
  const countQuery = `
    select count(*) as total
    from game_players gp
  `;
  const countResult = await pool.query<{ total: string }>(countQuery);
  const total = Number(countResult.rows[0]?.total ?? 0);

  // Get all runs from game_players joined with games and players
  // Order by left_at (when they left) or joined_at (if still in game), descending
  const runsQuery = `
    select 
      gp.id as game_player_id,
      gp.game_id,
      gp.player_id,
      gp.character_id,
      gp.joined_at,
      gp.left_at,
      gp.kills,
      gp.deaths,
      gp.damage_dealt,
      gp.damage_taken,
      gp.coins_collected,
      gp.usdc_earned_base_units,
      gp.xp_gained,
      gp.level_before,
      gp.level_after,
      gp.metadata as game_player_metadata,
      g.difficulty_tier,
      g.region,
      g.started_at as game_started_at,
      g.ended_at as game_ended_at,
      g.status as game_status,
      g.metadata as game_metadata,
      g.floor_reached,
      rs.score,
      rs.completed_at as score_completed_at,
      rs.duration_ms as score_duration_ms,
      rs.valid_for_high_score,
      rs.metadata as score_metadata,
      p.wallet_address as player_wallet_address,
      p.username as player_username
    from game_players gp
    left join games g on g.id = gp.game_id
    left join run_scores rs on rs.game_id = gp.game_id and rs.player_id = gp.player_id
    left join players p on p.id = gp.player_id
    order by coalesce(gp.left_at, gp.joined_at) desc nulls last
    limit $1 offset $2
  `;

  const runsResult = await pool.query<{
    game_player_id: string;
    game_id: string;
    player_id: string;
    character_id: string | null;
    joined_at: string | null;
    left_at: string | null;
    kills: number;
    deaths: number;
    damage_dealt: number;
    damage_taken: number;
    coins_collected: number;
    usdc_earned_base_units: string;
    xp_gained: string;
    level_before: number | null;
    level_after: number | null;
    game_player_metadata: unknown;
    difficulty_tier: string | null;
    region: string | null;
    game_started_at: string | null;
    game_ended_at: string | null;
    game_status: string | null;
    game_metadata: unknown;
    floor_reached: number | null;
    score: number | null;
    score_completed_at: string | null;
    score_duration_ms: number | null;
    valid_for_high_score: boolean | null;
    player_wallet_address: string | null;
    player_username: string | null;
    score_metadata: unknown;
  }>(runsQuery, [limit, offset]);

  if (runsResult.rows.length === 0) {
    return { runs: [], total };
  }

  const gameIds = runsResult.rows.map((row) => row.game_id);
  const playerIds = runsResult.rows.map((row) => row.player_id);
  // Sum GHST earned per (player_id, game_id) pair from economy_transactions
  const ghstQuery = `
    select 
      player_id,
      game_id,
      coalesce(sum(amount)::float8, 0) as ghst
    from economy_transactions
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and currency = 'GHST'
    group by player_id, game_id
  `;
  const ghstResult = await pool.query<{
    player_id: string;
    game_id: string;
    ghst: string | null;
  }>(ghstQuery, [playerIds, gameIds]);
  const ghstByKey = new Map<string, number>();
  for (const row of ghstResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    const v = Number(row.ghst);
    ghstByKey.set(key, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Get lick tongues collected per game from inventory events
  // Need to get tongues for all players and games
  const lickTonguesQuery = `
    select 
      player_id,
      game_id,
      sum(delta) as total_tongues
    from player_inventory_events
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and item_type = 'material'
      and item_name = 'Lick Tongue'
      and delta > 0
    group by player_id, game_id
  `;

  const lickTonguesResult = await pool.query<{
    player_id: string;
    game_id: string;
    total_tongues: string;
  }>(lickTonguesQuery, [playerIds, gameIds]);

  const lickTonguesByKey = new Map<string, number>();
  for (const row of lickTonguesResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    lickTonguesByKey.set(key, Math.max(0, Number(row.total_tongues) || 0));
  }

  // Sum USDC earned per (player_id, game_id) pair from economy_transactions.
  // This is the primary source of truth for per-run USDC; we only fall back to
  // game_players.usdc_earned_base_units when no economy rows exist.
  const usdcQuery = `
    select 
      player_id,
      game_id,
      coalesce(sum(amount)::float8, 0) as usdc
    from economy_transactions
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and currency = 'USDC'
    group by player_id, game_id
  `;
  const usdcResult = await pool.query<{
    player_id: string;
    game_id: string;
    usdc: string | null;
  }>(usdcQuery, [playerIds, gameIds]);
  const usdcByKey = new Map<string, number>();
  for (const row of usdcResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    const v = Number(row.usdc);
    usdcByKey.set(key, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Combine all data
  const runs: PlayerRunWithStats[] = runsResult.rows.map((row) => {
    const key = `${row.player_id}:${row.game_id}`;
    const lickTongues = lickTonguesByKey.get(key) ?? 0;

    // Calculate duration: use score duration if available, otherwise calculate from joined/left times
    let durationMs: number | null = row.score_duration_ms ?? null;
    if (durationMs == null) {
      const leftAt = row.left_at ? Date.parse(row.left_at) : null;
      const joinedAt = row.joined_at ? Date.parse(row.joined_at) : null;
      if (leftAt && joinedAt && !isNaN(leftAt) && !isNaN(joinedAt)) {
        durationMs = Math.max(0, leftAt - joinedAt);
      }
    }

    // Use score completed_at if available, otherwise use left_at or game_ended_at
    const completedAt =
      row.score_completed_at ?? row.left_at ?? row.game_ended_at ?? null;

    // Determine run status
    // Check if boss was killed from game metadata
    let bossKilled = false;
    try {
      const metadata =
        row.game_metadata && typeof row.game_metadata === 'object'
          ? (row.game_metadata as Record<string, unknown>)
          : {};
      bossKilled = Boolean(metadata.bossKilled);
    } catch {
      // Ignore errors parsing metadata
    }

    let status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
    if (row.score_completed_at) {
      status = 'completed';
    } else if (bossKilled && row.game_ended_at) {
      // Boss was killed, so this is a completed run even without score record
      status = 'completed';
    } else if (
      row.left_at &&
      (!row.game_ended_at ||
        new Date(row.left_at) < new Date(row.game_ended_at))
    ) {
      status = 'abandoned';
    } else if (row.game_ended_at) {
      status = 'game_ended';
    } else if (row.game_status === 'active') {
      status = 'in_progress';
    } else {
      // Default to abandoned if player left, otherwise game_ended
      status = row.left_at ? 'abandoned' : 'game_ended';
    }

    // Extract score and daily-runs metadata from run_scores first, fallback to game_players metadata
    let score: number | null = row.score ?? null;
    const dailyRuns = extractDailyRunsSummaryFromMetadata(row.score_metadata);
    if (score == null && row.game_player_metadata) {
      try {
        const metadata =
          row.game_player_metadata &&
          typeof row.game_player_metadata === 'object'
            ? (row.game_player_metadata as Record<string, unknown>)
            : {};
        const scoreData = metadata.score as
          | { final?: number }
          | null
          | undefined;
        if (scoreData && typeof scoreData.final === 'number') {
          score = scoreData.final;
        }
      } catch {
        // Ignore errors parsing metadata
      }
    }

    return {
      id: row.game_player_id,
      gameId: row.game_id,
      playerId: row.player_id,
      playerWalletAddress: row.player_wallet_address ?? null,
      playerUsername: row.player_username ?? null,
      score,
      difficultyTier: row.difficulty_tier,
      completedAt,
      durationMs,
      kills: row.kills ?? null,
      floorReached:
        row.floor_reached != null
          ? Math.max(0, Math.floor(Number(row.floor_reached) || 0))
          : null,
      xpEarned: row.xp_gained ? Number(row.xp_gained) : null,
      validForHighScore: Boolean(row.valid_for_high_score),
      lickTonguesCollected: lickTongues,
      characterId: row.character_id ?? null,
      deaths: row.deaths ?? null,
      damageDealt: row.damage_dealt ?? null,
      damageTaken: row.damage_taken ?? null,
      coinsCollected: row.coins_collected ?? null,
      usdcEarned: (() => {
        const usdcTokens = usdcByKey.get(key) ?? 0;
        if (usdcTokens > 0) {
          return Math.round(usdcTokens * 1_000_000);
        }
        if (row.usdc_earned_base_units) {
          const v = Number(row.usdc_earned_base_units);
          return Number.isFinite(v) && v > 0 ? v : null;
        }
        return null;
      })(),
      ghstEarned: (() => {
        const v = ghstByKey.get(key) ?? 0;
        return v > 0 ? v : null;
      })(),
      levelBefore: row.level_before ?? null,
      levelAfter: row.level_after ?? null,
      status,
      region: row.region ?? null,
      dailyRuns,
    };
  });

  return { runs, total };
}

export interface GetTopRunsByScoreInput {
  limit?: number;
  client?: PoolClient;
}

export async function getTopRunsByScore(
  input: GetTopRunsByScoreInput = {}
): Promise<PlayerRunWithStats[]> {
  const pool = getPool(input.client);
  const limit = Math.max(1, Math.min(200, input.limit ?? 100));

  // Fetch top runs by score for ALL players.
  // Order by a computed final_score: run_scores.score OR gp.metadata.score.final
  const topRunsQuery = `
    select 
      gp.player_id,
      gp.game_id,
      coalesce(rs.score, nullif((gp.metadata -> 'score' ->> 'final'), '')::numeric) as final_score,
      rs.completed_at as score_completed_at,
      rs.duration_ms as score_duration_ms,
      rs.valid_for_high_score,
      gp.id as game_player_id,
      gp.character_id,
      gp.joined_at,
      gp.left_at,
      gp.kills,
      gp.deaths,
      gp.damage_dealt,
      gp.damage_taken,
      gp.coins_collected,
      gp.usdc_earned_base_units,
      gp.xp_gained,
      gp.level_before,
      gp.level_after,
      gp.metadata as game_player_metadata,
      g.difficulty_tier,
      g.region,
      g.started_at as game_started_at,
      g.ended_at as game_ended_at,
      g.status as game_status,
      g.metadata as game_metadata,
      g.floor_reached,
      p.wallet_address as player_wallet_address,
      p.username as player_username
    from game_players gp
    left join run_scores rs on rs.game_id = gp.game_id and rs.player_id = gp.player_id
    left join games g on g.id = gp.game_id
    left join players p on p.id = gp.player_id
    where coalesce(
            rs.score,
            nullif((gp.metadata -> 'score' ->> 'final'), '')::numeric
          ) is not null
    order by coalesce(rs.score, nullif((gp.metadata -> 'score' ->> 'final'), '')::numeric) desc,
             coalesce(rs.completed_at, gp.left_at, g.ended_at) desc nulls last
    limit $1
  `;

  const topRunsResult = await pool.query<{
    player_id: string;
    game_id: string;
    final_score: string | null;
    score_completed_at: string | null;
    score_duration_ms: number | null;
    valid_for_high_score: boolean | null;
    game_player_id: string;
    character_id: string | null;
    joined_at: string | null;
    left_at: string | null;
    kills: number;
    deaths: number;
    damage_dealt: number;
    damage_taken: number;
    coins_collected: number;
    usdc_earned_base_units: string;
    xp_gained: string;
    level_before: number | null;
    level_after: number | null;
    game_player_metadata: unknown;
    difficulty_tier: string | null;
    region: string | null;
    game_started_at: string | null;
    game_ended_at: string | null;
    game_status: string | null;
    game_metadata: unknown;
    floor_reached: number | null;
    player_wallet_address: string | null;
    player_username: string | null;
  }>(topRunsQuery, [limit]);

  if (topRunsResult.rows.length === 0) {
    return [];
  }

  const gameIds = topRunsResult.rows.map((row) => row.game_id);
  const playerIds = topRunsResult.rows.map((row) => row.player_id);
  // Sum GHST earned per (player_id, game_id)
  const ghstQuery = `
    select 
      player_id,
      game_id,
      coalesce(sum(amount)::float8, 0) as ghst
    from economy_transactions
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and currency = 'GHST'
    group by player_id, game_id
  `;
  const ghstResult = await pool.query<{
    player_id: string;
    game_id: string;
    ghst: string | null;
  }>(ghstQuery, [playerIds, gameIds]);
  const ghstByKey = new Map<string, number>();
  for (const row of ghstResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    const v = Number(row.ghst);
    ghstByKey.set(key, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Get lick tongues collected per player/game pair
  const lickTonguesQuery = `
    select 
      player_id,
      game_id,
      sum(delta) as total_tongues
    from player_inventory_events
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and item_type = 'material'
      and item_name = 'Lick Tongue'
      and delta > 0
    group by player_id, game_id
  `;

  const lickTonguesResult = await pool.query<{
    player_id: string;
    game_id: string;
    total_tongues: string;
  }>(lickTonguesQuery, [playerIds, gameIds]);

  const lickTonguesByKey = new Map<string, number>();
  for (const row of lickTonguesResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    lickTonguesByKey.set(key, Math.max(0, Number(row.total_tongues) || 0));
  }

  // Sum USDC earned per (player_id, game_id) for leaderboard runs
  const usdcQuery = `
    select 
      player_id,
      game_id,
      coalesce(sum(amount)::float8, 0) as usdc
    from economy_transactions
    where player_id = any($1::uuid[])
      and game_id = any($2::uuid[])
      and currency = 'USDC'
    group by player_id, game_id
  `;
  const usdcResult = await pool.query<{
    player_id: string;
    game_id: string;
    usdc: string | null;
  }>(usdcQuery, [playerIds, gameIds]);
  const usdcByKey = new Map<string, number>();
  for (const row of usdcResult.rows) {
    const key = `${row.player_id}:${row.game_id}`;
    const v = Number(row.usdc);
    usdcByKey.set(key, Number.isFinite(v) && v > 0 ? v : 0);
  }

  // Combine all data
  const runs: PlayerRunWithStats[] = topRunsResult.rows.map((row) => {
    const key = `${row.player_id}:${row.game_id}`;
    const lickTongues = lickTonguesByKey.get(key) ?? 0;

    // Calculate duration: prefer score duration, otherwise derive from joined/left
    let durationMs: number | null = row.score_duration_ms ?? null;
    if (durationMs == null) {
      const leftAt = row.left_at ? Date.parse(row.left_at) : null;
      const joinedAt = row.joined_at ? Date.parse(row.joined_at) : null;
      if (leftAt && joinedAt && !isNaN(leftAt) && !isNaN(joinedAt)) {
        durationMs = Math.max(0, leftAt - joinedAt);
      }
    }

    // Use score completed_at if available, otherwise left_at or game_ended_at
    const completedAt =
      row.score_completed_at ?? row.left_at ?? row.game_ended_at ?? null;

    // Determine run status
    let bossKilled = false;
    try {
      const metadata =
        row.game_metadata && typeof row.game_metadata === 'object'
          ? (row.game_metadata as Record<string, unknown>)
          : {};
      bossKilled = Boolean(metadata.bossKilled);
    } catch {}

    let status: 'completed' | 'abandoned' | 'game_ended' | 'in_progress';
    if (row.score_completed_at) {
      status = 'completed';
    } else if (bossKilled && row.game_ended_at) {
      status = 'completed';
    } else if (
      row.left_at &&
      (!row.game_ended_at ||
        new Date(row.left_at) < new Date(row.game_ended_at))
    ) {
      status = 'abandoned';
    } else if (row.game_ended_at) {
      status = 'game_ended';
    } else if (row.game_status === 'active') {
      status = 'in_progress';
    } else {
      status = row.left_at ? 'abandoned' : 'game_ended';
    }

    // Score is guaranteed by query to be non-null via final_score
    const score = row.final_score != null ? Number(row.final_score) : null;

    return {
      id: row.game_player_id,
      gameId: row.game_id,
      playerId: row.player_id,
      playerWalletAddress: row.player_wallet_address ?? null,
      playerUsername: row.player_username ?? null,
      score,
      difficultyTier: row.difficulty_tier,
      completedAt,
      durationMs,
      kills: row.kills ?? null,
      floorReached:
        row.floor_reached != null
          ? Math.max(0, Math.floor(Number(row.floor_reached) || 0))
          : null,
      xpEarned: row.xp_gained ? Number(row.xp_gained) : null,
      validForHighScore: Boolean(row.valid_for_high_score),
      lickTonguesCollected: lickTongues,
      characterId: row.character_id ?? null,
      deaths: row.deaths ?? null,
      damageDealt: row.damage_dealt ?? null,
      damageTaken: row.damage_taken ?? null,
      coinsCollected: row.coins_collected ?? null,
      usdcEarned: (() => {
        const usdcTokens = usdcByKey.get(key) ?? 0;
        if (usdcTokens > 0) {
          return Math.round(usdcTokens * 1_000_000);
        }
        if (row.usdc_earned_base_units) {
          const v = Number(row.usdc_earned_base_units);
          return Number.isFinite(v) && v > 0 ? v : null;
        }
        return null;
      })(),
      ghstEarned: (() => {
        const v = ghstByKey.get(key) ?? 0;
        return v > 0 ? v : null;
      })(),
      levelBefore: row.level_before ?? null,
      levelAfter: row.level_after ?? null,
      status,
      region: row.region ?? null,
    };
  });

  return runs;
}
