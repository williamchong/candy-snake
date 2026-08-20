import { eq, stepCell } from '../core/board';
import { Dir, OPPOSITE, type Vec2 } from '../core/types';

/**
 * Which piece of rope a cell of the strand is drawn as. The strand is one
 * continuous pull of sugar rather than a row of beads (design §2), so each
 * segment has to know how its neighbours sit around it: a bead can be one
 * sprite, a rope cannot.
 *
 * Pieces are authored in a single orientation each and rotated by whole right
 * angles. That works because the rope's soft edge runs along both flanks
 * equally rather than favouring one side, so a turned piece is indistinguishable
 * from one drawn that way — one pixel map per piece instead of four.
 *
 * Pure by design: no Phaser here, so the geometry is unit-tested in Node like
 * the core is (architecture §11). `textures.ts` owns which texture each piece
 * maps to.
 */
export const StrandPiece = {
  /** Rope entering one edge and leaving the opposite one. */
  Straight: 'straight',
  /** Rope turning a right angle. */
  Corner: 'corner',
  /** The loose end: rope on one edge, rounded cap on the other. */
  Tail: 'tail',
} as const;
export type StrandPiece = (typeof StrandPiece)[keyof typeof StrandPiece];

export interface StrandSprite {
  readonly piece: StrandPiece;
  /**
   * Degrees clockwise. Always a multiple of 90, so nearest-neighbour sampling
   * stays exact and the rope never picks up resampling fuzz.
   */
  readonly angle: number;
  /**
   * Which edge of the *authored* piece the rope leaves by on its way to the
   * head, and on its way to the tail — the second undefined for the loose end,
   * which has a cap there instead of rope.
   *
   * Named in the piece's own frame rather than the board's because that is the
   * frame a renderer paints in: a sprite's corners turn with it, so a caller
   * that wants one end of the rope to melt into the color beyond it needs to
   * know which corners that end owns *after* `angle` has been applied.
   */
  readonly headArm: Dir;
  readonly tailArm: Dir | undefined;
}

/**
 * Headings as clockwise degrees from east, which is the orientation every rope
 * piece is authored in. Screen y grows downward, so clockwise runs
 * east → south → west → north and a heading doubles as its own rotation.
 */
const DIR_ANGLES: Record<Dir, number> = {
  [Dir.Right]: 0,
  [Dir.Down]: 90,
  [Dir.Left]: 180,
  [Dir.Up]: 270,
};

const FULL_TURN = 360;

const DIRS = Object.values(Dir);

/**
 * A board heading read in the frame of a piece turned by `angle` — the inverse
 * of the rotation the renderer is about to apply. Every piece is authored in
 * one orientation, so this is what turns "the head is north of me" into "the
 * rope leaves by the edge that was drawn as east".
 *
 * Searched out of `DIR_ANGLES` rather than read from a second table written the
 * other way round, so the two can never drift apart. Every angle passed in is a
 * multiple of a right angle, so the search always lands; the fallback is there
 * for the type-checker, not for a case that happens.
 */
const localSide = (heading: Dir, angle: number): Dir => {
  const turned = (DIR_ANGLES[heading] - angle + FULL_TURN) % FULL_TURN;

  return DIRS.find((dir) => DIR_ANGLES[dir] === turned) ?? Dir.Right;
};

/**
 * Every piece is built the same way once its rotation is known: the arms are
 * whatever the two headings become in the frame that rotation puts them in.
 */
const spriteFor = (
  piece: StrandPiece,
  angle: number,
  toHead: Dir,
  toTail: Dir | undefined,
): StrandSprite => ({
  piece,
  angle,
  headArm: localSide(toHead, angle),
  tailArm: toTail === undefined ? undefined : localSide(toTail, angle),
});

/**
 * The next heading clockwise. The corner piece is authored connecting east and
 * south — a heading and its clockwise neighbour — so this is the test for which
 * of a turn's two headings the authored piece should be rotated onto.
 */
const CLOCKWISE: Record<Dir, Dir> = {
  [Dir.Right]: Dir.Down,
  [Dir.Down]: Dir.Left,
  [Dir.Left]: Dir.Up,
  [Dir.Up]: Dir.Right,
};

const HALF_TURN = 180;

/**
 * Which way `to` lies from `from`, or undefined when they are not adjacent.
 * Asking the board to take the step keeps the wrap rule in one place, so two
 * cells either side of a service door read as neighbours (design §6).
 */
const headingTo = (from: Vec2, to: Vec2): Dir | undefined =>
  DIRS.find((dir) => eq(stepCell(from, dir), to));

/** A straight piece is authored east–west, so only its axis matters. */
const straightAlong = (heading: Dir): StrandSprite =>
  spriteFor(
    StrandPiece.Straight,
    DIR_ANGLES[heading] % HALF_TURN,
    heading,
    OPPOSITE[heading],
  );

/**
 * Picks the piece for one body segment from the cells on either side of it:
 * `towardHead` is the segment (or head) ahead of it, `towardTail` the one
 * behind, or undefined when this segment *is* the loose end.
 *
 * A neighbour that is somehow not adjacent falls back to a straight piece
 * rather than throwing — a wrong pixel is a better failure than a dead frame.
 */
export const strandSpriteAt = (
  pos: Vec2,
  towardHead: Vec2,
  towardTail: Vec2 | undefined,
): StrandSprite => {
  const toHead = headingTo(pos, towardHead);
  if (toHead === undefined) return straightAlong(Dir.Right);

  // The cap is authored with its rope leaving east, so the heading it points
  // is exactly the rotation it needs.
  if (towardTail === undefined) {
    return spriteFor(StrandPiece.Tail, DIR_ANGLES[toHead], toHead, undefined);
  }

  const toTail = headingTo(pos, towardTail);
  if (toTail === undefined || toTail === OPPOSITE[toHead]) return straightAlong(toHead);

  // Of the turn's two headings, the authored piece belongs on whichever one the
  // other follows clockwise.
  const outer = CLOCKWISE[toHead] === toTail ? toHead : toTail;
  return spriteFor(StrandPiece.Corner, DIR_ANGLES[outer], toHead, toTail);
};
