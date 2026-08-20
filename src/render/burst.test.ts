import { describe, expect, it } from 'vitest';

import { ring, type Fling } from './burst';

const FULL_TURN = Math.PI * 2;

/** How far from the centre a fling points, which every pattern draws on. */
const length = ({ x, y }: Fling): number => Math.hypot(x, y);

/** Where a fling points, as a turn east-about — `atan2`'s wrap taken out. */
const bearing = ({ x, y }: Fling): number => (Math.atan2(y, x) + FULL_TURN) % FULL_TURN;

/** The gaps between successive pieces, likewise east-about. */
const gaps = (pieces: readonly Fling[]): number[] =>
  pieces
    .map(bearing)
    .map((angle, index, all) => {
      const previous = all[index - 1];
      return previous === undefined
        ? undefined
        : (angle - previous + FULL_TURN) % FULL_TURN;
    })
    .filter((gap): gap is number => gap !== undefined);

/** The first piece of a burst, or a failure that names itself. */
const first = (pieces: readonly Fling[]): Fling => {
  const piece = pieces[0];
  if (piece === undefined) throw new Error('the burst threw nothing');
  return piece;
};

describe('ring', () => {
  it('throws every piece the same distance', () => {
    for (const fling of ring(6, 0)) expect(length(fling)).toBeCloseTo(1);
  });

  it('spreads its pieces evenly around the circle', () => {
    for (const gap of gaps(ring(6, 0))) expect(gap).toBeCloseTo(FULL_TURN / 6);
  });

  it('pulls evenly enough that a burst has no side to it', () => {
    // Nothing should drift: a ring that leans is a burst that reads as a throw,
    // and design §2 wants the pop local to the cell it happened on.
    const drift = ring(8, 3).reduce(
      (total, fling) => ({ x: total.x + fling.x, y: total.y + fling.y }),
      { x: 0, y: 0 },
    );

    expect(length(drift)).toBeCloseTo(0);
  });

  it('does not stamp the same star twice running', () => {
    // Two candies off the same bench in quick succession is the ordinary case,
    // and an identical burst on both reads as a sprite rather than as sugar.
    expect(bearing(first(ring(5, 1)))).not.toBeCloseTo(bearing(first(ring(5, 0))));
  });

  it('turns by the same angle every time, so nothing here is random', () => {
    // `core/rng.ts` owns the only randomness in this game (architecture §2), so
    // the view's own patterns have to be a function of how many have gone by.
    expect(ring(4, 7)).toStrictEqual(ring(4, 7));
  });

  it('throws nothing when a burst has no pieces to throw', () => {
    expect(ring(0, 0)).toStrictEqual([]);
  });
});
