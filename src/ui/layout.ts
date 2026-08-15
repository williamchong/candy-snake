import { CHOP_BLOCK_TOP, COLS, ROWS } from '../core/board';
import { STARTING_LIVES } from '../core/game';
import { SHELF_SLOTS } from '../core/shelf';
import type { Vec2 } from '../core/types';
import { CELL_SIZE } from '../render/textures';

/**
 * Screen geometry, and the only file that holds any (architecture §9). Every
 * anchor the board and the HUD draw from is computed here from the viewport the
 * device actually gave us, so a phone in either orientation and a desktop
 * window are the same code path with different numbers.
 *
 * Pure arithmetic, and free of Phaser on purpose: that is what lets the layout
 * be unit-tested in Node while the scenes that apply it are covered by the
 * smoke driver instead.
 */

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A viewport with nothing cut out of it — desktop, and the tests' default. */
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export type Orientation = 'landscape' | 'portrait';

/** Which way a run of slots is laid out from its anchor. */
export type Axis = 'column' | 'row';

export interface BoardFrame extends Vec2 {
  readonly width: number;
  readonly height: number;
  /**
   * What the board's container is scaled by. `CELL_SIZE * scale` is exactly
   * `cell`, so the board still lands on whole pixels however far it is scaled
   * down — the "integer-friendly cell size" of architecture §9, applied as one
   * container transform rather than threaded through every sprite.
   */
  readonly scale: number;
}

export interface HudFrame {
  readonly score: Vec2;
  /** The first heart; the rest follow along the row at `pitch`. */
  readonly lives: { readonly at: Vec2; readonly pitch: number };
  /**
   * The rack: where its first slot sits, how far apart they step, which way
   * they run, and how big each one is drawn. The size is here rather than in
   * `ShelfStrip` because on a phone held sideways the rack has to fit between
   * the bench and the queue, and six slots at the desktop pitch do not.
   */
  readonly shelf: {
    readonly at: Vec2;
    readonly pitch: number;
    readonly axis: Axis;
    readonly slot: number;
  };
  /**
   * The window end of the queue, the step from one child to the next, and where
   * a child waits before they arrive and after they go. `pitch` is signed: the
   * line runs away from the window, which is rightward in landscape and
   * leftward in portrait, and `offstage` is past the frame edge on that side.
   */
  readonly queue: {
    readonly front: Vec2;
    readonly pitch: number;
    readonly offstage: number;
  };
}

