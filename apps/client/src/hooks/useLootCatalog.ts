import { useCallback, useEffect, useMemo, useState } from 'react';

interface LootCatalogEntry {
  id: string;
  lootType: string;
  chainId: number;
  tokenAddress: string | null;
  tokenId: number | null;
  decimals: number | null;
  name: string | null;
  remaining: number | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

interface LootCatalogResponse {
  loot?: LootCatalogEntry[];
}

export function useLootCatalog() {
  const [entries, setEntries] = useState<LootCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const baseUrl = useMemo(() => {
    return (process.env.NEXT_PUBLIC_SERVER_URL || '').replace(/\/$/, '');
  }, []);

  const endpoint = useMemo(() => {
    return baseUrl ? `${baseUrl}/api/loot/catalog` : '/api/loot/catalog';
  }, [baseUrl]);

  const fetchCatalog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to load loot catalog (${response.status})`);
      }
      const payload: LootCatalogResponse = await response.json();
      if (Array.isArray(payload.loot)) {
        setEntries(payload.loot);
      } else {
        setEntries([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  return {
    loot: entries,
    isLoading,
    error,
    refetch: fetchCatalog,
  };
}
