import Phaser from 'phaser';

import { DEFAULT_CONFIG, Game } from '../core/game';
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
        if (event.type === 'body-shattered') this.view.shatter(event.positions);
      }
    }

    // New cells to aim at only arrive on a move tick, but the sprites travel
    // toward them every frame — hence the split.
    if (this.core.state.tick !== tickBefore) this.view.syncToState(this.core.state);

    this.view.render(this.core.moveProgress(this.accumulatorMs));
  }
}
