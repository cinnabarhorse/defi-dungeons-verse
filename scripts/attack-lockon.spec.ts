// Mock systems with side effects we don't want in unit tests
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

// Defer import of action after mocks
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
    movePlayerTo: jest.fn(),
  };
  return { room, messages };
}

describe('Attack lock-on follow – re-path when target moves out of range', () => {
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

  test('after entering range and stopping, movement should resume if target drifts out of range', () => {
    const { room } = makeRoom();

    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 'right',
      hp: 100,
      maxHp: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
      currentAction: '',
      actionTarget: '',
      isAutoWalking: false,
      currentPath: '',
      targetX: -1,
      targetY: -1,
    };

    const enemy: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 60, // start within range
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.players.set(player.id, player);
    room.state.enemies.set(enemy.id, enemy);

    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-sword',
    };

    // Start action; currently in range so no pathfinding on start
    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      enemy.id,
      'melee',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );

    // Simulate ActionManager.startAction bookkeeping
    player.currentAction = action.type;
    player.actionTarget = action.targetId;
    action.onStart(player as any, room as any);

    // Because player is already in range, onStart must not start pathfinding
    expect(room.movePlayerTo).not.toHaveBeenCalled();

    // Action tick while in range performs the timed interaction (continues)
    let result = action.update(player as any, room as any);
    expect(result.result).toBe('continue');

    // Enemy drifts slightly out of range (e.g., from 60 -> 100)
    enemy.x = 100;

    // Next update should request re-pathing to the (moving) target rather than cancelling
    result = action.update(player as any, room as any);

    // Verified behaviour: continue + pathfinding called
    expect(result.result).toBe('continue');
    expect(room.movePlayerTo).toHaveBeenCalledWith(
      player.id,
      { x: enemy.x, y: enemy.y },
      true
    );
  });
});
