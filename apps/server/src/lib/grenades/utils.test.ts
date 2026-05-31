import test from 'node:test';
import assert from 'node:assert/strict';
import type { GrenadeWeaponDefinition } from '../../data/weapons';
import { computeGrenadeDamage, clamp01 } from './utils';

const SAMPLE_GRENADE: GrenadeWeaponDefinition = {
  blastRadiusPx: 100,
  damageCenter: 100,
  damageEdge: 20,
  throwSpeedPxPerSec: 800,
  cooldownMs: 1200,
  explodeOnImpact: true,
  fuseMs: 0,
  ammoPerUse: 1,
};

test('clamp01 keeps values within [0,1]', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(0.25), 0.25);
  assert.equal(clamp01(1.5), 1);
});

test('computeGrenadeDamage returns full damage at center', () => {
  const damage = computeGrenadeDamage(0, SAMPLE_GRENADE);
  assert.equal(damage, SAMPLE_GRENADE.damageCenter);
});

test('computeGrenadeDamage returns edge damage at radius', () => {
  const damage = computeGrenadeDamage(SAMPLE_GRENADE.blastRadiusPx, SAMPLE_GRENADE);
  assert.equal(damage, SAMPLE_GRENADE.damageEdge);
});

test('computeGrenadeDamage interpolates linearly inside radius', () => {
  const midDistance = SAMPLE_GRENADE.blastRadiusPx / 2;
  const damage = computeGrenadeDamage(midDistance, SAMPLE_GRENADE);
  assert.equal(damage, Math.round((SAMPLE_GRENADE.damageCenter + SAMPLE_GRENADE.damageEdge) / 2));
});

test('computeGrenadeDamage clamps damage to zero outside radius', () => {
  const damage = computeGrenadeDamage(SAMPLE_GRENADE.blastRadiusPx * 2, SAMPLE_GRENADE);
  assert.equal(damage, SAMPLE_GRENADE.damageEdge);
});
