import { describe, expect, it } from 'vitest';

import { BLUE, BROWN, RED, colorInfo, primariesOf } from './colors';
import { MIXING_STAGE, TWIN_CHANCE, rollOrder, type StageConfig } from './orders';
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

describe('rollOrder, echoing the window', () => {
  /**
   * All-raw weights, so the tier roll can only ever produce raw: anything else
   * coming back is an echo, and the share of them is the chance itself rather
   * than the chance plus whatever the mix would have drawn anyway.
   */
  const RAW_ONLY = stageWith([100, 0, 0]);

  const echoes = (
    waiting: readonly ColorMask[],
    chance: number,
    count = 4_000,
  ): number => {
    const rng = createRng(11);
    const orders = Array.from({ length: count }, () =>
      rollOrder(RAW_ONLY, rng, waiting, chance),
    );

    return orders.filter((order) => order !== RAW).length / count;
  };

  it('asks for what the window is already asking for, at the chance given', () => {
    expect(echoes([RED], 0.25)).toBeCloseTo(0.25, 1);
    expect(echoes([RED], 0.6)).toBeCloseTo(0.6, 1);
  });

  it('echoes nothing when nobody is waiting', () => {
    expect(echoes([], 0.6)).toBe(0);
  });

  it('never echoes brown — the mercy customer is the only one who takes it', () => {
    expect(echoes([BROWN], 0.6)).toBe(0);
    // And a brown at the window does not suppress the child beside it.
    expect(echoes([BROWN, RED], 0.6)).toBeCloseTo(0.6, 1);
  });

  it('spreads the echo across everyone waiting rather than the first of them', () => {
    const rng = createRng(3);
    const orders = Array.from({ length: 2_000 }, () =>
      rollOrder(RAW_ONLY, rng, [RED, BLUE], 1),
    );

    expect(orders.filter((order) => order === RED).length / orders.length).toBeCloseTo(
      0.5,
      1,
    );
  });

  it('draws nothing at all when the chance is zero', () => {
    // The property that makes zero a control rather than another arm: a run with
    // the feature off takes the same numbers off the rng as one that never had
    // it, so a sweep either side of it is the same run.
    const off = createRng(5);
    const never = createRng(5);

    expect(
      Array.from({ length: 200 }, () => rollOrder(MIXING_STAGE, off, [RED], 0)),
    ).toEqual(Array.from({ length: 200 }, () => rollOrder(MIXING_STAGE, never)));
  });

  it('leaves the tier shares the difficulty table asked for', () => {
    // The claim `TWIN_CHANCE` is written on: an echo copies a want that was
    // itself drawn from the weights, so the *joint* distribution of the window
    // changes and the marginal one does not. Played out as a window that fills
    // from its own draws, the mix still comes back as the table wrote it.
    const rng = createRng(23);
    const stage = stageWith([10, 50, 40]);
    const orders: ColorMask[] = [];
    let waiting: ColorMask[] = [];

    for (let at = 0; at < 4_000; at += 1) {
      const order = rollOrder(stage, rng, waiting, TWIN_CHANCE);
      orders.push(order);
      waiting = [...waiting, order].slice(-3);
    }

    const share = (tier: number): number =>
      orders.filter((order) => colorInfo(order).tier === tier).length / orders.length;

    expect(share(1)).toBeCloseTo(0.1, 1);
    expect(share(2)).toBeCloseTo(0.5, 1);
    expect(share(3)).toBeCloseTo(0.4, 1);
  });
});
