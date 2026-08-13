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
 * The reward for serving without losing anyone. `streak` is the run of serves
 * *before* this one, so the first serve after a loss pays flat and the bonus
 * has to be earned back (design §9).
 */
export const streakMultiplier = (streak: number): number =>
  Math.min(STREAK_STEP ** streak, STREAK_CAP);

/**
 * Points for one serve. Rounded once at the end rather than per term, so the
 * bonus and the multiplier cannot each shed a fraction on the way through.
 */
export const scoreServe = (customer: Customer, streak: number): number => {
  const base = BASE_POINTS[colorInfo(customer.want).tier];
  const earned = base + base * PATIENCE_BONUS * patienceFraction(customer.patience);

  return Math.round(earned * streakMultiplier(streak));
};
