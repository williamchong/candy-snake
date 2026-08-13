/**
 * Screen geometry. Architecture §9 makes this the only file that knows about
 * it; for now it holds just the frame, because the MVP is a fixed 960×640
 * landscape canvas (`Scale.FIT`). The mobile phase replaces these fixed values
 * with a `layout()` pass over the real viewport, and the board's own geometry —
 * still in `render/boardView.ts` — joins them here when it does.
 */
export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 640;

/** Where a full-screen message screen centres its stack of text. */
export const CENTRE_X = GAME_WIDTH / 2;
