import { StrandPiece, type StrandSprite } from './strand';

/**
 * How a piece of the strand is scaled while it is being drawn out. A candy
 * snake is pulled sugar: the maker hauls on it and it goes thin, which is the
 * same fact about the material that `melt.ts` shades the seams for (design §2).
 *
 * Pure by design, like `strand.ts` and `melt.ts` beside it: this is invented
 * arithmetic with an invariant hiding in it — see `deformX` — which is the kind
 * of thing that is wrong in a way a screenshot does not show, so it is kept
 * where Node can test it (architecture §11).
 */

/**
 * Which way a rope piece can be drawn out, in its *own* frame.
 *
 * Every piece is authored running east–west and turned by whole right angles
 * (`strand.ts`), and a sprite's scale is applied after its rotation — so for
 * anything with two ends facing each other, the sprite's own x is along the
 * rope whichever way the rope actually runs on the board. An elbow is the
 * exception, and the only one: it is being pulled two ways at once.
 */
export const PullShape = {
  Lengthwise: 'lengthwise',
  Elbow: 'elbow',
} as const;
export type PullShape = (typeof PullShape)[keyof typeof PullShape];

export const pullShapeOf = (sprite: StrandSprite): PullShape =>
  sprite.piece === StrandPiece.Corner ? PullShape.Elbow : PullShape.Lengthwise;

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
 * The scale a piece takes along the sprite's own x, as a multiple of resting.
 *
 * **It never goes below 1.** A rope piece drawn shorter than its cell opens a
 * gap at the joint with its neighbour, and a strand with gaps in it is the row
 * of beads the continuous rope exists to replace. An elbow cannot lengthen —
 * it has no single direction to lengthen in — so it takes the across factor on
 * both axes instead, and the shortfall that leaves at the bend is covered by
 * the overhang of the straight piece beside it.
 */
export const deformX = (shape: PullShape, pull: number): number =>
  shape === PullShape.Elbow ? deformY(pull) : 1 + pull;

/**
 * The scale across the rope, which is the same for both shapes — and that is
 * what keeps the silhouette from stepping at a bend, since an elbow and the
 * straight beside it end up exactly as wide as each other.
 */
export const deformY = (pull: number): number => 1 - pull * PULL_NARROW;
