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
  Customer: 'customer',
  CustomerStride: 'customer-stride',
  Bubble: 'bubble',
  FaceCalm: 'face-calm',
  FaceWorried: 'face-worried',
  FaceHappy: 'face-happy',
  FaceCross: 'face-cross',
  Pip: 'pip',
  Speaker: 'speaker',
  SpeakerMuted: 'speaker-muted',
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
 * A miscounted row or column throws here rather than leaving a silently clipped
 * sprite on the board — and it throws in the units the map is *written* in, so
 * the message points at what to go and count.
 */
const sized = (map: string[], size: number): string[] => {
  const wrong = map.length !== size || map.some((row) => row.length !== size);
  if (wrong) throw new Error(`pixel map is not ${size}×${size}`);

  return map;
};

/**
 * Doubles an 8×8 map to 16×16. The flat sprites are authored at the size they
 * were designed at and blown up here, so they render pixel-for-pixel as they
 * always did while sharing one texture size with the strand.
 */
const upscale = (map: string[]): string[] =>
  sized(map, SOURCE_SIZE).flatMap((row) => {
    const doubled = [...row].map((pixel) => pixel + pixel).join('');
    return [doubled, doubled];
  });

/**
 * Maps authored straight at texture size, skipping `upscale`. A child is drawn
 * there rather than at 8×8 because a face needs pixels a doubled sprite does
 * not have: at 8×8 a whole head is four pixels across.
 */
const exact = (map: string[]): string[] => sized(map, TEXTURE_SIZE);

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

/**
 * A crumb: what a burst throws. Two source pixels across, so a handful of them
 * reads as sugar coming off a thing rather than as more of the thing — a crumb
 * the size of the candy it left is just a second candy.
 *
 * The only sprite here with no soft edge, and it cannot have one: at this size
 * a rim of `RIM_WIDTH` is the whole crumb. It still draws at the same scale as
 * everything else, so its pixels are the game's pixels and it reads as part of
 * the same art rather than as a smaller style.
 */
const PIP = [
  '........',
  '........',
  '........',
  '...AA...',
  '...AA...',
  '........',
  '........',
  '........',
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
 * The mute tab's icon, in two states. Chrome rather than candy, so both are
 * tinted by value like the sheet's jar and the hearts (design §4, palette
 * constraints), and both are silhouettes rather than letters because design §11
 * keeps prose out of the HUD entirely.
 *
 * The pair differs by whether any sound is leaving the cone, rather than by a
 * bar struck through it. A slash was tried first and could not be made to read:
 * everything on this tab is one flat tint, so a bar laid over the cone is the
 * same value as the cone, and a bar cut out of it staircases into a scatter of
 * specks at this size. Waves or no waves is the same question asked where the
 * glyph is empty, and it survives being glanced at — which is the only way the
 * HUD is ever read.
 *
 * Struck as shapes rather than drawn by hand for the reason `shade` gives: an
 * arc is exactly the outline a hand keeps getting wrong.
 */
const SPEAKER_MOUTH = 4;

const speakerCone: Shape = (x, y) =>
  (within(x, 1, SPEAKER_MOUTH) && Math.abs(y - MID) <= 2.5) ||
  (within(x, SPEAKER_MOUTH, 8) && Math.abs(y - MID) <= 2.5 + (x - SPEAKER_MOUTH) * 0.9);

/**
 * One arc of sound leaving the mouth. Struck from the cone's own origin so the
 * two arcs stay concentric, and held inside a wedge either side of straight
 * ahead — a full ring would curl back over the cone and read as brackets.
 */
const soundWave = (x: number, y: number, radius: number): boolean =>
  x >= 10 &&
  Math.abs(y - MID) <= x - SPEAKER_MOUTH &&
  Math.abs(Math.hypot(x - SPEAKER_MOUTH, y - MID) - radius) <= 0.9;

const SPEAKER = shade(
  (x, y) => speakerCone(x, y) || soundWave(x, y, 6.8) || soundWave(x, y, 9.4),
);

