import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';
import { COLORS, colorIndex } from '../core/colors';
import type { ColorMask } from '../core/types';
import { StrandPiece } from './strand';

/**
 * Cotton-candy art direction (design §2): soft pastels, minimal detail, and a
 * floor of faint diagonal rainbow bands. Sprites are ASCII pixel maps baked at
 * boot with no image assets (architecture §7).
 *
 * Everything on the board except the strand is authored at 8×8 and doubled.
 * The strand alone is authored at 16×16, because it is the one sprite that has
 * to meet its neighbours edge to edge: a rope needs a flank thinner than half a
 * source pixel at 8×8.
 */
export const TEXTURE_SIZE = 16;
export const CELL_SIZE = 32;
export const PIXEL_SCALE = CELL_SIZE / TEXTURE_SIZE;

export const TextureKey = {
  Head: 'head',
  Segment: 'segment',
  StrandStraight: 'strand-straight',
  StrandCorner: 'strand-corner',
  StrandTail: 'strand-tail',
  Sugar: 'sugar',
  Dye: 'dye',
  Candy: 'candy',
  Block: 'block',
  Floor: 'floor',
} as const;
export type TextureKey = (typeof TextureKey)[keyof typeof TextureKey];

/** The rope pieces `strand.ts` names, resolved to the textures baked here. */
export const STRAND_TEXTURES: Record<StrandPiece, TextureKey> = {
  [StrandPiece.Straight]: TextureKey.StrandStraight,
  [StrandPiece.Corner]: TextureKey.StrandCorner,
  [StrandPiece.Tail]: TextureKey.StrandTail,
};

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

const FILL = '9';
const SOFT_EDGE = 'A';
const TRANSPARENT = '.';

/**
 * One fixed 16-color palette for the whole game — pixel maps index into it by
 * character ('.' is transparent).
 *
 * Sprite pixels are grays because tinting multiplies: white takes the full
 * candy color and the gray edge becomes a slightly deeper shade of it. That
 * keeps every sprite readable without a hard outline, and lets one texture
 * serve every color the palette in design §4 can produce.
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
  [FILL]: '#ffffff',
  [SOFT_EDGE]: '#cfcfcf',
  B: UNUSED,
  C: UNUSED,
  D: UNUSED,
  E: UNUSED,
  F: UNUSED,
};

/** What the hand-authored maps below are drawn at, before doubling. */
const SOURCE_SIZE = 8;

/**
 * Doubles an 8×8 map to 16×16. The flat sprites are authored at the size they
 * were designed at and blown up here, so they render pixel-for-pixel as they
 * always did while sharing one texture size with the strand.
 *
 * A miscounted row or column throws here rather than leaving a silently clipped
 * sprite on the board — and it throws in the units the map is *written* in, so
 * the message points at what to go and count.
 */
const upscale = (map: string[]): string[] => {
  const wrong =
    map.length !== SOURCE_SIZE || map.some((row) => row.length !== SOURCE_SIZE);
  if (wrong) throw new Error(`pixel map is not ${SOURCE_SIZE}×${SOURCE_SIZE}`);

  return map.flatMap((row) => {
    const doubled = [...row].map((pixel) => pixel + pixel).join('');
    return [doubled, doubled];
  });
};

/** Whether a source pixel is part of the shape at all. */
type Shape = (x: number, y: number) => boolean;

const MID = (TEXTURE_SIZE - 1) / 2;

const within = (value: number, low: number, high: number): boolean =>
  value >= low && value <= high;

const inDisc = (x: number, y: number, cx: number, cy: number, r: number): boolean =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/**
 * How thick the soft edge is, in source pixels. Two, because the hand-authored
 * sprites are drawn at 8×8 with a one-pixel edge and then doubled — so a rim of
 * one here would come out half as thick as the rim on everything it sits next
 * to, which is exactly the kind of mismatch that reads as two art styles.
 */
const RIM_WIDTH = 2;

/**
 * Whether a solid pixel sits on the shape's inner rim — the soft edge every
 * sprite in this game wears instead of a hard outline.
 *
 * Pixels *outside* the texture count as solid, not empty. The rope spans its
 * cell edge to edge, and a rim drawn along that border would show a seam at
 * every joint between two segments — which is exactly the row-of-beads look the
 * continuous strand exists to replace.
 */
const onRim = (shape: Shape, px: number, py: number): boolean => {
  const inTexture = (v: number): boolean => within(v, 0, TEXTURE_SIZE - 1);

  for (let y = py - RIM_WIDTH; y <= py + RIM_WIDTH; y += 1) {
    for (let x = px - RIM_WIDTH; x <= px + RIM_WIDTH; x += 1) {
      if (inTexture(x) && inTexture(y) && !shape(x, y)) return true;
    }
  }
  return false;
};

/**
 * Turns a shape into a pixel map: a flat fill with one soft edge, which is the
 * same two tones the hand-authored sprites below are drawn in. Generated rather
 * than hand-drawn because the strand needs the same shape at four rotations,
 * and a rim that follows an arbitrary outline is exactly what a hand keeps
 * getting wrong.
 */
