'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryState } from 'nuqs';
import { Button } from '../../../components/ui/Button';
import { getAppServerBaseUrl } from '../../../lib/server-url';
import { useSession } from '../../../components/providers/SessionProvider';
import { useEnsNames } from '../../../hooks/useEnsNames';

interface AllowlistEntry {
  walletAddress: string;
  note: string | null;
  addedByAddress: string;
  createdAt: string;
  updatedAt: string;
}

const WALLET_REGEX = /^0x[a-f0-9]{40}$/;

function formatRelativeTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '—';
  const now = Date.now();
  let deltaSec = Math.floor((now - timestamp) / 1000);
  if (deltaSec < 0) deltaSec = 0;
  if (deltaSec < 60) return 'just now';
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hr' : 'hrs'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function normalizeBatchInput(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function AdminAllowlistPage() {
  const serverBaseUrl = useMemo(() => getAppServerBaseUrl(), []);
  const { hasValidSession, isSessionVerified } = useSession();
  const canManage = hasValidSession && isSessionVerified;

  const [pageLimit, setPageLimit] = useQueryState('limit', {
    history: 'replace',
  });
  const [pageOffset, setPageOffset] = useQueryState('offset', {
    history: 'replace',
  });
  const [searchQuery, setSearchQuery] = useQueryState('query', {
    history: 'replace',
  });

  const [entries, setEntries] = useState<AllowlistEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addressesInput, setAddressesInput] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState(searchQuery || '');

  useEffect(() => {
    setQueryInput(searchQuery || '');
  }, [searchQuery]);

  const currentOffset = Math.max(0, Number(pageOffset) || 0);
  const limitNumber = Math.max(1, Math.min(200, Number(pageLimit) || 25));
  const currentPage = Math.floor(currentOffset / limitNumber) + 1;
  const totalPages = total ? Math.ceil(total / limitNumber) : null;

  const fetchEntries = useCallback(
    async (override?: { offset?: number }) => {
      if (!canManage) return;
      setLoading(true);
      setError(null);
      try {
        const limit = limitNumber;
        const offset =
          typeof override?.offset === 'number'
            ? override.offset
            : currentOffset;
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
        });
        if (searchQuery && searchQuery.trim().length > 0) {
          params.set('query', searchQuery.trim());
        }
        const res = await fetch(
          `${serverBaseUrl}/api/admin/player-allowlist?${params.toString()}`,
          {
            credentials: 'include',
          }
        );
        const payload = (await res.json().catch(() => null)) as
          | {
              entries?: AllowlistEntry[];
              pagination?: { total?: number };
              error?: string;
            }
          | null;
        if (res.status === 401) {
          setError('Unauthorized');
          return;
        }
        if (res.status === 403) {
          setError('Forbidden: wallet not on admin allowlist');
          return;
        }
        if (!res.ok || !payload) {
          setError(payload?.error || 'Failed to load allowlist entries');
          return;
        }
        const list = Array.isArray(payload.entries) ? payload.entries : [];
        setEntries(list);
        const totalValueRaw = payload.pagination?.total;
        const totalNumber = Number(totalValueRaw);
        setTotal(Number.isFinite(totalNumber) ? totalNumber : null);
      } catch (e) {
        setError('Failed to load allowlist entries');
      } finally {
        setLoading(false);
      }
    },
    [
      canManage,
      serverBaseUrl,
      limitNumber,
      currentOffset,
      searchQuery,
    ]
  );

  useEffect(() => {
    fetchEntries().catch(() => {});
  }, [fetchEntries]);

  const handleBulkAdd = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!canManage) return;
      setBulkError(null);
      setBulkMessage(null);
      const parsed = normalizeBatchInput(addressesInput);
      if (parsed.length === 0) {
        setBulkError('Enter at least one wallet address.');
        return;
      }
      const normalized: string[] = [];
      const invalid: string[] = [];
      const seen = new Set<string>();
      for (const entry of parsed) {
        const lowered = entry.toLowerCase();
        if (!WALLET_REGEX.test(lowered)) {
          invalid.push(entry);
          continue;
        }
        if (seen.has(lowered)) continue;
        seen.add(lowered);
        normalized.push(lowered);
      }
      if (invalid.length > 0) {
        setBulkError(
          `Invalid wallet addresses: ${invalid.slice(0, 5).join(', ')}`
        );
        return;
      }
      if (normalized.length === 0) {
        setBulkError('No new wallet addresses to add.');
        return;
      }
      if (normalized.length > 100) {
        setBulkError('Submit at most 100 addresses per request.');
        return;
      }
      setAdding(true);
      try {
        const res = await fetch(
          `${serverBaseUrl}/api/admin/player-allowlist`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ addresses: normalized }),
          }
        );
        const payload = (await res.json().catch(() => null)) as
          | { addedCount?: number; skippedCount?: number; error?: string }
          | null;
        if (res.status === 401) {
          setBulkError('Unauthorized');
          return;
        }
        if (res.status === 403) {
          setBulkError('Forbidden: wallet not on admin allowlist');
          return;
        }
        if (!res.ok || !payload) {
          setBulkError(payload?.error || 'Failed to add allowlist entries');
          return;
        }
        const addedCount = Number(payload.addedCount || 0);
        const skippedCount = Number(payload.skippedCount || 0);
        setBulkMessage(
          `Added ${addedCount} wallet${addedCount === 1 ? '' : 's'} (${skippedCount} skipped).`
        );
        setAddressesInput('');
        setPageOffset('0');
        fetchEntries({ offset: 0 }).catch(() => {});
      } catch (e) {
        setBulkError('Failed to add allowlist entries');
      } finally {
        setAdding(false);
      }
    },
    [
      addressesInput,
      canManage,
      fetchEntries,
      serverBaseUrl,
      setPageOffset,
    ]
  );

  const handleRemove = useCallback(
    async (wallet: string) => {
      if (!canManage) return;
      if (
        typeof window !== 'undefined' &&
        !window.confirm(
          `Remove ${wallet} from the allowlist? Already authorized players remain authorized.`
        )
      ) {
        return;
      }
      setRemoveTarget(wallet);
      try {
        const res = await fetch(
          `${serverBaseUrl}/api/admin/player-allowlist/${encodeURIComponent(wallet)}`,
          {
            method: 'DELETE',
            credentials: 'include',
          }
        );
        if (res.status === 401) {
          setError('Unauthorized');
          return;
        }
        if (res.status === 403) {
          setError('Forbidden: wallet not on admin allowlist');
          return;
        }
        if (!res.ok) {
          const payload = await res
            .json()
            .catch(() => ({ error: 'Failed to remove allowlist entry' }));
          setError(payload.error || 'Failed to remove allowlist entry');
          return;
        }
        fetchEntries().catch(() => {});
      } catch (e) {
        setError('Failed to remove allowlist entry');
      } finally {
        setRemoveTarget(null);
      }
    },
    [canManage, fetchEntries, serverBaseUrl]
  );

  const handleNextPage = useCallback(() => {
    const next = currentOffset + limitNumber;
    const hasMore =
      total == null ? entries.length === limitNumber : next < (total || 0);
    if (!hasMore) return;
    setPageOffset(String(next));
  }, [currentOffset, limitNumber, total, entries.length, setPageOffset]);

  const handlePrevPage = useCallback(() => {
    const prev = Math.max(0, currentOffset - limitNumber);
    if (prev === currentOffset) return;
    setPageOffset(String(prev));
  }, [currentOffset, limitNumber, setPageOffset]);

  const ensAddresses = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      if (entry.walletAddress) set.add(entry.walletAddress);
      if (entry.addedByAddress) set.add(entry.addedByAddress);
    }
    return Array.from(set);
  }, [entries]);
  const { ensByAddress } = useEnsNames(ensAddresses);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 font-mono">
      <header className="border-b border-slate-900 bg-slate-950/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              Player Allowlist
            </h1>
            <p className="text-sm text-slate-400">
              Pre-authorize wallets so first logins auto-authorize.
            </p>
          </div>
          <div className="text-xs text-slate-400 flex gap-4">
            <Link href="/admin" className="hover:text-white">
              Back to Admin
            </Link>
            <Link href="/admin/players" className="hover:text-white">
              Players
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1 p-6">
        {!isSessionVerified ? (
          <div className="text-sm text-slate-400">Verifying session…</div>
        ) : !hasValidSession ? (
          <div className="text-sm text-slate-300">
            Connect wallet to access admin tools.
          </div>
        ) : (
          <div className="space-y-6">
            <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="mb-3">
                <h2 className="text-lg font-semibold">Bulk Add Wallets</h2>
                <p className="text-xs text-slate-400">
                  Paste wallets separated by commas or newlines. Entries are
                  normalized to lowercase.
                </p>
              </div>
              <form onSubmit={handleBulkAdd} className="space-y-3">
                <textarea
                  className="h-32 w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                  placeholder="0xabc..., 0x123..., ..."
                  value={addressesInput}
                  onChange={(e) => setAddressesInput(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={adding}>
                    {adding ? 'Adding…' : 'Add to Allowlist'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAddressesInput('');
                      setBulkError(null);
                      setBulkMessage(null);
                    }}
                  >
                    Clear
                  </Button>
                </div>
                {bulkError ? (
                  <div className="text-sm text-red-400">{bulkError}</div>
                ) : null}
                {bulkMessage ? (
                  <div className="text-sm text-green-400">{bulkMessage}</div>
                ) : null}
              </form>
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-950">
              <div className="flex flex-col gap-3 border-b border-slate-900 p-4 md:flex-row md:items-end md:justify-between">
                <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-end">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-slate-400">
                      Search Wallet
                    </label>
                    <input
                      className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                      placeholder="0x..."
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={() => {
                        setSearchQuery(queryInput.trim() ? queryInput.trim() : null);
                        setPageOffset('0');
                      }}
                    >
                      Search
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setQueryInput('');
                        setSearchQuery(null);
                        setPageOffset('0');
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrevPage}
                      disabled={currentOffset === 0 || loading}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={
                        loading ||
                        (total != null
                          ? currentOffset + limitNumber >= (total || 0)
                          : entries.length < limitNumber)
                      }
                    >
                      Next
                    </Button>
                  </div>
                  <select
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs"
                    value={String(limitNumber)}
                    onChange={(e) =>
                      setPageLimit(
                        String(
                          Math.max(1, Math.min(200, Number(e.target.value) || 25))
                        )
                      )
                    }
                  >
                    {[25, 50, 100, 200].map((n) => (
                      <option key={n} value={n}>
                        {n}/page
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fetchEntries().catch(() => {})}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="p-4">
                <div className="text-sm text-slate-400">
                  Page {currentPage}
                  {totalPages ? ` of ${totalPages}` : ''}
                </div>
                {error ? (
                  <div className="mt-2 text-sm text-red-400">{error}</div>
                ) : null}
                {loading && entries.length === 0 ? (
                  <div className="mt-4 text-sm text-slate-400">
                    Loading allowlist…
                  </div>
                ) : entries.length === 0 ? (
                  <div className="mt-4 text-sm text-slate-400">
                    No allowlist entries found.
                  </div>
                ) : (
                  <div className="mt-4 overflow-auto rounded-md border border-slate-900">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-slate-900/70 text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Wallet</th>
                          <th className="px-3 py-2">Added By</th>
                          <th className="px-3 py-2">Created</th>
                          <th className="px-3 py-2">Updated</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-900">
                        {entries.map((entry) => {
                          const walletEns =
                            entry.walletAddress &&
                            ensByAddress[entry.walletAddress];
                          const addedByEns =
                            entry.addedByAddress &&
                            ensByAddress[entry.addedByAddress];
                          return (
                            <tr key={entry.walletAddress} className="bg-slate-950/40">
                              <td className="px-3 py-2 align-top">
                                <div className="flex flex-col">
                                  <span className="font-mono text-slate-100">
                                    {entry.walletAddress}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {walletEns || shortenAddress(entry.walletAddress)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2 align-top">
                                <div className="flex flex-col">
                                  <span className="font-mono text-slate-100">
                                    {entry.addedByAddress}
                                  </span>
                                  <span className="text-xs text-slate-500">
                                    {addedByEns || shortenAddress(entry.addedByAddress)}
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <time
                                  dateTime={entry.createdAt}
                                  title={entry.createdAt}
                                >
                                  {formatRelativeTime(entry.createdAt)}
                                </time>
                              </td>
                              <td className="px-3 py-2">
                                <time
                                  dateTime={entry.updatedAt}
                                  title={entry.updatedAt}
                                >
                                  {formatRelativeTime(entry.updatedAt)}
                                </time>
                              </td>
                              <td className="px-3 py-2">
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleRemove(entry.walletAddress)}
                                  disabled={
                                    removeTarget === entry.walletAddress || loading
                                  }
                                >
                                  {removeTarget === entry.walletAddress
                                    ? 'Removing…'
                                    : 'Remove'}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-slate-500">
                      Showing {currentOffset + 1}-
                      {currentOffset + entries.length}
                      {total ? ` of ${total}` : ''}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
