// Screenshot tour used during design review (not part of the test suite).
//   node test/e2e/shots.mjs http://127.0.0.1:8787 /path/to/output
import { createRequire } from 'node:module';
import { content, plannedPaths } from '../helpers/content.mjs';
import { replay } from '../../src/engine.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [BASE = 'http://127.0.0.1:8787', OUT = '.'] = process.argv.slice(2);
const wait = (p, ms = 550) => p.waitForTimeout(ms);

async function play(page, empireId, choices, shotEvery = null) {
  const e = content.empires[empireId];
  for (let i = 0; i < choices.length; i++) {
    await page.waitForSelector('.choice:not([disabled])');
    const state = replay(e, content.rules, choices.slice(0, i));
    const text = e.nodes[state.nodeId].options.find((o) => o.id === choices[i]).text;
    const shown = await page.$$eval('.choice .otext', (els) => els.map((el) => { const c = el.cloneNode(true); c.querySelectorAll('.def').forEach((d) => d.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); }));
    await page.click(`.choice >> nth=${shown.indexOf(text)}`);
    await page.waitForSelector('#next');
    if (shotEvery) await shotEvery(i);
    await page.click('#next');
    // Turning points show a map scene, and a collapse shows the fall, before moving on.
    const after = replay(e, content.rules, choices.slice(0, i + 1));
    if (after.ending?.type === 'collapsed' || e.nodes[state.nodeId].scene) {
      await page.waitForSelector('#scene-next');
      if (shotEvery) await shotEvery(i, after.ending ? 'fall' : 'scene');
      await page.click('#scene-next');
    }
  }
  await page.waitForSelector('.chronicle');
  await wait(page, 1100);
}

async function newPlayer(page, name, period, empireId, shot = null) {
  await page.goto(BASE);
  await page.waitForSelector('#start-form');
  if (shot) { await wait(page, 700); await shot('0-start'); }
  await page.fill('#name', name);
  await page.click(`.periods input[value="${period}"] + span`);
  await page.click('#start-form button[type=submit]');
  await page.waitForSelector('[data-empire]');
  if (shot) { await wait(page, 700); await shot('1-realms'); }
  await page.click(`[data-empire="${empireId}"]`);
  await wait(page);
}

const proxy = process.env.HTTPS_PROXY && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE) ? { server: process.env.HTTPS_PROXY } : undefined;
const browser = await chromium.launch({ proxy });
const tag = Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 4);
for (const [label, viewport, colorScheme] of [['desk', { width: 1366, height: 768 }, 'light'], ['phone', { width: 390, height: 844 }, 'light'], ['dark', { width: 1366, height: 768 }, 'dark']]) {
  const ctx = await browser.newContext({ viewport, colorScheme, deviceScaleFactor: label === 'phone' ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const shot = (n) => page.screenshot({ path: `${OUT}/${label}-${n}.png`, fullPage: true });

  // Collapse on a hard empire.
  await newPlayer(page, `Fall ${label} ${tag}`, 1, 'spain', shot);
  await shot('a-intro-spain');
  await page.click('#begin');
  await page.waitForSelector('.choice');
  await wait(page, 700);
  await shot('a2-decision');
  const { collapse } = plannedPaths(content.empires.spain);
  await play(page, 'spain', collapse.choices, async (i, where) => {
    if (i !== collapse.choices.length - 1) return;
    await wait(page, where ? 3200 : undefined);
    await shot(where ? 'b2-fall' : 'b-collapse-result');
  });
  await shot('c-collapse-end');

  // A full Songhai game (survives).
  await newPlayer(page, `Win ${label} ${tag}`, 3, 'songhai');
  await page.click('#begin');
  await play(page, 'songhai', plannedPaths(content.empires.songhai).best.choices);
  await shot('d-survive-end');

  // Start a game and leave it unfinished, to show "Continue" and "Still playing".
  await newPlayer(page, `Half ${label} ${tag}`, 2, 'tokugawa');
  await page.click('#begin');
  await page.waitForSelector('.choice');
  await page.goto(BASE);
  await page.waitForSelector('#start-form');
  await wait(page);
  await shot('e-start-resume');

  // Teacher mode leaderboard.
  await page.goto(`${BASE}/#teacher`);
  await page.waitForSelector('#teacher-password');
  await page.fill('#teacher-password', 'local-teacher-pw');
  await page.click('#teacher-form button[type=submit]');
  await page.waitForSelector('.tiles');
  await wait(page, 900);
  await shot('f-class-report');
  await page.click('[data-go="leaderboard"]');
  await page.waitForSelector('.teacher-bar');
  await wait(page, 900);
  await shot('g-teacher-board');
  console.log(label, 'errors:', errors);
  await ctx.close();
}
await browser.close();
