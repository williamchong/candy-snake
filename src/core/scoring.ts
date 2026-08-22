import { colorInfo, type ColorTier } from './colors';
import { patienceFraction } from './customers';
import type { Customer } from './types';

/**
 * What a serve is worth, by how hard the color was to make (design §9). Brown
 * is in the table because the mystery customer who accepts it pays for the
 * cleanup; nobody orders brown until Phase 5 puts that customer in.
 */
const BASE_POINTS: Record<ColorTier, number> = { 1: 10, 2: 25, 3: 50, mistake: 40 };

/** A serve with the bar still full is worth half as much again. */
const PATIENCE_BONUS = 0.5;

const STREAK_STEP = 1.1;
const STREAK_CAP = 2;

/**
 * Flat bonus per child already served off the same chopped batch (design §9).
 * Additive after the multiplier, deliberately not a fourth multiplier: the
 * batch is worth something *as a batch*, at the same rate however the run is
 * otherwise going. A one-segment chop can never earn it.
 */
const COMBO_BONUS = 15;

/**
 * The reward for serving without losing anyone. `streak` is the run of serves
 * *before* this one, so the first serve after a loss pays flat and the bonus
 * has to be earned back (design §9).
 */
export const streakMultiplier = (streak: number): number =>
  Math.min(STREAK_STEP ** streak, STREAK_CAP);

/**
 * Points for one serve. Rounded once at the end rather than per term, so the
 * bonus and the multiplier cannot each shed a fraction on the way through —
 * the combo addend is already an integer, so it joins after the round.
 * `batchServes` is the children served off the same batch *before* this one,
 * so the first serve of a batch pays nothing extra and a shelf serve, which
 * has no batch behind it, passes nothing.
 */
export const scoreServe = (
  customer: Customer,
  streak: number,
  batchServes = 0,
): number => {
  const base = BASE_POINTS[colorInfo(customer.want).tier];
  const earned = base + base * PATIENCE_BONUS * patienceFraction(customer.patience);

  return Math.round(earned * streakMultiplier(streak)) + COMBO_BONUS * batchServes;
};
