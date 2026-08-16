# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Candy Snake: a snake-like arcade game (Phaser 3 + TypeScript + Vite) where the snake is a pulled-sugar strand — grow with sugar, blend RYB dye into it, chop it into candies to serve customers. Web only, desktop + mobile, client-side only (no backend).

The `docs/` directory is the source of truth for all design and architecture decisions:

- `docs/game-design.md` — rules (color blending, shatter, chop, customers, scoring, difficulty)
- `docs/architecture.md` — layer design, types, scenes, input, time model
- `docs/implementation-plan.md` — the phase plan; work proceeds phase by phase, each phase ends runnable

Check the plan for the current phase before adding anything; features listed in game-design §13 (out of scope) must not be built.

## Commands

- `npm run dev` — Vite dev server
- `npm run test` — Vitest, single run (`npm run test:watch` to watch)
- `npx vitest run src/core/foo.test.ts` — single test file; add `-t 'name'` for one test
- `npm run typecheck` / `npm run lint` / `npm run format:check` — gates; all must pass before committing
- `npm run build` — typecheck + production build to `dist/`
- `node .claude/skills/run-candy-snake/driver.mjs` — headless smoke run: boots the game in Chromium, fails on console errors or missing canvas, saves a screenshot (see the run-candy-snake skill)

## Architecture: engine-free core

The one structural rule that matters (architecture.md §2):

- **All game rules live in `src/core/` as pure TypeScript with zero Phaser imports.** Core is deterministic given (seed, inputs) — randomness only via `core/rng.ts` (seeded), never `Math.random`. This is what makes the logic unit-testable in Node (Phaser can't easily run there).
- Phaser scenes (`src/scenes/`) are a thin presentation layer: they feed input in, advance the core on a fixed timestep via `Game.step(dtMs)`, and render state / play effects from the returned `GameEvent[]`. Scenes never mutate core state, and effects are triggered by events, never by polling state.
- Scene keys are constants in `src/scenes/keys.ts` — never raw string literals.
- The color palette (mask → hex/symbol/name/tier) lives only in `core/colors.ts`; HUD and rendering look it up there so they can never disagree.
- Textures are generated at runtime in BootScene: `render/textures.ts` holds ASCII pixel maps baked through `scene.textures.generate` against one fixed palette — there are no image assets in v1.

Tests are colocated (`src/**/*.test.ts`) and cover the engine-free logic:
`core/` plus the pure modules the Phaser layer leans on —
`input/directionQueue.ts`, `input/swipe.ts`, `render/strand.ts` and
`ui/layout.ts` (all screen geometry, which is why it stays Phaser-free).
A type-only `import type Phaser` does not count against that: it is erased
before the tests run, so such a module can hold its own scene binding (as
`input/keyboard.ts`, `input/swipe.ts` and `ui/cheatSheet.ts` do) and still
load under Node.
Everything that reaches Phaser at runtime — `scenes/`, `ui/`, and the rest of
`render/` and `input/` — is verified by the run-candy-snake smoke driver
instead. The dividing line is the import, not the directory.

## Conventions

- Commit messages use gitmoji (`✨ Add …`, `🐛 Fix …`, `🎨 Clean up …`); see `git log` for examples.
- After completing an implementation-plan phase: run the `/simplify` review, then commit.
- Prettier deliberately ignores markdown (`.prettierignore`) — the docs' ASCII diagrams and aligned tables must not be reflowed.
- Canvas centering belongs to Phaser's `Scale.CENTER_BOTH` alone; don't add CSS centering around `#app`.
