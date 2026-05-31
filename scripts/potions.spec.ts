import {
  computeHealthPotionHeal,
  computeManaPotionRestore,
} from '../apps/server/src/lib/potion-utils';

describe('Potion utils – 20% or 50, whichever is higher', () => {
  test('Health potion: returns 50 when 20% < 50', () => {
    expect(computeHealthPotionHeal(100)).toBe(50); // 20% = 20 < 50
    expect(computeHealthPotionHeal(200)).toBe(50); // 20% = 40 < 50
  });

  test('Health potion: returns 20% when higher than 50', () => {
    expect(computeHealthPotionHeal(400)).toBe(80); // 20% = 80 > 50
    expect(computeHealthPotionHeal(501)).toBe(100); // 20% = 100.2 -> floor 100
  });

  test('Mana potion: returns 50 when 20% < 50', () => {
    expect(computeManaPotionRestore(100)).toBe(50); // 20% = 20 < 50
    expect(computeManaPotionRestore(200)).toBe(50); // 20% = 40 < 50
  });

  test('Mana potion: returns 20% when higher than 50', () => {
    expect(computeManaPotionRestore(400)).toBe(80); // 20% = 80 > 50
    expect(computeManaPotionRestore(501)).toBe(100); // 20% = 100.2 -> floor 100
  });
});
