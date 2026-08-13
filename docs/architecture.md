# Candy Snake — Architecture

## 1. Stack

| Concern        | Choice                             | Why                                             |
| -------------- | ---------------------------------- | ----------------------------------------------- |
| Engine         | **Phaser 3** (latest 3.x)          | Scenes, tweens, particles, unified input, scale manager out of the box |
| Language       | **TypeScript** (strict)            | The color/order logic benefits heavily from types |
| Build/dev      | **Vite**                           | Fast HMR, trivial static build                  |
| Tests          | **Vitest**                         | Runs the engine-free core logic in Node         |
| Lint/format    | ESLint + Prettier                  | Standard                                        |
| Hosting        | Static (GitHub Pages / Netlify)    | Client-side only, no backend                    |
| Persistence    | `localStorage`                     | High scores, settings, seen-hints flags         |

No other runtime dependencies. Art for v1 is generated at boot from Phaser
`Graphics` (see §7) — no asset pipeline needed until the polish phase.

## 2. Guiding principle: engine-free core

All game rules live in `src/core/` as **pure TypeScript with zero Phaser
imports**. Phaser scenes are a thin presentation layer that (a) feeds input
into the core, (b) advances it on a fixed timestep, and (c) renders the
resulting state and reacts to emitted events.

Why this matters here:

- The tricky logic — color blending, order matching, pity spawning, chop
  sequencing — is exactly the logic that wants unit tests, and Phaser is
  painful to instantiate in Node.
- The core is deterministic given (seed, input sequence), which makes bug
  reports reproducible and balancing scriptable.

```
┌────────────────────────── Phaser layer ──────────────────────────┐
│  BootScene   MenuScene   GameScene ⇄ UIScene   GameOverScene     │
│                  │            │                                  │
│                  │   input events (turn, pause)                  │
│                  ▼            ▼                                  │
└──────────────────────────────┬───────────────────────────────────┘
                               │ step(dt) / GameEvent[]
┌──────────────────────────────▼───────────────────────────────────┐
│                        src/core (pure TS)                        │
│  GameState ── snake · board · spawner · customers · shelf ·      │
│               orders · scoring · difficulty · rng(seeded)        │
└──────────────────────────────────────────────────────────────────┘
```

## 3. Directory layout

```
candy-snake/
├── index.html
├── package.json / tsconfig.json / vite.config.ts
├── docs/                      # these documents
├── public/                    # favicon, (later) audio files
└── src/
    ├── main.ts                # Phaser.Game config + scene registration
    ├── core/                  # ENGINE-FREE game logic (unit tested)
    │   ├── types.ts           # Vec2, Dir, ColorMask, GameEvent, GameConfig
    │   ├── colors.ts          # mask ops, mask→name/tier, palette table
    │   ├── snake.ts           # movement, growth, self-hit shatter
    │   ├── board.ts           # grid, wrap, station cells, occupancy
    │   ├── spawner.ts         # sugar/dye spawn rules + pity timer
    │   ├── customers.ts       # arrival, patience, queue
    │   ├── orders.ts          # order generation by difficulty stage
    │   ├── shelf.ts           # candy cache, matching
    │   ├── scoring.ts         # points, streaks, patience bonus
    │   ├── difficulty.ts      # stage curve (time/serves → knobs)
    │   ├── rng.ts             # small seedable PRNG (mulberry32)
    │   └── game.ts            # Game: owns state, step(), emits GameEvents
    ├── scenes/
    │   ├── BootScene.ts       # generate textures, load settings
    │   ├── MenuScene.ts
    │   ├── GameScene.ts       # renders board+snake, owns the Game instance
    │   ├── UIScene.ts         # HUD overlay: orders, shelf, score, cheat sheet
    │   └── GameOverScene.ts
    ├── input/
    │   ├── keyboard.ts        # arrows/WASD → DirectionQueue
    │   ├── touch.ts           # swipe detector (+ optional virtual d-pad)
    │   └── directionQueue.ts  # 2-deep buffer, 180° reversal rejection
    ├── render/
    │   ├── textures.ts        # runtime-generated candy/segment/jar textures
    │   ├── boardView.ts       # grid → sprites, segment coloring
    │   └── effects.ts         # particles, tweens (chop pop, shatter, confetti)
    ├── ui/
    │   ├── orderCard.ts       # candy icon + component dots + patience bar
    │   ├── cheatSheet.ts      # collapsible mixing strip
    │   └── layout.ts          # responsive anchoring (portrait/landscape)
    └── persist/
        └── storage.ts         # typed localStorage wrapper (scores, settings)
```

