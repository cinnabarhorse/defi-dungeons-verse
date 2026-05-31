export interface QuestContext {
  roomPhase: 'staging' | 'countdown' | 'in_game' | 'ended';
  floorIndex: number;
  portalsOpened: boolean;
  tonguesCollectedThisRun: number;
}

export interface QuestDefinition {
  id: string;
  priority: number; // lower shows first
  isActive: (ctx: QuestContext) => boolean;
  label: (ctx: QuestContext) => string; // no "Quest:" prefix
}

const QUESTS: Record<string, QuestDefinition> = {
  findNextFloor: {
    id: 'findNextFloor',
    priority: 10,
    isActive: (c) =>
      c.roomPhase === 'in_game' && c.portalsOpened && c.floorIndex <= 1,
    label: () => 'Find the next floor',
  },
  choosePath: {
    id: 'choosePath',
    priority: 20,
    isActive: (c) =>
      c.roomPhase === 'in_game' && c.portalsOpened && c.floorIndex > 1,
    label: () => 'Choose your path',
  },
  collectTongues: {
    id: 'collectTongues',
    priority: 90,
    isActive: (c) =>
      c.roomPhase === 'in_game' && c.tonguesCollectedThisRun < 10,
    label: (c) =>
      `Collect 10 Lick Tongues (${Math.max(0, Math.floor(c.tonguesCollectedThisRun))}/10)`,
  },
};

export function computeQuestText(ctx: QuestContext): string {
  const active = Object.values(QUESTS)
    .filter((q) => {
      try {
        return q.isActive(ctx);
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.priority - b.priority);
  if (active.length === 0) return '';
  const primary = active[0]?.label(ctx) ?? '';
  const secondary = active
    .slice(1)
    .map((q) => q.label(ctx))
    .filter(Boolean);
  const combined = [primary, ...secondary].filter(Boolean).join(' — ');
  return combined ? `Quest: ${combined}` : '';
}
