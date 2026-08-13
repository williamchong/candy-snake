---
name: run-candy-snake
description: Run, launch, smoke-test, or screenshot the Candy Snake game — boots the Vite dev server, drives it headless with Playwright, verifies the Phaser canvas mounts with no console errors, and saves a screenshot.
---

# Run Candy Snake

Candy Snake is a Phaser 3 + TypeScript + Vite browser game. It has no backend —
"running" it means serving `index.html` via Vite and loading it in a browser.
All paths below are relative to the repo root.

## Prerequisites

- `npm install` (Playwright is a devDependency; its Chromium build must be in
  the Playwright cache — if launch fails with a "browser not found" error, run
  `npx playwright install chromium`).

## Run (agent path) — smoke driver

```bash
node .claude/skills/run-candy-snake/driver.mjs
```

Starts Vite in-process, loads the page headless in Chromium at 960×640, then:

- **fails (exit 1)** on any console error or uncaught page error,
- **fails** if no `<canvas>` appears inside `#app` within 10 s,
- saves a screenshot to `.claude/skills/run-candy-snake/screenshot.png`
  (gitignored) and exits 0.

Options:

- `--url http://localhost:5173/` — drive an already-running server instead of
  starting one (the driver then does not stop anything on exit).
- `--out /path/shot.png` — screenshot destination.

Read the screenshot file to visually verify a change. For interactive
debugging beyond the smoke check (clicking, console inspection), start the
server yourself and use browser tooling against it:

```bash
npm run dev   # prints Local: http://localhost:5173/
```

## Run (human path)

`npm run dev`, open the printed URL. Ctrl-C to stop.

## Test / gates

```bash
npm run test        # Vitest over src/**/*.test.ts (engine-free core only)
npm run typecheck && npm run lint && npm run format:check
```

## Gotchas

- **The driver treats *any* console error as failure, including 404 resource
  loads.** A missing favicon already tripped this once (fixed with an inline
  data-URI icon in `index.html`). If the driver fails right after you add an
  asset reference, suspect a 404 before suspecting game code.
- Phaser's boot banner is a styled `console.log` — it is normal output, not an
  error.
- `.claude/` is excluded from ESLint (agent tooling, not product surface), but
  Prettier still formats `driver.mjs`.

## Troubleshooting

- `FAIL: page.goto: net::ERR_CONNECTION_REFUSED` with `--url` — the server at
  that URL isn't running; drop `--url` to let the driver spawn one.
- Port 5173 busy (stale dev server): Vite auto-increments to 5174+ and the
  driver uses whatever URL Vite resolves, so this is normally harmless; kill
  strays with `pkill -f vite` if you need the canonical port.
