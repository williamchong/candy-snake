import { describe, expect, it } from 'vitest';

import { CORE_VERSION } from './version';

// Scaffold smoke test: proves Vitest resolves TS under src/core/.
// Real core tests arrive with the gray-box snake in Phase 1.
describe('core scaffold', () => {
  it('exposes a version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});
