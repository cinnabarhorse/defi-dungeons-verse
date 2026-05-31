'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { getAppServerBaseUrl } from '../../../lib/server-url';
import { useSession } from '../../../components/providers/SessionProvider';
import { Button } from '../../../components/ui/Button';

interface PotionCounts {
  healthPotions: number;
  manaPotions: number;
  playerUsername: string | null;
  playerWalletAddress: string | null;
}

function shortenAddress(address: string | null | undefined): string {
  if (!address) return '—';
  const start = address.slice(0, 6);
  const end = address.slice(-4);
  return `${start}…${end}`;
}

export default function AdminPotionsPage() {
  const serverBaseUrl = useMemo(() => getAppServerBaseUrl(), []);
  const { hasValidSession, isSessionVerified } = useSession();

  const [playerId, setPlayerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [potionCounts, setPotionCounts] = useState<PotionCounts | null>(null);

  const [healthPotionsToCredit, setHealthPotionsToCredit] = useState(0);
  const [manaPotionsToCredit, setManaPotionsToCredit] = useState(0);
  const [crediting, setCrediting] = useState(false);

  const canSearch = isSessionVerified && hasValidSession;

  const fetchPotionCounts = useCallback(async () => {
    if (!canSearch) return;
    if (!playerId.trim()) {
      setError('Enter a player ID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setPotionCounts(null);

    try {
      const res = await fetch(
        `${serverBaseUrl}/api/admin/players/${encodeURIComponent(playerId.trim())}/potions`,
        { credentials: 'include' }
      );

      if (res.status === 401) {
        setError('Unauthorized');
        return;
      }
      if (res.status === 403) {
        setError('Forbidden: wallet not on admin allowlist');
        return;
      }
      if (res.status === 404) {
        setError('Player not found');
        return;
      }
      if (!res.ok) {
        const payload = await res
          .json()
          .catch(() => ({ error: 'Failed to load potions' }));
        setError(payload.error || 'Failed to load potions');
        return;
      }

      const payload = await res.json();
      setPotionCounts({
        healthPotions: payload.healthPotions ?? 0,
        manaPotions: payload.manaPotions ?? 0,
        playerUsername: payload.playerUsername ?? null,
        playerWalletAddress: payload.playerWalletAddress ?? null,
      });
    } catch {
      setError('Failed to load potions');
    } finally {
      setLoading(false);
    }
  }, [canSearch, playerId, serverBaseUrl]);

  const handleCreditPotions = useCallback(async () => {
    if (!canSearch) return;
    if (!playerId.trim()) {
      setError('Enter a player ID first');
      return;
    }
    if (healthPotionsToCredit === 0 && manaPotionsToCredit === 0) {
      setError('Select at least one potion type to credit');
      return;
    }

    setCrediting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(
        `${serverBaseUrl}/api/admin/players/${encodeURIComponent(playerId.trim())}/potions/credit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            healthPotions: healthPotionsToCredit,
            manaPotions: manaPotionsToCredit,
          }),
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
      if (res.status === 404) {
        setError('Player not found');
        return;
      }
      if (!res.ok) {
        const payload = await res
          .json()
          .catch(() => ({ error: 'Failed to credit potions' }));
        setError(payload.error || 'Failed to credit potions');
        return;
      }

      const payload = await res.json();

      setPotionCounts((prev) => ({
        ...prev,
        healthPotions:
          payload.totals?.healthPotions ?? prev?.healthPotions ?? 0,
        manaPotions: payload.totals?.manaPotions ?? prev?.manaPotions ?? 0,
        playerUsername: prev?.playerUsername ?? null,
        playerWalletAddress: prev?.playerWalletAddress ?? null,
      }));

      const parts: string[] = [];
      if (payload.credited?.healthPotions > 0) {
        parts.push(
          `${payload.credited.healthPotions} Health Potion${payload.credited.healthPotions > 1 ? 's' : ''}`
        );
      }
      if (payload.credited?.manaPotions > 0) {
        parts.push(
          `${payload.credited.manaPotions} Mana Potion${payload.credited.manaPotions > 1 ? 's' : ''}`
        );
      }
      setSuccess(`Credited ${parts.join(' and ')} successfully!`);
      setHealthPotionsToCredit(0);
      setManaPotionsToCredit(0);
    } catch {
      setError('Failed to credit potions');
    } finally {
      setCrediting(false);
    }
  }, [
    canSearch,
    playerId,
    healthPotionsToCredit,
    manaPotionsToCredit,
    serverBaseUrl,
  ]);

  const handleClear = useCallback(() => {
    setPlayerId('');
    setPotionCounts(null);
    setError(null);
    setSuccess(null);
    setHealthPotionsToCredit(0);
    setManaPotionsToCredit(0);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 font-mono">
      <header className="border-b border-slate-900 bg-slate-950/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">
              Potion Credit Tool
            </h1>
            <p className="text-sm text-slate-400">
              Credit HP and Mana potions to players.
            </p>
          </div>
          <div className="text-xs text-slate-400">
            <Link href="/admin" className="hover:text-white">
              Back to Admin
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
          <div className="space-y-6 max-w-2xl">
            {/* Player Lookup */}
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <div className="text-sm font-medium text-slate-300 mb-3">
                Player Lookup
              </div>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-400">
                    Player ID
                  </label>
                  <input
                    className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                    placeholder="Enter player UUID"
                    value={playerId}
                    onChange={(e) => setPlayerId(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') fetchPotionCounts();
                    }}
                  />
                </div>
                <Button onClick={fetchPotionCounts} disabled={loading}>
                  {loading ? 'Loading…' : 'Lookup'}
                </Button>
                <Button variant="outline" onClick={handleClear}>
                  Clear
                </Button>
              </div>

              {error && (
                <div className="mt-3 text-sm text-red-400">{error}</div>
              )}
              {success && (
                <div className="mt-3 text-sm text-emerald-400">{success}</div>
              )}
            </div>

            {/* Player Info & Current Potions */}
            {potionCounts && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="text-sm font-medium text-slate-300 mb-3">
                  Player Info
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="rounded-md border border-slate-900 bg-slate-900/40 p-3">
                    <div className="text-xs text-slate-400 mb-1">Username</div>
                    <div className="text-slate-200">
                      {potionCounts.playerUsername || '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-900 bg-slate-900/40 p-3">
                    <div className="text-xs text-slate-400 mb-1">Wallet</div>
                    <div
                      className="text-slate-200"
                      title={potionCounts.playerWalletAddress || ''}
                    >
                      {shortenAddress(potionCounts.playerWalletAddress)}
                    </div>
                  </div>
                </div>

                <div className="text-sm font-medium text-slate-300 mb-3">
                  Current Potion Counts
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 p-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <img
                        src="/icons/potions/health-potion.svg"
                        alt="Health Potion"
                        className="w-6 h-6"
                      />
                      <span className="text-xs uppercase tracking-wide text-emerald-400">
                        Health Potions
                      </span>
                    </div>
                    <div className="text-3xl font-bold text-emerald-300">
                      {potionCounts.healthPotions}
                    </div>
                  </div>
                  <div className="rounded-md border border-blue-900/50 bg-blue-950/20 p-4 text-center">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <img
                        src="/icons/potions/mana-potion.svg"
                        alt="Mana Potion"
                        className="w-6 h-6"
                      />
                      <span className="text-xs uppercase tracking-wide text-blue-400">
                        Mana Potions
                      </span>
                    </div>
                    <div className="text-3xl font-bold text-blue-300">
                      {potionCounts.manaPotions}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Credit Potions */}
            {potionCounts && (
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                <div className="text-sm font-medium text-slate-300 mb-3">
                  Credit Potions
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      Health Potions to Credit
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                      value={healthPotionsToCredit}
                      onChange={(e) =>
                        setHealthPotionsToCredit(
                          Math.max(
                            0,
                            Math.min(1000, parseInt(e.target.value, 10) || 0)
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      Mana Potions to Credit
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
                      value={manaPotionsToCredit}
                      onChange={(e) =>
                        setManaPotionsToCredit(
                          Math.max(
                            0,
                            Math.min(1000, parseInt(e.target.value, 10) || 0)
                          )
                        )
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleCreditPotions}
                    disabled={
                      crediting ||
                      (healthPotionsToCredit === 0 && manaPotionsToCredit === 0)
                    }
                  >
                    {crediting ? 'Crediting…' : 'Credit Potions'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setHealthPotionsToCredit(0);
                      setManaPotionsToCredit(0);
                    }}
                  >
                    Reset
                  </Button>
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Max 1000 potions per type per transaction.
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
