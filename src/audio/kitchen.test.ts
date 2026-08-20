import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';

import { RAW, type GameEvent } from '../core/types';
import { Kitchen } from './kitchen';
import { CUES, CueKey } from './tones';

/**
 * `kitchen.ts` imports Phaser for its types only, so it loads under Node and
 * the bookkeeping that decides *whether* a cue plays can be tested here rather
 * than left to a smoke driver that cannot hear (CLAUDE.md — the dividing line
 * is the import, not the directory).
 *
 * Enough of a scene to be played into: a clock that only moves when a test
 * moves it, and a sound manager that writes down what it was asked for.
 */
const bench = (baked = true) => {
  const played: Array<{ key: string; delay: number; rate: number }> = [];
  let now = 0;

  const scene = {
    time: {
      get now() {
        return now;
      },
    },
    cache: { audio: { exists: () => baked } },
    sound: {
      play: (key: string, config: { delay: number; rate: number }) => {
        played.push({ key, delay: config.delay, rate: config.rate });
        return true;
      },
    },
  };

  return {
    kitchen: new Kitchen(scene as unknown as Phaser.Scene),
    played,
    wait: (ms: number) => {
      now += ms;
    },
  };
};

const pull: GameEvent = { type: 'sugar-pulled', pos: { x: 1, y: 1 }, length: 5 };
const stale: GameEvent = { type: 'candy-staled', color: RAW };

describe('Kitchen', () => {
  it('sounds an event that has a cue', () => {
    const { kitchen, played } = bench();
    kitchen.play(pull);

    expect(played).toHaveLength(1);
    expect(played[0]?.key).toBe(CueKey.Pull);
  });

  it('says nothing for an event that has none', () => {
    const { kitchen, played } = bench();
    kitchen.play({ type: 'sugar-spawned', pos: { x: 1, y: 1 } });

    expect(played).toHaveLength(0);
  });

  it('keeps sounding a cue once the last one has finished', () => {
    // The regression that matters most: a cue is asked for hundreds of times a
    // run, and bookkeeping that never drains would silence the game after four
    // pulls — a fault nothing but the ear would report.
    const { kitchen, played, wait } = bench();

    for (let n = 0; n < 20; n += 1) {
      kitchen.play(pull);
      wait(CUES[CueKey.Pull].durationMs + 1);
    }

    expect(played).toHaveLength(20);
    expect(played.every(({ delay }) => delay === 0)).toBe(true);
  });

  it('spreads a stack that lands inside one tick', () => {
    // One chop can overflow a full rack several times without the clock moving.
    const { kitchen, played } = bench();
    for (let n = 0; n < 3; n += 1) kitchen.play(stale);

    expect(played.map(({ delay }) => delay)).toStrictEqual([0, 0.07, 0.14]);
  });

  it('drops what is past the voice cap a cue sets', () => {
    const { kitchen, played } = bench();
    const { voices } = CUES[CueKey.Stale].repeat;

    for (let n = 0; n < voices + 5; n += 1) kitchen.play(stale);

    expect(played).toHaveLength(voices);
  });

  it('lets a stack drain rather than holding the cue down for good', () => {
    const { kitchen, played, wait } = bench();
    const { voices } = CUES[CueKey.Stale].repeat;

    for (let n = 0; n < voices; n += 1) kitchen.play(stale);
    wait(2000);
    kitchen.play(stale);

    expect(played).toHaveLength(voices + 1);
    expect(played[voices]?.delay).toBe(0);
  });

  it('stays quiet when the cues were never baked', () => {
    // A browser without Web Audio gets a silent game rather than a broken one,
    // and never a `play` for a key that is not in the cache.
    const { kitchen, played } = bench(false);
    kitchen.play(pull);

    expect(played).toHaveLength(0);
  });
});