## 4. Core model (key types)

```ts
// colors.ts — a color IS the set of primaries mixed in
export const RED = 1, YELLOW = 2, BLUE = 4;
export type ColorMask = number;          // 0 = raw … 7 = brown
export const blend = (c: ColorMask, dye: ColorMask): ColorMask => c | dye;
// tier(mask): 0→1 (raw), single bit→2, two bits→3, 7→"brown"

// types.ts
interface Segment { pos: Vec2; color: ColorMask }
interface SnakeState { head: Vec2; dir: Dir; body: Segment[]; mode: 'moving' | 'chopping' }
// A pickup is opened by the head and spent when the strand clears it, so its
// in-between state lives in core state, not in a Phaser tween (design §5).
type Pickup = { pos: Vec2; open: boolean } & ({ kind: 'sugar' } | { kind: 'dye'; primary; kneaded: number })
interface Debris { segments: Segment[] }   // frozen break, crumbles impact-end first
interface Candy { color: ColorMask; bornAt: number }
interface Customer { id: number; want: ColorMask; patienceMs: number; maxPatienceMs: number }
interface GameState {
  snake: SnakeState; pickups: Pickup[]; debris: Debris[]; shelf: Candy[];
  customers: Customer[]; score: number; lives: number;
  streak: number; elapsedMs: number; served: number; over: boolean;
}
```

`Game.step(dtMs, inputs)` advances everything and returns `GameEvent[]`
(`sugar-pulled`, `sugar-spawned`, `dye-kneaded`, `dye-spent`, `dye-spawned`,
`strand-broken`, `debris-crumbled`, `candy-chopped`,
`customer-arrived`, `customer-served`, `customer-left`, `life-lost`,
`game-over`, …). The Phaser layer never mutates core state; it only renders it
and plays effects per event. Events carry the data needed for presentation
(positions, colors, points) so views never dig through state diffs.

## 5. Time model

- **Render:** Phaser's `update(time, delta)` every animation frame.
- **Logic:** fixed-timestep accumulator inside `GameScene.update` calling
  `game.step(TICK_MS)`; snake moves one cell every `moveIntervalMs` (a
  difficulty knob), chop mode consumes one segment per chop interval.
- Patience bars and arrival timers tick in real ms (accumulated per step) so
  they stay smooth and frame-rate independent.
- **Rendering runs at a different granularity than logic:** sprites are only
  re-targeted when a move tick lands, but are drawn every frame at
  `moveProgress()` of the way between cells (see §7).
- Rationale: identical simulation on a 60 Hz desktop and a 120 Hz phone, and
  the core stays testable with synthetic `step()` calls.

## 6. Scenes & flow

```
BootScene ──► MenuScene ──► GameScene (+ UIScene launched in parallel)
                  ▲                │ game-over event
                  └── GameOverScene ◄┘
```

- **GameScene** owns the `Game` core instance, the input adapters, and the
  board view. On `game-over` it sleeps and wakes `GameOverScene` with the run
  summary.
