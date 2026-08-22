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
  const beds: Array<{ key: string; loop: boolean; alive: boolean; held: boolean }> = [];
  const shutdown: Array<() => void> = [];
  /** Everything still subscribed, by event — so a leak is countable. */
  const listeners: Record<string, Array<() => void>> = {};
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
      on: (event: string, run: () => void) => {
        (listeners[event] ??= []).push(run);
      },
      off: (event: string, run: () => void) => {
        listeners[event] = (listeners[event] ?? []).filter((one) => one !== run);
      },
    },
    cache: { audio: { exists: () => baked } },
    sound: {
      play: (key: string, config: { delay: number; rate: number }) => {
        played.push({ key, delay: config.delay, rate: config.rate });
        return true;
      },
      add: (key: string, config: { loop: boolean }) => {
        const bed = { key, loop: config.loop, alive: false, held: false };
        beds.push(bed);
        return {
          play: () => {
            bed.alive = true;
          },
          destroy: () => {
            bed.alive = false;
          },
          pause: () => {
            bed.held = true;
          },
          resume: () => {
            bed.held = false;
          },
        };
      },
    },
  };

  const fire = (event: string) => (listeners[event] ?? []).forEach((run) => run());

  return {
    kitchen: new Kitchen(scene as unknown as Phaser.Scene),
    played,
    beds,
    scene,
    shutDown: () => shutdown.forEach((run) => run()),
    // Driven through the scene the way Phaser drives it, rather than by calling
    // the methods: what is worth checking is that the kitchen is *listening*.
    pause: () => fire('pause'),
    unpause: () => fire('resume'),
    subscribed: (event: string) => (listeners[event] ?? []).length,
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

    expect(beds).toStrictEqual([
      { key: AMBIENCE_KEY, loop: true, alive: true, held: false },
    ]);
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

  it('opens a fresh bed after a shutdown, rather than reviving the old one', () => {
    // Asserting only that one bed is alive would pass on a `close` that did
    // nothing at all: the old bed would still be playing, and the second `open`
    // would no-op against a handle that had never been cleared. So both halves
    // are named — the old one is down, and a new one is up.
    const { kitchen, beds, shutDown } = bench();
    kitchen.open();
    shutDown();
    kitchen.open();

    expect(beds).toHaveLength(2);
    expect(beds[0]?.alive).toBe(false);
    expect(beds[1]?.alive).toBe(true);
  });

  it('stays quiet when nothing was baked', () => {
    const { kitchen, beds } = bench(false);
    kitchen.open();

    expect(beds).toHaveLength(0);
  });

  it('holds the room tone while the game is paused, and lets it back in', () => {
    // The one part of a paused run that does not stop by itself: `scene.sound`
    // is the game-global manager, so the loop outlives the paused scene's
    // update and has to be told. Held rather than destroyed — a bed closed and
    // reopened restarts the loop from its head, which is audible as a seam at
    // exactly the moment the player is listening for the game coming back.
    //
    // Driven through the scene rather than by calling the methods, because what
    // can actually break is the kitchen not being subscribed at all.
    const { kitchen, beds, pause, unpause } = bench();
    kitchen.open();

    pause();
    expect(beds[0]?.held).toBe(true);
    expect(beds[0]?.alive).toBe(true);

    unpause();
    expect(beds[0]?.held).toBe(false);
    expect(beds).toHaveLength(1);
  });

  it('has nothing to hold when there is no bed to hold', () => {
    // Pause reaches the kitchen through a scene event, which fires whether or
    // not the shop was ever opened — on a silent build there is no bed at all.
    const { pause, unpause } = bench(false);

    expect(() => {
      pause();
      unpause();
    }).not.toThrow();
  });

  it('stops listening for the pause when the scene goes', () => {
    // Phaser does not do this for us: `Systems.shutdown` clears only its own
    // transition events, and `removeAllListeners` lives in `destroy`, which a
    // restarted scene never reaches. A fresh Kitchen per run against an emitter
    // that outlives them all is a pair of listeners added every time — benign
    // while `pause` is idempotent, and unbounded regardless.
    const { shutDown, subscribed } = bench();

    expect(subscribed('pause')).toBe(1);
    expect(subscribed('resume')).toBe(1);

    shutDown();

    expect(subscribed('pause')).toBe(0);
    expect(subscribed('resume')).toBe(0);
  });
});
