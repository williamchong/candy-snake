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
puts it away if you would rather it were not. The juice is in — the strand goes
thin as you pull it and swells where a cube goes in, candies pop off the bench,
a self-hit cracks and knocks the kitchen, and a served child gets confetti.
The game makes a noise now: eleven cues generated at boot rather than loaded,
hung off the same events the effects are, with the serve chime climbing your
streak — and a mute tab beside the mixing wheel, or **M**, for when it should
not, over a room tone that loops without a seam. The run stops now, too —
**P** or **Esc**, or a third tab for the thumb that has neither: the kitchen
frosts over, the room goes quiet, and the HUD stays bright so you can read what
is still on the rack before tapping the board to carry on. Scores and the
settings survive the reload: the top ten sit on the menu, and the score screen
says what the run did and where it landed. What is still unbuilt is the optional
virtual D-pad of design §10. The
[implementation plan](docs/implementation-plan.md) records how each phase went.

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
