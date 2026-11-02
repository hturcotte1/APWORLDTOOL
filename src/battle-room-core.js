// One live Class Battle: seats, roles, rounds, the timer, and what each screen
// is allowed to see. The Cloudflare Durable Object (battle-room.js) wraps this;
// it has no Cloudflare imports so the tests can drive it directly.
//
// Phases: lobby (students take seats) -> round (everyone decides, with a timer)
// -> results (the projector shows what happened) -> next round ... -> final.
import { newGame, resolveRound, decisionView, describe, teamResult, slotFor, ROLES, AI } from './battle.js';
import { visibleOptions } from './engine.js';
import { checkName } from './names.js';
import { optionToken, randomId } from './tokens.js';

const ALL_IN_DELAY_MS = 4000; // once everyone has answered, reveal shortly after
const CLEANUP_AFTER_MS = 12 * 60 * 60 * 1000; // rooms are deleted 12 hours after they open
const SEATS = [...ROLES, 'adviser'];

async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class RoomError extends Error {}

export class RoomCore {
  // store: { get(key), put(key, value), deleteAll() }; alarms: { set(ms), clear() }
  constructor({ battle, store, now = () => Date.now(), alarms, saveResults }) {
    this.battle = battle;
    this.store = store;
    this.now = now;
    this.alarms = alarms;
    this.saveResults = saveResults;
    this.s = null;
  }

  async load() {
    this.s = (await this.store.get('state')) || null;
  }

  async save() {
    await this.store.put('state', this.s);
    const next = [this.s.phase === 'round' && !this.s.remaining ? this.s.deadline : null, this.s.cleanupAt].filter(Boolean);
    if (next.length) await this.alarms.set(Math.min(...next));
    else await this.alarms.clear();
  }

  get exists() {
    return !!this.s && this.now() < this.s.cleanupAt;
  }

  // ---------- setup ----------
  async init({ code, period, timer, hostKey }) {
    if (this.exists) throw new RoomError('That code is already in use.');
    const choices = this.battle.rules.timer.choices;
    this.s = {
      code,
      period,
      createdAt: this.now(),
      cleanupAt: this.now() + CLEANUP_AFTER_MS,
      hostHash: await sha256hex(hostKey),
      secret: randomId(18),
      phase: 'lobby',
      round: 0,
      timer: choices.includes(timer) ? timer : this.battle.rules.timer.default,
      deadline: null,
      remaining: null,
      players: {},
      teams: null,
      game: null,
      picks: {},
      advice: {},
      scores: {},
      log: {}, // pid -> [{ round, role, points, adviser }]
      final: null,
    };
    await this.save();
  }

  // Who is connecting: the host (with the host key) or a player (maybe returning).
  async authorize(params) {
    if (!this.exists) throw new RoomError('No battle with that code. Check the code on the board.');
    const host = params.get('host');
    if (host) {
      if ((await sha256hex(host)) !== this.s.hostHash) throw new RoomError('This screen is not the host of that battle.');
      return { as: 'host' };
    }
    const pid = params.get('pid');
    if (pid && this.s.players[pid] && !this.s.players[pid].kicked) return { as: 'player', pid };
    return { as: 'player', pid: null };
  }

  // ---------- messages ----------
  // Returns { conn } when the connection's identity changed (a player joined).
  // `online` is the set of players with a screen connected right now.
  async handle(conn, msg, online = new Set()) {
    if (!this.exists) throw new RoomError('This battle has ended.');
    const t = msg && msg.t;
    if (conn.as === 'host') return this.hostAction(t, msg);
    if (t === 'join') return this.join(conn, msg, online);
    const p = conn.pid && this.s.players[conn.pid];
    if (!p || p.kicked) throw new RoomError('Please join the battle first.');
    if (t === 'seat') return this.takeSeat(p, msg.empire, msg.seat);
    if (t === 'unseat') return this.takeSeat(p, null, null);
    if (t === 'choose') return this.choose(p, msg);
    throw new RoomError('Unknown action.');
  }

