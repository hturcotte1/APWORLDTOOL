// Class Battle: the rules of the team mode, shared by the BattleRoom (the live
// game server), the scripts, and the tests. Nothing here touches the network.
//
// Each empire is played by a team: a Ruler, a General, and a Vizier. A game has
// four rounds; in each round every role makes one decision for its empire at
// the same time. Choices set flags that change later decisions (so the roles
// depend on each other), cost or restore stability, and win or lose regions on
// the shared map. Some General decisions are clashes: two empires (or an empire
// and a computer-run enemy) decide at once, and the stronger side takes the
// disputed region.
import { GameError, asList, conditionMet, visibleOptions, contextLines, collapsePenalty, ratingFor } from './engine.js';

export const ROLES = ['ruler', 'general', 'vizier'];
export const AI = 'ai';

// Builds the lookup tables the rest of this file uses.
export function makeBattle({ soloRules, empires, battleRules, campaigns, clashes }) {
  const order = soloRules.empireOrder.filter((id) => campaigns[id]);
  const shared = Object.fromEntries(clashes.sharedRegions.map((r) => [r.id, r]));
  return { soloRules, rules: battleRules, empires, campaigns, clashes: clashes.clashes, shared, order, maxCache: {} };
}

export function tierFor(battle, empireId) {
  const e = battle.empires[empireId];
  const t = battle.soloRules.tiers[e.tier];
  if (!t) throw new GameError('bad_tier', `Unknown tier for ${empireId}`);
  return t;
}

// The decision a role faces in a round: a normal node, or its side of a clash.
export function slotFor(battle, empireId, round, role) {
  const r = battle.campaigns[empireId]?.rounds[round - 1];
  if (!r) throw new GameError('bad_round', `No round ${round} for ${empireId}`);
  const s = r[role];
  if (s && s.clash) {
    const clash = battle.clashes[s.clash];
    return { kind: 'clash', clashId: s.clash, clash, node: clash.sides[empireId].node, key: `${empireId}/${round}/${role}` };
  }
  return { kind: 'node', node: s, key: `${empireId}/${round}/${role}` };
}

export function newTeam(battle, empireId) {
  const stability = battle.rules.stability[battle.empires[empireId].tier];
  return {
    empire: empireId,
    stability,
    maxStability: stability,
    points: 0,
    flags: [],
    regions: battle.campaigns[empireId].regions.filter((r) => r.start).map((r) => r.id),
    collapsed: false,
    collapsedRound: null,
    history: [],
  };
}

// A new game for the empires that have players. Shared (disputed) regions start
// with their historical owners.
export function newGame(battle, playedEmpires) {
  const teams = {};
  for (const id of battle.order) if (playedEmpires.includes(id)) teams[id] = newTeam(battle, id);
  const owners = Object.fromEntries(Object.values(battle.shared).map((r) => [r.id, r.owner]));
  return { round: 0, teams, owners, reports: [] };
}

const bestOf = (opts) => opts.reduce((a, b) => (b.points > a.points ? b : a));

// What a role sees: the situation, extra lines from earlier choices, and the
// options (as ids; the room turns them into per-game codes).
export function decisionView(battle, game, empireId, round, role) {
  const team = game.teams[empireId];
  const s = slotFor(battle, empireId, round, role);
  const flags = team ? team.flags : [];
  return {
    kind: s.kind,
    clashId: s.clashId || null,
    year: s.node.year,
    title: s.node.title,
    text: s.node.text,
    context: contextLines(s.node, flags),
    options: visibleOptions(s.node, flags).map((o) => ({ id: o.id, text: o.text })),
    opponent: s.kind === 'clash' ? clashOpponent(battle, s.clashId, empireId) : null,
  };
}

function clashOpponent(battle, clashId, empireId) {
  const c = battle.clashes[clashId];
  if (c.ai) return { kind: 'ai', name: c.ai.name };
  const other = Object.keys(c.sides).find((id) => id !== empireId);
  return { kind: 'empire', empire: other, name: battle.empires[other].name };
}

function applyOption(battle, team, option, active) {
  const out = { points: 0, stabilityDelta: 0, gained: [], lost: [] };
  for (const f of asList(option.set)) if (!team.flags.includes(f)) team.flags.push(f);
  if (!active) return out; // an exiled team's choices still steer its later decisions, but change nothing else
  out.points = option.points;
  team.points += option.points;
  const before = team.stability;
  team.stability = Math.min(team.maxStability, Math.max(0, team.stability + (option.stability || 0)));
  out.stabilityDelta = team.stability - before;
  const own = new Set(battle.campaigns[team.empire].regions.map((r) => r.id));
  for (const g of asList(option.gain)) if (own.has(g) && !team.regions.includes(g)) { team.regions.push(g); out.gained.push(g); }
  for (const l of asList(option.lose)) if (team.regions.includes(l)) { team.regions = team.regions.filter((x) => x !== l); out.lost.push(l); }
  return out;
}