- **UIScene** runs in parallel (`scene.launch`) above GameScene — the standard
  Phaser pattern so HUD ignores any camera effects (screen shake on shatter)
  applied to the play field. Communicates via the same `GameEvent` stream
  (re-emitted on the scene's event emitter).
- Pause = `scene.pause` on GameScene only; UIScene stays interactive.

## 7. Rendering approach

- **Runtime-generated textures** in BootScene: each sprite is an 8×8 ASCII
  pixel map in `render/textures.ts`, baked through Phaser's
  `textures.generate` against one fixed 16-color palette and drawn at an
  integer scale with `pixelArt: true` (design §2). Ships v1 with zero art
  files.
- Sprite pixels are grays — a fill plus a soft edge — so that tinting, which
  multiplies, recolors them to any `ColorMask` palette entry while the edge
  stays a deeper shade of that same color.
- **The view interpolates; the core does not.** `Game.moveProgress()` reports
  how far the snake stands between cells (0…1) and `BoardView.render` slides
  sprites that fraction of the way, so the simulation stays discrete and
  testable while the motion on screen is continuous.
- Segment sprites are tinted with the palette color and stamped with the
  accessibility **symbol glyph** (bitmap text) per the design doc.
- Effects are Phaser particle emitters + tweens, all triggered by GameEvents,
  never by polling state.
- Palette lives in one table in `core/colors.ts` (mask → hex + symbol + name)
  so core, HUD, and cheat sheet can never disagree.

## 8. Input

- Both adapters normalize to a shared `DirectionQueue` (max 2 buffered turns,
  rejects 180° reversals against the *queued* direction, not just current —
  the classic snake input bug to avoid).
- **Touch:** pointer-down/up delta; dominant axis wins; ~20 px dead zone;
  swipes register on release OR after passing a threshold mid-drag (feels
  snappier). Virtual D-pad (optional, settings) feeds the same queue.
- Phaser's `Input` plugin handles mouse/touch unification; keyboard via
  `addKeys`.

## 9. Responsive layout & scaling

- `Phaser.Scale.RESIZE` + a single `layout()` pass (in `ui/layout.ts`) run on
  create and on `resize` events.
- The 16×16 board renders at the largest integer-friendly cell size that fits
  the available rectangle; HUD regions anchor around it:
  - **Landscape:** customers top, shelf + score right column.
  - **Portrait:** customers top (compact), shelf + score bottom bar.
- MVP shortcut (early phases only): fixed `Scale.FIT` at 960×640 landscape;
  the responsive pass replaces it in the mobile phase. `layout.ts` is the only
  file that knows about screen geometry.
- Mobile page hardening: `touch-action: none` on the canvas,
  `viewport-fit=cover`, prevent pull-to-refresh/zoom, wake-lock nice-to-have.

## 10. Persistence

`persist/storage.ts` — typed, versioned wrapper:

```ts
interface SaveData { version: 1; highScores: ScoreEntry[]; settings: Settings; seenHints: string[] }
```

Single JSON blob under one key (`candy-snake:v1`). Corrupt/missing data falls
back to defaults silently. No PII, no backend.

## 11. Testing strategy

- **Unit (Vitest, core only):** color blending table (all 8×3 dye
  applications), self-hit shatter boundaries (hit neck, hit tail, hit middle),
  chop ordering (tail-first, colors preserved), order matching + shelf
  eviction, pity-spawner guarantees, difficulty curve monotonicity, scoring
  incl. streak caps. Deterministic via seeded `rng.ts`.
- **Simulation tests:** run `Game.step` thousands of ticks with a scripted
  bot; assert invariants (≥1 sugar on map, no pickup on snake, no negative
  lives, shelf ≤ 6).
- **Manual/E2E:** device pass on real phones per milestone (Chrome DevTools
  device emulation is the daily driver, real-device check before release).
  Playwright smoke test (page loads, canvas mounts, menu → game transition)
  is a nice-to-have, not v1-blocking.

## 12. Build & deploy

- `npm run dev` (Vite), `npm run build` → `dist/` static bundle,
  `npm run test` / `lint` / `typecheck` gate commits.
- Deploy `dist/` to GitHub Pages via Actions on push to `main`
  (`.github/workflows/deploy.yml`, using `upload-pages-artifact` /
  `deploy-pages`; repo Settings → Pages source must be "GitHub Actions").
  Vite's `base: './'` keeps asset URLs relative so the bundle works both at the
  `/candy-snake/` project-page path and under `vite preview`.
- Phaser is the only heavy dependency (~1.1 MB min+gz ~300 KB); acceptable for
  a game page, no code-splitting needed for v1.
