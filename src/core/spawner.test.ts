import { describe, expect, it } from 'vitest';

import { CELL_COUNT, cellKey, eq, isChopBlock, keyToCell, stepCell } from './board';
import { BLUE, PRIMARIES, RED, YELLOW, type Primary } from './colors';
import { createRng } from './rng';
import { createDye, createSugar, ensurePickups, pickupIndexAt } from './spawner';
import { Dir, RAW, type GameState, type Pickup, type Vec2 } from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

const sugar = createSugar;
const dye = (primary: Primary, pos: Vec2): Pickup => createDye(pos, primary);

/** A full board — sugar plus one jar of each primary — as the core keeps it. */
const stocked = (): Pickup[] => [
  sugar(at(9, 9)),
  dye(RED, at(1, 1)),
  dye(YELLOW, at(2, 2)),
  dye(BLUE, at(3, 3)),
];

const stateWith = (
  body: Vec2[] = [],
  pickups: Pickup[] = [],
  debris: Vec2[] = [],
): GameState => ({
  snake: {
    head: at(5, 5),
    dir: Dir.Right,
    body: body.map((pos) => ({ pos, color: RAW })),
  },
  pickups,
  // The core splices a pile out the move it empties, so never fake an empty one.
  severed:
    debris.length === 0
      ? []
      : [{ segments: debris.map((pos) => ({ pos, color: RAW })), fate: 'crumble' }],
  shelf: [],
  tick: 0,
  elapsedMs: 0,
});

describe('spawner placement', () => {
  it('never spawns on the snake, a pickup, or the cell ahead of the head', () => {
    const state = stateWith([at(4, 5), at(3, 5), at(2, 5)], [sugar(at(9, 9))]);
    const forbidden = new Set([
      cellKey(state.snake.head),
      cellKey(stepCell(state.snake.head, state.snake.dir)),
      ...state.snake.body.map((segment) => cellKey(segment.pos)),
      ...state.pickups.map((pickup) => cellKey(pickup.pos)),
    ]);

    for (let seed = 0; seed < 200; seed += 1) {
      for (const spawned of ensurePickups(state, createRng(seed))) {
        expect(forbidden.has(cellKey(spawned.pos))).toBe(false);
      }
    }
  });

  it('never spawns on the chopping block', () => {
    const state = stateWith();

    for (let seed = 0; seed < 200; seed += 1) {
      for (const spawned of ensurePickups(state, createRng(seed))) {
        expect(isChopBlock(spawned.pos)).toBe(false);
      }
    }
  });

  it('never spawns on debris that is still crumbling', () => {
    const rubble = [at(9, 1), at(9, 2), at(9, 3)];
    const state = stateWith([], [], rubble);
    const forbidden = new Set(rubble.map(cellKey));

    for (let seed = 0; seed < 200; seed += 1) {
      for (const spawned of ensurePickups(state, createRng(seed))) {
        expect(forbidden.has(cellKey(spawned.pos))).toBe(false);
      }
    }
  });

  it('never stacks two pickups spawned in the same tick', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const spawned = ensurePickups(stateWith(), createRng(seed));

      expect(spawned).toHaveLength(4); // sugar + one jar of each primary
      expect(new Set(spawned.map((pickup) => cellKey(pickup.pos))).size).toBe(4);
    }
  });

  it('is deterministic for a given seed', () => {
    const state = stateWith();

    expect(ensurePickups(state, createRng(99))).toEqual(
      ensurePickups(state, createRng(99)),
    );
  });

  it('gives up when no legal cell is left', () => {
    const everyCell = Array.from({ length: CELL_COUNT }, (_, key) =>
      sugar(keyToCell(key)),
    );

    expect(ensurePickups(stateWith([], everyCell), createRng(1))).toEqual([]);
  });
});

describe('spawner stock levels', () => {
  it('leaves a fully stocked board alone', () => {
    expect(ensurePickups(stateWith([], stocked()), createRng(1))).toEqual([]);
  });

  it('replaces only what is missing', () => {
    const short = stocked().filter(
      (pickup) => !(pickup.kind === 'dye' && pickup.primary === YELLOW),
    );
    const spawned = ensurePickups(stateWith([], short), createRng(1));

    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ kind: 'dye', primary: YELLOW });
  });

  it('holds the "at least one sugar" invariant (design §8.1)', () => {
    const noSugar = stocked().filter((pickup) => pickup.kind !== 'sugar');
    const spawned = ensurePickups(stateWith([], noSugar), createRng(1));

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.kind).toBe('sugar');
  });

  it('keeps at most one jar per primary (design §8.2)', () => {
    const state = stateWith([], stocked());

    for (const primary of PRIMARIES) {
      const jars = [...state.pickups, ...ensurePickups(state, createRng(3))].filter(
        (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
      );

      expect(jars).toHaveLength(1);
    }
  });

  it('spawns in a fixed order, so a seed replays identically', () => {
    const spawned = ensurePickups(stateWith(), createRng(5));

    expect(
      spawned.map((pickup) => (pickup.kind === 'sugar' ? 'sugar' : pickup.primary)),
    ).toEqual(['sugar', RED, YELLOW, BLUE]);
  });
});

describe('pickupIndexAt', () => {
  it('finds a pickup of any kind at a cell', () => {
    const state = stateWith([], stocked());

    expect(pickupIndexAt(state, at(2, 2))).toBe(2);
    expect(eq(state.pickups[2]!.pos, at(2, 2))).toBe(true);
    expect(pickupIndexAt(state, at(15, 15))).toBe(-1);
  });
});
