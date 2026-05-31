// Mock EnemySystem to avoid schema decorator imports via transitive deps
jest.mock('../apps/server/src/lib/systems/EnemySystem', () => ({
  shouldEnemyEvadeAttack: jest.fn(() => false),
  applyAuraDamageMitigation: jest.fn((_enemy: any, damage: number) => damage),
  applyEnemyIncomingDamageModifiers: jest.fn(
    (_enemy: any, damage: number) => damage
  ),
}));

// Mock projectiles to avoid side effects
jest.mock('../apps/server/src/lib/systems/ProjectileSystem', () => ({
  fireProjectileAtTarget: jest.fn(),
}));

let AttackEnemyAction: any;

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

function makeRoom({ discovered = true } = {}) {
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
    isTileDiscovered: jest.fn((_x: number, _y: number) => discovered),
  };
  return { room, messages };
}

describe('Ranged attacks respect fog of war exploration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AttackEnemyAction =
      require('../apps/server/src/lib/actions/attack').AttackEnemyAction;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('fails when target tile is unexplored, even within attack range', () => {
    const { room } = makeRoom({ discovered: false });

    const player: any = {
      id: 'p1',
      name: 'Archer',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 'right',
      hp: 100,
      maxHp: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };

    const enemy: any = {
      id: 'e1',
      enemyType: 'cactus',
      x: 100, // within default ranged 110
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.players.set(player.id, player);
    room.state.enemies.set(enemy.id, enemy);

    const derivedStats = {
      rangedAttackRange: 110,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
    };

    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      enemy.id,
      'ranged',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );

    // Call performInteraction directly to simulate attack within range
    const res = action.performInteraction(player as any, room as any) as any;
    expect(res && res.result).toBe('failed');
    expect(res && res.message).toMatch(/unexplored/i);
  });

  test('succeeds when target tile is explored', () => {
    const { room } = makeRoom({ discovered: true });

    const player: any = {
      id: 'p1',
      name: 'Archer',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 'right',
      hp: 100,
      maxHp: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };

    const enemy: any = {
      id: 'e1',
      enemyType: 'cactus',
      x: 100,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.players.set(player.id, player);
    room.state.enemies.set(enemy.id, enemy);

    const derivedStats = {
      rangedAttackRange: 110,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
    };

    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      enemy.id,
      'ranged',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );

    const res = action.performInteraction(player as any, room as any) as any;
    expect(res && res.result).toBe('continue');
  });
});
