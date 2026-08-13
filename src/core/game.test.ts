import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, cellKey, eq, stepCell } from './board';
import { BLUE, BROWN, PRIMARIES, RED, YELLOW, type Primary } from './colors';
import { createCustomer } from './customers';
import { DEFAULT_CONFIG, Game, STARTING_LIVES } from './game';
import { MIXING_STAGE, type StageConfig } from './orders';
import { createRng } from './rng';
import { SHELF_SLOTS } from './shelf';
import { snakeLength } from './snake';
import { createDye, createSugar } from './spawner';
import { TUTORIAL_ARRIVAL_GAP_MS } from './tutorial';
import {
  Dir,
  RAW,
  type ColorMask,
  type GameConfig,
  type GameEvent,
  type Segment,
  type TurnSource,
  type Vec2,
} from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

/**
 * Neighbouring cells. Asks `stepCell` rather than doing its own arithmetic, so
 * the wrap through a service door (design §6) is defined in one place.
 */
const isAdjacent = (a: Vec2, b: Vec2): boolean =>
  Object.values(Dir).some((dir) => eq(stepCell(a, dir), b));

const NO_TURNS: TurnSource = { take: () => undefined };

/**
 * The endless game with nobody at the window: no opening levels, and an
 * arrival clock that never comes round. Every test that predates the serving
 * window wants that board — a child waiting would take candies the test is
 * about to count on the shelf. The window's own behaviour is exercised in
 * "Game serving window" and "Game opening levels" below.
 */
const CLOSED_WINDOW: StageConfig = { ...MIXING_STAGE, arrivalIntervalMs: Infinity };

const newGame = (config: Partial<GameConfig> = {}): Game =>
  new Game({ ...DEFAULT_CONFIG, openingLevels: false, stage: CLOSED_WINDOW, ...config });

const alwaysTurning = (dir: Dir): TurnSource => ({ take: () => dir });

/** The cell the snake will enter next — where a scripted pickup must sit. */
const cellAheadOf = (game: Game): Vec2 =>
  stepCell(game.state.snake.head, game.state.snake.dir);

const colorsOf = (game: Game): ColorMask[] =>
  game.state.snake.body.map((segment) => segment.color);

/**
 * Drives `moves` grid moves, discarding whatever the spawner refills so the
 * scripted pickups stay the only things the snake can run into. Pickups now
 * take several moves to resolve, so a test cannot re-place them every tick.
 */
const drive = (game: Game, moves: number): GameEvent[] => {
  const scripted = new Set(game.state.pickups.map((pickup) => cellKey(pickup.pos)));
  const events: GameEvent[] = [];

  for (let move = 0; move < moves; move += 1) {
    events.push(...game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS));
    game.state.pickups = game.state.pickups.filter((pickup) =>
      scripted.has(cellKey(pickup.pos)),
    );
  }

  return events;
};

/** Moves needed for the whole strand to enter a pickup's cell and clear it. */
const passThrough = (game: Game): number => snakeLength(game.state.snake) + 1;

/** The bench is a run of cells; its first is as good as any to drive into. */
const BENCH = CHOP_BLOCK_CELLS[0]!;

/**
 * Where a batch of `colors` lies once it has been cut loose — and where it lay
 * before, since a cut piece stands still on the cells it was *leaving*. Tests
 * assert against the same list they started from, which is the claim.
 */
const batchCells = (colors: ColorMask[]): Segment[] =>
  colors.map((color, index) => ({ pos: at(BENCH.x - 2 - index, BENCH.y), color }));

/**
 * Puts the maker one move short of the bench with that batch in tow and
 * nothing else on the board: the next move cuts it loose, and one more per
 * segment draws it in.
 */
const layBatchAtBlock = (game: Game, colors: ColorMask[]): void => {
  game.state.pickups = [];
  game.state.snake = {
    head: at(BENCH.x - 1, BENCH.y),
    dir: Dir.Right,
    body: batchCells(colors),
  };
};

/** Moves needed to cut a batch loose and draw every segment of it in. */
const chopThrough = (colors: ColorMask[]): number => 1 + colors.length;

