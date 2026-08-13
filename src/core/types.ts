/**
 * Shared types for the engine-free core. Nothing in src/core/ may import
 * Phaser — see docs/architecture.md §2.
 */

// Type-only, so the colors.ts ↔ types.ts and orders.ts ↔ types.ts pairings are
// erased at compile time and never become runtime import cycles.
import type { Primary } from './colors';
import type { StageConfig } from './orders';

/** A board cell coordinate (integer cell indices, never pixels). */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const Dir = {
  Up: 'up',
  Down: 'down',
  Left: 'left',
  Right: 'right',
} as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export const DIR_VECTORS: Record<Dir, Vec2> = {
  [Dir.Up]: { x: 0, y: -1 },
  [Dir.Down]: { x: 0, y: 1 },
  [Dir.Left]: { x: -1, y: 0 },
  [Dir.Right]: { x: 1, y: 0 },
};

export const OPPOSITE: Record<Dir, Dir> = {
  [Dir.Up]: Dir.Down,
  [Dir.Down]: Dir.Up,
  [Dir.Left]: Dir.Right,
  [Dir.Right]: Dir.Left,
};

/** A color is the set of paint primaries mixed in: 0 = raw … 7 = brown (design §4). */
export type ColorMask = number;
export const RAW: ColorMask = 0;

export interface Segment {
  readonly pos: Vec2;
  readonly color: ColorMask;
}

export interface SnakeState {
  readonly head: Vec2;
  readonly dir: Dir;
  readonly body: readonly Segment[];
}

/**
 * Pickups are passed *through*, not eaten: the head opens one by entering its
 * cell, and it stays on the board — blocking a respawn — until the strand has
 * cleared the cell again (design §5). `open` is that in-between state.
 */
export type Pickup =
  | { readonly kind: 'sugar'; readonly pos: Vec2; readonly open: boolean }
  | {
      readonly kind: 'dye';
      readonly pos: Vec2;
      readonly primary: Primary;
      readonly open: boolean;
      /**
       * Segments kneaded so far; 0 at spend time means the dye was wasted. A
       * break re-closes a jar without clearing this, so it counts the segments
       * this jar has ever colored, not the segments of the current pass.
       */
      readonly kneaded: number;
    };

/**
 * A length of strand no longer attached to the maker. Either way it is cut it
 * freezes where it lay and is consumed one segment per move from
 * `segments[0]` — the two fates differ only in what that segment becomes:
 *
 * - `crumble`: a self-hit break, coming apart from the impact end (design §6).
 * - `chop`: a batch cut loose at the chopping block, drawn in from the block
 *   end and coming out as candy (design §5).
 */
export interface Severed {
  readonly segments: readonly Segment[];
  readonly fate: 'crumble' | 'chop';
}

/**
 * A finished candy: one body segment that has been through the chopping block
 * (design §5). Shelf order is positional — oldest first, newest last — so
 * `bornAt` is not what sorts it; it is the tick the candy was made, kept
 * because it is a simulation clock and never a wall clock, so a seeded replay
 * produces an identical shelf. Phase 4 reads it for staleness.
 */
export interface Candy {
  readonly color: ColorMask;
  readonly bornAt: number;
}

/**
 * A patience timer, drained in real ms so the bar stays smooth however fast
 * the ramp is driving the snake (architecture §5). `totalMs` is kept so the
 * bar and the score bonus can both read a fraction without a second lookup.
 */
export interface Patience {
  readonly remainingMs: number;
  readonly totalMs: number;
}

/**
 * A child at the serving window. `patience` is undefined for a customer who
 * never leaves — the three opening levels use those, because a tutorial that
 * runs on every single run must not be able to cost the run (design §7).
 */
export interface Customer {
  readonly id: number;
  readonly want: ColorMask;
  readonly patience: Patience | undefined;
}

export interface GameState {
  snake: SnakeState;
  pickups: Pickup[];
  /** One entry per piece still being consumed; each goes at its own pace. */
  severed: Severed[];
  /** Candies waiting for a customer, oldest first (design §5). */
  shelf: Candy[];
  /** The queue at the serving window, in arrival order (design §5). */
  customers: Customer[];
  score: number;
  lives: number;
  /** Consecutive serves with nobody lost — the scoring multiplier (design §9). */
  streak: number;
  served: number;
  over: boolean;
  /**
   * How many of the three opening levels are done (design §7) — and so which
   * one is running, which decides what the board stocks and whether the child
   * at the window has a clock. On the state rather than a private counter, as
   * the arrival clock and the id counter are, so that how far into the run a
   * game is can be read off one object.
   */
  tutorialIndex: number;
  /**
   * Grid moves elapsed — a simulation clock that does not depend on
   * `moveIntervalMs` (which difficulty varies from Phase 5). The view watches
   * it to skip redraws on the frames where nothing moved.
   */
  tick: number;
  elapsedMs: number;
}

