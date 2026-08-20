import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../core/types';
import { PullShape, deformX, deformY, pullAmount, pullShapeOf } from './deform';
import { strandSpriteAt } from './strand';

const at = (x: number, y: number): Vec2 => ({ x, y });

/** Where the pull is strongest, so a test can ask for the worst case. */
const HARDEST = pullAmount(0.5, 0);

/** Every pull the strand can actually be under, swept end to end. */
const EVERY_PULL = Array.from({ length: 11 }, (_step, tenth) =>
  Array.from({ length: 9 }, (_back, fromHead) => pullAmount(tenth / 10, fromHead)),
).flat();

describe('pullShapeOf', () => {
  it('draws a straight piece out along itself, whichever way it was turned', () => {
    // Every piece is authored east–west and turned by whole right angles, so
    // the sprite's own x is along the rope however the rope runs on the board.
    const eastWest = strandSpriteAt(at(4, 4), at(5, 4), at(3, 4));
    const northSouth = strandSpriteAt(at(4, 4), at(4, 3), at(4, 5));

    expect(pullShapeOf(eastWest)).toBe(PullShape.Lengthwise);
    expect(pullShapeOf(northSouth)).toBe(PullShape.Lengthwise);
  });

  it('draws the loose end out along the rope it hangs off', () => {
    expect(pullShapeOf(strandSpriteAt(at(4, 4), at(5, 4), undefined))).toBe(
      PullShape.Lengthwise,
    );
  });

  it('gives an elbow no length, because it is pulled two ways at once', () => {
    expect(pullShapeOf(strandSpriteAt(at(4, 4), at(5, 4), at(4, 5)))).toBe(
      PullShape.Elbow,
    );
  });
});

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

describe('deformX / deformY', () => {
  it('only ever lengthens a piece along the rope, never shortens it', () => {
    // A rope piece drawn shorter than its cell opens a gap at the joint, and a
    // strand with gaps in it is the row of beads the rope exists to replace.
    for (const pull of EVERY_PULL) {
      expect(deformX(PullShape.Lengthwise, pull)).toBeGreaterThanOrEqual(1);
    }
  });

  it('narrows a piece across the rope as it lengthens', () => {
    expect(deformY(HARDEST)).toBeLessThan(1);
    expect(deformY(HARDEST)).toBeLessThan(deformY(pullAmount(0.1, 0)));
  });

  it('never thins a piece away to nothing', () => {
    for (const pull of EVERY_PULL) expect(deformY(pull)).toBeGreaterThan(0.5);
  });

  it('takes the same off an elbow both ways, so it has no length of its own', () => {
    // Which also leaves it exactly as wide as the straight piece it meets, so
    // the silhouette does not step where the rope bends.
    expect(deformX(PullShape.Elbow, HARDEST)).toBe(deformY(HARDEST));
  });

  it("covers an elbow's shortfall with the overhang of the piece beside it", () => {
    // The straight grows past the cell boundary by more than the elbow's arm
    // retreats from it, so no gap can open at a bend however hard the pull.
    for (const pull of EVERY_PULL) {
      const overhang = (deformX(PullShape.Lengthwise, pull) - 1) / 2;
      const shortfall = (1 - deformX(PullShape.Elbow, pull)) / 2;
      expect(overhang).toBeGreaterThanOrEqual(shortfall);
    }
  });

  it('leaves a sprite at its resting size when nothing is pulling it', () => {
    expect(deformX(PullShape.Lengthwise, 0)).toBe(1);
    expect(deformX(PullShape.Elbow, 0)).toBe(1);
    expect(deformY(0)).toBe(1);
  });
});
