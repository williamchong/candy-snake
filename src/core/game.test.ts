import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_CELLS, COLS, ROWS, cellKey, eq, stepCell } from './board';
import { BLUE, BROWN, PRIMARIES, RED, YELLOW, type Primary } from './colors';
import { DEFAULT_CONFIG, Game } from './game';
import { createRng } from './rng';
import { SHELF_SLOTS } from './shelf';
import { snakeLength } from './snake';
import { createDye, createSugar } from './spawner';
import {
  Dir,
  RAW,
  type ColorMask,
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

  it('pulls the cube into the strand and replaces it', () => {
    const game = new Game();
    const { pos, events } = eatSugar(game);

    expect(events).toContainEqual({ type: 'sugar-pulled', pos, length: 2 });
    expect(events.some((event) => event.type === 'sugar-spawned')).toBe(true);
    expect(snakeLength(game.state.snake)).toBe(2);
  });

  it('leaves the cube on the board until the whole snake has passed it', () => {
    const game = new Game();
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
    const game = new Game();
    for (let cube = 0; cube < 3; cube += 1) eatSugar(game);

    const { pos } = eatSugar(game);

    // The cube does not vanish and reappear elsewhere — it *is* the new tail.
    expect(game.state.snake.body.at(-1)).toEqual({ pos, color: RAW });
  });

  it('holds a longer strand on the cube for proportionally more moves', () => {
    const game = new Game();
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
    const game = new Game();
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
    const game = new Game();

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
    const game = new Game();
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
  /** The bench is a run of cells; its first is as good as any to drive into. */
  const bench = CHOP_BLOCK_CELLS[0]!;

  /**
   * The strand laid out below the bench — and, because a cut piece stands
   * still on the cells it was *leaving*, exactly where the batch ends up. The
   * tests assert against the same list they started from, which is the claim.
   */
  const frozen = (colors: ColorMask[]): Segment[] =>
    colors.map((color, index) => ({ pos: at(bench.x, 2 + index), color }));

  /**
   * A strand one move below the bench, heading up, with nothing else on the
   * board: the next move puts the head on the block and the batch behind it.
   */
  const aboutToReachBlock = (colors: ColorMask[]): Game => {
    const game = new Game();
    game.state.pickups = [];
    game.state.snake = { head: at(bench.x, 1), dir: Dir.Up, body: frozen(colors) };
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

    expect(game.state.snake.head).toEqual(at(bench.x, 0));

    drive(game, 2);

    // Two more cells travelled — up through the service door and on down.
    expect(game.state.snake.head).toEqual(at(bench.x, ROWS - 2));
    expect(game.state.snake.body).toEqual([]);
  });

  it('draws the batch in one segment per move, block end first', () => {
    const colors = [RED, RAW];
    const game = aboutToReachBlock(colors);
    drive(game, 1);

    const first = drive(game, 1);
    expect(first).toContainEqual({
      type: 'candy-chopped',
      pos: at(bench.x, 2),
      color: RED,
    });
    expect(game.state.shelf).toEqual([{ color: RED, bornAt: 2 }]);
    expect(game.state.severed).toEqual([
      { segments: frozen(colors).slice(1), fate: 'chop' },
    ]);

    const second = drive(game, 1);
    expect(second).toContainEqual({
      type: 'candy-chopped',
      pos: at(bench.x, 3),
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
    const pos = at(bench.x, 3);
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
