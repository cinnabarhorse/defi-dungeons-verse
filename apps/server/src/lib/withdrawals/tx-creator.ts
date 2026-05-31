import { ethers } from 'ethers';
import { BASE_CHAIN_ID } from '../topup/config';
import { DEFAULT_USDC_ADDRESS } from './token-config';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
] as const;

export interface CreateWithdrawalTransactionInput {
  to: string;
  amount: bigint;
  tokenAddress?: string;
  chainId?: number;
}

export interface CreateWithdrawalTransactionResult {
  txHash: string;
  chainId: number;
  tokenAddress: string;
}

function readKey(obj: unknown, key: string): unknown {
  if (
    obj &&
    typeof obj === 'object' &&
    key in (obj as Record<string, unknown>)
  ) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

function extractTxHash(payload: unknown): string | null {
  const direct = readKey(payload, 'transactionHash');
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  const result = readKey(payload, 'result');
  const resultTx = readKey(result, 'transactionHash');
  if (typeof resultTx === 'string' && resultTx.length > 0) {
    return resultTx;
  }
  const resultReceipts = readKey(result, 'receipts');
  if (Array.isArray(resultReceipts) && resultReceipts.length > 0) {
    const firstReceiptTx = readKey(resultReceipts[0], 'transactionHash');
    if (typeof firstReceiptTx === 'string' && firstReceiptTx.length > 0) {
      return firstReceiptTx;
    }
  }
  const receipts = readKey(payload, 'receipts');
  if (Array.isArray(receipts) && receipts.length > 0) {
    const firstReceiptTx = readKey(receipts[0], 'transactionHash');
    if (typeof firstReceiptTx === 'string' && firstReceiptTx.length > 0) {
      return firstReceiptTx;
    }
  }
  return null;
}

function hasTransactionsApiConfig(): boolean {
  return Boolean(
    process.env.THIRDWEB_SECRET_KEY && process.env.THIRDWEB_SERVER_WALLET
  );
}

async function createViaThirdwebTransactionsApi(
  input: CreateWithdrawalTransactionInput
): Promise<CreateWithdrawalTransactionResult> {
  const secretKey = String(process.env.THIRDWEB_SECRET_KEY);
  const fromAddress = String(process.env.THIRDWEB_SERVER_WALLET);
  const chainId = input.chainId ?? BASE_CHAIN_ID;
  const tokenAddress = input.tokenAddress ?? DEFAULT_USDC_ADDRESS;

  // Encode ERC20 transfer(to, amount) calldata
  const iface = new ethers.Interface(ERC20_ABI);
  const data = iface.encodeFunctionData('transfer', [input.to, input.amount]);

  const baseUrl =
    process.env.THIRDWEB_TRANSACTIONS_URL?.replace(/\/$/, '') ||
    'https://api.thirdweb.com/v1/transactions';

  const res = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-secret-key': secretKey,
    },
    body: JSON.stringify({
      chainId,
      fromAddress,
      transactions: [
        {
          to: tokenAddress,
          data,
          value: '0',
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => 'Thirdweb API request failed');
    throw new Error(text);
  }

  const payload: unknown = await res.json().catch(() => null);
  let txHash: string | null = extractTxHash(payload);

  // If API returns queued transactionIds, poll for receipt to obtain hash
  if (!txHash) {
    const result = readKey(payload, 'result');
    const resultIds = readKey(result, 'transactionIds');
    const rootIds = readKey(payload, 'transactionIds');
    const ids: string[] = Array.isArray(resultIds)
      ? (resultIds as unknown[]).filter(
          (v): v is string => typeof v === 'string'
        )
      : Array.isArray(rootIds)
        ? (rootIds as unknown[]).filter(
            (v): v is string => typeof v === 'string'
          )
        : [];

    const firstId = Array.isArray(ids) && ids.length > 0 ? ids[0] : null;

    if (firstId) {
      const startedAt = Date.now();
      const timeoutMs = 30_000; // 30s
      const intervalMs = 1_000; // 1s
      while (Date.now() - startedAt < timeoutMs) {
        const statusRes = await fetch(`${baseUrl}/${firstId}`, {
          method: 'GET',
          headers: { 'x-secret-key': secretKey },
        });
        if (statusRes.ok) {
          const statusPayload: unknown = await statusRes
            .json()
            .catch(() => null);
          txHash = extractTxHash(statusPayload);
          if (typeof txHash === 'string' && txHash.length > 0) {
            break;
          }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  if (!txHash || typeof txHash !== 'string') {
    throw new Error(
      `Thirdweb API did not return a transactionHash: ${JSON.stringify(
        payload
      )}`
    );
  }

  return { txHash, chainId, tokenAddress };
}

export async function createWithdrawalTransaction(
  input: CreateWithdrawalTransactionInput
): Promise<CreateWithdrawalTransactionResult> {
  if (input.amount <= 0n) {
    throw new Error('Withdrawal amount must be greater than zero');
  }
  if (!ethers.isAddress(input.to)) {
    throw new Error('Invalid recipient wallet address');
  }

  if (!hasTransactionsApiConfig()) {
    throw new Error(
      'Thirdweb Transactions API is not configured (set THIRDWEB_SECRET_KEY and THIRDWEB_SERVER_WALLET)'
    );
  }

  return await createViaThirdwebTransactionsApi(input);
}

export { DEFAULT_USDC_ADDRESS as USDC_CONTRACT_ADDRESS };
