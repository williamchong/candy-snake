import { describe, expect, it } from 'vitest';

import { CHOP_BLOCK_HEIGHT, CHOP_BLOCK_TOP, COLS, ROWS } from '../core/board';
import { SHELF_SLOTS } from '../core/shelf';
import type { Vec2 } from '../core/types';
import { CELL_SIZE } from '../render/textures';
// Loads under Node because its Phaser import is type-only and so erased —
// the exception CLAUDE.md carves out for the engine-free rule.
import { CHILD_HEIGHT } from './customerView';
import {
  CHILD_HEADROOM,
  CHILD_UNDERFOOT,
  hitsTab,
  layout,
  LIVES_CLEARANCE,
  scoreboard,
  TAB_SIZE,
  wheelSeats,
  WHEEL_PAIRS,
  type Frame,
  type Viewport,
} from './layout';

/** The desktop frame the game shipped at before it had to be responsive. */
const DESKTOP: Viewport = { width: 960, height: 640 };

const VIEWPORTS: ReadonlyArray<readonly [string, Viewport]> = [
  ['the desktop frame', DESKTOP],
  ['a wide desktop window', { width: 1440, height: 900 }],
  ['a tablet, landscape', { width: 1024, height: 768 }],
  ['a tablet, portrait', { width: 768, height: 1024 }],
  ['a phone, landscape', { width: 844, height: 390 }],
  ['a phone, portrait', { width: 390, height: 844 }],
  ['a small phone, landscape', { width: 568, height: 320 }],
  ['a small phone, portrait', { width: 320, height: 568 }],
];

/** Where the rack's first slot starts, along whichever axis it runs. */
const shelfStart = (frame: Frame): number => {
  const { at, slot, axis } = frame.hud.shelf;
  return (axis === 'column' ? at.y : at.x) - slot / 2;
};

/** Where the rack's last slot ends, along whichever axis it runs. */
const shelfEnd = (frame: Frame): number => {
  const { at, pitch, slot, axis } = frame.hud.shelf;
  const start = axis === 'column' ? at.y : at.x;
  return start + (SHELF_SLOTS - 1) * pitch + slot / 2;
};

interface Rect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const around = (centre: Vec2, width: number, height: number): Rect => ({
  left: centre.x - width / 2,
  right: centre.x + width / 2,
  top: centre.y - height / 2,
  bottom: centre.y + height / 2,
});

/** The box the cheat sheet fills when it is open. */
const sheetRect = (frame: Frame): Rect => {
  const { panel } = frame.hud.sheet;
  return around(panel.at, panel.width, panel.height);
};

/** The tab's touch target, which is the tab whatever the tab is drawn as. */
const tabRect = (frame: Frame): Rect => around(frame.hud.sheet.tab, TAB_SIZE, TAB_SIZE);

const boardRect = (frame: Frame): Rect => ({
  left: frame.board.x,
  right: frame.board.x + frame.board.width,
  top: frame.board.y,
  bottom: frame.board.y + frame.board.height,
});

/** Touching edges is not overlapping — the gutter is allowed to be nothing. */
const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

const onScreen = (rect: Rect, view: Viewport): boolean =>
  rect.left >= 0 &&
  rect.top >= 0 &&
  rect.right <= view.width &&
  rect.bottom <= view.height;

