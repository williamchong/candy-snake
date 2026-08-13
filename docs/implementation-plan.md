# Candy Snake — Implementation Plan

Phased so that **every phase ends in something runnable**, and gameplay-risk
items (does the core loop feel good?) are validated before polish is spent.
Sizes are relative (S < M < L), not calendar promises.

References: [game-design.md](./game-design.md), [architecture.md](./architecture.md).

## Phase 0 — Scaffold (S)

- Vite + TypeScript (strict) + Phaser 3 project; ESLint, Prettier, Vitest.
- `npm run dev / build / test / lint / typecheck` all green.
- Empty BootScene → GameScene showing a colored rectangle at fixed
  `Scale.FIT` 960×640.
- Git repo initialized; first commit.

**Done when:** `npm run dev` shows a Phaser canvas; CI-ready scripts pass.

## Phase 1 — Gray-box snake core (M)

The engine-free core plus minimal rendering. No colors, no customers yet.

- `core/`: types, rng, board (16×16, wrap), snake (tick movement, growth),
  spawner (sugar only, ≥1 invariant), `Game.step` + events.
- `input/`: keyboard adapter + DirectionQueue (buffering, 180° rejection).
- `render/`: generated textures; boardView draws snake + sugar per state.
- Self-collision shatter (segment-at-impact through tail destroyed) with a
  placeholder flash.
- Unit tests: movement/wrap, growth, shatter boundaries, spawn invariant,
  input queue edge cases.

**Done when:** playable snake on desktop — eat sugar, grow, shatter on
self-hit — and `core/` tests pass. **This is the "does steering feel right?"
checkpoint; tune tick rate before moving on.**

## Phase 2 — Color system (M)

- `core/colors.ts` palette table (mask → hex, symbol, name, tier) + `blend`.
  The values are constrained, not free — see game-design §4 "Palette
  constraints" before picking any.
- Dye pickups (primaries, ≤1 per color on map). Pickups are passed *through*
  rather than eaten (design §5): the head opens one, it tints/feeds one
  segment per move as the strand is drawn across it, and it leaves the board —
  and only then respawns — once the strand has cleared its cell. A sugar cube
  becomes the new tail segment on its own cell; new sugar still appends raw.
- Self-hit breaks the strand instead of vaporising it: the severed piece
  freezes and crumbles one block per move, impact end first (design §6).
- Rendering: per-segment tint + symbol glyph; dye jars and debris on board.
- Unit tests: full blend table, per-segment independence, dye-with-no-body
  no-op, pass-through timing, crumble order.

**Done when:** you can build a `[purple, purple, raw]` strand on screen and
every color state renders distinctly (check symbols with grayscale filter),
and the strand visibly turns one segment at a time as it crosses a jar.

## Phase 3 — Chopping block & shelf (M)

- Chopping block station cells down the right wall, on the serving side of the
  board with the shelf and (Phase 4) the queue. Reaching one cuts the whole
  strand loose (design §5): the maker drives on empty-handed, and the batch
  freezes where it lay and is drawn into the block one segment per move, block
  end first. No chop mode, no halt — the strand is never dragged or teleported.
- A cut piece is one concept whichever way it was cut: `crumble` (self-hit) and
  `chop` share the frozen-and-consumed-one-per-move machinery, and differ only
  in what each segment becomes.
- Shelf model (6 slots, oldest-evicted) + minimal shelf strip in a temporary
  HUD corner, in the right column level with the block.
- Events wired to placeholder effects (pop per chop).
- Unit tests: chop ordering & colors, batch drain, pickups re-closed by a cut,
  shelf eviction, block cells excluded from spawns.

**Done when:** grow → dye → chop produces the right candies in the right
order, visible on the shelf.

## Phase 4 — Customers, orders, lives → first real game (L)

The phase where it becomes a *game*.

- `core/orders.ts` + `customers.ts`: arrivals, patience countdown, queue cap;
  order generation per difficulty stage table (start with static Warm-up
  values).
- Matching: on candy produced and on customer arrival, serve from
  production/shelf automatically.
- Scoring (base + patience bonus + streak), lives, game over.
- `UIScene`: order cards (color + component dots + patience bar), lives,
  score, shelf strip moved here.