  async join(conn, msg, online) {
    if (conn.pid && this.s.players[conn.pid]) return {};
    const name = checkName(msg.name);
    if (!name.ok) throw new RoomError(name.error);
    const same = Object.values(this.s.players).find((p) => !p.kicked && p.key === name.key);
    if (same) {
      // A student whose device died can type the same name on another one and get their seat back.
      if (!online.has(same.pid)) return { conn: { as: 'player', pid: same.pid } };
      throw new RoomError('Someone in this battle already has that name. Add your last initial (for example, "Maya R").');
    }
    if (Object.values(this.s.players).filter((p) => !p.kicked).length >= this.battle.rules.maxPlayers) throw new RoomError('This battle is full.');
    const pid = randomId(12);
    this.s.players[pid] = { pid, name: name.name, key: name.key, empire: null, seat: null, joinedAt: this.now(), kicked: false };
    this.s.scores[pid] = 0;
    this.s.log[pid] = [];
    if (this.s.phase !== 'lobby' && this.s.phase !== 'final') this.placeLateJoiner(this.s.players[pid]);
    await this.save();
    return { conn: { as: 'player', pid } };
  }

  async takeSeat(p, empire, seat) {
    if (this.s.phase !== 'lobby') throw new RoomError('Seats are set once the battle starts.');
    if (empire == null) {
      p.empire = null;
      p.seat = null;
    } else {
      if (!this.battle.order.includes(empire) || !SEATS.includes(seat)) throw new RoomError('That seat does not exist.');
      if (seat !== 'adviser' && this.seated(empire, seat).some((x) => x.pid !== p.pid)) throw new RoomError('Someone already took that seat.');
      if (seat === 'adviser' && this.seated(empire, 'adviser').length >= 2) throw new RoomError('That empire already has two advisers.');
      p.empire = empire;
      p.seat = seat;
    }
    await this.save();
    return {};
  }

  seated(empire, seat) {
    return Object.values(this.s.players).filter((p) => !p.kicked && p.empire === empire && (!seat || p.seat === seat));
  }

  async hostAction(t, msg) {
    const s = this.s;
    if (t === 'autofill') { if (s.phase !== 'lobby') throw new RoomError('The battle has started.'); this.autofill(); }
    else if (t === 'kick') this.kick(msg.pid);
    else if (t === 'timer') { if (this.battle.rules.timer.choices.includes(msg.seconds)) s.timer = msg.seconds; }
    else if (t === 'start') await this.start();
    else if (t === 'pause') { if (s.phase === 'round' && !s.remaining) { s.remaining = Math.max(1000, s.deadline - this.now()); } }
    else if (t === 'resume') { if (s.phase === 'round' && s.remaining) { s.deadline = this.now() + s.remaining; s.remaining = null; } }
    else if (t === 'addTime') { if (s.phase === 'round') { if (s.remaining) s.remaining += this.battle.rules.timer.addSeconds * 1000; else s.deadline += this.battle.rules.timer.addSeconds * 1000; } }
    else if (t === 'reveal') { if (s.phase === 'round') await this.resolve(); }
    else if (t === 'next') await this.next();
    else if (t === 'end') { if (s.phase === 'round') await this.resolve(); if (s.phase === 'results') await this.finish(); }
    else throw new RoomError('Unknown action.');
    await this.save();
    return {};
  }

  // Seats everyone who hasn't picked one: the emptiest empire first, an open role, else adviser.
  autofill() {
    const players = Object.values(this.s.players).filter((p) => !p.kicked).sort((a, b) => a.joinedAt - b.joinedAt);
    for (const p of players.filter((x) => !x.empire)) {
      const counts = this.battle.order.map((id) => ({ id, n: this.seated(id).length }));
      counts.sort((a, b) => a.n - b.n || this.battle.order.indexOf(a.id) - this.battle.order.indexOf(b.id));
      const empire = counts[0].id;
      const open = ROLES.find((r) => !this.seated(empire, r).length);
      p.empire = empire;
      p.seat = open || 'adviser';
    }
  }

