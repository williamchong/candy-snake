import { eq, stepCell } from './board';
import { blend, type Primary } from './colors';
import { RAW, type Dir, type Segment, type SnakeState, type Vec2 } from './types';

/** Starting length is head-only — no body until the first sugar (design §5). */
export const createSnake = (head: Vec2, dir: Dir): SnakeState => ({
  head,
  dir,
  body: [],
});

export const snakeLength = (snake: SnakeState): number => snake.body.length + 1;

/**
 * Advances one cell. Each segment inherits the cell of the one ahead of it,
 * so the strand follows the head; when `grow` is set the vacated tail cell is
 * kept as a new raw segment instead (eating sugar appends raw — design §4).
 *
 * Growing relies on the caller only setting `grow` when the new head cell
 * held a pickup: pickups never spawn under the strand (design §8.4), so the
 * head can never land on the tail cell it is simultaneously keeping.
 */
export const moveSnake = (snake: SnakeState, dir: Dir, grow: boolean): SnakeState => {
  let carried = snake.head;
  const body = snake.body.map((segment) => {
    const moved = { ...segment, pos: carried };
    carried = segment.pos;
    return moved;
  });
  // `carried` is now the old tail cell (or the old head, on an empty body).
  if (grow) body.push({ pos: carried, color: RAW });

  return { head: stepCell(snake.head, dir), dir, body };
};

/**
 * Kneads a primary into every current body segment (design §4). Each segment
 * blends from its own mix, so a `[red, raw]` strand eating blue becomes
 * `[purple, blue]` rather than one uniform color — that per-segment
 * independence is the whole production line.
 *
 * The head is the candy maker, not sugar, so it holds no color.
 */
export const dyeBody = (snake: SnakeState, primary: Primary): SnakeState => ({
  ...snake,
  body: snake.body.map((segment) => ({
    ...segment,
    color: blend(segment.color, primary),
  })),
});

/**
 * Index of the body segment the head has run into, or -1. Called *after* the
 * move so the tail has already vacated: entering the cell the tail just left
 * is legal, which is the classic snake behaviour.
 */
export const findSelfHit = (snake: SnakeState): number =>
  snake.body.findIndex((segment) => eq(segment.pos, snake.head));

/**
 * Self-collision shatters rather than kills (design §6): the hit segment and
 * everything behind it toward the tail is destroyed, the head and the
 * segments ahead of the impact survive.
 */
export const shatterAt = (
  snake: SnakeState,
  index: number,
): { snake: SnakeState; destroyed: Segment[] } => ({
  snake: { ...snake, body: snake.body.slice(0, index) },
  destroyed: snake.body.slice(index),
});
