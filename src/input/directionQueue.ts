import { OPPOSITE, type Dir, type TurnSource } from '../core/types';

/** Two buffered turns make fast double-taps (up-then-left) land crisply. */
export const MAX_QUEUED = 2;

/**
 * Buffers steering input for the core to drain one turn per move tick
 * (docs/architecture.md §8). Reversals are rejected against the *queued*
 * direction rather than the committed one — checking only the current
 * direction is the classic snake bug, where queuing left-then-right on a
 * rightward snake folds it back into itself.
 */
export class DirectionQueue implements TurnSource {
  private readonly queued: Dir[] = [];
  private committed: Dir;
  /**
   * Told about turns that landed, and not about ones this queue refused. Both
   * adapters converge here, so it is the one place that can say "the player is
   * steering" without either of them knowing the other exists — which is what
   * lets the HUD's cheat sheet get out of the way (design §4) whichever way
   * the player is playing.
   */
  private readonly onAccepted: (() => void) | undefined;

  constructor(initial: Dir, onAccepted?: () => void) {
    this.committed = initial;
    this.onAccepted = onAccepted;
  }

  /** Returns false when the turn was rejected (full, reversal, or a no-op). */
  push(dir: Dir): boolean {
    if (this.queued.length >= MAX_QUEUED) return false;

    const previous = this.queued[this.queued.length - 1] ?? this.committed;
    if (dir === previous || dir === OPPOSITE[previous]) return false;

    this.queued.push(dir);
    this.onAccepted?.();
    return true;
  }

  take(): Dir | undefined {
    const next = this.queued.shift();
    if (next !== undefined) this.committed = next;
    return next;
  }
}
