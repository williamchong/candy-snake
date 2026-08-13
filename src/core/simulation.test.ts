import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, eq } from './board';
import { PRIMARIES, primariesOf, type Primary } from './colors';
import { DEFAULT_CONFIG, Game, STARTING_LIVES } from './game';
import { MIXING_STAGE } from './orders';
import { SHELF_SLOTS } from './shelf';
import { stockedPrimaries, stocksSugar } from './tutorial';
import {
  Dir,
  OPPOSITE,
  RAW,
  type ColorMask,
  type GameState,
  type TurnSource,
  type Vec2,
} from './types';

/**
 * Two bots that actually play the game, rather than turning at random. Both
 * run the whole production loop — sugar, jars, bench — so a run of either
 * exercises every rule in this phase (the opening levels, matching, staling,
 * patience, lives) against invariants that must hold on every single tick.
 *
 * They differ in the one thing the balancing pass cares about: how much sugar
 * they keep on the strand. `grinderGoal` carries a single segment; `batcherGoal`
 * builds a production line. Tuning against only one of them would tune the game
 * around that way of playing, so both are kept.
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

/** Where a bot is heading this move. */
type Goal = (state: GameState) => Vec2;

/**
 * The jar for the first primary `held` still lacks, if one is on the board.
 * Both bots want exactly this; they differ only in what they do when the floor
 * has not got it.
 */
const jarTowards = (
  state: GameState,
  held: ColorMask,
  needed: readonly Primary[],
): Vec2 | undefined => {
  const missing = needed.find((primary) => (held & primary) === 0);
  if (missing === undefined) return undefined;

  return state.pickups.find(
    (pickup) => pickup.kind === 'dye' && pickup.primary === missing,
  )?.pos;
};

/**
 * One cube, through the jars the order still needs, then the bench — a candy
 * per trip and never more than one segment on the strand.
 *
 * This is the cheapest way to play and, at the tuning Phase 4 pinned, an
 * extremely good one (see "the reference players" below). It is deliberately
 * kept as a reference: it is the floor a balancing pass has to beat.
 */
const grinderGoal: Goal = (state) => {
  const sugar = state.pickups.find((pickup) => pickup.kind === 'sugar');
  const carried = state.snake.body[0];
  if (carried === undefined) return sugar?.pos ?? BENCH;

  const want = state.customers[0]?.want ?? RAW;

  return jarTowards(state, carried.color, primariesOf(want)) ?? BENCH;
};

/**
 * The other way to play, and the one the color system was designed around: the
 * maker builds a production line before chopping.
 *
 * A jar tints every segment already on the strand, and a cube taken after a jar
 * stays raw (design §4), so a batch can only ever be a **nested ladder** —
 * most-mixed at the head end, shedding a primary per segment toward the tail.
 * Alternating sugar and jars banks one candy per tier in a single trip:
 *
 *     sugar, red, sugar, yellow, sugar  →  [orange, yellow, raw]
 *
 * The ladder is cut to the order at the window: one segment per jar that order
 * needs, plus the raw one under them all. Nothing is counted between moves —
 * how far the build has got is read back off the head-end segment's color — so
 * a strand broken mid-build simply re-plans from whatever survived.
 *
 * Where the board withholds a cube, the bot takes the next jar it still needs
 * rather than stalling. That is not a special case for the opening levels: it
 * is what those levels are stocked to teach, since each lays one cube and waits
 * for it to come back (design §7). The same rule plays them correctly.
 */
const batcherGoal: Goal = (state) => {
  const carried = state.snake.body;
  const held = carried[0]?.color ?? RAW;
  const needed = primariesOf(state.customers[0]?.want ?? RAW);
  const mixes = primariesOf(held).length;
  /** A segment per jar the order needs, plus the raw one under them all. */
  const batchSize = needed.length + 1;

  if (carried.length >= batchSize) return BENCH;

  // Dye what is on the strand before laying the next cube on top of it. A cube
  // taken first would cross this jar too, and the ladder would come out flat.
  if (mixes < carried.length) return jarTowards(state, held, needed) ?? BENCH;

  const sugar = state.pickups.find((pickup) => pickup.kind === 'sugar');
  if (sugar !== undefined) return sugar.pos;

  // No cube to be had, so press on with the next jar rather than stall. This is
  // a real test rather than the one above again: an order that changed
  // mid-build can leave `held` carrying a primary the new one does not need.
  if (mixes >= needed.length) return BENCH;

  return jarTowards(state, held, needed) ?? BENCH;
};

