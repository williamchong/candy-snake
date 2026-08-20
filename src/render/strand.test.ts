import { describe, expect, it } from 'vitest';

import { Dir } from '../core/types';
import { StrandPiece, strandSpriteAt } from './strand';

const at = (x: number, y: number) => ({ x, y });

describe('strandSpriteAt', () => {
  it('draws a straight piece where the strand runs through', () => {
    expect(strandSpriteAt(at(5, 5), at(6, 5), at(4, 5))).toEqual({
      piece: StrandPiece.Straight,
      angle: 0,
      headArm: Dir.Right,
      tailArm: Dir.Left,
    });
    // Authored east–west and turned a quarter, so the arm pointing north on the
    // board is the one drawn to the west.
    expect(strandSpriteAt(at(5, 5), at(5, 4), at(5, 6))).toEqual({
      piece: StrandPiece.Straight,
      angle: 90,
      headArm: Dir.Left,
      tailArm: Dir.Right,
    });
  });

  it('turns the corner piece to each of the four elbows', () => {
    const elbows = [
      { head: at(6, 5), tail: at(5, 6), angle: 0 }, // east + south, as authored
      { head: at(5, 6), tail: at(4, 5), angle: 90 }, // south + west
      { head: at(4, 5), tail: at(5, 4), angle: 180 }, // west + north
      { head: at(5, 4), tail: at(6, 5), angle: 270 }, // north + east
    ];

    for (const { head, tail, angle } of elbows) {
      // Every one of these turns clockwise from head to tail, which is how the
      // piece is authored — so each lands on the drawn arms unrotated.
      expect(strandSpriteAt(at(5, 5), head, tail)).toEqual({
        piece: StrandPiece.Corner,
        angle,
        headArm: Dir.Right,
        tailArm: Dir.Down,
      });
    }
  });

  it('draws the same elbow whichever side the head is on', () => {
    // Which neighbour leads and which trails changes nothing about the shape
    // the rope makes through the cell — only about which of its two arms is
    // the head end, which is why the arms swap where the angle does not.
    for (const elbow of [
      [at(6, 5), at(5, 6)],
      [at(5, 6), at(4, 5)],
      [at(4, 5), at(5, 4)],
      [at(5, 4), at(6, 5)],
    ] as const) {
      const [first, second] = elbow;
      const led = strandSpriteAt(at(5, 5), first, second);
      const trailed = strandSpriteAt(at(5, 5), second, first);

      expect(trailed.piece).toBe(led.piece);
      expect(trailed.angle).toBe(led.angle);
      expect(trailed.headArm).toBe(led.tailArm);
      expect(trailed.tailArm).toBe(led.headArm);
    }
  });

  it('caps the loose end, pointing its rope at the segment ahead', () => {
    const caps = [
      { head: at(6, 5), angle: 0 },
      { head: at(5, 6), angle: 90 },
      { head: at(4, 5), angle: 180 },
      { head: at(5, 4), angle: 270 },
    ];

    for (const { head, angle } of caps) {
      // The cap is authored with its rope leaving east and rotated onto the
      // heading, so its one arm is always the drawn piece's east one.
      expect(strandSpriteAt(at(5, 5), head, undefined)).toEqual({
        piece: StrandPiece.Tail,
        angle,
        headArm: Dir.Right,
        tailArm: undefined,
      });
    }
  });

  it('reads cells either side of a service door as neighbours', () => {
    // The board wraps (design §6), so the strand stays unbroken across it.
    const cap = (angle: number) => ({
      piece: StrandPiece.Tail,
      angle,
      headArm: Dir.Right,
      tailArm: undefined,
    });

    expect(strandSpriteAt(at(15, 5), at(0, 5), undefined)).toEqual(cap(0));
    expect(strandSpriteAt(at(0, 5), at(15, 5), undefined)).toEqual(cap(180));
    expect(strandSpriteAt(at(5, 0), at(5, 15), undefined)).toEqual(cap(270));
    expect(strandSpriteAt(at(5, 15), at(5, 0), undefined)).toEqual(cap(90));
  });

  it('runs a wrapped strand straight through rather than kinking it', () => {
    expect(strandSpriteAt(at(15, 5), at(0, 5), at(14, 5))).toEqual({
      piece: StrandPiece.Straight,
      angle: 0,
      headArm: Dir.Right,
      tailArm: Dir.Left,
    });
  });

  it('falls back to a straight piece when a neighbour is not adjacent', () => {
    // Can't happen — the body retraces the head's path — but a wrong pixel
    // beats a thrown frame.
    expect(strandSpriteAt(at(5, 5), at(9, 9), at(4, 5))).toEqual({
      piece: StrandPiece.Straight,
      angle: 0,
      headArm: Dir.Right,
      tailArm: Dir.Left,
    });
    expect(strandSpriteAt(at(5, 5), at(5, 4), at(9, 9))).toEqual({
      piece: StrandPiece.Straight,
      angle: 90,
      headArm: Dir.Left,
      tailArm: Dir.Right,
    });
  });
});
