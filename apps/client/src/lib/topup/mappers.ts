import type {
  DepositApiRecord,
  TokenSymbol,
  TopupRecord,
  TopupStatus,
} from '../../types/topup';

function normalizeTokenSymbol(value: string): TokenSymbol {
  const upper = value?.toUpperCase();
  return upper === 'GHO' ? 'GHO' : 'USDC';
}

function safeParseNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveCredits(
  deposit: DepositApiRecord,
  fallbackAmount: number
): number {
  const minted = safeParseNumber(deposit.pointsMinted);
  if (minted > 0) {
    return minted;
  }

  return fallbackAmount;
}

export function mapDepositToTopupRecord(
  deposit: DepositApiRecord
): TopupRecord {
  const token = normalizeTokenSymbol(deposit.tokenSymbol);
  const amount = safeParseNumber(deposit.amount);
  const credits = deriveCredits(deposit, amount);

  return {
    id: deposit.id,
    token,
    amount,
    amountWei: deposit.amountWei,
    credits,
    createdAt: deposit.createdAt,
    unlockAt: deposit.unlockAt,
    autoRenew: Boolean(deposit.autoRenew),
    status: (deposit.txStatus as TopupStatus) ?? 'pending',
    txHash: deposit.txHash,
    chainId: deposit.chainId ?? undefined,
    depositId: deposit.depositId ?? undefined,
    pointsMinted: safeParseNumber(deposit.pointsMinted),
    yieldAmount: safeParseNumber(deposit.yieldAmount),
    withdrawn: deposit.withdrawn,
    withdrawalTx: deposit.withdrawalTx ?? undefined,
  };
}
