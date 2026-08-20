import type Phaser from 'phaser';
import { describe, expect, it } from 'vitest';

import { RAW, type GameEvent } from '../core/types';
import { Kitchen } from './kitchen';
import { AMBIENCE_KEY, CUES, CueKey } from './tones';

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
  const beds: Array<{ key: string; loop: boolean; alive: boolean }> = [];
  const shutdown: Array<() => void> = [];
  let now = 0;

  const scene = {
    time: {
      get now() {
        return now;
      },
    },
    events: {
      once: (event: string, run: () => void) => {
        if (event === 'shutdown') shutdown.push(run);
      },
    },
    cache: { audio: { exists: () => baked } },
    sound: {
      play: (key: string, config: { delay: number; rate: number }) => {
        played.push({ key, delay: config.delay, rate: config.rate });
        return true;
      },
      add: (key: string, config: { loop: boolean }) => {
        const bed = { key, loop: config.loop, alive: false };
        beds.push(bed);
        return {
          play: () => {
            bed.alive = true;
          },
          destroy: () => {
            bed.alive = false;
          },
        };
      },
    },
  };

  return {
    kitchen: new Kitchen(scene as unknown as Phaser.Scene),
    played,
    beds,
    shutDown: () => shutdown.forEach((run) => run()),
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

describe('the bed', () => {
  it('is not playing until the shop opens', () => {
    // A Kitchen is built to sound events; the room tone is something the run
    // turns on, so building one must not start it.
    expect(bench().beds).toHaveLength(0);
  });

  it('loops, once opened', () => {
    const { kitchen, beds } = bench();
    kitchen.open();

    expect(beds).toStrictEqual([{ key: AMBIENCE_KEY, loop: true, alive: true }]);
  });

  it('opens once however often it is asked', () => {
    const { kitchen, beds } = bench();
    kitchen.open();
    kitchen.open();

    expect(beds).toHaveLength(1);
  });

  it('goes with the scene that owned it', () => {
    // A fresh Kitchen is built for every run, so a bed left playing would stack
    // with the next run's — a little louder on each restart.
    const { kitchen, beds, shutDown } = bench();
    kitchen.open();
    shutDown();

    expect(beds[0]?.alive).toBe(false);
  });

  it('can open again after a shutdown, and is one bed still', () => {
    const { kitchen, beds, shutDown } = bench();
    kitchen.open();
    shutDown();
    kitchen.open();

    expect(beds.filter((bed) => bed.alive)).toHaveLength(1);
  });

  it('stays quiet when nothing was baked', () => {
    const { kitchen, beds } = bench(false);
    kitchen.open();

    expect(beds).toHaveLength(0);
  });
});
