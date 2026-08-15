import type Phaser from 'phaser';

import { blend, PRIMARIES } from '../core/colors';
import {
  BORDER,
  CHROME_WIDTH,
  GLYPH_TINT,
  HudDepth,
  makeDrawn,
  makeSprite,
  paint,
  PANEL_FILL,
  place,
  scaleDrawn,
  show,
  type Drawn,
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
 * reads instead of playing. So this one is drawn rather than written, sits
 * clear of the kitchen, and gets out of the way on its own once the player
 * starts steering.
 *
 * The state half is separated out and pure — no Phaser, and no module state
 * either — because when the sheet hides itself is a rule with a decision in it,
 * and rules in this codebase are unit-tested.
 */

/**
 * How long the sheet stays up once the player is playing. Long enough to
 * finish reading it, short enough that it is gone before it is in the way.
 */
export const AUTO_COLLAPSE_MS = 4_000;

/**
 * Whether the player wants the sheet open, remembered for as long as the page
 * is loaded. Module state rather than scene state so it survives
 * menu → game → game over → game, which is what makes "expanded for the first
 * run" mean the first run rather than every run.
 *
 * Phase 8's `persist/storage.ts` replaces these two bodies with the settings
 * blob and nothing else about the sheet changes.
 */
let remembered: boolean | undefined;

const readOpen = (): boolean => remembered ?? true;

const rememberOpen = (open: boolean): void => {
  remembered = open;
};

/**
 * When the sheet is up, and when it takes itself down.
 *
 * The rule it exists to hold: automatic collapse happens once, on the first
 * turn the player actually steers, and never again. A countdown that restarted
 * on every turn would never fire while the player was busy, which is exactly
 * when the sheet is in the way; and a sheet that could collapse a second time
 * would take itself down under a player who had just asked for it.
 */
export class SheetState {
  private open: boolean;
  private countdownMs: number | undefined;
  /** Set once the sheet has been put where it is going to stay. */
  private settled = false;

  constructor(open: boolean) {
    this.open = open;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * The player asked, by key or by tab. A choice beats a countdown, so this
   * cancels one and stops any further one being armed.
   */
  toggle(): boolean {
    this.open = !this.open;
    this.countdownMs = undefined;
    this.settled = true;

    return this.open;
  }

  /** A turn landed. The first one starts the clock; later ones do not touch it. */
  steered(): void {
    if (!this.open || this.settled || this.countdownMs !== undefined) return;

    this.countdownMs = AUTO_COLLAPSE_MS;
  }

  tick(dtMs: number): void {
    if (this.countdownMs === undefined) return;

    this.countdownMs -= dtMs;
    if (this.countdownMs > 0) return;

    // Collapsing on its own is a courtesy for this run and not a preference, so
    // it is deliberately not remembered — otherwise every player is collapsed
    // for good a few seconds into their first game.
    this.open = false;
    this.countdownMs = undefined;
    this.settled = true;
  }
}

/** Enough of the kitchen still reads through that the drawer never blinds it. */
const SHEET_ALPHA = 0.88;
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
  private readonly tab: Phaser.GameObjects.Rectangle;
  private readonly tabIcon: Phaser.GameObjects.Image;
  /** Three jars then three candies, seated in `wheelSeats`' own order. */
  private readonly seats: readonly Drawn[];
  private readonly state = new SheetState(readOpen());
  /** The open-ness the panel currently shows — see `render`. */
  private shownOpen: boolean | undefined;

  constructor(scene: Phaser.Scene) {
    // Built off-screen at a placeholder size, like every other HUD widget here;
    // `applyFrame` is what puts any of it anywhere.
    this.panel = scene.add.graphics().setDepth(HudDepth.SheetPanel);

    this.seats = [
      ...JAR_COLORS.map((color) => this.seat(scene, TextureKey.Dye, color)),
      ...RESULT_COLORS.map((color) => this.seat(scene, TextureKey.Candy, color)),
    ];

    this.tab = scene.add
      .rectangle(0, 0, TAB_SIZE, TAB_SIZE)
      .setStrokeStyle(CHROME_WIDTH, BORDER)
      .setFillStyle(PANEL_FILL, SHEET_ALPHA)
      .setDepth(HudDepth.SheetTab)
      .setInteractive();
    this.tab.on('pointerdown', () => {
      this.toggle();
    });

    // A jar in ink rather than in hue: the tab is chrome, and hue in this
    // kitchen belongs to candies (design §11, the same reason hearts are inked).
    this.tabIcon = makeSprite(scene, TextureKey.Dye, GLYPH_TINT, HudDepth.SheetTabIcon, {
      x: 0,
      y: 0,
    });
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
    this.tab.setPosition(tab.x, tab.y);
    this.tabIcon.setPosition(tab.x, tab.y);

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
    this.panel.fillStyle(PANEL_FILL, SHEET_ALPHA);
    this.panel.lineStyle(CHROME_WIDTH, BORDER);
    this.panel.fillRoundedRect(left, top, panel.width, panel.height, SHEET_RADIUS);
    this.panel.strokeRoundedRect(left, top, panel.width, panel.height, SHEET_RADIUS);

    this.panel.lineStyle(CHROME_WIDTH, BORDER, SPOKE_ALPHA);
    for (const { at, from, to } of wheel.results) {
      this.panel.lineBetween(from.x, from.y, at.x, at.y);
      this.panel.lineBetween(to.x, to.y, at.x, at.y);
    }
  }

  /** Runs the countdown, and redraws only when the sheet has changed its mind. */
  render(dtMs: number): void {
    this.state.tick(dtMs);
    if (this.state.isOpen === this.shownOpen) return;
    this.shownOpen = this.state.isOpen;

    this.panel.setVisible(this.state.isOpen);
    this.seats.forEach((drawn) => {
      show(drawn, this.state.isOpen);
    });
  }

  /**
   * The C key, or a tap on the tab. Nothing is redrawn here: `applyFrame` runs
   * on every layout pass whether the sheet is showing or not, so the wheel is
   * already sitting where it belongs and `render` only has to reveal it.
   */
  toggle(): void {
    // The remembering lives out here rather than in `SheetState`, so that the
    // half of this file with the rule in it holds no module state and a test
    // can run it as many times as it likes in any order.
    rememberOpen(this.state.toggle());
  }

  /** An accepted turn — the player is playing, so the sheet gets out of the way. */
  steered(): void {
    this.state.steered();
  }
}
