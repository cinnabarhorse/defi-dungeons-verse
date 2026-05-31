import { getPlayerEquipmentState } from '../apps/server/src/lib/equipment-service';
import { getCharacterStats as getServerStats } from '../apps/server/src/data/characters';
import { getCharacterStats as getClientStats } from '../apps/client/src/lib/character-registry';

function sanitizeStats(s: any) {
  return {
    weaponType: s.weaponType,
    damage: s.damage,
    damageRange: s.damageRange,
    totalDamage: (s as any).totalDamage,
    attackSpeed: s.attackSpeed,
    meleeAttackRange: s.meleeAttackRange,
    rangedAttackRange: s.rangedAttackRange,
    projectileSpeed: s.projectileSpeed,
    vacuumRadius: s.vacuumRadius,
    armor: s.armor,
    movementSpeed: s.movementSpeed,
    activeWeapon: s.activeWeapon?.slug ?? null,
    equipmentSlugs: Array.isArray(s.equipment?.slugs)
      ? [...s.equipment.slugs].sort()
      : [],
  };
}

const enabled = true; //process.env.USE_DB_TESTS === '1';
const maybe = enabled ? it : it.skip;

// Real player UUID provided by user
const REAL_PLAYER_ID = 'f1b418aa-e2f2-4c41-9f86-a3d0508e1377';

describe('DB-backed: real player snapshot consistency (optional)', () => {
  beforeAll(() => {
    if (!enabled) {
      // eslint-disable-next-line no-console
      console.warn(
        '\n[stats-db-player.spec] Skipping DB test. Set USE_DB_TESTS=1 and provide SUPABASE/DATABASE env vars to enable.\n'
      );
    }
    jest.setTimeout(30000);
  });

  maybe(
    'server equipment snapshot matches server/client derived stats',
    async () => {
      const state = await getPlayerEquipmentState(REAL_PLAYER_ID);

      // Server base stats from equipment snapshot
      const serverBase = getServerStats(state.characterId, {
        equippedWearablesWithQuality: state.equippedWearablesWithQuality,
      });

      console.log('serverBase:', serverBase);

      // Client base stats from same snapshot
      const clientBase = getClientStats(state.characterId, {
        equippedWearablesWithQuality: state.equippedWearablesWithQuality,
      });

      console.log('clientBase:', clientBase);

      // Derived in equipment state is computed via server getCharacterStats with overrides
      const fromDerived = state.derivedStats;

      console.log('fromDerived:', fromDerived);

      expect(sanitizeStats(serverBase)).toEqual(sanitizeStats(fromDerived));
      expect(sanitizeStats(clientBase)).toEqual(sanitizeStats(fromDerived));
    }
  );
});
