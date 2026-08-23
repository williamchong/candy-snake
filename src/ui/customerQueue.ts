import type Phaser from 'phaser';

import type { Customer } from '../core/types';
import { fountain } from '../render/burst';
import { HudDepth } from '../render/drawn';
import { Burst, type BurstConfig } from '../render/effects';
import { TextureKey } from '../render/textures';
import { CustomerView, type Mood } from './customerView';
import { CHILD_SCALE, type Frame, type QueueFrame } from './layout';

/**
 * The send-off a served child gets, thrown from the bubble their order was in.
 *
 * In the candy's own color, because the confetti *is* the candy they asked for
 * coming apart: that keeps it teaching rather than decorating, and keeps hue
 * spent only on candies (design §4). What the serve was *worth* is deliberately
 * not read — scaling a celebration by the score is a design change, not juice.
 *
 * One pool for the whole queue rather than one per child: several children can
 * be served inside one another's send-off, and a pool each would be a pool each
 * for every view ever built. Which is also why the confetti is authored at the
 * roomiest a child is ever drawn and left there while they shrink: `Burst`
 * reads its scale off this config once, in its constructor, and offers no way
 * to change it — and a pip is small enough that being a size too big for a
 * shrunken child reads as confetti either way.
 */
const CHEER: BurstConfig = {
  key: TextureKey.Pip,
  depth: HudDepth.Cheer,
  scale: CHILD_SCALE,
  durationMs: 520,
  growth: 1,
  thrown: { pieces: 8, distance: 46, fling: fountain },
};

/**
 * The line at the serving window: one `CustomerView` per waiting child, kept in
 * the order the core holds them (design §5).
 *
 * Views are keyed by customer id rather than by slot, because a child is a
 * character now and not a card — when the front of the queue is served the rest
 * walk up, and a slot-keyed pool would instead re-stamp everyone one place
 * along. The same reason a departing child outlives the state that described
 * them: they are still on screen, walking out.
 */

export class CustomerQueue {
  private readonly scene: Phaser.Scene;
  /** Every view ever built, live or free — the pool `step` runs over. */
  private readonly views: CustomerView[] = [];
  private readonly waiting = new Map<number, CustomerView>();

  /**
   * The window: where the head of the queue stands, the step from one child to
   * the next — signed, because the line runs away from the window, rightward
   * beside the board and leftward beneath it — and how big they are drawn.
   * Held whole rather than picked apart, because it is handed on whole to every
   * view (`CustomerView.relocate`).
   */
  private queue: QueueFrame = {
    front: { x: 0, y: 0 },
    pitch: 0,
    scale: CHILD_SCALE,
    offstage: 0,
    door: 0,
  };
  private readonly cheers: Burst;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // No container: the HUD positions every widget by hand, so a burst in
    // mid-air is aimed at coordinates the next layout pass invalidates. See
    // `applyFrame`, and `Burst` itself.
    this.cheers = new Burst(scene, CHEER);
  }

  /**
   * The window moved. Nobody is repositioned by hand beyond the standing line
   * itself — `render` walks everyone to their slot every frame, so a queue
   * caught by a turn of the phone slides across rather than jumping.
   */
  applyFrame(frame: Frame): void {
    this.queue = frame.hud.queue;
    for (const view of this.views) view.relocate(this.queue);
    // A send-off is thrown at the bubble it left, and that bubble has just
    // moved. The children slide across to their new places; confetti in the air
    // has nothing left to slide *from*, so it is cut rather than stranded where
    // nothing is any more. `Scale.RESIZE` fires this on every frame of a window
    // drag, so the cheap thing is also the right one — the rack answers the
    // same problem the same way (`ShelfStrip.applyFrame`).
    this.cheers.clear();
  }

  /**
   * Walks the queue on by `dtMs` and draws it as the core holds it. Arrivals
   * are picked up from state here as well as from the event, so the very first
   * child of a run — who is at the window before the first frame — is never
   * missed.
   */
  render(customers: readonly Customer[], dtMs: number): void {
    customers.forEach((customer, slot) => {
      const view = this.admit(customer, slot);
      view.moveTo(this.standingX(slot));
      view.render(customer);
    });

    this.sweep(customers);
    for (const view of this.views) view.step(dtMs);
  }

  /**
   * Brings a child on. Called from the arrival event too, so that one who is
   * served the instant they walk up — off a shelf that already had their candy
   * (design §5) — exists at all. They walk on wearing the face they arrived
   * with and holding their order up: nothing about being served shows until
   * they reach the window (see `CustomerView.leave`).
   */
  admit(customer: Customer, slot = this.waiting.size): CustomerView {
    const known = this.waiting.get(customer.id);
    if (known !== undefined) return known;

    const view = this.views.find((free) => free.isDone) ?? this.build();
    this.waiting.set(customer.id, view);
    view.arrive(customer, this.standingX(slot));
    return view;
  }

  /** Served or walked out — the face `mood` carries is the whole difference. */
  depart(id: number, mood: Mood): void {
    const view = this.waiting.get(id);
    if (view === undefined) return;

    this.waiting.delete(id);
    view.leave(mood);
  }

  /**
   * Anyone off the queue whose send-off never arrived. The events get there
   * first in practice; this is what stops a missed one from leaving a child
   * standing at the window forever, holding a slot nobody can use.
   */
  private sweep(customers: readonly Customer[]): void {
    // Sound only because `render` has already admitted every customer in
    // state, which makes them a subset of `waiting` — so equal sizes mean
    // equal sets. Admit after sweeping and this quietly stops firing.
    if (this.waiting.size === customers.length) return;

    const present = new Set(customers.map((customer) => customer.id));
    for (const [id, view] of this.waiting) {
      if (present.has(id)) continue;

      this.waiting.delete(id);
      view.leave();
    }
  }

  private build(): CustomerView {
    const view = new CustomerView(this.scene, this.queue, this.cheers);
    this.views.push(view);
    return view;
  }

  /** The head of the queue stands at the window; the rest line up behind. */
  private standingX(slot: number): number {
    return this.queue.front.x + slot * this.queue.pitch;
  }
}
