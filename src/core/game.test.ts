import { describe, expect, it } from 'vitest';

import { COLS, ROWS, cellKey, eq, stepCell } from './board';
import { DEFAULT_CONFIG, Game } from './game';
import { createRng } from './rng';
import { snakeLength } from './snake';
import { Dir, RAW, type TurnSource, type Vec2 } from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

const NO_TURNS: TurnSource = { take: () => undefined };

const alwaysTurning = (dir: Dir): TurnSource => ({ take: () => dir });

const sugarAheadOf = (game: Game): Vec2 =>
  stepCell(game.state.snake.head, game.state.snake.dir);

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
  it('starts with sugar on the map', () => {
    expect(new Game().state.pickups).toHaveLength(1);
  });

  it('announces the opening sugar, so no spawn goes unrendered', () => {
    const game = new Game();
    const opening = game.state.pickups[0];

    expect(opening).toBeDefined();
    expect(game.step(1, NO_TURNS)).toContainEqual({
      type: 'sugar-spawned',
      pos: opening?.pos,
    });
  });

  it('eats sugar in its path, grows, and replaces it', () => {
    const game = new Game();
    const target = sugarAheadOf(game);
    game.state.pickups = [{ kind: 'sugar', pos: target }];

    const events = game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS);

    expect(events).toContainEqual({ type: 'sugar-eaten', pos: target, length: 2 });
    expect(events.some((event) => event.type === 'sugar-spawned')).toBe(true);
    expect(snakeLength(game.state.snake)).toBe(2);
    expect(game.state.pickups).toHaveLength(1);
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
      positions: [at(0, 1), at(0, 2)],
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