  kick(pid) {
    const p = this.s.players[pid];
    if (!p) return;
    p.kicked = true;
    if (this.s.teams && p.empire) this.reassign(p.empire);
  }

  // ---------- the battle ----------
  async start() {
    const s = this.s;
    if (s.phase !== 'lobby') return;
    this.autofill();
    const playing = this.battle.order.filter((id) => this.seated(id).length);
    if (!playing.length) throw new RoomError('Nobody has joined yet.');
    s.teams = {};
    for (const id of playing) {
      s.teams[id] = { roles: {}, advisers: [] };
      this.reassign(id);
    }
    s.game = newGame(this.battle, playing);
    this.beginRound();
  }

  // Gives every role of a team to someone: the seat holder, else a teammate.
  reassign(empire) {
    const team = this.s.teams[empire];
    const members = this.seated(empire).sort((a, b) => a.joinedAt - b.joinedAt);
    const holders = {};
    for (const r of ROLES) holders[r] = members.find((p) => p.seat === r)?.pid || null;
    const pool = members.filter((p) => p.seat !== 'adviser');
    const fallback = pool.length ? pool : members;
    for (const r of ROLES) {
      if (holders[r]) continue;
      // Empty role: the teammate with the fewest roles covers it.
      const load = (pid) => Object.values(holders).filter((x) => x === pid).length;
      const pick = [...fallback].sort((a, b) => load(a.pid) - load(b.pid) || a.joinedAt - b.joinedAt)[0];
      holders[r] = pick ? pick.pid : null;
    }
    team.roles = holders;
    team.advisers = members.filter((p) => p.seat === 'adviser' && !Object.values(holders).includes(p.pid)).map((p) => p.pid);
  }

  // A student who joins after the start: the team with the fewest members.
  placeLateJoiner(p) {
    const ids = Object.keys(this.s.teams || {});
    if (!ids.length) return;
    ids.sort((a, b) => this.seated(a).length - this.seated(b).length);
    const empire = ids[0];
    const team = this.s.teams[empire];
    // Take over a role that a teammate was covering in addition to their own seat.
    const covered = ROLES.find((r) => !team.roles[r] || this.s.players[team.roles[r]]?.seat !== r);
    p.empire = empire;
    p.seat = covered || 'adviser';
    this.reassign(empire);
  }

  beginRound() {
    const s = this.s;
    s.round += 1;
    s.phase = 'round';
    s.picks = Object.fromEntries(Object.keys(s.teams).map((id) => [id, { ruler: null, general: null, vizier: null }]));
    s.advice = {};
    s.deadline = this.now() + s.timer * 1000;
    s.remaining = null;
  }

  adviserRole(empire, pid, round) {
    const idx = this.s.teams[empire].advisers.indexOf(pid);
    return idx < 0 ? null : ROLES[(round - 1 + idx) % ROLES.length];
  }

  // The option ids a player may answer with now, as per-battle codes.
  async keysFor(empire, round, role) {
    const team = this.s.game.teams[empire];
    const s = slotFor(this.battle, empire, round, role);
    const opts = visibleOptions(s.node, team.flags);
    const keyed = await Promise.all(opts.map(async (o) => ({ id: o.id, key: await optionToken(this.s.secret, `${empire}/${round}/${role}`, o.id) })));
    return keyed;
  }

  async choose(p, msg) {
    const s = this.s;
    if (s.phase !== 'round' || msg.round !== s.round) throw new RoomError('This round is already over.');
    const team = s.teams[p.empire];
    if (!team) throw new RoomError('You are not on a team.');
    const role = msg.role;
    const adviser = team.advisers.includes(p.pid);
    if (adviser) {
      if (role !== this.adviserRole(p.empire, p.pid, s.round)) throw new RoomError('That is not your decision this round.');
    } else if (!ROLES.includes(role) || team.roles[role] !== p.pid) throw new RoomError('That is not your decision.');
    const keyed = await this.keysFor(p.empire, s.round, role);
    const hit = keyed.find((k) => k.key === msg.key);
    if (!hit) throw new RoomError('That choice is not available.');
    if (adviser) s.advice[p.pid] = hit.id;
    else s.picks[p.empire][role] = hit.id;
    if (this.allAnswered()) s.deadline = Math.min(s.deadline, this.now() + ALL_IN_DELAY_MS);
    await this.save();
    return {};
  }

