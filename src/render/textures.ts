import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';

/**
 * Cotton-candy art direction: soft pastels, minimal detail. Sprites are still
 * authored as 8×8 pixel maps and blown up by an integer factor (Phaser's
 * `pixelArt: true` supplies the nearest-neighbour filtering), but they are
 * flat shapes — a fill and a soft edge — rather than shaded blocks. There are
 * no image assets; textures are baked at boot (architecture §7).
 */
export const TEXTURE_SIZE = 8;
export const CELL_SIZE = 32;
export const PIXEL_SCALE = CELL_SIZE / TEXTURE_SIZE;

export const TextureKey = {
  Head: 'head',
  Segment: 'segment',
  Sugar: 'sugar',
  Floor: 'floor',
} as const;
export type TextureKey = (typeof TextureKey)[keyof typeof TextureKey];

/** Loud magenta, so a typo in a pixel map below is impossible to miss. */
const UNUSED = '#ff00ff';

/**
 * One fixed 16-color palette for the whole game — pixel maps index into it by
 * character ('.' is transparent).
 *
 * Sprite pixels are grays because they exist to be tinted: tinting
 * multiplies, so white takes the full candy color and the gray edge becomes a
 * slightly deeper shade of that same color. That keeps every sprite readable
 * without drawing a hard outline, and lets one texture serve every color the
 * palette in design §4 can produce.
 *
 * The floor colors are pale rainbow bands, used as-is and never tinted.
 */
const PALETTE: Phaser.Types.Create.Palette = {
  '0': UNUSED,
  '1': '#f0e4ec', // floor, pink
  '2': '#f2e8de', // floor, peach
  '3': '#f0ecd9', // floor, lemon
  '4': '#e2eee6', // floor, mint
  '5': '#e2eaf4', // floor, sky
  '6': '#eae3f2', // floor, lilac
  '7': UNUSED,
  '8': '#9a9a9a', // sprite detail (eyes)
  '9': '#ffffff', // sprite fill
  A: '#cfcfcf', // sprite soft edge
  B: UNUSED,
  C: UNUSED,
  D: UNUSED,
  E: UNUSED,
  F: UNUSED,
};

/** A soft rounded lozenge — the whole strand is made of these. */
const SEGMENT = [
  '.AAAAAA.',
  'A999999A',
  'A999999A',
  'A999999A',
  'A999999A',
  'A999999A',
  'A999999A',
  '.AAAAAA.',
];

/** The candy maker: the same lozenge, two dots for eyes, nothing more. */
const HEAD = [
  '.AAAAAA.',
  'A999999A',
  'A989989A',
  'A999999A',
  'A999999A',
  'A999999A',
  'A999999A',
  '.AAAAAA.',
];

/** Smaller than a segment, so a pickup never reads as part of the strand. */
const SUGAR = [
  '........',
  '..AAAA..',
  '.A9999A.',
  '.A9999A.',
  '.A9999A.',
  '.A9999A.',
  '..AAAA..',
  '........',
];

const FLOOR_BANDS = ['1', '2', '3', '4', '5', '6'];
const BAND_WIDTH = 3;

/**
 * The kitchen floor, one source pixel per board cell: broad diagonal bands of
 * pale rainbow. Two rules hold it in place — the bands stay within a couple
 * of percent of each other in lightness so the floor reads as a soft wash
 * rather than competing with the candy, and the whole floor sits a clear step
 * *below* the palest candy, because raw sugar is off-white and has to remain
 * visible on it (design §4, palette constraints).
 *
 * Baking it beats drawing a grid with a Graphics, which would replay its
 * whole command buffer every frame; this is a single quad.
 */
const FLOOR = Array.from({ length: ROWS }, (_, y) =>
  Array.from(
    { length: COLS },
    (_, x) => FLOOR_BANDS[Math.floor((x + y) / BAND_WIDTH) % FLOOR_BANDS.length] ?? '1',
  ).join(''),
);

/** Typed by TextureKey, so a new key without a pixel map is a compile error. */
const PIXEL_MAPS: Record<TextureKey, string[]> = {
  [TextureKey.Segment]: SEGMENT,
  [TextureKey.Head]: HEAD,
  [TextureKey.Sugar]: SUGAR,
  [TextureKey.Floor]: FLOOR,
};

export const generateTextures = (scene: Phaser.Scene): void => {
  for (const [key, data] of Object.entries(PIXEL_MAPS)) {
    scene.textures.generate(key, { data, palette: PALETTE });
  }
};
