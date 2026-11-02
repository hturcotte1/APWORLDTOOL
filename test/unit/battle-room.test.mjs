// The live Class Battle room (seats, rounds, timer, views), driven directly
// with a fake clock and storage, on a small made-up battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../../src/battle.js';
import { RoomCore } from '../../src/battle-room-core.js';

const opt = (id, points, extra = {}) => ({ id, text: `Option ${id}`, points, explanation: `What happened after ${id}.`, ...extra });
const plain = (title, extra = {}) => ({ year: 1500, title, text: `${title}.`, options: [opt('a', 5, extra.a), opt('b', 2, extra.b), opt('c', 0, extra.c)] });

function battle() {
  const soloRules = {
    empireOrder: ['alpha', 'beta'],
    tiers: { easy: { label: 'Easy', pointsMin: 0, pointsMax: 5 }, hard: { label: 'Hard', pointsMin: -3, pointsMax: 8 } },
    collapsePenalty: { fraction: 0.5, minimum: 10 },
  };
  const empires = { alpha: { name: 'Alpha', tier: 'easy' }, beta: { name: 'Beta', tier: 'hard' } };
  const battleRules = {
    rounds: 2, stability: { easy: 3, hard: 1 }, clashPrepPower: 1, exileFactor: 0.5, maxPlayers: 40,
    timer: { default: 180, choices: [120, 180, 240, 300], addSeconds: 60 },
  };
  const clashes = { sharedRegions: [], clashes: {} };
  const campaign = (stab) => ({
    regions: [{ id: 'core', start: true }],
    rounds: [
      { ruler: plain('R1 ruler', { c: { stability: stab } }), general: plain('R1 general'), vizier: plain('R1 vizier') },
      { ruler: plain('R2 ruler'), general: plain('R2 general'), vizier: plain('R2 vizier') },
    ],
  });
  return makeBattle({ soloRules, empires, battleRules, campaigns: { alpha: campaign(-1), beta: campaign(-1) }, clashes });
}

function room() {
  let t = 1_000_000;
  const data = new Map();
  const alarms = { at: null, set(ms) { this.at = ms; }, clear() { this.at = null; } };
  const saved = [];
  const core = new RoomCore({
    battle: battle(),
    store: { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => data.set(k, structuredClone(v)), deleteAll: async () => data.clear() },
    now: () => t,
    alarms,
    saveResults: async (r) => saved.push(r),
  });
  return { core, alarms, saved, tick: (ms) => { t += ms; }, data };
}

const params = (o) => new URLSearchParams(o);
async function join(core, name, online = new Set()) {
  const res = await core.handle({ as: 'player', pid: null }, { t: 'join', name }, online);
  return res.conn;
}
async function choose(core, conn, role, which = 0) {
  const v = await core.viewFor(conn);
  const d = v.decisions.find((x) => x.role === role);
  // Pick by text so the test knows which option it chose (keys are shuffled codes).
  const o = d.options.find((x) => x.text === `Option ${'abc'[which]}`);
  return core.handle(conn, { t: 'choose', round: v.round, role, key: o.key });
}

test('the host key opens the host screen; anything else is refused', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 2, timer: 120, hostKey: 'secret-host' });
  assert.deepEqual(await core.authorize(params({ host: 'secret-host' })), { as: 'host' });
  await assert.rejects(core.authorize(params({ host: 'wrong' })), /not the host/);
  assert.deepEqual(await core.authorize(params({})), { as: 'player', pid: null });
  await assert.rejects(core.init({ code: 'ABCD', period: 1, hostKey: 'x' }), /already in use/);
});

test('joining: names are checked and must be unique in the battle', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  const maya = await join(core, 'maya');
  assert.equal(core.s.players[maya.pid].name, 'Maya');
  await assert.rejects(join(core, '  MAYA ', new Set([maya.pid])), /already has that name/);
  // Maya's screen is gone (a dead Chromebook): the same name on another device gets her seat back.
  assert.deepEqual(await join(core, 'Maya'), maya);
  assert.equal(Object.keys(core.s.players).length, 1);
  await assert.rejects(join(core, 'x1'), /letters/);
  assert.deepEqual(await core.authorize(params({ pid: maya.pid })), maya); // returning on a refresh
});

