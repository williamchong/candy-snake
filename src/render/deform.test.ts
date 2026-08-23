import { describe, expect, it } from 'vitest';

import {
  JOINT_OVERLAP,
  SWALLOW_MS,
  deformX,
  deformY,
  pullAmount,
  swallowAmount,
} from './deform';
import { ROPE_NEAR, TEXTURE_SIZE } from './textures';

/** Where the pull is strongest, so a test can ask for the worst case. */
const HARDEST = pullAmount(0.5, 0);

/** Every pull the strand can actually be under, swept end to end. */
const EVERY_PULL = Array.from({ length: 11 }, (_step, tenth) =>
  Array.from({ length: 9 }, (_back, fromHead) => pullAmount(tenth / 10, fromHead)),
).flat();

describe('pullAmount', () => {
  it('leaves the strand at rest at either end of a move', () => {
    // A stretch still part-way applied when the move ticks over snaps back on
    // the frame the sprites are retargeted — a strobe at 5 Hz (design §2).
    expect(pullAmount(0, 0)).toBe(0);
    expect(pullAmount(1, 0)).toBeCloseTo(0);
  });

  it('pulls hardest part-way across the cell', () => {
    expect(pullAmount(0.5, 0)).toBeGreaterThan(pullAmount(0.1, 0));
    expect(pullAmount(0.5, 0)).toBeGreaterThan(pullAmount(0.9, 0));
  });

  it('fades away down the strand from the maker', () => {
    // The maker does the pulling, so the sugar nearest it is drawn thinnest.
    const felt = [0, 1, 2, 3, 4].map((back) => pullAmount(0.5, back));

    for (const [index, amount] of felt.entries()) {
      const nearer = felt[index - 1];
      if (nearer !== undefined) expect(amount).toBeLessThan(nearer);
    }
  });

  it('leaves the far end of a long strand slack', () => {
    // Keeping the effect to a handful of sprites is design §2's "local" applied
    // to something continuous.
    expect(pullAmount(0.5, 6)).toBe(0);
    expect(pullAmount(0.5, 20)).toBe(0);
  });
});

describe('swallowAmount', () => {
  it('is full the moment the cube lands and gone once it has settled', () => {
    expect(swallowAmount(SWALLOW_MS)).toBe(1);
    expect(swallowAmount(0)).toBe(0);
    expect(swallowAmount(-50)).toBe(0);
  });

  it('lets go slowly rather than easing out of it symmetrically', () => {
    // The strand takes a cube in with a snap; it is the settling that reads.
    expect(swallowAmount(SWALLOW_MS / 2)).toBeLessThan(0.5);
  });

  it('is over inside the fastest move the ramp ever reaches', () => {
    // Otherwise it would still be running when the sprite it is playing on has
    // become a different segment — the deadline the dye flash is held to too.
    expect(SWALLOW_MS).toBeLessThanOrEqual(125);
  });
});

describe('deformX / deformY', () => {
  it('only ever lengthens a piece along the rope, never shortens it', () => {
    // A rope piece drawn shorter than its cell opens a gap at the joint, and a
    // strand with gaps in it is the row of beads the rope exists to replace.
    // The swallow does not appear here at all, which is that rule taken one
    // step further: the swell is across the rope only.
    for (const pull of EVERY_PULL) expect(deformX(pull)).toBeGreaterThanOrEqual(1);
  });

  it('narrows a piece across the rope as it lengthens', () => {
    expect(deformY(HARDEST, 0)).toBeLessThan(1);
    expect(deformY(HARDEST, 0)).toBeLessThan(deformY(pullAmount(0.1, 0), 0));
  });

  it('never thins a piece away to nothing', () => {
    for (const pull of EVERY_PULL) expect(deformY(pull, 0)).toBeGreaterThan(0.5);
  });

  it('overlaps the joint by the width of a flank, so a bend cannot open', () => {
    // A turn is two pieces crossing at the corner cell, and a piece that
    // stopped at its cell edge would stop a flank short of the one it crosses.
    // Asked of the art rather than of a number written here twice: the overlap
    // has to cover the rope's inset, whatever that inset is drawn as.
    expect((JOINT_OVERLAP - 1) / 2).toBeGreaterThanOrEqual(ROPE_NEAR / TEXTURE_SIZE);
  });

  it('swells the strand across where a cube went into it', () => {
    expect(deformY(0, 1)).toBeGreaterThan(1);
    expect(deformX(0)).toBe(1);
  });

  it('lets a piece be pulled and swallow at once', () => {
    // A cube lands on a segment that may well be mid-slide, so the two have to
    // compose rather than one taking the sprite from the other.
    const both = deformY(HARDEST, 1);

    expect(both).toBeLessThan(deformY(0, 1));
    expect(both).toBeGreaterThan(deformY(HARDEST, 0));
  });

  it('leaves a sprite at its resting size when nothing is happening to it', () => {
    expect(deformX(0)).toBe(1);
    expect(deformY(0, 0)).toBe(1);
  });
});
