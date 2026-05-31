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

// Import status helpers used for assertions
import { getMovementSpeedScalar } from '../apps/server/src/lib/systems/StatusSystem';
import { setSpellAutocast } from '../apps/server/src/lib/spell-system';
import { processScheduledSpellFollowups } from '../apps/server/src/lib/spell-system';
import { updatePlayerRegen } from '../apps/server/src/lib/systems/PlayerRegenSystem';
import { handleManualSpellCast } from '../apps/server/src/lib/spell-system';
import { SPELLS_BY_ID } from '../apps/server/src/data/spells';

// Intentionally avoid importing Colyseus Schema classes in tests to prevent
// decorator runtime requirements; use plain objects instead.

// Make ability-utils deterministic and disable baseline cleave/slow/stun
jest.mock('../apps/server/src/lib/ability-utils', () => {
  const actual = jest.requireActual('../apps/server/src/lib/ability-utils');
  return {
    ...actual,
    getPlayerCleave: jest.fn(() => ({ enabled: false, damageMultiplier: 1 })),
    getPlayerSlow: jest.fn(() => []),
    getPlayerStun: jest.fn(() => []),
    getPlayerCrit: jest.fn(() => ({ chance: 0, multiplier: 1 })),
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

describe('Spells – Freezing Attack', () => {
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

  test('on-hit applies Slow and adds bonus damage', () => {
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
      mana: 100,
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

    // Ensure Bounce is disabled to isolate Freezing Attack
    setSpellAutocast(player as any, 'bounce_attack', false);

    // Derived stats snapshot: staff equipped, fixed damage for determinism
    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400, // ms; hitOffset ~ 100ms
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff', // enables staff-only spells
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
    jest.advanceTimersByTime(10); // allow spell apply

    // 1) Slow applied via Freezing Attack
    const statusMsgs = messages.filter((m) => m.type === 'status_applied');
    const hasSlow = statusMsgs.some(
      (m) => m.payload?.type === 'slow' && m.payload?.targetId === enemy.id
    );
    expect(hasSlow).toBe(true);
    expect(getMovementSpeedScalar(enemy, Date.now())).toBeLessThan(1);

    // 2) Bonus damage applied from spells.ts definition
    const dmgMsgs = messages.filter(
      (m) => m.type === 'damage_applied' && m.payload?.targetId === enemy.id
    );
    expect(dmgMsgs.length).toBeGreaterThanOrEqual(2);

    const freeze = SPELLS_BY_ID['freezing_attack'];
    const expectedSpellDamage = Number(freeze?.damage || 0);
    const expectedBaseDamage = 10; // derivedStats.damageRange min/max set to 10

    const damages = dmgMsgs.map((m) => Number(m.payload?.damage || 0));
    const totalDamage = damages.reduce((a, b) => a + b, 0);

    // Must include the exact spell bonus damage from spells.ts
    expect(damages).toContain(expectedSpellDamage);
    // Must include the base hit damage
    expect(damages).toContain(expectedBaseDamage);
    // Sum equals base + spell
    expect(totalDamage).toBe(expectedBaseDamage + expectedSpellDamage);
  });
});

describe('Spells – Bouncing Attack', () => {
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

  test('chains to multiple enemies with per-hop falloff', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };

    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e3: any = {
      id: 'e3',
      enemyType: 'slime',
      x: 120,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.enemies.set(e3.id, e3);
    room.state.players.set(player.id, player);

    // Disable Freezing to isolate bounce damage numbers
    setSpellAutocast(player as any, 'freezing_attack', false);

    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 }, // deterministic base damage
      activeWeaponSlug: 'common-wizard-staff',
    };

    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      e1.id,
      'melee',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );

    const start = action.performInteraction(player as any, room as any);
    expect((start as any).result).toBe('continue');

    // Advance to base hit
    jest.advanceTimersByTime(120);
    processScheduledSpellFollowups(room as any, Date.now());
    // Hop 1 (to e2) arrives after 80ms
    jest.advanceTimersByTime(90);
    processScheduledSpellFollowups(room as any, Date.now());
    // Hop 2 (to e3) arrives after another 80ms
    jest.advanceTimersByTime(100);
    processScheduledSpellFollowups(room as any, Date.now());

    // Collect damage_applied per enemy
    const dmgMsgs = messages.filter((m) => m.type === 'damage_applied');
    const dmgFor = (id: string) =>
      dmgMsgs
        .filter((m) => m.payload?.targetId === id)
        .map((m) => Number(m.payload?.damage || 0));

    const e1Damages = dmgFor('e1');
    const e2Damages = dmgFor('e2');
    const e3Damages = dmgFor('e3');

    // Base hit on e1 should be 10
    expect(e1Damages.some((d) => d === 10)).toBe(true);
    // Bounce hits: 80% (8) then 60% (6)
    expect(e2Damages).toContain(8);
    expect(e3Damages).toContain(6);

    // Sanity on HP values
    expect(e2.hp).toBe(92);
    expect(e3.hp).toBe(94);
  });
});

