// Class Battle, end to end: a full class of 24 students plays a whole battle
// against a running server. Four students use real browser pages (clicking
// seats and answers), twenty more connect like the student page does, and the
// projector page is driven by clicks. Checks every screen along the way.
//
//   node test/e2e/battle.mjs                        # starts a local server
//   BASE_URL=https://... TEACHER_PASSWORD=... node test/e2e/battle.mjs   # a deployed site
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../../scripts/lib/load-content.mjs';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire(path.join(process.execPath, '../../lib/node_modules/'))('playwright'));
}

let BASE = process.env.BASE_URL;
let PASSWORD = process.env.TEACHER_PASSWORD;
let server = null;
let persistDir = null;
const SHOTS = process.env.SHOTS; // a folder: save screenshots of every screen there
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name) {
  if (!SHOTS) return;
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}
const log = (m) => console.log(`  ${m}`);

async function startLocalServer() {
  persistDir = mkdtempSync(path.join(tmpdir(), 'rte-battle-'));
  const port = 8800 + Math.floor(Math.random() * 90);
  const mig = spawn('npx', ['wrangler', 'd1', 'migrations', 'apply', 'rule-the-empire', '--local', '--persist-to', persistDir], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => mig.on('exit', r));
  server = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir,
    '--var', 'TEACHER_PASSWORD:e2e-teacher', '--var', 'GAME_SECRET:e2e-secret'], { cwd: ROOT, stdio: 'ignore' });
  BASE = `http://127.0.0.1:${port}`;
  PASSWORD = 'e2e-teacher';
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('local server did not start');
}

// A student who connects the way join.html does and answers at random.
function bot(code, name, seat) {
  const wsUrl = `${BASE.replace(/^http/, 'ws')}/api/battle/ws?code=${code}`;
  const b = { name, state: null, pid: null, answered: new Set(), errors: [] };
  const open = () => new Promise((resolve) => {
    const ws = new WebSocket(b.pid ? `${wsUrl}&pid=${b.pid}` : wsUrl);
    b.ws = ws;
    ws.onopen = () => {
      if (!b.pid) ws.send(JSON.stringify({ t: 'join', name }));
      resolve();
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'joined') {
        b.pid = msg.pid;
        if (seat) ws.send(JSON.stringify({ t: 'seat', empire: seat[0], seat: seat[1] }));
      } else if (msg.t === 'error') b.errors.push(msg.message);
      else if (msg.t === 'state') {
        b.state = msg;
        if (msg.phase === 'round' && msg.decisions) {
          for (const d of msg.decisions) {
            const key = `${msg.round}/${d.role}`;
            if (d.chosen || b.answered.has(key)) continue;
            b.answered.add(key);
            const o = d.options[Math.floor(Math.random() * d.options.length)];
            setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'choose', round: msg.round, role: d.role, key: o.key })), 200 + Math.random() * 1500);
          }
        }
      }
    };
  });
  b.open = open;
  return b;
}

