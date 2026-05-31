import type { PoolClient, QueryResult } from 'pg';
import { getPgPool } from '../client';
import type { DepositRecord, DepositRow, DepositStatus } from '../types';

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeAddress(value: string): string {
  return value ? value.toLowerCase() : value;
}

function mapDepositRow(row: DepositRow): DepositRecord {
  return {
    id: row.id,
    userId: row.user_id,
    chainId: toNumber(row.chain_id),
    contractAddress: row.contract_address,
    depositorAddress: row.depositor_address,
    tokenAddress: row.token_address,
    tokenSymbol: row.token_symbol,
    amount: row.amount,
    amountWei: row.amount_wei,
    txHash: row.tx_hash,
    txStatus: (row.tx_status as DepositStatus) ?? 'pending',
    depositId: row.deposit_id,
    yieldAmount: row.yield_amount,
    pointsMinted: row.points_minted,
    unlockAt: row.unlock_at,
    autoRenew: Boolean(row.auto_renew),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    withdrawn: Boolean(row.withdrawn),
    withdrawalTx: row.withdrawal_tx,
  };
}

function getPool(client?: PoolClient) {
  return client ?? getPgPool();
}

export interface CreatePendingDepositInput {
  userId?: string | null;
  chainId: number;
  contractAddress: string;
  depositorAddress: string;
  tokenAddress: string;
  tokenSymbol: string;
  amount: string;
  amountWei: string;
  txHash?: string | null;
  autoRenew: boolean;
  expiresAt?: string | null;
  client?: PoolClient;
}

