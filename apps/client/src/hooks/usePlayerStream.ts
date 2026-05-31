'use client';

import { useEffect, useRef } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase-client';

export function usePlayerStream(
  playerId: string | null | undefined,
  walletAddress: string | null | undefined,
  onPlayersRowChange: () => void,
  reloadKey?: string | number | boolean | null
) {
  const onChangeRef = useRef(onPlayersRowChange);
  onChangeRef.current = onPlayersRowChange;

  useEffect(() => {
    // Always perform an initial hydrate, even if there is no playerId yet.
    // This ensures the client fetches /api/player once and hydrates the UI
    // when the wallet or session changes.
    (async () => {
      try {
        await Promise.resolve(onChangeRef.current());
      } catch {
        // ignore errors; we'll still attempt to subscribe when possible
      }
    })();

    if (!playerId) {
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      // Supabase not configured in this environment; skip realtime subscription
      // after the initial hydrate above.
      return;
    }

    let refreshTimeout: number | null = null;
    let active = true;
    let channel: any | null = null;

    const schedule = () => {
      if (!active) return;
      if (typeof window === 'undefined') {
        onChangeRef.current();
        return;
      }
      if (refreshTimeout != null) return;
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        onChangeRef.current();
      }, 100);
    };

    (async () => {
      if (!active) return;

      // Subscribe to realtime updates
      channel = supabase.channel(`players-${playerId}`);

      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'players',
          filter: `id=eq.${playerId}`,
        },
        () => schedule()
      );

      if (walletAddress) {
        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'deposits',
            filter: `depositor_address=eq.${walletAddress.toLowerCase()}`,
          },
          () => schedule()
        );
      }

      try {
        channel.subscribe((status: string) => {
          if (status === 'SUBSCRIBED') schedule();
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      active = false;
      if (refreshTimeout != null) {
        window.clearTimeout(refreshTimeout);
        refreshTimeout = null;
      }
      if (channel) {
        channel.unsubscribe().catch(() => {});
        supabase.removeChannel(channel);
      }
    };
  }, [playerId, walletAddress, reloadKey]);
}
