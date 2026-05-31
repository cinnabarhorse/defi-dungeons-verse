import { gql, request } from 'graphql-request';
import type { DepositRecord } from '../db/types';
import { depositsRepo } from '../db';

interface SubgraphWithdrawal {
  id: string;
  txHash: string; // withdrawal tx hash
  deposit: {
    txHash: string; // original deposit tx hash
  };
}

const DEFAULT_DEPOSITS_SUBGRAPH_ENDPOINT =
  'https://api.goldsky.com/api/public/project_cmh3flagm0001r4p25foufjtt/subgraphs/dd-deposits-subgraph/prod/gn';

function getDepositsSubgraphEndpoint(): string | null {
  const fromEnv =
    process.env.SUBGRAPH_DEPOSITS ?? process.env.SUBGRAPH_DEPOSITS_BASE ?? '';
  const trimmedEnv = fromEnv.trim();
  if (trimmedEnv.length > 0) {
    return trimmedEnv;
  }

  const fallback = DEFAULT_DEPOSITS_SUBGRAPH_ENDPOINT.trim();
  if (!fallback) {
    return null;
  }

  return fallback;
}

async function fetchSubgraphWithdrawalsByDepositTxHashes(
  depositTxHashes: string[]
): Promise<SubgraphWithdrawal[]> {
  const endpoint = getDepositsSubgraphEndpoint();
  if (!endpoint) return [];

  const hashes = Array.from(
    new Set(
      depositTxHashes
        .map((h) => h?.trim().toLowerCase())
        .filter((h): h is string => Boolean(h) && /^0x[0-9a-f]{64}$/.test(h))
    )
  );

  if (hashes.length === 0) return [];

  const query = gql`
    query WithdrawalsByDepositTx($hashes: [Bytes!]!) {
      withdrawals(where: { deposit_: { txHash_in: $hashes } }) {
        id
        txHash
        deposit {
          txHash
        }
      }
    }
  `;

  try {
    const result = await request<{ withdrawals: SubgraphWithdrawal[] }>(
      endpoint,
      query,
      {
        hashes,
      }
    );

    return result.withdrawals ?? [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'deposits_subgraph_withdrawals_fetch_error',
        endpoint,
        error:
          error instanceof Error ? error.message : 'Unknown subgraph error',
      })
    );
    return [];
  }
}

export async function syncWithdrawnDepositsFromSubgraph(
  deposits: DepositRecord[]
): Promise<string[]> {
  if (!deposits.length) return [];

  const txHashes = deposits
    .map((d) => d.txHash)
    .filter((h): h is string => Boolean(h));

  if (!txHashes.length) return [];

  const subgraphWithdrawals =
    await fetchSubgraphWithdrawalsByDepositTxHashes(txHashes);

  if (!subgraphWithdrawals.length) return [];

  // Map depositTxHash -> withdrawalTxHash
  const byDepositTx = new Map<string, string>();
  for (const w of subgraphWithdrawals) {
    const depositTx = w.deposit?.txHash?.toLowerCase();
    const withdrawalTx = w.txHash?.toLowerCase();
    if (!depositTx || !withdrawalTx) continue;
    byDepositTx.set(depositTx, withdrawalTx);
  }

  const updatedIds: string[] = [];

  for (const deposit of deposits) {
    if (!deposit.txHash) continue;
    const key = deposit.txHash.toLowerCase();
    const withdrawalTx = byDepositTx.get(key);
    if (!withdrawalTx) continue;
    if (deposit.withdrawn && deposit.withdrawalTx) continue;

    try {
      await depositsRepo.updateDeposit({
        id: deposit.id,
        withdrawn: true,
        withdrawalTx,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'sync_withdrawn_update_failed',
          id: deposit.id,
          txHash: deposit.txHash,
          error:
            error instanceof Error ? error.message : 'Unknown update error',
        })
      );
      continue;
    }

    updatedIds.push(deposit.id);
  }

  return updatedIds;
}