describe('layout', () => {
  it('keeps the desktop frame drawing the board at its authored size', () => {
    // The board is never scaled up past 1:1, so the frame the game was built
    // at is still the frame it draws at — nothing about the responsive pass
    // resamples the desktop build.
    const { board, cell } = layout(DESKTOP);

    expect(cell).toBe(CELL_SIZE);
    expect(board.scale).toBe(1);
    expect(board).toMatchObject({ width: 512, height: 512 });
  });

  it('puts the serving column beside the bench wall in landscape', () => {
    const { hud, board, orientation } = layout(DESKTOP);

    expect(orientation).toBe('landscape');
    // Score, rack and queue all sit clear of the board's right edge, which is
    // the wall the chopping block cuts against (design §10).
    for (const x of [hud.score.x, hud.shelf.at.x, hud.queue.front.x]) {
      expect(x).toBeGreaterThanOrEqual(board.x + board.width);
    }
    expect(hud.shelf.axis).toBe('column');
    // The line runs away from the window, toward the door off the right edge.
    expect(hud.queue.pitch).toBeGreaterThan(0);
    expect(hud.queue.offstage).toBeGreaterThan(DESKTOP.width);
  });

  it('splits the HUD either side of the board in portrait', () => {
    const view = { width: 390, height: 844 };
    const frame = layout(view);
    const { hud, board, orientation } = frame;

    expect(orientation).toBe('portrait');
    // Score above, rack and queue below: a square board on a tall screen leaves
    // slack either way, so it is spent on both edges rather than one gap.
    expect(hud.score.y).toBeLessThan(board.y);
    expect(hud.lives.at.y).toBeLessThan(board.y);
    for (const y of [hud.shelf.at.y, hud.queue.front.y]) {
      expect(y).toBeGreaterThanOrEqual(board.y + board.height);
    }
    // The rack turns on its side and right-aligns with the board, so the queue
    // still runs back from the wall the bench is on.
    expect(hud.shelf.axis).toBe('row');
    expect(shelfEnd(frame)).toBeLessThanOrEqual(board.x + board.width);
    expect(hud.queue.pitch).toBeLessThan(0);
    expect(hud.queue.offstage).toBeLessThan(0);
  });

  it('fills the width of a phone held upright', () => {
    const { board } = layout({ width: 390, height: 844 });

    // Within a gutter either side: the board is what the screen is for.
    expect(board.width).toBeGreaterThan(390 - 2 * 16 - COLS);
    expect(board.x + board.width).toBeLessThanOrEqual(390);
  });

  it('shrinks the rack to fit a phone held sideways', () => {
    // Six slots at the desktop pitch need most of a laptop's height. On a phone
    // in landscape they have to share the column with a child.
    const phone = layout({ width: 844, height: 390 });
    const desktop = layout(DESKTOP);

    expect(phone.hud.shelf.pitch).toBeLessThan(desktop.hud.shelf.pitch);
    expect(phone.hud.shelf.slot).toBeLessThan(desktop.hud.shelf.slot);
  });

  it.each(VIEWPORTS)('keeps the front child clear of the lives row on %s', (_n, view) => {
    // What the window's clamp actually buys. The line wants the bench's row,
    // but on a short screen the board rides high enough that a child standing
    // there would hold their bubble up through the hearts.
    const { hud, orientation } = layout(view);
    if (orientation !== 'landscape') return;

    expect(hud.queue.front.y - CHILD_HEADROOM).toBeGreaterThanOrEqual(
      hud.lives.at.y + LIVES_CLEARANCE,
    );
  });

  it('stands the front child at the serving window in landscape', () => {
    // What the playtest asked for: a child was waiting the length of the column
    // away from the counter their candy is cut on. The standing line is the
    // bench's own last row now, so the block and the window read as one place
    // (design §2, §10).
    const { hud, board, cell } = layout(DESKTOP);
    const lastRow = board.y + (CHOP_BLOCK_TOP + CHOP_BLOCK_HEIGHT - 1) * cell;

    expect(hud.queue.front.y).toBeGreaterThanOrEqual(lastRow);
    expect(hud.queue.front.y).toBeLessThanOrEqual(lastRow + cell);
    // In the serving lane against that wall, not out in the sheet's corner.
    expect(hud.queue.front.x).toBeGreaterThanOrEqual(board.x + board.width);
    expect(hud.queue.front.x).toBeLessThan(hud.sheet.tab.x - TAB_SIZE / 2);
  });

  it.each(VIEWPORTS)('keeps the rack clear of the queue on %s', (_name, view) => {
    // The two share the landscape column, the window above and the rack below
    // it — which is the order a candy travels in, offered to the queue first
    // and racked only if nobody there wants it (design §5). What has to clear
    // the top slot is not the standing line but everything hanging off it: the
    // patience bar, and the lane a child steps into on their way out.
    const frame = layout(view);
    const { shelf, queue } = frame.hud;
    if (frame.orientation === 'landscape') {
      expect(queue.front.y + CHILD_UNDERFOOT).toBeLessThanOrEqual(shelfStart(frame));
      return;
    }
    // Upright the rack is the row above the strip's child rather than below,
    // so it is the bubble over their head that has to clear it.
    expect(shelf.at.y + shelf.slot / 2 + CHILD_HEADROOM).toBeLessThanOrEqual(
      queue.front.y,
    );
  });

  it.each(VIEWPORTS)('lands on whole pixels on %s', (_name, view) => {
    const { cell, board } = layout(view);

    expect(Number.isInteger(cell)).toBe(true);
    // The board is drawn at CELL_SIZE internally and scaled as one container,
    // so this is what keeps a cell a whole number of screen pixels.
    expect(CELL_SIZE * board.scale).toBe(cell);
    expect(board.width).toBe(cell * COLS);
    expect(board.height).toBe(cell * ROWS);
  });

  it.each(VIEWPORTS)('keeps the board on screen on %s', (_name, view) => {
    const { board } = layout(view);

    expect(board.x).toBeGreaterThanOrEqual(0);
    expect(board.y).toBeGreaterThanOrEqual(0);
    expect(board.x + board.width).toBeLessThanOrEqual(view.width);
    expect(board.y + board.height).toBeLessThanOrEqual(view.height);
  });

  it.each(VIEWPORTS)('never laps the board over the HUD on %s', (_name, view) => {
    const frame = layout(view);
    const { board, hud, orientation } = frame;

    // One axis separates them: the column is beside the board, the strip below
    // it. Whichever it is, the rack may never land on the kitchen.
    const clear =
      orientation === 'landscape'
        ? hud.shelf.at.x >= board.x + board.width
        : hud.shelf.at.y >= board.y + board.height;
    expect(clear).toBe(true);

    // And the rack has to end somewhere on the screen, not past the edge of it.
    expect(shelfEnd(frame)).toBeLessThanOrEqual(
      orientation === 'landscape' ? view.height : view.width,
    );
  });

  it.each(VIEWPORTS)('keeps the queue on screen on %s', (_name, view) => {
    const { hud } = layout(view);

    expect(hud.queue.front.y).toBeGreaterThan(0);
    expect(hud.queue.front.y).toBeLessThan(view.height);
    expect(hud.queue.front.x).toBeGreaterThan(0);
    expect(hud.queue.front.x).toBeLessThan(view.width);
  });

  it.each(VIEWPORTS)('cuts the doorway crowd on the frame edge on %s', (_name, view) => {
    const { queue } = layout(view).hud;

    // Between the line and off-stage, on the door's own side. A doorway wholly
    // on screen would read as another queue; wholly off it would tell the
    // player nothing (design §7's telegraph).
    const downLine = Math.sign(queue.pitch);
    expect(Math.sign(queue.door - queue.front.x)).toBe(downLine);
    expect(Math.sign(queue.offstage - queue.door)).toBe(downLine);

    // And close enough to the edge to be actually cut by it: the door is a
    // child's centre, so anything within half a child of the boundary has the
    // frame running through them. Off the view's own constant, so a child drawn
    // at a different scale moves this with it.
    const edge = downLine > 0 ? view.width : 0;
    expect(Math.abs(queue.door - edge)).toBeLessThan(CHILD_HEIGHT / 2);
  });

  it('hangs the cheat sheet off the far corner in landscape', () => {
    const frame = layout(DESKTOP);
    const { sheet } = frame.hud;

    // Tab in the bottom corner of the frame, on the serving side — the far
    // side from the kitchen, and the corner design §4 asks for on desktop.
    expect(sheet.tab.x).toBeGreaterThan(frame.board.x + frame.board.width);
    expect(sheet.tab.y).toBeGreaterThan(DESKTOP.height - TAB_SIZE - 2 * 16);
    // Panel and tab hang off the same edge, so the sheet reads as one column
    // against the serving wall rather than two unrelated things.
    expect(sheetRect(frame).right).toBe(tabRect(frame).right);
  });

  it('puts the cheat-sheet tab on the top edge in portrait', () => {
    const view = { width: 390, height: 844 };
    const frame = layout(view);

    expect(frame.orientation).toBe('portrait');
    expect(frame.hud.sheet.tab.y).toBeLessThan(frame.board.y);
    expect(tabRect(frame).top).toBeGreaterThanOrEqual(0);
    // The drawer opens above the kitchen, and the tab sits beside it rather
    // than over it — centred, a 44px tab would cover the topmost jar.
    expect(sheetRect(frame).bottom).toBeLessThanOrEqual(frame.board.y);
    expect(overlaps(tabRect(frame), sheetRect(frame))).toBe(false);
  });

  it('shrinks the wheel to fit a small phone', () => {
    // The same bargain the rack makes: the node and the radius come down
    // together rather than the panel running off the screen.
    const small = layout({ width: 320, height: 568 }).hud.sheet;
    const roomy = layout({ width: 768, height: 1024 }).hud.sheet;

    expect(small.node).toBeLessThan(roomy.node);
    expect(small.radius).toBeLessThan(roomy.radius);
    expect(small.panel.height).toBeLessThan(roomy.panel.height);
  });

  it.each(VIEWPORTS)(
    'never covers the kitchen with the cheat sheet on %s',
    (_name, view) => {
      // Design §4's one non-negotiable: the sheet is allowed to veil the HUD,
      // and never the grid the player is steering on.
      const frame = layout(view);

      expect(overlaps(sheetRect(frame), boardRect(frame))).toBe(false);
      expect(overlaps(tabRect(frame), boardRect(frame))).toBe(false);
    },
  );

  it.each(VIEWPORTS)('keeps the cheat sheet on screen on %s', (_name, view) => {
    const frame = layout(view);

    expect(onScreen(sheetRect(frame), view)).toBe(true);
    expect(onScreen(tabRect(frame), view)).toBe(true);
  });

  it.each(VIEWPORTS)('keeps the wheel inside its own panel on %s', (_name, view) => {
    // The panel's size is a formula over the node, and a formula is exactly the
    // kind of thing that goes quietly wrong when a constant beside it moves.
    const frame = layout(view);
    const { node } = frame.hud.sheet;
    const panel = sheetRect(frame);
    const wheel = wheelSeats(frame.hud.sheet);
    const seats = [...wheel.jars, ...wheel.results.map((result) => result.at)];

    expect(wheel.jars).toHaveLength(3);
    expect(wheel.results).toHaveLength(WHEEL_PAIRS.length);
    for (const seat of seats) {
      const box = around(seat, node, node);

      expect(box.left).toBeGreaterThanOrEqual(panel.left);
      expect(box.right).toBeLessThanOrEqual(panel.right);
      expect(box.top).toBeGreaterThanOrEqual(panel.top);
      expect(box.bottom).toBeLessThanOrEqual(panel.bottom);
    }
  });

  it('seats each candy between the two jars that actually make it', () => {
    // The claim the whole picture makes. `core/colors.ts` blends the pair that
    // `WHEEL_PAIRS` names, so if a result were seated between any other two
    // jars the wheel would quietly teach the wrong recipe — and every other
    // assertion here would still pass, because it would still be inside the
    // panel.
    const wheel = wheelSeats(layout(DESKTOP).hud.sheet);

    wheel.results.forEach((result, index) => {
      const [left, right] = WHEEL_PAIRS[index] ?? [0, 0];

      expect(result.from).toEqual(wheel.jars[left]);
      expect(result.to).toEqual(wheel.jars[right]);
      expect(result.at.x).toBe(Math.round((result.from.x + result.to.x) / 2));
      expect(result.at.y).toBe(Math.round((result.from.y + result.to.y) / 2));
    });
  });

  it.each(VIEWPORTS)('knows what landed on the cheat-sheet tab on %s', (_name, view) => {
    // What the swipe's dead zone asks, so that pressing the tab opens the
    // drawer without also steering the strand. A pointer just outside has to
    // steer as normal, or the HUD would be eating gestures meant for the game.
    const frame = layout(view);
    const { tab } = frame.hud.sheet;

    expect(hitsTab(frame, tab.x, tab.y)).toBe(true);
    expect(hitsTab(frame, tab.x - TAB_SIZE / 2, tab.y)).toBe(true);
    expect(hitsTab(frame, tab.x - TAB_SIZE / 2 - 1, tab.y)).toBe(false);
    expect(hitsTab(frame, tab.x, tab.y + TAB_SIZE / 2 + 1)).toBe(false);
    // The middle of the kitchen is never the tab, whatever the viewport.
    expect(hitsTab(frame, frame.board.x + frame.board.width / 2, frame.board.y)).toBe(
      false,
    );
  });

  it.each(VIEWPORTS)('keeps the cheat-sheet tab a thumb wide on %s', (_name, view) => {
    // Asserting the constant against itself would prove nothing. What can
    // actually go wrong is a 44px target hanging off the edge of a small
    // phone, leaving less than a thumb of it to press (design §10).
    const tab = tabRect(layout(view));

    expect(tab.right - tab.left).toBeGreaterThanOrEqual(44);
    expect(tab.bottom - tab.top).toBeGreaterThanOrEqual(44);
    expect(onScreen(tab, view)).toBe(true);
  });

  it.each(VIEWPORTS)(
    'keeps the cheat sheet clear of the rack and the queue on %s',
    (_n, view) => {
      const frame = layout(view);
      const panel = sheetRect(frame);

      if (frame.orientation === 'landscape') {
        // The column is the rack's, window to floor; the sheet takes what is
        // left beyond it, in the corner below the child's own feet.
        expect(panel.left).toBeGreaterThanOrEqual(
          frame.hud.shelf.at.x + frame.hud.shelf.slot / 2,
        );
        expect(panel.bottom).toBeGreaterThan(frame.hud.queue.front.y);
        expect(panel.bottom).toBeLessThanOrEqual(tabRect(frame).top);
        // Right-aligned to the frame, which is what keeps a wheel that has
        // outgrown its band off the queue: it rises past the line rather than
        // into the children, who queue from the wall outward.
        expect(panel.left).toBeGreaterThan(frame.hud.queue.front.x);
        return;
      }
      // Upright the sheet is above the board and the strip is below it, so the
      // only neighbour it can collide with is the row of hearts.
      expect(panel.right).toBeLessThanOrEqual(frame.hud.lives.at.x);
    },
  );

  it('takes the safe area out of the frame before laying anything out', () => {
    const view = { width: 390, height: 844 };
    const notch = { top: 59, right: 0, bottom: 34, left: 0 };

    const bare = layout(view);
    const inset = layout(view, notch);

    expect(inset.board.y).toBeGreaterThanOrEqual(notch.top);
    // The strip is anchored to the bottom of the usable frame, so the home
    // indicator pushes the whole queue up rather than sitting under it.
    expect(inset.hud.queue.front.y).toBeLessThan(bare.hud.queue.front.y);
    expect(inset.hud.queue.front.y).toBeLessThanOrEqual(view.height - notch.bottom);
    // A top-edge control's whole failure mode: the cheat-sheet tab sitting
    // under the notch, where it can be seen and not pressed.
    expect(inset.hud.sheet.tab.y - TAB_SIZE / 2).toBeGreaterThanOrEqual(notch.top);
  });

  it('holds a floor under the cell size on a viewport too small to fit one', () => {
    // Nothing sane produces this, but a layout pass that returns a negative
    // board is worse than one that returns an unplayably small one.
    const { cell, board } = layout({ width: 200, height: 200 });

    expect(cell).toBeGreaterThan(0);
    expect(board.width).toBeGreaterThan(0);
    expect(board.scale).toBeGreaterThan(0);
  });
});

