import { describe, expect, it } from 'vitest';

import { BLUE, BROWN, RED, YELLOW } from './colors';
import { createCustomer } from './customers';
import { scoreServe, streakMultiplier } from './scoring';
import { RAW, type ColorMask, type Customer } from './types';

/** A customer with a known fraction of the bar left, so bonuses are exact. */
const served = (want: ColorMask, left = 0): Customer => {
  const customer = createCustomer(1, want, 10_000);
  return { ...customer, patience: { remainingMs: 10_000 * left, totalMs: 10_000 } };
};

describe('scoreServe', () => {
  it('pays by how hard the color was to make', () => {
    expect(scoreServe(served(RAW), 0)).toBe(10);
    expect(scoreServe(served(RED), 0)).toBe(25);
    expect(scoreServe(served(YELLOW), 0)).toBe(25);
    expect(scoreServe(served(RED | BLUE), 0)).toBe(50);
  });

  it('pays the mystery customer for taking an over-mix off your hands', () => {
    expect(scoreServe(served(BROWN), 0)).toBe(40);
  });

  it('adds up to half as much again for a serve made in time', () => {
    expect(scoreServe(served(RED | BLUE, 1), 0)).toBe(75);
    expect(scoreServe(served(RED | BLUE, 0.5), 0)).toBe(63);
    expect(scoreServe(served(RED | BLUE, 0), 0)).toBe(50);
  });

  it('pays a tutorial customer flat — an order with no clock earns no bonus', () => {
    expect(scoreServe(createCustomer(1, RAW, undefined), 0)).toBe(10);
  });

  it('multiplies by the streak already standing, so the first serve pays flat', () => {
    expect(scoreServe(served(RED), 0)).toBe(25);
    expect(scoreServe(served(RED), 1)).toBe(28);
    expect(scoreServe(served(RED), 2)).toBe(30);
  });

  it('rounds once, at the end', () => {
    // 25 × 1.1³ = 33.275 — rounding the multiplier first would pay 33 for a
    // ×1.33, and rounding the base first would lose the fraction entirely.
    expect(scoreServe(served(RED), 3)).toBe(33);
  });
});

describe('streakMultiplier', () => {
  it('starts flat and grows a tenth per consecutive serve', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBeCloseTo(1.1);
    expect(streakMultiplier(5)).toBeCloseTo(1.61);
  });

  it('caps at double, however long the run gets', () => {
    expect(streakMultiplier(7)).toBeCloseTo(1.949);
    expect(streakMultiplier(8)).toBe(2);
    expect(streakMultiplier(500)).toBe(2);
  });
});
