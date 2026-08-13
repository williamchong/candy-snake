import { COLS, ROWS, stepCell } from './board';
import { createRng, type Rng } from './rng';
import { createSnake, findSelfHit, moveSnake, shatterAt, snakeLength } from './snake';
import { ensureSugar, pickupIndexAt } from './spawner';
import {
  Dir,
  OPPOSITE,
  type GameConfig,
  type GameEvent,
  type GameState,
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

    this.spawnSugar(this.pending);
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
    const ate = state.pickups[pickupIndex]?.kind === 'sugar';

    state.snake = moveSnake(state.snake, dir, ate);
    state.tick += 1;

    if (ate) {
      state.pickups.splice(pickupIndex, 1);
      events.push({
        type: 'sugar-eaten',
        pos: nextHead,
        length: snakeLength(state.snake),
      });
    }

    const hitIndex = findSelfHit(state.snake);
    if (hitIndex >= 0) {
      const { snake, destroyed } = shatterAt(state.snake, hitIndex);
      state.snake = snake;
      events.push({ type: 'body-shattered', positions: destroyed });
    }

    this.spawnSugar(events);
  }

  private spawnSugar(events: GameEvent[]): void {
    const sugar = ensureSugar(this.state, this.rng);
    if (!sugar) return;

    this.state.pickups.push(sugar);
    events.push({ type: 'sugar-spawned', pos: sugar.pos });
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
