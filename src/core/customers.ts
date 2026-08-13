import type { ColorMask, Customer } from './types';

/**
 * The queue at the serving window. Pure list operations — scoring, lives and
 * the arrival clock all live in `Game`, which composes these (architecture §2).
 */

export const createCustomer = (
  id: number,
  want: ColorMask,
  /** Undefined for a customer who waits forever — the opening levels. */
  patienceMs: number | undefined,
): Customer => ({
  id,
  want,
  patience:
    patienceMs === undefined
      ? undefined
      : { remainingMs: patienceMs, totalMs: patienceMs },
});

/**
 * Drains one slice of real time from everyone waiting and hands back the queue
 * that survived plus the customers who ran out. Patience is counted in ms
 * rather than grid moves so the bars stay smooth while the ramp varies the
 * snake's speed (architecture §5).
 *
 * An expired customer comes back with `remainingMs` at 0 rather than negative,
 * so a card drawn on the frame it leaves cannot show a bar past its own end.
 */
export const tickPatience = (
  customers: readonly Customer[],
  dtMs: number,
): { customers: Customer[]; expired: Customer[] } => {
  const waiting: Customer[] = [];
  const expired: Customer[] = [];

  for (const customer of customers) {
    const { patience } = customer;
    if (patience === undefined) {
      waiting.push(customer);
      continue;
    }

    const remainingMs = patience.remainingMs - dtMs;
    if (remainingMs <= 0)
      expired.push({ ...customer, patience: { ...patience, remainingMs: 0 } });
    else waiting.push({ ...customer, patience: { ...patience, remainingMs } });
  }

  return { customers: waiting, expired };
};

/**
 * Which waiting customer a candy of `color` goes to, or -1 for nobody.
 *
 * Matching is exact — a purple order takes purple and nothing else — and when
 * several customers want the same color the **most impatient** is served, so a
 * candy that could have saved a life never goes to someone who had time to
 * spare. Customers who never expire sort last for the same reason, and ties
 * fall to whoever has been waiting longest (the queue is in arrival order).
 */
export const matchIndex = (customers: readonly Customer[], color: ColorMask): number => {
  let best = -1;
  let bestRemainingMs = Infinity;

  customers.forEach((customer, index) => {
    if (customer.want !== color) return;

    const remainingMs = customer.patience?.remainingMs ?? Infinity;
    if (best === -1 || remainingMs < bestRemainingMs) {
      best = index;
      bestRemainingMs = remainingMs;
    }
  });

  return best;
};

/** Takes a served customer out of the queue, leaving the order intact. */
export const removeAt = (customers: readonly Customer[], index: number): Customer[] =>
  customers.filter((_unused, at) => at !== index);