/** Lays one cube in the path and drives until it has become the new tail. */
const eatSugar = (game: Game): { pos: Vec2; events: GameEvent[] } => {
  const pos = cellAheadOf(game);
  game.state.pickups = [createSugar(pos)];

  return { pos, events: drive(game, passThrough(game)) };
};

/** Lays one jar in the path and drives until the strand has cleared it. */
const passDye = (game: Game, primary: Primary): { pos: Vec2; events: GameEvent[] } => {
  const pos = cellAheadOf(game);
  game.state.pickups = [createDye(pos, primary)];

  return { pos, events: drive(game, passThrough(game)) };
};

describe('Game.step timing', () => {
  it('holds the snake still until a full move interval has passed', () => {
    const game = newGame();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs - 1, NO_TURNS);
    expect(game.state.snake.head).toEqual(start);

    game.step(1, NO_TURNS);
    expect(game.state.snake.head).toEqual(stepCell(start, Dir.Right));
  });

  it('catches up on a large delta', () => {
    const game = newGame();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs * 3, NO_TURNS);

    expect(game.state.snake.head).toEqual(at(start.x + 3, start.y));
    expect(game.state.elapsedMs).toBe(DEFAULT_CONFIG.moveIntervalMs * 3);
  });

  it('reports how far the snake stands between cells', () => {
    const game = newGame();
    expect(game.moveProgress()).toBe(0);

    game.step(DEFAULT_CONFIG.moveIntervalMs / 2, NO_TURNS);
    expect(game.moveProgress()).toBeCloseTo(0.5);

    // Unspent time the caller is holding counts toward the next cell too.
    expect(game.moveProgress(DEFAULT_CONFIG.moveIntervalMs / 2)).toBe(1);

    game.step(DEFAULT_CONFIG.moveIntervalMs / 2, NO_TURNS);
    expect(game.moveProgress()).toBe(0);
  });

  it('banks the leftover time instead of dropping it', () => {
    const game = newGame();

    game.step(DEFAULT_CONFIG.moveIntervalMs * 1.5, NO_TURNS);
    expect(game.state.tick).toBe(1);

    // The half-interval carried over from the previous call completes a move.
    game.step(DEFAULT_CONFIG.moveIntervalMs * 0.5, NO_TURNS);
    expect(game.state.tick).toBe(2);
  });
});

describe('Game turning', () => {
  it('applies a queued turn on the next move', () => {
    const game = newGame();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs, alwaysTurning(Dir.Up));

    expect(game.state.snake.head).toEqual(at(start.x, start.y - 1));
    expect(game.state.snake.dir).toBe(Dir.Up);
  });

  it('refuses a 180° reversal even from a TurnSource that offers one', () => {
    const game = newGame();
    const start = game.state.snake.head;

    game.step(DEFAULT_CONFIG.moveIntervalMs, alwaysTurning(Dir.Left));

    expect(game.state.snake.dir).toBe(Dir.Right);
    expect(game.state.snake.head).toEqual(at(start.x + 1, start.y));
  });
});

