import { COLS, ROWS, stepCell } from './board';
import { createRng, type Rng } from './rng';
import {
  createSnake,
  dyeBody,
  findSelfHit,
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
  type Pickup,
  type TurnSource,
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

  private advance(input: TurnSource, events: GameEvent[]): void {
    const state = this.state;
    const dir = this.takeTurn(input);

    const nextHead = stepCell(state.snake.head, dir);
    const pickupIndex = pickupIndexAt(state, nextHead);
    const eaten = state.pickups[pickupIndex];

    // Only sugar lengthens the strand; a dye jar colors what is already there.
    state.snake = moveSnake(state.snake, dir, eaten?.kind === 'sugar');
    state.tick += 1;

    if (eaten !== undefined) {
      state.pickups.splice(pickupIndex, 1);
      this.consume(eaten, events);
    }

    const hitIndex = findSelfHit(state.snake);
    if (hitIndex >= 0) {
      const { snake, destroyed } = shatterAt(state.snake, hitIndex);
      state.snake = snake;
      events.push({ type: 'body-shattered', destroyed });
    }

    this.spawnPickups(events);
  }

  /**
   * Applies a pickup to the strand. Called after the move, so "every current
   * body segment" (design §4) means the body as it now stands — including the
   * raw segment sugar just appended.
   */
  private consume(pickup: Pickup, events: GameEvent[]): void {
    const pos = pickup.pos;

    if (pickup.kind === 'sugar') {
      events.push({ type: 'sugar-eaten', pos, length: snakeLength(this.state.snake) });
      return;
    }

    // A dye with no strand to knead it into is simply lost (design §5).
    const wasted = this.state.snake.body.length === 0;
    if (!wasted) this.state.snake = dyeBody(this.state.snake, pickup.primary);

    events.push({ type: 'dye-eaten', pos, primary: pickup.primary, wasted });
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
