import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, eq } from './board';
import { PRIMARIES, primariesOf, type Primary } from './colors';
import { DEFAULT_CONFIG, Game, STARTING_LIVES } from './game';
import { MIXING_STAGE } from './orders';
import { SHELF_SLOTS } from './shelf';
import { stockedPrimaries } from './tutorial';
import { Dir, OPPOSITE, RAW, type GameState, type TurnSource, type Vec2 } from './types';

/**
 * A bot that actually plays the game, rather than turning at random: it grows
 * one segment, takes it through whatever jars the order needs, and drives it
 * into the bench. That is the whole production loop, so a run of it exercises
 * every rule in this phase — the opening levels, matching, staling, patience,
 * lives — against invariants that must hold on every single tick.
 */
const BENCH = CHOP_BLOCK_CELLS[0]!;

/** Signed distance the short way round, since the kitchen edges wrap. */
const shortest = (delta: number, size: number): number =>
  ((((delta + size / 2) % size) + size) % size) - size / 2;

const steerTowards = (state: GameState, goal: Vec2): Dir => {
  const dx = shortest(goal.x - state.snake.head.x, COLS);
  const dy = shortest(goal.y - state.snake.head.y, ROWS);

  const moves: { dir: Dir; distance: number }[] = [
    { dir: dx > 0 ? Dir.Right : Dir.Left, distance: Math.abs(dx) },
    { dir: dy > 0 ? Dir.Down : Dir.Up, distance: Math.abs(dy) },
  ];

  return (
    moves
      .filter((move) => move.distance > 0)
      .sort((a, b) => b.distance - a.distance)
      .map((move) => move.dir)
      // The core rejects a reversal anyway; picking the other axis instead
      // means the bot keeps making progress rather than stalling.
      .find((dir) => dir !== OPPOSITE[state.snake.dir]) ?? state.snake.dir
  );
};

/** Sugar, then the jars the order still needs, then the bench. */
const goalOf = (state: GameState): Vec2 => {
  const sugar = state.pickups.find((pickup) => pickup.kind === 'sugar');
  const carried = state.snake.body[0];
  if (carried === undefined) return sugar?.pos ?? BENCH;

  const want = state.customers[0]?.want ?? RAW;
  const missing = primariesOf(want).find((primary) => (carried.color & primary) === 0);
  const jar = state.pickups.find(
    (pickup) => pickup.kind === 'dye' && pickup.primary === missing,
  );

  return jar?.pos ?? BENCH;
};

const botFor = (game: Game): TurnSource => ({
  take: () => steerTowards(game.state, goalOf(game.state)),
});