describe('Game sugar', () => {
  // The opening levels stock a narrower board; see "Game opening levels".
  it('keeps sugar and one jar of each primary on the endless board', () => {
    const pickups = newGame().state.pickups;

    expect(pickups.filter((pickup) => pickup.kind === 'sugar')).toHaveLength(1);
    expect(pickups.filter((pickup) => pickup.kind === 'dye')).toHaveLength(3);
  });

  it('announces every opening spawn, so none goes unrendered', () => {
    const game = newGame();
    const opening = game.state.pickups;
    const announced = game
      .step(1, NO_TURNS)
      .filter((event) => event.type === 'sugar-spawned' || event.type === 'dye-spawned');

    expect(announced).toHaveLength(opening.length);
  });

  it('pulls the cube into the strand and replaces it', () => {
    const game = newGame();
    const { pos, events } = eatSugar(game);

    expect(events).toContainEqual({ type: 'sugar-pulled', pos, length: 2 });
    expect(events.some((event) => event.type === 'sugar-spawned')).toBe(true);
    expect(snakeLength(game.state.snake)).toBe(2);
  });

  it('leaves the cube on the board until the whole snake has passed it', () => {
    const game = newGame();
    const pos = cellAheadOf(game);
    game.state.pickups = [createSugar(pos)];

    // The head is standing on it: nothing has grown, and it has not respawned.
    drive(game, 1);
    expect(game.state.pickups).toEqual([{ kind: 'sugar', pos, open: true }]);
    expect(snakeLength(game.state.snake)).toBe(1);

    drive(game, 1);
    expect(game.state.pickups).toEqual([]);
    expect(snakeLength(game.state.snake)).toBe(2);
  });

  it('plants the new segment on the cube’s own cell, not at the far tail', () => {
    const game = newGame();
    for (let cube = 0; cube < 3; cube += 1) eatSugar(game);

    const { pos } = eatSugar(game);

    // The cube does not vanish and reappear elsewhere — it *is* the new tail.
    expect(game.state.snake.body.at(-1)).toEqual({ pos, color: RAW });
  });

  it('holds a longer strand on the cube for proportionally more moves', () => {
    const game = newGame();
    eatSugar(game);
    eatSugar(game); // body of two segments

    const pos = cellAheadOf(game);
    game.state.pickups = [createSugar(pos)];

    // Head, then each of the two segments, then the cell comes clear.
    drive(game, 3);
    expect(snakeLength(game.state.snake)).toBe(3);

    drive(game, 1);
    expect(snakeLength(game.state.snake)).toBe(4);
  });
});

