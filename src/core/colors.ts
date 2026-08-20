import type { ColorMask } from './types';

/**
 * A color *is* the set of paint primaries mixed in, so the eight states are
 * the eight subsets of {R, Y, B} and mixing is a bitwise OR (design §4).
 * R=1, Y=2, B=4 per architecture §4; 0 is raw and 7 is brown.
 */
export const RED = 1;
export const YELLOW = 2;
export const BLUE = 4;
export const BROWN = RED | YELLOW | BLUE;

/** Dyes on the map are primaries only — secondaries are the player's job. */
export const PRIMARIES = [RED, YELLOW, BLUE] as const;
export type Primary = (typeof PRIMARIES)[number];

/**
 * Blending, never overwriting: a red segment eating blue becomes purple, and a
 * purple segment eating yellow becomes brown. Applying a primary a segment
 * already holds is a no-op, which is what makes brown absorbing.
 */
export const blend = (color: ColorMask, dye: Primary): ColorMask => color | dye;

/**
 * The primaries a mix is made of — `blend` read backwards. The queue does not
 * show these: a recipe printed beside every order is a table the player reads
 * instead of playing (design §4). What reads them is the opening levels, which
 * stock the board from them (`tutorial.ts`), and Phase 7's mixing wheel.
 */
export const primariesOf = (color: ColorMask): Primary[] =>
  PRIMARIES.filter((primary) => (color & primary) !== 0);

/**
 * How many primaries a mix is made of — `primariesOf(color).length` without
 * building the array to throw it away. It is how far along a color is toward
 * being some other color, which the pity spawner asks on every step.
 */
export const mixCount = (color: ColorMask): number =>
  PRIMARIES.reduce((count, primary) => count + ((color & primary) !== 0 ? 1 : 0), 0);

/**
 * How hard a color is to produce, which is what difficulty will mix orders by
 * (design §4). Brown is not a tier — it is the over-mix mistake, and no
 * regular customer orders it.
 */
export type ColorTier = 1 | 2 | 3 | 'mistake';

/**
 * The tiers in the order design §9's table lists them, and an empty tally of
 * them. Written once because four places now key off this set — the run's own
 * count, the score screen's wording, the points table and the tests — and a
 * fifth tier added to a set spelled five times is a tier added to four of them.
 * The `Record` is what makes the compiler say so.
 */
export const TIERS: readonly ColorTier[] = [1, 2, 3, 'mistake'];

export const noServes = (): Record<ColorTier, number> => ({
  1: 0,
  2: 0,
  3: 0,
  mistake: 0,
});

export interface ColorInfo {
  /** Plain number: core stays engine-free, `render/` does the tinting. */
  readonly hex: number;
  /** The colorblind fallback, drawn on every segment, jar and candy. */
  readonly symbol: string;
  readonly name: string;
  readonly tier: ColorTier;
}

/**
 * The palette, indexed by mask — the *only* copy of it. Board, HUD and cheat
 * sheet all read from here so they cannot drift apart (architecture §7).
 *
 * The values are constrained rather than decorative (design §4, palette
 * constraints): all eight stay mutually distinguishable at pastel saturation,
 * and they sit a clear step below the pale floor bands so nothing is lost
 * against it. Raw shares the sugar cube's off-white deliberately — they are
 * the same material, separated by sprite size and symbol.
 */
/** Exactly one entry per subset of {R, Y, B} — no more, no fewer. */
type PerColor<T> = readonly [T, T, T, T, T, T, T, T];

export const COLORS: PerColor<ColorInfo> = [
  { hex: 0xfff3df, symbol: '○', name: 'Raw', tier: 1 },
  { hex: 0xff9aa8, symbol: '♥', name: 'Red', tier: 2 },
  { hex: 0xffe08a, symbol: '★', name: 'Yellow', tier: 2 },
  { hex: 0xffb877, symbol: '▲', name: 'Orange', tier: 3 },
  { hex: 0x9ad0f5, symbol: '●', name: 'Blue', tier: 2 },
  { hex: 0xc9a8e8, symbol: '◆', name: 'Purple', tier: 3 },
  { hex: 0xa8dfa0, symbol: '♣', name: 'Green', tier: 3 },
  { hex: 0xb89a86, symbol: '✖', name: 'Brown', tier: 'mistake' },
];

/**
 * Folds a mask to the eight legal states. The single home for that rule, so
 * anything keyed by color — the table below, the glyph textures — agrees on
 * how a stray mask lands.
 */
export const colorIndex = (color: ColorMask): number => color & BROWN;

/** The fallback is unreachable past `colorIndex`; it satisfies the compiler. */
export const colorInfo = (color: ColorMask): ColorInfo =>
  COLORS[colorIndex(color)] ?? COLORS[0];
