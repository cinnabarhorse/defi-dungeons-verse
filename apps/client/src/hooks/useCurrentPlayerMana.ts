import { useEffect, useState } from 'react';

export interface CurrentPlayerMana {
  mana: number;
  maxMana: number;
}

export function useCurrentPlayerMana(
  pollIntervalMs = 250
): CurrentPlayerMana {
  const [mana, setMana] = useState<number>(0);
  const [maxMana, setMaxMana] = useState<number>(0);

  useEffect(() => {
    let isCancelled = false;

    function readCurrentPlayerMana() {
      try {
        const sceneManager = (window as any)?.phaserGame?.scene;
        let scene: any = sceneManager?.getScene?.('GameScene');
        if (!scene && Array.isArray(sceneManager?.scenes)) {
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
          if (player && typeof player.mana === 'number') {
            const nextMana = Math.max(0, Math.floor(Number(player.mana)));
            const rawMax =
              typeof player.maxMana === 'number'
                ? Number(player.maxMana)
                : nextMana || 0;
            const nextMaxMana = Math.max(0, Math.floor(rawMax));
            if (!isCancelled) {
              setMana(nextMana);
              setMaxMana(nextMaxMana);
            }
          }
        }
      } catch {
        // ignore transient errors
      }
    }

    readCurrentPlayerMana();
    const id = window.setInterval(
      readCurrentPlayerMana,
      Math.max(100, pollIntervalMs)
    );
    return () => {
      isCancelled = true;
      window.clearInterval(id);
    };
  }, [pollIntervalMs]);

  return { mana, maxMana };
}