describe('Game dye', () => {
  /** Grows the strand to `length` segments without coloring it. */
  const grownTo = (length: number): Game => {
    const game = newGame();
    for (let index = 0; index < length; index += 1) eatSugar(game);
    return game;
  };

  it('colors the whole strand without lengthening it', () => {
    const game = grownTo(2);
    const before = snakeLength(game.state.snake);

    const { pos, events } = passDye(game, RED);

    expect(events).toContainEqual({ type: 'dye-spent', pos, primary: RED, kneaded: 2 });
    expect(snakeLength(game.state.snake)).toBe(before);
    expect(colorsOf(game)).toEqual([RED, RED]);
  });

  it('turns one segment per move as it crosses the jar', () => {
    const game = grownTo(3);
    const pos = cellAheadOf(game);
    game.state.pickups = [createDye(pos, RED)];

    // The head carries no color, so the first move colors nothing.
    drive(game, 1);
    expect(colorsOf(game)).toEqual([RAW, RAW, RAW]);

    drive(game, 1);
    expect(colorsOf(game)).toEqual([RED, RAW, RAW]);

    drive(game, 1);
    expect(colorsOf(game)).toEqual([RED, RED, RAW]);

    drive(game, 1);
    expect(colorsOf(game)).toEqual([RED, RED, RED]);
  });

  it('announces the jar on the move the head opens it, once', () => {
    const game = grownTo(2);
    const pos = cellAheadOf(game);
    game.state.pickups = [createDye(pos, RED)];

    const opening = drive(game, 1);
    expect(opening).toContainEqual({ type: 'dye-opened', pos, primary: RED });
    // The head takes no color, so the jar is open a move before it kneads.
    expect(opening.some((event) => event.type === 'dye-kneaded')).toBe(false);

    // It stays open while the rest of the strand crosses; only the head
    // entering opens it, so it must not announce itself again.
    const rest = drive(game, 2);
    expect(rest.some((event) => event.type === 'dye-opened')).toBe(false);
  });

  it('keeps the jar on the board until the strand has cleared it', () => {
    const game = grownTo(2);
    const pos = cellAheadOf(game);
    game.state.pickups = [createDye(pos, RED)];

    // Head plus both segments have to cross before the jar is spent.
    const partway = drive(game, 3);
    expect(partway.some((event) => event.type === 'dye-spent')).toBe(false);
    expect(game.state.pickups).toEqual([
      { kind: 'dye', pos, primary: RED, open: true, kneaded: 2 },
    ]);

    const rest = drive(game, 1);
    expect(rest.some((event) => event.type === 'dye-spent')).toBe(true);
  });

  it('takes the spent jar off the board and puts a fresh one back', () => {
    const game = grownTo(1);
    const pos = cellAheadOf(game);
    game.state.pickups = [createDye(pos, BLUE)];

    // `drive` keeps only the scripted jar, so the other primaries respawn
    // every move — only a fresh *blue* one says this jar was replaced.
    const refilled = (events: GameEvent[]): boolean =>
      events.some((event) => event.type === 'dye-spawned' && event.primary === BLUE);

    // Still open, so the refill must not have fired yet.
    expect(refilled(drive(game, passThrough(game) - 1))).toBe(false);

    const spent = game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS);

    expect(refilled(spent)).toBe(true);
    const jars = game.state.pickups.filter(
      (pickup) => pickup.kind === 'dye' && pickup.primary === BLUE,
    );
    expect(jars).toHaveLength(1);
    expect(jars[0]?.pos).not.toEqual(pos);
  });

  it('wastes a dye with no strand to knead it into', () => {
    const game = newGame();

    const { pos, events } = passDye(game, RED);

    expect(events).toContainEqual({ type: 'dye-spent', pos, primary: RED, kneaded: 0 });
    expect(game.state.snake.body).toHaveLength(0);
  });

  it('reports each segment’s new mix as it turns', () => {
    const game = grownTo(1);

    const { pos, events } = passDye(game, RED);

    expect(events).toContainEqual({ type: 'dye-kneaded', pos, primary: RED, color: RED });
  });

  it('appends raw sugar behind dyed segments — the production line', () => {
    const game = grownTo(2);
    passDye(game, RED);
    passDye(game, BLUE);

    expect(colorsOf(game)).toEqual([RED | BLUE, RED | BLUE]);

    eatSugar(game);

    // Design §4: segments gained after a dye keep no color.
    expect(colorsOf(game)).toEqual([RED | BLUE, RED | BLUE, RAW]);
  });

  it('leaves a cube taken after the jar raw, even while the jar is still open', () => {
    const game = grownTo(2);
    const jar = cellAheadOf(game);
    const cube = stepCell(jar, game.state.snake.dir);
    game.state.pickups = [createDye(jar, RED), createSugar(cube)];

    // The jar is spent the move before the cube plants its segment, so the
    // new tail can never catch the dye that was already there.
    drive(game, 5);

    expect(colorsOf(game)).toEqual([RED, RED, RAW]);
  });

  it('dyes a cube taken before the jar — it was part of that batch', () => {
    const game = grownTo(2);
    const cube = cellAheadOf(game);
    const jar = stepCell(cube, game.state.snake.dir);
    game.state.pickups = [createSugar(cube), createDye(jar, RED)];

    drive(game, 6);

    expect(colorsOf(game)).toEqual([RED, RED, RED]);
  });

  it('over-mixes to brown when a third primary lands', () => {
    const game = grownTo(1);
    passDye(game, RED);
    passDye(game, YELLOW);
    passDye(game, BLUE);

    expect(colorsOf(game)).toEqual([BROWN]);
  });
});

describe('Game shatter', () => {
  /** Coiled so the next move walks the head into its own fourth segment. */
  const aboutToHitItself = (): Game => {
    const game = newGame();
    game.state.pickups = [createSugar(at(8, 8))];
    game.state.snake = {
      head: at(1, 1),
      dir: Dir.Left,
      body: [at(1, 0), at(0, 0), at(0, 1), at(0, 2), at(1, 2)].map((pos) => ({
        pos,
        color: RAW,
      })),
    };
    return game;
  };

  /**
   * The two segments behind the impact, on the cells they were *leaving* —
   * a cut length stops dead rather than completing the move it was mid-way
   * through.
   */
  const severed = [
    { pos: at(0, 2), color: RAW },
    { pos: at(1, 2), color: RAW },
  ];

  it('cuts the strand at the impact and reports the piece that came loose', () => {
    const game = aboutToHitItself();

    const events = drive(game, 1);

    expect(events).toContainEqual({ type: 'strand-broken', severed });
    expect(game.state.snake.body).toHaveLength(3);
    expect(game.state.snake.head).toEqual(at(0, 1));
  });

  it('freezes the severed piece where it broke instead of clearing it', () => {
    const game = aboutToHitItself();

    drive(game, 1);

    expect(game.state.severed).toEqual([{ segments: severed, fate: 'crumble' }]);
  });

  it('crumbles one block per move, from the impact toward the tail', () => {
    const game = aboutToHitItself();
    drive(game, 1);

    const first = drive(game, 1);
    expect(first).toContainEqual({ type: 'debris-crumbled', segment: severed[0] });
    expect(game.state.severed).toEqual([{ segments: [severed[1]], fate: 'crumble' }]);

    const second = drive(game, 1);
    expect(second).toContainEqual({ type: 'debris-crumbled', segment: severed[1] });
    expect(game.state.severed).toEqual([]);
  });

  it('closes a pickup the lost length was still carrying', () => {
    const game = aboutToHitItself();
    // (0,2) is a cell the severed piece occupies after the move, so the break
    // leaves this cube with no strand passing through it.
    const pos = at(0, 2);
    game.state.pickups = [{ kind: 'sugar', pos, open: true }];

    drive(game, 1);

    // Still there for the head to come back for, and no orphan segment planted.
    expect(game.state.pickups).toEqual([{ kind: 'sugar', pos, open: false }]);
    expect(game.state.snake.body).toHaveLength(3);
  });
});

