import type Phaser from 'phaser';

import { COLS, ROWS } from '../core/board';

/**
 * 8-bit arcade art direction: sprites are authored at 8×8 source pixels and
 * blown up by an integer factor, so upscaling stays chunky and crisp (Phaser's
 * `pixelArt: true` supplies the nearest-neighbour filtering). There are no
 * image assets — textures are baked at boot (architecture §7).
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
 * One fixed 16-color palette for the whole game, the way an 8-bit machine had
 * — pixel maps index into it by character ('.' is transparent).
 *
 * The sprite grays run darkest (1) to brightest (9) and exist to be tinted:
 * tinting multiplies, so white reads as the full tint color and gray as a
 * darker shade of it. That is what lets one sprite recolor to any Phase 2
 * candy color without losing its shading.
 */
const PALETTE: Phaser.Types.Create.Palette = {
  '0': UNUSED,
  '1': '#2a2440', // sprite outline
  '2': '#1a1430', // floor, dark tile
  '3': '#231b41', // floor, light tile
  '4': '#8c8c8c', // sprite shadow
  '5': UNUSED,
  '6': UNUSED,
  '7': '#dcdcdc', // sprite fill
  '8': UNUSED,
  '9': '#ffffff', // sprite highlight
  A: UNUSED,
  B: UNUSED,
  C: UNUSED,
  D: UNUSED,
  E: UNUSED,
  F: UNUSED,
};

const SEGMENT = [
  '.111111.',
  '19977741',
  '19777741',
  '17777741',
  '17777741',
  '17777441',
  '14444441',
  '.111111.',
];

/** The candy maker: the same block with a face, so the head reads at a glance. */
const HEAD = [
  '.111111.',
  '19777741',
  '17177171',
  '17777771',
  '17777741',
  '17111171',
  '14444441',
  '.111111.',
];

const SUGAR = [
  '........',
  '..1111..',
  '.199771.',
  '.197771.',
  '.177741.',
  '.177441.',
  '..1111..',
  '........',
];

/**
 * The kitchen floor, one source pixel per board cell. Baking it beats drawing
 * the checkerboard with a Graphics: a Graphics replays its whole command
 * buffer every frame, whereas this is a single quad.
 */
const FLOOR = Array.from({ length: ROWS }, (_, y) =>
  Array.from({ length: COLS }, (_, x) => ((x + y) % 2 === 0 ? '2' : '3')).join(''),
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
