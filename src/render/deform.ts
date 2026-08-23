import { ROPE_NEAR, TEXTURE_SIZE } from './textures';

/**
 * How a piece of the strand is scaled while it is being drawn out. A candy
 * snake is pulled sugar: the maker hauls on it and it goes thin, which is the
 * same fact about the material that `melt.ts` shades the seams for (design §2).
 *
 * Every piece is authored running east–west, turned by whole right angles, and
 * laid along the way its segment travels (`strand.ts`) — and a sprite's scale
 * is applied after its rotation, so the sprite's own x is along the rope
 * whichever way the rope runs on the board. There is one direction to be drawn
 * out in, and every piece here has it.
 *
 * Pure by design, like `strand.ts` and `melt.ts` beside it: this is invented
 * arithmetic, which is the kind of thing that is wrong in a way a screenshot
 * does not show, so it is kept where Node can test it (architecture §11).
 */

/**
 * How far a piece stretches at the height of a move, as a fraction of its own
 * length. Small on purpose: the sprites are nearest-neighbour sampled and drawn
 * at whole pixels (`pixelArt`), so a stretch large enough to shift a texel row
 * makes the rope's soft edge crawl. This is the first number to come down if it
 * ever does.
 */
const PULL_PEAK = 0.06;

/**
 * How much of what a piece gains in length it gives up in width. Under 1, so
 * the rope does not conserve its area exactly — sugar being pulled is not
 * incompressible, and a piece that thinned as fast as it stretched would show
 * the floor through the strand.
 */
const PULL_NARROW = 0.6;

/**
 * How many segments back from the maker the pull is still felt. The maker is
 * the one doing the pulling, so the sugar nearest it is drawn thinnest and the
 * far end of the strand hangs slack — which is the fiction, and also what keeps
 * the effect local the way design §2 asks every effect here to be.
 */
const PULL_REACH = 6;

/**
 * How hard a piece is being drawn out: nothing at either end of a move, most of
 * the way across it, fading away down the strand from the maker.
 *
 * The zero at both ends is the whole reason this is a sine rather than a ramp.
 * The core moves in whole cells five times a second, and a stretch that were
 * still part-way applied when the move ticked over would snap back on the frame
 * the sprites are retargeted — a strobe at 5 Hz, which design §2 names as
 * genuinely painful rather than merely ugly.
 */
export const pullAmount = (progress: number, fromHead: number): number => {
  const reach = Math.max(0, 1 - fromHead / PULL_REACH);
  return PULL_PEAK * Math.sin(Math.PI * progress) * reach;
};

/**
 * How long the strand shows a cube being taken into it. Under the fastest move
 * the ramp ever reaches — 125 ms/cell (design §7) — so it is over before the
 * segment it is playing on can become a different one, the same deadline the
 * head's dye flash is held to.
 */
export const SWALLOW_MS = 120;

/**
 * How far the strand swells where a cube went in. Across the rope only, and
 * that is a rule rather than a taste: the classic squash is fat *and short*,
 * but a rope piece drawn shorter than its cell opens a gap at the joint with
 * the segment ahead of it — see `deformX`. Extra sugar making the strand
 * momentarily fatter is the truer reading anyway. It is also the exact
 * complement of the pull, which is the same material going thin.
 */
const SWALLOW_BULGE = 0.2;

/**
 * The swallow, full the moment the cube lands and gone once it has settled.
 * Squared, so the strand takes the cube in with a snap and lets go slowly
 * rather than easing symmetrically in and out of it.
 */
export const swallowAmount = (remainingMs: number): number => {
  if (remainingMs <= 0) return 0;

  const left = Math.min(remainingMs / SWALLOW_MS, 1);
  return left * left;
};

/**
 * The scale a piece takes along the sprite's own x, as a multiple of resting.
 * The pull only ever lengthens: a rope piece drawn shorter than its cell opens
 * a gap at the joint with its neighbour, and a strand with gaps in it is the
 * row of beads the continuous rope exists to replace. That is why the swallow
 * is not an argument here — it swells the rope across and nowhere else.
 */
export const deformX = (pull: number): number => 1 + pull;

/**
 * How long a rope piece is drawn along itself at rest, as a multiple of its
 * cell. Every piece lies along the way it travels (`strand.ts`), so at a bend
 * two of them cross at the corner cell rather than one elbow covering it — and
 * a bar that stopped exactly at its cell edge would stop a flank's width short
 * of the bar it crosses, leaving a hairline of floor at the outside of the turn
 * on the frames either end of a move. Read off the rope's own inset rather than
 * written as a number: re-author the rope a pixel wider and an overlap written
 * out here would be wrong with nothing to catch it.
 */
export const JOINT_OVERLAP = 1 + (2 * ROPE_NEAR) / TEXTURE_SIZE;

/**
 * The scale across the rope. One answer for every piece, so each is exactly as
 * wide as the one it meets — which is what keeps the silhouette from stepping
 * where the rope bends.
 */
export const deformY = (pull: number, swallow: number): number =>
  (1 - pull * PULL_NARROW) * (1 + SWALLOW_BULGE * swallow);
