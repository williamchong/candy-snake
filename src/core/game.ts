import { COLS, ROWS, isChopBlock } from './board';
import { createCustomer, matchIndex, removeAt, tickPatience } from './customers';
import { MIXING_STAGE, rollOrder } from './orders';
import { createRng, type Rng } from './rng';
import { scoreServe } from './scoring';
import { pushCandy } from './shelf';
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
  TUTORIAL_ARRIVAL_GAP_MS,
  rollTutorial,
  stockedPrimaries,
  type TutorialLevel,
} from './tutorial';
import {
  Dir,
  OPPOSITE,
  type Customer,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Segment,
  type Severed,
  type SnakeState,
  type TurnSource,
  type Vec2,
} from './types';

/** Lost only to a customer walking out on you (design §6). */
export const STARTING_LIVES = 3;

/** 200 ms/cell = the 5 cells/s Warm-up speed (design §7). Tuning knob. */
export const DEFAULT_CONFIG: GameConfig = {
  seed: 1,
  moveIntervalMs: 200,
  stage: MIXING_STAGE,
  openingLevels: true,
};

/**
 * Owns the game state and advances it. The Phaser layer holds this by
 * convention as read-only: it renders `state` and plays effects from the
 * returned events, and never writes back (docs/architecture.md §2, §5).
 */
export class Game {
  readonly state: GameState;
  /** The run's three opening levels, rolled from the seed (design §7). */
  readonly tutorial: readonly TutorialLevel[];

  private readonly config: GameConfig;
  private readonly rng: Rng;
  private moveAccMs = 0;
  /** Time the window has been empty, against the current arrival interval. */
  private waitMs = 0;
  private nextCustomerId = 1;
  /** Events raised before the first step, so no spawn goes unannounced. */
  private pending: GameEvent[] = [];

  constructor(config: GameConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.rng = createRng(config.seed);
    // Before the first spawn: which jars the board stocks is the opening
    // level's to decide (design §7).
    this.tutorial = config.openingLevels ? rollTutorial(this.rng) : [];
    this.state = {
      snake: createSnake({ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }, Dir.Right),
      pickups: [],
      severed: [],
      shelf: [],
      customers: [],
      score: 0,
      lives: STARTING_LIVES,
      streak: 0,
      served: 0,
      over: false,
      tutorialIndex: 0,
      tick: 0,
      elapsedMs: 0,
    };

    this.spawnPickups(this.pending);
    // The first level's child *is* the instruction, so they are at the window
    // before the run starts rather than a few seconds into it. A game opening
    // straight into the endless ramp waits out its own interval instead.
    if (this.tutorial.length > 0) this.waitMs = TUTORIAL_ARRIVAL_GAP_MS;
    this.admitCustomer(0, this.pending);
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
    if (this.state.over) return events;

    this.state.elapsedMs += dtMs;
    this.moveAccMs += dtMs;

    while (this.moveAccMs >= this.config.moveIntervalMs) {
      this.moveAccMs -= this.config.moveIntervalMs;
      this.advance(input, events);
    }

    this.serveWindow(dtMs, events);

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

    this.consumeSevered(events);
    this.openPickupAt(state.snake.head, events);
    this.kneadOpenDyes(events);
    // Before the cubes are spent, not after: a chop can abandon an open cube
    // mid-pass, and it has to be closed again before `spendClearedPickups`
    // would plant its segment at a cell the tail is no longer heading for.
    this.cutAtBlock(before, events);
    this.spendClearedPickups(events);

    const hitIndex = findSelfHit(state.snake);
    if (hitIndex >= 0) this.breakStrand(hitIndex, before, events);

    this.spawnPickups(events);
  }

