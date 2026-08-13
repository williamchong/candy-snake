import Phaser from 'phaser';

import { DEFAULT_CONFIG, Game } from '../core/game';
import type { GameEvent } from '../core/types';
import { DirectionQueue } from '../input/directionQueue';
import { bindKeyboard } from '../input/keyboard';
import { BoardView } from '../render/boardView';
import type { RunSummary } from './GameOverScene';
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
    // The HUD runs in parallel and reads the same core, read-only
    // (architecture §6).
    this.scene.launch(SceneKey.UI, { core: this.core });
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

      case 'candy-chopped':
        // Placeholder pop: the same one-cell puff a crumbling block makes,
        // in the candy's color. The juice pass (Phase 7) gives chopping its
        // own effect.
        this.view.splash(event.pos, event.color);
        return;

      case 'dye-opened':
        // The strand behind the head does not start turning until the next
        // move, so without this the pickup reads as a move late.
        this.view.flashHead(event.primary);
        return;

      case 'dye-spent':
        // A dye that landed needs nothing here — the strand visibly recolored
        // segment by segment. One that kneaded nothing has to say so (§5).
        if (event.kneaded === 0) this.view.splash(event.pos, event.primary);
        return;

      case 'game-over':
        // The HUD is this scene's to clean up: it was launched here, holds a
        // reference to this run's core, and a fresh run launches a fresh one.
        this.scene.stop(SceneKey.UI);
        this.scene.start(SceneKey.GameOver, {
          score: event.score,
          served: event.served,
          elapsedMs: event.elapsedMs,
        } satisfies RunSummary);
        return;

      // The serving window is UIScene's, and it draws the queue from state
      // every frame — the board itself has nothing to play for these. The juice
      // pass (Phase 7) gives serves and losses their own effects.
      case 'customer-arrived':
      case 'customer-served':
      case 'customer-left':
      case 'life-lost':
        return;

      // Nothing to play yet; the juice pass (Phase 7) fills these in, including
      // the stale-candy toss off the rack (design §5).
      case 'candy-staled':
      case 'strand-broken':
      case 'strand-cut':
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