// History keeps ids and numbers only (the live room saves it); describe() adds the words.
function record(team, round, role, s, visible, option, out, missed) {
  const best = bestOf(visible);
  team.history.push({
    round,
    role,
    optionId: option ? option.id : null,
    missed: !!missed,
    points: out.points,
    optionPoints: option ? option.points : 0,
    stabilityDelta: out.stabilityDelta,
    gained: out.gained,
    lost: out.lost,
    bestId: best.id,
  });
}

// A history entry with its words: the decision, the choice, what really happened.
export function describe(battle, empireId, h) {
  const s = slotFor(battle, empireId, h.round, h.role);
  const opt = s.node.options.find((o) => o.id === h.optionId);
  const best = s.node.options.find((o) => o.id === h.bestId);
  return {
    ...h,
    kind: s.kind,
    clashId: s.clashId || null,
    year: s.node.year,
    title: s.node.title,
    choice: opt ? opt.text : null,
    explanation: opt ? opt.explanation : 'No decision was made before time ran out, so nothing happened.',
    best: !opt || opt.id !== best.id ? { text: best.text, points: best.points } : null,
  };
}

// Resolves one round. `picks` is { empireId: { ruler, general, vizier } } with
// option ids (or null when a role didn't answer in time). Returns the new game
// state; the round's results are in game.reports[round - 1].
export function resolveRound(battle, prev, picks) {
  const game = structuredClone(prev);
  const round = game.round + 1;
  if (round > battle.rules.rounds) throw new GameError('game_over', 'The battle is over.');
  game.round = round;
  const report = { round, teams: {}, clashes: [], collapsed: [] };

  // 1. Every normal decision first, so a teammate's choice this round can help a clash.
  // Options are chosen from what each role saw at the start of the round.
  const clashSlots = [];
  for (const [id, team] of Object.entries(game.teams)) {
    const active = !team.collapsed;
    const startFlags = [...team.flags];
    report.teams[id] = { pointsBefore: team.points, stabilityBefore: team.stability };
    for (const role of ROLES) {
      const s = slotFor(battle, id, round, role);
      const pick = picks?.[id]?.[role] ?? null;
      const visible = visibleOptions(s.node, startFlags);
      const option = pick == null ? null : visible.find((o) => o.id === pick) || null;
      if (s.kind === 'clash') {
        clashSlots.push({ id, role, s, visible, option });
        continue;
      }
      const out = option ? applyOption(battle, team, option, active) : { points: 0, stabilityDelta: 0, gained: [], lost: [] };
      record(team, round, role, s, visible, option, out, !option);
    }
  }

  // 2. Clashes. Each side's power is its option's power plus one point for each
  // preparation flag it holds; a side with no team uses the historical choice.
  const clashIds = [...new Set(clashSlots.map((c) => c.s.clashId))];
  for (const id of Object.keys(battle.clashes)) {
    const c = battle.clashes[id];
    if (c.round !== round) continue;
    if (!clashIds.includes(id)) continue; // no team in this clash is playing
    const sides = {};
    for (const [emp, side] of Object.entries(c.sides)) {
      const slot = clashSlots.find((x) => x.id === emp && x.s.clashId === id);
      const team = game.teams[emp];
      if (slot && team) {
        const prep = side.prep.filter((p) => team.flags.includes(p.flag)).map((p) => p.flag);
        const base = slot.option ? slot.option.power : 0;
        sides[emp] = { played: true, collapsed: team.collapsed, optionId: slot.option?.id ?? null, base, prep, power: team.collapsed ? 0 : base + prep.length * battle.rules.clashPrepPower };
      } else {
        const opt = side.node.options.find((o) => o.id === side.historical);
        sides[emp] = { played: false, collapsed: false, optionId: opt.id, base: opt.power, prep: [], power: opt.power };
      }
    }
    if (c.ai) sides[AI] = { played: false, ai: true, name: c.ai.name, power: c.ai.power, prep: [], base: c.ai.power };
    const [a, b] = Object.keys(sides);
    const ownerBefore = prizeOwner(battle, game, c);
    let winner;
    if (sides[a].power > sides[b].power) winner = a;
    else if (sides[b].power > sides[a].power) winner = b;
    else winner = ownerBefore === a || ownerBefore === b ? ownerBefore : a; // a tie: whoever holds the prize keeps it
    setPrizeOwner(battle, game, c, winner);

    // Each playing team's General gets the option's points and effects, plus the outcome.
    for (const emp of Object.keys(c.sides)) {
      const slot = clashSlots.find((x) => x.id === emp && x.s.clashId === id);
      const team = game.teams[emp];
      if (!slot || !team) continue;
      const active = !team.collapsed;
      const out = slot.option ? applyOption(battle, team, slot.option, active) : { points: 0, stabilityDelta: 0, gained: [], lost: [] };
      const side = c.sides[emp];
      if (active && winner !== emp && side.onLose) {
        for (const l of asList(side.onLose.lose)) if (team.regions.includes(l)) { team.regions = team.regions.filter((x) => x !== l); out.lost.push(l); }
        const before = team.stability;
        team.stability = Math.max(0, team.stability + (side.onLose.stability || 0));
        out.stabilityDelta += team.stability - before;
      }
      record(team, round, slot.role, slot.s, slot.visible, slot.option, out, !slot.option);
      team.history[team.history.length - 1].won = winner === emp;
    }
    report.clashes.push({ id, title: c.title, year: c.year, prize: c.prize, sides, winner, ownerBefore, ownerAfter: prizeOwner(battle, game, c) });
  }

  // 3. Collapse: an empire whose stability runs out falls at the end of the round.
  for (const [id, team] of Object.entries(game.teams)) {
    const t = report.teams[id];
    delete t.decisions;
    if (!team.collapsed && team.stability <= 0) {
      team.collapsed = true;
      team.collapsedRound = round;
      report.collapsed.push(id);
    }
    t.points = team.points - t.pointsBefore;
    t.stability = team.stability;
    t.collapsed = team.collapsed;
  }
  game.reports.push(report);
  return game;
}

