# Candy Snake — Architecture

## 1. Stack

| Concern        | Choice                             | Why                                             |
| -------------- | ---------------------------------- | ----------------------------------------------- |
| Engine         | **Phaser 3** (latest 3.x)          | Scenes, tweens, particles, unified input, scale manager out of the box |
| Language       | **TypeScript** (strict)            | The color/order logic benefits heavily from types |
| Build/dev      | **Vite**                           | Fast HMR, trivial static build                  |
| Tests          | **Vitest**                         | Runs the engine-free core logic in Node         |
| Lint/format    | ESLint + Prettier                  | Standard                                        |
| Hosting        | Static (GitHub Pages)              | Client-side only, no backend                    |
| Persistence    | `localStorage`                     | High scores and settings                        |

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
├── public/                    # (later) audio; the favicon is inline in index.html
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
    │   ├── tutorial.ts        # the three opening levels + what they stock
    │   ├── shelf.ts           # candy cache, matching
    │   ├── scoring.ts         # points, streaks, patience bonus
    │   ├── difficulty.ts      # stage curve (time/serves → knobs)
    │   ├── rng.ts             # small seedable PRNG (mulberry32)
    │   └── game.ts            # Game: owns state, step(), emits GameEvents
    ├── scenes/
    │   ├── keys.ts            # scene keys as constants — never raw strings
    │   ├── BootScene.ts       # generate textures, load settings
    │   ├── MenuScene.ts
    │   ├── GameScene.ts       # renders board+snake, owns the Game instance
    │   ├── UIScene.ts         # HUD overlay: orders, shelf, score, cheat sheet
    │   └── GameOverScene.ts
    ├── input/
    │   ├── anyInput.ts        # "press any key" for the menu / game-over screens
    │   ├── keyboard.ts        # arrows/WASD → DirectionQueue
    │   ├── touch.ts           # swipe detector (+ optional virtual d-pad)
    │   └── directionQueue.ts  # 2-deep buffer, 180° reversal rejection
    ├── render/
    │   ├── textures.ts        # runtime-generated candy/strand/jar textures
    │   ├── drawn.ts           # sprite + symbol glyph pairing, shared with ui/
    │   ├── strand.ts          # segment neighbours → rope piece + rotation (pure)
    │   ├── boardView.ts       # grid → sprites, segment coloring
    │   └── effects.ts         # particles, tweens (chop pop, shatter, confetti)
    ├── ui/
    │   ├── customerView.ts    # one child: walk, bubble, face, patience bar
    │   ├── customerQueue.ts   # the line at the window, keyed by customer id
    │   ├── shelfStrip.ts      # the six candy slots, level with the bench
    │   ├── text.ts            # one answer to "what does screen text look like"
    │   ├── cheatSheet.ts      # collapsible mixing strip
    │   └── layout.ts          # responsive anchoring (portrait/landscape)
    └── persist/
        └── storage.ts         # typed localStorage wrapper (scores, settings)
```

This is the finished layout: a file appears when its phase lands, so entries a
later phase owns are not on disk yet. The rule runs one way only — what is on
disk must appear here, so a file with no entry means one of the two is wrong.

## 4. Core model (key types)

```ts
// colors.ts — a color IS the set of primaries mixed in
export const RED = 1, YELLOW = 2, BLUE = 4;
export type ColorMask = number;          // 0 = raw … 7 = brown
export const blend = (c: ColorMask, dye: ColorMask): ColorMask => c | dye;
// tier(mask): 0→1 (raw), single bit→2, two bits→3, 7→"brown"

