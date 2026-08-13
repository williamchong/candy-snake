/**
 * Shared types for the engine-free core. Nothing in src/core/ may import
 * Phaser — see docs/architecture.md §2.
 */

// Type-only, so the colors.ts ↔ types.ts pairing is erased at compile time
// and never becomes a runtime import cycle.
import type { Primary } from './colors';

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
 * A length of strand cut loose by a self-hit. It freezes where it broke and
 * crumbles one segment per move, `segments[0]` (the impact end) first —
 * design §6.
 */
export interface Debris {
  readonly segments: readonly Segment[];
}

export interface GameState {
  snake: SnakeState;
  pickups: Pickup[];
  /** One entry per break still crumbling; each crumbles independently. */
  debris: Debris[];
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
  /** The strand broke; `severed` is the piece now frozen as debris, impact end first. */
  | { readonly type: 'strand-broken'; readonly severed: readonly Segment[] }
  /** Carries the whole segment, so the puff can show the color that was lost. */
  | { readonly type: 'debris-crumbled'; readonly segment: Segment };

/**
 * How the core pulls a buffered turn at the exact moment a move tick fires.
 * `input/directionQueue.ts` implements it; core stays free of that import.
 */
export interface TurnSource {
  take(): Dir | undefined;
}
