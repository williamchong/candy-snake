import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
    /**
     * The balance sweeps are the reason this is not the 5 s default. A 64-seed
     * draw of a reference player is a real second or three of arithmetic, and
     * the runner is about three times slower than the machine it was written
     * on: the median test reads 3.0 s locally and 8.8 s in CI, which is how it
     * went red while every gate passed at the desk.
     *
     * Raised globally rather than per test, because the file has four sweeps
     * inside that margin and only the two loudest ever got a budget of their
     * own — the next one to cross would have failed the same way, on a runner,
     * after the change that pushed it. A timeout is a guard against a hung
     * test, and 20 s is still that; it is not a performance budget, and using
     * it as one is what made a slow test look like a broken one.
     */
    testTimeout: 20_000,
  },
});
