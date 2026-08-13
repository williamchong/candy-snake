import { describe, expect, it } from 'vitest';

import { BLUE, RED, YELLOW } from './colors';
import { SHELF_SLOTS, pushCandy } from './shelf';
import { RAW, type Candy, type ColorMask } from './types';

const candy = (color: ColorMask, bornAt = 0): Candy => ({ color, bornAt });

/** A shelf filled in a known order, so eviction has an obvious victim. */
const full = (): Candy[] =>
  Array.from({ length: SHELF_SLOTS }, (_unused, slot) => candy(RED, slot));

describe('shelf', () => {
  it('racks candies in the order they were made', () => {
    const { shelf } = pushCandy(pushCandy([], candy(RED, 1)).shelf, candy(BLUE, 2));

    expect(shelf).toEqual([candy(RED, 1), candy(BLUE, 2)]);
  });

  it('holds six without letting anything go stale', () => {
    const { shelf, staled } = pushCandy(full().slice(0, SHELF_SLOTS - 1), candy(RAW, 9));

    expect(shelf).toHaveLength(SHELF_SLOTS);
    expect(staled).toBeUndefined();
  });

  it('pushes the oldest off a full shelf and reports it', () => {
    const { shelf, staled } = pushCandy(full(), candy(YELLOW, 9));

    expect(staled).toEqual(candy(RED, 0));
    expect(shelf).toHaveLength(SHELF_SLOTS);
    expect(shelf.at(-1)).toEqual(candy(YELLOW, 9));
    // The rest shuffled down a slot rather than being reordered.
    expect(shelf.map((stocked) => stocked.bornAt)).toEqual([1, 2, 3, 4, 5, 9]);
  });

  it('leaves the shelf it was handed alone', () => {
    const stocked = full();

    pushCandy(stocked, candy(YELLOW, 9));

    expect(stocked).toEqual(full());
  });
});
