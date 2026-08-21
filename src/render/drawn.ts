import type Phaser from 'phaser';

import { colorInfo } from '../core/colors';
import { RAW, type ColorMask, type Vec2 } from '../core/types';
import type { CornerTints } from './melt';
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

/**
 * Hue carries meaning in this game, so only candies may spend it (design §4,
 * palette constraints). The head is not a candy: it is separated by value, as
 * the darkest thing on the board.
 */
export const HEAD_TINT = 0x6e6478;

/** A customer, in ink diluted toward the chrome: shop, not candy (design §4). */
export const CHILD_TINT = 0xa08fb4;

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
 * How solid that ground is. Enough of the kitchen still reads through that a
 * panel never blinds it (design §4) — and it lives here beside the fill rather
 * than in the one widget that used to own it, because the sheet's tab and the
 * mute tab sit side by side on the same edge and two chrome alphas that drifted
 * apart would be visible as a seam.
 */
export const PANEL_ALPHA = 0.88;

/**
 * The HUD's layers, named for the same reason the board's are: so a widget
 * cannot end up above its own frame by accident. The board keeps its own,
 * deeper table — the two scenes never share a display list.
 */
export const HudDepth = {
  /**
   * The crowd gathering in the doorway before a rush (design §7). Behind
   * everything, because they are a room back and through a wall — and because
   * on the narrowest landscape frame the standing line already reaches the
   * frame edge, so a full window and a filling doorway can overlap. Behind, that
   * reads as a packed shop; level with the line it would read as a bug.
   */
  Doorway: -1,
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
   * A candy on its way off the rack, which flies over the slots it was pushed
   * out of — the same situation as the departing child above, and named here for
   * the same reason: sharing `Icon` with the rack would leave which one is on
   * top to display-list insertion order.
   */
  TossedIcon: 5,
  TossedGlyph: 6,
  /**
   * The send-off a served child gets, over the queue they are leaving — it is
   * thrown from the bubble the order was in, and a piece of it behind the next
   * child in line would read as that child's rather than as theirs.
   */
  Cheer: 7,
  /**
   * The cheat sheet, which is an overlay rather than another widget beside the
   * rest: it veils whatever HUD it opens over, and is meant to (design §4 —
   * semi-transparent, and never over the kitchen). So it sits above the lot.
   */
  SheetPanel: 8,
  SheetIcon: 9,
  SheetGlyph: 10,
  /**
   * The tab reads as sitting on the drawer it opens, so it is drawn above it.
   * Two layers because the tab is a frame with a jar inside it, and a frame
   * that shares its icon's depth is left to display-list insertion order to
   * separate — the accident this table exists to prevent.
   */
  SheetTab: 11,
  SheetTabIcon: 12,
  /**
   * The mute tab, which never overlaps the sheet's — they sit beside each other
   * on the same edge. Listed all the same, and in two layers like the other
   * one: a frame sharing a depth with the icon inside it is left to
   * display-list insertion order, which is the accident this table prevents.
   */
  MuteTab: 13,
  MuteTabIcon: 14,
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
 * A tab at the edge of the HUD: a chrome square with one inked icon inside it,
 * built as a pair because the frame and its icon are laid out as one thing and
 * live at two depths.
 *
 * Extracted when the second one landed. What the two tabs *do* is nothing alike
 * — one opens a drawer of jars, the other silences the game — and that half
 * stays with each of them. This is only the shell they both build the same way,
 * down to the call order, and it is where the D-pad (`persist/storage.ts`) would
 * otherwise write it a third time.
 *
 * Sized by its caller rather than from `ui/layout.ts`: a length in pixels is
 * screen geometry and that file owns all of it, but `render/` is underneath
 * `ui/` and must not reach up into it.
 */
export interface Tab {
  readonly frame: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Image;
}

export interface TabConfig {
  readonly size: number;
  readonly key: TextureKey;
  readonly depth: number;
  readonly iconDepth: number;
}

export const makeTab = (
  scene: Phaser.Scene,
  config: TabConfig,
  onTap: () => void,
): Tab => {
  const { size, key, depth, iconDepth } = config;

  // Built at the origin like every other HUD widget; `placeTab` is what puts it
  // anywhere, on the layout pass.
  const frame = scene.add
    .rectangle(0, 0, size, size)
    .setStrokeStyle(CHROME_WIDTH, BORDER)
    .setFillStyle(PANEL_FILL, PANEL_ALPHA)
    .setDepth(depth)
    .setInteractive();
  frame.on('pointerdown', onTap);

  // Inked rather than tinted in hue: a tab is chrome, and hue in this kitchen
  // belongs to candies (design §4, palette constraints).
  return {
    frame,
    icon: makeSprite(scene, key, GLYPH_TINT, iconDepth, { x: 0, y: 0 }),
  };
};

export const placeTab = ({ frame, icon }: Tab, at: Vec2): void => {
  frame.setPosition(at.x, at.y);
  icon.setPosition(at.x, at.y);
};

/** Hiding the frame also stops its taps: Phaser skips invisible hit areas. */
export const showTab = ({ frame, icon }: Tab, visible: boolean): void => {
  frame.setVisible(visible);
  icon.setVisible(visible);
};

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
 * Moves freshly built objects into the container that draws them. `scene.add.*`
 * puts them on the scene's own display list, so anything meant to be fitted to
 * the device by scaling a container has to be taken in here or it would sit
 * outside it and never move with the rest.
 *
 * A container keeps its children in insertion order, and the pools that use
 * this build theirs lazily — so the sort is what stops a sprite spawned late
 * from landing above the layer that owns it. Cheap enough to do on every
 * adoption: pools grow to the run's peak and then stop.
 */
export const adopt = (
  root: Phaser.GameObjects.Container,
  ...objects: readonly (Phaser.GameObjects.GameObject | undefined)[]
): void => {
  for (const object of objects) {
    if (object !== undefined) root.add(object);
  }
  root.sort('depth');
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

/**
 * Colorless items keep whatever tint they were built with.
 *
 * `corners` paints the sprite as a gradient between its four vertices instead
 * of one flat color, for the strand's melted seams. The glyph is stamped from
 * `color` either way: the symbol is what the player reads a segment's color
 * *by* (design §4), so it must name the true color however the pixels are
 * shaded. Corner gradients need WebGL — but so does tinting at all: the canvas
 * fallback renderer ignores tint outright and draws every sprite in its baked
 * color, so a gradient costs nothing there that a flat tint was not already
 * costing.
 */
export const paint = (
  entry: Drawn,
  color: ColorMask | undefined,
  corners?: CornerTints,
): void => {
  if (color === undefined) return;

  if (corners === undefined) entry.image.setTint(colorInfo(color).hex);
  else entry.image.setTint(...corners);
  entry.glyph?.setTexture(glyphTextureKey(color));
};
