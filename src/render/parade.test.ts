import { describe, expect, it } from 'vitest';

import { BROWN, colorInfo } from '../core/colors';
import { PARADE, paradePoses, type ParadePose } from './parade';
import { CELL_SIZE, STRAND_TEXTURES, TextureKey } from './textures';
import { StrandPiece } from './strand';

/** A desktop band, and a phone one — the parade is laid out off the width. */
const WIDE = 960;
const NARROW = 320;

/** Every member the strand walks with, which is every one before the child. */
const strandOf = (poses: readonly ParadePose[]): readonly ParadePose[] =>
  poses.slice(
    0,
    PARADE.findIndex((member) => member.key === TextureKey.Customer),
  );

describe('the parade cast', () => {
  it('gives every colored member a symbol to be read by', () => {
    for (const member of PARADE) {
      // Design §4: color is never the only carrier. A member that holds a color
      // and stamps no glyph is a color the colorblind player cannot read.
      expect(member.color === undefined).toBe(member.glyphDepth === undefined);
    }
  });

  it('never walks the mistake color past the front of the shop', () => {
    expect(PARADE.map((member) => member.color)).not.toContain(BROWN);
  });

  it('caps the rope with the tail piece and fills the rest with straights', () => {
    const pieces: readonly TextureKey[] = Object.values(STRAND_TEXTURES);
    const rope = PARADE.map((member) => member.key).filter((key) => pieces.includes(key));

    expect(rope.slice(0, -1)).toEqual(
      rope.slice(0, -1).map(() => STRAND_TEXTURES[StrandPiece.Straight]),
    );
    expect(rope[rope.length - 1]).toBe(STRAND_TEXTURES[StrandPiece.Tail]);
  });

  it('melts each seam toward the color beyond it rather than painting it flat', () => {
    const seams = PARADE.filter((member) => member.corners !== undefined);

    expect(seams).not.toHaveLength(0);
    for (const member of seams) {
      // Every rope cell here has a neighbour of a different color on at least
      // one side, so no cell should come back as four copies of its own hex.
      expect(new Set(member.corners)).not.toEqual(
        new Set([colorInfo(member.color ?? 0).hex]),
      );
    }
  });
});

describe('paradePoses', () => {
  it('answers for the whole cast, in cast order', () => {
    expect(paradePoses(0, WIDE)).toHaveLength(PARADE.length);
  });

  it('is the same parade every time the menu is opened', () => {
    expect(paradePoses(3_000, WIDE)).toEqual(paradePoses(3_000, WIDE));
  });

  it('opens with the strand already walking rather than on an empty band', () => {
    expect(strandOf(paradePoses(0, WIDE)).some((pose) => pose.x > 0)).toBe(true);
  });

  it('keeps the rope in one piece, a cell apart, wherever it is', () => {
    for (const at of [0, 1_500, 4_000, 9_000, 21_000]) {
      const rope = strandOf(paradePoses(at, WIDE));

      for (let cell = 1; cell < rope.length; cell += 1) {
        expect(rope[cell - 1]!.x - rope[cell]!.x).toBeCloseTo(CELL_SIZE);
      }
    }
  });

  it('walks the two the opposite way round, so they pass', () => {
    const [before, after] = [paradePoses(2_000, WIDE), paradePoses(2_100, WIDE)];
    const child = PARADE.findIndex((member) => member.key === TextureKey.Customer);

    expect(after[0]!.x).toBeGreaterThan(before[0]!.x);
    expect(after[child]!.x).toBeLessThan(before[child]!.x);
  });

  it('never jumps a member while it can still be seen', () => {
    // The wrap is the one moment a walker's x is discontinuous. It has to land
    // in the gap between crossings, or the strand teleports in plain sight.
    const step = 40;
    let last = paradePoses(0, NARROW);

    for (let at = step; at < 90_000; at += step) {
      const now = paradePoses(at, NARROW);

      now.forEach((pose, index) => {
        const moved = Math.abs(pose.x - last[index]!.x);
        if (moved > CELL_SIZE) {
          expect(pose.visible || last[index]!.visible).toBe(false);
        }
      });
      last = now;
    }
  });

  it('hides what has walked off the band instead of parking it out there', () => {
    for (const pose of paradePoses(0, NARROW)) {
      expect(pose.visible).toBe(pose.x > -CELL_SIZE && pose.x < NARROW + CELL_SIZE);
    }
  });

  it('gives the rope a wobble, and keeps it under a pixel or two', () => {
    const lanes = new Set<number>();

    for (let at = 0; at < 2_000; at += 50) {
      for (const pose of strandOf(paradePoses(at, WIDE))) lanes.add(pose.y);
    }

    expect(lanes.size).toBeGreaterThan(1);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeLessThanOrEqual(4);
  });

  it('swaps the child onto their other leg as they walk', () => {
    const child = PARADE.findIndex((member) => member.key === TextureKey.Customer);
    const worn = new Set<TextureKey>();

    for (let at = 0; at < 2_000; at += 20) worn.add(paradePoses(at, WIDE)[child]!.key);

    expect(worn).toEqual(new Set([TextureKey.Customer, TextureKey.CustomerStride]));
  });

  it('leaves everything but the child wearing the frame it was built with', () => {
    const poses = paradePoses(700, WIDE);

    poses.forEach((pose, index) => {
      if (PARADE[index]!.key === TextureKey.Customer) return;
      expect(pose.key).toBe(PARADE[index]!.key);
    });
  });
});
