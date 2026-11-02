#!/usr/bin/env node
// Class Battle content validation: checks the campaigns, regions, and clashes
// in content/battle against the rules. Exits with code 1 if any check fails.
//
//   npm run validate:battle             (everything)
//   npm run validate:battle -- spain    (one empire, while writing it)
import { loadBattle } from './lib/load-content.mjs';
import { asList, visibleOptions } from '../src/engine.js';
import { ROLES } from '../src/battle.js';

const only = process.argv[2];
const B = loadBattle();
const { soloRules, empires, battleRules: rules, clashes: clashFile, campaigns } = B;
const clashes = clashFile.clashes;
const shared = Object.fromEntries(clashFile.sharedRegions.map((r) => [r.id, r]));
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const ABBREVIATIONS = /\b(St|Mt|Dr|Jr|Sr|vs|c|ca|e\.g|i\.e|U\.S|A\.D|B\.C)\.(?=\s)/g;
const sentenceCount = (text) => {
  const cleaned = String(text).replace(ABBREVIATIONS, '$1').trim();
  return cleaned ? cleaned.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9])/).length : 0;
};
const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
const commas = (t) => (t.match(/,/g) || []).length;
const MAP = { lon0: -130, lon1: 165, lat0: -45, lat1: 75 };
const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= MAP.lon0 && p[0] <= MAP.lon1 && p[1] >= MAP.lat0 && p[1] <= MAP.lat1;

// ---------- clashes and shared regions ----------
for (const r of clashFile.sharedRegions) {
  const W = `content/battle/clashes.json region "${r.id}"`;
  if (!r.name || !isPoint(r.at) || !Array.isArray(r.size)) err(W, 'needs name, at [lon, lat], and size [w, h]');
  if (r.owner !== 'ai' && !empires[r.owner]) err(W, `owner "${r.owner}" is not an empire id or "ai"`);
}
for (const [id, c] of Object.entries(clashes)) {
  const W = `content/battle/clashes.json clash "${id}"`;
  if (!Number.isInteger(c.round) || c.round < 1 || c.round > rules.rounds) err(W, `round must be 1-${rules.rounds}`);
  const sides = Object.keys(c.sides || {});
  if (c.ai ? sides.length !== 1 : sides.length !== 2) err(W, c.ai ? 'a clash with a computer enemy needs exactly one side' : 'needs exactly two sides');
  if (c.ai && !Number.isInteger(c.ai.power)) err(W, 'ai.power must be a whole number');
  const prizeIsShared = !!shared[c.prize];
  const prizeIsOwn = sides.some((e) => campaigns[e]?.regions?.some((r) => r.id === c.prize));
  if (!prizeIsShared && !prizeIsOwn) err(W, `prize "${c.prize}" is not a shared region or a side's own region`);
  for (const emp of sides) {
    const side = c.sides[emp];
    const S = `${W} side "${emp}"`;
    if (!empires[emp]) { err(S, 'unknown empire'); continue; }
    const slot = campaigns[emp]?.rounds?.[c.round - 1]?.general;
    if (!slot || slot.clash !== id) err(S, `${emp}'s round ${c.round} General slot must be { "clash": "${id}" }`);
    if (!side.win || !side.lose) err(S, 'needs "win" and "lose" text');
    checkNode(S, side.node, emp, true);
    if (!side.node?.options?.some((o) => o.id === side.historical)) err(S, `historical option "${side.historical}" not found`);
    for (const p of side.prep || []) if (!p.flag || !p.why) err(S, 'each prep needs "flag" and "why"');
  }
  if (c.scene) {
    const sc = c.scene;
    if (!sc.title || !sc.caption || words(sc.caption) > 40) err(W, 'scene needs a title and a caption of at most 40 words');
    if (!Array.isArray(sc.view) || sc.view.length !== 4 || !Array.isArray(sc.steps) || !sc.steps.length) err(W, 'scene needs a view and steps');
    if (sc.realm && !empires[sc.realm]) err(W, `scene realm "${sc.realm}" is not an empire id`);
  } else err(W, 'needs a map scene');
}

