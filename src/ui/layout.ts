import { CHOP_BLOCK_HEIGHT, CHOP_BLOCK_TOP, COLS, ROWS } from '../core/board';
import { STARTING_LIVES } from '../core/game';
import { SHELF_SLOTS } from '../core/shelf';
import type { Vec2 } from '../core/types';
import { CELL_SIZE, TEXTURE_SIZE } from '../render/textures';

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
  /**
   * The centre of the tutorial's lesson line, hung on the kitchen's free edge
   * — over it in landscape, under it upright, where the band above belongs to
   * the open cheat sheet. The text is `core/tutorial.ts`'s
   * `TUTORIAL_HEADLINES`, and the widget fits it to the board's width the way
   * `TextStack` fits a line.
   */
  readonly headline: Vec2;
  /** The first heart; the rest follow along the row at `pitch`. */
  readonly lives: { readonly at: Vec2; readonly pitch: number };
  /**
   * The first combo pip; the rest follow along the row at `pitch`, the way the
   * hearts do. It shares the hearts' row in both orientations because it is
   * the same kind of thing — a count of the run drawn rather than written
   * (design §11) — and because that row is the one band the score does not
   * grow into.
   */
  readonly combo: {
    readonly at: Vec2;
    readonly pitch: number;
    /**
     * Where the figure beside the run is written from — its left edge, on the
     * pips' own row. Here rather than measured off `at` by the widget, because
     * all screen geometry lives in this file: a number the meter worked out for
     * itself is a number the row was never fitted for.
     */
    readonly label: Vec2;
  };
  /**
   * The rack: where its first slot sits, how far apart they step, which way
   * they run, and how big each one is drawn. The size is here rather than in
   * `ShelfStrip` because on a phone held sideways the rack has to fit between
   * the queue and the bottom of the frame, and six slots at the desktop pitch
   * do not.
   */
  readonly shelf: {
    readonly at: Vec2;
    readonly pitch: number;
    readonly axis: Axis;
    readonly slot: number;
  };
  readonly queue: QueueFrame;
  /**
   * Where the pause control sits (design §10's third HUD button, at the same
   * 44 px `TAB_SIZE` floor as the other two). Just a centre, like the mute tab.
   *
   * It is the one tab that does not join the landscape stack. Each rung there
   * costs the wheel 52 px of column, and a third takes the panel back across the
   * children's feet on the smallest phone sideways — so this one goes *beside*
   * the sheet's tab instead, into a band that is 171 px wide where two tabs need
   * 96. Upright both shoulders are already spoken for, so it takes a second rung
   * under the sheet's, which is the shoulder the score sits on rather than the
   * hearts.
   */
  readonly pause: Vec2;
  /**
   * The cheat sheet: where its tab sits, the box the wheel fills when it is
   * open, and how big one jar in that wheel is drawn. The tab is one fixed size
   * at every viewport — design §10's 44 px touch floor is geometry, so it is
   * settled here rather than left to the widget — while `radius` and `node`
   * shrink together the way the rack's `pitch` and `slot` do.
   *
   * `panel.at` is the box's centre. It is *not* the circle the jars stand on —
   * that sits a little lower, for the reason `wheelSeats` gives.
   */
  /**
   * Where the mute tab sits (design §12's toggle, at design §10's touch floor —
   * the same 44 px `TAB_SIZE` the sheet's tab is given, and for the same
   * reason). Just a centre: unlike the sheet it opens nothing, so there is no
   * panel to measure beside it.
   */
  readonly mute: Vec2;
  readonly sheet: {
    readonly tab: Vec2;
    readonly panel: {
      readonly at: Vec2;
      readonly width: number;
      readonly height: number;
    };
    readonly radius: number;
    readonly node: number;
  };
}

/**
 * The window end of the queue, the step from one child to the next, how big a
 * child in it is drawn, and where one waits before they arrive and after they
 * go. `pitch` is signed: the line runs away from the window, which is rightward
 * in landscape and leftward in portrait, and `offstage` is past the frame edge
 * on that side.
 *
 * `scale` is here rather than in `customerView.ts` for the same reason the
 * rack's `slot` is here rather than in `shelfStrip.ts`: how big a thing is drawn
 * is how much room it needs, and the room is what this file is fitting.
 *
 * `door` is the same end of the line brought back just *inside* the frame:
 * where the crowd gathering before a rush stands (design §7's telegraph). It
 * is the only thing in the queue deliberately drawn half off the edge —
 * a doorway is a thing you see part of — so it is a measurement rather than
 * an inset the widget picks, and it is swept per viewport like the rest.
 */
/** What `queueRun` fits: the step, and how big a child that step can afford. */
interface QueueRun {
  readonly pitch: number;
  readonly scale: number;
}

