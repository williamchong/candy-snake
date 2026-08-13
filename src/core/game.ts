import { COLS, ROWS } from './board';
import { createRng, type Rng } from './rng';
import {
  coversCell,
  createSnake,
  dyeSegmentAt,
  findSelfHit,
  growTail,
  moveSnake,
  shatterAt,
  snakeLength,
} from './snake';
import { ensurePickups, pickupIndexAt } from './spawner';
import {
  Dir,
  OPPOSITE,
  type GameConfig,
  type GameEvent,
  type GameState,
  type SnakeState,
  type TurnSource,
  type Vec2,
} from './types';

/** 200 ms/cell = the 5 cells/s Warm-up speed (design §7). Tuning knob. */
export const DEFAULT_CONFIG: GameConfig = {
  seed: 1,
  moveIntervalMs: 200,
};

/**
 * Owns the game state and advances it. The Phaser layer holds this by
 * convention as read-only: it renders `state` and plays effects from the
 * returned events, and never writes back (docs/architecture.md §2, §5).
 */
export class Game {
  readonly state: GameState;

  private readonly config: GameConfig;
  private readonly rng: Rng;
  private moveAccMs = 0;
  /** Events raised before the first step, so no spawn goes unannounced. */
  private pending: GameEvent[] = [];

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.rng = createRng(config.seed);
    this.state = {
      snake: createSnake({ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }, Dir.Right),
      pickups: [],
      debris: [],
      tick: 0,
      elapsedMs: 0,
    };

