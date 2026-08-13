/**
 * Seeded PRNG (mulberry32). The core never calls Math.random — determinism
 * given (seed, inputs) is what makes runs reproducible and balancing
 * scriptable (docs/architecture.md §2).
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive); 0 when maxExclusive <= 0. */
  int(maxExclusive: number): number;
}

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => (maxExclusive > 0 ? Math.floor(next() * maxExclusive) : 0),
  };
};