export async function createPendingDeposit(
  input: CreatePendingDepositInput
): Promise<DepositRecord> {
  const pool = getPool(input.client);
  const columns: string[] = [
    'user_id',
    'chain_id',
    'contract_address',
    'depositor_address',
    'token_address',
    'token_symbol',
    'amount',
    'amount_wei',
    'tx_hash',
    'tx_status',
    'auto_renew',
  ];
  const params: unknown[] = [
    input.userId ?? null,
    input.chainId,
    normalizeAddress(input.contractAddress),
    normalizeAddress(input.depositorAddress),
    normalizeAddress(input.tokenAddress),
    input.tokenSymbol.toUpperCase(),
    input.amount,
    input.amountWei,
    input.txHash ? input.txHash.toLowerCase() : null,
    'pending',
    input.autoRenew,
  ];

  if (input.expiresAt) {
    columns.push('expires_at');
    params.push(input.expiresAt);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const query = `
    insert into public.deposits (${columns.join(', ')})
    values (${placeholders.join(', ')})
    returning *
  `;

  const result: QueryResult<DepositRow> = await pool.query(query, params);
  return mapDepositRow(result.rows[0]);
}

export interface UpdateDepositInput {
  id: string;
  txStatus?: DepositStatus;
  txHash?: string | null;
  depositId?: string | null;
  yieldAmount?: string | null;
  pointsMinted?: string | null;
  unlockAt?: string | null;
  amountWei?: string | null;
  autoRenew?: boolean;
  expiresAt?: string | null;
  withdrawn?: boolean;
  withdrawalTx?: string | null;
  client?: PoolClient;
}

export async function updateDeposit(
  input: UpdateDepositInput
): Promise<DepositRecord | null> {
  const updates: string[] = [];
  const params: unknown[] = [input.id];

  if (input.txStatus) {
    params.push(input.txStatus);
    updates.push(`tx_status = $${params.length}`);
  }

  if (input.txHash !== undefined) {
    params.push(input.txHash ? input.txHash.toLowerCase() : null);
    updates.push(`tx_hash = $${params.length}`);
  }

  if (input.depositId !== undefined) {
    params.push(input.depositId);
    updates.push(`deposit_id = $${params.length}`);
  }

  if (input.yieldAmount !== undefined) {
    params.push(input.yieldAmount);
    updates.push(`yield_amount = $${params.length}`);
  }

  if (input.pointsMinted !== undefined) {
    params.push(input.pointsMinted);
    updates.push(`points_minted = $${params.length}`);
  }

  if (input.unlockAt !== undefined) {
    params.push(input.unlockAt);
    updates.push(`unlock_at = $${params.length}`);
  }

  if (input.amountWei !== undefined) {
    params.push(input.amountWei);
    updates.push(`amount_wei = $${params.length}`);
  }

  if (input.autoRenew !== undefined) {
    params.push(input.autoRenew);
    updates.push(`auto_renew = $${params.length}`);
  }

  if (input.expiresAt !== undefined) {
    params.push(input.expiresAt);
    updates.push(`expires_at = $${params.length}`);
  }

  if (input.withdrawn !== undefined) {
    params.push(input.withdrawn);
    updates.push(`withdrawn = $${params.length}`);
  }

  if (input.withdrawalTx !== undefined) {
    params.push(input.withdrawalTx ?? null);
    updates.push(`withdrawal_tx = $${params.length}`);
  }

  if (updates.length === 0) {
    return null;
  }

  updates.push('updated_at = now()');

  const query = `
    update public.deposits
       set ${updates.join(', ')}
     where id = $1
     returning *
  `;

  const pool = getPool(input.client);
  const result: QueryResult<DepositRow> = await pool.query(query, params);
  if (result.rows.length === 0) return null;
  return mapDepositRow(result.rows[0]);
}

export async function listDepositsByUser(
  userId: string,
  limit = 50
): Promise<DepositRecord[]> {
  const pool = getPgPool();
  const query = `
    select *
      from public.deposits
     where user_id = $1
     order by created_at desc
     limit $2
  `;
  const result: QueryResult<DepositRow> = await pool.query(query, [
    userId,
    Math.max(1, Math.min(200, limit)),
  ]);
  return result.rows.map(mapDepositRow);
}

export async function listDepositsByAddress(
  depositorAddress: string,
  limit = 50
): Promise<DepositRecord[]> {
  const pool = getPgPool();
  const query = `
    select *
      from public.deposits
     where depositor_address = $1
     order by created_at desc
     limit $2
  `;
  const result: QueryResult<DepositRow> = await pool.query(query, [
    normalizeAddress(depositorAddress),
    Math.max(1, Math.min(200, limit)),
  ]);
  return result.rows.map(mapDepositRow);
}

export async function getDepositByTxHash(
  txHash: string
): Promise<DepositRecord | null> {
  const pool = getPgPool();
  const query = `
    select *
      from public.deposits
     where tx_hash = $1
     limit 1
  `;
  const result: QueryResult<DepositRow> = await pool.query(query, [
    txHash.toLowerCase(),
  ]);
  if (result.rows.length === 0) return null;
  return mapDepositRow(result.rows[0]);
}

export async function listDepositsByStatus(
  status: DepositStatus,
  limit = 50
): Promise<DepositRecord[]> {
  const pool = getPgPool();
  const query = `
    select *
      from public.deposits
     where tx_status = $1
     order by created_at desc
     limit $2
  `;
  const result: QueryResult<DepositRow> = await pool.query(query, [
    status,
    Math.max(1, Math.min(500, limit)),
  ]);
  return result.rows.map(mapDepositRow);
}

/**
 * Atomically credit a deposit - only updates if points_minted is NULL
 * Returns the updated deposit if successful, null if already credited
 */
export async function creditDepositIfNotCredited(
  depositId: string,
  pointsMinted: string,
  client?: PoolClient
): Promise<DepositRecord | null> {
  const pool = getPool(client);
  const query = `
    update public.deposits
       set points_minted = $2,
           tx_status = 'credited',
           updated_at = now()
     where id = $1
       and (points_minted is null or points_minted = '')
     returning *
  `;
  const result: QueryResult<DepositRow> = await pool.query(query, [
    depositId,
    pointsMinted,
  ]);
  if (result.rows.length === 0) return null;
  return mapDepositRow(result.rows[0]);
}