describe('Game chopping block', () => {
  const bench = BENCH;
  const frozen = batchCells;

  const aboutToReachBlock = (colors: ColorMask[]): Game => {
    const game = newGame();
    layBatchAtBlock(game, colors);
    return game;
  };

  it('cuts the whole strand loose where it lay', () => {
    const colors = [RED, RAW];
    const game = aboutToReachBlock(colors);

    const events = drive(game, 1);

    expect(events).toContainEqual({ type: 'strand-cut', batch: frozen(colors) });
    expect(game.state.severed).toEqual([{ segments: frozen(colors), fate: 'chop' }]);
    expect(game.state.snake.body).toEqual([]);
  });

  it('leaves the maker steering, empty-handed, instead of halting', () => {
    const game = aboutToReachBlock([RED, RAW]);
    drive(game, 1);

    expect(game.state.snake.head).toEqual(bench);

    drive(game, 2);

    // Two more cells travelled — out through the service door and on across.
    expect(game.state.snake.head).toEqual(at(1, bench.y));
    expect(game.state.snake.body).toEqual([]);
  });

  it('draws the batch in one segment per move, block end first', () => {
    const colors = [RED, RAW];
    const laid = frozen(colors);
    const game = aboutToReachBlock(colors);
    drive(game, 1);

    const first = drive(game, 1);
    expect(first).toContainEqual({
      type: 'candy-chopped',
      pos: laid[0]!.pos,
      color: RED,
    });
    expect(game.state.shelf).toEqual([{ color: RED, bornAt: 2 }]);
    expect(game.state.severed).toEqual([{ segments: laid.slice(1), fate: 'chop' }]);

    const second = drive(game, 1);
    expect(second).toContainEqual({
      type: 'candy-chopped',
      pos: laid[1]!.pos,
      color: RAW,
    });
    expect(game.state.shelf).toEqual([
      { color: RED, bornAt: 2 },
      { color: RAW, bornAt: 3 },
    ]);
    expect(game.state.severed).toEqual([]);
  });

  it('keeps the dyed batch in production order, oldest sugar first', () => {
    const colors = [BROWN, RED | BLUE, RED, RAW];
    const game = aboutToReachBlock(colors);

    const events = drive(game, 1 + colors.length);

    expect(
      events
        .filter((event) => event.type === 'candy-chopped')
        .map((event) => event.color),
    ).toEqual(colors);
  });

  it('sits clear of the lane the maker spawns in', () => {
    // Two constants chosen in different files — the spawn cell in `Game` and
    // `CHOP_BLOCK_TOP` in `board` — and the design rule is the relationship
    // between them: the lane the player starts in is theirs to gather in, not
    // a run at the chopper (§5). Nothing else would catch the bench drifting
    // back across it.
    const { head } = newGame().state.snake;

    expect(CHOP_BLOCK_CELLS.some((cell) => cell.y === head.y)).toBe(false);
  });

  it('has nothing to cut when the maker crosses it alone', () => {
    const game = aboutToReachBlock([]);

    const events = drive(game, 2);

    expect(events.some((event) => event.type === 'strand-cut')).toBe(false);
    expect(game.state.severed).toEqual([]);
    expect(game.state.shelf).toEqual([]);
  });

  it('closes a pickup the batch was still carrying', () => {
    const game = aboutToReachBlock([RAW, RAW]);
    // A cube the strand was passing through, two cells back: once the batch is
    // cut loose no tail will ever clear it.
    const pos = frozen([RAW, RAW])[1]!.pos;
    game.state.pickups = [{ kind: 'sugar', pos, open: true }];

    drive(game, 1);

    expect(game.state.pickups).toEqual([{ kind: 'sugar', pos, open: false }]);
    expect(game.state.snake.body).toEqual([]);
  });

  it('pushes the oldest candy off once the shelf is full', () => {
    const colors = [RED, ...Array<ColorMask>(SHELF_SLOTS - 1).fill(RAW), YELLOW];
    const game = aboutToReachBlock(colors);

    const events = drive(game, 1 + colors.length);

    expect(events).toContainEqual({ type: 'candy-staled', color: RED });
    expect(game.state.shelf).toHaveLength(SHELF_SLOTS);
    expect(game.state.shelf.at(-1)?.color).toBe(YELLOW);
  });
});

