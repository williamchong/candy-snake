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

/**
 * The chopping block: a short run down the right wall, where the serving
 * window and its customers go in Phase 4 — the same wall the shelf and the
 * queue anchor to (design §5, §10). Deliberately only 3 of the 16 cells in
 * that column, so the right column stays usable as a lane — crossing the block
 * always chops, and that has to be a choice rather than a toll.
 */
export const CHOP_BLOCK_HEIGHT = 3;

/**
 * Off the row the maker spawns in, rather than centred on the wall. The maker
 * starts empty-handed and drives straight until the player turns, so a bench
 * in that lane would chop the first strand they manage to build, a few cells
 * after they built it — the spawn lane has to be somewhere to gather (§5).
 */
export const CHOP_BLOCK_TOP = 2;

export const CHOP_BLOCK_CELLS: readonly Vec2[] = Array.from(
  { length: CHOP_BLOCK_HEIGHT },
  (_unused, index) => ({ x: COLS - 1, y: CHOP_BLOCK_TOP + index }),
);

const CHOP_BLOCK_KEYS = new Set(CHOP_BLOCK_CELLS.map(cellKey));

export const isChopBlock = (pos: Vec2): boolean => CHOP_BLOCK_KEYS.has(cellKey(pos));
