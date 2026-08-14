import { describe, expect, it } from 'vitest';

import { Dir } from '../core/types';
import { DirectionQueue } from './directionQueue';
import { SWIPE_THRESHOLD_PX, SwipeTracker } from './swipe';

describe('SwipeTracker', () => {
  it('ignores a drag that stays inside the dead zone', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(tracker.move(15, 15)).toBeUndefined();
    expect(tracker.move(-12, 8)).toBeUndefined();
  });

  it('resolves each direction from the dominant axis', () => {
    const tracker = new SwipeTracker();

    tracker.down(0, 0);
    expect(tracker.move(40, 9)).toBe(Dir.Right);

    tracker.down(0, 0);
    expect(tracker.move(-40, 9)).toBe(Dir.Left);

    tracker.down(0, 0);
    expect(tracker.move(9, 40)).toBe(Dir.Down);

    tracker.down(0, 0);
    expect(tracker.move(9, -40)).toBe(Dir.Up);
  });

  it('resolves at exactly the threshold and not a pixel below it', () => {
    const tracker = new SwipeTracker();

    expect(SWIPE_THRESHOLD_PX).toBe(20);

    tracker.down(0, 0);
    expect(tracker.move(SWIPE_THRESHOLD_PX - 1, 0)).toBeUndefined();
    expect(tracker.move(SWIPE_THRESHOLD_PX, 0)).toBe(Dir.Right);
  });

  it('ignores an exact diagonal however far it travels', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(tracker.move(40, 40)).toBeUndefined();
    expect(tracker.move(-90, 90)).toBeUndefined();
  });

  it('measures the second turn of a drag from where the first one landed', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(tracker.move(30, 0)).toBe(Dir.Right);
    // Still 30 px right of where the finger went down: without the re-arm this
    // would read as another Right rather than the downstroke it is.
    expect(tracker.move(30, 25)).toBe(Dir.Down);
  });

  it('resolves a flick that never reported a move', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(tracker.up(0, 40)).toBe(Dir.Down);
  });

  it('does not fire again on release when the swipe already landed mid-drag', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(tracker.move(0, 40)).toBe(Dir.Down);
    expect(tracker.up(0, 45)).toBeUndefined();
  });

  it('ignores a move that arrives before any press', () => {
    expect(new SwipeTracker().move(0, 40)).toBeUndefined();
  });

  it('ignores a move that arrives after release', () => {
    const tracker = new SwipeTracker();
    tracker.down(0, 0);
    tracker.up(0, 0);

    expect(tracker.move(0, 40)).toBeUndefined();
  });
});

describe('SwipeTracker driving a DirectionQueue', () => {
  /** What `bindSwipe` does with a resolved swipe, minus the Phaser plumbing. */
  const steer = (queue: DirectionQueue, dir: Dir | undefined): boolean =>
    dir !== undefined && queue.push(dir);

  it('queues both turns of an L-shaped drag', () => {
    const queue = new DirectionQueue(Dir.Right);
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    expect(steer(queue, tracker.move(0, 30))).toBe(true);
    expect(steer(queue, tracker.move(-25, 30))).toBe(true);

    expect(queue.take()).toBe(Dir.Down);
    expect(queue.take()).toBe(Dir.Left);
  });

  it('does not let a refused reversal swallow the turn that follows it', () => {
    const queue = new DirectionQueue(Dir.Right);
    const tracker = new SwipeTracker();
    tracker.down(0, 0);

    // Dragging back against travel: the queue refuses to fold the strand.
    expect(steer(queue, tracker.move(-60, 0))).toBe(false);
    // The refusal must not leave the origin parked 60 px away, where it would
    // outweigh this downstroke and read as yet another Left.
    expect(steer(queue, tracker.move(-60, 25))).toBe(true);

    expect(queue.take()).toBe(Dir.Down);
  });
});