// types.ts
interface Segment { pos: Vec2; color: ColorMask }
interface SnakeState { head: Vec2; dir: Dir; body: Segment[] }   // no chop mode: the block cuts, the maker drives on
// A pickup is opened by the head and spent when the strand clears it, so its
// in-between state lives in core state, not in a Phaser tween (design §5).
type Pickup = { pos: Vec2; open: boolean } & ({ kind: 'sugar' } | { kind: 'dye'; primary; kneaded: number })
// One concept for both ways a strand comes off the maker: frozen where it was
// cut, consumed one segment per move from segments[0]. Only the ending differs.
interface Severed { segments: Segment[]; fate: 'crumble' | 'chop' }
interface Candy { color: ColorMask; bornAt: number }   // bornAt is a tick, never a wall clock
// patience is undefined for a customer who never leaves — the opening levels
interface Patience { remainingMs: number; totalMs: number }
interface Customer { id: number; want: ColorMask; patience: Patience | undefined }
interface TutorialLevel { want: ColorMask; stock: Primary[] }   // stock === primariesOf(want)
interface GameState {
  snake: SnakeState; pickups: Pickup[]; severed: Severed[]; shelf: Candy[];
  customers: Customer[]; score: number; lives: number;
  streak: number; elapsedMs: number; served: number; over: boolean;
  tutorialIndex: number;   // opening levels done; gates spawn stock and the next order
  tick: number;            // grid moves elapsed — a sim clock independent of moveIntervalMs
}
```

`Game.step(dtMs, inputs)` advances everything and returns `GameEvent[]`
(`sugar-pulled`, `sugar-spawned`, `dye-opened`, `dye-kneaded`, `dye-spent`,
`dye-spawned`, `strand-broken`, `debris-crumbled`, `strand-cut`,
`candy-chopped`, `candy-staled`,
`customer-arrived`, `customer-served`, `customer-left`, `life-lost`,
`game-over`, …). The Phaser layer never mutates core state; it only renders it
and plays effects per event. Events carry the data needed for presentation
(positions, colors, points) so views never dig through state diffs.

## 5. Time model

- **Render:** Phaser's `update(time, delta)` every animation frame.
- **Logic:** fixed-timestep accumulator inside `GameScene.update` calling
  `game.step(TICK_MS)`; snake moves one cell every `moveIntervalMs` (a
  difficulty knob). A cut piece — crumbling or chopping — gives up one segment
  per grid move, so the board runs on a single clock and needs no second knob.
- Patience bars and arrival timers tick in real ms (accumulated per step) so
  they stay smooth and frame-rate independent. The serving window is advanced
  *after* the move loop, so a child arriving on a step sees a rack that already
  holds whatever was chopped on the way in.
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
  board view. On `game-over` it stops the HUD it launched and starts
  `GameOverScene` with the run summary. Nothing is kept asleep for reuse: a
  restart builds a fresh `Game`, so a lingering scene would only hold the last
  run's core alive.
- **UIScene** runs in parallel (`scene.launch`) above GameScene — the standard
  Phaser pattern so HUD ignores any camera effects (screen shake on shatter)
  applied to the play field. It is handed the same `Game` and reads its state
  read-only every frame, because patience bars drain continuously and there is
  nothing to diff. One-shot HUD effects hang off the `GameEvent` stream
  instead: GameScene hands the window's own events (`customer-arrived`,
  `-served`, `-left`) straight to `UIScene.play`, because *who* is waiting is
  state but walking on and walking off are moments — and which of the two a
  child just had is not recoverable from a queue they are no longer in.
- Pause = `scene.pause` on GameScene only; UIScene stays interactive.

## 7. Rendering approach

- **Runtime-generated textures** in BootScene: each sprite is an ASCII pixel
  map in `render/textures.ts`, baked through Phaser's `textures.generate`
  against one fixed 16-color palette and drawn at an integer scale with
  `pixelArt: true` (design §2). Ships v1 with zero art files.
- Textures are baked at 16×16. The hand-authored sprites are drawn at 8×8 and
  doubled into that, so they render exactly as authored; only the strand's rope
  pieces are authored at 16×16, because a rope has to sit inset from its cell
  *and* still carry the same soft edge as everything else, and 8×8 has no width
  left for both.
- Sprite pixels are grays — a fill plus a soft edge — so that tinting, which
  multiplies, recolors them to any `ColorMask` palette entry while the edge
  stays a deeper shade of that same color.
- The rope pieces are **generated from a boolean shape** rather than drawn by
  hand: a solid pixel within `RIM_WIDTH` of an empty one takes the soft edge,
  the rest take the fill. Two consequences worth knowing. Pixels outside the
  texture count as solid, so a rope spanning its cell edge to edge grows no rim
  along that border and two segments meet with no seam. And `RIM_WIDTH` is 2,
  matching the doubled 8×8 sprites' edge — a one-pixel rim here would read as a
  second art style sitting next to the first.
- **The strand is drawn as continuous rope.** `render/strand.ts` maps a
  segment's neighbours to a piece (straight / elbow / end cap) and a rotation,
  so one elbow map serves all four turns. It is pure TypeScript with no Phaser
  import — wrap-aware, so the strand stays unbroken across a service door — so
  the geometry is unit-tested in Node like the core is (§11).
- **The view interpolates; the core does not.** `Game.moveProgress()` reports
  how far the snake stands between cells (0…1) and `BoardView.render` slides
  sprites that fraction of the way, so the simulation stays discrete and
  testable while the motion on screen is continuous.
- Segment sprites are tinted with the palette color and stamped with the
  accessibility **symbol glyph** (bitmap text) per the design doc.
- Effects are Phaser particle emitters + tweens, all triggered by GameEvents,
  never by polling state.
- Palette lives in one table in `core/colors.ts` (mask → hex, symbol, name,
  tier) so core, HUD, and cheat sheet can never disagree.

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
  create and on `resize` events. `layout.ts` is the only file that knows about
  screen geometry, and it is pure arithmetic — no Phaser import — so it carries
  unit tests while the scenes that apply it are covered by the smoke driver.
- The 16×16 board renders at the largest integer-friendly cell size that fits
  the available rectangle, **applied as one container transform**: the board
  draws itself at a fixed `CELL_SIZE` in its own coordinates and `BoardView`
  scales the container it all lives in. Sizing every sprite per device instead
  would make `CELL_SIZE` dynamic across `textures.ts`, `drawn.ts` (it is the
  default scale argument of `makeSprite`) and `boardView.ts`, and would break
  the accessibility glyphs, which are baked at their display size on purpose.
  `cell` is still chosen as a whole number, so `CELL_SIZE * scale` is exact.
- The board is never scaled *up* past the size its sprites are authored at: a
  large window gets more room around the kitchen, not a bigger kitchen.
- HUD regions anchor around the board, and the HUD is **not** scaled with it —
  it is a parallel scene with its own camera, so text stays readable and touch
  targets stay full size however far the board has had to shrink.
  - **Landscape:** customers + shelf + score in the right column, beside the
    chopping block's wall (design §10).
  - **Portrait:** score and lives in a band *above* the board, the rack and the
    queue in a strip *below* it. A board that already fills the width leaves no
    column beside it, so the strip goes under — with the rack right-aligned and
    the queue running back from it, which is how design §10's one-sided reading
    survives the turn. (This supersedes the earlier "narrowed and compacted
    beside the grid", which assumed a board that did not fill the width.)
- The rack sizes itself to the run it is given: six slots at the desktop pitch
  need most of a laptop's height, which a phone held sideways has not got, so
  pitch and slot shrink together rather than running off the screen.
- The serving side stays on the block's wall in both orientations: the block's
  cells are a game rule, so they must never depend on the layout.
- Mobile page hardening: `touch-action: none` on the canvas,
  `viewport-fit=cover`, prevent pull-to-refresh/zoom, wake-lock nice-to-have.

## 10. Persistence

`persist/storage.ts` — typed, versioned wrapper:

```ts
interface SaveData { version: 1; highScores: ScoreEntry[]; settings: Settings }
```

Single JSON blob under one key (`candy-snake:v1`). Corrupt/missing data falls
back to defaults silently. No PII, no backend.

## 11. Testing strategy

- **Unit (Vitest, engine-free modules):** color blending table (all 8×3 dye
  applications), self-hit shatter boundaries (hit neck, hit tail, hit middle),
  chop ordering (block end first, colors preserved), order matching + shelf
  eviction, pity-spawner guarantees, difficulty curve monotonicity, scoring
  incl. streak caps. Deterministic via seeded `rng.ts`. Beyond `core/`, this
  covers the pure modules the Phaser layer leans on — `input/directionQueue.ts`
  and `render/strand.ts` (rope pieces, rotations, wrapped neighbours).
- **Simulation tests:** `core/simulation.test.ts` plays whole runs with a bot
  that grows a segment, takes it through the jars the order needs and drives it
  into the bench, asserting invariants on every tick (≥1 sugar on map, no
  pickup on snake, lives in range, shelf ≤ 6, queue within cap, no child
  waiting beside a candy they ordered, no clock on an opening-level customer).
- **Smoke (Playwright):** `.claude/skills/run-candy-snake/driver.mjs` boots
  Vite in-process, loads the page headless, fails on any console error or a
  missing canvas, and saves a screenshot. Not a nice-to-have: nothing that
  imports Phaser runs under Vitest, so this is the only automated check those
  files get, and the one to run after touching them.
- **Manual/E2E:** device pass on real phones per milestone (Chrome DevTools
  device emulation is the daily driver, real-device check before release).

## 12. Build & deploy

- `npm run dev` (Vite), `npm run build` → `dist/` static bundle,
  `npm run test` / `lint` / `typecheck` / `format:check` gate commits, and
  `.github/workflows/ci.yml` runs the same set on every push and PR.
- Deploy `dist/` to GitHub Pages via Actions on push to `main`
  (`.github/workflows/deploy.yml`, using `upload-pages-artifact` /
  `deploy-pages`; repo Settings → Pages source must be "GitHub Actions").
  Live at <https://williamchong.github.io/candy-snake/>.
  Vite's `base: './'` keeps asset URLs relative so the bundle works both at the
  `/candy-snake/` project-page path and under `vite preview`.
- Phaser is the only heavy dependency (~1.1 MB min+gz ~300 KB); acceptable for
  a game page, no code-splitting needed for v1.
