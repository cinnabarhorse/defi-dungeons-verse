import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type {
  DailyBossHighScoreRow,
  DailyBossHighScoreRecord,
} from '../types';

function mapRow(row: DailyBossHighScoreRow): DailyBossHighScoreRecord {
  return {
    date: row.date,
    difficultyId: row.difficulty_id,
    score: Number(row.score) || 0,
    accountId: row.account_id ?? null,
    runId: row.run_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export interface GetHighScoreInput {
  date: string;
  difficultyId: string;
  client?: PoolClient;
}

export async function getHighScoreForDate(
  input: GetHighScoreInput
): Promise<DailyBossHighScoreRecord | null> {
  const pool = getPool(input.client);
  const result: QueryResult<DailyBossHighScoreRow> = await pool.query(
    `
      select *
        from daily_boss_high_scores
       where date = $1
         and difficulty_id = $2
       limit 1
    `,
    [input.date, input.difficultyId]
  );

  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export interface UpsertHighScoreInput {
  date: string;
  difficultyId: string;
  score: number;
  accountId?: string | null;
  runId?: string | null;
  client?: PoolClient;
}

export async function upsertHighScore(
  input: UpsertHighScoreInput
): Promise<DailyBossHighScoreRecord> {
  const pool = getPool(input.client);
  const score = Math.max(0, Math.floor(Number(input.score) || 0));
  const result: QueryResult<DailyBossHighScoreRow> = await pool.query(
    `
      insert into daily_boss_high_scores (
        date,
        difficulty_id,
        score,
        account_id,
        run_id
      ) values ($1, $2, $3, $4, $5)
      on conflict (date, difficulty_id) do update
        set score = greatest(daily_boss_high_scores.score, excluded.score),
            account_id = case
              when excluded.score >= daily_boss_high_scores.score then excluded.account_id
              else daily_boss_high_scores.account_id
            end,
            run_id = case
              when excluded.score >= daily_boss_high_scores.score then excluded.run_id
              else daily_boss_high_scores.run_id
            end,
            updated_at = case
              when excluded.score > daily_boss_high_scores.score then now()
              else daily_boss_high_scores.updated_at
            end
      returning *
    `,
    [
      input.date,
      input.difficultyId,
      score,
      input.accountId ?? null,
      input.runId ?? null,
    ]
  );

  return mapRow(result.rows[0]);
}
