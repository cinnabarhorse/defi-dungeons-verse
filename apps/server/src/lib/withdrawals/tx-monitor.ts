import { ethers } from 'ethers';
import { BASE_CHAIN_ID } from '../topup/config';
import {
  tokenWithdrawalsRepo,
  playersRepo,
  withdrawalSettingsRepo,
  type TokenWithdrawalRecord,
} from '../db';
import { getBaseLogger, emitServerLog } from '../logging';
import {
  getPendingTimeoutMs,
  WITHDRAWAL_CONFIRMATION_INTERVAL_MS,
} from './config';

const DEFAULT_BASE_RPC_URL =
  process.env.BASE_RPC_URL || 'https://mainnet.base.org';

const DISCORD_WEBHOOK_URL =
  process.env.DISCORD_WITHDRAWALS_WEBHOOK_URL ||
  'https://discord.com/api/webhooks/1436343527146786878/aZk5mnB8NPM4vDpMtDBN3nuL3VlWzvG0F7jzEqRCRc--irTaKKg2x1R-EP1ZCI9pO5v-';

const providerCache = new Map<number, ethers.JsonRpcProvider>();
const logger = getBaseLogger().child({ module: 'withdrawal_tx_monitor' });

function getProviderForChain(chainId: number): ethers.JsonRpcProvider {
  const normalized = Math.trunc(chainId);
  if (normalized !== BASE_CHAIN_ID) {
    // For now we only support Base; extend if multi-chain is needed.
    throw new Error(`Unsupported chain id for monitor: ${normalized}`);
  }
  let provider = providerCache.get(normalized);
  if (!provider) {
    provider = new ethers.JsonRpcProvider(DEFAULT_BASE_RPC_URL);
    providerCache.set(normalized, provider);
  }
  return provider;
}

async function sendDiscordSuccess(
  withdrawal: TokenWithdrawalRecord,
  toWallet: string,
  txHash: string
): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;
  const currency = withdrawal.currency || 'USDC';
  // Prefer stored decimal amount; fallback to base units conversion
  let amountDisplay =
    typeof withdrawal.amount === 'string' && withdrawal.amount.trim().length > 0
      ? withdrawal.amount
      : null;
  if (!amountDisplay) {
    const decimals = currency.toUpperCase() === 'USDC' ? 6 : 18;
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = withdrawal.amountBaseUnits / divisor;
    const frac = withdrawal.amountBaseUnits % divisor;
    if (frac === 0n) {
      amountDisplay = whole.toString();
    } else {
      const fracStr = frac
        .toString()
        .padStart(decimals, '0')
        .replace(/0+$/, '');
      amountDisplay = `${whole.toString()}.${fracStr}`;
    }
  }
  const content = `**🎉New Withdrawal processed!**\n\n${amountDisplay} ${currency} was sent to ${toWallet}.\n\ntxid: ${txHash}`;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch {
    // Swallow notification errors; do not impact status update
  }
}

function hasTimedOut(
  withdrawal: TokenWithdrawalRecord,
  nowMs: number
): boolean {
  const pendingAt = withdrawal.withdrawalPendingAt;
  if (!pendingAt) return false;
  const timestamp = Date.parse(pendingAt);
  if (Number.isNaN(timestamp)) return false;
  const timeoutMs = getPendingTimeoutMs(withdrawal.chainId);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return false;
  }
  return nowMs - timestamp >= timeoutMs;
}

export async function checkPendingWithdrawals(): Promise<void> {
  const settings = await withdrawalSettingsRepo.getSettings().catch((error) => {
    logger.error(
      {
        msg: 'withdrawal_settings_fetch_failed',
        error: error instanceof Error ? error.message : String(error),
      },
      'withdrawal_settings_fetch_failed'
    );
    return null;
  });

  if (settings?.isConfirmationPaused) {
    return;
  }

  const pending =
    await tokenWithdrawalsRepo.getTokenWithdrawalsByStatus(
      'withdrawal_pending'
    );

  const nowMs = Date.now();

  for (const withdrawal of pending) {
    const txHash = withdrawal.txHash;
    if (!txHash) {
      if (hasTimedOut(withdrawal, nowMs)) {
        await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
          id: withdrawal.id,
          status: 'withdrawal_failed',
          failureReason: 'pending_timeout_24h',
        });
        emitServerLog('withdrawal.pending_timeout', {
          details: {
            withdrawalId: withdrawal.id,
            reason: 'missing_tx_hash',
          },
        });
      }
      continue;
    }

    const chainId = withdrawal.chainId ?? BASE_CHAIN_ID;
    let receipt: ethers.TransactionReceipt | null = null;
    try {
      const provider = getProviderForChain(chainId);
      receipt = await provider.getTransactionReceipt(txHash);
    } catch {
      // Provider error - skip this iteration
      continue;
    }

    if (!receipt) {
      if (hasTimedOut(withdrawal, nowMs)) {
        await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
          id: withdrawal.id,
          status: 'withdrawal_failed',
          txHash,
          failureReason: 'pending_timeout_24h',
        });
        emitServerLog('withdrawal.pending_timeout', {
          details: {
            withdrawalId: withdrawal.id,
            txHash,
            reason: 'pending_timeout_24h',
          },
        });
      }
      continue;
    }

    if (receipt.status === 1) {
      // Confirmed success
      const updated = await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
        id: withdrawal.id,
        status: 'withdrawal_confirmed',
        txHash,
      });
      if (updated) {
        try {
          const player = await playersRepo.getPlayerById(updated.playerId);
          const wallet = player?.walletAddress ?? 'unknown';
          await sendDiscordSuccess(updated, wallet, txHash);
        } catch {
          // Ignore notification errors
        }
      }
    } else {
      // Failed / reverted
      await tokenWithdrawalsRepo.updateTokenWithdrawalStatus({
        id: withdrawal.id,
        status: 'withdrawal_failed',
        txHash,
        failureReason: 'Transaction reverted',
      });
      emitServerLog('withdrawal.tx_failed', {
        details: {
          withdrawalId: withdrawal.id,
          reason: 'Transaction reverted',
        },
      });
    }
  }
}

let monitorStarted = false;
let monitorTimer: ReturnType<typeof setInterval> | null = null;

export function startWithdrawalTxMonitor(
  intervalMs = WITHDRAWAL_CONFIRMATION_INTERVAL_MS
): void {
  if (monitorStarted) return;
  monitorStarted = true;
  monitorTimer = setInterval(() => {
    void checkPendingWithdrawals();
  }, intervalMs);
}

export function stopWithdrawalTxMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    monitorStarted = false;
  }
}
