'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAppServerBaseUrl } from '../../../lib/server-url';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../../components/ui/Accordion';

interface MatchesPerDayPoint {
  day: string; // YYYY-MM-DD
  count: number;
}

interface ApiResponse {
  series: MatchesPerDayPoint[];
  from: string | null;
  to: string | null;
}

interface TokenAllocationsPerDayPoint {
  day: string; // YYYY-MM-DD
  usdc: number;
  ghst: number;
}

interface TokensApiResponse {
  series: TokenAllocationsPerDayPoint[];
  from: string | null;
  to: string | null;
}

interface TokenAllocationsPerDayPointRaw {
  day: string;
  usdc: number | string;
  ghst: number | string;
}

interface TokensApiResponseRaw {
  series: TokenAllocationsPerDayPointRaw[];
  from: string | null;
  to: string | null;
}

type ActiveUsersPoint = {
  day: string;
  dau: number;
  mau: number;
};

type ActiveUsersApiResponse = {
  series: ActiveUsersPoint[];
  from: string | null;
  to: string | null;
};

interface ActiveUsersPointRaw {
  day: string;
  dau: number | string;
  mau: number | string;
}

interface ActiveUsersApiResponseRaw {
  series: ActiveUsersPointRaw[];
  from: string | null;
  to: string | null;
}

interface TopUpsPerDayPoint {
  day: string; // YYYY-MM-DD
  credits: number;
  count: number;
}

interface TopUpsApiResponseRaw {
  series: {
    day: string;
    credits: number | string;
    count: number | string;
  }[];
  from: string | null;
  to: string | null;
}

