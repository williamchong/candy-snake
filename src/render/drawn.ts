import type Phaser from 'phaser';

import { colorInfo } from '../core/colors';
import { RAW, type ColorMask } from '../core/types';
import {
  PIXEL_SCALE,
  glyphTextureKey,
  type GlyphTextureKey,
  type TextureKey,
} from './textures';

/**
 * A sprite and the accessibility symbol stamped on it, moved as one — the
 * pairing every layer that draws a colored thing needs, on the board and in
 * the HUD alike (design §4).
 */

/** Leaves a texture's own pixels alone, for sprites that tint per item. */
export const NO_TINT = 0xffffff;

/**
 * Symbol ink and chrome. Hue carries meaning in this game and only candies may
 * spend it (design §4, palette constraints), so everything that is not a candy
 * is separated by *value*: the ink is among the darkest things drawn, the
 * outline a pale lilac a step above the floor.
 */
export const GLYPH_TINT = 0x5f5668;
export const BORDER = 0xc9b4dd;

export interface Drawn {
  readonly image: Phaser.GameObjects.Image;
  /** The symbol riding along with it, for layers that want one. */
  readonly glyph: Phaser.GameObjects.Image | undefined;
}

export interface DrawnConfig {
  readonly key: TextureKey;
  /**
   * For items that carry no color of their own. Ones that do — the strand, a
   * dye jar, a candy — leave this out and are tinted per item instead.
   */
  readonly tint?: number;
  readonly depth: number;
  /** Drawn at this alpha, for layers that must read as inert (debris). */
  readonly alpha?: number;
  /** Depth for the symbol glyph, or undefined to draw none (design §4). */
  readonly glyphDepth?: number;
}

/** Glyphs are baked at their display size, so they draw unscaled. */
const GLYPH_SCALE = 1;

export const makeSprite = (
  scene: Phaser.Scene,
  key: TextureKey | GlyphTextureKey,
  tint: number,
  depth: number,
  at: { x: number; y: number },
  scale = PIXEL_SCALE,
): Phaser.GameObjects.Image =>
  scene.add.image(at.x, at.y, key).setScale(scale).setTint(tint).setDepth(depth);

/**
 * A sprite plus its symbol glyph, built as a pair so every layer that wants a
 * glyph gets the same alignment and the same alpha (design §4).
 */
export const makeDrawn = (
  scene: Phaser.Scene,
  config: DrawnConfig,
  at: { x: number; y: number },
): Drawn => {
  const { key, tint, depth, glyphDepth, alpha } = config;

  return {
    image: makeSprite(scene, key, tint ?? NO_TINT, depth, at).setAlpha(alpha ?? 1),
    glyph:
      glyphDepth === undefined
        ? undefined
        : makeSprite(
            scene,
            glyphTextureKey(RAW),
            GLYPH_TINT,
            glyphDepth,
            at,
            GLYPH_SCALE,
          ).setAlpha(alpha ?? 1),
  };
};

/**
 * Moves a sprite and the glyph riding on it together, so they never drift.
 * Takes loose numbers because the per-frame path calls it for every visible
 * sprite, and a Vec2 per sprite per frame is pure garbage.
 */
export const place = (entry: Drawn, x: number, y: number): void => {
  entry.image.setPosition(x, y);
  entry.glyph?.setPosition(x, y);
};

export const show = (entry: Drawn, visible: boolean): void => {
  entry.image.setVisible(visible);
  entry.glyph?.setVisible(visible);
};

/** Colorless items keep whatever tint they were built with. */
export const paint = (entry: Drawn, color: ColorMask | undefined): void => {
  if (color === undefined) return;

  entry.image.setTint(colorInfo(color).hex);
  entry.glyph?.setTexture(glyphTextureKey(color));
};
