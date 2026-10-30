#!/usr/bin/env node
// Browser play-through test. For EVERY empire it plays, in a real Chromium:
//   1. the best full path (must survive and reach the maximum score), and
//   2. an early-collapse path (must collapse with the right penalty),
// checking the points shown after every decision, the end screen, the
// leaderboard, and the "practice run" label for repeat games.
//
//   npm run test:e2e                       # starts a local server with a fresh database
//   BASE_URL=https://... npm run test:e2e  # tests a deployed site
//   (for a deployed site, set TEACHER_PASSWORD too so test entries are cleaned up)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { content, plannedPaths } from '../helpers/content.mjs';
import { replay } from '../../src/engine.js';
import { ROOT } from '../../scripts/lib/load-content.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const { rules, empires } = content;
const fmtPts = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
const tag = Array.from({ length: 4 }, () => 'bdgjlmnpqrtvz'[Math.floor(Math.random() * 13)]).join('');
const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

let BASE = process.env.BASE_URL;
let server = null;
let persistDir = null;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out}`))));
  });
}

async function startLocalServer() {
  persistDir = mkdtempSync(path.join(tmpdir(), 'rte-e2e-'));
  await run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'rule-the-empire', '--local', '--persist-to', persistDir]);
  const port = 8790 + Math.floor(Math.random() * 100);
  server = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir,
    '--var', 'TEACHER_PASSWORD:e2e-teacher', '--var', 'GAME_SECRET:e2e-secret'], { cwd: ROOT, stdio: 'ignore' });
  BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('local server did not start');
}

async function optionTextsOnPage(page) {
  return page.$$eval('.choice', (buttons) => buttons.map((b) => {
    const t = b.querySelector('.otext').cloneNode(true);
    t.querySelectorAll('.def').forEach((d) => d.remove());
    return t.textContent.replace(/\s+/g, ' ').trim();
  }));
}

async function playInBrowser(browser, { name, period, empireId, choices }) {
  const e = empires[empireId];
  const expected = replay(e, rules, choices);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE);
  await page.fill('#name', name);
  await page.click(`.periods input[value="${period}"] + span`);
  await page.click('#start-form button[type=submit]');
  await page.click(`[data-empire="${empireId}"]`);
  await page.click('#begin');

  let state = replay(e, rules, []);
  for (let i = 0; i < choices.length; i++) {
    await page.waitForSelector('.choice:not([disabled])');
    const node = e.nodes[state.nodeId];
    const option = node.options.find((o) => o.id === choices[i]);
    const shown = await optionTextsOnPage(page);
    if (shown.length !== 3) throw new Error(`${empireId}: expected 3 options at ${state.nodeId}, saw ${shown.length}`);
    const index = shown.indexOf(option.text);
    if (index < 0) throw new Error(`${empireId}: option "${option.text}" not shown at ${state.nodeId}. Shown: ${JSON.stringify(shown)}`);
    const heading = (await page.textContent('.event h1')).trim();
    if (heading !== node.title) throw new Error(`${empireId}: expected decision "${node.title}", saw "${heading}"`);
    await page.click(`.choice >> nth=${index}`);
    await page.waitForSelector('#next');
    const pts = (await page.textContent('.stamp b')).trim();
    if (pts !== fmtPts(option.points)) throw new Error(`${empireId}: ${state.nodeId}/${option.id} showed ${pts}, expected ${fmtPts(option.points)}`);
    state = replay(e, rules, choices.slice(0, i + 1));
    await page.click('#next');
  }

  await page.waitForSelector('.chronicle');
  const title = (await page.textContent('.chronicle .fate')).trim();
  const end = expected.ending;
  const wantTitle = end.type === 'survived' ? `Endured to ${end.year}` : `Fell in ${end.year}`;
  if (title !== wantTitle) throw new Error(`${empireId}: end title "${title}", expected "${wantTitle}"`);
  const finalTo = await page.getAttribute('#final-score', 'data-to');
  if (Number(finalTo) !== end.finalScore) throw new Error(`${empireId}: final score ${finalTo}, expected ${end.finalScore}`);
  const recapCount = await page.$$eval('.ledger tr', (l) => l.length);
  if (recapCount !== choices.length) throw new Error(`${empireId}: recap shows ${recapCount} choices, expected ${choices.length}`);
  const timelineCount = await page.$$eval('.timeline li', (l) => l.length);
  if (timelineCount !== e.timeline.length) throw new Error(`${empireId}: timeline shows ${timelineCount} events`);
  const saved = await page.$('.entered');
  const practice = await page.$('.practice');
  if (!saved || practice) throw new Error(`${empireId}: first game should be saved to the leaderboard (saved=${!!saved}, practice=${!!practice})`);
  if (errors.length) throw new Error(`${empireId}: browser errors: ${errors.join(' | ')}`);
  return { ctx, page, end };
}

async function practiceCheck(page) {
  // Same student plays again: must be labeled practice and never saved.
  await page.click('#again');
  await page.waitForSelector('.practice');
  await page.click('[data-empire="mughal"]');
  await page.click('#begin');
  await page.waitForSelector('.choice');
  if (!(await page.$('.practice'))) throw new Error('practice banner missing during a repeat game');
  const text = await page.textContent('.practice');
  if (!text.includes("Practice run – doesn't count for the leaderboard")) throw new Error(`practice label text wrong: ${text}`);
}

async function main() {
  if (!BASE) await startLocalServer();
  console.log(`Testing ${BASE}`);
  // A deployed site may need to go through the network proxy, if there is one.
  const proxy = process.env.HTTPS_PROXY && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE) ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const results = [];
  const created = [];
  let failures = 0;
  let n = 0;
  try {
    for (const id of rules.empireOrder) {
      const { best, collapse } = plannedPaths(empires[id]);
      for (const [kind, p] of [['full', best], ['collapse', collapse]]) {
        const name = `${kind === 'full' ? 'Test' : 'Fall'} ${label(id)} ${tag}`.slice(0, 20);
        const period = (n++ % 3) + 1;
        const t0 = Date.now();
        try {
          const { ctx, page, end } = await playInBrowser(browser, { name, period, empireId: id, choices: p.choices });
          if (n === 1) await practiceCheck(page);
          await ctx.close();
          created.push({ name, period, score: end.finalScore, outcome: end.type });
          results.push(`  ok  ${id.padEnd(9)} ${kind.padEnd(8)} ${p.choices.length} decisions, ${end.type} ${end.type === 'collapsed' ? `in ${end.year}` : ''}, final score ${minus(end.finalScore)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        } catch (err) {
          failures++;
          results.push(`  FAIL ${id} ${kind}: ${err.message}`);
        }
      }
    }
    // Every official game shows up on the shared leaderboard with the right score.
    const board = await (await fetch(`${BASE}/api/leaderboard?period=all`)).json();
    for (const c of created) {
      const row = board.entries.find((r) => r.name === c.name && r.period === c.period);
      if (!row || row.score !== c.score || row.outcome !== c.outcome) {
        failures++;
        results.push(`  FAIL leaderboard entry for ${c.name}: ${JSON.stringify(row)}`);
      }
    }
    if (!board.entries.some((r) => r.name.startsWith('Test Mughal') && r.empire === 'mughal')) failures++;
    const practiceSaved = board.entries.filter((r) => r.name === created[0]?.name);
    if (practiceSaved.length !== 1) {
      failures++;
      results.push('  FAIL the practice game was saved to the leaderboard');
    }
    results.push(`  ok  leaderboard has all ${created.length} first-attempt games, and the practice game was not saved`);
  } finally {
    await browser.close();
    // Remove test entries from a real deployment.
    const pw = process.env.TEACHER_PASSWORD || (server ? 'e2e-teacher' : null);
    if (pw) {
      const board = await (await fetch(`${BASE}/api/leaderboard?period=all`)).json();
      for (const r of [...board.entries, ...board.playing].filter((x) => x.name.endsWith(tag))) {
        await fetch(`${BASE}/api/teacher/delete`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-teacher-password': pw }, body: JSON.stringify({ id: r.id }) });
      }
    }
    if (server) server.kill();
    if (persistDir) rmSync(persistDir, { recursive: true, force: true });
  }
  console.log(results.join('\n'));
  if (failures) {
    console.log(`\nBROWSER PLAY-THROUGHS FAILED (${failures})`);
    process.exit(1);
  }
  console.log(`\nAll browser play-throughs passed (${created.length} games across ${rules.empireOrder.length} empires).`);
}

main().catch((err) => {
  console.error(err);
  if (server) server.kill();
  process.exit(1);
});
