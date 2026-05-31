'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Tabs } from '../ui/Tabs';
import { Home, Gem, Trophy, User } from 'lucide-react';
import { useSession } from '../providers/SessionProvider';
import { usePlayer } from '../providers/PlayerProvider';

type MainTab = 'play' | 'loot' | 'rank' | 'me';

export function BottomTabs() {
  const pathname = usePathname();
  const [hideForGame, setHideForGame] = useState(false);
  const { hasActiveWallet } = useSession();
  const { progressionProfile } = usePlayer();

  // Hide bottom tabs when the game container is mounted (in-play view)
  useEffect(() => {
    if (typeof window === 'undefined' || !document?.body) return;

    const evaluate = () => {
      const gameEl = document.getElementById('game-container');
      setHideForGame(Boolean(gameEl));
    };

    // Initial check
    evaluate();

    // Observe DOM changes to catch transition between lobby <-> game
    const observer = new MutationObserver(() => evaluate());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Only show tabs on exact top-level routes
  const shouldShowOnRoute = useMemo(() => {
    const cleaned = (() => {
      if (!pathname) return '/';
      const trimmed = pathname.replace(/\/+$/, '');
      return trimmed.length === 0 ? '/' : trimmed;
    })();
    const allowed = new Set(['/', '/play', '/loot', '/leaderboard', '/me']);
    return allowed.has(cleaned);
  }, [pathname]);

  const current: MainTab = useMemo(() => {
    if (!pathname) return 'play';
    if (pathname.startsWith('/me')) return 'me';
    if (pathname.startsWith('/leaderboard')) return 'rank';
    if (pathname.startsWith('/loot')) return 'loot';
    // Treat "/" and "/play" as Play
    return 'play';
  }, [pathname]);

  if (hideForGame || !hasActiveWallet || !shouldShowOnRoute) {
    return null;
  }

  return (
    <Tabs
      value={current}
      onValueChange={() => {}}
      items={[
        { value: 'play', label: 'Play', icon: Home, href: '/play' },
        { value: 'loot', label: 'Loot', icon: Gem, href: '/loot' },
        { value: 'rank', label: 'Rank', icon: Trophy, href: '/leaderboard' },
        {
          value: 'me',
          label: 'Me',
          icon: User,
          href: '/me',
          showBadge: (progressionProfile?.unspentPoints ?? 0) > 0,
        },
      ]}
    />
  );
}
