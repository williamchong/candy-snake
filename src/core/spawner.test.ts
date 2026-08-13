import { describe, expect, it } from 'vitest';

import { CELL_COUNT, cellKey, eq, keyToCell, stepCell } from './board';
import { createRng } from './rng';
import { ensureSugar, spawnSugar } from './spawner';
import { Dir, RAW, type GameState, type Vec2 } from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

const stateWith = (body: Vec2[] = [], pickups: Vec2[] = []): GameState => ({
  snake: {
    head: at(5, 5),
    dir: Dir.Right,
    body: body.map((pos) => ({ pos, color: RAW })),
  },
  pickups: pickups.map((pos) => ({ kind: 'sugar' as const, pos })),
  tick: 0,
  elapsedMs: 0,
});

describe('spawner', () => {
  it('never spawns on the snake, a pickup, or the cell ahead of the head', () => {
    const state = stateWith([at(4, 5), at(3, 5), at(2, 5)], [at(9, 9)]);
    const forbidden = new Set([
      cellKey(state.snake.head),
      cellKey(stepCell(state.snake.head, state.snake.dir)),
      ...state.snake.body.map((segment) => cellKey(segment.pos)),
      ...state.pickups.map((pickup) => cellKey(pickup.pos)),
    ]);

    for (let seed = 0; seed < 200; seed += 1) {
      const sugar = spawnSugar(state, createRng(seed));

      expect(sugar).toBeDefined();
      expect(forbidden.has(cellKey(sugar!.pos))).toBe(false);
    }
  });

  it('is deterministic for a given seed', () => {
    const state = stateWith();

    expect(spawnSugar(state, createRng(99))).toEqual(spawnSugar(state, createRng(99)));
  });

  it('gives up when no legal cell is left', () => {
    const everyCell = Array.from({ length: CELL_COUNT }, (_, key) => keyToCell(key));

    expect(spawnSugar(stateWith([], everyCell), createRng(1))).toBeUndefined();
  });

  it('holds the "at least one sugar" invariant only when sugar is missing', () => {
    expect(ensureSugar(stateWith([], [at(9, 9)]), createRng(1))).toBeUndefined();

    const spawned = ensureSugar(stateWith(), createRng(1));
    expect(spawned?.kind).toBe('sugar');
    expect(eq(spawned!.pos, at(5, 5))).toBe(false);
  });
});
