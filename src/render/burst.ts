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

/**
 * What to hand `camera.shake` so a knock is at most `pixels` on either edge of
 * the screen.
 *
 * Phaser's intensity is a *fraction* of the camera's width and height, not a
 * distance (`cameras/2d/effects/Shake.js`), so one number knocks a desktop
 * several times harder than a phone. Design §2 makes comfort a constraint
 * rather than a polish item, and a constraint you cannot state in pixels is one
 * you cannot hold — so the budget is spent in pixels here and converted against
 * the longer edge, which is the one that would overspend it.
 */
export const knockIntensity = (pixels: number, width: number, height: number): number =>
  pixels / Math.max(width, height, 1);

/** Straight up, which is where a fountain is aimed before it is spread. */
const UP = -Math.PI / 2;

/**
 * How wide the cone is. Well under a half turn, so nothing is ever thrown
 * downward however the fan is nudged — confetti that rained would read as the
 * thing coming apart rather than as a send-off.
 */
const FOUNTAIN_SPREAD = Math.PI * 0.7;

/** How far the short throws go, against the long ones' full reach. */
const FOUNTAIN_NEAR = 0.6;

/**
 * How far the whole fan is nudged from one cheer to the next, as a fraction of
 * the cone. A fraction of the *cone* rather than of the gap between pieces, so
 * that a cheer of one piece is still thrown up rather than swung out to the
 * cone's edge — the gap between pieces is the whole cone when there is only one.
 */
const FOUNTAIN_DRIFT = 0.08;

/**
 * Pieces thrown up and out, alternately near and far. The alternation is what
 * stops a fountain reading as a ring with its bottom cut off: an even arc of
 * pieces is a shape, and a handful of confetti is not supposed to be one.
 */
export const fountain: Flinger = (count, turn) => {
  const swing = FOUNTAIN_SPREAD * FOUNTAIN_DRIFT;
  const drift = ((((GOLDEN_TURN * turn) % swing) + swing) % swing) - swing / 2;

  return Array.from({ length: count }, (_piece, index) => {
    const across = count === 1 ? 0.5 : index / (count - 1);
    const angle = UP + (across - 0.5) * FOUNTAIN_SPREAD + drift;
    const reach = index % 2 === 0 ? 1 : FOUNTAIN_NEAR;

    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
  });
};
