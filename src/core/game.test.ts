import { describe, expect, it } from 'vitest';

import { COLS, ROWS, cellKey, eq, stepCell } from './board';
import { BLUE, BROWN, PRIMARIES, RED, YELLOW, type Primary } from './colors';
import { DEFAULT_CONFIG, Game } from './game';
import { createRng } from './rng';
import { snakeLength } from './snake';
import { Dir, RAW, type ColorMask, type TurnSource, type Vec2 } from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

const NO_TURNS: TurnSource = { take: () => undefined };

const alwaysTurning = (dir: Dir): TurnSource => ({ take: () => dir });

/** The cell the snake will enter next — where a scripted pickup must sit. */
const cellAheadOf = (game: Game): Vec2 =>
  stepCell(game.state.snake.head, game.state.snake.dir);

const colorsOf = (game: Game): ColorMask[] =>
  game.state.snake.body.map((segment) => segment.color);

/** Drives one grid move with the given pickup sitting in the snake's path. */
const eatAhead = (game: Game, primary?: Primary) => {
  const pos = cellAheadOf(game);
  game.state.pickups = [
    primary === undefined ? { kind: 'sugar', pos } : { kind: 'dye', pos, primary },
  ];

  return { pos, events: game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS) };
};

describe('Game.step timing', () => {
  it('holds the snake still until a full move interval has passed', () => {
    const game = new Game();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs - 1, NO_TURNS);
    expect(game.state.snake.head).toEqual(start);

    game.step(1, NO_TURNS);
    expect(game.state.snake.head).toEqual(stepCell(start, Dir.Right));
  });

  it('catches up on a large delta', () => {
    const game = new Game();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs * 3, NO_TURNS);

    expect(game.state.snake.head).toEqual(at(start.x + 3, start.y));
    expect(game.state.elapsedMs).toBe(DEFAULT_CONFIG.moveIntervalMs * 3);
  });

  it('reports how far the snake stands between cells', () => {
    const game = new Game();
    expect(game.moveProgress()).toBe(0);

    game.step(DEFAULT_CONFIG.moveIntervalMs / 2, NO_TURNS);
    expect(game.moveProgress()).toBeCloseTo(0.5);

    // Unspent time the caller is holding counts toward the next cell too.
    expect(game.moveProgress(DEFAULT_CONFIG.moveIntervalMs / 2)).toBe(1);

    game.step(DEFAULT_CONFIG.moveIntervalMs / 2, NO_TURNS);
    expect(game.moveProgress()).toBe(0);
  });

  it('banks the leftover time instead of dropping it', () => {
    const game = new Game();

    game.step(DEFAULT_CONFIG.moveIntervalMs * 1.5, NO_TURNS);
    expect(game.state.tick).toBe(1);

    // The half-interval carried over from the previous call completes a move.
    game.step(DEFAULT_CONFIG.moveIntervalMs * 0.5, NO_TURNS);
    expect(game.state.tick).toBe(2);
  });
});

describe('Game turning', () => {
  it('applies a queued turn on the next move', () => {
    const game = new Game();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs, alwaysTurning(Dir.Up));

    expect(game.state.snake.head).toEqual(at(start.x, start.y - 1));
    expect(game.state.snake.dir).toBe(Dir.Up);
  });

  it('refuses a 180° reversal even from a TurnSource that offers one', () => {
    const game = new Game();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs, alwaysTurning(Dir.Left));

    expect(game.state.snake.dir).toBe(Dir.Right);
    expect(game.state.snake.head).toEqual(at(start.x + 1, start.y));
  });
});

describe('Game sugar', () => {
  it('starts with sugar and one jar of each primary on the map', () => {
    const pickups = new Game().state.pickups;

    expect(pickups.filter((pickup) => pickup.kind === 'sugar')).toHaveLength(1);
    expect(pickups.filter((pickup) => pickup.kind === 'dye')).toHaveLength(3);
  });

  it('announces every opening spawn, so none goes unrendered', () => {
    const game = new Game();
    const opening = game.state.pickups;
    const announced = game
      .step(1, NO_TURNS)
      .filter((event) => event.type === 'sugar-spawned' || event.type === 'dye-spawned');

    expect(announced).toHaveLength(opening.length);
  });

  it('eats sugar in its path, grows, and replaces it', () => {
    const game = new Game();
    const { pos, events } = eatAhead(game);

    expect(events).toContainEqual({ type: 'sugar-eaten', pos, length: 2 });
    expect(events.some((event) => event.type === 'sugar-spawned')).toBe(true);
    expect(snakeLength(game.state.snake)).toBe(2);
  });
});

