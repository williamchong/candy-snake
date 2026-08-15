import { describe, expect, it } from 'vitest';

import { COLS, ROWS } from '../core/board';
import { SHELF_SLOTS } from '../core/shelf';
import { CELL_SIZE } from '../render/textures';
import { layout, type Frame, type Viewport } from './layout';

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

/** Where the rack's last slot ends, along whichever axis it runs. */
const shelfEnd = (frame: Frame): number => {
  const { at, pitch, slot, axis } = frame.hud.shelf;
  const start = axis === 'column' ? at.y : at.x;
  return start + (SHELF_SLOTS - 1) * pitch + slot / 2;
};

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

  it.each(VIEWPORTS)('keeps the rack clear of the lives row on %s', (_name, view) => {
    // The rack hangs level with the bench, but on a short screen the board
    // rides high enough that the bench row is above the hearts — and a rack
    // hung there is drawn straight through them.
    const { hud, orientation } = layout(view);
    if (orientation !== 'landscape') return;

    const rackTop = hud.shelf.at.y - hud.shelf.slot / 2;
    expect(rackTop).toBeGreaterThan(hud.lives.at.y);
  });

  it.each(VIEWPORTS)('keeps the rack clear of the queue on %s', (_name, view) => {
    // The two share the landscape column, and a child is a good deal taller
    // than the line they stand on.
    const frame = layout(view);
    if (frame.orientation !== 'landscape') return;

    expect(shelfEnd(frame)).toBeLessThan(frame.hud.queue.front.y);
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