// Who holds a clash's prize: an owner in the shared table, or (for a team's own
// region) that team, if it still holds it.
function prizeOwner(battle, game, c) {
  if (battle.shared[c.prize]) return game.owners[c.prize];
  for (const [emp, team] of Object.entries(game.teams)) if (team.regions.includes(c.prize)) return emp;
  const side = Object.keys(c.sides).find((emp) => battle.campaigns[emp].regions.some((r) => r.id === c.prize));
  return game.teams[side] ? AI : side;
}

function setPrizeOwner(battle, game, c, winner) {
  if (battle.shared[c.prize]) game.owners[c.prize] = winner;
}

// The final score: points, minus the collapse penalty for a fallen empire.
export function teamResult(battle, team) {
  const penalty = team.collapsed ? collapsePenalty(battle.soloRules, team.points) : 0;
  const finalScore = team.points - penalty;
  const max = maxScore(battle, team.empire);
  return {
    empire: team.empire,
    points: team.points,
    penalty,
    finalScore,
    maxScore: max,
    collapsed: team.collapsed,
    collapsedRound: team.collapsedRound,
    rating: ratingFor({ type: team.collapsed ? 'collapsed' : 'survived', finalScore }, max),
  };
}

// The highest score an empire's team can reach (ignores clash outcomes, which
// change regions, not points).
export function maxScore(battle, empireId) {
  if (battle.maxCache[empireId] != null) return battle.maxCache[empireId];
  const memo = new Map();
  const walk = (round, flags) => {
    if (round > battle.rules.rounds) return 0;
    const key = `${round}|${[...flags].sort().join(',')}`;
    if (memo.has(key)) return memo.get(key);
    let best = -Infinity;
    for (const combo of roundCombos(battle, empireId, round, flags)) {
      const next = [...new Set([...flags, ...combo.flatMap((o) => asList(o.set))])];
      best = Math.max(best, combo.reduce((s, o) => s + o.points, 0) + walk(round + 1, next));
    }
    memo.set(key, best);
    return best;
  };
  battle.maxCache[empireId] = walk(1, []);
  return battle.maxCache[empireId];
}

// Every combination of one option per role for a round, given the flags.
export function roundCombos(battle, empireId, round, flags) {
  const lists = ROLES.map((role) => visibleOptions(slotFor(battle, empireId, round, role).node, flags));
  const out = [];
  for (const a of lists[0]) for (const b of lists[1]) for (const c of lists[2]) out.push([a, b, c]);
  return out;
}

// For tests and scripts: is this option visible to that role now?
export function canPick(battle, game, empireId, round, role, optionId) {
  const team = game.teams[empireId];
  const s = slotFor(battle, empireId, round, role);
  return visibleOptions(s.node, team ? team.flags : []).some((o) => o.id === optionId);
}

export { conditionMet };
