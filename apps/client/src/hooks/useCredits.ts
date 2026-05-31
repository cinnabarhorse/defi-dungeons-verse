import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAppServerBaseUrl } from '../lib/server-url';

const EPSILON = 1e-6;

export interface UseCreditsResult {
  balance: number;
  topUp: (amount: number) => Promise<boolean>;
  consume: (amount: number) => boolean;
  refund: (amount: number) => void;
  setBalance: (value: number) => void;
  refresh: () => Promise<void>;
}

export function useCredits(
  playerId: string | null | undefined
): UseCreditsResult {
  const [balance, setBalanceState] = useState<number>(0);
  const balanceRef = useRef(balance);

  console.log('test');

  const baseUrl = useMemo(() => getAppServerBaseUrl(), []);

  const creditsEndpoint = useMemo(() => {
    return `${baseUrl}/api/player/credits`;
  }, [baseUrl]);

  const topUpEndpoint = useMemo(() => {
    return baseUrl
      ? `${baseUrl}/api/player/credits/top-up`
      : '/api/player/credits/top-up';
  }, [baseUrl]);

  useEffect(() => {
    balanceRef.current = balance;
  }, [balance]);

  const normalizeCredits = useCallback((value: number) => {
    if (!Number.isFinite(value)) return 0;
    const sanitized = Math.max(0, value);
    return Math.round(sanitized * 100) / 100;
  }, []);

  const setBalance = useCallback(
    (value: number) => {
      const normalized = normalizeCredits(value);
      const previous = balanceRef.current;

      if (Math.abs(previous - normalized) < EPSILON) {
        balanceRef.current = normalized;
        return;
      }

      balanceRef.current = normalized;
      setBalanceState(normalized);
    },
    [normalizeCredits]
  );

  const hydrateFromServer = useCallback(async () => {
    if (!playerId) {
      setBalance(0);
      return;
    }

    try {
      const response = await fetch(creditsEndpoint, {
        credentials: 'include',
      });

      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        setBalance(0);
        return;
      }

      if (!response.ok) {
        throw new Error(`Credits fetch failed with status ${response.status}`);
      }

      const payload: { balance?: number } = await response.json();
      if (typeof payload.balance === 'number') {
        setBalance(payload.balance);
      }
    } catch (error) {
      console.warn('Failed to load credits from server', error);
    }
  }, [playerId, creditsEndpoint, setBalance]);

  useEffect(() => {
    void hydrateFromServer();
  }, [hydrateFromServer]);

  const topUp = useCallback(
    async (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return false;
      if (!playerId) {
        return false;
      }

      try {
        const response = await fetch(topUpEndpoint, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount }),
        });

        if (!response.ok) {
          throw new Error(`Top-up failed with status ${response.status}`);
        }

        const payload: { balance?: number } = await response.json();
        if (typeof payload.balance === 'number') {
          setBalance(payload.balance);
        } else {
          setBalance(balanceRef.current + amount);
        }
        return true;
      } catch (error) {
        console.warn('Failed to top up credits', error);
        return false;
      }
    },
    [playerId, topUpEndpoint, setBalance]
  );

  const refund = useCallback(
    (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return;
      setBalance(balanceRef.current + amount);
    },
    [setBalance]
  );

  const consume = useCallback(
    (amount: number) => {
      if (!Number.isFinite(amount) || amount <= 0) return true;

      const currentBalance = balanceRef.current;
      if (currentBalance + EPSILON < amount) {
        return false;
      }

      setBalance(currentBalance - amount);
      return true;
    },
    [setBalance]
  );

  return {
    balance,
    topUp,
    consume,
    refund,
    setBalance,
    refresh: hydrateFromServer,
  };
}
