#!/usr/bin/env node
/**
 * Smoke driver for Candy Snake. Boots the Vite dev server (unless --url is
 * given), loads the game headless in Chromium, fails on console errors,
 * asserts the Phaser canvas mounted, and saves a screenshot.
 *
 *   node .claude/skills/run-candy-snake/driver.mjs
 *   node .claude/skills/run-candy-snake/driver.mjs --url http://localhost:5173/
 *   node .claude/skills/run-candy-snake/driver.mjs --out /tmp/shot.png
 *
 * Exit 0 = game boots clean. Exit 1 = console error, no canvas, or timeout.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const externalUrl = argValue('--url');
const outPath =
  argValue('--out') ?? join(dirname(fileURLToPath(import.meta.url)), 'screenshot.png');

let devServer;
let exitCode = 0;
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  exitCode = 1;
};

const startDevServer = () =>
  new Promise((resolve, reject) => {
    devServer = spawn('npm', ['run', 'dev'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('dev server: no URL in 15s')), 15000);
    let buf = '';
    devServer.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/Local:\s+(http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    devServer.on('exit', (code) => reject(new Error(`dev server exited (${code})`)));
  });

try {
  const url = externalUrl ?? (await startDevServer());
  console.log(`loading ${url}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load' });
  // Phaser logs its banner on boot; the canvas appears right after.
  await page.waitForSelector('#app canvas', { timeout: 10000 });
  await page.waitForTimeout(500); // let the first frames render

  const banner = await page.evaluate(
    () => document.querySelector('#app canvas') !== null,
  );
  if (!banner) fail('no canvas inside #app');
  if (consoleErrors.length > 0) fail(`console errors:\n  ${consoleErrors.join('\n  ')}`);

  await page.screenshot({ path: outPath });
  console.log(`screenshot: ${outPath}`);

  await browser.close();
} catch (err) {
  fail(err.message);
} finally {
  devServer?.kill();
}

if (exitCode === 0) console.log('OK: game boots clean');
process.exit(exitCode);
