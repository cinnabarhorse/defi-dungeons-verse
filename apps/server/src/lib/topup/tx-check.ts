import { ethers } from 'ethers';
import { BASE_CHAIN_ID, GAMEPOINTS_CONTRACT_ADDRESS } from './config';
import { GAMEPOINTS_ABI } from './abi';
import { depositsRepo, playersRepo, economyRepo } from '../db';
import type { DepositStatus } from '../db/types';

// Base RPC URL - can be overridden via env var
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org'; // Public Base RPC

interface TransactionReceipt {
  status: 0 | 1; // 0 = failed, 1 = success
  blockNumber: number;
  blockTimestamp?: number;
  depositId?: string;
  pointsMinted?: string;
  yieldAmount?: string;
  unlockAt?: string; // Already in event, don't calculate
}

interface DepositEvent {
  depositId: bigint;
  user: string;
  depositToken: string;
  depositAmount: bigint;
  yieldAmount: bigint;
  pointsMinted: bigint;
  unlockAt: bigint;
}

/**
 * Get a provider for Base network
 */
export function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(BASE_RPC_URL);
}

/**
 * Verify transaction sender matches expected address
 */
export async function verifyTransactionSender(
  txHash: string,
  expectedSender: string
): Promise<boolean> {
  try {
    const provider = getProvider();
    const normalizedHash = txHash.toLowerCase();
    const tx = await provider.getTransaction(normalizedHash);

    if (!tx) {
      return false;
    }

    return tx.from.toLowerCase() === expectedSender.toLowerCase();
  } catch (error) {
    console.error('Failed to verify transaction sender', error);
    return false;
  }
}

/**
 * Check transaction receipt and parse deposit events
 */
export async function checkTransactionReceipt(
  txHash: string
): Promise<TransactionReceipt | null> {
  const provider = getProvider();
  const normalizedHash = txHash.toLowerCase();

  // Check if transaction exists
  const receipt = await provider.getTransactionReceipt(normalizedHash);
  if (!receipt) {
    // Transaction not mined yet
    return null;
  }

  const status: 0 | 1 = receipt.status === 1 ? 1 : 0;

  // If transaction failed, return early
  if (status === 0) {
    return {
      status: 0,
      blockNumber: receipt.blockNumber,
    };
  }

  // Parse events from successful transaction
  const contract = new ethers.Contract(
    GAMEPOINTS_CONTRACT_ADDRESS,
    GAMEPOINTS_ABI,
    provider
  );

  let depositId: string | undefined;
  let pointsMinted: string | undefined;
  let yieldAmount: string | undefined;
  let unlockAt: string | undefined;

  // Look for Deposited event
  const depositEventInterface = contract.interface.getEvent('Deposited');
  if (!depositEventInterface) {
    throw new Error('Gamepoints ABI missing Deposited event definition');
  }
  const depositTopic = depositEventInterface.topicHash;

  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() !== GAMEPOINTS_CONTRACT_ADDRESS.toLowerCase()
    ) {
      continue;
    }

    if (log.topics[0] === depositTopic) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });

        if (parsed && parsed.name === 'Deposited') {
          depositId = parsed.args.depositId.toString();
          pointsMinted = parsed.args.pointsMinted.toString();
          yieldAmount = parsed.args.yieldAmount.toString();
          // unlockAt is a uint64 timestamp in the event
          const unlockAtBigInt = parsed.args.unlockAt;
          if (unlockAtBigInt) {
            unlockAt = new Date(Number(unlockAtBigInt) * 1000).toISOString();
          }
          break;
        }
      } catch (error) {
        console.error('Failed to parse deposit event', error);
      }
    }
  }

  // Get block timestamp
  let blockTimestamp: number | undefined;
  try {
    const block = await provider.getBlock(receipt.blockNumber);
    blockTimestamp = block?.timestamp;
  } catch (error) {
    console.error('Failed to fetch block timestamp', error);
  }

  return {
    status: 1,
    blockNumber: receipt.blockNumber,
    blockTimestamp,
    depositId,
    pointsMinted,
    yieldAmount,
    unlockAt,
  };
}

/**
 * Check and update pending deposits for a user
 */
