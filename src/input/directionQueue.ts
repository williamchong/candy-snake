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

  constructor(initial: Dir) {
    this.committed = initial;
  }

  /** Returns false when the turn was rejected (full, reversal, or a no-op). */
  push(dir: Dir): boolean {
    if (this.queued.length >= MAX_QUEUED) return false;

    const previous = this.queued[this.queued.length - 1] ?? this.committed;
    if (dir === previous || dir === OPPOSITE[previous]) return false;

    this.queued.push(dir);
    return true;
  }

  take(): Dir | undefined {
    const next = this.queued.shift();
    if (next !== undefined) this.committed = next;
    return next;
  }
}