async function main() {
  if (!BASE) await startLocalServer();
  console.log(`Class Battle test on ${BASE}`);
  const proxy = process.env.HTTPS_PROXY && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE) ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy });
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !/WebSocket/.test(m.text()) && errors.push(`${label}: ${m.text()}`));
  };
  let code = null;
  try {
    // 1. The teacher opens a battle on the projector page.
    const hostCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const host = await hostCtx.newPage();
    watch(host, 'projector');
    await host.goto(`${BASE}/battle`);
    await host.waitForSelector('#pw');
    await shot(host, '01-projector-setup');
    await host.fill('#pw', PASSWORD);
    await host.click('#new-battle button[type=submit]');
    await host.waitForSelector('.join-code');
    code = (await host.textContent('.join-code')).trim();
    log(`ok  projector opened battle ${code}`);

    // 2. Four students join in real browsers and take seats.
    const seats = [['ottoman', 'ruler'], ['safavid', 'general'], ['mughal', 'vizier'], ['songhai', 'general']];
    const students = [];
    for (const [i, seat] of seats.entries()) {
      const ctx = await browser.newContext({ viewport: i % 2 ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      watch(page, `student ${i + 1}`);
      await page.goto(`${BASE}/join?code=${code}`);
      await page.waitForSelector('#name');
      if (i === 1) await shot(page, '02-phone-join');
      await page.fill('#name', ['Ava', 'Ben', 'Cleo', 'Dev'][i]);
      await page.click('#join-form button[type=submit]');
      await page.waitForSelector('.seat-grid');
      await page.click(`[data-seat="${seat[0]}:${seat[1]}"]`);
      await page.waitForSelector(`[data-seat="${seat[0]}:${seat[1]}"].mine`);
      if (i === 1) await shot(page, '03-phone-seats');
      students.push({ page, ctx, seat });
    }
    log('ok  4 browser students joined and took seats');

    // 3. Twenty more students connect; most pick a seat, a few let the teacher fill it.
    const names = ['Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Quin', 'Rosa', 'Sami', 'Tess', 'Uma', 'Vic', 'Wren', 'Yara'];
    const taken = new Set(seats.map((s) => s.join(':')));
    const order = ['mughal', 'mingqing', 'tokugawa', 'ottoman', 'russia', 'spain', 'safavid', 'songhai'];
    const free = order.flatMap((e) => ['ruler', 'general', 'vizier'].map((r) => [e, r])).filter((s) => !taken.has(s.join(':')));
    const bots = names.map((n, i) => bot(code, n, i < 16 ? free[i] : null));
    for (const b of bots) await b.open();
    await sleep(1500);
    const joinCount = (await host.textContent('.join-count')).trim();
    if (!joinCount.startsWith('24')) throw new Error(`projector shows "${joinCount}"`);
    log('ok  projector shows 24 students joined');
    await shot(host, '04-projector-lobby');

    // 4. Start; play four rounds. Browser students answer by clicking.
    await host.click('#start');
    for (let round = 1; round <= 4; round++) {
      await host.waitForSelector('[data-timer]');
      if (round === 1) {
        await shot(host, '05-projector-round');
        await students[1].page.waitForSelector('.choice[data-key]');
        await shot(students[1].page, '06-phone-decision');
        await students[0].page.waitForSelector('.choice[data-key]');
        await shot(students[0].page, '07-laptop-decision');
      }
      for (const s of students) {
        await s.page.waitForSelector('.choice[data-key]');
        const cards = await s.page.$$('.battle-event');
        for (const card of cards) {
          const btns = await card.$$('.choice[data-key]');
          await btns[Math.floor(Math.random() * btns.length)].click();
        }
        await s.page.waitForSelector('.choice.chosen');
      }
      // Everyone has answered, so the round ends a few seconds later on its own.
      await host.waitForSelector('#next', { timeout: 30000 });
      const clashCards = await host.$$('.clash-card');
      log(`ok  round ${round}: all 24 answered, results shown (${clashCards.length} ${clashCards.length === 1 ? 'clash' : 'clashes'})`);
      if (round === 1 || round === 4) await shot(host, `08-projector-results-${round}`);
      if (round === 1) {
        // The projector can show what really happened in a clash.
        await host.click('[data-scene]');
        await host.waitForSelector('.scene-modal .scene-ov');
        await sleep(SHOTS ? 6000 : 0);
        await shot(host, '09-projector-scene');
        await host.click('#close-scene');
      }
      for (const s of students) {
        await s.page.waitForSelector('.outcome .stamp');
        const text = await s.page.textContent('main');
        if (!text.includes('What actually happened')) throw new Error('student results missing the history');
      }
      if (round === 1) {
        await shot(students[1].page, '10-phone-results');
        await shot(students[0].page, '11-laptop-results');
      }
      await host.click('#next');
    }

    // 5. Final results on the projector and every student's screen.
    await host.waitForSelector('.podium-spot.p1');
    const mvps = await host.$$('.mvp');
    log(`ok  final results: podium and ${mvps.length} role champions on the projector`);
    await shot(host, '12-projector-final');
    for (const s of students) {
      await s.page.waitForSelector('.chronicle .fate');
      await s.page.waitForSelector('.reckoning .final b');
    }
    log('ok  every student sees their team rank and their own score');
    await shot(students[1].page, '13-phone-final');

    // 6. The results were saved for the teacher's Class Report.
    const list = await fetch(`${BASE}/api/teacher/battles`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-teacher-password': PASSWORD }, body: '{}' }).then((r) => r.json());
    const saved = list.battles.find((b) => b.code === code);
    if (!saved || saved.players.length !== 24) throw new Error(`saved results: ${JSON.stringify(saved && saved.players.length)}`);
    log(`ok  results saved: ${saved.teams.length} teams, ${saved.players.length} students`);
    // ...and they show in the Class Report after the teacher unlocks it.
    await host.click('.host-controls a[href="/#teacher"]');
    await host.waitForSelector('#teacher-password');
    await host.fill('#teacher-password', PASSWORD);
    await host.click('#teacher-form button[type=submit]');
    await host.waitForSelector(`.battle-row:has-text("${code}")`);
    await shot(host, '14-class-report');
    log('ok  the battle appears in the Class Report');
    if (process.env.BASE_URL) {
      await fetch(`${BASE}/api/teacher/battles/delete`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-teacher-password': PASSWORD }, body: JSON.stringify({ id: saved.id }) });
      log('ok  test results removed from the live site');
    }
    const botErrors = bots.flatMap((b) => b.errors);
    if (botErrors.length) throw new Error(`student errors: ${botErrors.join(' | ')}`);
    if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`);
    for (const b of bots) b.ws.close();
    console.log('\nClass Battle test passed (24 students, 4 rounds).');
  } finally {
    await browser.close();
    if (server) server.kill();
    if (persistDir) rmSync(persistDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nCLASS BATTLE TEST FAILED: ${err.stack || err.message}`);
  if (server) server.kill();
  process.exit(1);
});