  allAnswered() {
    const s = this.s;
    for (const [id, team] of Object.entries(s.teams)) {
      for (const r of ROLES) if (team.roles[r] && this.active(team.roles[r]) && s.picks[id][r] == null) return false;
    }
    return true;
  }

  active(pid) {
    const p = this.s.players[pid];
    return !!p && !p.kicked;
  }

  async alarm() {
    const s = this.s;
    if (!s) return;
    if (this.now() >= s.cleanupAt) {
      await this.store.deleteAll();
      this.s = null;
      return;
    }
    if (s.phase === 'round' && !s.remaining && this.now() >= s.deadline) {
      await this.resolve();
    }
    await this.save();
  }

  async resolve() {
    const s = this.s;
    const before = structuredClone(s.game);
    s.game = resolveRound(this.battle, s.game, s.picks);
    const round = s.round;
    const factor = this.battle.rules.exileFactor;
    // Individual points: each role's points go to whoever held it; exiles earn half.
    for (const [id, team] of Object.entries(s.teams)) {
      const exiled = before.teams[id].collapsed;
      const scale = (pts) => (exiled ? Math.trunc(pts * factor) : pts);
      for (const h of s.game.teams[id].history.filter((x) => x.round === round)) {
        const pid = team.roles[h.role];
        if (!pid || !s.players[pid]) continue;
        const pts = h.missed ? 0 : scale(h.optionPoints);
        s.scores[pid] = (s.scores[pid] || 0) + pts;
        s.log[pid].push({ round, role: h.role, points: pts, adviser: false });
      }
      for (const pid of team.advisers) {
        const role = this.adviserRole(id, pid, round);
        const pick = s.advice[pid];
        const node = slotFor(this.battle, id, round, role).node;
        const o = pick && node.options.find((x) => x.id === pick);
        const pts = o ? scale(o.points) : 0;
        s.scores[pid] = (s.scores[pid] || 0) + pts;
        s.log[pid].push({ round, role, points: pts, adviser: true, optionId: pick || null });
      }
    }
    s.phase = 'results';
    s.deadline = null;
    s.remaining = null;
  }

  async next() {
    const s = this.s;
    if (s.phase !== 'results') return;
    if (s.round >= this.battle.rules.rounds) await this.finish();
    else this.beginRound();
  }

  async finish() {
    const s = this.s;
    s.phase = 'final';
    s.cleanupAt = Math.min(s.cleanupAt, this.now() + 6 * 60 * 60 * 1000);
    const teams = Object.keys(s.teams).map((id) => teamResult(this.battle, s.game.teams[id]));
    teams.sort((a, b) => b.finalScore - a.finalScore || this.battle.order.indexOf(a.empire) - this.battle.order.indexOf(b.empire));
    const players = Object.values(s.players)
      .filter((p) => !p.kicked && p.empire && s.teams[p.empire])
      .map((p) => ({ name: p.name, empire: p.empire, roles: this.rolesOf(p), score: s.scores[p.pid] || 0 }))
      .sort((a, b) => b.score - a.score);
    s.final = { teams, players, mvps: this.mvps() };
    if (this.saveResults) {
      try {
        await this.saveResults({ code: s.code, period: s.period, teams, players });
      } catch (e) {
        console.error('saving battle results failed', e);
      }
    }
  }

  rolesOf(p) {
    const team = this.s.teams?.[p.empire];
    if (!team) return p.seat ? [p.seat] : [];
    const roles = ROLES.filter((r) => team.roles[r] === p.pid);
    return roles.length ? roles : team.advisers.includes(p.pid) ? ['adviser'] : [];
  }