// ---------- one node (a normal decision or a clash side) ----------
function checkNode(N, n, empId, isClash) {
  if (!n || typeof n !== 'object') return err(N, 'missing');
  if (n.brief && !n.options) return err(N, 'not written yet (still a brief)');
  const tier = soloRules.tiers[empires[empId].tier];
  if (!Number.isInteger(n.year) || n.year < 1440 || n.year > 1760) err(N, 'year must be a whole number from 1440 to 1760');
  if (!n.title) err(N, 'missing title');
  if (!n.text) err(N, 'missing text');
  else if (words(n.text) > rules.nodeRules.maxTextWords) err(N, `text is too long (${words(n.text)} words, max ${rules.nodeRules.maxTextWords})`);
  for (const c of n.context || []) if (!c.text || (!c.if && !c.ifNot)) err(N, 'each context line needs text and an "if" or "ifNot"');
  if (!Array.isArray(n.options) || n.options.length < 3) return err(N, 'needs at least 3 options');
  const ids = new Set();
  for (const o of n.options) {
    const O = `${N} option "${o.id}"`;
    if (!o.id || ids.has(o.id)) err(O, 'needs a unique id');
    ids.add(o.id);
    if (!o.text) err(O, 'missing text');
    else if (words(o.text) > rules.nodeRules.maxOptionWords) err(O, `text is long (${words(o.text)} words, max ${rules.nodeRules.maxOptionWords})`);
    if (!Number.isInteger(o.points) || o.points < tier.pointsMin || o.points > tier.pointsMax) err(O, `points must be ${tier.pointsMin} to ${tier.pointsMax} (${tier.label})`);
    if (o.stability !== undefined && ![-2, -1, 1].includes(o.stability)) err(O, 'stability must be -2, -1, or 1');
    if (!o.explanation) err(O, 'missing explanation');
    else if (sentenceCount(o.explanation) > rules.nodeRules.maxExplanationSentences) err(O, `explanation has ${sentenceCount(o.explanation)} sentences (max ${rules.nodeRules.maxExplanationSentences})`);
    if (o.next || o.collapse) err(O, 'battle options have no "next" or "collapse"');
    if (isClash) {
      if (!Number.isInteger(o.power) || o.power < 0 || o.power > 3) err(O, 'clash options need "power" 0-3');
      if (o.gain || o.lose) err(O, 'clash options change regions through the clash result, not gain/lose');
    } else if (o.power !== undefined) err(O, '"power" is only for clash options');
    const own = new Set((campaigns[empId]?.regions || []).map((r) => r.id));
    for (const g of [...asList(o.gain), ...asList(o.lose)]) if (!own.has(g)) err(O, `region "${g}" is not one of ${empId}'s regions`);
  }
}