export interface QueueFrame {
  readonly front: Vec2;
  readonly pitch: number;
  readonly scale: number;
  readonly offstage: number;
  readonly door: number;
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
 * How far past 1:1 a big window may take the kitchen. Scaling pixel art up is
 * only safe in **whole multiples** — a cell of 47 makes some source pixels three
 * screen pixels wide and others two, and the strand's soft edge crawls as the
 * board slides under it — so above the authored size the cell steps rather than
 * slides, and `cellFor` picks the largest step that fits.
 *
 * Two, not more: the HUD around the kitchen is authored at one size and does
 * not step with it, and past double the board stops reading as the thing the
 * children are queueing at and starts reading as the whole screen. A window
 * with room for a third step gets the air instead.
 */
const MAX_ZOOM = 2;
const MAX_CELL = CELL_SIZE * MAX_ZOOM;

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
/**
 * How tall the score is set. Here rather than at the `add.text` call because it
 * is the one thing about the score that the clearance sweep has to know, and
 * screen geometry lives in this file (architecture.md §2).
 */
export const SCORE_SIZE = 30;
const SHELF_ROW = 30;
const QUEUE_ROW = 150;

const LIVES_PITCH = 26;
/**
 * Where the hearts sit in the landscape column. Load-bearing, unlike the score
 * above them: the window hangs off this row on a screen too short to put it
 * level with the bench.
 */
const LIVES_ROW = 76;
/** Half a heart: what anything hung below the row has to clear it by. */
export const LIVES_CLEARANCE = 16;

/**
 * Pips in the combo meter — the most children one batch can ever feed, which is
 * the window's own ceiling (`difficulty.ts` tops `maxQueue` out at 4) rather
 * than a number picked to look right. A batch can hold more candy than that,
 * but there is nobody left to hand it to.
 */
export const COMBO_PIPS = 4;
/** How far apart the pips step. */
const COMBO_PITCH = 14;
/** One pip, drawn square — smaller than its step, so the run reads as separate marks. */
export const COMBO_PIP = 10;
/** The run's full width. */
export const COMBO_RUN = (COMBO_PIPS - 1) * COMBO_PITCH + COMBO_PIP;
/** The gap between the last pip and the figure beside it. */
const COMBO_LABEL_GAP = 8;
/**
 * What the figure itself takes: the widest the meter can ever show, which is
 * the last pip's — `+45`, at the size `ComboMeter` sets it. A ceiling rather
 * than a measurement of the text, because the row is fitted before the meter
 * has anything to say.
 */
export const COMBO_FIGURE = 28;
/**
 * Room the figure beside the pips needs — what the run is paying (`ComboMeter`).
 * It hangs off the right of the run rather than being centred with it: upright,
 * the pips sit in the middle of a band whose left end the score grows into, and
 * a meter re-centred to make room for the figure walks the pips into the score
 * on the narrowest phone. The slack to the right is where the room actually is,
 * and `layout.test.ts` sweeps every viewport to prove it stays there.
 */
export const COMBO_LABEL_ROOM = COMBO_LABEL_GAP + COMBO_FIGURE;
/** The whole meter — the run and the figure — which is what a band has to hold. */
export const COMBO_WIDTH = COMBO_RUN + COMBO_LABEL_ROOM;

/**
 * The combo meter from its first pip: the run steps at one pitch in both
 * orientations, and the figure sits off the end of it (`COMBO_LABEL_ROOM`).
 */
const comboRun = (at: Vec2): HudFrame['combo'] => ({
  at,
  pitch: COMBO_PITCH,
  label: { x: at.x + COMBO_RUN - COMBO_PIP / 2 + COMBO_LABEL_GAP, y: at.y },
});

/** The rack at its roomiest — the desktop pitch, and the cap everywhere else. */
const SHELF_PITCH = 44;
/** Below this a slot is too small to read a candy's symbol off. */
const MIN_SHELF_PITCH = 18;
/** How much of its own step a slot fills, leaving the rest as the gap. */
const SLOT_RATIO = 40 / SHELF_PITCH;

/**
 * The most children who can ever be waiting at once, and so the number the lane
 * has to hold: `difficulty.ts` tops `maxQueue` out at 4, which is the same
 * ceiling the combo meter counts its pips against.
 */
export const QUEUE_SLOTS = COMBO_PIPS;

/**
 * The step from one child to the next, at its roomiest — the desktop pitch.
 * Exported because the doorway crowd huddles at a share of it (`ui/rushDoor.ts`)
 * and a share of a number you cannot see is a copy waiting to drift.
 */
export const QUEUE_PITCH = 84;

/**
 * How big a child is drawn, as a multiple of the 16 px source. Bigger than the
 * board's 2× because a face is the whole point of that sprite and the queue is
 * what the player glances at rather than steers by — and a ceiling rather than
 * a fixed size, for the reasons `queueRun` gives.
 */
export const CHILD_SCALE = 3;
/** Below this the face stops carrying, which is the only thing a child is for. */
const MIN_CHILD_SCALE = 2;

/** How tall — and, being a square sprite, how wide — a child is drawn. */
export const childHeight = (scale: number): number => TEXTURE_SIZE * scale;

/**
 * A source cell of air between one child and the next, which is what decides
 * which whole scale a step can afford. A line drawn shoulder to shoulder is a
 * crowd rather than a queue, and the doorway already has the crowd
 * (`ui/rushDoor.ts`).
 */
const CHILD_GAP = TEXTURE_SIZE;
/**
 * The floor the two agree on: the smallest child, with their air. It is a floor
 * and not a fit — under 522 px of landscape width the lane can no longer pay
 * for four of these, and the tail of the queue goes back over the frame edge.
 * Nothing that ships is down there (the smallest phone sideways is 568),
 * and a queue drawn on top of itself would be worse than one that runs off.
 */
const MIN_QUEUE_PITCH = childHeight(MIN_CHILD_SCALE) + CHILD_GAP;

/** The gap over a child's head that their bubble hangs in (`customerView.ts`). */
export const CHILD_BUBBLE_GAP = 18;

/**
 * How much room a child needs above the line they stand on: their own height,
 * the gap over their head and the bubble that sits in it — `customerView.ts`'s
 * `bubbleY` plus half a bubble, which at any scale is one and a half of them.
 * What the row of hearts has to keep clear of, and measured rather than
 * eyeballed because on a short screen the hearts land exactly on it.
 */
export const childHeadroom = (scale: number): number =>
  1.5 * childHeight(scale) + CHILD_BUBBLE_GAP;
/**
 * And below it: the patience bar draining at their feet, and the lane a child
 * steps down into on their way out before they walk off — `customerView.ts`'s
 * `BAR_Y` and its `LEAVING_LANE`, whichever reaches further, which is the lane.
 * Both are measured from the standing line rather than off the child, so unlike
 * the headroom this one does not flex with how big they are drawn.
 */
export const CHILD_UNDERFOOT = 22;

/**
 * Sizes the queue to the lane and the kitchen it has been given, the way
 * `shelfRun` sizes the rack: the step and the children shrink together rather
 * than the tail of the line standing off the edge of the screen.
 *
 * Two bounds, because there were two ways for a child to be drawn too big.
 * The lane is the one that loses a queue: it is a share of the width
 * (`columnWidth`), so a window small enough to embed — an itch.io frame, say —
 * leaves room that four children at the desktop pitch run clean out of, and
 * what is lost is how far ahead the player can read the queue, which is what
 * design §5 asks them to plan against.
 *
 * The cell is the one that looks wrong. `MAX_ZOOM` says the HUD is authored at
 * one size and does not step *up* with a zoomed kitchen; stepping down is a
 * different matter, because below the authored cell everything else on screen
 * does — the board, the rack's slots, the wheel's jars — and a child left at
 * their full size stops being half again a board sprite and starts being twice
 * one, towering over the shop they are queueing in.
 *
 * The scale steps in whole multiples and never between them: these are 16 px
 * sprites, and half a source pixel is the crawl `MAX_ZOOM` refuses on the board.
 */
const queueRun = (lane: number, cell: number): QueueRun => {
  const pitch = clamp(Math.floor(lane / QUEUE_SLOTS), MIN_QUEUE_PITCH, QUEUE_PITCH);
  // The kitchen's own scale is `cell / CELL_SIZE` (`boardFrame`), so the second
  // bound is the authored child taken down by however much the board was.
  const fits = Math.min(
    (pitch - CHILD_GAP) / TEXTURE_SIZE,
    CHILD_SCALE * (cell / CELL_SIZE),
  );

  return { pitch, scale: clamp(Math.floor(fits), MIN_CHILD_SCALE, CHILD_SCALE) };
};

/**
 * The line itself: it starts half a step into the lane, so the run of four
 * fills that lane evenly rather than from a fixed inset the last child then
 * overshoots, and it runs *away* from the window. `into` is which way that is —
 * rightward beside the board, leftward beneath it — and it is the one place the
 * sign rule is written, rather than once per orientation.
 */
const queueLine = (
  run: QueueRun,
  window: Vec2,
  into: 1 | -1,
  offstage: number,
  door: number,
): QueueFrame => ({
  front: { x: window.x + into * Math.round(run.pitch / 2), y: window.y },
  pitch: into * run.pitch,
  scale: run.scale,
  offstage,
  door,
});

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
 * How far *inside* the frame edge the nearest of the doorway crowd stands, so
 * that they are cut by it rather than standing clear of it: a crowd wholly on
 * screen is another queue, and one wholly off it says nothing. Measured from
 * the edge and not back from `offstage`, which is a walk-on distance and has no
 * business moving a doorway (design §7).
 *
 * A child is drawn `childHeight(scale)` across — half of that either side of the
 * centre this positions — so 6 leaves most of the nearest one showing, and more
 * of them the smaller a narrow lane has drawn them.
 */
const DOOR_INSET = 6;

/**
 * The cheat-sheet tab, at design §10's touch floor. One size at every viewport:
 * a thumb is the same width on a phone as the finger on a trackpad, so this is
 * the one measurement in the file that does not flex with the screen. It is the
 * first hit-testable object in the game, which is what makes the floor binding
 * here rather than theoretical.
 */
export const TAB_SIZE = 44;

/**
 * Air between the two tabs. Enough that a thumb aimed at one does not catch the
 * other, and little enough that they still read as one strip of controls rather
 * than as two things that happen to be near each other.
 */
const TAB_GAP = 8;

/** A jar in the wheel is a jar on the board, at the size it is authored at. */
const WHEEL_NODE = CELL_SIZE;
/** Below this a node is too small to read a symbol off — the rack's own floor. */
const MIN_WHEEL_NODE = 18;
/**
 * How far the jars sit from the wheel's centre, in nodes. Tight on purpose: the
 * whole panel has to clear the board inside a phone's header band, and every
 * tenth here costs about three pixels of panel in each direction.
 *
 * It is also what leaves no room at the centre. Brown — the over-mix — belongs
 * at the middle, equidistant from all three jars, but it would collide with the
 * pair results below about 2.2, and a wheel that wide no longer fits the
 * smallest phone upright. Design §4 asks for six nodes, so six is what this
 * spread is sized for.
 */
const WHEEL_SPREAD = 1.45;
/** Breathing room inside the panel's own frame. */
const SHEET_PAD = 8;

/**
 * The wheel is a function of one number. Three jars sit on a circle at
 * −90°/30°/150°, and each pair's candy sits at the midpoint of the two jars
 * that make it — which on an equilateral triangle is exactly half the radius
 * out from the centre. So the triangle spans `√3·radius` across and
 * `1.5·radius` down, and the panel is that plus a node of overhang and the pad.
 */
const TRIANGLE_W = Math.sqrt(3);
const TRIANGLE_H = 1.5;
const WHEEL_W = TRIANGLE_W * WHEEL_SPREAD + 1;
const WHEEL_H = TRIANGLE_H * WHEEL_SPREAD + 1;

interface Wheel {
  readonly node: number;
  readonly radius: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Sizes the wheel to the space it has been given, the way `shelfRun` sizes the
 * rack: the node and the radius shrink together rather than the panel running
 * off the screen. The floor is a floor and not a target — a wheel at
 * `MIN_WHEEL_NODE` is what the smallest phone upright gets, and nothing else.
 */
const wheelRun = (spanW: number, spanH: number): Wheel => {
  const node = clamp(
    Math.floor(
      Math.min((spanW - 2 * SHEET_PAD) / WHEEL_W, (spanH - 2 * SHEET_PAD) / WHEEL_H),
    ),
    MIN_WHEEL_NODE,
    WHEEL_NODE,
  );
  const radius = Math.round(node * WHEEL_SPREAD);

  return {
    node,
    radius,
    width: Math.round(TRIANGLE_W * radius) + node + 2 * SHEET_PAD,
    height: Math.round(TRIANGLE_H * radius) + node + 2 * SHEET_PAD,
  };
};

/**
 * The largest cell that fits the rectangle the board has been left. Whole pixels
 * rather than a fractional best fit, because the cell is what every position on
 * the board is a multiple of — and whole *multiples of the authored cell* once
 * there is room for more than one, which is what keeps a scaled-up kitchen as
 * crisp as a 1:1 one (see `MAX_ZOOM`).
 */
const cellFor = (width: number, height: number): number => {
  const fits = Math.min(Math.floor(width / COLS), Math.floor(height / ROWS));
  if (fits < CELL_SIZE) return Math.max(fits, MIN_CELL);

  return Math.min(Math.floor(fits / CELL_SIZE) * CELL_SIZE, MAX_CELL);
};

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

/** The screen y of a board row's centre — how the window lines up with the bench. */
const rowCentreY = (board: BoardFrame, cell: number, row: number): number =>
  board.y + row * cell + cell / 2;

/**
 * How far past the board's edge the headline's centre hangs — snug against
 * the kitchen it captions, not centred in whatever slack a big window leaves
 * beyond it, where it would read as belonging to nothing.
 */
const HEADLINE_LIFT = GUTTER;
/** Half the line's height: what whatever bounds it must keep clear of its centre. */
export const HEADLINE_ROOM = 12;

/**
 * Where the tutorial's lesson line sits in landscape: centred over the board,
 * hung `HEADLINE_LIFT` above its top edge. A phone held sideways leaves no
 * air over the kitchen at all, so there the frame edge wins and the line laps
 * the board's top wall instead — snug on the wall it is still readable, half
 * off the screen it is not.
 *
 * Only landscape hangs it on top: upright, that band is the open cheat
 * sheet's (which stays up by design, and for exactly the player the tutorial
 * is teaching), so `portraitFrame` hangs the line under the kitchen instead.
 */
const headlineFor = (board: BoardFrame, topEdge: number): Vec2 => ({
  x: Math.round(board.x + board.width / 2),
  y: Math.max(board.y - HEADLINE_LIFT, topEdge + HEADLINE_ROOM),
});

/**
 * Board left, serving column right, against the wall the chopping block cuts on
 * — bench, child and rack reading down one side (design §10).
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

  // The column hugs the board rather than the frame edge, so the window stays
  // beside the bench however much slack a wide window leaves over.
  const columnX = board.x + board.width + GUTTER;
  // The serving lane is what is left of the width once the kitchen has had its
  // share: the column the children queue down, from the board's edge to the
  // frame's. It is what four of them have to fit in, and so what sizes them.
  const queue = queueRun(insets.left + availW - columnX, cell);

  // Tight under the score rather than clear of it: the hearts are the ceiling
  // the window hangs from on a short screen, so every pixel spent above them is
  // one the child is pushed down the column by.
  // The hearts' own anchor, held once: the combo meter is placed off the end of
  // this run, so the two rows cannot drift apart.
  const livesAt = { x: columnX + 8, y: insets.top + LIVES_ROW };
  // The rack and the tab hang off the same edge and must stay on it.
  const frameFloor = insets.top + availH - GUTTER;
  // What six slots need at the floor of `shelfRun` — the rack cannot be asked
  // for less, so it is the room the window has to leave under itself.
  const floorRun = shelfRun(0);
  const rackMin = (SHELF_SLOTS - 1) * floorRun.pitch + floorRun.slot;

  // The window is the bench's own row: the child at the head of the queue
  // stands level with the last cell the block cuts on, a gutter to the right of
  // the wall it cuts against, so a candy's path reads across one row rather
  // than the length of the column (design §10).
  //
  // Level with the bench is the *preference*, not the rule, and it is fenced on
  // both sides: a child hung at the bench row on a short screen would hold their
  // bubble up through the hearts, and one hung too low leaves the rack running
  // off the bottom of the frame. Where the two fences cross — the smallest phone
  // sideways, which is over-subscribed whatever this file does — the rack wins
  // and the bubble is what overlaps, because a rack drawn off the screen is not
  // a crowded HUD but a missing one.
  const footY = Math.min(
    Math.max(
      rowCentreY(board, cell, CHOP_BLOCK_TOP + CHOP_BLOCK_HEIGHT - 1),
      livesAt.y + LIVES_CLEARANCE + childHeadroom(queue.scale),
    ),
    insets.top + availH - rackMin - GUTTER / 2 - CHILD_UNDERFOOT,
  );
  const childFloor = footY + CHILD_UNDERFOOT;

  // The rack takes the column below the window, which is the order a candy
  // actually travels in: it is offered to the queue first and racked only if
  // nobody there wants it (design §5).
  const shelfX = columnX + 28;
  const rackTop = childFloor + GUTTER / 2;
  const shelf = shelfRun(frameFloor - rackTop);

  // The sheet takes the corner of the frame furthest from the kitchen: below
  // the child's feet where the column can pay for it, beyond the rack, and hung
  // off the top of its own tab so that a wheel too tall for the band grows up
  // the column rather than down over the tab. `wheelRun`'s floor outranks the
  // band it is handed, so on a short screen the panel does reach back past the
  // standing line — clear of the children only because it is right-aligned to
  // the frame and they queue from the wall outward.
  //
  // Its span is measured from the rack's far edge rather than from the board,
  // so clearing the rack and clearing the board are both structural — a wider
  // window moves the rack and the panel follows it.
  // The sheet's tab and the mute tab stack in the corner rather than sitting
  // side by side: the band between the rack and the frame edge is the wheel's
  // whole width, and at the wheel's floor it is narrower than two tabs. Stacking
  // spends the column's height instead, which `wheelRun` is already willing to
  // give up — its floor outranks the band it is handed.
  //
  // The pause tab is where that stops being true, and it is measured rather than
  // argued. A third rung costs another 52 px of column, which on the smallest
  // phone sideways (568×320) puts the panel's floor at 148 px against children
  // standing at 182 — the wheel climbing across the queue it is supposed to
  // clear. So pause goes sideways along the bottom row instead: the stack never
  // grows, `sheetFloor` is the same arithmetic it was, and the wheel pays
  // nothing for it. What pays is the band, which has it to give — 171 px on that
  // same phone against the 96 two tabs need.
  const sheetRight = insets.left + availW - GUTTER;
  const tabX = Math.round(sheetRight - TAB_SIZE / 2);
  const tabY = Math.round(frameFloor - TAB_SIZE / 2);
  const pauseX = Math.round(tabX - TAB_SIZE - TAB_GAP);
  const muteY = Math.round(tabY - TAB_SIZE - TAB_GAP);
  const sheetFloor = muteY - TAB_SIZE / 2 - GUTTER / 2;
  const wheel = wheelRun(
    sheetRight - (shelfX + shelf.slot / 2) - GUTTER,
    sheetFloor - childFloor,
  );

  return {
    orientation: 'landscape',
    cell,
    board,
    hud: {
      score: { x: columnX, y: insets.top + 40 },
      headline: headlineFor(board, insets.top),
      lives: { at: livesAt, pitch: LIVES_PITCH },
      // A heart's step past the last heart, measured off the hearts' own anchor
      // rather than rebuilt from it, so moving the row moves both runs. The
      // column is at its narrowest 180 px, which the two clear together with
      // room over, so the meter never has to be fitted per viewport the way the
      // rack and the wheel are.
      combo: comboRun({ x: livesAt.x + STARTING_LIVES * LIVES_PITCH, y: livesAt.y }),
      // `at` is the first slot's centre and `rackTop` its top edge: the run
      // starts half a slot below the clearance the child was given, or the
      // patience bar drains across the candy in the top slot.
      shelf: {
        at: { x: shelfX, y: Math.round(rackTop + shelf.slot / 2) },
        ...shelf,
        axis: 'column',
      },
      queue: queueLine(
        queue,
        { x: columnX, y: footY },
        1,
        view.width + OFFSTAGE_MARGIN,
        view.width - DOOR_INSET,
      ),
      mute: { x: tabX, y: muteY },
      pause: { x: pauseX, y: tabY },
      sheet: {
        tab: { x: tabX, y: tabY },
        panel: {
          at: {
            x: Math.round(sheetRight - wheel.width / 2),
            y: Math.round(sheetFloor - wheel.height / 2),
          },
          width: wheel.width,
          height: wheel.height,
        },
        radius: wheel.radius,
        node: wheel.node,
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
  // Upright the lane the queue runs back along is the board's own width, so
  // that is what sizes it — the same fit the landscape column is given.
  const queue = queueRun(board.width, cell);
  // Laid across the board's own width rather than down a column, so the run it
  // has to fit in is that width.
  const shelf = shelfRun(board.width);

  // The sheet takes the band above the board — the only slack upright, and the
  // top edge design §4 asks for. It hangs from the board's top edge rather than
  // sitting under the frame's, so a wheel too tall for the band overflows
  // upward, off the screen where a test catches it, rather than down onto the
  // kitchen where nothing would. The tab sits beside the panel and not over it:
  // centred, a 44 px tab would cover the top jar on the smallest phone.
  const wheel = wheelRun(availW - 2 * GUTTER, board.y - insets.top - GUTTER);
  // Hung off the board's top edge, but never at the cost of its own head: on the
  // smallest phone the wheel at its floor is within a few pixels of the whole
  // band, so the gutter above the kitchen is what gives way rather than the
  // panel climbing off the top of the screen.
  const sheetBottom = clamp(board.y - GUTTER / 2, insets.top + wheel.height, board.y);
  // The board's midline, which the sheet and the headline both centre on.
  const midX = Math.round(board.x + board.width / 2);
  const sheetAt = {
    x: midX,
    y: Math.round(sheetBottom - wheel.height / 2),
  };
  // The band the pair rides, named once because both of them read it.
  const tabTop = Math.round(insets.top + TAB_SIZE / 2);
  const sheetTabX = Math.round(sheetAt.x - wheel.width / 2 - GUTTER / 4 - TAB_SIZE / 2);

  // Pause does not join them. Upright the band above the board is the tightest
  // space in the game — on the smallest phone the wheel at its floor is 73 px of
  // a 78 px band, and both shoulders beside it are already the sheet's and the
  // mute's — so a third tab up here can only go under one of them, and under is
  // the kitchen. It takes the far end of the rack's own row instead, which is
  // the strip's one piece of slack and the corner furthest from the window.
  //
  // Clamped rather than placed, the way design §10 already clamps the queue on a
  // short frame: it wants the frame's gutter, it will give that up to keep clear
  // of the rack, and it will not give up being on screen.
  const shelfAtX = right - shelf.slot / 2 - (SHELF_SLOTS - 1) * shelf.pitch;
  const pauseAt = {
    x: Math.round(
      clamp(
        insets.left + GUTTER / 2 + TAB_SIZE / 2,
        insets.left + TAB_SIZE / 2,
        shelfAtX - shelf.slot / 2 - TAB_SIZE / 2,
      ),
    ),
    y: stripTop + SHELF_ROW,
  };

  return {
    orientation: 'portrait',
    cell,
    board,
    hud: {
      // Score and lives take the band above the board, at either end of it.
      score: { x: board.x, y: insets.top + SCORE_ROW },
      // Under the kitchen, not over it: the band above is where the cheat
      // sheet opens, and it is exactly the player mid-tutorial who has it
      // open. The gap below the board is spare on every upright screen but
      // the smallest, where the strip's edge wins and the line hugs the
      // board's bottom wall instead.
      headline: {
        x: midX,
        y: Math.min(board.y + board.height + HEADLINE_LIFT, stripTop - HEADLINE_ROOM),
      },
      lives: {
        at: {
          x: right - 8 - (STARTING_LIVES - 1) * LIVES_PITCH,
          y: insets.top + SCORE_ROW,
        },
        pitch: LIVES_PITCH,
      },
      // Centred in the band's own slack rather than hung off either end of it:
      // upright the score grows leftward from the board's edge and the hearts
      // are pinned to the right, so the middle is the one part of the row
      // neither of them can reach into.
      combo: comboRun({
        // `centre` gives the run's left edge; the anchor is the first pip's
        // middle, half a pip in from it.
        x: centre(board.x, board.width, COMBO_RUN) + COMBO_PIP / 2,
        y: insets.top + SCORE_ROW,
      }),
      shelf: {
        // Right-aligned under the bench's own wall, so the candy's path still
        // reads toward one side once the column has become a strip (design §10).
        at: { x: shelfAtX, y: stripTop + SHELF_ROW },
        ...shelf,
        axis: 'row',
      },
      // The window is at the right-hand end, so the line runs back to the left
      // and the door is off that edge.
      queue: queueLine(
        queue,
        { x: right, y: stripTop + QUEUE_ROW },
        -1,
        -OFFSTAGE_MARGIN,
        DOOR_INSET,
      ),
      // On the wheel's other shoulder, mirroring the sheet's tab. Upright there
      // is width to spare where landscape had none, so the pair straddles the
      // panel instead of stacking — and a tab at either end of the band is two
      // thumbs' worth of reach rather than one.
      mute: {
        x: Math.round(sheetAt.x + wheel.width / 2 + GUTTER / 4 + TAB_SIZE / 2),
        y: tabTop,
      },
      pause: pauseAt,
      sheet: {
        tab: { x: sheetTabX, y: tabTop },
        panel: { at: sheetAt, width: wheel.width, height: wheel.height },
        radius: wheel.radius,
        node: wheel.node,
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
 * The wheel's seating chart, as indices into `PRIMARIES`: each pair of jars,
 * in the order their blended result is seated by `wheelSeats`. The topology
 * lives here and the colour lives in `core/colors.ts`; the widget zips the two,
 * so which candy is drawn where cannot drift from which jars make it.
 */
export const WHEEL_PAIRS = [
  [0, 1],
  [0, 2],
  [1, 2],
] as const;

/** −90°/30°/150°: one jar at the top, two along the bottom. */
const JAR_ANGLES = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6] as const;

const seatAt = (centre: Vec2, radius: number, angle: number): Vec2 => ({
  x: Math.round(centre.x + radius * Math.cos(angle)),
  y: Math.round(centre.y + radius * Math.sin(angle)),
});

const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: Math.round((a.x + b.x) / 2),
  y: Math.round((a.y + b.y) / 2),
});