/** Everything that must be true after every single step of every run. */
const violationsIn = (game: Game, tick: number): string[] => {
  const { state } = game;
  const broken: string[] = [];
  const at = (message: string): string => `tick ${tick}: ${message}`;

  if (state.lives < 0 || state.lives > STARTING_LIVES) {
    broken.push(at(`${state.lives} lives`));
  }
  if (state.shelf.length > SHELF_SLOTS) {
    broken.push(at(`${state.shelf.length} candies on a ${SHELF_SLOTS}-slot shelf`));
  }

  const inTutorial = state.tutorialIndex < game.tutorial.length;
  const cap = inTutorial ? 1 : MIXING_STAGE.maxQueue;
  if (state.customers.length > cap) {
    broken.push(at(`${state.customers.length} children waiting, cap ${cap}`));
  }

  for (const customer of state.customers) {
    if (customer.patience !== undefined && customer.patience.remainingMs < 0) {
      broken.push(at(`customer ${customer.id} past the end of their bar`));
    }
    // The opening levels must never put a clock on the window (design §7).
    if (inTutorial && customer.patience !== undefined) {
      broken.push(at(`opening-level customer ${customer.id} has a patience clock`));
    }
    // Every candy is offered to the queue as it is made, and every arrival
    // sweeps the rack — so this pairing is unreachable by construction.
    if (state.shelf.some((candy) => candy.color === customer.want)) {
      broken.push(at(`customer ${customer.id} waiting beside a candy they ordered`));
    }
  }

  const stocked: readonly Primary[] = stockedPrimaries(
    game.tutorial,
    state.tutorialIndex,
  );
  for (const primary of PRIMARIES) {
    const jars = state.pickups.filter(
      (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
    );
    if (jars.length > 1) broken.push(at(`${jars.length} jars of primary ${primary}`));
    if (jars.length > 0 && !stocked.includes(primary)) {
      broken.push(at(`primary ${primary} on a board stocked for ${stocked.join()}`));
    }
  }

  if (!state.pickups.some((pickup) => pickup.kind === 'sugar')) {
    broken.push(at('no sugar on the map'));
  }

  return broken;
};

interface RunResult {
  readonly violations: string[];
  readonly game: Game;
}

const play = (seed: number, ticks: number): RunResult => {
  const game = new Game({ ...DEFAULT_CONFIG, seed });
  const bot = botFor(game);
  const violations: string[] = [];
  let score = 0;
  let served = 0;
  let level = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    game.step(20, bot);
    violations.push(...violationsIn(game, tick));

    const { state } = game;
    if (state.score < score) violations.push(`tick ${tick}: score went backwards`);
    if (state.served < served) violations.push(`tick ${tick}: serves went backwards`);
    if (state.tutorialIndex < level) violations.push(`tick ${tick}: tutorial rewound`);
    ({ score, served, tutorialIndex: level } = state);
  }

  return { violations: violations.slice(0, 10), game };
};

const SEEDS = [1, 17, 404, 9_001];
/** 20 000 × 20 ms is a shade under seven minutes of play per seed. */
const TICKS = 20_000;

describe('a full run', () => {
  it.each(SEEDS)('holds every invariant end to end (seed %d)', (seed) => {
    expect(play(seed, TICKS).violations).toEqual([]);
  });

  it('gets through the opening levels and serves real orders', () => {
    const { game } = play(SEEDS[0] ?? 1, TICKS);

    expect(game.state.tutorialIndex).toBe(game.tutorial.length);
    expect(game.state.served).toBeGreaterThan(game.tutorial.length);
    expect(game.state.score).toBeGreaterThan(0);
  });

  it('cannot end while the opening levels are still running', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    const idle: TurnSource = { take: () => undefined };

    // A player who never touches the controls drives straight forever and
    // serves nobody. The run has to survive that for as long as they leave it.
    for (let tick = 0; tick < TICKS; tick += 1) game.step(20, idle);

    expect(game.state.tutorialIndex).toBe(0);
    expect(game.state.lives).toBe(STARTING_LIVES);
    expect(game.state.over).toBe(false);
  });

  it('ends the run when the maker walks away from a real queue', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 5 });
    const bot = botFor(game);
    const idle: TurnSource = { take: () => undefined };

    for (let tick = 0; tick < TICKS && game.state.tutorialIndex < 3; tick += 1) {
      game.step(20, bot);
    }
    expect(game.state.tutorialIndex).toBe(3);

    // Three children, each with a clock now: walking away has to cost the run.
    for (let tick = 0; tick < TICKS && !game.state.over; tick += 1) {
      game.step(20, idle);
    }

    expect(game.state.over).toBe(true);
    expect(game.state.lives).toBe(0);
  });

  it('never spawns a pickup under an unopened cell of the strand', () => {
    const game = new Game({ ...DEFAULT_CONFIG, seed: 21 });
    const bot = botFor(game);

    for (let tick = 0; tick < 4_000; tick += 1) {
      game.step(20, bot);
      const { snake, pickups } = game.state;
      const cells = [snake.head, ...snake.body.map((segment) => segment.pos)];

      for (const pickup of pickups) {
        if (pickup.open) continue;
        expect(cells.some((cell) => eq(cell, pickup.pos))).toBe(false);
      }
    }
  });
});