const botFor = (game: Game, goalOf: Goal = grinderGoal): TurnSource => ({
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

  const inTutorial = game.openingLevel !== undefined;
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

  const stocked: readonly Primary[] = stockedPrimaries(game.openingLevel);
  for (const primary of PRIMARIES) {
    const jars = state.pickups.filter(
      (pickup) => pickup.kind === 'dye' && pickup.primary === primary,
    );
    if (jars.length > 1) broken.push(at(`${jars.length} jars of primary ${primary}`));
    if (jars.length > 0 && !stocked.includes(primary)) {
      broken.push(at(`primary ${primary} on a board stocked for ${stocked.join()}`));
    }
  }

  // Design §8.1's floor, narrowed by design §7: an opening level hands out one
  // cube and waits for it to come back as a candy before laying another.
  const wantsSugar = stocksSugar(game.openingLevel, state);
  const onMap = state.pickups.some((pickup) => pickup.kind === 'sugar');
  if (wantsSugar && !onMap) broken.push(at('no sugar on the map'));
  if (!wantsSugar && onMap) broken.push(at('a second cube laid out mid-level'));

  return broken;
};

interface RunResult {
  readonly violations: string[];
  readonly game: Game;
  /** Candies that left the block, however they were then disposed of. */
  readonly chopped: number;
  /** Candies the shelf had to let go of to make room (design §5). */
  readonly staled: number;
  /**
   * Cuts holding more than one color — a production line rather than a single
   * candy. The only direct evidence that a maker batched at all, since a
   * one-segment strand cannot produce one.
   */
  readonly ladders: number;
}

const play = (seed: number, ticks: number, goalOf: Goal = grinderGoal): RunResult => {
  const game = new Game({ ...DEFAULT_CONFIG, seed });
  const bot = botFor(game, goalOf);
  const violations: string[] = [];
  let score = 0;
  let served = 0;
  let level = 0;
  let chopped = 0;
  let staled = 0;
  let ladders = 0;

  for (let tick = 0; tick < ticks; tick += 1) {
    for (const event of game.step(20, bot)) {
      if (event.type === 'candy-chopped') chopped += 1;
      if (event.type === 'candy-staled') staled += 1;
      if (event.type === 'strand-cut') {
        const colors = new Set(event.batch.map((segment) => segment.color));
        if (colors.size > 1) ladders += 1;
      }
    }
    violations.push(...violationsIn(game, tick));

    const { state } = game;
    if (state.score < score) violations.push(`tick ${tick}: score went backwards`);
    if (state.served < served) violations.push(`tick ${tick}: serves went backwards`);
    if (state.tutorialIndex < level) violations.push(`tick ${tick}: tutorial rewound`);
    ({ score, served, tutorialIndex: level } = state);
  }

  return { violations: violations.slice(0, 10), game, chopped, staled, ladders };
};

const SEEDS = [1, 17, 404, 9_001];
/** 20 000 × 20 ms is a shade under seven minutes of play per seed. */
const TICKS = 20_000;

describe('a full run', () => {
  it.each(SEEDS)('holds every invariant end to end (seed %d)', (seed) => {
    expect(play(seed, TICKS).violations).toEqual([]);
  });

  it.each(SEEDS)('holds them for a maker who batches too (seed %d)', (seed) => {
    expect(play(seed, TICKS, batcherGoal).violations).toEqual([]);
  });

  it('builds a production line and serves off it', () => {
    const seed = SEEDS[0] ?? 1;
    const batcher = play(seed, TICKS, batcherGoal);

    expect(batcher.game.state.tutorialIndex).toBe(batcher.game.tutorial.length);
    expect(batcher.game.state.served).toBeGreaterThan(batcher.game.tutorial.length);
    // Serving is not the claim — laddering is, and only a multi-colored cut
    // shows it. A maker carrying one segment can barely manage one by accident.
    expect(batcher.ladders).toBeGreaterThan(10);
    expect(play(seed, TICKS).ladders).toBeLessThan(batcher.ladders);
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

/** 30 000 × 20 ms — the far end of the 8–10 min run Phase 5 is aiming at. */
const TARGET_TICKS = 30_000;

/**
 * Where the balance stands before Phase 5 touches it, measured rather than
 * guessed. **Every assertion here is expected to change in that phase** — this
 * block is the before half of the comparison, not a rule the game has to keep.
 *
 * It exists because Phase 4 pinned a single `MIXING_STAGE` row to have a stage
 * at all, and the plan's own mitigation for "balance is opinion" is seeded
 * simulations that make tuning comparable run-to-run. There was nothing to
 * compare against yet.
 *
 * What the runs say, in three findings — neither bot can lose, both drown the
 * window with candy nobody is there to take, and batching is therefore the
 * worse of the two ways to play. The measurements behind each are written up
 * in the plan's "Where the balance stands going in", which is where they should
 * be read and kept; repeating the numbers here would only give them a second
 * place to go stale.
 *
 * The third finding is the one that matters for tuning, and it is why both bots
 * are kept: a pass that tightened the ramp until the *grinder* died on schedule
 * would be tuning the game around the strategy it least wants to reward.
 */
describe('the reference players, before the balancing pass', () => {
  /**
   * One sweep per bot, shared between the tests below. `play` is a pure
   * function of (seed, ticks, goal) — the core takes all its randomness from
   * the seeded rng (architecture §2) — so re-running a sweep can only produce
   * what the last one did. Nothing here may step these games further.
   */
  const sweeps = new Map<Goal, RunResult[]>();
  const target = (goalOf: Goal): RunResult[] => {
    const sweep =
      sweeps.get(goalOf) ?? SEEDS.map((seed) => play(seed, TARGET_TICKS, goalOf));
    sweeps.set(goalOf, sweep);
    return sweep;
  };

  it.each([
    ['the cheapest strategy', grinderGoal],
    ['a maker who batches', batcherGoal],
  ] as const)('lets %s through the target window untouched', (_name, goalOf) => {
    for (const { game } of target(goalOf)) {
      expect(game.state.over).toBe(false);
      expect(game.state.lives).toBe(STARTING_LIVES);
    }
  });

  it('makes more than twice the candy the window can take', () => {
    for (const goalOf of [grinderGoal, batcherGoal]) {
      for (const { game, chopped, staled } of target(goalOf)) {
        expect(chopped).toBeGreaterThan(game.state.served * 2);
        expect(staled).toBeGreaterThan(0);
        // A shelf that is always full is a shelf that never poses a question.
        expect(game.state.shelf).toHaveLength(SHELF_SLOTS);
      }
    }
  });

  it('pays a batching maker nothing for the extra work', () => {
    const grinders = target(grinderGoal);

    target(batcherGoal).forEach((batcher, seed) => {
      const grinder = grinders[seed]!;

      // Both are demand-capped, so the longer strand buys no extra customers.
      // The gap measures 1 on every seed; 4 is slack, not a measured bound.
      expect(
        Math.abs(batcher.game.state.served - grinder.game.state.served),
      ).toBeLessThan(4);
      // The surplus it does make is thrown away…
      expect(batcher.staled).toBeGreaterThan(grinder.staled);
      // …and it is not paid for elsewhere. Level with the grinder on the best
      // seed and well behind on the rest, so this is a band rather than a `<`.
      expect(batcher.game.state.score).toBeLessThan(grinder.game.state.score * 1.05);
    });
  });
});
