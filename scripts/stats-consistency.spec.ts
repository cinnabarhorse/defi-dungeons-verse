import { getCharacterStats as getServerStats } from '../apps/server/src/data/characters';
import { getCharacterStats as getClientStats } from '../apps/client/src/lib/character-registry';

function sanitize(s: any) {
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

describe('Client vs Server getCharacterStats consistency', () => {
  it('matches for default character with default equipment', () => {
    const characterId = 'coderdan';
    const server = getServerStats(characterId);
    const client = getClientStats(characterId);
    expect(sanitize(client)).toEqual(sanitize(server));
  });

  it('matches for explicit wearable loadout with quality', () => {
    const characterId = 'wizard';
    const equippedWearablesWithQuality = [
      { slot: 'head' as const, slug: 'common-wizard-hat', quality: 'common' as any },
      { slot: 'handRight' as const, slug: 'common-wizard-staff', quality: 'common' as any },
      { slot: 'eyes' as const, slug: 'wizard-visor', quality: 'common' as any },
    ];

    const server = getServerStats(characterId, {
      equippedWearablesWithQuality,
    });
    const client = getClientStats(characterId, {
      equippedWearablesWithQuality,
    });

    expect(sanitize(client)).toEqual(sanitize(server));
  });
});