describe('Spells – Mana thresholds', () => {
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

  test('does not autocast when mana < integer cost (floor check)', () => {
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
      mana: 2.9, // floor(2.9) = 2 < manaCost(3)
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

    // Disable Bounce to isolate Freezing Attack autocast behavior
    setSpellAutocast(player as any, 'bounce_attack', false);

    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
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
    jest.advanceTimersByTime(120);
    jest.advanceTimersByTime(10);

    // No Slow should be applied (Freezing Attack should not cast)
    const statusMsgs = messages.filter((m) => m.type === 'status_applied');
    const hasSlow = statusMsgs.some(
      (m) => m.payload?.type === 'slow' && m.payload?.targetId === enemy.id
    );
    expect(hasSlow).toBe(false);

    // Only base hit damage should be present (no spell bonus damage)
    const dmgMsgs = messages.filter(
      (m) => m.type === 'damage_applied' && m.payload?.targetId === enemy.id
    );
    expect(dmgMsgs.length).toBe(1);
  });
});

describe('Spells – Bounce guard on zero damage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    // Reset EnemySystem mocks to default values
    const enemySystem = require('../apps/server/src/lib/systems/EnemySystem');
    (enemySystem.shouldEnemyEvadeAttack as jest.Mock).mockReturnValue(false);
    (enemySystem.applyAuraDamageMitigation as jest.Mock).mockImplementation(
      (_enemy: any, damage: number) => damage
    );
    (
      enemySystem.applyEnemyIncomingDamageModifiers as jest.Mock
    ).mockImplementation((_enemy: any, damage: number) => damage);
  });

  test('manual bounce: does not chain when initial hit is evaded', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
      attackType: 'ranged',
      activeWeaponSlug: 'common-wizard-staff',
    };

    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.players.set(player.id, player);

    const enemySystem = require('../apps/server/src/lib/systems/EnemySystem');
    (enemySystem.shouldEnemyEvadeAttack as jest.Mock).mockReturnValue(true);

    const res = handleManualSpellCast(room as any, player as any, {
      spellId: 'bounce_attack',
      targetId: e1.id,
    });
    expect(res.ok).toBe(true);

    jest.advanceTimersByTime(300);

    const evadedMsgs = messages.filter((m) => m.type === 'attack_evaded');
    expect(evadedMsgs.some((m) => m.payload?.targetId === 'e1')).toBe(true);

    const chainMsgs = messages.filter((m) => m.type === 'chain_hit');
    expect(chainMsgs.length).toBe(0);

    const e2DmgMsgs = messages.filter(
      (m) => m.type === 'damage_applied' && m.payload?.targetId === 'e2'
    );
    expect(e2DmgMsgs.length).toBe(0);
    expect(e2.hp).toBe(100);
  });

  test('manual bounce: does not chain when initial hit is fully mitigated', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
      attackType: 'ranged',
      activeWeaponSlug: 'common-wizard-staff',
    };

    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.players.set(player.id, player);

    const enemySystem = require('../apps/server/src/lib/systems/EnemySystem');
    (enemySystem.shouldEnemyEvadeAttack as jest.Mock).mockReturnValue(false);
    (enemySystem.applyAuraDamageMitigation as jest.Mock).mockImplementation(
      (_enemy: any, _damage: number) => 0
    );

    const res = handleManualSpellCast(room as any, player as any, {
      spellId: 'bounce_attack',
      targetId: e1.id,
    });
    expect(res.ok).toBe(true);

    jest.advanceTimersByTime(300);

    const chainMsgs = messages.filter((m) => m.type === 'chain_hit');
    expect(chainMsgs.length).toBe(0);

    const e2DmgMsgs = messages.filter(
      (m) => m.type === 'damage_applied' && m.payload?.targetId === 'e2'
    );
    expect(e2DmgMsgs.length).toBe(0);
    expect(e2.hp).toBe(100);
  });
});

