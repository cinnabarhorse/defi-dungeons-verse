import { ethers } from 'ethers';
import {
  playersRepo,
  tokenWithdrawalsRepo,
  withdrawalSettingsRepo,
  runTransaction,
  type TokenWithdrawalRecord,
} from '../db';
import { getBaseLogger, emitServerLog } from '../logging';
import { createWithdrawalTransaction } from './tx-creator';
import { getWithdrawalTokenConfig } from './token-config';
import {
  MAX_WITHDRAWALS_PER_RUN,
  WITHDRAWAL_SENDING_TIMEOUT_MS,
  WITHDRAWAL_PROCESS_INTERVAL_MS,
} from './config';

const logger = getBaseLogger().child({ module: 'withdrawal_batch_processor' });

interface ProcessStats {
  attempted: number;
  processed: number;
  failures: number;
  reason?: string;
}

interface ProcessResultSuccess {
  state: 'success';
  withdrawalId: string;
  txHash: string;
  chainId: number;
}

interface ProcessResultFailure {
  state: 'failure';
  withdrawalId: string;
  reason: string;
}

interface ProcessResultEmpty {
  state: 'empty';
}

type ProcessResult =
  | ProcessResultSuccess
  | ProcessResultFailure
  | ProcessResultEmpty;

let processorTimer: ReturnType<typeof setInterval> | null = null;
let processorRunning = false;

async function claimNextWithdrawal(): Promise<TokenWithdrawalRecord | null> {
  return runTransaction(async (client) => {
    return tokenWithdrawalsRepo.claimNextApprovedWithdrawal(client);
  });
}

async function recoverStuckSending(nowMs: number): Promise<number> {
  const cutoff = new Date(
    nowMs - Math.max(60_000, WITHDRAWAL_SENDING_TIMEOUT_MS)
  ).toISOString();
  const stuck = await tokenWithdrawalsRepo.getStuckSendingWithdrawals(
    cutoff,
    MAX_WITHDRAWALS_PER_RUN
  );
  let recovered = 0;
  for (const withdrawal of stuck) {
    await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
      id: withdrawal.id,
      status: 'withdrawal_approved',
      failureReason: 'sending_timeout_retry',
    });
    recovered += 1;
  }
  if (recovered > 0) {
    logger.warn(
      {
        msg: 'withdrawal_sending_recovered',
        count: recovered,
      },
      'withdrawal_sending_recovered'
    );
  }
  return recovered;
}

async function processSingleWithdrawal(): Promise<ProcessResult> {
  const withdrawal = await claimNextWithdrawal();
  if (!withdrawal) {
    return { state: 'empty' } as ProcessResultEmpty;
  }

  if (withdrawal.amountBaseUnits <= 0n) {
    await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
      id: withdrawal.id,
      status: 'withdrawal_failed',
      failureReason: 'invalid_amount',
    });
    return {
      state: 'failure',
      withdrawalId: withdrawal.id,
      reason: 'invalid_amount',
    } as ProcessResultFailure;
  }

  const player = await playersRepo.getPlayerById(withdrawal.playerId);
  const walletAddress = player?.walletAddress ?? null;
  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
      id: withdrawal.id,
      status: 'withdrawal_failed',
      failureReason: 'missing_player_wallet',
    });
    return {
      state: 'failure',
      withdrawalId: withdrawal.id,
      reason: 'missing_player_wallet',
    } as ProcessResultFailure;
  }

  const tokenConfig = getWithdrawalTokenConfig(withdrawal.currency);
  const resolvedChainId = withdrawal.chainId ?? tokenConfig.defaultChainId;
  const resolvedTokenAddress =
    withdrawal.tokenContractAddress ?? tokenConfig.tokenAddress;

  try {
    const tx = await createWithdrawalTransaction({
      to: walletAddress,
      amount: withdrawal.amountBaseUnits,
      tokenAddress: resolvedTokenAddress,
      chainId: resolvedChainId,
    });

    await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
      id: withdrawal.id,
      status: 'withdrawal_pending',
      txHash: tx.txHash,
      chainId: tx.chainId ?? resolvedChainId,
      tokenContractAddress: tx.tokenAddress ?? resolvedTokenAddress,
    });

    return {
      state: 'success',
      withdrawalId: withdrawal.id,
      txHash: tx.txHash,
      chainId: tx.chainId ?? resolvedChainId,
    } as ProcessResultSuccess;
  } catch (error) {
    logger.error(
      {
        msg: 'withdrawal_tx_broadcast_failed',
        withdrawalId: withdrawal.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'withdrawal_tx_broadcast_failed'
    );
    await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
      id: withdrawal.id,
      status: 'withdrawal_failed',
      failureReason: 'tx_broadcast_error',
    });
    emitServerLog('withdrawal.tx_failed', {
      withdrawalId: withdrawal.id,
      reason: 'tx_broadcast_error',
    });
    return {
      state: 'failure',
      withdrawalId: withdrawal.id,
      reason: 'tx_broadcast_error',
    } as ProcessResultFailure;
  }
}

export async function processApprovedWithdrawals(
  maxPerRun = MAX_WITHDRAWALS_PER_RUN
): Promise<ProcessStats> {
  if (processorRunning) {
    return {
      attempted: 0,
      processed: 0,
      failures: 0,
      reason: 'already_running',
    };
  }

  processorRunning = true;
  try {
    const settings = await withdrawalSettingsRepo
      .getSettings()
      .catch((error) => {
        logger.error(
          {
            msg: 'withdrawal_settings_fetch_failed',
            error: error instanceof Error ? error.message : String(error),
          },
          'withdrawal_settings_fetch_failed'
        );
        return null;
      });

    if (!settings?.isAutoProcessingEnabled) {
      return {
        attempted: 0,
        processed: 0,
        failures: 0,
        reason: 'disabled',
      };
    }

    if (settings?.isBatchProcessingPaused) {
      return {
        attempted: 0,
        processed: 0,
        failures: 0,
        reason: 'paused',
      };
    }

    await recoverStuckSending(Date.now());

    const softLimit = Math.max(1, Math.min(MAX_WITHDRAWALS_PER_RUN, maxPerRun));
    let processed = 0;
    let failures = 0;
    let attempted = 0;

    while (processed < softLimit) {
      const result = await processSingleWithdrawal();
      if (result.state === 'empty') {
        break;
      }
      attempted += 1;
      if (result.state === 'success') {
        processed += 1;
      } else {
        failures += 1;
      }
    }

    if (attempted > 0) {
      logger.info(
        {
          msg: 'withdrawal_batch_run',
          processed,
          failures,
          attempted,
        },
        'withdrawal_batch_run'
      );
    }

    return { attempted, processed, failures };
  } finally {
    processorRunning = false;
  }
}

export function startWithdrawalBatchProcessor(): void {
  if (processorTimer) {
    return;
  }
  void processApprovedWithdrawals();
  processorTimer = setInterval(() => {
    void processApprovedWithdrawals();
  }, WITHDRAWAL_PROCESS_INTERVAL_MS);
}

export function stopWithdrawalBatchProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
  processorRunning = false;
}
