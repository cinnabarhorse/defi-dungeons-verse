import { useEffect, useState } from 'react';

export interface CurrentPlayerHp {
  hp: number;
  maxHp: number;
  devInvincible: boolean;
}

export function useCurrentPlayerHp(pollIntervalMs = 250): CurrentPlayerHp {
  const [hp, setHp] = useState<number>(100);
  const [maxHp, setMaxHp] = useState<number>(100);
  const [devInvincible, setDevInvincible] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    function readCurrentPlayerHp() {
      try {
        const sceneManager = (window as any)?.phaserGame?.scene;
        // Prefer lookup by key to avoid relying on scene order (LoadingScene precedes GameScene)
        let scene: any = sceneManager?.getScene?.('GameScene');
        if (!scene && Array.isArray(sceneManager?.scenes)) {
          // Fallback: find by known key or by presence of a Colyseus room reference
          scene = sceneManager.scenes.find((s: any) => {
            const key = s?.sys?.settings?.key || s?.scene?.key || s?.key;
            return key === 'GameScene' || typeof s?.room !== 'undefined';
          });
        }
        const room = scene?.room;
        const players = room?.state?.players;
        const sessionId = room?.sessionId;
        const get =
          typeof players?.get === 'function'
            ? players.get.bind(players)
            : undefined;
        if (get && sessionId) {
          const player = get(sessionId);
          if (player && typeof player.hp === 'number') {
            const nextHp = Math.max(0, Math.floor(Number(player.hp)));
            const rawMax =
              typeof player.maxHp === 'number'
                ? Number(player.maxHp)
                : nextHp || 1;
            const nextMaxHp = Math.max(1, Math.floor(rawMax));
            const nextDevInvincible = Boolean(
              (player as any)?.devInvincible === true
            );
            if (!isCancelled) {
              setHp(nextHp);
              setMaxHp(nextMaxHp);
              setDevInvincible(nextDevInvincible);
            }
          }
        }
      } catch {
        // ignore transient read errors
      }
    }

    readCurrentPlayerHp();
    const id = window.setInterval(
      readCurrentPlayerHp,
      Math.max(100, pollIntervalMs)
    );
    return () => {
      isCancelled = true;
      window.clearInterval(id);
    };
  }, [pollIntervalMs]);

  return { hp, maxHp, devInvincible };
}
