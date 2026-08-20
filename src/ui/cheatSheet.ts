import type Phaser from 'phaser';

import { blend, PRIMARIES } from '../core/colors';
import { settings, updateSettings } from '../persist/storage';
import {
  BORDER,
  CHROME_WIDTH,
  HudDepth,
  makeDrawn,
  makeTab,
  paint,
  PANEL_ALPHA,
  PANEL_FILL,
  place,
  placeTab,
  scaleDrawn,
  show,
  type Drawn,
  type Tab,
} from '../render/drawn';
import { CELL_SIZE, TextureKey } from '../render/textures';
import { TAB_SIZE, wheelSeats, WHEEL_PAIRS, type Frame, type WheelSeats } from './layout';

/**
 * The mixing cheat sheet: a tab at the edge of the screen that opens into a
 * wheel of the three dye jars with each pair's candy drawn between them
 * (design §4).
 *
 * It is the only place in the game a recipe is shown at all. The opening levels
 * teach mixing by what they stock and the queue shows only what a child wants,
 * both on purpose — a recipe printed beside every order is a table the player
 * reads instead of playing. So this one is drawn rather than written and sits
 * clear of the kitchen.
 *
 * **It stays up until the player puts it away.** It used to take itself down a
 * few seconds after the first turn, on the reasoning that a wheel left open is
 * a wheel in the way. From the chair it read as the game confiscating the one
 * reference it has: the sheet is semi-transparent, sits outside the play grid
 * and answers a question — *what makes purple* — that does not stop being asked
 * once a player starts steering. So the sheet is now shown unless the player
 * has hidden it, and hiding it is a choice they make and the game remembers.
 * Nothing left here is a rule with a decision in it, which is why there is no
 * pure state half any more.
 */

/**
 * Whether the player wants the sheet open. It lives in the settings blob
 * (`persist/storage.ts`), which is what carries it across
 * menu → game → game over → game and now across the reload as well: a player
 * who put the wheel away must not find it back in the corner of every run
 * after it (design §5).
 */
const readOpen = (): boolean => settings().cheatSheetOpen;

const rememberOpen = (open: boolean): void => {
  updateSettings({ cheatSheetOpen: open });
};

const SHEET_RADIUS = 8;
/** The spokes are chrome, and fainter than the frame — they guide, not divide. */
const SPOKE_ALPHA = 0.5;

/**
 * The wheel's contents, which never change. Derived from the palette and from
 * the same pairing table the seats are laid out by, so the candy drawn between
 * two jars is always the one those two jars actually make.
 */
const JAR_COLORS = PRIMARIES;
const RESULT_COLORS = WHEEL_PAIRS.map(([left, right]) =>
  blend(PRIMARIES[left], PRIMARIES[right]),
);

export class CheatSheet {
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly tab: Tab;
  /** Three jars then three candies, seated in `wheelSeats`' own order. */
  private readonly seats: readonly Drawn[];
  private open = readOpen();

  constructor(scene: Phaser.Scene) {
    // Built off-screen at a placeholder size, like every other HUD widget here;
    // `applyFrame` is what puts any of it anywhere.
    this.panel = scene.add.graphics().setDepth(HudDepth.SheetPanel);

    this.seats = [
      ...JAR_COLORS.map((color) => this.seat(scene, TextureKey.Dye, color)),
      ...RESULT_COLORS.map((color) => this.seat(scene, TextureKey.Candy, color)),
    ];

    // A jar, for the drawer of jars it opens.
    this.tab = makeTab(
      scene,
      {
        size: TAB_SIZE,
        key: TextureKey.Dye,
        depth: HudDepth.SheetTab,
        iconDepth: HudDepth.SheetTabIcon,
      },
      () => {
        this.toggle();
      },
    );

    // Before the first frame, not on it: Phaser objects are born visible, so a
    // player who put the wheel away last run would otherwise see one frame of
    // it back in the corner of this one.
    this.apply();
  }

  private seat(scene: Phaser.Scene, key: TextureKey, color: number): Drawn {
    const drawn = makeDrawn(
      scene,
      { key, depth: HudDepth.SheetIcon, glyphDepth: HudDepth.SheetGlyph },
      { x: 0, y: 0 },
    );
    // The wheel's contents never change, so they are painted once here rather
    // than every frame like the rack's.
    paint(drawn, color);

    return drawn;
  }

  /** Lays the wheel out at the size the frame asks for, and redraws its chrome. */
  applyFrame(frame: Frame): void {
    const { tab, panel, node } = frame.hud.sheet;
    // The jars shrink with the wheel, symbol and all — the rack's own bargain.
    const ratio = node / CELL_SIZE;

    // The tab does not: it is a fixed 44 px whatever the screen does, so its
    // jar is sized against the tab rather than against the wheel. Scaling it
    // with the wheel would leave a shrunken icon rattling around a full-size
    // frame on the one phone where the wheel is at its floor.
    placeTab(this.tab, tab);

    const wheel = wheelSeats(frame.hud.sheet);
    // Jars then candies, which is the order the seats were built in.
    [...wheel.jars, ...wheel.results.map((result) => result.at)].forEach(
      (seat, index) => {
        const drawn = this.seats[index];
        if (drawn === undefined) return;

        scaleDrawn(drawn, ratio);
        place(drawn, seat.x, seat.y);
      },
    );

    this.drawPanel(panel, wheel);
  }

  /**
   * The frame, and a spoke from each jar to each candy it makes. The spokes are
   * the sentence the picture is making — without them it is six loose sprites
   * and the player has to guess which pair produced which candy.
   */
  private drawPanel(panel: Frame['hud']['sheet']['panel'], wheel: WheelSeats): void {
    const left = panel.at.x - panel.width / 2;
    const top = panel.at.y - panel.height / 2;

    this.panel.clear();
    this.panel.fillStyle(PANEL_FILL, PANEL_ALPHA);
    this.panel.lineStyle(CHROME_WIDTH, BORDER);
    this.panel.fillRoundedRect(left, top, panel.width, panel.height, SHEET_RADIUS);
    this.panel.strokeRoundedRect(left, top, panel.width, panel.height, SHEET_RADIUS);

    this.panel.lineStyle(CHROME_WIDTH, BORDER, SPOKE_ALPHA);
    for (const { at, from, to } of wheel.results) {
      this.panel.lineBetween(from.x, from.y, at.x, at.y);
      this.panel.lineBetween(to.x, to.y, at.x, at.y);
    }
  }

  /**
   * Shows or hides the wheel. Only its *visibility* — `applyFrame` runs on
   * every layout pass whether the sheet is showing or not, so the wheel is
   * always already sitting where it belongs and this has nothing to place.
   */
  private apply(): void {
    this.panel.setVisible(this.open);
    this.seats.forEach((drawn) => {
      show(drawn, this.open);
    });
  }

  /**
   * The C key, or a tap on the tab — the only thing that ever moves the sheet,
   * which is why the wheel is shown from here rather than from a per-frame
   * pass. It used to need one: the auto-collapse gave the sheet a countdown
   * that could change its mind between frames, and with that gone a `render`
   * hook would be polling a value nothing but this line can write
   * (architecture §7 — effects hang off events, never off polled state).
   */
  toggle(): void {
    this.open = !this.open;
    rememberOpen(this.open);
    this.apply();
  }
}
