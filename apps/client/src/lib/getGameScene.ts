// Lightweight helper to retrieve the active GameScene instance without relying on scene order.
// Uses key lookup first, then falls back to scanning scenes.
export function getGameScene(): any | null {
  const manager = (window as any)?.phaserGame?.scene;
  if (!manager) return null;

  try {
    const byKey = manager.getScene?.('GameScene');
    if (byKey) return byKey;
  } catch {}

  const list: any[] = Array.isArray(manager.scenes) ? manager.scenes : [];
  for (const s of list) {
    const key = s?.sys?.settings?.key || s?.scene?.key || s?.key;
    if (key === 'GameScene') return s;
  }

  const withRoom = list.find((s: any) => typeof s?.room !== 'undefined');
  return withRoom || null;
}
