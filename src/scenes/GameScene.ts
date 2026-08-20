import Phaser from 'phaser';

import { Kitchen } from '../audio/kitchen';
import { DEFAULT_CONFIG, Game } from '../core/game';
import type { GameEvent, RunSummary } from '../core/types';
import { DirectionQueue } from '../input/directionQueue';
import { bindKeyboard } from '../input/keyboard';
import { bindSwipe } from '../input/swipe';
import { BoardView } from '../render/boardView';
import { hitsTab, type Frame } from '../ui/layout';
import { onFrame } from '../ui/responsive';
import { SceneKey } from './keys';
import type { UIScene } from './UIScene';

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
  /**
   * Named for what it is rather than `sound`, which is Phaser's own name on
   * every scene for the manager underneath this.
   */
  private kitchen!: Kitchen;
  private accumulatorMs = 0;
  /**
   * The last layout, kept only so the swipe knows where the HUD's tab is.
   * Assigned before `create` returns — `onFrame` runs its callback the moment
   * it subscribes — and no pointer can arrive before then.
   */
  private frame!: Frame;

  constructor() {
    super(SceneKey.Game);
  }

  create(): void {
    // The core is deterministic per seed; the scene picks a fresh one so
    // sugar does not land in the same places on every reload.
    this.core = new Game({ ...DEFAULT_CONFIG, seed: Date.now() });
    this.turns = new DirectionQueue(this.core.state.snake.dir);
    this.view = new BoardView(this);
    this.kitchen = new Kitchen(this);
    this.accumulatorMs = 0;

    // Both adapters normalize into the same queue, so nothing downstream of
    // here knows which one the player is using (architecture §8).
    bindKeyboard(this, this.turns);
    // The HUD's cheat-sheet tab is the one place on the glass that is not a
    // swipe. It lives in the other scene, which has its own input plugin and so
    // cannot stop this one seeing the press — hence asking the shared layout.
    bindSwipe(this, this.turns, (x, y) => hitsTab(this.frame, x, y));

    // Fitting the board is one position and one scale on the container it all
    // lives in, so a resize mid-run costs nothing and disturbs nothing — the
    // core never hears about it (architecture §9).
    onFrame(this, (frame) => {
      this.frame = frame;
      this.view.applyFrame(frame);
    });

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
        // Both halves of design §12 hang off the one event, and the HUD's
        // share of them is forwarded from here — so audio needs no second
        // wiring over in UIScene.
        this.kitchen.play(event);
        this.play(event);
      }
    }

    // New cells to aim at only arrive on a move tick, but the sprites travel
    // toward them every frame — hence the split.
    if (this.core.state.tick !== tickBefore) this.view.syncToState(this.core.state);

    this.view.render(this.core.moveProgress(this.accumulatorMs));
  }

  /**
   * The HUD, once it is actually running. `launch` above only queues it, and
   * the run's first customer is announced on the very first step — which can
   * land before the HUD's own `create` has been through.
   */
  private hud(): UIScene | undefined {
    return this.scene.isActive(SceneKey.UI)
      ? (this.scene.get(SceneKey.UI) as UIScene)
      : undefined;
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
        this.view.pop(event.pos, event.color);
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
        // Forwarded whole rather than copied field by field: the event already
        // *is* the summary, carrying only the extra tag that got us into this
        // branch, and a hand-copy is five lines that have to be remembered on
        // the day the run grows a sixth thing worth reporting.
        this.scene.start(SceneKey.GameOver, event satisfies RunSummary);
        return;

      // The serving window is UIScene's: it draws who is waiting from state,
      // but a child walking on and walking off are one-shots, so they are
      // handed over rather than left to be inferred (architecture §6). The rack
      // is over there too, and only it knows which slot a stale candy left from.
      case 'customer-arrived':
      case 'customer-served':
      case 'customer-left':
      case 'candy-staled':
        this.hud()?.play(event);
        return;

      // The board itself has nothing to play for a lost life; the column's
      // hearts are drawn from state.
      case 'life-lost':
        return;

      case 'strand-broken':
        this.view.shatter(event.severed);
        return;

      case 'sugar-pulled':
        this.view.swallow(event.pos);
        return;

      // Deliberately silent, rather than still owed. The block already speaks
      // for a cut, one candy per move, and it is the candies the player is
      // making — the strand leaving is not a second event. A knead recolors the
      // segment it happened to, in front of the player, and a pickup appearing
      // is a thing appearing. Design §12 asks for five effects and these are
      // not among them; adding motion here would be spending the player's
      // attention on what the board has already said.
      case 'strand-cut':
      case 'dye-kneaded':
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