const shade = (shape: Shape): string[] =>
  Array.from({ length: TEXTURE_SIZE }, (_row, y) =>
    Array.from({ length: TEXTURE_SIZE }, (_col, x) => {
      if (!shape(x, y)) return TRANSPARENT;
      return onRim(shape, x, y) ? SOFT_EDGE : FILL;
    }).join(''),
  );

/**
 * The rope's flanks. One transparent pixel either side keeps the strand a hair
 * narrower than its cell, so a turn reads as a rope bending rather than as the
 * floor being tiled over.
 */
const ROPE_NEAR = 1;
const ROPE_FAR = TEXTURE_SIZE - 2;
const onRope = (across: number): boolean => within(across, ROPE_NEAR, ROPE_FAR);

/** Rope running east–west; rotated a right angle for north–south. */
const STRAIGHT = shade((_x, y) => onRope(y));

/**
 * Rope turning east→south. Both arms run to their own edge so the piece meets
 * its neighbours exactly where a straight one would; the notch left at the
 * inside of the bend is the turn's short side.
 */
const CORNER = shade(
  (x, y) => (onRope(y) && x >= ROPE_NEAR) || (onRope(x) && y >= ROPE_NEAR),
);

/** The loose end: rope leaving east, rounded off to the west. */
const TAIL = shade(
  (x, y) => onRope(y) && (x >= MID || inDisc(x, y, MID, MID, TEXTURE_SIZE / 2 - 1)),
);

/**
 * A soft rounded lozenge. The live strand is drawn as rope now, but a piece cut
 * loose is not rope any more — debris and the shard puff still come apart as
 * these.
 */
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
 * separates it from both the strand's rope and sugar's square pastille — the
 * tint only says *which* primary it is, never *that* it is a jar.
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

/**
 * A wrapped sweet: the pinched twists at either end are the whole point of the
 * silhouette. A candy is a segment that has been through the block, so it must
 * not read as one — same tint, different shape.
 */
const CANDY = [
  '........',
  'A..AA..A',
  'AA9999AA',
  'A999999A',
  'A999999A',
  'AA9999AA',
  'A..AA..A',
  '........',
];

/**
 * The chopping block: a slab of three planks that fills its cell edge to edge,
 * so a run of them reads as one bench. The planks run *down* the cell, along
 * the bench's own length — grain across the run would read as three separate
 * slabs. Station, not candy — it is tinted by value rather than hue (design §4,
 * palette constraints).
 */
const BLOCK = [
  'AAAAAAAA',
  'A989989A',
  'A989989A',
  'A989989A',
  'A989989A',
  'A989989A',
  'A989989A',
  'AAAAAAAA',
];

const FLOOR_BANDS = ['1', '2', '3', '4', '5', '6'];
const BAND_WIDTH = 3;

/**
 * The kitchen floor, one source pixel per board cell: broad diagonal bands of
 * pale rainbow. Two rules hold it in place — the bands stay within a couple
 * of percent of each other in lightness so the floor reads as a soft wash
 * rather than competing with the candy sitting on it, and the whole floor sits
 * a clear step *below* the palest candy, because raw sugar is off-white and has
 * to remain visible on it (design §4, palette constraints).
 *
 * Baking it beats drawing a grid with a Graphics, which would replay its
 * whole command buffer every frame; this is a single quad.
 */
const FLOOR = Array.from({ length: ROWS }, (_row, y) =>
  Array.from(
    { length: COLS },
    (_col, x) =>
      FLOOR_BANDS[Math.floor((x + y) / BAND_WIDTH) % FLOOR_BANDS.length] ?? '1',
  ).join(''),
);

/** Typed by TextureKey, so a new key without a pixel map is a compile error. */
const PIXEL_MAPS: Record<TextureKey, string[]> = {
  [TextureKey.StrandStraight]: STRAIGHT,
  [TextureKey.StrandCorner]: CORNER,
  [TextureKey.StrandTail]: TAIL,
  [TextureKey.Segment]: upscale(SEGMENT),
  [TextureKey.Head]: upscale(HEAD),
  [TextureKey.Sugar]: upscale(SUGAR),
  [TextureKey.Dye]: upscale(DYE),
  [TextureKey.Candy]: upscale(CANDY),
  [TextureKey.Block]: upscale(BLOCK),
  [TextureKey.Floor]: FLOOR,
};

/** Half a cell: big enough to read, small enough to sit inside the rope. */
const GLYPH_SIZE = 16;

export const generateTextures = (scene: Phaser.Scene): void => {
  for (const [key, data] of Object.entries(PIXEL_MAPS)) {
    scene.textures.generate(key, { data, palette: PALETTE });
  }
};

/**
 * Bakes the eight accessibility symbols (design §4) into textures, once, at
 * boot. They are font glyphs rather than pixel maps — at this size these shapes
 * are illegible drawn by hand — but baking them means the board stamps pooled
 * Images like every other sprite instead of carrying a Text object per segment,
 * and Phaser backs every Text with its own canvas.
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
