/**
 * Where a burst throws its pieces.
 *
 * Pure by design, like `strand.ts` and `melt.ts` beside it: this is invented
 * arithmetic over an angle, which is the kind of thing that is wrong in a way a
 * screenshot does not show, so it is kept where Node can test it
 * (architecture §11). `effects.ts` owns the sprites that fly along it.
 *
 * Nothing here is random. `core/rng.ts` holds the only randomness in this game
 * and it is seeded because the core has to be replayable (architecture §2) — so
 * a burst is *turned* from the one before it rather than scattered, which buys
 * the same "no two look alike" for none of the cost.
 */

/** One piece's direction, as a unit offset from where the burst was fired. */
export interface Fling {
  readonly x: number;
  readonly y: number;
}

/**
 * Throws `count` pieces. `turn` is how many bursts have gone before this one,
 * so a pattern can face each one differently without holding any state itself.
 */
export type Flinger = (count: number, turn: number) => readonly Fling[];

const FULL_TURN = Math.PI * 2;

/**
 * How far each burst is turned from the one before it. The golden angle, which
 * is the turn that goes longest without landing near a spoke it has already
 * used — so two candies chopped off the same bench in quick succession never
 * stamp the same star, and the pop reads as sugar rather than as a sprite.
 */
const GOLDEN_TURN = Math.PI * (3 - Math.sqrt(5));

/** Pieces thrown evenly around the circle: something coming apart in place. */
export const ring: Flinger = (count, turn) =>
  Array.from({ length: count }, (_piece, index) => {
    const angle = GOLDEN_TURN * turn + (FULL_TURN * index) / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