export interface GameConfig {
  /** Seeds core/rng.ts — the same seed and inputs always replay identically. */
  readonly seed: number;
  /** Milliseconds per grid move; the steering-feel knob (design §7). */
  readonly moveIntervalMs: number;
  /**
   * The difficulty row in force once the opening levels are done. Phase 5
   * replaces this fixed row with a continuous curve.
   */
  readonly stage: StageConfig;
  /**
   * Every real run opens with the three teaching levels (design §7). Off only
   * for tests and balancing sims, which want the endless game directly.
   */
  readonly openingLevels: boolean;
}

export type GameEvent =
  /** The cube has been pulled into the strand as the new tail segment at `pos`. */
  | { readonly type: 'sugar-pulled'; readonly pos: Vec2; readonly length: number }
  | { readonly type: 'sugar-spawned'; readonly pos: Vec2 }
  /** One segment took the primary while standing on the jar; `color` is its new mix. */
  | {
      readonly type: 'dye-kneaded';
      readonly pos: Vec2;
      readonly primary: Primary;
      readonly color: ColorMask;
    }
  /**
   * The strand has cleared the jar and it leaves the board. `kneaded` is how
   * many segments it colored, so 0 is design §5's wasted dye — the view needs
   * to tell the two apart without re-reading state (architecture §4).
   */
  | {
      readonly type: 'dye-spent';
      readonly pos: Vec2;
      readonly primary: Primary;
      readonly kneaded: number;
    }
  | { readonly type: 'dye-spawned'; readonly pos: Vec2; readonly primary: Primary }
  /**
   * The head just entered a jar's cell and opened it. Nothing is colored yet —
   * the head is the maker and takes no color, so the first segment does not
   * turn until the move after (design §4). It exists so the view can confirm
   * the pickup at the moment the player made it, rather than a move late.
   */
  | { readonly type: 'dye-opened'; readonly pos: Vec2; readonly primary: Primary }
  /** The strand broke; `severed` is the piece now frozen as debris, impact end first. */
  | { readonly type: 'strand-broken'; readonly severed: readonly Segment[] }
  /** The block cut the strand loose; `batch` is frozen where it lay, block end first. */
  | { readonly type: 'strand-cut'; readonly batch: readonly Segment[] }
  /** Carries the whole segment, so the puff can show the color that was lost. */
  | { readonly type: 'debris-crumbled'; readonly segment: Segment }
  /** A candy left the block; `pos` is the cell it was drawn in from, where the batch lies. */
  | { readonly type: 'candy-chopped'; readonly pos: Vec2; readonly color: ColorMask }
  /** A full shelf pushed its oldest candy off to make room (design §5). */
  | { readonly type: 'candy-staled'; readonly color: ColorMask }
  /** A child walked up to the window. The whole customer, since the card needs all of it. */
  | { readonly type: 'customer-arrived'; readonly customer: Customer }
  /**
   * Served and gone happy. `streak` is the run *including* this serve — what
   * the HUD shows — while `points` was already paid at the multiplier the
   * streak stood at before it (design §9). `fromShelf` separates a candy taken
   * straight off the block from one that was waiting on the rack.
   */
  | {
      readonly type: 'customer-served';
      readonly customer: Customer;
      readonly points: number;
      readonly streak: number;
      readonly fromShelf: boolean;
    }
  /** Patience ran out; the child leaves angry (design §5). */
  | { readonly type: 'customer-left'; readonly customer: Customer }
  | { readonly type: 'life-lost'; readonly lives: number }
  | {
      readonly type: 'game-over';
      readonly score: number;
      readonly served: number;
      readonly elapsedMs: number;
    };

/**
 * How the core pulls a buffered turn at the exact moment a move tick fires.
 * `input/directionQueue.ts` implements it; core stays free of that import.
 */
export interface TurnSource {
  take(): Dir | undefined;
}
