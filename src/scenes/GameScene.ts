import Phaser from 'phaser';

import { DEFAULT_CONFIG, Game } from '../core/game';
import type { GameEvent } from '../core/types';
import { DirectionQueue } from '../input/directionQueue';
import { bindKeyboard } from '../input/keyboard';
import { BoardView } from '../render/boardView';
import { SceneKey } from './keys';

/**
 * Logic advances in fixed 20 ms slices regardless of display refresh rate, so
 * a 60 Hz desktop and a 120 Hz phone simulate identically (architecture §5).
 */
const TICK_MS = 20;

/**
 * Ceiling on catch-up after a stall (tab switch), instead of a death spiral.
 * It must also stay under `moveIntervalMs`, or a single frame can advance two
 * grid moves and the view has nothing adjacent to slide between — the strand
 * would teleport. Safe down to 100 ms/cell, well past the 125 ms floor the
 * difficulty ramp reaches (design §7).
 */
const MAX_CATCHUP_MS = TICK_MS * 5;

export class GameScene extends Phaser.Scene {
  private core!: Game;
  private turns!: DirectionQueue;
  private view!: BoardView;
  private accumulatorMs = 0;

  constructor() {
    super(SceneKey.Game);
  }

  create(): void {
    // The core is deterministic per seed; the scene picks a fresh one so
    // sugar does not land in the same places on every reload.
    this.core = new Game({ ...DEFAULT_CONFIG, seed: Date.now() });
    this.turns = new DirectionQueue(this.core.state.snake.dir);
    this.view = new BoardView(this);
    this.accumulatorMs = 0;

    bindKeyboard(this, this.turns);
    this.view.syncToState(this.core.state);
  }

  update(_time: number, delta: number): void {
    this.accumulatorMs = Math.min(this.accumulatorMs + delta, MAX_CATCHUP_MS);
    const tickBefore = this.core.state.tick;

    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;

      for (const event of this.core.step(TICK_MS, this.turns)) {
        this.play(event);
      }
    }

    // New cells to aim at only arrive on a move tick, but the sprites travel
    // toward them every frame — hence the split.
    if (this.core.state.tick !== tickBefore) this.view.syncToState(this.core.state);

    this.view.render(this.core.moveProgress(this.accumulatorMs));
  }

  /** Effects are driven by events, never by polling state (architecture §7). */
  private play(event: GameEvent): void {
    switch (event.type) {
      case 'debris-crumbled':
        // One puff per block, so a long break comes apart over several moves
        // instead of flashing the whole severed length at once (design §6).
        this.view.splash(event.segment.pos, event.segment.color);
        return;

      case 'dye-spent':
        // A dye that landed needs nothing here — the strand visibly recolored
        // segment by segment. One that kneaded nothing has to say so (§5).
        if (event.kneaded === 0) this.view.splash(event.pos, event.primary);
        return;

      // Nothing to play yet; the juice pass (Phase 7) fills these in.
      case 'strand-broken':
      case 'dye-kneaded':
      case 'sugar-pulled':
      case 'sugar-spawned':
      case 'dye-spawned':
        return;

      default:
        // A new GameEvent member becomes a type error here rather than
        // quietly going unrendered.
        event satisfies never;
        return;
    }
  }
}