// ---------- campaigns ----------
const summary = [];
for (const empId of soloRules.empireOrder) {
  if (only && only !== empId) continue;
  const c = campaigns[empId];
  const W = `content/battle/campaigns/${empId}.json`;
  if (!c) { err(W, 'missing campaign file'); continue; }
  if (c.id !== empId) err(W, `"id" must be "${empId}"`);
  for (const role of ROLES) if (!c.titles?.[role]) err(W, `titles.${role} missing`);
  const regionIds = new Set();
  for (const r of c.regions || []) {
    if (!r.id || regionIds.has(r.id) || shared[r.id]) err(W, `region "${r.id}" needs a unique id (not a shared region id)`);
    regionIds.add(r.id);
    if (!r.name || !isPoint(r.at) || !Array.isArray(r.size) || r.size.length !== 2) err(W, `region "${r.id}" needs name, at [lon, lat], and size [w, h]`);
  }
  if (!(c.regions || []).some((r) => r.start)) err(W, 'needs at least one starting region ("start": true)');
  if (!Array.isArray(c.rounds) || c.rounds.length !== rules.rounds) { err(W, `needs ${rules.rounds} rounds`); continue; }

  // Which round and role set each flag, and where each is used.
  const setBy = {}; // flag -> [{round, role}]
  const slotsOf = []; // {round, role, node, isClash}
  c.rounds.forEach((r, i) => {
    const round = i + 1;
    if (!r.years || !r.title) err(W, `round ${round} needs "years" and "title"`);
    for (const role of ROLES) {
      const s = r[role];
      const N = `${W} round ${round} ${role}`;
      if (s?.clash) {
        const cl = clashes[s.clash];
        if (!cl) { err(N, `unknown clash "${s.clash}"`); continue; }
        if (role !== 'general') err(N, 'clashes belong in the General slot');
        if (cl.round !== round) err(N, `clash "${s.clash}" is set for round ${cl.round}`);
        if (!cl.sides[empId]) { err(N, `clash "${s.clash}" has no ${empId} side`); continue; }
        slotsOf.push({ round, role, node: cl.sides[empId].node, isClash: true, clash: cl });
      } else {
        checkNode(N, s, empId, false);
        if (s?.options) slotsOf.push({ round, role, node: s, isClash: false });
      }
      const node = s?.clash ? clashes[s.clash]?.sides?.[empId]?.node : s;
      for (const o of node?.options || []) for (const f of asList(o.set)) (setBy[f] ||= []).push({ round, role });
    }
  });
  const written = slotsOf.length === rules.rounds * ROLES.length;

  // Flags must be set in an earlier round than any decision that reads them.
  const used = new Set();
  let crossRole = 0;
  for (const sl of slotsOf) {
    let cross = false;
    for (const item of [...(sl.node.context || []), ...sl.node.options]) {
      for (const f of [...asList(item.if), ...asList(item.ifNot)]) {
        used.add(f);
        const sources = (setBy[f] || []).filter((x) => x.round < sl.round);
        if (!sources.length) err(`${W} round ${sl.round} ${sl.role}`, `flag "${f}" must be set by an option in an earlier round`);
        if (sources.some((x) => x.role !== sl.role)) cross = true;
      }
    }
    if (cross) crossRole++;
    if (sl.isClash) for (const p of sl.clash.sides[empId].prep || []) {
      used.add(p.flag);
      if (!(setBy[p.flag] || []).some((x) => x.round < sl.round || (x.round === sl.round && x.role !== 'general'))) err(`${W} round ${sl.round} general`, `clash preparation flag "${p.flag}" is never set before this clash`);
    }
  }
  for (const f of Object.keys(setBy)) if (!used.has(f)) warn(W, `flag "${f}" is set but never used`);
  if (written && crossRole < 3) err(W, `only ${crossRole} decisions depend on another role's earlier choices (need at least 3)`);

  // Regions: every region except the starting ones can be won.
  const gainable = new Set();
  for (const sl of slotsOf) for (const o of sl.node.options) asList(o.gain).forEach((g) => gainable.add(g));
  for (const r of c.regions || []) if (!r.start && !gainable.has(r.id) && !Object.values(clashes).some((cl) => cl.prize === r.id)) warn(W, `region "${r.id}" can never be won`);

  // Walk every reachable situation: each decision shows exactly 3 options with one best.
  let states = [[]];
  const screens = new Map(); // distinct option sets, for the give-away checks
  const issues = new Set();
  if (written) {
    for (let round = 1; round <= rules.rounds; round++) {
      const next = new Map();
      const slots = slotsOf.filter((x) => x.round === round);
      for (const flags of states) {
        const lists = slots.map((sl) => {
          const opts = visibleOptions(sl.node, flags);
          if (opts.length !== 3) issues.add(`round ${round} ${sl.role} shows ${opts.length} options when flags = [${flags.join(', ')}] (must be 3)`);
          const top = Math.max(...opts.map((o) => o.points));
          if (opts.filter((o) => o.points === top).length > 1) issues.add(`round ${round} ${sl.role} has a tie for the best option when flags = [${flags.join(', ')}]`);
          screens.set(`${round}/${sl.role}/${opts.map((o) => o.id).join('')}`, opts);
          return opts;
        });
        for (const a of lists[0] || []) for (const b of lists[1] || []) for (const d of lists[2] || []) {
          const f = [...new Set([...flags, ...[a, b, d].flatMap((o) => asList(o.set))])].sort();
          next.set(f.join(','), f);
        }
      }
      states = [...next.values()];
      if (states.length > 20000) { issues.add('too many flag combinations (over 20,000); use fewer flags'); break; }
    }
    issues.forEach((m) => err(W, m));

    // Option wording must not give away the best answer (same rules as the solo game).
    const sets = [...screens.values()];
    let bestLongest = 0, bestShortest = 0, bestLen = 0, avgLen = 0;
    for (const opts of sets) {
      const byLen = [...opts].sort((x, y) => y.text.length - x.text.length);
      const best = opts.reduce((x, y) => (y.points > x.points ? y : x));
      if (byLen[0] === best) bestLongest++;
      if (byLen.at(-1) === best) bestShortest++;
      bestLen += best.text.length;
      avgLen += opts.reduce((s, o) => s + o.text.length, 0) / opts.length;
    }
    const share = (x) => x / sets.length;
    if (share(bestLongest) > 0.45) err(W, `the best option is the longest on ${Math.round(100 * share(bestLongest))}% of decisions (max 45%)`);
    if (share(bestShortest) < 0.2) err(W, `the best option is the shortest on only ${Math.round(100 * share(bestShortest))}% of decisions (min 20%)`);
    if (bestLen / avgLen > 1.2 || bestLen / avgLen < 0.8) err(W, `best options average ${(bestLen / avgLen).toFixed(2)}x a typical option's length (must be 0.8-1.2)`);
    const guesses = {
      'the option with the fewest sentences': (o) => -sentenceCount(o.text),
      'the option with the most sentences': (o) => sentenceCount(o.text),
      'the option with the most commas': (o) => commas(o.text),
      'the option with the fewest commas': (o) => -commas(o.text),
    };
    for (const [name, f] of Object.entries(guesses)) {
      let hits = 0;
      for (const opts of sets) {
        const top = Math.max(...opts.map(f));
        const picks = opts.filter((o) => f(o) === top);
        if (picks.some((o) => o.points === Math.max(...opts.map((x) => x.points)))) hits += 1 / picks.length;
      }
      if (share(hits) > 0.5) err(W, `picking ${name} finds the best answer on ${Math.round(100 * share(hits))}% of decisions (max 50%)`);
    }
    summary.push({ empId, tier: empires[empId].tier, states: states.length, crossRole, bestLongest: `${Math.round(100 * share(bestLongest))}%` });
  } else {
    summary.push({ empId, tier: empires[empId].tier, states: '-', crossRole, bestLongest: '-', unwritten: rules.rounds * ROLES.length - slotsOf.length });
  }
}

// ---------- report ----------
console.log('\nClass Battle content validation');
console.log('===============================');
console.log('empire     tier    end-states  cross-role-links  best-is-longest');
for (const s of summary) console.log(`${s.empId.padEnd(10)} ${s.tier.padEnd(7)} ${String(s.states).padStart(10)}  ${String(s.crossRole).padStart(16)}  ${String(s.bestLongest).padStart(15)}${s.unwritten ? `   (${s.unwritten} decisions not written yet)` : ''}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  warnings.forEach((w) => console.log('  ! ' + w));
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  errors.forEach((x) => console.log('  x ' + x));
  console.log('\nVALIDATION FAILED');
  process.exit(1);
}
console.log('\nAll Class Battle checks passed.');
