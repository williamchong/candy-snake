import { describe, expect, it } from 'vitest';

import { BROWN, colorInfo, primariesOf } from './colors';
import { MIXING_STAGE, rollOrder, type StageConfig } from './orders';
import { createRng } from './rng';
import { RAW, type ColorMask } from './types';

const stageWith = (mix: StageConfig['mix']): StageConfig => ({ ...MIXING_STAGE, mix });

/** A run of orders from one seed — deterministic, so any assertion is stable. */
const roll = (mix: StageConfig['mix'], count = 500, seed = 7): ColorMask[] => {
  const rng = createRng(seed);
  const stage = stageWith(mix);
  return Array.from({ length: count }, () => rollOrder(stage, rng));
};

describe('rollOrder', () => {
  it('asks only for raw when the stage is all tier 1', () => {
    expect(new Set(roll([100, 0, 0]))).toEqual(new Set([RAW]));
  });

  it('asks only for single-dye colors when the stage is all tier 2', () => {
    for (const order of roll([0, 100, 0])) {
      expect(colorInfo(order).tier).toBe(2);
      expect(primariesOf(order)).toHaveLength(1);
    }
  });

  it('asks only for mixes when the stage is all tier 3', () => {
    for (const order of roll([0, 0, 100])) {
      expect(colorInfo(order).tier).toBe(3);
      expect(primariesOf(order)).toHaveLength(2);
    }
  });

  it('never asks for brown — the over-mix is a mistake, not an order', () => {
    expect(roll(MIXING_STAGE.mix, 2_000)).not.toContain(BROWN);
  });

  it('reaches every color in a weighted tier', () => {
    expect(new Set(roll([0, 100, 0], 200)).size).toBe(3);
    expect(new Set(roll([0, 0, 100], 200)).size).toBe(3);
  });

  it('splits orders across tiers roughly by weight', () => {
    const orders = roll([10, 50, 40], 2_000);
    const share = (tier: number): number =>
      orders.filter((order) => colorInfo(order).tier === tier).length / orders.length;

    expect(share(1)).toBeCloseTo(0.1, 1);
    expect(share(2)).toBeCloseTo(0.5, 1);
    expect(share(3)).toBeCloseTo(0.4, 1);
  });
});
