import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';
import { COLORS, colorIndex } from '../core/colors';
import type { ColorMask } from '../core/types';

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
  Dye: 'dye',
  Floor: 'floor',
} as const;
export type TextureKey = (typeof TextureKey)[keyof typeof TextureKey];

/**
 * Glyph textures are keyed by color mask rather than listed in `TextureKey`,
 * because they are baked from the palette in `core/colors.ts` rather than from
 * a pixel map here. Still a checked type, so a sprite can only ever be handed
 * a key that something generates.
 */
export type GlyphTextureKey = `glyph-${number}`;
export const glyphTextureKey = (color: ColorMask): GlyphTextureKey =>
  `glyph-${colorIndex(color)}`;

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

/**
 * A dye jar: a narrow neck flaring into a round belly. The silhouette is what
 * separates it from both the strand's lozenge and sugar's square pastille —
 * the tint only says *which* primary it is, never *that* it is a jar.
 */
const DYE = [
  '..AAAA..',
  '..A99A..',
  '..A99A..',
  '.A9999A.',
  'A999999A',
  'A999999A',
  'A999999A',
  '.AAAAAA.',
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
  [TextureKey.Dye]: DYE,
  [TextureKey.Floor]: FLOOR,
};

/** Half a cell: big enough to read, small enough to sit inside the lozenge. */
const GLYPH_SIZE = 16;

export const generateTextures = (scene: Phaser.Scene): void => {
  for (const [key, data] of Object.entries(PIXEL_MAPS)) {
    scene.textures.generate(key, { data, palette: PALETTE });
  }
};

/**
 * Bakes the eight accessibility symbols (design §4) into textures, once, at
 * boot. They are font glyphs rather than pixel maps — at 8×8 these shapes are
 * illegible — but baking them means the board stamps pooled Images like every
 * other sprite instead of carrying a Text object per segment, and Phaser backs
 * every Text with its own canvas.
 *
 * Drawn white so a tint can ink them dark, and baked at their display size so
 * `pixelArt: true`'s nearest-neighbour filtering samples them 1:1.
 */
export const generateGlyphTextures = (scene: Phaser.Scene): void => {
  COLORS.forEach((info, color) => {
    const label = scene.make.text(
      {
        text: info.symbol,
        style: { fontFamily: 'sans-serif', fontSize: '13px', color: '#ffffff' },
        origin: { x: 0.5, y: 0.5 },
      },
      false,
    );

    const baked = scene.make.renderTexture(
      { width: GLYPH_SIZE, height: GLYPH_SIZE },
      false,
    );
    baked.draw(label, GLYPH_SIZE / 2, GLYPH_SIZE / 2);
    baked.saveTexture(glyphTextureKey(color));

    // A saved RenderTexture leaves its texture registered when destroyed, so
    // neither object has to outlive this loop.
    baked.destroy();
    label.destroy();
  });
};
