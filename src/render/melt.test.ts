import { describe, expect, it } from 'vitest';

import { BLUE, RED, YELLOW, colorInfo } from '../core/colors';
import { Dir, RAW, type ColorMask } from '../core/types';
import { CornerIndex, meltedTints, mixTint } from './melt';
import { StrandPiece, strandSpriteAt, type StrandSprite } from './strand';

const hex = (color: ColorMask): number => colorInfo(color).hex;

const at = (x: number, y: number) => ({ x, y });

/** A straight piece running east–west, head to the east. */
const RUNNING_EAST: StrandSprite = {
  piece: StrandPiece.Straight,
  angle: 0,
  headArm: Dir.Right,
  tailArm: Dir.Left,
};

describe('mixTint', () => {
  it('returns each end at the extremes', () => {
    expect(mixTint(0x102030, 0xa0b0c0, 0)).toBe(0x102030);
    expect(mixTint(0x102030, 0xa0b0c0, 1)).toBe(0xa0b0c0);
  });

  it('mixes each channel independently', () => {
    expect(mixTint(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixTint(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });

  it('leaves a color mixed with itself alone at any amount', () => {
    // The whole melt rests on this: it is what keeps a run of one color as
    // flat as it was before the seams were softened.
    for (const t of [0, 0.35, 0.5, 1]) {
      expect(mixTint(0x4f8fcf, 0x4f8fcf, t)).toBe(0x4f8fcf);
    }
  });
});

describe('meltedTints', () => {
  it('paints a segment flat when both neighbours share its color', () => {
    const tints = meltedTints(RED, RUNNING_EAST, RED, RED);

    expect(tints).toEqual([hex(RED), hex(RED), hex(RED), hex(RED)]);
  });

  it('leaves an end alone when there is no segment beyond it', () => {
    // The head holds no color and the loose end has a cap, so neither melts.
    const tints = meltedTints(RED, RUNNING_EAST, undefined, undefined);

    expect(tints).toEqual([hex(RED), hex(RED), hex(RED), hex(RED)]);
  });

  it('pulls only the end that faces a different color', () => {
    const tints = meltedTints(RED, RUNNING_EAST, BLUE, RED);

    // Head is east, so the two eastern corners lean toward blue and the
    // western pair stay red.
    expect(tints[CornerIndex.TopRight]).not.toBe(hex(RED));
    expect(tints[CornerIndex.BottomRight]).toBe(tints[CornerIndex.TopRight]);
    expect(tints[CornerIndex.TopLeft]).toBe(hex(RED));
    expect(tints[CornerIndex.BottomLeft]).toBe(hex(RED));
  });

  it('keeps the melt short of the halfway point', () => {
    // A segment has to still read as its own color, so its end must stay
    // nearer its own hue than its neighbour's (design §4).
    const tints = meltedTints(RAW, RUNNING_EAST, BLUE, RAW);
    const end = tints[CornerIndex.TopRight];

    expect(end).not.toBe(hex(RAW));
    expect(end).toBe(mixTint(hex(RAW), hex(BLUE), 0.35));
  });

  it('leans both sides of a seam equally, so they nearly meet', () => {
    const redSide = meltedTints(RED, RUNNING_EAST, BLUE, RED);
    // The blue segment ahead sees red behind it — its own tail arm points west.
    const blueSide = meltedTints(BLUE, RUNNING_EAST, BLUE, RED);

    expect(redSide[CornerIndex.TopRight]).toBe(mixTint(hex(RED), hex(BLUE), 0.35));
    expect(blueSide[CornerIndex.TopLeft]).toBe(mixTint(hex(BLUE), hex(RED), 0.35));
  });

  it('carries both colors into the vertex where an elbow bends', () => {
    // Head east, tail south: the authored corner piece, unrotated.
    const elbow = strandSpriteAt(at(5, 5), at(6, 5), at(5, 6));
    const tints = meltedTints(RAW, elbow, RED, YELLOW);

    // The inner vertex is on both arms, so it takes the mean of the two.
    expect(tints[CornerIndex.BottomRight]).toBe(
      mixTint(hex(RAW), mixTint(hex(RED), hex(YELLOW), 0.5), 0.35),
    );
    // The vertex on neither arm is untouched.
    expect(tints[CornerIndex.TopLeft]).toBe(hex(RAW));
    // And one on a single arm takes only that arm's color.
    expect(tints[CornerIndex.TopRight]).toBe(mixTint(hex(RAW), hex(RED), 0.35));
    expect(tints[CornerIndex.BottomLeft]).toBe(mixTint(hex(RAW), hex(YELLOW), 0.35));
  });

  it("melts a turned piece by its own corners rather than the board's", () => {
    // Same shape as the elbow above but rotated a quarter turn: head south,
    // tail west. The arms land on the authored east and south edges again, so
    // the tints come out identical — the gradient turns with the sprite.
    const turned = strandSpriteAt(at(5, 5), at(5, 6), at(4, 5));
    const tints = meltedTints(RAW, turned, RED, YELLOW);

    expect(turned.angle).toBe(90);
    expect(tints[CornerIndex.BottomRight]).toBe(
      mixTint(hex(RAW), mixTint(hex(RED), hex(YELLOW), 0.5), 0.35),
    );
    expect(tints[CornerIndex.TopLeft]).toBe(hex(RAW));
  });
});