  private openPickupAt(pos: Vec2, events: GameEvent[]): void {
    const index = pickupIndexAt(this.state, pos);
    const pickup = this.state.pickups[index];
    if (pickup === undefined || pickup.open) return;

    this.state.pickups[index] = { ...pickup, open: true };

    // A jar only announces itself the first time it is opened, so a strand
    // that abandons one mid-pass and comes back for it says so twice — which
    // is right: the player made the pickup twice.
    if (pickup.kind === 'dye') {
      events.push({ type: 'dye-opened', pos: pickup.pos, primary: pickup.primary });
    }
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
   * The head reaching the chopping block cuts the whole strand loose there
   * (design §5). The maker drives on empty-handed while the batch stays
   * exactly where it lay and is drawn into the block one segment per move,
   * block end first — see `consumeSevered`.
   *
   * Cutting the strand off entirely, rather than chopping the segments that
   * cross the block while the head runs on, is what keeps the body
   * follow-the-leader: a segment removed from the middle of a live strand
   * leaves the one behind it two cells adrift, and next move it teleports to
   * close the gap. Nothing on this board teleports.
   */
  private cutAtBlock(before: SnakeState, events: GameEvent[]): void {
    if (!isChopBlock(this.state.snake.head) || this.state.snake.body.length === 0) return;

    events.push({ type: 'strand-cut', batch: this.sever(0, 'chop', before) });
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
   */
  private breakStrand(hitIndex: number, before: SnakeState, events: GameEvent[]): void {
    events.push({
      type: 'strand-broken',
      severed: this.sever(hitIndex, 'crumble', before),
    });
  }

  /**
   * Takes everything from `cutIndex` back off the strand and stands it still.
   * The piece stops dead on the cells it was *leaving*, not the ones it was
   * entering — which is also where the view last drew it, so it settles
   * without jumping a cell. Colors come from the cut itself, which may have
   * been dyed after the move; a segment a cube planted this move has no
   * earlier cell and is already standing still.
   *
   * Both cuts end here: a self-hit and a chop differ only in where the strand
   * parts and what becomes of the piece afterwards (design §5, §6).
   */
  private sever(cutIndex: number, fate: Severed['fate'], before: SnakeState): Segment[] {
    const { snake, severed } = shatterAt(this.state.snake, cutIndex);
    this.state.snake = snake;

    const segments = severed.map((segment, index) => ({
      ...segment,
      pos: before.body[cutIndex + index]?.pos ?? segment.pos,
    }));
    this.state.severed.push({ segments, fate });

    this.recloseAbandonedPickups();
    return segments;
  }

  /**
   * Closes every open pickup the strand no longer covers, leaving it on the
   * board for the head to come back for. Both ways a strand can lose length —
   * a break, a chop — can abandon a pickup mid-pass, and an open cube whose
   * cell no tail will ever clear would otherwise plant its segment at a cell
   * nowhere near the tail (design §6).
   */
  private recloseAbandonedPickups(): void {
    this.state.pickups = this.state.pickups.map((pickup) =>
      pickup.open && !coversCell(this.state.snake, pickup.pos)
        ? { ...pickup, open: false }
        : pickup,
    );
  }

  /**
   * Every cut piece loses its front segment, so pieces cut at different
   * moments come apart side by side rather than queueing behind each other
   * (design §6). What that segment becomes is the piece's fate: a break puffs
   * away as sugar, a chopped batch leaves the block as a candy.
   */
  private consumeSevered(events: GameEvent[]): void {
    this.state.severed = this.state.severed.flatMap((piece) => {
      const [segment, ...rest] = piece.segments;
      if (segment === undefined) return [];

      if (piece.fate === 'crumble') events.push({ type: 'debris-crumbled', segment });
      else this.deliverCandy(segment, events);

      return rest.length > 0 ? [{ ...piece, segments: rest }] : [];
    });
  }

  /**
   * A candy leaving the block. Whoever is waiting gets first refusal, and only
   * what nobody wants is racked — reporting the one a full shelf had to let go
   * of (design §5).
   *
   * Because every candy is offered to the queue as it is made, and every child
   * arriving sweeps the rack, "a waiting customer next to a matching candy on
   * the shelf" is a state this game cannot reach.
   */
  private deliverCandy(segment: Segment, events: GameEvent[]): void {
    events.push({ type: 'candy-chopped', pos: segment.pos, color: segment.color });

    const waiting = matchIndex(this.state.customers, segment.color);
    if (waiting >= 0) {
      this.serveCustomer(waiting, false, events);
      return;
    }

    const { shelf, staled } = pushCandy(this.state.shelf, {
      color: segment.color,
      bornAt: this.state.tick,
    });
    this.state.shelf = shelf;

    if (staled !== undefined) events.push({ type: 'candy-staled', color: staled.color });
  }

  /**
   * The serving window runs on its own clock: patience and arrivals are counted
   * in real ms rather than grid moves, so the bars stay smooth however fast the
   * ramp is driving the snake (architecture §5).
   *
   * It runs after the move loop, so a child arriving this step sees a rack that
   * already holds whatever was chopped on the way in.
   */
  private serveWindow(dtMs: number, events: GameEvent[]): void {
    const { customers, expired } = tickPatience(this.state.customers, dtMs);
    this.state.customers = customers;
    for (const customer of expired) this.loseCustomer(customer, events);

    if (!this.state.over) this.admitCustomer(dtMs, events);
  }

  /**
   * A child gives up and walks out — the only way a life is ever lost
   * (design §6), and the only thing that breaks a streak.
   */
  private loseCustomer(customer: Customer, events: GameEvent[]): void {
    this.state.streak = 0;
    this.state.lives -= 1;
    events.push({ type: 'customer-left', customer });
    events.push({ type: 'life-lost', lives: this.state.lives });

    if (this.state.lives > 0) return;

    this.state.over = true;
    events.push({
      type: 'game-over',
      score: this.state.score,
      served: this.state.served,
      elapsedMs: this.state.elapsedMs,
    });
  }

  /**
   * Brings the next child to the window once the wait is up. The clock only
   * runs while there is room, so clearing a full queue cannot dump the backlog
   * all at once — and the interval is read fresh each time, so the wait a
   * tutorial level started carries over into the endless game's own pacing.
   */
  private admitCustomer(dtMs: number, events: GameEvent[]): void {
    const level = this.tutorial[this.state.tutorialIndex];
    // One child at a time while the tutorial runs: each level is a single
    // order, and the next does not walk up until this one has been served.
    const maxQueue = level === undefined ? this.config.stage.maxQueue : 1;
    if (this.state.customers.length >= maxQueue) return;

    this.waitMs += dtMs;
    const interval =
      level === undefined ? this.config.stage.arrivalIntervalMs : TUTORIAL_ARRIVAL_GAP_MS;
    if (this.waitMs < interval) return;
    this.waitMs = 0;

    const customer = createCustomer(
      this.nextCustomerId,
      level?.want ?? rollOrder(this.config.stage, this.rng),
      // A tutorial customer never runs out: the opening levels play on every
      // run, and a tutorial must not be able to cost you the run (design §7).
      level === undefined ? this.config.stage.patienceMs : undefined,
    );
    this.nextCustomerId += 1;
    this.state.customers = [...this.state.customers, customer];
    events.push({ type: 'customer-arrived', customer });

    this.serveFromShelf(this.state.customers.length - 1, events);
  }

  /**
   * A child walking up checks the rack first (design §5). The oldest match
   * goes, which is the end staleness eats from — so a candy is never stepped
   * over and left to go stale behind a newer twin.
   */
  private serveFromShelf(index: number, events: GameEvent[]): void {
    const customer = this.state.customers[index];
    if (customer === undefined) return;

    const slot = this.state.shelf.findIndex((candy) => candy.color === customer.want);
    if (slot < 0) return;

    this.state.shelf = this.state.shelf.filter((_unused, at) => at !== slot);
    this.serveCustomer(index, true, events);
  }

  /** Pays for a serve and sends the child off happy (design §9). */
  private serveCustomer(index: number, fromShelf: boolean, events: GameEvent[]): void {
    const customer = this.state.customers[index];
    if (customer === undefined) return;

    const points = scoreServe(customer, this.state.streak);
    this.state.customers = removeAt(this.state.customers, index);
    this.state.score += points;
    this.state.streak += 1;
    this.state.served += 1;
    // While the tutorial runs the queue holds nothing but its own child, so a
    // serve is exactly what finishes a level.
    if (this.state.tutorialIndex < this.tutorial.length) this.state.tutorialIndex += 1;

    events.push({
      type: 'customer-served',
      customer,
      points,
      streak: this.state.streak,
      fromShelf,
    });
  }

  private spawnPickups(events: GameEvent[]): void {
    const stocked = stockedPrimaries(this.tutorial, this.state.tutorialIndex);

    for (const pickup of ensurePickups(this.state, this.rng, stocked)) {
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
