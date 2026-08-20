import { describe, expect, it } from 'vitest';

import {
  asDay,
  DEFAULTS,
  insertScore,
  parseSave,
  today,
  type ScoreEntry,
} from './storage';

/** A run worth a known number of points, on a day that does not matter. */
const run = (score: number, at = '2026-08-21'): ScoreEntry => ({ score, at });

/** A full table, best first, so the tenth place is a real boundary. */
const full: readonly ScoreEntry[] = Array.from({ length: 10 }, (_, i) =>
  run(1_000 - i * 100),
);

describe('parseSave', () => {
  it('opens on defaults when there is nothing stored', () => {
    expect(parseSave(null)).toEqual(DEFAULTS);
  });

  it('opens on defaults rather than throwing on a blob that is not JSON', () => {
    expect(parseSave('{')).toEqual(DEFAULTS);
    expect(parseSave('')).toEqual(DEFAULTS);
    expect(parseSave('null')).toEqual(DEFAULTS);
  });

  it('opens on defaults when the blob was written by another version', () => {
    const stored = JSON.stringify({ ...DEFAULTS, version: 2 });

    expect(parseSave(stored)).toEqual(DEFAULTS);
  });

  it('reads back what it wrote', () => {
    const saved = {
      version: 1,
      highScores: [run(500), run(200)],
      settings: { cheatSheetOpen: false },
    };

    expect(parseSave(JSON.stringify(saved))).toEqual(saved);
  });

  it('drops entries that lost a field and keeps the ones that did not', () => {
    const stored = JSON.stringify({
      version: 1,
      highScores: [run(500), { score: 400 }, { at: '2026-08-21' }, 7, run(300)],
      settings: {},
    });

    expect(parseSave(stored).highScores).toEqual([run(500), run(300)]);
  });

  it('takes the default for a setting the stored blob has never heard of', () => {
    // The blob a player carries over from before a setting existed. Every other
    // field of theirs has to survive it.
    const stored = JSON.stringify({ version: 1, highScores: [run(500)], settings: {} });
    const { highScores, settings } = parseSave(stored);

    expect(settings).toEqual(DEFAULTS.settings);
    expect(highScores).toEqual([run(500)]);
  });

  it('takes the default for a setting stored as the wrong type', () => {
    const stored = JSON.stringify({
      version: 1,
      highScores: [],
      settings: { cheatSheetOpen: 'yes' },
    });

    expect(parseSave(stored).settings.cheatSheetOpen).toBe(true);
  });

  it('puts a hand-edited table back in order, and keeps only ten of it', () => {
    const stored = JSON.stringify({
      version: 1,
      highScores: [run(100), run(900), run(400)],
      settings: DEFAULTS.settings,
    });

    expect(parseSave(stored).highScores.map(({ score }) => score)).toEqual([
      900, 400, 100,
    ]);
    expect(
      parseSave(JSON.stringify({ ...DEFAULTS, highScores: full.concat(full) }))
        .highScores,
    ).toHaveLength(10);
  });
});

describe('insertScore', () => {
  it('places a first run at the top', () => {
    const { scores, rank } = insertScore([], run(120));

    expect(rank).toBe(1);
    expect(scores).toEqual([run(120)]);
  });

  it('keeps a run worth nothing off the table, even an empty one', () => {
    // The first death of a first install: it scores 0 during the teaching
    // levels, and an empty table would otherwise call it a new best.
    const { scores, rank } = insertScore([], run(0));

    expect(rank).toBeUndefined();
    expect(scores).toEqual([]);
  });

  it('sorts the run into the table it landed in', () => {
    const { scores, rank } = insertScore([run(300), run(100)], run(200));

    expect(rank).toBe(2);
    expect(scores.map(({ score }) => score)).toEqual([300, 200, 100]);
  });

  it('leaves the holder of a tied score in front', () => {
    // Matching a place is not taking it: the incumbent set it first.
    const held = run(300, '2020-01-01');
    const { scores, rank } = insertScore([held], run(300));

    expect(rank).toBe(2);
    expect(scores[0]).toBe(held);
  });

  it('keeps the table at ten however good the run was', () => {
    const { scores, rank } = insertScore(full, run(5_000));

    expect(rank).toBe(1);
    expect(scores).toHaveLength(10);
    // The old tenth is the one that falls off, not the new arrival.
    expect(scores.map(({ score }) => score)).toEqual([
      5_000, 1_000, 900, 800, 700, 600, 500, 400, 300, 200,
    ]);
  });

  it('says nothing about a run that missed the table', () => {
    const { scores, rank } = insertScore(full, run(1));

    expect(rank).toBeUndefined();
    expect(scores).toEqual(full);
  });

  it('gives the last place away to a run that beat it by a point', () => {
    const { scores, rank } = insertScore(full, run(101));

    expect(rank).toBe(10);
    expect(scores.at(-1)).toEqual(run(101));
  });
});

describe('today / asDay', () => {
  it('writes a date the reader can read back', () => {
    // The two ends of one format, and nothing else enforces that they agree.
    expect(asDay(today())).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/);
  });

  it('drops the leading zero a stored date keeps', () => {
    expect(asDay('2026-08-09')).toBe('9 Aug');
    expect(asDay('2026-12-31')).toBe('31 Dec');
    expect(asDay('2026-01-01')).toBe('1 Jan');
  });

  it('hands back a date it cannot read rather than saying "Invalid Date"', () => {
    expect(asDay('yesterday')).toBe('yesterday');
    expect(asDay('2026-13-01')).toBe('2026-13-01');
    expect(asDay('')).toBe('');
  });
});
