export function computeHealthPotionHeal(maxHp: number): number {
  const base = 50;
  const percent = Math.floor(Math.max(0, maxHp) * 0.2);
  return Math.max(base, percent);
}

export function computeManaPotionRestore(maxMana: number): number {
  const base = 50;
  const percent = Math.floor(Math.max(0, maxMana) * 0.2);
  return Math.max(base, percent);
}