test('seats: one student per role seat; advisers up to two', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  const a = await join(core, 'Ana');
  const b = await join(core, 'Ben');
  await core.handle(a, { t: 'seat', empire: 'alpha', seat: 'ruler' });
  await assert.rejects(core.handle(b, { t: 'seat', empire: 'alpha', seat: 'ruler' }), /already took/);
  await core.handle(b, { t: 'seat', empire: 'alpha', seat: 'adviser' });
  await assert.rejects(core.handle(b, { t: 'seat', empire: 'nowhere', seat: 'ruler' }), /does not exist/);
  const v = await core.viewFor({ as: 'host' });
  assert.equal(v.seats.find((s) => s.id === 'alpha').seats.ruler.name, 'Ana');
});

test('start: empty seats are filled; a team of one holds every role; a fourth member advises', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  const solo = await join(core, 'Solo');
  await core.handle(solo, { t: 'seat', empire: 'beta', seat: 'general' });
  const four = [];
  for (const n of ['Ana', 'Ben', 'Cy', 'Dee']) four.push(await join(core, n));
  for (const [i, seat] of ['ruler', 'general', 'vizier', 'adviser'].entries()) await core.handle(four[i], { t: 'seat', empire: 'alpha', seat });
  await core.handle({ as: 'host' }, { t: 'start' });
  assert.equal(core.s.phase, 'round');
  assert.deepEqual(Object.values(core.s.teams.beta.roles), [solo.pid, solo.pid, solo.pid]);
  assert.deepEqual(core.s.teams.alpha.advisers, [four[3].pid]);
  const soloView = await core.viewFor(solo);
  assert.deepEqual(soloView.decisions.map((d) => d.role), ['ruler', 'general', 'vizier']);
  const dee = await core.viewFor(four[3]);
  assert.equal(dee.decisions.length, 1);
  assert.equal(dee.decisions[0].adviser, true);
});

test('autofill spreads unseated students across empires', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  for (const n of ['Ana', 'Ben', 'Cy', 'Dee']) await join(core, n);
  await core.handle({ as: 'host' }, { t: 'autofill' });
  const by = (e) => Object.values(core.s.players).filter((p) => p.empire === e).length;
  assert.equal(by('alpha'), 2);
  assert.equal(by('beta'), 2);
});

test('rounds: only your own decision with valid codes; the round ends early once everyone answers', async () => {
  const { core, tick, alarms } = room();
  await core.init({ code: 'ABCD', period: 1, timer: 120, hostKey: 'h' });
  const a = await join(core, 'Ana');
  const b = await join(core, 'Ben');
  await core.handle(a, { t: 'seat', empire: 'alpha', seat: 'ruler' });
  await core.handle(b, { t: 'seat', empire: 'alpha', seat: 'general' });
  await core.handle({ as: 'host' }, { t: 'start' });
  const deadline = core.s.deadline;
  assert.equal(alarms.at, deadline);
  const view = await core.viewFor(a);
  assert.deepEqual(view.decisions.map((d) => d.role), ['ruler', 'vizier']); // Ana covers the empty Vizier seat
  assert.ok(view.decisions.every((d) => d.options.every((o) => !('points' in o) && !('id' in o))), 'no points or ids are sent');
  await assert.rejects(core.handle(a, { t: 'choose', round: 1, role: 'general', key: 'x' }), /not your decision/);
  await assert.rejects(core.handle(a, { t: 'choose', round: 1, role: 'ruler', key: 'made-up' }), /not available/);
  await choose(core, a, 'ruler', 0);
  await choose(core, a, 'vizier', 1);
  assert.equal(core.s.deadline, deadline);
  await choose(core, b, 'general', 2);
  assert.ok(core.s.deadline < deadline, 'deadline moves up once all are in');
  tick(5000);
  await core.alarm();
  assert.equal(core.s.phase, 'results');
  assert.equal(core.s.scores[a.pid], 5 + 2);
  assert.equal(core.s.scores[b.pid], 0);
  const res = await core.viewFor(a);
  assert.equal(res.results.items.length, 2);
  assert.equal(res.results.items.find((i) => i.role === 'vizier').best.text, 'Option a');
});

