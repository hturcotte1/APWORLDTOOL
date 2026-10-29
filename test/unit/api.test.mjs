import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../../src/api.js';
import { createTestDb } from '../helpers/d1.mjs';
import { content, plannedPaths } from '../helpers/content.mjs';
import { optionToken } from '../../src/tokens.js';
import { replay } from '../../src/engine.js';

const api = createApi(content);
const PASSWORD = 'correct horse battery staple';
let env;

beforeEach(() => {
  env = { DB: createTestDb(), TEACHER_PASSWORD: PASSWORD, GAME_SECRET: 'test-secret' };
});

async function call(method, path, body, headers = {}) {
  const res = await api(
    new Request(`https://game.test${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json() };
}
const teacher = (path, body, password = PASSWORD) => call('POST', path, body, { 'x-teacher-password': password });

// Plays a whole game through the API, following planned option ids.
async function playGame(name, period, empireId, ids) {
  const start = await call('POST', '/api/start', { name, period, empire: empireId });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const game = start.body.game;
  let res = start;
  let choices = [];
  for (const id of ids) {
    const nodeId = res.body.view.node.id;
    const key = await optionToken(env.GAME_SECRET, game.id, nodeId, id);
    assert.ok(res.body.view.node.options.some((o) => o.key === key), `option ${id} should be offered at ${nodeId}`);
    choices = [...choices, key];
    res = await call('POST', '/api/play', { gameId: game.id, empire: empireId, official: !game.practice, choices });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  return { start: start.body, end: res.body, choices };
}

test('first attempt counts; later attempts by the same name and period are practice', async () => {
  const e = content.empires.mughal;
  const { best } = plannedPaths(e);
  const first = await playGame('Maya', 2, 'mughal', best.choices);
  assert.equal(first.start.game.practice, false);
  assert.equal(first.end.game.recorded, true);
  assert.equal(first.end.view.ending.finalScore, best.state.ending.finalScore);

  // Same student, different capitalization and spacing -> practice.
  const check = await call('POST', '/api/check', { name: '  maya ', period: 2 });
  assert.equal(check.body.practice, true);
  const again = await playGame('  MAYA  ', 2, 'spain', plannedPaths(content.empires.spain).best.choices);
  assert.equal(again.start.game.practice, true);
  assert.equal(again.end.game.recorded, false);

  const board = await call('GET', '/api/leaderboard?period=2');
  assert.equal(board.body.entries.length, 1, 'practice runs are not saved');
  assert.equal(board.body.entries[0].empire, 'mughal');
  assert.equal(board.body.entries[0].score, best.state.ending.finalScore);

  // Same name in a different period is a different student.
  const other = await call('POST', '/api/check', { name: 'Maya', period: 3 });
  assert.equal(other.body.practice, false);
});

test('an unfinished first game blocks a second official game and shows as still playing', async () => {
  const s1 = await call('POST', '/api/start', { name: 'Leo', period: 1, empire: 'russia' });
  assert.equal(s1.body.game.practice, false);
  const s2 = await call('POST', '/api/start', { name: 'leo', period: 1, empire: 'ottoman' });
  assert.equal(s2.body.game.practice, true);
  const board = await call('GET', '/api/leaderboard?period=1');
  assert.equal(board.body.entries.length, 0);
  assert.equal(board.body.playing.length, 1);
  assert.equal(board.body.playing[0].name, 'Leo');
});

test('collapse paths score with the penalty and show as collapsed', async () => {
  const e = content.empires.safavid;
  const { collapse } = plannedPaths(e);
  const game = await playGame('Ana', 1, 'safavid', collapse.choices);
  const end = game.end.view.ending;
  assert.equal(end.type, 'collapsed');
  assert.equal(end.finalScore, collapse.state.ending.finalScore);
  const board = await call('GET', '/api/leaderboard?period=1');
  assert.equal(board.body.entries[0].outcome, 'collapsed');
  assert.equal(board.body.entries[0].score, end.finalScore);
});

test('the server ignores attempts to change earlier answers of an official game', async () => {
  const start = await call('POST', '/api/start', { name: 'Kai', period: 3, empire: 'ottoman' });
  const gameId = start.body.game.id;
  const keyA = await optionToken(env.GAME_SECRET, gameId, 'constantinople', 'c');
  const r1 = await call('POST', '/api/play', { gameId, empire: 'ottoman', official: true, choices: [keyA] });
  assert.equal(r1.body.view.lastResult.points, -1);
  // Try to swap the first answer for the best one.
  const keyBest = await optionToken(env.GAME_SECRET, gameId, 'constantinople', 'a');
  const r2 = await call('POST', '/api/play', { gameId, empire: 'ottoman', official: true, choices: [keyBest] });
  assert.equal(r2.body.resync, true);
  assert.deepEqual(r2.body.choices, [keyA]);
  assert.equal(r2.body.view.points, -1);
  // Sending the same choices again is harmless (safe to retry after a network error).
  const r3 = await call('POST', '/api/play', { gameId, empire: 'ottoman', official: true, choices: [keyA] });
  assert.equal(r3.body.resync, undefined);
  assert.equal(r3.body.view.points, -1);
});

test('made-up option codes are rejected', async () => {
  const start = await call('POST', '/api/start', { name: 'Zoe', period: 1, empire: 'spain' });
  const bad = await call('POST', '/api/play', { gameId: 'not-a-real-game', empire: 'spain', choices: ['abc'] });
  assert.equal(bad.status, 400);
  const official = await call('POST', '/api/play', { gameId: start.body.game.id, empire: 'spain', official: true, choices: ['abc'] });
  assert.equal(official.status, 400);
  const resume = await call('POST', '/api/play', { gameId: start.body.game.id, empire: 'spain', official: true, choices: [] });
  assert.equal(resume.body.view.decision, 1, 'nothing was saved');
  assert.equal(resume.body.view.points, 0);
});

test('option codes differ between games, so answers cannot be copied by position or code', async () => {
  const a = await call('POST', '/api/start', { name: 'Ava', period: 1, empire: 'tokugawa' });
  const b = await call('POST', '/api/start', { name: 'Ben', period: 1, empire: 'tokugawa' });
  const keysA = a.body.view.node.options.map((o) => o.key);
  const keysB = b.body.view.node.options.map((o) => o.key);
  assert.equal(keysA.filter((k) => keysB.includes(k)).length, 0);
  assert.ok(!JSON.stringify(a.body.view.node.options).includes('"a"'));
});

test('leaderboard filters by period and ranks ties together', async () => {
  const ids = (empire) => plannedPaths(content.empires[empire]).best.choices;
  await playGame('Ann', 1, 'mughal', ids('mughal'));
  await playGame('Bob', 1, 'tokugawa', ids('tokugawa'));
  await playGame('Cy', 2, 'spain', ids('spain'));
  await playGame('Di', 3, 'russia', ids('russia'));
  const p1 = await call('GET', '/api/leaderboard?period=1');
  assert.deepEqual(p1.body.entries.map((r) => r.name), ['Ann', 'Bob']);
  assert.deepEqual(p1.body.entries.map((r) => r.rank), [1, 1], 'equal scores share a rank');
  const p2 = await call('GET', '/api/leaderboard?period=2');
  assert.deepEqual(p2.body.entries.map((r) => r.name), ['Cy']);
  const all = await call('GET', '/api/leaderboard?period=all');
  assert.deepEqual(all.body.entries.map((r) => r.name), ['Cy', 'Di', 'Ann', 'Bob']);
  assert.deepEqual(all.body.entries.map((r) => r.rank), [1, 2, 3, 3]);
  assert.equal(all.body.entries[0].tier, 'hard');
  assert.equal(all.body.entries[0].tierLabel, 'Hard');
  const bad = await call('GET', '/api/leaderboard?period=7');
  assert.equal(bad.status, 400);
});

test('teacher password is checked on the server', async () => {
  assert.equal((await call('POST', '/api/teacher/login', {})).status, 401, 'no password');
  assert.equal((await teacher('/api/teacher/login', {}, 'wrong')).status, 401, 'wrong password');
  assert.equal((await teacher('/api/teacher/login', {}, PASSWORD.toUpperCase())).status, 401, 'case matters');
  assert.equal((await teacher('/api/teacher/login', {})).status, 200, 'right password');
  const noPassword = { ...env, TEACHER_PASSWORD: undefined };
  const res = await api(new Request('https://game.test/api/teacher/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-teacher-password': 'x' }, body: '{}' }), noPassword);
  assert.equal(res.status, 503, 'teacher controls stay locked until a password is set');
  const config = await call('GET', '/api/config');
  assert.ok(!JSON.stringify(config.body).includes(PASSWORD), 'password is never sent to the browser');
});

test('teacher can delete one entry, clear one period, or clear everything', async () => {
  const ids = plannedPaths(content.empires.mughal).best.choices;
  await playGame('Ann', 1, 'mughal', ids);
  await playGame('Bob', 1, 'mughal', ids);
  await playGame('Cy', 2, 'mughal', ids);
  await playGame('Di', 3, 'mughal', ids);

  // Wrong password changes nothing.
  assert.equal((await teacher('/api/teacher/clear', { period: 'all' }, 'nope')).status, 401);
  assert.equal((await call('GET', '/api/leaderboard')).body.entries.length, 4);

  const bob = (await call('GET', '/api/leaderboard?period=1')).body.entries.find((r) => r.name === 'Bob');
  assert.equal((await teacher('/api/teacher/delete', { id: bob.id })).body.deleted, 1);
  assert.deepEqual((await call('GET', '/api/leaderboard?period=1')).body.entries.map((r) => r.name), ['Ann']);

  // A deleted student can play again officially.
  assert.equal((await call('POST', '/api/check', { name: 'bob', period: 1 })).body.practice, false);

  assert.equal((await teacher('/api/teacher/clear', { period: 1 })).body.deleted, 1);
  assert.deepEqual((await call('GET', '/api/leaderboard')).body.entries.map((r) => r.name).sort(), ['Cy', 'Di']);

  assert.equal((await teacher('/api/teacher/clear', { period: 'all' })).body.deleted, 2);
  assert.equal((await call('GET', '/api/leaderboard')).body.entries.length, 0);
  assert.equal((await teacher('/api/teacher/clear', { period: 9 })).status, 400);
});

test('a game deleted by the teacher continues as practice', async () => {
  const start = await call('POST', '/api/start', { name: 'Eve', period: 2, empire: 'ottoman' });
  const gameId = start.body.game.id;
  const row = (await call('GET', '/api/leaderboard?period=2')).body.playing[0];
  await teacher('/api/teacher/delete', { id: row.id });
  const key = await optionToken(env.GAME_SECRET, gameId, 'constantinople', 'a');
  const res = await call('POST', '/api/play', { gameId, empire: 'ottoman', official: true, choices: [key] });
  assert.equal(res.status, 200);
  assert.equal(res.body.notice, 'removed');
  assert.equal(res.body.game.practice, true);
});

test('bad names and periods are refused, and only first name, period, empire, score, outcome are stored', async () => {
  const rot = (w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
  assert.equal((await call('POST', '/api/start', { name: rot('nff'), period: 1, empire: 'mughal' })).status, 400);
  assert.equal((await call('POST', '/api/start', { name: 'Maya', period: 4, empire: 'mughal' })).status, 400);
  assert.equal((await call('POST', '/api/start', { name: 'Maya', period: 1, empire: 'atlantis' })).status, 400);
  await call('POST', '/api/start', { name: 'Maya', period: 1, empire: 'mughal' });
  const columns = env.DB.raw.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'name', 'name_key', 'period', 'empire', 'score', 'outcome', 'token', 'progress']);
});

test('requests must be JSON', async () => {
  const res = await api(new Request('https://game.test/api/start', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'name=Maya' }), env);
  assert.equal(res.status, 400);
});

test('server replay matches the engine for every empire (best path and a collapse path)', async () => {
  let n = 0;
  for (const id of content.rules.empireOrder) {
    const e = content.empires[id];
    const { best, collapse } = plannedPaths(e);
    for (const p of [best, collapse]) {
      const g = await playGame(`Player${String.fromCharCode(65 + n++)}`, 1, id, p.choices);
      const expected = replay(e, content.rules, p.choices).ending;
      assert.equal(g.end.view.ending.type, expected.type, id);
      assert.equal(g.end.view.ending.finalScore, expected.finalScore, id);
      assert.equal(g.end.view.ending.timeline.length, e.timeline.length);
      assert.equal(g.end.view.ending.recap.length, p.choices.length);
    }
  }
});
