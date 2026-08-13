import { describe, expect, it } from 'vitest';

import { createRng } from './rng';

const take = (count: number, next: () => number): number[] =>
  Array.from({ length: count }, () => next());

describe('rng', () => {
  it('replays an identical sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);

    expect(take(20, b.next)).toEqual(take(20, a.next));
  });

  it('produces different sequences for different seeds', () => {
    expect(take(20, createRng(1).next)).not.toEqual(take(20, createRng(2).next));
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);

    for (const value of take(500, rng.next)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('bounds int() to [0, maxExclusive)', () => {
    const rng = createRng(11);

    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(16);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(16);
    }
  });

  it('returns 0 for an empty range instead of NaN', () => {
    expect(createRng(3).int(0)).toBe(0);
  });
});
