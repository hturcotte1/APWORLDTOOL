// HTTP API for the game and the leaderboard.
//
// The browser never decides the score. It sends the list of choices it made
// (as per-game option codes), and the server replays them with the engine.
// Official (first) attempts are also saved step by step on the server, so a
// student can't go back and try a different answer.
import { GameError, startState, applyChoice, visibleOptions, publicView, tierOf } from './engine.js';
import { checkName } from './names.js';
import { optionToken, randomId, safeEqual } from './tokens.js';
import * as store from './db.js';

const MAX_BODY = 10_000;
const FAILED_LOGIN_DELAY_MS = 500;

export function createApi({ empires, rules, glossary }) {
  const order = rules.empireOrder;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
  const secretOf = (env) => env.GAME_SECRET || 'local-development-secret';
  const parsePeriod = (p) => ([1, 2, 3].includes(Number(p)) ? Number(p) : null);

  function config(env) {
    return {
      empires: order.map((id) => {
        const e = empires[id];
        const t = tierOf(rules, e);
        return {
          id,
          name: e.name,
          tier: e.tier,
          tierLabel: t.label,
          tierReason: e.tierReason,
          summary: e.summary,
          color: e.color,
          emblem: e.emblem,
          capital: e.capital || null,
          startYear: e.startYear,
          endYear: e.endYear,
          intro: e.intro,
          glossary: e.glossary || [],
          pointsMin: t.pointsMin,
          pointsMax: t.pointsMax,
          stability: t.stability,
        };
      }),
      tiers: Object.fromEntries(Object.entries(rules.tiers).map(([k, t]) => [k, { label: t.label, blurb: t.blurb, pointsMin: t.pointsMin, pointsMax: t.pointsMax, stability: t.stability }])),
      collapsePenalty: rules.collapsePenalty.explain,
      glossary: glossary.terms,
      teacherEnabled: !!env.TEACHER_PASSWORD,
    };
  }

  // ---------- game helpers ----------
  async function matchToken(empire, secret, gameId, state, token) {
    for (const o of visibleOptions(empire.nodes[state.nodeId], state.flags)) {
      if ((await optionToken(secret, gameId, state.nodeId, o.id)) === token) return o.id;
    }
    return null;
  }

  async function replayTokens(empire, secret, gameId, tokens) {
    let state = startState(empire, rules);
    for (const t of tokens) {
      if (state.ending) throw new GameError('game_over', 'This game has already ended.');
      const id = await matchToken(empire, secret, gameId, state, t);
      if (!id) throw new GameError('bad_choice', 'That choice is not available. Please start a new game.');
      state = applyChoice(empire, rules, state, id);
    }
    return state;
  }

  async function tokensForIds(empire, secret, gameId, ids) {
    let state = startState(empire, rules);
    const out = [];
    for (const id of ids) {
      out.push(await optionToken(secret, gameId, state.nodeId, id));
      state = applyChoice(empire, rules, state, id);
    }
    return out;
  }

  async function respond(env, game, empire, state, choices, extra = {}) {
    const view = publicView(empire, rules, state);
    if (view.node) {
      const secret = secretOf(env);
      const options = await Promise.all(
        view.node.options.map(async (o) => ({ key: await optionToken(secret, game.id, view.node.id, o.id), text: o.text })),
      );
      // Sorting by the random-looking codes shuffles the answers differently in
      // every game, but keeps the same order if the page is reloaded.
      view.node.options = options.sort((a, b) => (a.key < b.key ? -1 : 1));
    }
    return json({ game: { ...game, empire: empire.id, recorded: !game.practice && !!state.ending }, choices, view, ...extra });
  }

  // ---------- routes ----------
  async function check(body, env) {
    const name = checkName(body.name);
    if (!name.ok) return fail(400, name.error);
    const period = parsePeriod(body.period);
    if (!period) return fail(400, 'Please pick your class period.');
    const existing = await store.findEntry(env.DB, name.key, period);
    return json({ name: name.name, period, practice: !!existing });
  }

  async function start(body, env) {
    const name = checkName(body.name);
    if (!name.ok) return fail(400, name.error);
    const period = parsePeriod(body.period);
    if (!period) return fail(400, 'Please pick your class period.');
    const empire = empires[String(body.empire)];
    if (!empire || !order.includes(empire.id)) return fail(400, 'Please pick an empire.');
    const token = randomId();
    const row = await store.createEntry(env.DB, { name: name.name, nameKey: name.key, period, empire: empire.id, token });
    const game = { id: token, name: name.name, period, practice: !row };
    return respond(env, game, empire, startState(empire, rules), []);
  }

  async function play(body, env) {
    const gameId = typeof body.gameId === 'string' ? body.gameId : '';
    const tokens = Array.isArray(body.choices) ? body.choices.map(String) : null;
    if (!gameId || gameId.length > 64 || !tokens || tokens.length > 30) return fail(400, 'Bad request.');
    const secret = secretOf(env);

    const row = await store.findByToken(env.DB, gameId);
    if (row) {
      const empire = empires[row.empire];
      if (!empire) return fail(409, 'This empire is no longer in the game. Please start a new game.');
      const game = { id: gameId, name: row.name, period: row.period, practice: false };
      let savedIds = JSON.parse(row.progress);
      let state = savedIds.reduce((s, id) => applyChoice(empire, rules, s, id), startState(empire, rules));
      const savedTokens = await tokensForIds(empire, secret, gameId, savedIds);
      const sameStart = savedTokens.every((t, i) => tokens[i] === t);

      if (sameStart && tokens.length === savedTokens.length + 1 && !state.ending) {
        const id = await matchToken(empire, secret, gameId, state, tokens[tokens.length - 1]);
        if (!id) return fail(400, 'That choice is not available.');
        const next = applyChoice(empire, rules, state, id);
        const ids = [...savedIds, id];
        const finished = next.ending ? { score: next.ending.finalScore, outcome: next.ending.type } : null;
        if (await store.saveProgress(env.DB, row.id, row.progress, JSON.stringify(ids), finished)) {
          return respond(env, game, empire, next, tokens);
        }
        // Another request got there first (double click or second tab): use what the server has.
        const fresh = await store.findByToken(env.DB, gameId);
        if (!fresh) return fail(409, 'This game was removed by your teacher. Please start a new game.');
        savedIds = JSON.parse(fresh.progress);
        state = savedIds.reduce((s, x) => applyChoice(empire, rules, s, x), startState(empire, rules));
        return respond(env, game, empire, state, await tokensForIds(empire, secret, gameId, savedIds), { resync: true });
      }
      const resync = !(sameStart && tokens.length === savedTokens.length);
      return respond(env, game, empire, state, savedTokens, resync ? { resync: true } : {});
    }

    // Practice run (or an official game the teacher has since deleted).
    const empire = empires[String(body.empire)];
    if (!empire || !order.includes(empire.id)) return fail(400, 'Unknown empire.');
    const state = await replayTokens(empire, secret, gameId, tokens);
    const notice = body.official === true ? 'removed' : undefined;
    return respond(env, { id: gameId, practice: true }, empire, state, tokens, notice ? { notice } : {});
  }

  async function leaderboard(url, env) {
    const p = url.searchParams.get('period') || 'all';
    const period = p === 'all' ? null : parsePeriod(p);
    if (p !== 'all' && !period) return fail(400, 'Unknown period.');
    const rows = await store.listEntries(env.DB, period);
    const decorate = (r) => {
      const e = empires[r.empire];
      return {
        id: r.id,
        name: r.name,
        period: r.period,
        empire: r.empire,
        empireName: e ? e.name : r.empire,
        tier: e ? e.tier : null,
        tierLabel: e ? rules.tiers[e.tier].label : '?',
        score: r.score,
        outcome: r.outcome,
      };
    };
    const done = rows.filter((r) => r.outcome !== 'playing').sort((a, b) => b.score - a.score || a.id - b.id);
    let rank = 0;
    let prev = null;
    const entries = done.map((r, i) => {
      if (r.score !== prev) {
        rank = i + 1;
        prev = r.score;
      }
      return { rank, ...decorate(r) };
    });
    return json({ period: period || 'all', entries, playing: rows.filter((r) => r.outcome === 'playing').map(decorate) });
  }

  async function teacherGuard(request, env) {
    if (!env.TEACHER_PASSWORD) return fail(503, 'Teacher controls are not set up yet (no password has been set).');
    const given = request.headers.get('x-teacher-password') || '';
    if (!given || !(await safeEqual(given, env.TEACHER_PASSWORD))) {
      await new Promise((r) => setTimeout(r, FAILED_LOGIN_DELAY_MS));
      return fail(401, 'That password is not correct.');
    }
    return null;
  }

  async function teacher(path, request, body, env) {
    const denied = await teacherGuard(request, env);
    if (denied) return denied;
    if (path === '/api/teacher/login') return json({ ok: true });
    if (path === '/api/teacher/delete') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return fail(400, 'Missing entry id.');
      return json({ ok: true, deleted: await store.deleteEntry(env.DB, id) });
    }
    if (path === '/api/teacher/clear') {
      const period = body.period === 'all' ? null : parsePeriod(body.period);
      if (body.period !== 'all' && !period) return fail(400, 'Pick a period (1, 2, 3) or "all".');
      return json({ ok: true, deleted: await store.clearEntries(env.DB, period) });
    }
    return fail(404, 'Not found.');
  }

  async function readBody(request) {
    if (!(request.headers.get('content-type') || '').includes('application/json')) throw new GameError('bad_request', 'Expected JSON.');
    const text = await request.text();
    if (text.length > MAX_BODY) throw new GameError('bad_request', 'Request too large.');
    try {
      const body = JSON.parse(text || '{}');
      return body && typeof body === 'object' ? body : {};
    } catch {
      throw new GameError('bad_request', 'Bad JSON.');
    }
  }

  return async function handle(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Every route is awaited inside this try, so errors become friendly JSON replies.
    try {
      if (request.method === 'GET') {
        if (path === '/api/config') return json(config(env));
        if (path === '/api/leaderboard') return await leaderboard(url, env);
        if (path === '/api/health') return json({ ok: true });
      } else if (request.method === 'POST') {
        const body = await readBody(request);
        if (path === '/api/check') return await check(body, env);
        if (path === '/api/start') return await start(body, env);
        if (path === '/api/play') return await play(body, env);
        if (path.startsWith('/api/teacher/')) return await teacher(path, request, body, env);
      }
      return fail(404, 'Not found.');
    } catch (err) {
      if (err instanceof GameError) return fail(400, err.message, { code: err.code });
      console.error(err);
      return fail(500, 'Something went wrong. Please try again.');
    }
  };
}