describe('Game serving window', () => {
  /** Nobody is due to arrive, so a test's own queue is the whole queue. */
  const withCustomers = (...wants: ColorMask[]): Game => {
    const game = newGame();
    game.state.customers = wants.map((want, index) =>
      createCustomer(index + 1, want, MIXING_STAGE.patienceMs),
    );
    return game;
  };

  /** Cuts a batch loose at the bench and draws every segment of it in. */
  const chop = (game: Game, colors: ColorMask[]): GameEvent[] => {
    layBatchAtBlock(game, colors);
    return drive(game, chopThrough(colors));
  };

  it('hands a candy straight off the block to whoever wants it', () => {
    const game = withCustomers(RED);

    const served = chop(game, [RED]).filter((event) => event.type === 'customer-served');

    expect(served).toHaveLength(1);
    expect(served[0]?.customer.want).toBe(RED);
    expect(served[0]?.fromShelf).toBe(false);
    expect(served[0]?.points).toBeGreaterThan(0);
    expect(game.state.customers).toEqual([]);
    expect(game.state.served).toBe(1);
    expect(game.state.score).toBe(served[0]?.points);
    // Served straight from the block: it never touched the rack.
    expect(game.state.shelf).toEqual([]);
  });

  it('racks a candy nobody is waiting for', () => {
    const game = withCustomers(BLUE);

    chop(game, [RED]);

    expect(game.state.shelf.map((candy) => candy.color)).toEqual([RED]);
    expect(game.state.customers).toHaveLength(1);
    expect(game.state.score).toBe(0);
  });

  it('gives it to the most impatient of the children who want it', () => {
    const game = newGame();
    game.state.customers = [
      createCustomer(1, RED, 30_000),
      createCustomer(2, RED, 5_000),
    ];

    chop(game, [RED]);

    expect(game.state.customers.map((customer) => customer.id)).toEqual([1]);
  });

  it('splits a batch across everyone it fits, and racks the rest', () => {
    const game = withCustomers(RED, BLUE);

    chop(game, [RED, BLUE, RAW]);

    expect(game.state.customers).toEqual([]);
    expect(game.state.served).toBe(2);
    expect(game.state.shelf.map((candy) => candy.color)).toEqual([RAW]);
  });

  it('lets a child arriving take the oldest match off the rack', () => {
    const game = newGame({
      stage: { ...MIXING_STAGE, mix: [100, 0, 0], arrivalIntervalMs: 1_000 },
    });
    game.state.shelf = [
      { color: RAW, bornAt: 1 },
      { color: RAW, bornAt: 2 },
    ];

    const served = game
      .step(1_000, NO_TURNS)
      .filter((event) => event.type === 'customer-served');

    expect(served[0]?.fromShelf).toBe(true);
    expect(game.state.customers).toEqual([]);
    expect(game.state.shelf).toEqual([{ color: RAW, bornAt: 2 }]);
  });

  it('leaves a child waiting when nothing on the rack matches', () => {
    const game = newGame({
      stage: { ...MIXING_STAGE, mix: [100, 0, 0], arrivalIntervalMs: 1_000 },
    });
    game.state.shelf = [{ color: BROWN, bornAt: 1 }];

    game.step(1_000, NO_TURNS);

    expect(game.state.customers.map((customer) => customer.want)).toEqual([RAW]);
    expect(game.state.shelf).toHaveLength(1);
  });

  it('costs a life and the streak when patience runs out', () => {
    const game = newGame();
    game.state.customers = [createCustomer(1, RED, 500)];
    game.state.streak = 4;

    const events = game.step(500, NO_TURNS);

    expect(events.some((event) => event.type === 'customer-left')).toBe(true);
    expect(events).toContainEqual({ type: 'life-lost', lives: STARTING_LIVES - 1 });
    expect(game.state.lives).toBe(STARTING_LIVES - 1);
    expect(game.state.streak).toBe(0);
    expect(game.state.customers).toEqual([]);
  });

  it('ends the run when the last life goes', () => {
    const game = newGame();
    game.state.lives = 1;
    game.state.customers = [createCustomer(1, RED, 100)];

    const events = game.step(100, NO_TURNS);

    expect(events).toContainEqual({
      type: 'game-over',
      score: 0,
      served: 0,
      elapsedMs: 100,
    });
    expect(game.state.over).toBe(true);
  });

  it('stops the kitchen once the run is over', () => {
    const game = newGame();
    game.state.lives = 1;
    game.state.customers = [createCustomer(1, RED, 100)];
    game.step(100, NO_TURNS);

    const { head } = game.state.snake;
    const events = game.step(5_000, NO_TURNS);

    expect(events).toEqual([]);
    expect(game.state.snake.head).toEqual(head);
    expect(game.state.tick).toBe(0);
    expect(game.state.elapsedMs).toBe(100);
  });

  it('never lets more children in than the stage allows', () => {
    const game = newGame({ stage: { ...MIXING_STAGE, arrivalIntervalMs: 100 } });

    for (let step = 0; step < 50; step += 1) {
      game.step(200, NO_TURNS);
      expect(game.state.customers.length).toBeLessThanOrEqual(MIXING_STAGE.maxQueue);
    }

    expect(game.state.customers).toHaveLength(MIXING_STAGE.maxQueue);
  });
});

