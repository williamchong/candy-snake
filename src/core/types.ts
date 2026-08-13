/**
 * Shared types for the engine-free core. Nothing in src/core/ may import
 * Phaser — see docs/architecture.md §2.
 */

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

/** A union of one for now — `kind` is what dye jars will discriminate on. */
export type Pickup = { readonly kind: 'sugar'; readonly pos: Vec2 };

export interface GameState {
  snake: SnakeState;
  pickups: Pickup[];
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
  | { readonly type: 'sugar-eaten'; readonly pos: Vec2; readonly length: number }
  | { readonly type: 'sugar-spawned'; readonly pos: Vec2 }
  | { readonly type: 'body-shattered'; readonly positions: readonly Vec2[] };

/**
 * How the core pulls a buffered turn at the exact moment a move tick fires.
 * `input/directionQueue.ts` implements it; core stays free of that import.
 */
export interface TurnSource {
  take(): Dir | undefined;
}