test('the timer runs out: unanswered decisions score nothing; pause and add time work', async () => {
  const { core, tick } = room();
  await core.init({ code: 'ABCD', period: 1, timer: 120, hostKey: 'h' });
  const a = await join(core, 'Ana');
  await core.handle({ as: 'host' }, { t: 'start' });
  await core.handle({ as: 'host' }, { t: 'pause' });
  tick(500_000);
  await core.alarm();
  assert.equal(core.s.phase, 'round', 'paused rounds do not end');
  await core.handle({ as: 'host' }, { t: 'resume' });
  await core.handle({ as: 'host' }, { t: 'addTime' });
  assert.equal(core.s.deadline - (1_000_000 + 500_000), 180_000, '120 seconds left plus 60 added');
  tick(181_000);
  await core.alarm();
  assert.equal(core.s.phase, 'results');
  assert.equal(core.s.scores[a.pid], 0);
  assert.ok(core.s.game.teams.alpha.history.every((h) => h.missed));
});

test('advisers earn points for advice; exiles earn half; final results are saved', async () => {
  const { core, tick, saved } = room();
  await core.init({ code: 'ABCD', period: 3, hostKey: 'h' });
  const r = await join(core, 'Ruth');
  const adv = await join(core, 'Abe');
  await core.handle(r, { t: 'seat', empire: 'beta', seat: 'ruler' });
  await core.handle(adv, { t: 'seat', empire: 'beta', seat: 'adviser' });
  await core.handle({ as: 'host' }, { t: 'start' });
  await choose(core, r, 'ruler', 2); // stability -1: Beta (hard, stability 1) falls
  await choose(core, r, 'general', 0);
  await choose(core, r, 'vizier', 0);
  await choose(core, adv, 'ruler', 0); // advice on the Ruler's decision in round 1
  tick(5000);
  await core.alarm();
  assert.equal(core.s.game.teams.beta.collapsed, true);
  assert.equal(core.s.scores[r.pid], 0 + 5 + 5);
  assert.equal(core.s.scores[adv.pid], 5);
  await core.handle({ as: 'host' }, { t: 'next' });
  await choose(core, r, 'ruler', 0);
  await choose(core, r, 'general', 0);
  await choose(core, r, 'vizier', 1);
  await choose(core, adv, 'general', 0); // round 2: advice rotates to the General
  tick(5000);
  await core.alarm();
  assert.equal(core.s.scores[r.pid], 10 + 2 + 2 + 1, 'exiles earn half (rounded toward zero)');
  assert.equal(core.s.scores[adv.pid], 5 + 2);
  await core.handle({ as: 'host' }, { t: 'next' });
  assert.equal(core.s.phase, 'final');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].period, 3);
  assert.equal(saved[0].teams[0].collapsed, true);
  assert.deepEqual(saved[0].players.map((p) => p.name), ['Ruth', 'Abe']);
  const fin = await core.viewFor(r);
  assert.equal(fin.final.you.rank, 1);
  const finAbe = await core.viewFor(adv);
  assert.equal(finAbe.final.you.rank, 2, 'each student sees their own rank');
});

test('a late joiner takes over a role a teammate was covering; a kicked student hands roles back', async () => {
  const { core } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  const a = await join(core, 'Ana');
  await core.handle(a, { t: 'seat', empire: 'alpha', seat: 'ruler' });
  await core.handle({ as: 'host' }, { t: 'start' });
  const late = await join(core, 'Lee');
  const team = core.s.teams.alpha;
  assert.equal(team.roles.ruler, a.pid);
  assert.ok(Object.values(team.roles).includes(late.pid));
  await core.handle({ as: 'host' }, { t: 'kick', pid: late.pid });
  assert.deepEqual(Object.values(core.s.teams.alpha.roles), [a.pid, a.pid, a.pid]);
  const kicked = await core.viewFor(late);
  assert.equal(kicked.you, null);
  assert.equal(kicked.kicked, true);
});

test('rooms clean themselves up', async () => {
  const { core, tick, data } = room();
  await core.init({ code: 'ABCD', period: 1, hostKey: 'h' });
  tick(13 * 60 * 60 * 1000);
  await core.alarm();
  assert.equal(data.size, 0);
  assert.equal(core.exists, false);
});
