import { describe, expect, it } from 'vitest';

import { COLS, ROWS } from './board';
import { BLUE, BROWN, RED, YELLOW } from './colors';
import {
  createSnake,
  dyeBody,
  findSelfHit,
  moveSnake,
  shatterAt,
  snakeLength,
} from './snake';
import {
  Dir,
  RAW,
  type ColorMask,
  type Segment,
  type SnakeState,
  type Vec2,
} from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });

const snakeWith = (head: Vec2, dir: Dir, ...body: Vec2[]): SnakeState => ({
  head,
  dir,
  body: body.map((pos) => ({ pos, color: RAW })),
});

const cellsOf = (segments: readonly Segment[]): Vec2[] =>
  segments.map((segment) => segment.pos);

const positions = (snake: SnakeState): Vec2[] => cellsOf(snake.body);

const colorsOf = (snake: SnakeState): ColorMask[] =>
  snake.body.map((segment) => segment.color);

describe('snake movement', () => {
  it('starts as a head with no body', () => {
    const snake = createSnake(at(8, 8), Dir.Right);

    expect(snake.body).toHaveLength(0);
    expect(snakeLength(snake)).toBe(1);
  });

  it('advances one cell per move and adopts the new direction', () => {
    const moved = moveSnake(createSnake(at(5, 5), Dir.Right), Dir.Up, false);

    expect(moved.head).toEqual(at(5, 4));
    expect(moved.dir).toBe(Dir.Up);
  });

  it('wraps at the board edge', () => {
    const moved = moveSnake(
      createSnake(at(COLS - 1, ROWS - 1), Dir.Right),
      Dir.Right,
      false,
    );

    expect(moved.head).toEqual(at(0, ROWS - 1));
  });

  it('pulls each segment into the cell ahead of it', () => {
    const moved = moveSnake(
      snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5)),
      Dir.Right,
      false,
    );

    expect(moved.head).toEqual(at(6, 5));
    expect(positions(moved)).toEqual([at(5, 5), at(4, 5)]);
  });

  it('appends a raw segment at the vacated tail when growing', () => {
    const moved = moveSnake(
      snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5)),
      Dir.Right,
      true,
    );

    expect(positions(moved)).toEqual([at(5, 5), at(4, 5), at(3, 5)]);
    expect(moved.body.at(-1)?.color).toBe(RAW);
  });

  it('grows a bodyless snake into the cell the head left', () => {
    const moved = moveSnake(createSnake(at(5, 5), Dir.Right), Dir.Right, true);

    expect(moved.head).toEqual(at(6, 5));
    expect(positions(moved)).toEqual([at(5, 5)]);
    expect(snakeLength(moved)).toBe(2);
  });
});

describe('self-collision detection', () => {
  it('reports no hit for a straight strand', () => {
    const moved = moveSnake(
      snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5)),
      Dir.Right,
      false,
    );

    expect(findSelfHit(moved)).toBe(-1);
  });

  it('allows entering the cell the tail just vacated', () => {
    const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1));
    const moved = moveSnake(coiled, Dir.Left, false);

    expect(moved.head).toEqual(at(0, 1));
    expect(findSelfHit(moved)).toBe(-1);
  });

  it('detects a hit mid-body', () => {
    const coiled = snakeWith(
      at(1, 1),
      Dir.Left,
      at(1, 0),
      at(0, 0),
      at(0, 1),
      at(0, 2),
      at(1, 2),
    );
    const moved = moveSnake(coiled, Dir.Left, false);

    expect(findSelfHit(moved)).toBe(3);
  });

  it('detects a hit on the final segment', () => {
    const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1), at(0, 2));
    const moved = moveSnake(coiled, Dir.Left, false);

    expect(findSelfHit(moved)).toBe(moved.body.length - 1);
  });
});

describe('shatter', () => {
  const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1), at(0, 2));

  it('destroys the hit segment and everything behind it', () => {
    const { snake, destroyed } = shatterAt(coiled, 2);

    expect(positions(snake)).toEqual([at(1, 0), at(0, 0)]);
    expect(cellsOf(destroyed)).toEqual([at(0, 1), at(0, 2)]);
  });

  it('never destroys the head', () => {
    const { snake } = shatterAt(coiled, 0);

    expect(snake.head).toEqual(coiled.head);
    expect(snake.body).toHaveLength(0);
  });

  it('loses only the last segment when the tail is hit', () => {
    const { snake, destroyed } = shatterAt(coiled, coiled.body.length - 1);

    expect(snake.body).toHaveLength(coiled.body.length - 1);
    expect(cellsOf(destroyed)).toEqual([at(0, 2)]);
  });

  it('reports the colors that were lost, not just the cells', () => {
    const dyed = dyeBody(coiled, RED);
    const { destroyed } = shatterAt(dyed, 2);

    expect(destroyed.map((segment) => segment.color)).toEqual([RED, RED]);
  });
});

describe('dyeBody', () => {
  const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5));

  it('kneads the primary into every segment', () => {
    expect(colorsOf(dyeBody(strand, RED))).toEqual([RED, RED]);
  });

  it('blends each segment from its own mix, not from a shared one', () => {
    // A red head-end with a raw tail: the production line that makes the game.
    const mixed: SnakeState = {
      ...strand,
      body: [
        { pos: at(4, 5), color: RED },
        { pos: at(3, 5), color: RAW },
      ],
    };

    expect(colorsOf(dyeBody(mixed, BLUE))).toEqual([RED | BLUE, BLUE]);
  });

  it('over-mixes into brown rather than cycling back', () => {
    const purple = dyeBody(dyeBody(strand, RED), BLUE);

    expect(colorsOf(dyeBody(purple, YELLOW))).toEqual([BROWN, BROWN]);
  });

  it('does nothing to a snake with no body — the dye is wasted', () => {
    const bodyless = createSnake(at(5, 5), Dir.Right);

    expect(dyeBody(bodyless, RED)).toEqual(bodyless);
  });

  it('leaves segments where they are', () => {
    expect(positions(dyeBody(strand, YELLOW))).toEqual(positions(strand));
  });
});