const SPEAKER_MUTED = shade(speakerCone);

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

/**
 * A child at the serving window: big head, small body, no face — the face is
 * its own texture stamped on top, so a mood change swaps one sprite instead of
 * needing a whole body per expression (design §5).
 *
 * Drawn at 16×16 and tinted by *value*, like every other thing in this kitchen
 * that is not a candy (design §4, palette constraints): a customer wearing a
 * hue would read as an order.
 */
const CUSTOMER = [
  '....AAAAAAAA....',
  '..AA99999999AA..',
  '..A9999999999A..',
  '.A999999999999A.',
  '.A999999999999A.',
  '.A999999999999A.',
  '..A9999999999A..',
  '..AA99999999AA..',
  '....AAAAAAAA....',
  '.....A9999A.....',
  '...AA999999AA...',
  '..A9999999999A..',
  '..A9999999999A..',
  '...A99999999A...',
  '...A99A..A99A...',
  '...AAAA..AAAA...',
];

/** The other half of the walk: same child, legs mid-stride. */
const CUSTOMER_STRIDE = [
  ...CUSTOMER.slice(0, 14),
  '..A99A....A99A..',
  '..AAAA....AAAA..',
];

/**
 * What they came in for, said the way a comic says it. The bubble is chrome,
 * so it is tinted a shade off the page like every other slot a candy sits in —
 * the only hue inside it is the candy itself.
 */
const BUBBLE = [
  '..AAAAAAAAAAAA..',
  '.A999999999999A.',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  'A99999999999999A',
  '.A999999999999A.',
  '..AAAA9999AAAA..',
  '......A99A......',
  '.......AA.......',
  '................',
  '................',
];

/**
 * The four moods, aligned to `CUSTOMER`'s head so a face never needs its own
 * offset. They are the game's only feedback on how a child feels, now that the
 * queue carries no words: waiting, running out of patience, served, walked out
 * (design §5).
 *
 * Every feature is drawn in the detail gray, so tinting the face with the same
 * value as the body sinks the features a step darker than the skin they sit on.
 */
const FACE_CALM = [
  '................',
  '................',
  '................',
  '.....8....8.....',
  '.....8....8.....',
  '................',
  '......8888......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

/** Eyes wide, mouth open: the clock is running out. */
const FACE_WORRIED = [
  '................',
  '................',
  '................',
  '....88....88....',
  '....88....88....',
  '................',
  '.......88.......',
  '.......88.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

/** Eyes squeezed shut over a grin — they got the candy they asked for. */
const FACE_HAPPY = [
  '................',
  '................',
  '................',
  '.....8....8.....',
  '....8.8..8.8....',
  '................',
  '.....8....8.....',
  '......8888......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

/** Brows down, mouth down: patience ran out and they are walking (design §5). */
const FACE_CROSS = [
  '................',
  '................',
  '....8......8....',
  '.....88..88.....',
  '.....8....8.....',
  '................',
  '.....888888.....',
  '....8......8....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
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
  [TextureKey.Pip]: upscale(PIP),
  [TextureKey.Head]: upscale(HEAD),
  [TextureKey.Sugar]: upscale(SUGAR),
  [TextureKey.Dye]: upscale(DYE),
  [TextureKey.Candy]: upscale(CANDY),
  [TextureKey.Block]: upscale(BLOCK),
  [TextureKey.Speaker]: SPEAKER,
  [TextureKey.SpeakerMuted]: SPEAKER_MUTED,
  [TextureKey.Floor]: FLOOR,
  [TextureKey.Customer]: exact(CUSTOMER),
  [TextureKey.CustomerStride]: exact(CUSTOMER_STRIDE),
  [TextureKey.Bubble]: exact(BUBBLE),
  [TextureKey.FaceCalm]: exact(FACE_CALM),
  [TextureKey.FaceWorried]: exact(FACE_WORRIED),
  [TextureKey.FaceHappy]: exact(FACE_HAPPY),
  [TextureKey.FaceCross]: exact(FACE_CROSS),
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
