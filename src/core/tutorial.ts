import { PRIMARIES, primariesOf, type Primary } from './colors';
import type { Rng } from './rng';
import { RAW, type ColorMask } from './types';

/**
 * The three opening levels, which every run starts with (design §7). Each is
 * one customer, and the board is stocked with exactly what that order needs and
 * nothing else:
 *
 * 1. raw — one sugar, no jars: pull sugar, chop at the block.
 * 2. a primary — that jar only: cross the sugar *first*, then the jar.
 * 3. a secondary — those two jars: two dyes blend into one color.
 *
 * A restricted board teaches better than any text can — in level 2 the only jar
 * on the floor is the one the order wants, so "wrong dye" is not yet a mistake
 * the player is able to make. Difficulty here is authored by removing options.
 */
export interface TutorialLevel {
  readonly want: ColorMask;
  /** The only dye jars the spawner stocks while this level is running. */
  readonly stock: readonly Primary[];
}

/** A beat between levels, so the serve reads before the next child walks up. */
export const TUTORIAL_ARRIVAL_GAP_MS = 1_000;

const level = (want: ColorMask): TutorialLevel => ({ want, stock: primariesOf(want) });

/**
 * Rolls the three orders from the run's seed, so the tutorial teaches the rule
 * rather than a memorised answer.
 *
 * Level 3 deliberately **extends** level 2's primary instead of drawing a fresh
 * pair. It reads as a progression — you made yellow, now add red for orange —
 * and it means the stocked set only ever grows, so no jar is ever removed from
 * the board mid-run. Nothing on this board teleports, and that includes the
 * tutorial's own furniture.
 */
export const rollTutorial = (rng: Rng): TutorialLevel[] => {
  const first = PRIMARIES[rng.int(PRIMARIES.length)] ?? PRIMARIES[0];
  const rest = PRIMARIES.filter((primary) => primary !== first);
  const second = rest[rng.int(rest.length)] ?? PRIMARIES[1];

  return [level(RAW), level(first), level(first | second)];
};

/**
 * The jars the spawner keeps on the board: the level's own stock while the
 * tutorial runs, and every primary once it is over — which is the floor the
 * game had before, and what Phase 5's pity spawner replaces (design §8).
 */
export const stockedPrimaries = (level: TutorialLevel | undefined): readonly Primary[] =>
  level?.stock ?? PRIMARIES;