describe('Player Mana Regen – accumulation and clamp', () => {
  test('accumulates fractional regen and applies whole amounts each interval', () => {
    const { room } = makeRoom();
    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 0,
      hp: 100,
      maxHp: 100,
      mana: 0,
      maxMana: 10,
      baseManaRegenPerSecond: 1.5, // 0.75 per 500ms tick
    };
    room.state.players.set(player.id, player);

    // Tick 1: carry 0.75, no whole applied
    updatePlayerRegen(room as any, 0);
    expect(player.mana).toBe(0);
    expect((player as any)._regenState?.manaCarry || 0).toBeCloseTo(0.75, 5);

    // Tick 2: carry 1.5 -> apply 1, leftover 0.5
    updatePlayerRegen(room as any, 500);
    expect(player.mana).toBe(1);
    expect((player as any)._regenState?.manaCarry || 0).toBeCloseTo(0.5, 5);

    // Tick 3: carry 1.25 -> apply 1, leftover 0.25
    updatePlayerRegen(room as any, 1000);
    expect(player.mana).toBe(2);
    expect((player as any)._regenState?.manaCarry || 0).toBeCloseTo(0.25, 5);
  });

  test('clamps to max mana and clears carry when full', () => {
    const { room } = makeRoom();
    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 0,
      hp: 100,
      maxHp: 100,
      mana: 4,
      maxMana: 5,
      baseManaRegenPerSecond: 1.5, // 0.75 per 500ms tick
    };
    room.state.players.set(player.id, player);

    // Tick 1: carry 0.75, no whole applied
    updatePlayerRegen(room as any, 0);
    expect(player.mana).toBe(4);
    // Tick 2: carry 1.5 -> apply 1 -> mana hits max
    updatePlayerRegen(room as any, 500);
    expect(player.mana).toBe(5);
    // Next tick while full should clear carry and do nothing
    updatePlayerRegen(room as any, 1000);
    expect((player as any)._regenState?.manaCarry || 0).toBe(0);
    expect(player.mana).toBe(5);
  });
});

describe('Mana Potion – auto restore +50 and inventory decrement', () => {
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

  test('restores +50 mana and consumes one potion when mana hits 0 on cast', () => {
    const { room, messages } = makeRoom();
    // Extend room with inventory and tryAutoRestoreMana logic
    (room as any).playerInventories = new Map<string, any[]>();
    const applyInventoryDelta = jest.fn(
      async (_sessionId: string, item: any, delta: number) => {
        item.quantity = Math.max(0, (Number(item.quantity) || 0) + delta);
      }
    );
    (room as any).applyInventoryDelta = applyInventoryDelta;
    (room as any).tryAutoRestoreMana = function (player: any): boolean {
      if (!player || player.mana > 0 || player.maxMana <= 0) return false;
      const inv: any[] | undefined = this.playerInventories.get(player.id);
      if (!inv || inv.length === 0) return false;
      const potion = inv.find(
        (it) =>
          String(it?.type ?? '').toLowerCase() === 'potion' &&
          String((it as any).name ?? '')
            .toLowerCase()
            .includes('mana') &&
          (Number(it?.quantity) || 0) > 0
      );
      if (!potion) return false;
      const prev = Math.max(0, Number(player.mana) || 0);
      const next = Math.min(player.maxMana, prev + 50);
      const restored = next - prev;
      if (restored <= 0) return false;
      player.mana = next;
      void this.applyInventoryDelta(player.id, potion, -1);
      this.msg.broadcast('player_mana_restored', {
        playerId: player.id,
        manaAmount: restored,
        currentMana: player.mana,
        maxMana: player.maxMana,
        source: 'auto_mana',
      });
      return true;
    };

    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'wizard',
      x: 0,
      y: 0,
      dir: 0,
      hp: 100,
      maxHp: 100,
      mana: 3, // equal to spell cost
      maxMana: 100,
      // Ensure staff category is allowed for spells
      derivedStats: JSON.stringify({ activeWeaponSlug: 'common-wizard-staff' }),
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

    const inventory = [{ type: 'potion', name: 'Mana Potion', quantity: 2 }];
    (room as any).playerInventories.set(player.id, inventory);

    room.state.enemies.set(enemy.id, enemy);
    room.state.players.set(player.id, player);

    // Trigger manual spell cast to spend mana to 0 and auto-restore via room.tryAutoRestoreMana
    const res = handleManualSpellCast(room as any, player as any, {
      spellId: 'freezing_attack',
      targetId: enemy.id,
    });
    expect(res.ok).toBe(true);

    // Verify broadcast and inventory decrement
    const restoredMsgs = messages.filter(
      (m) => m.type === 'player_mana_restored'
    );
    expect(restoredMsgs.length).toBe(1);
    expect(restoredMsgs[0].payload?.manaAmount).toBe(50);
    expect(inventory[0].quantity).toBe(1);
    // Mana should be 50 (spent to 0, then +50)
    expect(player.mana).toBe(50);
    expect(applyInventoryDelta).toHaveBeenCalled();
  });
});