describe('scoreboard', () => {
  /** What the menu leaves the table: everything under it, less the prompt. */
  const room = ([, view]: readonly [string, Viewport]): number => view.height / 2 - 40;

  it.each(VIEWPORTS)('keeps the table inside the room it was given on %s', (...entry) => {
    const available = room(entry);

    const { pitch, shown } = scoreboard(available, 10);

    // The last entry's own offset, which is what has to clear the bottom.
    expect((shown - 1) * pitch).toBeLessThanOrEqual(available);
    expect(shown).toBeGreaterThan(0);
  });

  it('never shows more entries than there are', () => {
    expect(scoreboard(1_000, 3).shown).toBe(3);
    expect(scoreboard(1_000, 0).shown).toBe(0);
  });

  it('closes the pitch up before it drops an entry', () => {
    // Room for ten at a squeeze: all ten stay, sitting closer together.
    const tight = scoreboard(200, 10);

    expect(tight.shown).toBe(10);
    expect(tight.pitch).toBeLessThan(scoreboard(400, 10).pitch);
  });

  it('drops entries rather than closing the pitch past reading', () => {
    const cramped = scoreboard(90, 10);

    expect(cramped.shown).toBeLessThan(10);
    expect(cramped.pitch).toBe(scoreboard(20, 10).pitch);
  });

  it('holds a ceiling on the pitch, so a tall window is not a sparse list', () => {
    expect(scoreboard(4_000, 10).pitch).toBe(scoreboard(400, 10).pitch);
  });

  it('asks for nothing on a frame with no room left in it', () => {
    const { shown } = scoreboard(0, 10);

    expect(shown).toBe(0);
  });
});
