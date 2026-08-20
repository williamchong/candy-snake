/**
 * The only thing in the game that outlives the tab: the high-score table and
 * the settings the player has changed. One versioned JSON blob under one key
 * (architecture §10) — two keys are two things that can disagree about which
 * version they are.
 *
 * Split the way `ui/safeArea.ts` is split, and for the same reason. Parsing and
 * ranking are pure arithmetic and unit tested; the handful of functions that
 * reach for `localStorage` are guarded and covered by the smoke driver with the
 * rest of the runtime layer. Nothing here touches the browser at import time,
 * so the module loads under Node.
 */

/**
 * Bumped when a stored blob can no longer be read as this shape. Spelled once:
 * the key carries it, the type pins it and the parse checks it, and a migration
 * that has to find four copies of a `1` is a migration that will miss one.
 */
const VERSION = 1;
const KEY = `candy-snake:v${VERSION}`;

/** Design §9 keeps ten. A run has to beat one of them to get in. */
const TOP_SCORES = 10;

export interface ScoreEntry {
  readonly score: number;
  /**
   * The day it was set, as an ISO date. A date and nothing else: design §11
   * wants the table entry-free — no name is asked for, so none is stored.
   */
  readonly at: string;
}

/**
 * Player preferences. Exactly one of the four design names has a feature behind
 * it today; mute, the D-pad and high-contrast symbols join it here when they
 * land, and `parseSave` already reads a blob written before they existed.
 */
export interface Settings {
  /** Design §5: the sheet is up unless the player has put it away. */
  readonly cheatSheetOpen: boolean;
}

export interface SaveData {
  readonly version: typeof VERSION;
  readonly highScores: readonly ScoreEntry[];
  readonly settings: Settings;
}

/** What a first run reads, and what any unreadable blob falls back to. */
export const DEFAULTS: SaveData = {
  version: VERSION,
  highScores: [],
  settings: { cheatSheetOpen: true },
};

/**
 * The table, in the only order it is ever held in. Both the parse and the
 * insert need it — the menu displays what is stored without re-sorting, so
 * "best first, ten at most" has to be true of anything that leaves here.
 */
const ranked = (entries: readonly ScoreEntry[]): readonly ScoreEntry[] =>
  [...entries].sort((a, b) => b.score - a.score).slice(0, TOP_SCORES);

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Today, as the calendar on the player's wall has it. `toISOString` would date a
 * morning run in Hong Kong to the day before, which is the one thing a date on a
 * score is for.
 *
 * A wall clock, so it could not live in `core/` (architecture §2) — but it does
 * belong here rather than in the screen that calls it: this file declares what
 * `at` is, and holding only one end of a format is how the two ends drift.
 */
export const today = (): string => {
  const now = new Date();
  const pad = (value: number): string => `${value}`.padStart(2, '0');

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/**
 * `2026-08-21` as `21 Aug`. Written out rather than left to
 * `toLocaleDateString` so the table reads the same on every machine, and falls
 * back to the stored string rather than to `Invalid Date` if it was ever
 * hand-edited.
 */
export const asDay = (at: string): string => {
  const parts = at.split('-');
  const month = MONTHS[Number(parts[1]) - 1];
  const day = Number(parts[2]);

  return month === undefined || !Number.isFinite(day) ? at : `${day} ${month}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** A stored entry is only an entry if every field survived the round trip. */
const readEntry = (value: unknown): ScoreEntry | undefined => {
  if (!isRecord(value)) return undefined;

  const { score, at } = value;
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  if (typeof at !== 'string') return undefined;

  return { score, at };
};

/**
 * Anything unreadable is a first run: missing, unparseable, written by a
 * version that is not this one, or shaped wrong. Falling back silently is the
 * rule (architecture §10) — a player who opens the game to a console error
 * because their storage was edited has lost more than their scores.
 *
 * Fields are read one at a time rather than trusted wholesale, so a blob that
 * predates a setting keeps the rest of itself and takes the default for that
 * one.
 */
export const parseSave = (raw: string | null): SaveData => {
  if (raw === null) return DEFAULTS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }

  if (!isRecord(parsed) || parsed.version !== DEFAULTS.version) return DEFAULTS;

  const storedScores = Array.isArray(parsed.highScores) ? parsed.highScores : [];
  const storedSettings = isRecord(parsed.settings) ? parsed.settings : {};
  const { cheatSheetOpen } = storedSettings;

  return {
    version: VERSION,
    highScores: ranked(
      storedScores
        .map(readEntry)
        .filter((entry): entry is ScoreEntry => entry !== undefined),
    ),
    settings: {
      cheatSheetOpen:
        typeof cheatSheetOpen === 'boolean'
          ? cheatSheetOpen
          : DEFAULTS.settings.cheatSheetOpen,
    },
  };
};

/**
 * Where a run lands, and the table it lands in. `rank` is 1-based, or
 * `undefined` for a run that missed the ten — which is what lets the game-over
 * screen say nothing rather than say "#14".
 *
 * Counted rather than looked up, so the answer does not depend on the caller
 * handing over an entry that is not already in the table. Everyone a run ties
 * counts as ahead of it: a place has to be beaten out of the player holding it,
 * not merely matched.
 *
 * A run worth nothing lands nowhere. The first death of a first install comes
 * during the teaching levels and scores 0, and an empty table would otherwise
 * seat it first and send the score screen off to call it a new best under a
 * number reading zero.
 */
export const insertScore = (
  scores: readonly ScoreEntry[],
  entry: ScoreEntry,
): { readonly scores: readonly ScoreEntry[]; readonly rank: number | undefined } => {
  if (entry.score <= 0) return { scores, rank: undefined };

  const place = scores.filter(({ score }) => score >= entry.score).length + 1;

  return {
    scores: ranked([...scores, entry]),
    rank: place <= TOP_SCORES ? place : undefined,
  };
};

/**
 * The loaded blob, held in module state so it survives menu → game → game over
 * → game without a scene having to own it — the same idiom the cheat sheet used
 * before this module existed.
 */
let save: SaveData | undefined;

const read = (): SaveData => {
  if (typeof localStorage === 'undefined') return DEFAULTS;

  try {
    return parseSave(localStorage.getItem(KEY));
  } catch {
    // Reading storage throws outright when the browser has it switched off,
    // which is a first run by another name.
    return DEFAULTS;
  }
};

/** `BootScene` calls this so the read happens at a known moment (architecture §3). */
export const loadSave = (): SaveData => (save = read());

/**
 * Lazy as well as eager, so no caller can be wrong about the order and a first
 * write can never clobber a table that was simply never read.
 */
const current = (): SaveData => save ?? loadSave();

const write = (next: SaveData): void => {
  save = next;
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or locked-down store is not worth a broken game: the session keeps
    // what it has in memory and the next load starts from defaults.
  }
};

export const settings = (): Settings => current().settings;

export const updateSettings = (patch: Partial<Settings>): void => {
  const now = current();
  write({ ...now, settings: { ...now.settings, ...patch } });
};

export const highScores = (): readonly ScoreEntry[] => current().highScores;

/** Saves the run and answers where it placed. Design §11: no entry screen. */
export const recordScore = (entry: ScoreEntry): number | undefined => {
  const now = current();
  const { scores, rank } = insertScore(now.highScores, entry);

  // A run that missed the ten leaves the table exactly as it found it, and a
  // write of an unchanged blob is a blocking `setItem` bought for nothing —
  // which, once a player has ten runs banked, is most game-overs.
  if (rank !== undefined) write({ ...now, highScores: scores });

  return rank;
};
