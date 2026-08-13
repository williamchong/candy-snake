import type Phaser from 'phaser';

import type { Customer, Vec2 } from '../core/types';
import { CustomerView, type Mood } from './customerView';

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

/** Wide enough for a child and their bubble, with air either side. */
const SLOT_PITCH = 84;

export class CustomerQueue {
  private readonly scene: Phaser.Scene;
  /** Where the child at the head of the queue stands: the window end. */
  private readonly front: Vec2;
  /** Every view ever built, live or free — the pool `step` runs over. */
  private readonly views: CustomerView[] = [];
  private readonly waiting = new Map<number, CustomerView>();

  constructor(scene: Phaser.Scene, front: Vec2) {
    this.scene = scene;
    this.front = front;
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
   * (design §5) — exists at all: they walk on already smiling, because the
   * send-off waits for them to reach the window (see `CustomerView.step`).
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
    const view = new CustomerView(this.scene, this.front.y);
    this.views.push(view);
    return view;
  }

  /** The head of the queue stands at the window; the rest line up behind. */
  private standingX(slot: number): number {
    return this.front.x + slot * SLOT_PITCH;
  }
}
