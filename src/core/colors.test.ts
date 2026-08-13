import { describe, expect, it } from 'vitest';

import {
  BLUE,
  BROWN,
  COLORS,
  PRIMARIES,
  RED,
  YELLOW,
  blend,
  colorInfo,
  type Primary,
} from './colors';
import { RAW, type ColorMask } from './types';

const maskOf = (name: string): ColorMask => {
  const mask = COLORS.findIndex((info) => info.name === name);
  if (mask < 0) throw new Error(`no color named ${name}`);
  return mask;
};

/**
 * The full 8×3 mixing table from design §4, written out by name rather than
 * derived — the point is to pin the rules, not to restate `|`.
 */
const MIXES: ReadonlyArray<readonly [string, Primary, string]> = [
  ['Raw', RED, 'Red'],
  ['Raw', YELLOW, 'Yellow'],
  ['Raw', BLUE, 'Blue'],

  ['Red', RED, 'Red'],
  ['Red', YELLOW, 'Orange'],
  ['Red', BLUE, 'Purple'],

  ['Yellow', RED, 'Orange'],
  ['Yellow', YELLOW, 'Yellow'],
  ['Yellow', BLUE, 'Green'],

  ['Blue', RED, 'Purple'],
  ['Blue', YELLOW, 'Green'],
  ['Blue', BLUE, 'Blue'],

  ['Orange', RED, 'Orange'],
  ['Orange', YELLOW, 'Orange'],
  ['Orange', BLUE, 'Brown'],

  ['Purple', RED, 'Purple'],
  ['Purple', YELLOW, 'Brown'],
  ['Purple', BLUE, 'Purple'],

  ['Green', RED, 'Brown'],
  ['Green', YELLOW, 'Green'],
  ['Green', BLUE, 'Green'],

  ['Brown', RED, 'Brown'],
  ['Brown', YELLOW, 'Brown'],
  ['Brown', BLUE, 'Brown'],
];

describe('blend', () => {
  it.each(MIXES)('mixes %s with dye %d into %s', (start, dye, expected) => {
    expect(blend(maskOf(start), dye)).toBe(maskOf(expected));
  });

  it('is idempotent — a primary already in the mix changes nothing', () => {
    for (const primary of PRIMARIES) {
      expect(blend(primary, primary)).toBe(primary);
    }
  });

  it('makes brown absorbing, so the over-mix trap has no way out', () => {
    for (const primary of PRIMARIES) {
      expect(blend(BROWN, primary)).toBe(BROWN);
    }
  });

  it('reaches every one of the eight states from raw', () => {
    const reached = new Set<ColorMask>([RAW]);
    for (const first of PRIMARIES) {
      for (const second of PRIMARIES) {
        for (const third of PRIMARIES) {
          reached.add(blend(blend(blend(RAW, first), second), third));
        }
      }
    }

    expect(reached.size).toBe(COLORS.length);
  });
});

describe('palette', () => {
  it('describes all eight states', () => {
    expect(COLORS).toHaveLength(8);
    for (let mask = 0; mask <= BROWN; mask += 1) {
      expect(colorInfo(mask).name).toBe(COLORS[mask]?.name);
    }
  });

  it('gives every state its own hex and its own symbol', () => {
    expect(new Set(COLORS.map((info) => info.hex)).size).toBe(COLORS.length);
    expect(new Set(COLORS.map((info) => info.symbol)).size).toBe(COLORS.length);
  });

  it('tiers by how many primaries a color takes to make', () => {
    expect(colorInfo(RAW).tier).toBe(1);
    for (const primary of PRIMARIES) expect(colorInfo(primary).tier).toBe(2);
    expect(colorInfo(RED | BLUE).tier).toBe(3);
    expect(colorInfo(BROWN).tier).toBe('mistake');
  });
});