/** A blended candy's seat, and the two jars the wheel draws a spoke from. */
export interface WheelResult {
  readonly at: Vec2;
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface WheelSeats {
  readonly jars: readonly Vec2[];
  readonly results: readonly WheelResult[];
}

/**
 * Where each of the wheel's six nodes sits: the three jars, and the three
 * candies they blend into, each at the midpoint of the two jars that make it.
 * Drawn between them rather than beside them because that is the whole claim
 * the picture makes — this one and this one give you that one.
 *
 * A result carries the two jars it came from rather than an index back into
 * them, so the widget draws its spokes from what it was handed and never has
 * to know the seating order to find its own endpoints.
 */
export const wheelSeats = (sheet: HudFrame['sheet']): WheelSeats => {
  // The circle's centre is not the panel's. A triangle standing on two feet
  // reaches a full radius up and only half a radius down, so its box is
  // lopsided about the circle it is drawn on — and it is the *box* that has to
  // sit square in the panel. Dropping the circle a quarter radius is what
  // centres the picture rather than the geometry it was built from.
  const centre = { x: sheet.panel.at.x, y: sheet.panel.at.y + sheet.radius / 4 };
  const jars = JAR_ANGLES.map((angle) => seatAt(centre, sheet.radius, angle)) as [
    Vec2,
    Vec2,
    Vec2,
  ];

  // Seated off the same table the colours are mixed from, rather than off a
  // second copy of it written out here: spelling the three pairs again is how
  // the wheel comes to draw orange where green belongs, with every test still
  // green because each node would still be inside the panel.
  return {
    jars,
    results: WHEEL_PAIRS.map(([left, right]) => ({
      at: midpoint(jars[left], jars[right]),
      from: jars[left],
      to: jars[right],
    })),
  };
};

const hits = (tab: Vec2, x: number, y: number): boolean =>
  Math.abs(x - tab.x) <= TAB_SIZE / 2 && Math.abs(y - tab.y) <= TAB_SIZE / 2;

/**
 * Whether a pointer landed on either of the HUD's tabs. GameScene's swipe
 * listens scene-wide and cannot see UIScene's objects, so it asks the layout
 * instead — see the dead zone in `input/swipe.ts`.
 *
 * Deliberately not told which tab it was. Every caller wants the same thing of
 * this — *the player was pressing a control, so do not steer* — and a version
 * that named the tab would be one every new tab has to be threaded through.
 */
export const hitsTab = (frame: Frame, x: number, y: number): boolean =>
  hits(frame.hud.sheet.tab, x, y) ||
  hits(frame.hud.mute, x, y) ||
  hits(frame.hud.pause, x, y);

/**
 * The middle of what the player can actually see — what a full-screen message
 * screen centres its stack of text on. Inset-aware, so a title does not sit
 * under a notch on a phone held upright.
 */
export const screenCentre = (view: Viewport, insets: Insets = NO_INSETS): Vec2 => ({
  x: Math.round(insets.left + (view.width - insets.left - insets.right) / 2),
  y: Math.round(insets.top + (view.height - insets.top - insets.bottom) / 2),
});

/** Close enough to read as one list, far enough apart to read as ten lines. */
const SCORE_PITCH_MIN = 18;
const SCORE_PITCH_MAX = 26;

export interface Scoreboard {
  /** Distance between two entries, in pixels. */
  readonly pitch: number;
  /** How many of them there is room for. */
  readonly shown: number;
}

/**
 * How the high-score table fits the room the menu has left it. Ten entries need
 * most of a phone's height held upright and more than all of one held sideways,
 * so the table is cut to what fits rather than run off the bottom of the screen
 * — a menu whose "press any key" has scrolled away is a menu with no way out.
 *
 * The pitch closes up before any entry is dropped, down to a floor: squeezing a
 * list is a smaller loss than truncating it, but only until the lines touch.
 */
export const scoreboard = (available: number, count: number): Scoreboard => {
  // Floored, not rounded: rounding *up* past the share each entry actually has
  // pushes `available / pitch` below the count and drops an entry while the
  // pitch is still clear of its floor — which is the one thing the paragraph
  // above promises never happens. Flooring keeps `pitch <= available / count`,
  // so the room is always big enough for the entries it was measured against.
  const pitch = Math.floor(
    clamp(available / Math.max(count, 1), SCORE_PITCH_MIN, SCORE_PITCH_MAX),
  );

  return { pitch, shown: clamp(Math.floor(available / pitch), 0, count) };
};

/** Air between a line of text and the frame edge, on every side of it. */
export const TEXT_MARGIN = 16;

/**
 * Air above the line that says how to leave. One number because it is one piece
 * of the design on both message screens, which arrived at it separately.
 */
export const EXIT_GAP = 46;

/**
 * The menu's title shrinks before its table does. `TextStack` scales a line too
 * wide for the frame but knows nothing about its height, so a phone held
 * sideways would wear the title off the top of the screen — and of the two, the
 * word the player is already looking at is the one that can afford to give way.
 */
const TITLE_SIZE = { tall: 56, short: 40 } as const;
const SHORT_FRAME = 420;

/**
 * Half a rendered line, as a share of its nominal size — what the top row has to
 * clear the frame's edge by. Derived rather than tabulated beside `TITLE_SIZE`:
 * a second table of hand-kept numbers is one a changed size silently invalidates.
 */
const HALF_LINE = 0.6;

/** How far the title would like to sit above the middle, given the room. */
const TITLE_DY = -140;
/** Below the tagline, above the table's heading. */
const TITLE_TO_TABLE = 72;

/**
 * The band the menu's parade walks through: two rows of sprites, one behind the
 * other, which is the tallest thing that crosses it.
 */
const PARADE_BAND = 52;
/**
 * What the band leaves under itself. Measured down from `top`, so it is the
 * same clearance whether what stands there is the table's heading or — on a
 * first run, with no table — the line saying how to start.
 */
const PARADE_CLEAR = 40;
/**
 * The tagline's share of the gap under the title. It hangs into that gap rather
 * than sitting above it, so this much of the gap was never free.
 */
const TAGLINE_ROOM = 24;

/**
 * How much taller the menu is for having a parade in it. Most of the band is
 * paid for out of the gap the title already leaves above the table — only the
 * bottom of that gap belongs to the heading, and the top of it to the tagline —
 * so the screen grows by what the band could not find there and no more.
 */
export const PARADE_GROWTH = Math.max(
  PARADE_BAND + PARADE_CLEAR + TAGLINE_ROOM - TITLE_TO_TABLE,
  0,
);

/**
 * Where the menu's rows fall, given the room. Separated from the rows themselves
 * because it is also the answer to "has anything actually moved?" —
 * `Scale.RESIZE` fires on every frame of a window drag, and rebuilding a stack
 * of text objects thirteen times a second to move them a pixel is work nobody
 * asked for.
 */
export interface MenuPlan {
  readonly size: number;
  readonly title: number;
  readonly top: number;
  readonly pitch: number;
  readonly shown: number;
  /**
   * The middle of the band the parade walks through, or undefined when the
   * frame had no room to spare for one.
   */
  readonly parade: number | undefined;
}

export const menuPlan = (height: number, count: number): MenuPlan => {
  const size = TITLE_SIZE[height < SHORT_FRAME ? 'short' : 'tall'];
  // As high as it wants to sit, or as high as the frame lets it, whichever is
  // lower down. Rounded because it is compared, not just drawn: an offset that
  // slides a fraction with every pixel of a window drag is one that reports a
  // new layout on every frame, which is the rebuild the menu's guard prevents.
  const title = Math.round(
    Math.max(TITLE_DY, -(height / 2 - TEXT_MARGIN - size * HALF_LINE)),
  );
  const bare = title + size + TITLE_TO_TABLE;
  const walked = bare + PARADE_GROWTH;
  const roomAt = (at: number): Scoreboard =>
    scoreboard(height / 2 - at - EXIT_GAP - TEXT_MARGIN, count);

  // The parade is furniture and the table is content, so the parade is what
  // gives way — the same order this screen already puts the title in. It walks
  // only when the band costs the table no entry, and only when what is left
  // still ends inside the frame: with no scores yet the table is empty and
  // cannot lose an entry, which would otherwise buy the band a run off the
  // bottom of a short screen for free.
  const walks =
    roomAt(walked).shown === roomAt(bare).shown && walked + TEXT_MARGIN <= height / 2;
  const top = walks ? walked : bare;

  return {
    size,
    title,
    top,
    parade: walks ? walked - PARADE_CLEAR - PARADE_BAND / 2 : undefined,
    ...roomAt(top),
  };
};

/**
 * Where a column of rows falls when it is stacked by the air above each one and
 * then centred as a block — what a screen needs when half its rows are
 * conditional, since a row that is not there takes its air away with it instead
 * of leaving the hole a fixed offset would.
 *
 * Offsets come back relative to the middle of the block, which is the point
 * `TextStack` centres on.
 */
export const centredColumn = (gaps: readonly number[]): readonly number[] => {
  let dy = 0;
  const stacked = gaps.map((gap) => (dy += gap));
  const half = dy / 2;

  return stacked.map((offset) => offset - half);
};