export function AdminStatsClient() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<MatchesPerDayPoint[]>([]);
  const [fromIso, setFromIso] = useState<string | null>(null);
  const [toIso, setToIso] = useState<string | null>(null);
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [tokenSeries, setTokenSeries] = useState<TokensApiResponse['series']>(
    []
  );
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUsersPoint[]>([]);
  const [activeLoading, setActiveLoading] = useState(true);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [topups, setTopups] = useState<TopUpsPerDayPoint[]>([]);
  const [topupsLoading, setTopupsLoading] = useState(true);
  const [topupsError, setTopupsError] = useState<string | null>(null);

  function computeFromTo(selectedRange: '7' | '30' | '90') {
    const now = new Date();
    const to = now.toISOString();
    const from = new Date(
      now.getTime() - Number(selectedRange) * 24 * 60 * 60 * 1000
    ).toISOString();
    return { from, to };
  }

  useEffect(() => {
    let aborted = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const base = getAppServerBaseUrl();
        const { from, to } = computeFromTo(range);
        const url = new URL(`${base}/api/stats/matches-per-day`);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as ApiResponse;
        if (aborted) return;
        setSeries(data.series);
        setFromIso(data.from);
        setToIso(data.to);
      } catch (e) {
        if (!aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setSeries([]);
        }
      } finally {
        if (!aborted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      aborted = true;
    };
  }, [range]);

  const maxY = useMemo(
    () => Math.max(1, ...series.map((p) => p.count)),
    [series]
  );
  const total = useMemo(
    () => series.reduce((acc, p) => acc + p.count, 0),
    [series]
  );
  const avg = useMemo(
    () => (series.length ? total / series.length : 0),
    [total, series.length]
  );

  useEffect(() => {
    let aborted = false;
    async function loadTokens() {
      setTokensLoading(true);
      setTokensError(null);
      try {
        const base = getAppServerBaseUrl();
        const { from, to } = computeFromTo(range);
        const url = new URL(`${base}/api/stats/token-allocations-per-day`);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as TokensApiResponseRaw;
        if (aborted) return;
        setTokenSeries(
          (data.series ?? []).map((p) => ({
            day: p.day,
            usdc: Number(p.usdc) || 0,
            ghst: Number(p.ghst) || 0,
          }))
        );
      } catch (e) {
        if (!aborted) {
          setTokensError(e instanceof Error ? e.message : String(e));
          setTokenSeries([]);
        }
      } finally {
        if (!aborted) setTokensLoading(false);
      }
    }
    void loadTokens();
    return () => {
      aborted = true;
    };
  }, [range]);

  const tokensTotals = useMemo(() => {
    return tokenSeries.reduce(
      (acc, p) => {
        acc.usdc += p.usdc;
        acc.ghst += p.ghst;
        return acc;
      },
      { usdc: 0, ghst: 0 }
    );
  }, [tokenSeries]);
  const tokensMax = useMemo(() => {
    return Math.max(
      1,
      ...tokenSeries.map((p) => {
        const t = (p.usdc ?? 0) + (p.ghst ?? 0);
        return t;
      })
    );
  }, [tokenSeries]);

  useEffect(() => {
    let aborted = false;
    async function loadActive() {
      setActiveLoading(true);
      setActiveError(null);
      try {
        const base = getAppServerBaseUrl();
        const { from, to } = computeFromTo(range);
        const url = new URL(`${base}/api/stats/active-users`);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
        url.searchParams.set('windowDays', '30');
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as ActiveUsersApiResponseRaw;
        if (aborted) return;
        setActiveUsers(
          (data.series ?? []).map((p) => ({
            day: p.day,
            dau: Number(p.dau) || 0,
            mau: Number(p.mau) || 0,
          }))
        );
      } catch (e) {
        if (!aborted) {
          setActiveError(e instanceof Error ? e.message : String(e));
          setActiveUsers([]);
        }
      } finally {
        if (!aborted) setActiveLoading(false);
      }
    }
    void loadActive();
    return () => {
      aborted = true;
    };
  }, [range]);

  const activeMax = useMemo(() => {
    return Math.max(
      1,
      ...activeUsers.map((p) => Math.max(p.mau ?? 0, p.dau ?? 0))
    );
  }, [activeUsers]);
  const topupsTotals = useMemo(() => {
    return topups.reduce(
      (acc, p) => {
        acc.credits += p.credits;
        acc.count += p.count;
        return acc;
      },
      { credits: 0, count: 0 }
    );
  }, [topups]);
  const topupsMax = useMemo(
    () => Math.max(1, ...topups.map((p) => p.credits)),
    [topups]
  );

  const topupsCumulative = useMemo(() => {
    let running = 0;
    return topups.map((p) => {
      running += p.credits;
      return { day: p.day, total: running };
    });
  }, [topups]);
  const topupsCumulativeMax = useMemo(
    () => Math.max(1, ...topupsCumulative.map((p) => p.total)),
    [topupsCumulative]
  );

  function buildSmoothSvgPath(points: { x: number; y: number }[]): string {
    if (points.length === 0) return '';
    if (points.length === 1) {
      const p = points[0];
      return `M ${p.x},${p.y}`;
    }
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  useEffect(() => {
    let aborted = false;
    async function loadTopups() {
      setTopupsLoading(true);
      setTopupsError(null);
      try {
        const base = getAppServerBaseUrl();
        const { from, to } = computeFromTo(range);
        const url = new URL(`${base}/api/stats/topups-per-day`);
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
        const res = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as TopUpsApiResponseRaw;
        if (aborted) return;
        setTopups(
          (data.series ?? []).map((p) => ({
            day: p.day,
            credits: Number(p.credits) || 0,
            count: Number(p.count) || 0,
          }))
        );
      } catch (e) {
        if (!aborted) {
          setTopupsError(e instanceof Error ? e.message : String(e));
          setTopups([]);
        }
      } finally {
        if (!aborted) setTopupsLoading(false);
      }
    }
    void loadTopups();
    return () => {
      aborted = true;
    };
  }, [range]);
  const activeAverages = useMemo(() => {
    if (!activeUsers.length) return { avgDau: 0, avgMau: 0 };
    const sumDau = activeUsers.reduce((acc, p) => acc + (p.dau ?? 0), 0);
    const sumMau = activeUsers.reduce((acc, p) => acc + (p.mau ?? 0), 0);
    return {
      avgDau: sumDau / activeUsers.length,
      avgMau: sumMau / activeUsers.length,
    };
  }, [activeUsers]);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="text-sm text-white/70">Range:</div>
        <div className="flex items-center gap-2">
          {(['7', '30', '90'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-sm transition border ${
                range === r
                  ? 'bg-white/20 border-white/20 text-white'
                  : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
              }`}
            >
              Last {r}d
            </button>
          ))}
        </div>
        <div className="ml-auto text-sm text-white/60">
          {fromIso && toIso ? (
            <span>
              {new Date(fromIso).toLocaleDateString()} →{' '}
              {new Date(toIso).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-medium text-white/80">
          Matches per day
        </div>
        {!isLoading && !error && series.length > 0 ? (
          <div className="mb-3 text-xs text-white/60">
            Total: {total} · Avg: {avg.toFixed(1)}/day · Max: {maxY}
          </div>
        ) : null}
        {isLoading ? (
          <div className="p-6 text-center text-white/60">Loading…</div>
        ) : error ? (
          <div className="p-6 text-center text-red-300">
            Failed to load: {error}
          </div>
        ) : series.length === 0 ? (
          <div className="p-6 text-center text-white/60">No data</div>
        ) : (
          <div className="relative h-64 w-full">
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {series.map((p) => {
                const h = (p.count / maxY) * 100;
                return (
                  <div
                    key={p.day}
                    title={`${p.day}: ${p.count}`}
                    className="flex-1 bg-emerald-400/80 hover:bg-emerald-300 transition-colors"
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
            {/* Y-axis labels */}
            <div className="absolute inset-y-0 left-0 w-full pointer-events-none">
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute bottom-1/2 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {maxY}
              </div>
              <div className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {Math.ceil(maxY / 2)}
              </div>
              <div className="absolute bottom-0 left-2 translate-y-1/2 text-[10px] text-white/60">
                0
              </div>
            </div>
          </div>
        )}
        {!isLoading && !error && series.length > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>{series[0]?.day}</div>
            <div>{series[series.length - 1]?.day}</div>
          </div>
        ) : null}
        {!isLoading && !error && series.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            <AccordionItem value="matches-details">
              <AccordionTrigger>View daily details</AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2 text-left">Day</th>
                        <th className="px-4 py-2 text-right">Matches</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {series.map((p) => (
                        <tr key={p.day} className="hover:bg-white/5 transition">
                          <td className="px-4 py-2">{p.day}</td>
                          <td className="px-4 py-2 text-right">{p.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-medium text-white/80">
          USDC / GHST allocated per day
        </div>
        {!tokensLoading && !tokensError && tokenSeries.length > 0 ? (
          <div className="mb-3 text-xs text-white/60">
            Total: {tokensTotals.usdc.toFixed(2)} USDC ·{' '}
            {tokensTotals.ghst.toFixed(2)} GHST · Max/day:{' '}
            {tokensMax.toFixed(2)}
          </div>
        ) : null}
        {tokensLoading ? (
          <div className="p-6 text-center text-white/60">Loading…</div>
        ) : tokensError ? (
          <div className="p-6 text-center text-red-300">
            Failed to load: {tokensError}
          </div>
        ) : tokenSeries.length === 0 ? (
          <div className="p-6 text-center text-white/60">No data</div>
        ) : (
          <div className="relative h-64 w-full">
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {tokenSeries.map((p) => {
                const totalForDay = (p.usdc ?? 0) + (p.ghst ?? 0);
                const barHeightPct =
                  tokensMax > 0
                    ? Math.max((totalForDay / tokensMax) * 100, 1)
                    : 0;
                const usdcPct =
                  totalForDay > 0 ? (p.usdc / totalForDay) * 100 : 0;
                const ghstPct =
                  totalForDay > 0 ? (p.ghst / totalForDay) * 100 : 0;
                const title = `${p.day}: ${p.usdc.toFixed(
                  2
                )} USDC, ${p.ghst.toFixed(2)} GHST`;
                return (
                  <div key={p.day} className="flex-1 flex items-end h-full">
                    <div
                      className="w-full flex flex-col justify-end"
                      title={title}
                      style={{ height: `${barHeightPct}%` }}
                    >
                      <div
                        className="bg-sky-400/80 hover:bg-sky-300 transition-colors"
                        style={{ height: `${usdcPct}%` }}
                      />
                      <div
                        className="bg-violet-400/80 hover:bg-violet-300 transition-colors"
                        style={{ height: `${ghstPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Y-axis labels */}
            <div className="absolute inset-y-0 left-0 w-full pointer-events-none">
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute bottom-1/2 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {tokensMax.toFixed(2)}
              </div>
              <div className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {(tokensMax / 2).toFixed(2)}
              </div>
              <div className="absolute bottom-0 left-2 translate-y-1/2 text-[10px] text-white/60">
                0
              </div>
            </div>
          </div>
        )}
        {!tokensLoading && !tokensError && tokenSeries.length > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>{tokenSeries[0]?.day}</div>
            <div>{tokenSeries[tokenSeries.length - 1]?.day}</div>
          </div>
        ) : null}
        {!tokensLoading && !tokensError && tokenSeries.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            <AccordionItem value="tokens-details">
              <AccordionTrigger>View daily details</AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2 text-left">Day</th>
                        <th className="px-4 py-2 text-right">USDC</th>
                        <th className="px-4 py-2 text-right">GHST</th>
                        <th className="px-4 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {tokenSeries.map((p) => {
                        const t = (p.usdc ?? 0) + (p.ghst ?? 0);
                        return (
                          <tr
                            key={p.day}
                            className="hover:bg-white/5 transition"
                          >
                            <td className="px-4 py-2">{p.day}</td>
                            <td className="px-4 py-2 text-right">
                              {p.usdc.toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {p.ghst.toFixed(2)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {t.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-medium text-white/80">DAU / MAU</div>
        {!activeLoading && !activeError && activeUsers.length > 0 ? (
          <div className="mb-3 text-xs text-white/60">
            Avg DAU: {activeAverages.avgDau.toFixed(1)} · Avg MAU:{' '}
            {activeAverages.avgMau.toFixed(1)} · Max: {activeMax.toFixed(0)}
          </div>
        ) : null}
        {activeLoading ? (
          <div className="p-6 text-center text-white/60">Loading…</div>
        ) : activeError ? (
          <div className="p-6 text-center text-red-300">
            Failed to load: {activeError}
          </div>
        ) : activeUsers.length === 0 ? (
          <div className="p-6 text-center text-white/60">No data</div>
        ) : (
          <div className="relative h-64 w-full">
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {activeUsers.map((p) => {
                const mauHRaw = (p.mau / activeMax) * 100;
                const dauHRaw = (p.dau / activeMax) * 100;
                const mauH = p.mau > 0 ? Math.max(mauHRaw, 1) : 0;
                const dauH = p.dau > 0 ? Math.max(dauHRaw, 1) : 0;
                const title = `${p.day}: DAU ${p.dau}, MAU ${p.mau}`;
                return (
                  <div key={p.day} className="relative flex-1 h-full">
                    <div
                      title={title}
                      className="absolute bottom-0 left-0 right-0 bg-amber-400/60 hover:bg-amber-300 transition-colors"
                      style={{ height: `${mauH}%` }}
                    />
                    <div
                      title={title}
                      className="absolute bottom-0 left-1/4 right-1/4 bg-sky-400/80 hover:bg-sky-300 transition-colors"
                      style={{ height: `${dauH}%` }}
                    />
                  </div>
                );
              })}
            </div>
            {/* Y-axis labels */}
            <div className="absolute inset-y-0 left-0 w-full pointer-events-none">
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute bottom-1/2 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {activeMax.toFixed(0)}
              </div>
              <div className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {Math.ceil(activeMax / 2)}
              </div>
              <div className="absolute bottom-0 left-2 translate-y-1/2 text-[10px] text-white/60">
                0
              </div>
            </div>
          </div>
        )}
        {!activeLoading && !activeError && activeUsers.length > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>{activeUsers[0]?.day}</div>
            <div>{activeUsers[activeUsers.length - 1]?.day}</div>
          </div>
        ) : null}
        {!activeLoading && !activeError && activeUsers.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            <AccordionItem value="active-details">
              <AccordionTrigger>View daily details</AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2 text-left">Day</th>
                        <th className="px-4 py-2 text-right">DAU</th>
                        <th className="px-4 py-2 text-right">MAU</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {activeUsers.map((p) => (
                        <tr key={p.day} className="hover:bg-white/5 transition">
                          <td className="px-4 py-2">{p.day}</td>
                          <td className="px-4 py-2 text-right">{p.dau}</td>
                          <td className="px-4 py-2 text-right">{p.mau}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-medium text-white/80">
          Credits top-ups per day
        </div>
        {!topupsLoading && !topupsError && topups.length > 0 ? (
          <div className="mb-3 text-xs text-white/60">
            Total: {topupsTotals.credits.toFixed(2)} credits · Count:{' '}
            {topupsTotals.count} · Max/day: {topupsMax.toFixed(2)}
          </div>
        ) : null}
        {topupsLoading ? (
          <div className="p-6 text-center text-white/60">Loading…</div>
        ) : topupsError ? (
          <div className="p-6 text-center text-red-300">
            Failed to load: {topupsError}
          </div>
        ) : topups.length === 0 ? (
          <div className="p-6 text-center text-white/60">No data</div>
        ) : (
          <div className="relative h-64 w-full">
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {topups.map((p) => {
                const h = (p.credits / topupsMax) * 100;
                return (
                  <div
                    key={p.day}
                    title={`${p.day}: ${p.credits.toFixed(2)} (${p.count} tx)`}
                    className="flex-1 bg-emerald-400/80 hover:bg-emerald-300 transition-colors"
                    style={{ height: `${Math.max(h, 1)}%` }}
                  />
                );
              })}
            </div>
            <div className="absolute inset-y-0 left-0 w-full pointer-events-none">
              <div className="absolute bottom-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute bottom-1/2 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-0 right-0 border-t border-white/10" />
              <div className="absolute top-0 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {topupsMax.toFixed(2)}
              </div>
              <div className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {(topupsMax / 2).toFixed(2)}
              </div>
              <div className="absolute bottom-0 left-2 translate-y-1/2 text-[10px] text-white/60">
                0
              </div>
            </div>
          </div>
        )}
        {!topupsLoading && !topupsError && topups.length > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>{topups[0]?.day}</div>
            <div>{topups[topups.length - 1]?.day}</div>
          </div>
        ) : null}
        {!topupsLoading && !topupsError && topups.length > 0 ? (
          <Accordion type="single" collapsible className="mt-6">
            <AccordionItem value="topups-details">
              <AccordionTrigger>View daily details</AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead className="bg-white/5 text-white/60 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2 text-left">Day</th>
                        <th className="px-4 py-2 text-right">Credits</th>
                        <th className="px-4 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {topups.map((p) => (
                        <tr key={p.day} className="hover:bg-white/5 transition">
                          <td className="px-4 py-2">{p.day}</td>
                          <td className="px-4 py-2 text-right">
                            {p.credits.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right">{p.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-sm font-medium text-white/80">
          Credits top-ups cumulative (rising total)
        </div>
        {!topupsLoading && !topupsError && topups.length > 1 ? (
          <div className="mb-3 text-xs text-white/60">
            Total: {topupsTotals.credits.toFixed(2)} credits · Count:{' '}
            {topupsTotals.count} · Max total:{' '}
            {topupsCumulativeMax.toFixed(2)}
          </div>
        ) : null}
        {topupsLoading ? (
          <div className="p-6 text-center text-white/60">Loading…</div>
        ) : topupsError ? (
          <div className="p-6 text-center text-red-300">
            Failed to load: {topupsError}
          </div>
        ) : topups.length < 2 ? (
          <div className="p-6 text-center text-white/60">
            Not enough data to render curve
          </div>
        ) : (
          <div className="relative h-64 w-full">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
            >
              <defs>
                <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(16,185,129,0.35)" />
                  <stop offset="100%" stopColor="rgba(16,185,129,0.0)" />
                </linearGradient>
              </defs>
              <g>
                <line
                  x1="0"
                  y1="100"
                  x2="100"
                  y2="100"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="0.5"
                />
                <line
                  x1="0"
                  y1="50"
                  x2="100"
                  y2="50"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="0.5"
                />
                <line
                  x1="0"
                  y1="0"
                  x2="100"
                  y2="0"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth="0.5"
                />
              </g>
              {(() => {
                const denom = Math.max(1, topupsCumulative.length - 1);
                const maxVal = Math.max(1, topupsCumulativeMax);
                const pts = topupsCumulative.map((p, i) => {
                  const x = (i / denom) * 100;
                  const y =
                    100 -
                    (Math.max(0, Math.min(p.total, maxVal)) / maxVal) * 100;
                  return { x, y };
                });
                const d = buildSmoothSvgPath(pts);
                const areaPath =
                  d +
                  ` L 100,100 L 0,100 Z`; // close to bottom for fill
                return (
                  <>
                    <path
                      d={areaPath}
                      fill="url(#curveFill)"
                      stroke="none"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke="rgba(16,185,129,0.9)"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                );
              })()}
            </svg>
            <div className="absolute inset-y-0 left-0 w-full pointer-events-none">
              <div className="absolute top-0 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {topupsCumulativeMax.toFixed(2)}
              </div>
              <div className="absolute top-1/2 left-2 -translate-y-1/2 text-[10px] text-white/60">
                {(topupsCumulativeMax / 2).toFixed(2)}
              </div>
              <div className="absolute bottom-0 left-2 translate-y-1/2 text-[10px] text-white/60">
                0
              </div>
            </div>
          </div>
        )}
        {!topupsLoading && !topupsError && topups.length > 0 ? (
          <div className="mt-3 flex items-center justify-between text-xs text-white/60">
            <div>{topups[0]?.day}</div>
            <div>{topups[topups.length - 1]?.day}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
