import { DIR_VECTORS, type Dir, type Vec2 } from './types';

/**
 * The kitchen floor: a fixed 16×16 logical grid (design §10) whose edges wrap
 * — walking out the left door re-enters on the right (design §6).
 */
export const COLS = 16;
export const ROWS = 16;
export const CELL_COUNT = COLS * ROWS;

export const wrap = (pos: Vec2): Vec2 => ({
  x: ((pos.x % COLS) + COLS) % COLS,
  y: ((pos.y % ROWS) + ROWS) % ROWS,
});

export const stepCell = (pos: Vec2, dir: Dir): Vec2 => {
  const delta = DIR_VECTORS[dir];
  return wrap({ x: pos.x + delta.x, y: pos.y + delta.y });
};

export const eq = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;

/** Stable identity for a cell, so occupancy can live in a Set. */
export const cellKey = (pos: Vec2): number => pos.y * COLS + pos.x;

export const keyToCell = (key: number): Vec2 => ({
  x: key % COLS,
  y: Math.floor(key / COLS),
});

export const freeCells = (occupied: ReadonlySet<number>): Vec2[] => {
  const cells: Vec2[] = [];
  for (let key = 0; key < CELL_COUNT; key += 1) {
    if (!occupied.has(key)) cells.push(keyToCell(key));
  }
  return cells;
};