describe('Game opening levels', () => {
  /** A real run: the three teaching levels, exactly as a player gets them. */
  const opening = (seed = 1): Game => new Game({ ...DEFAULT_CONFIG, seed });

  /**
   * Steps without `drive`'s pickup filtering — what the board stocks is the
   * whole point of these tests.
   */
  const run = (game: Game, moves: number): GameEvent[] => {
    const events: GameEvent[] = [];
    for (let move = 0; move < moves; move += 1) {
      events.push(...game.step(DEFAULT_CONFIG.moveIntervalMs, NO_TURNS));
    }
    return events;
  };

  const jarsOn = (game: Game): Primary[] =>
    game.state.pickups
      .filter((pickup) => pickup.kind === 'dye')
      .map((pickup) => pickup.primary)
      .sort();

  /** Chops one candy of `want`, then waits for the next child to walk up. */
  const serveLevel = (game: Game, want: ColorMask): void => {
    layBatchAtBlock(game, [want]);
    run(
      game,
      chopThrough([want]) +
        Math.ceil(TUTORIAL_ARRIVAL_GAP_MS / DEFAULT_CONFIG.moveIntervalMs),
    );
  };

  it('has the first child at the window before the run has started', () => {
    const game = opening();

    expect(game.state.customers).toHaveLength(1);
    expect(game.state.customers[0]?.want).toBe(RAW);
  });

  it('opens on sugar and no dye at all', () => {
    const game = opening();

    expect(game.state.pickups.filter((pickup) => pickup.kind === 'sugar')).toHaveLength(
      1,
    );
    expect(jarsOn(game)).toEqual([]);
  });

  it('lays no second cube until the first has come back as a candy', () => {
    const game = opening();
    const cubes = (): number =>
      game.state.pickups.filter((pickup) => pickup.kind === 'sugar').length;

    // In the maker's path, rather than wherever the seed dropped it.
    game.state.pickups = [createSugar(cellAheadOf(game))];
    run(game, passThrough(game));
    expect(game.state.snake.body).toHaveLength(1);

    // A level is one candy, so the floor stays bare for as long as the maker
    // is carrying it — however long they drive around with it (design §7).
    run(game, 25);
    expect(cubes()).toBe(0);

    layBatchAtBlock(game, [RAW]);
    run(game, chopThrough([RAW]));

    expect(game.state.tutorialIndex).toBe(1);
    expect(cubes()).toBe(1);
  });

  it('never lets an opening child run out', () => {
    const game = opening();

    // Five minutes — past every patience in the difficulty table (design §7).
    run(game, 1_500);

    expect(game.state.lives).toBe(STARTING_LIVES);
    expect(game.state.over).toBe(false);
    expect(game.state.customers[0]?.want).toBe(RAW);
  });

  it('teaches one dye, then the mix built on it', () => {
    const game = opening();
    const [, second, third] = game.tutorial;

    serveLevel(game, RAW);
    expect(game.state.tutorialIndex).toBe(1);
    expect(game.state.customers[0]?.want).toBe(second?.want);
    expect(jarsOn(game)).toEqual([...(second?.stock ?? [])].sort());

    serveLevel(game, second?.want ?? RAW);
    expect(game.state.customers[0]?.want).toBe(third?.want);
    expect(jarsOn(game)).toEqual([...(third?.stock ?? [])].sort());
  });

  it('opens the board up to every dye once the third order is served', () => {
    const game = opening();
    const [, second, third] = game.tutorial;

    serveLevel(game, RAW);
    serveLevel(game, second?.want ?? RAW);
    serveLevel(game, third?.want ?? RAW);

    expect(game.state.tutorialIndex).toBe(3);
    expect(jarsOn(game)).toEqual([...PRIMARIES].sort());
    // The endless game gives itself a breather before the first real order.
    expect(game.state.customers).toEqual([]);
  });

  it('gives the endless game’s children the clock the opening ones lacked', () => {
    const game = newGame({ stage: { ...MIXING_STAGE, arrivalIntervalMs: 1_000 } });

    game.step(1_000, NO_TURNS);

    expect(game.state.customers[0]?.patience?.totalMs).toBe(MIXING_STAGE.patienceMs);
  });
});

