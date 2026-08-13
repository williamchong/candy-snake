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

/** Ceiling on catch-up after a stall (tab switch), instead of a death spiral. */
const MAX_CATCHUP_MS = TICK_MS * 5;

export class GameScene extends Phaser.Scene {
  private core!: Game;
  private turns!: DirectionQueue;
  private view!: BoardView;
  private accumulatorMs = 0;
  private renderedTick = -1;

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
    this.renderedTick = this.core.state.tick;

    bindKeyboard(this, this.turns);
    this.view.render(this.core.state);
  }

  update(_time: number, delta: number): void {
    this.accumulatorMs = Math.min(this.accumulatorMs + delta, MAX_CATCHUP_MS);

    while (this.accumulatorMs >= TICK_MS) {
      this.accumulatorMs -= TICK_MS;

      for (const event of this.core.step(TICK_MS, this.turns)) {
        // Placeholder feedback until the juice pass.
        if (event.type === 'body-shattered') this.cameras.main.flash(120, 255, 240, 200);
      }
    }

    // The snake only moves every moveIntervalMs, so most frames have nothing
    // new to draw.
    if (this.renderedTick !== this.core.state.tick) {
      this.renderedTick = this.core.state.tick;
      this.view.render(this.core.state);
    }
  }
}
