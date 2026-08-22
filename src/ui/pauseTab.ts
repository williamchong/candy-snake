import type Phaser from 'phaser';

import {
  GLYPH_TINT,
  HudDepth,
  makeSprite,
  makeTab,
  PANEL_FILL,
  placeTab,
  type Tab,
} from '../render/drawn';
import { PIXEL_SCALE, TextureKey } from '../render/textures';
import { TAB_SIZE, type Frame } from './layout';

/**
 * The pause control (design §10): the tab, the frost over the stopped kitchen,
 * and the mark drawn on it.
 *
 * Only the *showing* of it. Whether the game is stopped belongs to Phaser's
 * scene manager, so this is handed the answer the way the cheat sheet is handed
 * `unlocked` — it keeps no copy, and there is nothing here that could disagree
 * with the scene about what is running. Which scene, and how it is stopped, is
 * UIScene's to know: a widget under `ui/` naming one would be reaching up into
 * `scenes/`, the direction `render/drawn.ts` refuses one level down.
 *
 * What it shows is the state, not the verb — bars while the kitchen is stopped,
 * a wedge while it is running — the same bargain the mute tab makes with its
 * speaker, and for the same reason: design §11 keeps prose out of the HUD, so a
 * tab captioned with what it would do next has nothing to caption itself with.
 */

/**
 * The frost over a stopped kitchen. The chrome's own fill, so the pause reads as
 * the same material as the tabs and the sheet rather than as a fifth surface.
 *
 * Half-strength, which is the part that is not inherited. The player has stopped
 * mid-run and has to re-read the board to start again — where the head is
 * pointing, what is on the floor — so the kitchen stays legible under it. Enough
 * to say *stopped*, not enough to say *gone*. Lighter rather than darker for the
 * reason every other surface here is: the room is pastel (design §2), and a
 * black wash over it reads as an error dialog.
 */
const SCRIM_ALPHA = 0.5;

/**
 * How wide the stopped mark is drawn, in board cells. Sized off the cell rather
 * than in pixels so it is the same share of the kitchen on every screen — a mark
 * fixed in pixels is a quarter of the desktop board and half of a small phone's.
 */
const GLYPH_CELLS = 4;

export class PauseTab {
  private readonly tab: Tab;
  /** The frosted kitchen, and the largest thing a thumb can hit to come back. */
  private readonly scrim: Phaser.GameObjects.Rectangle;
  private readonly mark: Phaser.GameObjects.Image;
  /** What was last drawn, so a still HUD costs one comparison a frame. */
  private shown: boolean | undefined;

  constructor(scene: Phaser.Scene, onToggle: () => void) {
    this.tab = makeTab(
      scene,
      {
        size: TAB_SIZE,
        key: TextureKey.Running,
        depth: HudDepth.PauseTab,
        iconDepth: HudDepth.PauseTabIcon,
      },
      onToggle,
    );

    // Born 1×1 rather than 0×0, which is not a detail: `setInteractive` takes
    // its hit area from the object's own size and silently makes *nothing* when
    // that is zero — no hit area, no warning. One pixel is enough for it to
    // take, and `setSize` keeps the area in step from then on, so the layout
    // pass only has to resize it.
    this.scrim = scene.add
      .rectangle(0, 0, 1, 1, PANEL_FILL, SCRIM_ALPHA)
      .setOrigin(0, 0)
      .setDepth(HudDepth.PauseScrim)
      .setInteractive();
    this.scrim.on('pointerdown', onToggle);

    this.mark = makeSprite(scene, TextureKey.Paused, GLYPH_TINT, HudDepth.PauseGlyph, {
      x: 0,
      y: 0,
    });

    // Before the first frame rather than on it, the way the other two tabs are:
    // Phaser objects are born as built, so a frosted board would otherwise show
    // for one frame of a game nobody had paused.
    this.render(false);
  }

  applyFrame(frame: Frame): void {
    placeTab(this.tab, frame.hud.pause);

    // The frost is the kitchen's own rectangle rather than the whole screen: the
    // HUD is what the player reads while deciding to come back — what is on the
    // rack, who is still waiting — so covering it would cover the reason the
    // pause was useful. The board is the part that has stopped.
    const { board } = frame;
    this.scrim.setPosition(board.x, board.y).setSize(board.width, board.height);

    // `board.scale` is what turns the authored cell into the drawn one, so
    // riding it keeps the mark exactly `GLYPH_CELLS` wide on every screen.
    this.mark
      .setPosition(
        Math.round(board.x + board.width / 2),
        Math.round(board.y + board.height / 2),
      )
      .setScale(PIXEL_SCALE * GLYPH_CELLS * board.scale);
  }

  /** Whether the run is stopped, which only the scene manager knows. */
  render(paused: boolean): void {
    if (paused === this.shown) return;
    this.shown = paused;

    this.tab.icon.setTexture(paused ? TextureKey.Paused : TextureKey.Running);
    this.scrim.setVisible(paused);
    this.mark.setVisible(paused);
  }
}
