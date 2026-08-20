import { colorInfo } from '../core/colors';
import { Dir, type ColorMask } from '../core/types';
import type { StrandSprite } from './strand';

/**
 * How a segment of strand is shaded so that a color change along it reads as a
 * melt rather than a cut. A candy snake is pulled sugar, not a string of beads:
 * where two colors meet the sugar was stretched through the change (design §2).
 *
 * Pure by design, like `strand.ts` beside it: this is invented arithmetic over
 * an index table, which is the kind of thing that is wrong in a way a
 * screenshot does not show, so it is kept where Node can test it
 * (architecture §11).
 */

/**
 * One tint per corner of a sprite's quad, in the order Phaser's four-argument
 * `setTint` takes them. The corners belong to the sprite rather than the
 * screen, so they turn with it — which is why a piece authored in one
 * orientation carries its gradient around with its rotation.
 */
export type CornerTints = readonly [number, number, number, number];

/** Named so the tables below cannot silently disagree about which is which. */
export const CornerIndex = {
  TopLeft: 0,
  TopRight: 1,
  BottomLeft: 2,
  BottomRight: 3,
} as const;

/**
 * Blends two packed 0xRRGGBB tints channel by channel: `t` of 0 gives `from`,
 * 1 gives `to`. Hand-rolled rather than taken from `Phaser.Display.Color`
 * because nothing here imports Phaser at all, and one lerp is not worth
 * pulling the runtime in for.
 */
export const mixTint = (from: number, to: number, t: number): number => {
  const channel = (shift: number): number =>
    Math.round(((from >> shift) & 0xff) * (1 - t) + ((to >> shift) & 0xff) * t) << shift;

  return channel(16) | channel(8) | channel(0);
};

/**
 * How far each end of a segment is pulled toward the color of the segment
 * beyond it.
 *
 * Kept well under a half so a segment still reads as its own color: what the
 * player chops by is runs of one color, and a lone segment between two others
 * must not take on their average. It costs nothing where it is not wanted
 * either — mixing a color with itself returns it unchanged, so a run of one
 * color is painted exactly as flatly as before and only a real seam softens.
 */
const STRAND_MELT = 0.35;

/** Two arms meeting at one vertex get equal say in it. */
const EVEN = 0.5;

/**
 * Which vertices of a quad an edge owns. An edge shares each of its corners
 * with the edge it meets there, which is what lets a corner piece carry color
 * around the bend: the vertex where both arms meet takes a little of each.
 */
const SIDE_CORNERS: Record<Dir, readonly [number, number]> = {
  [Dir.Up]: [CornerIndex.TopLeft, CornerIndex.TopRight],
  [Dir.Down]: [CornerIndex.BottomLeft, CornerIndex.BottomRight],
  [Dir.Left]: [CornerIndex.TopLeft, CornerIndex.BottomLeft],
  [Dir.Right]: [CornerIndex.TopRight, CornerIndex.BottomRight],
};

/**
 * Shades one rope piece: each end pulled toward whatever color lies past it,
 * every other corner left as the segment's own. Both segments either side of a
 * seam lean the same amount into each other, so the two halves meet at nearly
 * the same hue and the join stops reading as an edge.
 *
 * A neighbour of `undefined` — the head, which is the maker and holds no color,
 * or the loose end, which has a cap there instead of rope — leaves that end
 * unmelted.
 */
export const meltedTints = (
  own: ColorMask,
  sprite: StrandSprite,
  headward: ColorMask | undefined,
  tailward: ColorMask | undefined,
): CornerTints => {
  const flat = colorInfo(own).hex;
  const arms: { side: Dir; hex: number }[] = [];

  if (headward !== undefined) {
    arms.push({ side: sprite.headArm, hex: colorInfo(headward).hex });
  }
  if (sprite.tailArm !== undefined && tailward !== undefined) {
    arms.push({ side: sprite.tailArm, hex: colorInfo(tailward).hex });
  }

  const corner = (index: number): number => {
    // The arms are averaged before the melt rather than melted one after the
    // other: melting twice would pull a shared vertex in twice as far as the
    // rest of the piece, and would depend on which arm went first.
    let beyond: number | undefined;
    for (const arm of arms) {
      if (!SIDE_CORNERS[arm.side].includes(index)) continue;
      beyond = beyond === undefined ? arm.hex : mixTint(beyond, arm.hex, EVEN);
    }

    return beyond === undefined ? flat : mixTint(flat, beyond, STRAND_MELT);
  };

  return [
    corner(CornerIndex.TopLeft),
    corner(CornerIndex.TopRight),
    corner(CornerIndex.BottomLeft),
    corner(CornerIndex.BottomRight),
  ];
};
