import type { Candy } from './types';

/** The candy cache holds six; the seventh pushes the oldest off (design §5). */
export const SHELF_SLOTS = 6;

/**
 * Puts a candy on the shelf, oldest first, and reports the one that had to go
 * stale to make room. Returns a new array rather than mutating, leaving `Game`
 * the only writer of state (architecture §2).
 *
 * Phase 4 adds order matching here — a candy only reaches the shelf once no
 * waiting customer wants it.
 */
export const pushCandy = (
  shelf: readonly Candy[],
  candy: Candy,
): { shelf: Candy[]; staled: Candy | undefined } => {
  const stocked = [...shelf, candy];
  const staled = stocked.length > SHELF_SLOTS ? stocked.shift() : undefined;

  return { shelf: stocked, staled };
};