  // The best player in each role: the most points earned in that role's decisions.
  mvps() {
    const out = {};
    for (const role of ROLES) {
      let best = null;
      for (const p of Object.values(this.s.players)) {
        if (p.kicked) continue;
        const pts = (this.s.log[p.pid] || []).filter((l) => l.role === role && !l.adviser).reduce((a, l) => a + l.points, 0);
        if (!(this.s.log[p.pid] || []).some((l) => l.role === role && !l.adviser)) continue;
        if (!best || pts > best.points) best = { name: p.name, empire: p.empire, points: pts };
      }
      out[role] = best;
    }
    return out;
  }

  // ---------- what each screen sees ----------
  async viewFor(conn, connectedPids = new Set()) {
    if (!this.s) return { t: 'gone' };
    return conn.as === 'host' ? this.hostView(connectedPids) : this.playerView(conn.pid, connectedPids);
  }

  common() {
    const s = this.s;
    return { t: 'state', code: s.code, period: s.period, phase: s.phase, round: s.round, rounds: this.battle.rules.rounds, timer: s.timer, deadline: s.deadline, remaining: s.remaining, now: this.now() };
  }

  seatMap(connected) {
    return this.battle.order.map((id) => {
      const seat = (r) => {
        const p = this.seated(id, r)[0];
        return p ? { pid: p.pid, name: p.name, online: connected.has(p.pid) } : null;
      };
      return {
        id,
        seats: Object.fromEntries(ROLES.map((r) => [r, seat(r)])),
        advisers: this.seated(id, 'adviser').map((p) => ({ pid: p.pid, name: p.name, online: connected.has(p.pid) })),
      };
    });
  }

  teamsView() {
    const s = this.s;
    if (!s.game) return null;
    return Object.fromEntries(Object.entries(s.game.teams).map(([id, t]) => [id, {
      points: t.points,
      stability: t.stability,
      maxStability: t.maxStability,
      regions: t.regions,
      collapsed: t.collapsed,
      collapsedRound: t.collapsedRound,
      roles: Object.fromEntries(ROLES.map((r) => [r, s.players[s.teams[id].roles[r]]?.name || null])),
      advisers: s.teams[id].advisers.map((pid) => s.players[pid]?.name).filter(Boolean),
    }]));
  }

  roundReport() {
    const s = this.s;
    const rep = s.game?.reports[s.round - 1];
    if (!rep || s.phase === 'round') return null;
    const teams = {};
    for (const [id, t] of Object.entries(rep.teams)) {
      const hist = s.game.teams[id].history.filter((h) => h.round === rep.round);
      teams[id] = {
        points: t.points,
        stability: t.stability,
        collapsed: t.collapsed,
        gained: hist.flatMap((h) => h.gained),
        lost: hist.flatMap((h) => h.lost),
        decisions: hist.map((h) => {
          const d = describe(this.battle, id, h);
          return { role: d.role, title: d.title, choice: d.choice, points: d.points, missed: d.missed, wasBest: !d.missed && !d.best };
        }),
      };
    }
    return { round: rep.round, teams, clashes: rep.clashes, collapsed: rep.collapsed };
  }

  hostView(connected) {
    const s = this.s;
    const answered = s.phase === 'round'
      ? Object.fromEntries(Object.entries(s.teams).map(([id, team]) => [id, Object.fromEntries(ROLES.map((r) => [r, s.picks[id][r] != null || !team.roles[r]]))]))
      : null;
    return {
      ...this.common(),
      as: 'host',
      seats: this.seatMap(connected),
      players: Object.values(s.players).filter((p) => !p.kicked).map((p) => ({ pid: p.pid, name: p.name, empire: p.empire, seat: p.seat, online: connected.has(p.pid) })),
      answered,
      teams: this.teamsView(),
      owners: s.game ? s.game.owners : Object.fromEntries(Object.values(this.battle.shared).map((r) => [r.id, r.owner])),
      report: this.roundReport(),
      final: s.final,
    };
  }

