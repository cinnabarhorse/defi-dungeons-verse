import { useCallback, useEffect, useMemo, useState } from 'react';

export interface EntryCostResult {
  credits: number;
  cents: number;
  bracket:
    | 'naked'
    | 'common'
    | 'uncommon'
    | 'rare'
    | 'legendary'
    | 'mythical'
    | 'godlike';
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useEntryCost(
  playerId: string | null | undefined,
  characterId?: string | null
): EntryCostResult {
  const [credits, setCredits] = useState<number>(0);
  const [cents, setCents] = useState<number>(0);
  const [bracket, setBracket] = useState<
    | 'naked'
    | 'common'
    | 'uncommon'
    | 'rare'
    | 'legendary'
    | 'mythical'
    | 'godlike'
  >('naked');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = useMemo(
    () => (process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, ''),
    []
  );

  const entryCostEndpoint = useMemo(() => {
    const base = baseUrl ? `${baseUrl}/api/entry-cost` : '/api/entry-cost';
    if (characterId) {
      const params = new URLSearchParams({ characterId });
      return `${base}?${params.toString()}`;
    }
    return base;
  }, [baseUrl, characterId]);

  const fetchEntryCost = useCallback(async () => {
    if (!playerId) {
      setCredits(0);
      setCents(0);
      setBracket('naked');
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(entryCostEndpoint, {
        credentials: 'include',
      });

      if (response.status === 401 || response.status === 403) {
        setCredits(0);
        setCents(0);
        setBracket('naked');
        setIsLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error(
          `Entry cost fetch failed with status ${response.status}`
        );
      }

      const payload: {
        credits?: number;
        cents?: number;
        bracket?:
          | 'naked'
          | 'common'
          | 'uncommon'
          | 'rare'
          | 'legendary'
          | 'mythical'
          | 'godlike';
      } = await response.json();

      if (typeof payload.credits === 'number') {
        setCredits(payload.credits);
      }
      if (typeof payload.cents === 'number') {
        setCents(payload.cents);
      }
      if (payload.bracket) {
        setBracket(payload.bracket);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load entry cost';
      console.warn('Failed to load entry cost from server', err);
      setError(message);
      setCredits(1);
      setCents(100);
      setBracket('naked');
    } finally {
      setIsLoading(false);
    }
  }, [playerId, entryCostEndpoint]);

  useEffect(() => {
    void fetchEntryCost();
  }, [fetchEntryCost]);

  return {
    credits,
    cents,
    bracket,
    isLoading,
    error,
    refresh: fetchEntryCost,
  };
}
