'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from '../../../components/ui/Button';
import { getAppServerBaseUrl } from '../../../lib/server-url';
import { useEnsNames } from '../../../hooks/useEnsNames';

interface AdminDepositRecord {
  id: string;
  playerId: string | null;
  playerWalletAddress: string | null;
  playerUsername?: string | null;
  tokenSymbol: string;
  amount: string; // decimal string (human units)
  amountWei: string;
  status: string; // pending | confirmed | credited | failed
  chainId: number | null;
  txHash: string | null;
  unlockAt: string | null;
  autoRenew: boolean;
  pointsMinted?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface AdminTopupsClientProps {
  initialTopUps: AdminDepositRecord[];
  initialStatus: string;
  initialCurrency: string;
  initialError: string | null;
}

// Default to deposit statuses (confirmed/credited). If needed, extend to support ledger statuses.
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'credited', label: 'Credited' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
];

const STATUS_STYLES: Record<string, string> = {
  credited: 'bg-emerald-500/20 text-emerald-200',
  confirmed: 'bg-blue-500/20 text-blue-200',
  pending: 'bg-yellow-500/20 text-yellow-200',
  failed: 'bg-red-500/20 text-red-200',
};

function formatAmountDecimal(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function shortenAddress(address: string | null | undefined): string {
  if (!address) return '—';
  const start = address.slice(0, 6);
  const end = address.slice(-4);
  return `${start}…${end}`;
}

function getExplorerUrl(
  chainId: number | null,
  txHash: string | null
): string | null {
  if (!txHash) return null;
  const numericChainId = chainId ?? null;
  if (numericChainId === 8453) {
    return `https://basescan.org/tx/${txHash}`;
  }
  return null;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return null;
  const ms = target - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function AdminTopupsClient({
  initialTopUps,
  initialStatus,
  initialCurrency,
  initialError,
}: AdminTopupsClientProps) {
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus || 'credited'
  );
  const [topUps, setTopUps] = useState<AdminDepositRecord[]>(initialTopUps);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const hasData = topUps.length > 0;
  const statusOptions = useMemo(() => STATUS_OPTIONS, []);
  const didInitRef = useRef(false);

  const ensAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const t of topUps) {
      if (t.playerWalletAddress) set.add(t.playerWalletAddress);
    }
    return Array.from(set);
  }, [topUps]);

  const { ensByAddress } = useEnsNames(ensAddresses);

  const fetchTopUps = useCallback(async (status: string) => {
    setLoading(true);
    setError(null);
    try {
      const baseUrl = getAppServerBaseUrl();
      const params = new URLSearchParams({
        status,
        type: 'deposits',
      });
      const res = await fetch(
        `${baseUrl}/api/admin/top-ups?${params.toString()}`,
        {
          credentials: 'include',
        }
      );
      const payload = (await res.json().catch(() => null)) as {
        topUps?: AdminDepositRecord[];
        error?: string;
      } | null;
      if (!res.ok || !payload) {
        const message =
          payload?.error || 'Failed to load top-ups for this status.';
        setError(message);
        setTopUps([]);
        return;
      }
      const list = Array.isArray(payload.topUps) ? payload.topUps : [];
      setTopUps(list);
    } catch {
      setError('Failed to load top-ups. Try refreshing.');
      setTopUps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      if ((initialStatus || 'paid') !== statusFilter) {
        void fetchTopUps(statusFilter);
      }
      return;
    }
    void fetchTopUps(statusFilter);
  }, [statusFilter, fetchTopUps, initialStatus]);

  const handleRefresh = useCallback(() => {
    void fetchTopUps(statusFilter);
  }, [fetchTopUps, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400" htmlFor="status-filter">
            Status
          </label>
          <select
            id="status-filter"
            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/50 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Created</th>
              <th className="px-3 py-2 text-left font-semibold">Player</th>
              <th className="px-3 py-2 text-right font-semibold">Amount</th>
              <th className="px-3 py-2 text-left font-semibold">Token</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Unlock</th>
              <th className="px-3 py-2 text-left font-semibold">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {!hasData ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-6 text-center text-slate-400"
                >
                  {loading ? 'Loading…' : error || 'No top-ups found.'}
                </td>
              </tr>
            ) : (
              topUps.map((t) => {
                const address = t.playerWalletAddress;
                const ens = address
                  ? ensByAddress[address.toLowerCase()]
                  : null;
                const display = ens || shortenAddress(address);
                const username = (t.playerUsername || '').trim();
                const url = getExplorerUrl(t.chainId, t.txHash);
                const unlockInDays = daysUntil(t.unlockAt);
                return (
                  <tr key={t.id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                      {formatDate(t.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-200">
                        {username || display}
                      </div>
                      {username && (
                        <div className="text-xs text-slate-500">{display}</div>
                      )}
                      <div className="text-xs text-slate-500">
                        {t.playerId ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-100">
                      {formatAmountDecimal(t.amount)}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {(t.tokenSymbol || '').toUpperCase()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={clsx(
                          'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
                          STATUS_STYLES[t.status] ||
                            'bg-slate-700/30 text-slate-200'
                        )}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {t.unlockAt ? (
                        <div className="flex flex-col">
                          <span>{formatDate(t.unlockAt)}</span>
                          {typeof unlockInDays === 'number' && (
                            <span className="text-xs text-slate-500">
                              {unlockInDays > 0
                                ? `in ${unlockInDays}d`
                                : unlockInDays === 0
                                  ? 'today'
                                  : `${Math.abs(unlockInDays)}d ago`}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {t.txHash ? (
                        url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-300 hover:underline"
                          >
                            {t.txHash.slice(0, 10)}…
                          </a>
                        ) : (
                          <span className="text-slate-300">
                            {t.txHash.slice(0, 10)}…
                          </span>
                        )
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