describe('Game dye', () => {
  /** Grows the strand to `length` segments without coloring it. */
  const grownTo = (length: number): Game => {
    const game = new Game();
    for (let index = 0; index < length; index += 1) eatAhead(game);
    return game;
  };

  it('colors the whole strand without lengthening it', () => {
    const game = grownTo(2);
    const before = snakeLength(game.state.snake);

    const { pos, events } = eatAhead(game, RED);

    expect(events).toContainEqual({
      type: 'dye-eaten',
      pos,
      primary: RED,
      wasted: false,
    });
    expect(snakeLength(game.state.snake)).toBe(before);
    expect(colorsOf(game)).toEqual([RED, RED]);
  });

  it('takes the jar off the board and puts a fresh one back', () => {
    const game = grownTo(1);

    const { events } = eatAhead(game, BLUE);

    expect(events.some((event) => event.type === 'dye-spawned')).toBe(true);
    const jars = game.state.pickups.filter(
      (pickup) => pickup.kind === 'dye' && pickup.primary === BLUE,
    );
    expect(jars).toHaveLength(1);
  });

  it('wastes a dye eaten with no strand to knead it into', () => {
    const game = new Game();

    const { pos, events } = eatAhead(game, RED);

    expect(events).toContainEqual({ type: 'dye-eaten', pos, primary: RED, wasted: true });
    expect(game.state.snake.body).toHaveLength(0);
  });

  it('appends raw sugar behind dyed segments — the production line', () => {
    const game = grownTo(2);
    eatAhead(game, RED);
    eatAhead(game, BLUE);

    expect(colorsOf(game)).toEqual([RED | BLUE, RED | BLUE]);

    eatAhead(game);

    // Design §4: segments gained after a dye keep no color.
    expect(colorsOf(game)).toEqual([RED | BLUE, RED | BLUE, RAW]);
  });

  it('over-mixes to brown when a third primary lands', () => {
    const game = grownTo(1);
    eatAhead(game, RED);
    eatAhead(game, YELLOW);
    eatAhead(game, BLUE);

    expect(colorsOf(game)).toEqual([BROWN]);
  });
});

describe('Game shatter', () => {
  it('destroys the strand from the impact back and reports the lost cells', () => {
    const game = new Game();
    game.state.pickups = [{ kind: 'sugar', pos: at(8, 8) }];
    game.state.snake = {
      head: at(1, 1),
      dir: Dir.Left,
      body: [at(1, 0), at(0, 0), at(0, 1), at(0, 2), at(1, 2)].map((pos) => ({
        pos,
        color: RAW,
      })),
    };

    const events = game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS);

    expect(events).toContainEqual({
      type: 'body-shattered',
      destroyed: [
        { pos: at(0, 1), color: RAW },
        { pos: at(0, 2), color: RAW },
      ],
    });
    expect(game.state.snake.body).toHaveLength(3);
    expect(game.state.snake.head).toEqual(at(0, 1));
  });
});

describe('Game simulation', () => {
  it('keeps its invariants over a long scripted run', () => {
    const game = new Game({ seed: 7, moveIntervalMs: 200 });
    const rng = createRng(1234);
    const dirs = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];
    const bot: TurnSource = {
      take: () => (rng.next() < 0.3 ? dirs[rng.int(dirs.length)] : undefined),
    };
    const violations: string[] = [];

    for (let tick = 0; tick < 4000; tick += 1) {
      game.step(20, bot);
      const { snake, pickups } = game.state;

      if (!pickups.some((pickup) => pickup.kind === 'sugar')) {
        violations.push(`tick ${tick}: no sugar on the map`);
      }

      for (const primary of PRIMARIES) {
        const jars = pickups.filter(
          (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
        );
        if (jars.length > 1) {
          violations.push(`tick ${tick}: ${jars.length} jars of primary ${primary}`);
        }
      }

      for (const segment of snake.body) {
        if (
          !Number.isInteger(segment.color) ||
          segment.color < 0 ||
          segment.color > BROWN
        ) {
          violations.push(`tick ${tick}: segment mask ${segment.color} out of range`);
        }
      }

      const occupied = new Set([
        cellKey(snake.head),
        ...snake.body.map((s) => cellKey(s.pos)),
      ]);
      if (occupied.size !== snakeLength(snake)) {
        violations.push(`tick ${tick}: strand overlaps itself`);
      }

      for (const cell of [snake.head, ...snake.body.map((s) => s.pos)]) {
        if (cell.x < 0 || cell.x >= COLS || cell.y < 0 || cell.y >= ROWS) {
          violations.push(`tick ${tick}: cell out of bounds`);
        }
      }

      for (const pickup of pickups) {
        if (occupied.has(cellKey(pickup.pos))) {
          violations.push(`tick ${tick}: pickup under the snake`);
        }
        if (pickups.filter((other) => eq(other.pos, pickup.pos)).length > 1) {
          violations.push(`tick ${tick}: stacked pickups`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
