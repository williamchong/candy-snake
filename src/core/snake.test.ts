import { describe, expect, it } from 'vitest';

import { COLS, ROWS } from './board';
import { BLUE, BROWN, RED, YELLOW } from './colors';
import {
  coversCell,
  createSnake,
  dyeSegmentAt,
  findSelfHit,
  growTail,
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
    const moved = moveSnake(createSnake(at(5, 5), Dir.Right), Dir.Up);

    expect(moved.head).toEqual(at(5, 4));
    expect(moved.dir).toBe(Dir.Up);
  });

  it('wraps at the board edge', () => {
    const moved = moveSnake(createSnake(at(COLS - 1, ROWS - 1), Dir.Right), Dir.Right);

    expect(moved.head).toEqual(at(0, ROWS - 1));
  });

  it('pulls each segment into the cell ahead of it', () => {
    const moved = moveSnake(
      snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5)),
      Dir.Right,
    );

    expect(moved.head).toEqual(at(6, 5));
    expect(positions(moved)).toEqual([at(5, 5), at(4, 5)]);
  });

  it('leaves the strand the same length — growth is growTail’s job', () => {
    const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5));

    expect(snakeLength(moveSnake(strand, Dir.Right))).toBe(snakeLength(strand));
  });
});

describe('growTail', () => {
  it('appends a raw segment at the cube’s own cell', () => {
    const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5));
    const grown = growTail(strand, at(3, 5));

    expect(positions(grown)).toEqual([at(4, 5), at(3, 5)]);
    expect(grown.body.at(-1)?.color).toBe(RAW);
  });

  it('gives a bodyless snake its first segment', () => {
    const grown = growTail(createSnake(at(5, 5), Dir.Right), at(4, 5));

    expect(positions(grown)).toEqual([at(4, 5)]);
    expect(snakeLength(grown)).toBe(2);
  });

  it('leaves the head where it is', () => {
    const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5));

    expect(growTail(strand, at(3, 5)).head).toEqual(strand.head);
  });
});

describe('coversCell', () => {
  const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5));

  it('counts the head, so a pickup is not spent the tick it is opened', () => {
    expect(coversCell(strand, at(5, 5))).toBe(true);
  });

  it('counts every body segment', () => {
    expect(coversCell(strand, at(4, 5))).toBe(true);
    expect(coversCell(strand, at(3, 5))).toBe(true);
  });

  it('reports a clear cell', () => {
    expect(coversCell(strand, at(2, 5))).toBe(false);
  });
});

describe('self-collision detection', () => {
  it('reports no hit for a straight strand', () => {
    const moved = moveSnake(
      snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5)),
      Dir.Right,
    );

    expect(findSelfHit(moved)).toBe(-1);
  });

  it('allows entering the cell the tail just vacated', () => {
    const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1));
    const moved = moveSnake(coiled, Dir.Left);

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
    const moved = moveSnake(coiled, Dir.Left);

    expect(findSelfHit(moved)).toBe(3);
  });

  it('detects a hit on the final segment', () => {
    const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1), at(0, 2));
    const moved = moveSnake(coiled, Dir.Left);

    expect(findSelfHit(moved)).toBe(moved.body.length - 1);
  });
});

describe('shatter', () => {
  const coiled = snakeWith(at(1, 1), Dir.Left, at(1, 0), at(0, 0), at(0, 1), at(0, 2));

  it('severs the hit segment and everything behind it', () => {
    const { snake, severed } = shatterAt(coiled, 2);

    expect(positions(snake)).toEqual([at(1, 0), at(0, 0)]);
    expect(cellsOf(severed)).toEqual([at(0, 1), at(0, 2)]);
  });

  it('hands the severed piece back impact end first, the order it crumbles', () => {
    const { severed } = shatterAt(coiled, 1);

    expect(cellsOf(severed)).toEqual([at(0, 0), at(0, 1), at(0, 2)]);
  });

  it('never severs the head', () => {
    const { snake } = shatterAt(coiled, 0);

    expect(snake.head).toEqual(coiled.head);
    expect(snake.body).toHaveLength(0);
  });

  it('loses only the last segment when the tail is hit', () => {
    const { snake, severed } = shatterAt(coiled, coiled.body.length - 1);

    expect(snake.body).toHaveLength(coiled.body.length - 1);
    expect(cellsOf(severed)).toEqual([at(0, 2)]);
  });

  it('reports the colors that were lost, not just the cells', () => {
    const dyed: SnakeState = {
      ...coiled,
      body: coiled.body.map((segment) => ({ ...segment, color: RED })),
    };
    const { severed } = shatterAt(dyed, 2);

    expect(severed.map((segment) => segment.color)).toEqual([RED, RED]);
  });
});

describe('dyeSegmentAt', () => {
  const strand = snakeWith(at(5, 5), Dir.Right, at(4, 5), at(3, 5));

  it('kneads the primary into only the segment standing on the cell', () => {
    const dyed = dyeSegmentAt(strand, at(4, 5), RED);

    expect(colorsOf(dyed!.snake)).toEqual([RED, RAW]);
    expect(dyed?.color).toBe(RED);
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

    expect(dyeSegmentAt(mixed, at(4, 5), BLUE)?.color).toBe(RED | BLUE);
    expect(dyeSegmentAt(mixed, at(3, 5), BLUE)?.color).toBe(BLUE);
  });

  it('over-mixes into brown rather than cycling back', () => {
    const purple: SnakeState = {
      ...strand,
      body: [{ pos: at(4, 5), color: RED | BLUE }],
    };

    expect(dyeSegmentAt(purple, at(4, 5), YELLOW)?.color).toBe(BROWN);
  });

  it('is a no-op when re-applying a primary the segment already holds', () => {
    const red: SnakeState = { ...strand, body: [{ pos: at(4, 5), color: RED }] };

    expect(dyeSegmentAt(red, at(4, 5), RED)?.color).toBe(RED);
  });

  it('finds nothing under the head — the maker is not sugar', () => {
    expect(dyeSegmentAt(strand, at(5, 5), RED)).toBeUndefined();
  });

  it('finds nothing on an empty cell, so the dye is wasted', () => {
    expect(dyeSegmentAt(createSnake(at(5, 5), Dir.Right), at(4, 5), RED)).toBeUndefined();
  });

  it('leaves segments where they are', () => {
    expect(positions(dyeSegmentAt(strand, at(4, 5), YELLOW)!.snake)).toEqual(
      positions(strand),
    );
  });
});
