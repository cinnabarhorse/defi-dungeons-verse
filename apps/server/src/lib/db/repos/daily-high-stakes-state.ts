import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type {
  DailyHighStakesStateRow,
  DailyHighStakesStateRecord,
} from '../types';

function mapRow(row: DailyHighStakesStateRow): DailyHighStakesStateRecord {
  return {
    date: row.date,
    accountId: row.account_id,
    remainingAttunements: Number(row.remaining_attunements) || 0,
    activeDifficultyId: row.active_difficulty_id ?? null,
    activeRunId: row.active_run_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export interface GetStateInput {
  date: string;
  accountId: string;
  client?: PoolClient;
}

export async function getState(
  input: GetStateInput
): Promise<DailyHighStakesStateRecord | null> {
  const pool = getPool(input.client);
  const result: QueryResult<DailyHighStakesStateRow> = await pool.query(
    `
      select *
        from daily_high_stakes_state
       where date = $1
         and account_id = $2
       limit 1
    `,
    [input.date, input.accountId]
  );
  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export interface EnsureStateInput extends GetStateInput {
  attunementsPerDay: number;
}

export async function ensureState(
  input: EnsureStateInput
): Promise<DailyHighStakesStateRecord> {
  const pool = getPool(input.client);
  const remaining = Math.max(0, Math.floor(Number(input.attunementsPerDay) || 0));
  await pool.query(
    `
      insert into daily_high_stakes_state (
        date,
        account_id,
        remaining_attunements
      ) values ($1, $2, $3)
      on conflict (date, account_id) do nothing
    `,
    [input.date, input.accountId, remaining]
  );
  const state = await getState({
    date: input.date,
    accountId: input.accountId,
    client: input.client,
  });
  if (!state) {
    // Fallback to a default in the unlikely event the select fails
    return {
      date: input.date,
      accountId: input.accountId,
      remainingAttunements: remaining,
      activeDifficultyId: null,
      activeRunId: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return state;
}

export interface AttuneInput {
  date: string;
  accountId: string;
  difficultyId: string;
  client?: PoolClient;
}

export async function attuneDifficulty(
  input: AttuneInput
): Promise<DailyHighStakesStateRecord | null> {
  const pool = getPool(input.client);
  const result: QueryResult<DailyHighStakesStateRow> = await pool.query(
    `
      update daily_high_stakes_state
         set remaining_attunements = greatest(0, remaining_attunements - 1),
             active_difficulty_id = $3,
             active_run_id = null,
             updated_at = now()
       where date = $1
         and account_id = $2
         and remaining_attunements > 0
       returning *
    `,
    [input.date, input.accountId, input.difficultyId]
  );

  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export interface MarkRunActiveInput {
  date: string;
  accountId: string;
  difficultyId: string;
  runId: string;
  client?: PoolClient;
}

export async function markRunActive(
  input: MarkRunActiveInput
): Promise<DailyHighStakesStateRecord | null> {
  const pool = getPool(input.client);
  const result: QueryResult<DailyHighStakesStateRow> = await pool.query(
    `
      update daily_high_stakes_state
         set active_run_id = $4,
             updated_at = now()
       where date = $1
         and account_id = $2
         and active_difficulty_id = $3
         and (active_run_id is null or active_run_id = $4)
       returning *
    `,
    [input.date, input.accountId, input.difficultyId, input.runId]
  );

  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}

export interface ClearRunInput {
  date: string;
  accountId: string;
  runId?: string | null;
  client?: PoolClient;
}

export async function clearActiveRun(
  input: ClearRunInput
): Promise<DailyHighStakesStateRecord | null> {
  const pool = getPool(input.client);
  const params: unknown[] = [input.date, input.accountId];
  const conditions: string[] = ['date = $1', 'account_id = $2'];
  if (input.runId) {
    params.push(input.runId);
    conditions.push(`active_run_id = $${params.length}`);
  }

  const result: QueryResult<DailyHighStakesStateRow> = await pool.query(
    `
      update daily_high_stakes_state
         set active_difficulty_id = null,
             active_run_id = null,
             updated_at = now()
       where ${conditions.join(' and ')}
       returning *
    `,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }
  return mapRow(result.rows[0]);
}