  async playerView(pid, connected) {
    const s = this.s;
    const base = { ...this.common(), as: 'player' };
    const p = pid && s.players[pid];
    if (!p || p.kicked) return { ...base, you: null, kicked: !!p?.kicked, seats: s.phase === 'lobby' ? this.seatMap(connected) : null };
    const you = { pid, name: p.name, empire: p.empire, seat: p.seat, roles: this.rolesOf(p), score: s.scores[pid] || 0 };
    const out = { ...base, you };
    if (s.phase === 'lobby') return { ...out, seats: this.seatMap(connected) };
    const team = s.teams[p.empire];
    const gt = s.game.teams[p.empire];
    out.team = {
      empire: p.empire,
      points: gt.points,
      stability: gt.stability,
      maxStability: gt.maxStability,
      regions: gt.regions,
      collapsed: gt.collapsed,
      members: this.seated(p.empire).map((m) => ({ name: m.name, roles: this.rolesOf(m), you: m.pid === pid })),
    };
    if (s.phase === 'round') {
      const roles = team.advisers.includes(pid) ? [this.adviserRole(p.empire, pid, s.round)] : ROLES.filter((r) => team.roles[r] === pid);
      out.decisions = [];
      for (const role of roles) {
        const v = decisionView(this.battle, s.game, p.empire, s.round, role);
        const keyed = await this.keysFor(p.empire, s.round, role);
        const chosenId = team.advisers.includes(pid) ? s.advice[pid] : s.picks[p.empire][role];
        const options = v.options
          .map((o) => ({ key: keyed.find((k) => k.id === o.id).key, text: o.text }))
          .sort((a, b) => (a.key < b.key ? -1 : 1));
        out.decisions.push({
          role,
          adviser: team.advisers.includes(pid),
          kind: v.kind,
          clashId: v.clashId,
          opponent: v.opponent,
          year: v.year,
          title: v.title,
          text: v.text,
          context: v.context,
          options,
          chosen: chosenId ? keyed.find((k) => k.id === chosenId)?.key || null : null,
        });
      }
    }
    if (s.phase === 'results' || s.phase === 'final') {
      const round = s.round;
      const mine = gt.history.filter((h) => h.round === round && team.roles[h.role] === pid).map((h) => {
        const d = describe(this.battle, p.empire, h);
        const log = s.log[pid].find((l) => l.round === round && l.role === h.role && !l.adviser);
        const clash = d.kind === 'clash' ? s.game.reports[round - 1].clashes.find((c) => c.id === d.clashId) : null;
        const side = clash ? this.battle.clashes[clash.id].sides[p.empire] : null;
        return {
          role: d.role, title: d.title, year: d.year, choice: d.choice, explanation: d.explanation, best: d.best,
          points: log ? log.points : 0, missed: d.missed, stabilityDelta: d.stabilityDelta, gained: d.gained, lost: d.lost,
          clash: clash ? { won: clash.winner === p.empire, text: clash.winner === p.empire ? side.win : side.lose, title: clash.title } : null,
        };
      });
      const advice = s.log[pid].filter((l) => l.round === round && l.adviser).map((l) => {
        const node = slotFor(this.battle, p.empire, round, l.role).node;
        const o = node.options.find((x) => x.id === l.optionId);
        const best = node.options.reduce((a, b) => (b.points > a.points ? b : a));
        const did = gt.history.find((h) => h.round === round && h.role === l.role);
        return { role: l.role, adviser: true, title: node.title, choice: o ? o.text : null, explanation: o ? o.explanation : 'You did not give advice in time.', best: o && o.id === best.id ? null : { text: best.text, points: best.points }, points: l.points, teamChoice: did ? describe(this.battle, p.empire, did).choice : null };
      });
      const rep = s.game.reports[round - 1];
      out.results = { round, items: [...mine, ...advice], team: { points: rep.teams[p.empire].points, stability: rep.teams[p.empire].stability, collapsed: rep.collapsed.includes(p.empire) } };
    }
    if (s.phase === 'final') {
      out.final = { ...s.final, you: { score: s.scores[pid] || 0, rank: s.final.players.findIndex((x) => x.name === p.name) + 1 } };
    }
    return out;
  }
}

export { AI };