describe('Player HP Regen – fractional accumulation and equipment modifiers', () => {
  test('small hpRegen (0.1/s) accumulates and heals 1 HP after 10s (no min floor)', () => {
    const { room } = makeRoom();
    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'warrior',
      x: 0,
      y: 0,
      dir: 0,
      hp: 90,
      maxHp: 100,
      mana: 0,
      maxMana: 0,
      // Derived stats snapshot with fractional HP regen
      derivedStats: JSON.stringify({ hpRegen: 0.1 }),
    };
    room.state.players.set(player.id, player);

    // Tick 1 @ t=0ms: carry +0.05, no heal
    updatePlayerRegen(room as any, 0);
    expect(player.hp).toBe(90);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0.05,
      5
    );

    // Ticks 2..20: call every 500ms; only at 10s total should it heal 1 HP
    for (let i = 1; i <= 19; i += 1) {
      updatePlayerRegen(room as any, i * 500);
    }
    // Still below threshold
    expect(player.hp).toBe(90);

    // 20th tick @ t=10000ms: carry reaches 1.0 -> applies 1 HP, clears leftover
    updatePlayerRegen(room as any, 10000);
    expect(player.hp).toBe(91);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0,
      5
    );
  });

  test('applies equipment add/multiply and accumulates fractional carry', () => {
    const { room } = makeRoom();
    const player: any = {
      id: 'p1',
      name: 'Tester',
      characterId: 'warrior',
      x: 0,
      y: 0,
      dir: 0,
      hp: 90,
      maxHp: 100,
      mana: 0,
      maxMana: 0,
      // perSecond = base(0.4) * mul(2) + add(0.3) = 1.1 hp/s
      // per 500ms tick => +0.55 carry
      derivedStats: JSON.stringify({
        hpRegen: 0.4,
        equipment: { modifiers: { hpRegen: { add: 0.3, multiply: 2 } } },
      }),
    };
    room.state.players.set(player.id, player);

    // Tick 1 @ 0ms: carry 0.55, no heal
    updatePlayerRegen(room as any, 0);
    expect(player.hp).toBe(90);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0.55,
      5
    );

    // Tick 2 @ 500ms: carry 1.10 -> apply 1, leftover 0.10
    updatePlayerRegen(room as any, 500);
    expect(player.hp).toBe(91);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0.1,
      5
    );

    // Tick 3 @ 1000ms: carry 0.65, no heal yet
    updatePlayerRegen(room as any, 1000);
    expect(player.hp).toBe(91);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0.65,
      5
    );

    // Tick 4 @ 1500ms: carry 1.20 -> apply 1, leftover 0.20
    updatePlayerRegen(room as any, 1500);
    expect(player.hp).toBe(92);
    expect(((player as any)._regenState?.hpCarry as number) || 0).toBeCloseTo(
      0.2,
      5
    );
  });
});

