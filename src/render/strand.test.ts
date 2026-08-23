import { describe, expect, it } from 'vitest';

import { Dir, OPPOSITE } from '../core/types';
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

  it('lays a turning segment along the way it is travelling', () => {
    // A segment enters its cell from wherever the segment behind it stands, so
    // that — not the head, which at a bend is off to one side — is the axis the
    // piece is drawn on. Each of the four elbows, read as the piece that
    // carries the sugar into the corner cell.
    const turns = [
      { head: at(6, 5), tail: at(5, 6), angle: 90, headArm: Dir.Left }, // in from the south
      { head: at(5, 6), tail: at(4, 5), angle: 0, headArm: Dir.Right }, // in from the west
      { head: at(4, 5), tail: at(5, 4), angle: 90, headArm: Dir.Right }, // in from the north
      { head: at(5, 4), tail: at(6, 5), angle: 0, headArm: Dir.Left }, // in from the east
    ];

    for (const { head, tail, angle, headArm } of turns) {
      expect(strandSpriteAt(at(5, 5), head, tail)).toEqual({
        piece: StrandPiece.Straight,
        angle,
        headArm,
        tailArm: OPPOSITE[headArm],
      });
    }
  });

  it('crosses the two pieces at a bend rather than bending either of them', () => {
    // The corner cell is covered by the piece arriving in it and the piece
    // leaving it, on perpendicular axes. That is what holds a turn together
    // while both are mid-slide: each bar is where its own sugar actually is,
    // and neither carries a bend a whole cell from the corner it belongs to.
    const intoTheCorner = strandSpriteAt(at(5, 5), at(5, 6), at(4, 5));
    const outOfIt = strandSpriteAt(at(5, 6), at(5, 7), at(5, 5));

    expect(intoTheCorner.piece).toBe(StrandPiece.Straight);
    expect(outOfIt.piece).toBe(StrandPiece.Straight);
    expect(Math.abs(intoTheCorner.angle - outOfIt.angle)).toBe(90);
  });

  it('reads the piece off the segment behind, wherever the head has gone', () => {
    // Same cell, same cell behind, head anywhere adjacent: the sugar came in on
    // one axis and is drawn on it either way.
    const straightOn = strandSpriteAt(at(5, 5), at(6, 5), at(4, 5));
    const turning = strandSpriteAt(at(5, 5), at(5, 4), at(4, 5));

    expect(turning).toEqual(straightOn);
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