describe('Game simulation', () => {
  it('keeps its invariants over a long scripted run', () => {
    const game = newGame({ seed: 7 });
    const rng = createRng(1234);
    const dirs = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];
    const bot: TurnSource = {
      take: () => (rng.next() < 0.3 ? dirs[rng.int(dirs.length)] : undefined),
    };
    const violations: string[] = [];

    for (let tick = 0; tick < 4000; tick += 1) {
      game.step(20, bot);
      const { snake, pickups, shelf } = game.state;

      if (!pickups.some((pickup) => pickup.kind === 'sugar')) {
        violations.push(`tick ${tick}: no sugar on the map`);
      }

      if (shelf.length > SHELF_SLOTS) {
        violations.push(
          `tick ${tick}: ${shelf.length} candies on a ${SHELF_SLOTS}-slot shelf`,
        );
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
        // An *open* pickup is under the strand by definition — that is the
        // whole mechanic. An unopened one never should be.
        if (!pickup.open && occupied.has(cellKey(pickup.pos))) {
          violations.push(`tick ${tick}: unopened pickup under the snake`);
        }
        if (pickups.filter((other) => eq(other.pos, pickup.pos)).length > 1) {
          violations.push(`tick ${tick}: stacked pickups`);
        }
      }

      // A cube always plants its segment on the cell the tail just left, so
      // the strand can never come apart into disconnected runs.
      const cells = [snake.head, ...snake.body.map((s) => s.pos)];
      for (let index = 1; index < cells.length; index += 1) {
        if (!isAdjacent(cells[index - 1]!, cells[index]!)) {
          violations.push(`tick ${tick}: strand broken between cells`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
