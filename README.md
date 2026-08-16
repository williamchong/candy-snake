# Candy Snake 🍬

[![CI](https://github.com/williamchong/candy-snake/actions/workflows/ci.yml/badge.svg)](https://github.com/williamchong/candy-snake/actions/workflows/ci.yml)

A web-based arcade game for desktop and mobile: you are an old-fashioned candy
maker, and your snake is the pulled sugar strand. Eat sugar to grow it, knead
in red/yellow/blue dye to color it (colors blend like real paint), then chop
the strand into candies at the chopping block to serve the children queuing at
your shop window — before their patience runs out.

**Play it:** <https://williamchong.github.io/candy-snake/> (deployed from `main`).

**Status:** playable end to end — opening levels, customers, lives, score, a
difficulty ramp that will eventually beat you, game over, restart — on desktop
and, with swipe steering and a layout that follows the screen, on a phone in
either orientation. The mixing wheel is in, up by default and on a tab that
puts it away if you would rather it were not. Juice, audio and persistence are
still ahead; the
[implementation plan](docs/implementation-plan.md) tracks which phase the work
is on.

## Develop

```sh
npm install
npm run dev                          # Vite dev server
npm run test                         # Vitest over the engine-free logic
npm run typecheck && npm run lint && npm run format:check
```

`npm run build` runs the typecheck and writes `dist/`. See
[CLAUDE.md](CLAUDE.md) for the one structural rule (`src/core/` imports no
Phaser) and the smoke driver that covers the Phaser layer.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/game-design.md](docs/game-design.md) | Theme, core loop, RYB color system, customers/orders, difficulty ramp, scoring, controls (keyboard + touch), UI incl. the mixing cheat sheet |
| [docs/architecture.md](docs/architecture.md) | Phaser 3 + TypeScript + Vite stack, engine-free `core/` design, scenes, input, responsive layout, testing, deploy |
| [docs/implementation-plan.md](docs/implementation-plan.md) | 9 phases (0–8) from scaffold to shipped URL, each ending runnable, with risks and done-criteria |

## Key decisions (locked)

- **Color model:** discrete RYB primaries; a color = the set of primaries
  mixed in (bitmask). R+B=Purple, R+Y=Orange, Y+B=Green, all three = Brown
  (the over-mix trap). In-game non-obstructive cheat sheet teaches mixing.
- **Engine:** Phaser 3 (TypeScript, Vite).
- **Structure:** endless arcade run with a ramping difficulty curve, 3 lives,
  local high scores.
- **Scope:** client-side only — static hosting, `localStorage`, no backend.

## License

[GPL-3.0-only](LICENSE)