    this.spawnPickups(this.pending);
  }

  /**
   * How far the snake stands between its last cell and its next, 0…1.
   * Movement is discrete here but must not look it, so the view draws the
   * snake at this fraction of the way across. `extraMs` lets a caller add
   * time it has accumulated but not yet handed to `step`.
   */
  moveProgress(extraMs = 0): number {
    return Math.min((this.moveAccMs + extraMs) / this.config.moveIntervalMs, 1);
  }

  /**
   * Accumulates real time and moves the snake one cell every
   * `moveIntervalMs`, so timers stay smooth while movement stays on-grid.
   */
  step(dtMs: number, input: TurnSource): GameEvent[] {
    const events = this.pending;
    this.pending = [];

    this.state.elapsedMs += dtMs;
    this.moveAccMs += dtMs;

    while (this.moveAccMs >= this.config.moveIntervalMs) {
      this.moveAccMs -= this.config.moveIntervalMs;
      this.advance(input, events);
    }

    return events;
  }

  /**
   * One grid move. Pickups resolve *around* the strand rather than at the
   * head: the head opens one on the way in, each segment is served as it
   * crosses the cell, and the pickup only leaves once the strand has cleared
   * it (design §5). The body retraces the head's path exactly, so opening a
   * pickup already guarantees every current segment will cross it.
   */
  private advance(input: TurnSource, events: GameEvent[]): void {
    const state = this.state;
    const dir = this.takeTurn(input);
    const before = state.snake;

    state.snake = moveSnake(state.snake, dir);
    state.tick += 1;

    this.crumbleDebris(events);
    this.openPickupAt(state.snake.head);
    this.kneadOpenDyes(events);
    this.spendClearedPickups(events);

    const hitIndex = findSelfHit(state.snake);
    if (hitIndex >= 0) this.breakStrand(hitIndex, before, events);

    this.spawnPickups(events);
  }

  private openPickupAt(pos: Vec2): void {
    const index = pickupIndexAt(this.state, pos);
    const pickup = this.state.pickups[index];
    if (pickup === undefined || pickup.open) return;

    this.state.pickups[index] = { ...pickup, open: true };
  }

  /**
   * Kneads each open jar into whichever single segment is standing on it now.
   * The head carries no color, so the tick it opens a jar colors nothing —
   * the strand starts turning one segment later, and one segment per move.
   */
  private kneadOpenDyes(events: GameEvent[]): void {
    this.state.pickups.forEach((pickup, index) => {
      if (pickup.kind !== 'dye' || !pickup.open) return;

      const dyed = dyeSegmentAt(this.state.snake, pickup.pos, pickup.primary);
      if (dyed === undefined) return;

      this.state.snake = dyed.snake;
      this.state.pickups[index] = { ...pickup, kneaded: pickup.kneaded + 1 };
      events.push({
        type: 'dye-kneaded',
        pos: pickup.pos,
        primary: pickup.primary,
        color: dyed.color,
      });
    });
  }

  /**
   * Retires every open pickup the strand has just moved off. The last segment
   * to leave is always the tail, so a sugar cube's cell is exactly the cell
   * the tail vacated this move — which is why the new segment can be planted
   * there and the cube appears to *become* the tail rather than vanish.
   */
  private spendClearedPickups(events: GameEvent[]): void {
    for (let index = this.state.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.state.pickups[index];
      if (pickup === undefined) continue;
      if (!pickup.open || coversCell(this.state.snake, pickup.pos)) continue;

      this.state.pickups.splice(index, 1);

      if (pickup.kind === 'sugar') {
        this.state.snake = growTail(this.state.snake, pickup.pos);
        events.push({
          type: 'sugar-pulled',
          pos: pickup.pos,
          length: snakeLength(this.state.snake),
        });
      } else {
        events.push({
          type: 'dye-spent',
          pos: pickup.pos,
          primary: pickup.primary,
          kneaded: pickup.kneaded,
        });
      }
    }
  }

  /**
   * Cuts the strand at the impact. The severed piece stops where it is and
   * becomes debris rather than disappearing (design §6).
   *
   * A pickup the lost length was still carrying is left on the board, closed
   * again: the strand that was passing through it no longer exists, so the
   * head has to come back for it. Without this, a sugar cube would later
   * plant its segment at a cell nowhere near the tail.
   */
  private breakStrand(hitIndex: number, before: SnakeState, events: GameEvent[]): void {
    const { snake, severed } = shatterAt(this.state.snake, hitIndex);
    this.state.snake = snake;

    // A cut length stops dead, so it freezes on the cells it was *leaving*,
    // not the ones it was entering — which is also where the view last drew
    // it, so the piece settles without jumping a cell. Colors come from
    // `severed`, which may have been dyed after the move. A segment a cube
    // planted this move has no earlier cell and is already standing still.
    const segments = severed.map((segment, index) => ({
      ...segment,
      pos: before.body[hitIndex + index]?.pos ?? segment.pos,
    }));
    this.state.debris.push({ segments });
    events.push({ type: 'strand-broken', severed: segments });

    this.state.pickups = this.state.pickups.map((pickup) =>
      pickup.open && !coversCell(snake, pickup.pos) ? { ...pickup, open: false } : pickup,
    );
  }

  /**
   * Every pile loses its impact-end segment, so piles from separate breaks
   * crumble side by side rather than queueing behind each other (design §6).
   */
  private crumbleDebris(events: GameEvent[]): void {
    this.state.debris = this.state.debris.flatMap(({ segments: [segment, ...rest] }) => {
      if (segment === undefined) return [];

      events.push({ type: 'debris-crumbled', segment });
      return rest.length > 0 ? [{ segments: rest }] : [];
    });
  }

  private spawnPickups(events: GameEvent[]): void {
    for (const pickup of ensurePickups(this.state, this.rng)) {
      this.state.pickups.push(pickup);
      events.push(
        pickup.kind === 'sugar'
          ? { type: 'sugar-spawned', pos: pickup.pos }
          : { type: 'dye-spawned', pos: pickup.pos, primary: pickup.primary },
      );
    }
  }

  /**
   * The queue already rejects reversals, but the core re-checks so no
   * TurnSource implementation can walk the head into its own neck.
   */
  private takeTurn(input: TurnSource): Dir {
    const current = this.state.snake.dir;
    const next = input.take();
    return next !== undefined && next !== OPPOSITE[current] ? next : current;
  }
}