- Menu → Game → GameOver scene flow; restart.
- Unit + simulation tests: matching precedence, expiry → life loss, scoring
  math, bot-run invariants.

**Done when:** a full run — serve customers, lose lives, game over, restart —
is playable start to finish with keyboard.

## Phase 5 — Difficulty ramp & spawn fairness (M)

- `core/difficulty.ts`: continuous curve over (time, serves) driving order
  tier mix, arrival interval, patience, queue cap, snake speed (per the table
  in the design doc).
- Pity spawner: needed-primary detection and forced spawn ≤5 s; brown-mercy
  customer.
- Balancing pass: scripted bot simulations + human playtests; adjust the
  tuning table. **Expect to iterate here — budget real playtime.**

**Done when:** a decent player survives ~8–10 min on a first real run and
death feels earned (post-playtest judgment call), and simulation asserts no
order is ever primary-starved.

## Phase 6 — Mobile & responsive (L)

- Touch input: swipe adapter (dead zone, dominant axis, mid-drag threshold);
  optional virtual D-pad behind a setting.
- Replace fixed FIT with `Scale.RESIZE` + `ui/layout.ts` (landscape/portrait
  anchoring per architecture §9).
- Page hardening: `touch-action: none`, viewport meta, no pull-to-refresh,
  ≥44 px HUD hit areas.
- Real-device pass (at least one iOS Safari + one Android Chrome): input feel,
  perf (60 fps target), safe-area insets.

**Done when:** the same run is comfortably playable one-handed on a phone in
both orientations.

## Phase 7 — Cheat sheet, hints & UX polish (M)

- Collapsible mixing cheat sheet (edge tab, auto-collapse, persisted state) —
  the non-obstructive requirement from design §4.
- Contextual first-run hint toasts (3 hints, persisted seen-flags).
- Settings screen: sound, D-pad toggle, left-hand mode, high-contrast symbols.
- Juice pass: eat squash, chop pop + particles, shatter shards + camera shake,
  serve confetti, patience-bar urgency pulse. Now that the strand is drawn as
  one rope (design §2), stretching it along its travel axis as it is pulled
  belongs here too.
- Audio: SFX set + ambient loop, gesture-gated unlock, mute persisted.

**Done when:** a new player understands mixing without leaving the game, and
every core event has audiovisual feedback.

## Phase 8 — Persistence, high scores & release (S)

- `persist/storage.ts` (versioned blob): high scores top-10, settings,
  seen-hints (wire-up — earlier phases used in-memory defaults).
- Game-over score breakdown + high-score table on menu.
- Favicon/title/meta (social card), lighthouse sanity pass.
- Deploy: GitHub Actions → GitHub Pages (or Netlify); verify the deployed
  build on desktop + phone.

**Done when:** a public URL serves the game; scores survive reload.

## Milestone summary

| Phase | Deliverable                              | Risk it retires                 |
| ----- | ---------------------------------------- | ------------------------------- |
| 0     | Running scaffold                         | Toolchain                       |
| 1     | Gray-box snake                           | Movement feel                   |
| 2     | Color blending on-screen                 | Core novelty works              |
| 3     | Chop → candies → shelf                   | Production loop                 |
| 4     | Full playable game (desktop)             | Is it fun?                      |
| 5     | Balanced endless ramp                    | Fairness / pacing               |
| 6     | Mobile parity                            | Touch feel, perf                |
| 7     | Teachability + juice                     | New-player comprehension        |
| 8     | Shipped URL                              | Release mechanics               |

## Risks & mitigations

- **Chop-mode feel** — *retired in Phase 3*, by dropping chop mode outright:
  the block cuts the strand loose and the maker never stops moving. The
  fallback held in reserve (instant chop, staggered animation) is close to
  what shipped, minus the freeze.
- **Swipe latency vs. grid ticks** — mid-drag threshold detection (arch §8);
  validate on real devices early in Phase 6, not at the end.
- **Color confusion for colorblind players** — symbols are in from Phase 2,
  not bolted on later.
- **Balance is opinion** — seeded simulations make tuning comparable
  run-to-run; keep all knobs in `difficulty.ts` + one tuning table.
- **Scope creep** — future ideas live in design doc §13; nothing from that
  list enters before Phase 8 ships.