describe('Spells – Bounce targeting (nearest, no-repeat, LOS)', () => {
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

  function flushAllSpellFollowups(room: any) {
    // Run the followup processor until the queue is empty; use a far-future now
    const maxNow = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < 8; i += 1) {
      processScheduledSpellFollowups(room as any, maxNow);
      const q = (room.state as any)._scheduledSpellFollowups;
      if (!Array.isArray(q) || q.length === 0) break;
    }
  }

  test('first hop selects the nearest valid target', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };
    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e3: any = {
      id: 'e3',
      enemyType: 'slime',
      x: 120,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };

    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.enemies.set(e3.id, e3);
    room.state.players.set(player.id, player);

    // Disable Freezing to isolate bounce
    setSpellAutocast(player as any, 'freezing_attack', false);
    setSpellAutocast(player as any, 'bounce_attack', true);

    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
    };

    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      e1.id,
      'melee',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );

    action.performInteraction(player as any, room as any);

    // Base hit occurs then drain follow-ups
    jest.advanceTimersByTime(120);
    processScheduledSpellFollowups(room as any, Date.now());
    flushAllSpellFollowups(room as any);

    const dmgMsgs = messages.filter((m) => m.type === 'damage_applied');
    // Find the first bounce (exclude the initial e1 base hit)
    const firstBounce = dmgMsgs.find(
      (m) => (m as any).payload?.targetId !== 'e1'
    );
    expect(firstBounce && (firstBounce as any).payload?.targetId).toBe('e2');
    // And eventually e3 must also get hit
    expect(dmgMsgs.some((m) => (m as any).payload?.targetId === 'e3')).toBe(
      true
    );
  });

  test('does not repeat targets when allowRepeat=false (stops when no new targets)', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };
    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.players.set(player.id, player);

    setSpellAutocast(player as any, 'freezing_attack', false);
    setSpellAutocast(player as any, 'bounce_attack', true);
    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
    };
    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      e1.id,
      'melee',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );
    action.performInteraction(player as any, room as any);

    jest.advanceTimersByTime(120);
    processScheduledSpellFollowups(room as any, Date.now());
    flushAllSpellFollowups(room as any);

    const dmgMsgs2 = messages.filter((m) => m.type === 'damage_applied');
    const e1Hits = dmgMsgs2.filter(
      (m) => (m as any).payload?.targetId === 'e1'
    );
    const e2Hits = dmgMsgs2.filter(
      (m) => (m as any).payload?.targetId === 'e2'
    );
    expect(e1Hits.length).toBe(1);
    expect(e2Hits.length).toBe(1);
  });

  test('respects LOS requirement when selecting next hop', () => {
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
      mana: 100,
      derivedStats: '',
      activeWeaponIndex: 0,
    };
    const e1: any = {
      id: 'e1',
      enemyType: 'slime',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e2: any = {
      id: 'e2',
      enemyType: 'slime',
      x: 60,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    const e3: any = {
      id: 'e3',
      enemyType: 'slime',
      x: 80,
      y: 0,
      hp: 100,
      maxHp: 100,
      anim: 'idle',
      nextMoveTime: 0,
    };
    room.state.enemies.set(e1.id, e1);
    room.state.enemies.set(e2.id, e2);
    room.state.enemies.set(e3.id, e3);
    room.state.players.set(player.id, player);

    (room as any).hasLineOfSight = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number
    ) => {
      const dx2 = e2.x - fromX;
      const dy2 = e2.y - fromY;
      const dx = toX - fromX;
      const dy = toY - fromY;
      return !(dx === dx2 && dy === dy2);
    };

    setSpellAutocast(player as any, 'freezing_attack', false);
    setSpellAutocast(player as any, 'bounce_attack', true);
    const derivedStats = {
      meleeAttackRange: 80,
      attackSpeed: 400,
      damageRange: { min: 10, max: 10 },
      activeWeaponSlug: 'common-wizard-staff',
    };
    const action = new AttackEnemyAction(
      'attack_enemy' as any,
      e1.id,
      'melee',
      player.characterId as any,
      { derivedStats: derivedStats as any }
    );
    action.performInteraction(player as any, room as any);

    jest.advanceTimersByTime(120);
    processScheduledSpellFollowups(room as any, Date.now());
    flushAllSpellFollowups(room as any);

    const dmgMsgs3 = messages.filter((m) => m.type === 'damage_applied');
    const firstBounce2 = dmgMsgs3.find(
      (m) => (m as any).payload?.targetId !== 'e1'
    );
    // e2 is nearer but LOS is blocked; first hop must target e3
    expect(firstBounce2 && (firstBounce2 as any).payload?.targetId).toBe('e3');
  });
});
