import { describe, expect, it } from 'vitest';

import { Game } from '../core/game';
import { createRng } from '../core/rng';
import { Dir, OPPOSITE } from '../core/types';
import { DirectionQueue, MAX_QUEUED } from './directionQueue';

describe('DirectionQueue', () => {
  it('accepts a perpendicular turn', () => {
    const queue = new DirectionQueue(Dir.Right);

    expect(queue.push(Dir.Up)).toBe(true);
    expect(queue.take()).toBe(Dir.Up);
  });

  it('rejects a reversal of the committed direction', () => {
    const queue = new DirectionQueue(Dir.Right);

    expect(queue.push(Dir.Left)).toBe(false);
    expect(queue.take()).toBeUndefined();
  });

  it('rejects a reversal of the queued direction, not just the committed one', () => {
    const queue = new DirectionQueue(Dir.Right);

    expect(queue.push(Dir.Up)).toBe(true);
    // Down is legal against Right but would fold the strand back through Up.
    expect(queue.push(Dir.Down)).toBe(false);
  });

  it('ignores a repeat of the direction already in effect', () => {
    const queue = new DirectionQueue(Dir.Right);

    expect(queue.push(Dir.Right)).toBe(false);
    expect(queue.push(Dir.Up)).toBe(true);
    expect(queue.push(Dir.Up)).toBe(false);
  });

  it('buffers no more than MAX_QUEUED turns', () => {
    const queue = new DirectionQueue(Dir.Right);

    expect(MAX_QUEUED).toBe(2);
    expect(queue.push(Dir.Up)).toBe(true);
    expect(queue.push(Dir.Left)).toBe(true);
    expect(queue.push(Dir.Down)).toBe(false);
  });

  it('drains in order and then reports empty', () => {
    const queue = new DirectionQueue(Dir.Right);
    queue.push(Dir.Up);
    queue.push(Dir.Left);

    expect(queue.take()).toBe(Dir.Up);
    expect(queue.take()).toBe(Dir.Left);
    expect(queue.take()).toBeUndefined();
  });

  it('commits a taken turn so later reversals are judged against it', () => {
    const queue = new DirectionQueue(Dir.Right);
    queue.push(Dir.Up);
    queue.take();

    expect(queue.push(Dir.Down)).toBe(false);
    expect(queue.push(Dir.Left)).toBe(true);
  });
});

describe('DirectionQueue driving a Game', () => {
  const DIRS = [Dir.Up, Dir.Down, Dir.Left, Dir.Right];

  it('never lets a reversal reach the snake, however wildly the player presses', () => {
    const game = new Game();
    const queue = new DirectionQueue(game.state.snake.dir);
    const rng = createRng(4242);
    const violations: string[] = [];
    let previous = game.state.snake.dir;

    // Mashing several keys between move ticks is exactly what overflows the
    // buffer and exposes reversal checks made against the wrong direction.
    for (let press = 0; press < 3000; press += 1) {
      queue.push(DIRS[rng.int(DIRS.length)] ?? Dir.Up);
      game.step(20, queue);

      const current = game.state.snake.dir;
      if (current === OPPOSITE[previous]) {
        violations.push(`press ${press}: ${previous} reversed straight to ${current}`);
      }
      previous = current;
    }

    expect(violations).toEqual([]);
    expect(game.state.tick).toBeGreaterThan(0);
  });
});