export interface Frame {
  readonly orientation: Orientation;
  /** The board's cell size on screen, in whole pixels. */
  readonly cell: number;
  readonly board: BoardFrame;
  readonly hud: HudFrame;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Below this the board stops being steerable; it is a floor, not a target. */
const MIN_CELL = 12;
/**
 * The board is never drawn larger than its sprites are authored at. Scaling
 * pixel art past 1:1 only softens it, and it would blow up the chrome widths
 * with it — so a big desktop window gets more room around the kitchen rather
 * than a bigger kitchen.
 */
const MAX_CELL = CELL_SIZE;

/** Breathing room between the board and anything else, including the frame. */
const GUTTER = 16;

/**
 * What the landscape serving column needs: the rack, and a lane wide enough for
 * a few children to queue in. Reserved before the board is sized, because the
 * column is the fixed requirement and the board is what flexes to fit.
 *
 * A share of the width rather than a flat number, bounded either end. Flat, it
 * takes over half a phone held sideways and leaves the kitchen smaller than the
 * HUD beside it.
 */
const COLUMN_MAX = 300;
const COLUMN_MIN = 180;
const COLUMN_SHARE = 0.35;

const columnWidth = (availW: number): number =>
  clamp(Math.round(availW * COLUMN_SHARE), COLUMN_MIN, COLUMN_MAX);

/**
 * Upright, the HUD is split either side of the board rather than stacked below
 * it: the score and lives take the band above, the rack and the queue the strip
 * below. A square board on a tall screen cannot use the whole height whatever
 * it does, so the slack is spent putting the two halves of the HUD against the
 * edges they belong to instead of leaving one dead band in the middle.
 */
const HEADER_HEIGHT = 56;
const STRIP_HEIGHT = 180;

const SCORE_ROW = 28;
const SHELF_ROW = 30;
const QUEUE_ROW = 150;

const LIVES_PITCH = 26;
/** What the rack has to clear below the row of hearts, in the landscape column. */
const LIVES_CLEARANCE = 32;

/** The rack at its roomiest — the desktop pitch, and the cap everywhere else. */
const SHELF_PITCH = 44;
/** Below this a slot is too small to read a candy's symbol off. */
const MIN_SHELF_PITCH = 18;
/** How much of its own step a slot fills, leaving the rest as the gap. */
const SLOT_RATIO = 40 / SHELF_PITCH;

const QUEUE_PITCH = 84;

/** A floor line set by eye, just inside the bottom of the kitchen. */
const QUEUE_FOOT = 20;

/**
 * How much room a child needs above the line they stand on — their own height
 * plus the bubble over their head. What the rack has to keep clear of.
 */
const CHILD_HEADROOM = 78;

/**
 * Sizes the rack to the run it has been given. Six slots at the desktop pitch
 * need most of a laptop's height, which a phone held sideways has not got, so
 * the pitch and the slot shrink together rather than the rack running off the
 * bottom of the screen.
 */
const shelfRun = (span: number): { pitch: number; slot: number } => {
  const pitch = clamp(Math.floor(span / SHELF_SLOTS), MIN_SHELF_PITCH, SHELF_PITCH);
  return { pitch, slot: Math.round(pitch * SLOT_RATIO) };
};

/** Far enough past the edge that nobody is seen to pop into existence. */
const OFFSTAGE_MARGIN = 60;

/**
 * The largest whole-pixel cell that fits the rectangle the board has been left,
 * capped at the authored size. Whole pixels rather than a fractional best fit
 * because the cell is what every position on the board is a multiple of.
 */
const cellFor = (width: number, height: number): number =>
  clamp(
    Math.min(Math.floor(width / COLS), Math.floor(height / ROWS)),
    MIN_CELL,
    MAX_CELL,
  );

/** Centres a run of `size` in `space`, never pushing it off the near edge. */
const centre = (origin: number, space: number, size: number): number =>
  Math.round(origin + Math.max(0, (space - size) / 2));

const boardFrame = (x: number, y: number, cell: number): BoardFrame => ({
  x,
  y,
  width: cell * COLS,
  height: cell * ROWS,
  scale: cell / CELL_SIZE,
});

/** The screen y of a board row's centre — how the rack hangs level with the bench. */
const rowCentreY = (board: BoardFrame, cell: number, row: number): number =>
  board.y + row * cell + cell / 2;

/**
 * Board left, serving column right, against the wall the chopping block cuts on
 * — bench, rack and child reading down one side (design §10).
 */
const landscapeFrame = (view: Viewport, insets: Insets): Frame => {
  const availW = view.width - insets.left - insets.right;
  const availH = view.height - insets.top - insets.bottom;

  const regionW = availW - columnWidth(availW);
  const cell = cellFor(regionW - 2 * GUTTER, availH - 2 * GUTTER);
  const board = boardFrame(
    centre(insets.left, regionW, cell * COLS),
    centre(insets.top, availH, cell * ROWS),
    cell,
  );

  // The column hugs the board rather than the frame edge, so the rack stays
  // beside the bench however much slack a wide window leaves over.
  const columnX = board.x + board.width + GUTTER;

  // Rack and queue share the column top to bottom, so the rack gets whatever is
  // left between the bench it hangs level with and the tallest child below it.
  //
  // Level with the bench is the *preference*, not the rule: on a short screen
  // the board rides high enough that the bench row is above the lives, and a
  // rack hung there would be drawn through the hearts. Design §10 asks for the
  // rack on the block's wall, which it still is.
  const livesY = insets.top + 84;
  const shelfTop = Math.max(
    rowCentreY(board, cell, CHOP_BLOCK_TOP),
    livesY + LIVES_CLEARANCE,
  );
  const footY = board.y + board.height - QUEUE_FOOT;
  const shelf = shelfRun(footY - CHILD_HEADROOM - shelfTop);

  return {
    orientation: 'landscape',
    cell,
    board,
    hud: {
      score: { x: columnX, y: insets.top + 40 },
      lives: { at: { x: columnX + 8, y: livesY }, pitch: LIVES_PITCH },
      shelf: { at: { x: columnX + 28, y: shelfTop }, ...shelf, axis: 'column' },
      queue: {
        front: { x: columnX + 42, y: footY },
        pitch: QUEUE_PITCH,
        offstage: view.width + OFFSTAGE_MARGIN,
      },
    },
  };
};

/**
 * Board across the top, serving strip along the bottom where a thumb reaches.
 * There is no room for a column beside a board that already fills the width, so
 * the strip goes below it — and the rack is right-aligned with the queue running
 * back from it, which is how the one-sided reading of design §10 survives the
 * turn.
 */
const portraitFrame = (view: Viewport, insets: Insets): Frame => {
  const availW = view.width - insets.left - insets.right;
  const availH = view.height - insets.top - insets.bottom;

  const stripTop = insets.top + availH - STRIP_HEIGHT;
  const boardBand = availH - HEADER_HEIGHT - STRIP_HEIGHT;
  const cell = cellFor(availW - 2 * GUTTER, boardBand - 2 * GUTTER);
  const board = boardFrame(
    centre(insets.left, availW, cell * COLS),
    centre(insets.top + HEADER_HEIGHT, boardBand, cell * ROWS),
    cell,
  );

  // Everything in the strip lines up with the board's own edges rather than the
  // frame's, so the HUD reads as belonging to the kitchen above it.
  const right = board.x + board.width;
  // Enough of a step that four children are on screen at once, and no wider
  // than the landscape pitch.
  const queuePitch = Math.min(QUEUE_PITCH, Math.floor((board.width - 60) / 4));
  // Laid across the board's own width rather than down a column, so the run it
  // has to fit in is that width.
  const shelf = shelfRun(board.width);

  return {
    orientation: 'portrait',
    cell,
    board,
    hud: {
      // Score and lives take the band above the board, at either end of it.
      score: { x: board.x, y: insets.top + SCORE_ROW },
      lives: {
        at: {
          x: right - 8 - (STARTING_LIVES - 1) * LIVES_PITCH,
          y: insets.top + SCORE_ROW,
        },
        pitch: LIVES_PITCH,
      },
      shelf: {
        // Right-aligned under the bench's own wall, so the candy's path still
        // reads toward one side once the column has become a strip (design §10).
        at: {
          x: right - shelf.slot / 2 - (SHELF_SLOTS - 1) * shelf.pitch,
          y: stripTop + SHELF_ROW,
        },
        ...shelf,
        axis: 'row',
      },
      queue: {
        front: { x: right - 2 * QUEUE_FOOT, y: stripTop + QUEUE_ROW },
        // The window is at the right-hand end, so the line runs back to the
        // left and the door is off that edge.
        pitch: -queuePitch,
        offstage: -OFFSTAGE_MARGIN,
      },
    },
  };
};

/**
 * The one layout pass. Run on create and on every resize; it holds no state, so
 * a scene can call it as often as it likes.
 */
export const layout = (view: Viewport, insets: Insets = NO_INSETS): Frame =>
  view.width >= view.height ? landscapeFrame(view, insets) : portraitFrame(view, insets);

/**
 * The middle of what the player can actually see — what a full-screen message
 * screen centres its stack of text on. Inset-aware, so a title does not sit
 * under a notch on a phone held upright.
 */
export const screenCentre = (view: Viewport, insets: Insets = NO_INSETS): Vec2 => ({
  x: Math.round(insets.left + (view.width - insets.left - insets.right) / 2),
  y: Math.round(insets.top + (view.height - insets.top - insets.bottom) / 2),
});
