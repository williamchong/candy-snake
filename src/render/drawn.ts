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

/** Outline thickness for every framed slot in the HUD, in screen pixels. */
export const CHROME_WIDTH = 2;

/**
 * The ground any panel lays over the page — a child's speech bubble, the cheat
 * sheet's drawer. A shade lighter than the floor rather than darker than it: it
 * is what a candy has to read against, and raw sugar is nearly white, so on a
 * darker ground the palest candy would be the only one that had to be hunted
 * for.
 */
export const PANEL_FILL = 0xe7dcf0;

/**
 * The HUD's layers, named for the same reason the board's are: so a widget
 * cannot end up above its own frame by accident. The board keeps its own,
 * deeper table — the two scenes never share a display list.
 */
export const HudDepth = {
  /** The frame a candy sits in: a shelf slot, a customer's bubble. */
  Slot: 0,
  Icon: 1,
  Glyph: 2,
  /**
   * A child on their way out of the queue, who walks in front of the line they
   * have just left rather than through it (design §5). Named here rather than
   * added to `Icon` at the call site: this table is where HUD layering is
   * decided, and arithmetic on it is how a widget ends up above its own frame.
   */
  LeavingIcon: 3,
  LeavingGlyph: 4,
  /**
   * The cheat sheet, which is an overlay rather than another widget beside the
   * rest: it veils whatever HUD it opens over, and is meant to (design §4 —
   * semi-transparent, and never over the kitchen). So it sits above the lot.
   */
  SheetPanel: 5,
  SheetIcon: 6,
  SheetGlyph: 7,
  /**
   * The tab reads as sitting on the drawer it opens, so it is drawn above it.
   * Two layers because the tab is a frame with a jar inside it, and a frame
   * that shares its icon's depth is left to display-list insertion order to
   * separate — the accident this table exists to prevent.
   */
  SheetTab: 8,
  SheetTabIcon: 9,
} as const;

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

/**
 * Draws a pair at a fraction of its authored size, for the HUD widgets that
 * have to shrink to the space the layout gave them.
 *
 * The two halves take different numbers, which is the reason this is here
 * rather than at each call site: the sprite is drawn at `PIXEL_SCALE` because
 * it is baked at half its display size, and the glyph at 1 because it is baked
 * at exactly its own. That asymmetry belongs to this module, not to the widgets.
 */
export const scaleDrawn = (entry: Drawn, ratio: number): void => {
  entry.image.setScale(PIXEL_SCALE * ratio);
  entry.glyph?.setScale(GLYPH_SCALE * ratio);
};

/** Colorless items keep whatever tint they were built with. */
export const paint = (entry: Drawn, color: ColorMask | undefined): void => {
  if (color === undefined) return;

  entry.image.setTint(colorInfo(color).hex);
  entry.glyph?.setTexture(glyphTextureKey(color));
};