export async function checkPendingDeposits(
  userId?: string | null,
  depositorAddress?: string
): Promise<{
  checked: number;
  updated: number;
}> {
  const { getPgPool } = await import('../db/client');
  const pool = getPgPool();

  // Get all pending deposits AND confirmed deposits that need crediting
  let query: string;
  let params: unknown[];

  if (userId) {
    query = `
      select *
      from public.deposits
      where user_id = $1 
        and tx_hash is not null
        and (
          tx_status = 'pending'
          or (tx_status = 'confirmed' and (points_minted is null or points_minted = ''))
        )
      order by created_at desc
      limit 20
    `;
    params = [userId];
  } else if (depositorAddress) {
    query = `
      select *
      from public.deposits
      where depositor_address = $1 
        and tx_hash is not null
        and (
          tx_status = 'pending'
          or (tx_status = 'confirmed' and (points_minted is null or points_minted = ''))
        )
      order by created_at desc
      limit 20
    `;
    params = [depositorAddress.toLowerCase()];
  } else {
    return { checked: 0, updated: 0 };
  }

  const result = await pool.query(query, params);
  const pendingDeposits = result.rows;

  let checked = 0;
  let updated = 0;

  for (const deposit of pendingDeposits) {
    if (!deposit.tx_hash) continue;

    checked++;
    try {
      // Verify transaction sender matches depositor address
      const depositDepositorAddress = deposit.depositor_address?.toLowerCase();
      if (!depositDepositorAddress) {
        console.warn(`Deposit ${deposit.id} missing depositor_address`);
        continue;
      }

      const senderMatches = await verifyTransactionSender(
        deposit.tx_hash,
        depositDepositorAddress
      );

      if (!senderMatches) {
        console.error(
          `Deposit ${deposit.id}: Transaction sender does not match depositor_address. ` +
            `Tx: ${deposit.tx_hash}, Expected: ${depositDepositorAddress}`
        );
        // Mark as failed - transaction doesn't belong to this deposit
        await depositsRepo.updateDeposit({
          id: deposit.id,
          txStatus: 'failed',
        });
        updated++;
        continue;
      }

      const receipt = await checkTransactionReceipt(deposit.tx_hash);

      if (!receipt) {
        // Still pending, skip
        continue;
      }

      const newStatus: DepositStatus =
        receipt.status === 1 ? 'confirmed' : 'failed';

      // Use unlockAt from event if available, otherwise calculate from block timestamp
      let unlockAt: string | null = receipt.unlockAt ?? null;
      if (!unlockAt && receipt.status === 1 && receipt.blockTimestamp) {
        // Fallback: calculate unlock_at if not in event (30 days lock period)
        const lockPeriodSeconds = 30 * 24 * 60 * 60;
        const unlockTimestamp = receipt.blockTimestamp + lockPeriodSeconds;
        unlockAt = new Date(unlockTimestamp * 1000).toISOString();
      }

      // Update deposit record - set status and other fields, but NOT points_minted yet
      // (points_minted will be set atomically by creditDepositIfNotCredited)
      const updatedDeposit = await depositsRepo.updateDeposit({
        id: deposit.id,
        txStatus: newStatus,
        depositId: receipt.depositId ?? null,
        yieldAmount: receipt.yieldAmount ?? null,
        unlockAt,
      });

      // Credit player if deposit was confirmed and has pointsMinted
      if (newStatus === 'confirmed' && receipt.pointsMinted && updatedDeposit) {
        const pointsMintedNum = Number.parseFloat(receipt.pointsMinted);
        if (Number.isFinite(pointsMintedNum) && pointsMintedNum > 0) {
          // Atomic check: only credit if deposit didn't already have points_minted
          // This prevents double crediting even if multiple processes check simultaneously
          // Also atomically sets points_minted and status to 'credited'
          const creditedDeposit = await depositsRepo.creditDepositIfNotCredited(
            deposit.id,
            receipt.pointsMinted
          );

          if (creditedDeposit) {
            // Only proceed with crediting if we successfully atomically updated the deposit
            // Try to find player by userId first, then by depositor_address
            let playerIdToCredit: string | null = creditedDeposit.userId;

            if (!playerIdToCredit) {
              // Look up player by wallet address
              const { getPlayerByWallet } = await import('../db/repos/players');
              const player = await getPlayerByWallet(
                creditedDeposit.depositorAddress
              );
              if (player) {
                playerIdToCredit = player.id;
              }
            }

            if (playerIdToCredit) {
              // Convert points to cents (1 credit = 100 cents)
              const creditsCents = Math.round(pointsMintedNum * 100);

              // Credit the player
              const player = await playersRepo.updateCredits(
                playerIdToCredit,
                creditsCents
              );

              if (player) {
                // Log the transaction
                try {
                  await economyRepo.logTransaction({
                    playerId: playerIdToCredit,
                    currency: 'CREDITS',
                    amount: pointsMintedNum,
                    source: 'deposit',
                    metadata: {
                      depositId: receipt.depositId ?? null,
                      txHash: deposit.tx_hash,
                      pointsMinted: receipt.pointsMinted,
                      yieldAmount: receipt.yieldAmount ?? null,
                    },
                  });
                } catch (error) {
                  console.error(
                    `Failed to log deposit transaction for player ${playerIdToCredit}`,
                    error
                  );
                  // Don't fail the whole operation if logging fails
                }
              }
            } else {
              // No player found - can't credit yet, but deposit is confirmed
              console.warn(
                `Deposit ${deposit.id} confirmed but no player found for address ${creditedDeposit.depositorAddress}`
              );
            }
          } else {
            // Deposit was already credited by another process - this is expected in concurrent scenarios
            // Just ensure status is set to 'credited' if it's still 'confirmed'
            if (updatedDeposit.txStatus === 'confirmed') {
              await depositsRepo.updateDeposit({
                id: deposit.id,
                txStatus: 'credited',
              });
            }
          }
        }
      }

      updated++;
    } catch (error) {
      console.error(`Failed to check deposit ${deposit.id}`, error);
      // Continue with next deposit
    }
  }

  return { checked, updated };
}
