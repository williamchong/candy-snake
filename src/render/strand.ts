import { eq, stepCell } from '../core/board';
import { Dir, OPPOSITE, type Vec2 } from '../core/types';

/**
 * Which piece of rope a cell of the strand is drawn as, and which way it is
 * turned. The strand is one continuous pull of sugar rather than a row of
 * beads (design §2), so the pieces have to meet edge to edge at every joint —
 * including while they are sliding, which is most of the time.
 *
 * **Every piece lies along the way its segment is travelling**, never along the
 * way its neighbours happen to sit. That is what makes a turn hold together.
 * A segment is one cell of rope centred `progress` of a cell past the cell it
 * left, so it straddles the bend for only an instant at either end of a move
 * and is a plain straight bar for the whole middle of it. A piece bent to the
 * *destination* is a piece whose bend sits up to a whole cell away from the
 * corner it belongs to — which is what left the rope reading as loose boxes
 * around every turn. Two straight bars crossing at the corner cell draw the
 * same silhouette an elbow would, and draw it in the right place at every
 * point of the slide, because each bar is where its own sugar actually is.
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
   * which has a cap there instead of rope. Both are ends of the travelling
   * bar rather than board headings: at a bend the neighbour ahead lies off to
   * one side, and it is still the leading end of this piece that reaches it.
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
 * Which way a segment is being drawn: it is entering its own cell from wherever
 * the segment behind it stands now, since that is the cell it just left. The
 * loose end has nothing behind it and no memory of what it left, so it takes
 * the heading toward the head instead — the rope it has to meet is that way,
 * and a cap at the other end of that bar is a cap in the right place.
 *
 * A neighbour that is somehow not adjacent falls back the same way rather than
 * throwing — a wrong pixel is a better failure than a dead frame.
 */
const travelOf = (pos: Vec2, towardHead: Vec2, towardTail: Vec2 | undefined): Dir => {
  const toTail = towardTail === undefined ? undefined : headingTo(pos, towardTail);
  if (toTail !== undefined) return OPPOSITE[toTail];

  return headingTo(pos, towardHead) ?? Dir.Right;
};

/**
 * Picks the piece for one body segment from the cells on either side of it:
 * `towardHead` is the segment (or head) ahead of it, `towardTail` the one
 * behind, or undefined when this segment *is* the loose end.
 */
export const strandSpriteAt = (
  pos: Vec2,
  towardHead: Vec2,
  towardTail: Vec2 | undefined,
): StrandSprite => {
  const travel = travelOf(pos, towardHead, towardTail);

  // The cap is authored with its rope leaving east, so the heading the piece
  // travels is exactly the rotation it needs: cap at the trailing end.
  if (towardTail === undefined) {
    return spriteFor(StrandPiece.Tail, DIR_ANGLES[travel], travel, undefined);
  }

  return straightAlong(travel);
};
