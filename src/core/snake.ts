import { eq, stepCell } from './board';
import { blend, type Primary } from './colors';
import {
  RAW,
  type ColorMask,
  type Dir,
  type Segment,
  type SnakeState,
  type Vec2,
} from './types';

/** Starting length is head-only — no body until the first sugar (design §5). */
export const createSnake = (head: Vec2, dir: Dir): SnakeState => ({
  head,
  dir,
  body: [],
});

export const snakeLength = (snake: SnakeState): number => snake.body.length + 1;

/**
 * Advances one cell. Each segment inherits the cell of the one ahead of it,
 * so the strand follows the head — and therefore retraces the head's path
 * exactly, which is what lets a pickup dye or feed the whole strand simply by
 * sitting still while it goes by (design §5).
 */
export const moveSnake = (snake: SnakeState, dir: Dir): SnakeState => {
  let carried = snake.head;
  const body = snake.body.map((segment) => {
    const moved = { ...segment, pos: carried };
    carried = segment.pos;
    return moved;
  });

  return { head: stepCell(snake.head, dir), dir, body };
};

/**
 * Appends a raw segment at `pos` — the sugar cube's own cell, which the tail
 * has just vacated, so the new tail lands exactly where the cube was and the
 * strand stays unbroken (design §5).
 */
export const growTail = (snake: SnakeState, pos: Vec2): SnakeState => ({
  ...snake,
  body: [...snake.body, { pos, color: RAW }],
});

/** Index of the body segment standing on `pos`, or -1. */
const bodyIndexAt = (snake: SnakeState, pos: Vec2): number =>
  snake.body.findIndex((segment) => eq(segment.pos, pos));

/** Whether the strand — head or any segment — is on `pos`. */
export const coversCell = (snake: SnakeState, pos: Vec2): boolean =>
  eq(snake.head, pos) || bodyIndexAt(snake, pos) >= 0;

/**
 * Kneads a primary into the one segment standing on `pos`, and reports its new
 * mix. Each segment blends from its own color, so a `[red, raw]` strand
 * crossing blue becomes `[purple, blue]` rather than one uniform color — that
 * per-segment independence is the whole production line (design §4).
 *
 * Returns `undefined` when no segment is there: an empty cell, or the head,
 * which is the candy maker rather than sugar and so holds no color.
 */
export const dyeSegmentAt = (
  snake: SnakeState,
  pos: Vec2,
  primary: Primary,
): { snake: SnakeState; color: ColorMask } | undefined => {
  const index = bodyIndexAt(snake, pos);
  const segment = snake.body[index];
  if (segment === undefined) return undefined;

  const color = blend(segment.color, primary);
  return {
    snake: {
      ...snake,
      body: snake.body.map((current, at) =>
        at === index ? { ...current, color } : current,
      ),
    },
    color,
  };
};

/**
 * Index of the body segment the head has run into, or -1. Called *after* the
 * move so the tail has already vacated: entering the cell the tail just left
 * is legal, which is the classic snake behaviour.
 */
export const findSelfHit = (snake: SnakeState): number => bodyIndexAt(snake, snake.head);

/**
 * Self-collision breaks the strand rather than killing (design §6): the hit
 * segment and everything behind it toward the tail is cut loose, the head and
 * the segments ahead of the impact survive. The severed piece comes back in
 * impact-to-tail order, which is the order it then crumbles in.
 */
export const shatterAt = (
  snake: SnakeState,
  index: number,
): { snake: SnakeState; severed: Segment[] } => ({
  snake: { ...snake, body: snake.body.slice(0, index) },
  severed: snake.body.slice(index),
});
