import { describe, expect, it } from 'vitest';

import { BLUE, BROWN, RED, YELLOW } from './colors';
import { createCustomer, matchIndex, removeAt, tickPatience } from './customers';
import { RAW, type ColorMask, type Customer } from './types';

const waiting = (id: number, want: ColorMask, patienceMs = 10_000): Customer =>
  createCustomer(id, want, patienceMs);

/** An opening-level customer: no bar, no countdown, no way to lose a life. */
const tutorial = (id: number, want: ColorMask): Customer =>
  createCustomer(id, want, undefined);

describe('tickPatience', () => {
  it('drains real time from everyone waiting', () => {
    const { customers, expired } = tickPatience([waiting(1, RED)], 250);

    expect(customers[0]?.patience?.remainingMs).toBe(9_750);
    expect(customers[0]?.patience?.totalMs).toBe(10_000);
    expect(expired).toEqual([]);
  });

  it('expires a customer the moment patience reaches zero', () => {
    const { customers, expired } = tickPatience([createCustomer(1, RED, 200)], 200);

    expect(customers).toEqual([]);
    expect(expired.map((customer) => customer.id)).toEqual([1]);
  });

  it('never reports a bar past its own end', () => {
    const { expired } = tickPatience([createCustomer(1, RED, 50)], 500);

    expect(expired[0]?.patience?.remainingMs).toBe(0);
  });

  it('leaves a tutorial customer waiting forever', () => {
    let customers = [tutorial(1, RAW)];
    for (let minute = 0; minute < 10; minute += 1) {
      customers = tickPatience(customers, 60_000).customers;
    }

    expect(customers).toEqual([tutorial(1, RAW)]);
  });

  it('leaves the queue it was handed alone', () => {
    const queue = [waiting(1, RED)];

    tickPatience(queue, 500);

    expect(queue[0]?.patience?.remainingMs).toBe(10_000);
  });
});

describe('matchIndex', () => {
  it('matches the exact color and nothing near it', () => {
    const queue = [waiting(1, RED | BLUE)];

    expect(matchIndex(queue, RED | BLUE)).toBe(0);
    expect(matchIndex(queue, RED)).toBe(-1);
    expect(matchIndex(queue, BROWN)).toBe(-1);
    expect(matchIndex(queue, RAW)).toBe(-1);
  });

  it('finds nobody in an empty queue', () => {
    expect(matchIndex([], RED)).toBe(-1);
  });

  it('serves the most impatient of the customers who want it', () => {
    const queue = [
      waiting(1, RED, 9_000),
      waiting(2, YELLOW, 500),
      waiting(3, RED, 3_000),
    ];

    expect(matchIndex(queue, RED)).toBe(2);
  });

  it('falls to whoever waited longest when patience is level', () => {
    const queue = [waiting(1, RED, 4_000), waiting(2, RED, 4_000)];

    expect(matchIndex(queue, RED)).toBe(0);
  });

  it('serves a ticking customer ahead of one who cannot run out', () => {
    const queue = [tutorial(1, RED), waiting(2, RED, 30_000)];

    expect(matchIndex(queue, RED)).toBe(1);
  });

  it('still serves a queue of nothing but tutorial customers', () => {
    expect(matchIndex([tutorial(1, RAW), tutorial(2, RAW)], RAW)).toBe(0);
  });
});

describe('removeAt', () => {
  it('takes the served customer out and leaves the order intact', () => {
    const queue = [waiting(1, RED), waiting(2, YELLOW), waiting(3, BLUE)];

    expect(removeAt(queue, 1).map((customer) => customer.id)).toEqual([1, 3]);
    expect(queue).toHaveLength(3);
  });
});
