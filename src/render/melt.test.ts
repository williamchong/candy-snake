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

  it('melts a turning piece by its own ends, not by where its neighbours sit', () => {
    // The strand turns here — head south, tail west — but the piece is a bar
    // laid along the way its sugar travels, so it still has two ends and the
    // one nearer the head still leans into whatever is beyond it. That the
    // neighbour ahead is off to one side changes nothing: the two bars cross at
    // the corner cell, so the ends meet there anyway.
    const turning = strandSpriteAt(at(5, 5), at(5, 6), at(4, 5));
    const tints = meltedTints(RAW, turning, RED, YELLOW);

    expect(turning.angle).toBe(0);
    expect(turning.headArm).toBe(Dir.Right);
    expect(tints[CornerIndex.TopRight]).toBe(mixTint(hex(RAW), hex(RED), 0.35));
    expect(tints[CornerIndex.BottomRight]).toBe(mixTint(hex(RAW), hex(RED), 0.35));
    expect(tints[CornerIndex.TopLeft]).toBe(mixTint(hex(RAW), hex(YELLOW), 0.35));
    expect(tints[CornerIndex.BottomLeft]).toBe(mixTint(hex(RAW), hex(YELLOW), 0.35));
  });
});
