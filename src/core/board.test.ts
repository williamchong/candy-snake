import { describe, expect, it } from 'vitest';

import {
  CELL_COUNT,
  COLS,
  ROWS,
  cellKey,
  eq,
  freeCells,
  keyToCell,
  stepCell,
  wrap,
} from './board';
import { Dir } from './types';

describe('board', () => {
  it('wraps across every edge', () => {
    expect(wrap({ x: -1, y: 4 })).toEqual({ x: COLS - 1, y: 4 });
    expect(wrap({ x: COLS, y: 4 })).toEqual({ x: 0, y: 4 });
    expect(wrap({ x: 4, y: -1 })).toEqual({ x: 4, y: ROWS - 1 });
    expect(wrap({ x: 4, y: ROWS })).toEqual({ x: 4, y: 0 });
  });

  it('wraps both axes at once at a corner', () => {
    expect(wrap({ x: -1, y: -1 })).toEqual({ x: COLS - 1, y: ROWS - 1 });
    expect(wrap({ x: COLS, y: ROWS })).toEqual({ x: 0, y: 0 });
  });

  it('leaves in-bounds cells untouched', () => {
    expect(wrap({ x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });

  it('steps one cell per direction, wrapping at the doors', () => {
    expect(stepCell({ x: 5, y: 5 }, Dir.Right)).toEqual({ x: 6, y: 5 });
    expect(stepCell({ x: 5, y: 5 }, Dir.Down)).toEqual({ x: 5, y: 6 });
    expect(stepCell({ x: 0, y: 0 }, Dir.Left)).toEqual({ x: COLS - 1, y: 0 });
    expect(stepCell({ x: 0, y: 0 }, Dir.Up)).toEqual({ x: 0, y: ROWS - 1 });
  });

  it('gives every cell a unique key that round-trips', () => {
    const keys = new Set<number>();

    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const key = cellKey({ x, y });
        keys.add(key);
        expect(keyToCell(key)).toEqual({ x, y });
      }
    }

    expect(keys.size).toBe(CELL_COUNT);
  });

  it('lists exactly the unoccupied cells', () => {
    const taken = [
      { x: 0, y: 0 },
      { x: 3, y: 2 },
    ];
    const free = freeCells(new Set(taken.map(cellKey)));

    expect(free).toHaveLength(CELL_COUNT - taken.length);
    for (const cell of taken) {
      expect(free.some((candidate) => eq(candidate, cell))).toBe(false);
    }
  });
});
