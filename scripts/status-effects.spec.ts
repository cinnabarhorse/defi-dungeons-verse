// Mock modules that import Colyseus schemas to avoid decorator runtime
jest.mock('../apps/server/src/lib/systems/EnemySystem', () => ({
  shouldEnemyEvadeAttack: jest.fn(() => false),
  applyAuraDamageMitigation: jest.fn((_enemy: any, damage: number) => damage),
  applyEnemyIncomingDamageModifiers: jest.fn(
    (_enemy: any, damage: number) => damage
  ),
}));
jest.mock('../apps/server/src/lib/systems/ProjectileSystem', () => ({
  fireProjectileAtTarget: jest.fn(),
}));
// Defer importing AttackEnemyAction until after mocks are registered
let AttackEnemyAction: any;
import {
  applyMovementSlow,
  applyStunStatus,
  getMovementSpeedScalar,
  isEntityStunned,
  updateStatusSystem,
} from '../apps/server/src/lib/systems/StatusSystem';
// Intentionally avoid importing Colyseus Schema classes in tests to prevent
// decorator runtime requirements; use plain objects instead.

jest.mock('../apps/server/src/lib/ability-utils', () => {
  const actual = jest.requireActual('../apps/server/src/lib/ability-utils');
  return {
    ...actual,
    getPlayerCleave: jest.fn(() => ({ enabled: false, damageMultiplier: 1 })),
    getPlayerSlow: jest.fn(() => [
      {
        amount: 0.5,
        durationMs: 1000,
        chance: 1,
        appliesTo: 'melee',
        stacking: 'refresh',
        sourceKey: 'test:slow',
      },
    ]),
    getPlayerStun: jest.fn(() => [
      {
        chance: 1,
        durationMs: 500,
        sourceKey: 'test:stun',
        abilitySourceId: 'unit-test',
      },
    ]),
  };
});

function makeBroadcasterCollector() {
  const messages: Array<{ type: string; payload: any }> = [];
  return {
    messages,
    broadcaster: {
      broadcast: (type: string, payload?: any) =>
        messages.push({ type: String(type), payload }),
      broadcastExcept: () => {},
      sendTo: () => {},
    },
  };
}

function makeRoom() {
  const { messages, broadcaster } = makeBroadcasterCollector();
  const state: any = {
    players: new Map<string, any>(),
    enemies: new Map<string, any>(),
    entities: new Map<string, any>(),
  };
  const room: any = {
    state,
    msg: broadcaster,
    broadcast: broadcaster.broadcast,
    setEnemyAggro: (_enemyId: string, _playerId: string) => {},
    handleEnemyDeath: () => {},
    getFogVisionRadiusTiles: () => 10,
  };
  return { room, messages };
}

describe('Status effects – core helpers', () => {
  test('applyMovementSlow sets slow and expires', () => {
    const enemy: any = { id: 'e1', hp: 100, maxHp: 100 };
    const now = 1_000_000;
    const slow = {
      amount: 0.6,
      durationMs: 500,
      chance: 1,
      appliesTo: 'melee' as const,
      stacking: 'refresh' as const,
      sourceKey: 'unit:slow',
    };
    const r1 = applyMovementSlow(enemy, slow as any, now);
    expect(r1.applied).toBe(true);
    expect(getMovementSpeedScalar(enemy, now)).toBeLessThan(1);

    // After expiry, should clear
    const later = now + 600;
    expect(getMovementSpeedScalar(enemy, later)).toBe(1);
  });

  test('applyStunStatus stuns enemy and expires via updateStatusSystem', () => {
    const { room, messages } = makeRoom();
    const enemy: any = {
      id: 'e2',
      hp: 100,
      maxHp: 100,
      x: 0,
      y: 0,
      anim: 'idle',
      nextMoveTime: 0,
    };
    room.state.enemies.set(enemy.id, enemy);

    const now = 2_000_000;
    const stun = {
      chance: 1,
      durationMs: 300,
      sourceKey: 'unit:stun',
      abilitySourceId: 'unit',
    };
    const r = applyStunStatus(room, enemy, stun as any, now, {
      attackerId: 'p1',
    });
    expect(r.applied).toBe(true);
    expect(isEntityStunned(enemy, now)).toBe(true);

    // Advance time past expiry and run status updater to trigger removal broadcast
    updateStatusSystem(room, now + 400);
    const removed = messages.filter(
      (m) => m.type === 'status_removed' && m.payload.type === 'stun'
    );
    expect(removed.length).toBe(1);
  });
});

describe('AttackEnemyAction – on-hit applies slow and stun (melee)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    // Import after mocks
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AttackEnemyAction =
      require('../apps/server/src/lib/actions/attack').AttackEnemyAction;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('melee attack applies status_applied for slow and stun', () => {
    const { room, messages } = makeRoom();

    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 0,
      hp: 100,
      maxHp: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };

    const enemy: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 40,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.enemies.set(enemy.id, enemy);
    room.state.players.set(player.id, player);

    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400, // ms; hitOffset ~ 100ms
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-sword',
    };

    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      enemy.id,
      'melee',
      player.characterId as any,
      {
        derivedStats: derivedStats as any,
      }
    );

    const start = action.performInteraction(player as any, room as any);
    expect((start as any).result).toBe('continue');

    // Advance to the impact frame and follow-up timers
    jest.advanceTimersByTime(120); // hit offset ~100ms
    jest.advanceTimersByTime(10); // allow status apply
    // Collect status_applied messages
    const statusMsgs = messages.filter((m) => m.type === 'status_applied');
    const types = statusMsgs.map((m) => m.payload.type).sort();
    expect(types).toEqual(['slow', 'stun']);

    // Sanity: enemy took damage
    expect(enemy.hp).toBeLessThan(enemy.maxHp);

    // Advance past both durations and ensure status_removed are broadcast
    const nowBase = Date.now();
    updateStatusSystem(room as any, nowBase + 1200);
    const removedSlow = messages.filter(
      (m) => m.type === 'status_removed' && m.payload.type === 'slow'
    );
    const removedStun = messages.filter(
      (m) => m.type === 'status_removed' && m.payload.type === 'stun'
    );
    expect(removedSlow.length).toBeGreaterThanOrEqual(1);
    expect(removedStun.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Status effects – removal broadcasting after expiry', () => {
  test('slow from dead enemy is removed after expiry even if pruned by getter', () => {
    const { room, messages } = makeRoom();

    const player: any = {
      id: 'p1',
      hp: 100,
      maxHp: 100,
      x: 0,
      y: 0,
    };

    const enemy: any = {
      id: 'e-dead',
      hp: 0,
      maxHp: 100,
    };

    room.state.players.set(player.id, player);
    room.state.enemies.set(enemy.id, enemy);

    const now = 3_000_000;
    const slow = {
      amount: 0.5,
      durationMs: 200,
      chance: 1,
      appliesTo: 'melee' as const,
      stacking: 'refresh' as const,
      sourceKey: 'unit:slow:dead',
    };

    const r1 = applyMovementSlow(player as any, slow as any, now);
    expect(r1.applied).toBe(true);

    // Simulate enemy death removing source entity from state
    room.state.enemies.delete(enemy.id);

    // Jump past expiry and call a getter that prunes internally
    const after = now + 250;
    expect(getMovementSpeedScalar(player as any, after)).toBe(1);

    // Now run the status updater which should broadcast removal exactly once
    updateStatusSystem(room as any, after + 1);
    const removed = messages.filter(
      (m) => m.type === 'status_removed' && m.payload?.type === 'slow'
    );
    expect(removed.length).toBe(1);
  });
});
