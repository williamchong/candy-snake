#!/usr/bin/env node
/**
 * Smoke driver for Candy Snake. Starts Vite in-process (unless --url is
 * given), loads the game headless in Chromium, fails on console errors,
 * and saves a screenshot.
 *
 *   node .claude/skills/run-candy-snake/driver.mjs
 *   node .claude/skills/run-candy-snake/driver.mjs --url http://localhost:5173/
 *   node .claude/skills/run-candy-snake/driver.mjs --out /tmp/shot.png
 *   node .claude/skills/run-candy-snake/driver.mjs --viewport 390x844
 *
 * Exit 0 = game boots clean. Exit 1 = console error, no canvas, or timeout.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';
import { createServer } from 'vite';

const { values: flags } = parseArgs({
  options: {
    url: { type: 'string' },
    out: { type: 'string' },
    viewport: { type: 'string' },
  },
});
const outPath =
  flags.out ?? join(dirname(fileURLToPath(import.meta.url)), 'screenshot.png');

// The game lays itself out from the real viewport now (architecture §9), so the
// size the page is loaded at is part of what is being smoke-tested.
const DEFAULT_VIEWPORT = { width: 960, height: 640 };
const parseViewport = (value) => {
  if (!value) return DEFAULT_VIEWPORT;

  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`--viewport wants WxH, e.g. 390x844 (got "${value}")`);

  return { width: Number(match[1]), height: Number(match[2]) };
};

let server;
let browser;
let exitCode = 0;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  exitCode = 1;
};

try {
  let url = flags.url;
  if (!url) {
    server = await createServer({ logLevel: 'warn' });
    await server.listen();
    url = server.resolvedUrls.local[0];
  }
  console.log(`loading ${url}`);

  const viewport = parseViewport(flags.viewport);
  console.log(`viewport ${viewport.width}x${viewport.height}`);

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#app canvas', { timeout: 10000 });
  await page.waitForTimeout(500); // let the first frames render

  if (consoleErrors.length > 0) fail(`console errors:\n  ${consoleErrors.join('\n  ')}`);

  await page.screenshot({ path: outPath });
  console.log(`screenshot: ${outPath}`);
} catch (err) {
  fail(err.message);
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
}

if (exitCode === 0) console.log('OK: game boots clean');
process.exit(exitCode);
