import type Phaser from 'phaser';

import { Dir } from '../core/types';
import type { DirectionQueue } from './directionQueue';

/**
 * How far a drag must travel on one axis before it counts as a swipe
 * (architecture §8). Measured in CSS pixels rather than game units — see
 * `bindSwipe` — so the dead zone is the same physical distance under a thumb
 * whatever size the canvas is displayed at.
 *
 * Was 20, which the first device report found commits the turn a block late: a
 * thumb covers 20 px in 50–100 ms, and the difficulty ramp's floor is 125 ms per
 * cell, so most of a cell was gone before the gesture was even recognised. A tap
 * jitters under 5 px, so this has room below it and is not yet at the bottom of
 * the range that report allowed for.
 */
export const SWIPE_THRESHOLD_PX = 13;

/** The axis a drag has committed to, or nothing while it is still ambiguous. */
const resolveSwipe = (dx: number, dy: number): Dir | undefined => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);

  if (Math.max(ax, ay) < SWIPE_THRESHOLD_PX) return undefined;
  if (ax > ay) return dx > 0 ? Dir.Right : Dir.Left;
  if (ay > ax) return dy > 0 ? Dir.Down : Dir.Up;

  // An exact diagonal has no dominant axis. Picking one would be a coin toss,
  // so let the drag travel further instead — the next move resolves it.
  return undefined;
};

/**
 * The drag state machine behind touch steering, in CSS pixels and free of
 * Phaser so it can be tested in Node.
 *
 * A swipe does not need the finger lifted: once one resolves, the origin moves
 * to where it resolved, so an L-shaped drag steers an L and the two turns
 * `DirectionQueue` buffers are reachable without a second tap — which matters
 * at the 125 ms/cell the difficulty ramp reaches.
 */
export class SwipeTracker {
  private origin: { x: number; y: number } | undefined;

  down(x: number, y: number): void {
    this.origin = { x, y };
  }

  move(x: number, y: number): Dir | undefined {
    if (this.origin === undefined) return undefined;

    const dir = resolveSwipe(x - this.origin.x, y - this.origin.y);
    // Re-armed on every resolution, including one the caller goes on to
    // reject. Moving the origin only for accepted turns would leave it parked
    // wherever a reversal was refused, and that stale distance then outweighs
    // the next gesture on the other axis until the drag doubles back past it.
    if (dir !== undefined) this.origin = { x, y };
    return dir;
  }

  up(x: number, y: number): Dir | undefined {
    // A fast flick can arrive with no `move` between down and up at all, so
    // the release resolves too. It cannot repeat a swipe that already landed:
    // that one re-armed the origin, so this measures only the travel since.
    const dir = this.move(x, y);
    this.origin = undefined;
    return dir;
  }
}

export const bindSwipe = (
  scene: Phaser.Scene,
  queue: DirectionQueue,
  /**
   * Where a drag must not start. The cheat-sheet tab is drawn by the HUD, which
   * is a separate scene with its own input plugin — pressing it does not stop
   * these handlers from seeing the same pointer, so a drag off the tab would
   * both open the drawer and turn the strand. The rect comes from the shared
   * layout, so GameScene never has to ask the HUD anything.
   */
  isDeadZone: (x: number, y: number) => boolean,
): void => {
  // One tracker for every pointer, which holds only because the game leaves
  // Phaser's `input.activePointers` at its default of 1 — a second finger on
  // the glass produces no events at all. Turning multitouch on for some other
  // mechanic would need this keyed by `pointer.id`, or the second finger would
  // clobber the first one's origin mid-drag.
  const tracker = new SwipeTracker();

  // Pointer coordinates arrive in game units, which `Scale.FIT` has already
  // stretched away from what the player's thumb actually moved: on a narrow
  // phone the canvas is scaled down, so a threshold in game units would be a
  // fraction of its intended size. `displayScale` is game units per CSS pixel.
  const cssX = (pointer: Phaser.Input.Pointer): number =>
    pointer.x / scene.scale.displayScale.x;
  const cssY = (pointer: Phaser.Input.Pointer): number =>
    pointer.y / scene.scale.displayScale.y;

  const steer = (dir: Dir | undefined): void => {
    // The queue is the sole judge of reversals and of how much can be
    // buffered, exactly as it is for the keyboard.
    if (dir !== undefined) queue.push(dir);
  };

  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    // Declining here leaves the tracker unarmed, which makes `move` and `up`
    // decline the rest of the gesture too rather than only its first pixels —
    // so there is no "ignore this drag" flag to raise and forget to lower.
    //
    // Tested in game units, not CSS pixels: the layout is computed against
    // `scale.gameSize`, which is the space `pointer.x` is already in. The
    // conversion below exists only to keep the threshold a physical distance,
    // and using it here would move the tab out from under the finger.
    if (isDeadZone(pointer.x, pointer.y)) return;

    tracker.down(cssX(pointer), cssY(pointer));
  });

  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    // A mouse crossing the canvas with no button held is not steering. The
    // tracker would ignore it anyway — it holds no origin outside a drag —
    // but there is no reason to ask it.
    if (pointer.isDown) steer(tracker.move(cssX(pointer), cssY(pointer)));
  });

  scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    steer(tracker.up(cssX(pointer), cssY(pointer)));
  });
};
