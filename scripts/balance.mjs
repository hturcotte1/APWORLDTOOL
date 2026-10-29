#!/usr/bin/env node
// Balance report: walks every path for every empire and reports the
// min / max / typical scores, then checks the tier goals:
//   1. A strong player on a Hard empire beats a strong player on an Easy one.
//   2. A careless Hard player can sink below anyone playing an Easy empire.
//   3. Collapses land in the lower part of the leaderboard (below the class
//      median, and usually in the bottom quarter).
//   4. Hard empires collapse more easily than Medium, and Medium more than Easy.
//   5. The best-scoring option at each decision really is the best move: no
//      worse choice can lead to a higher final score later on.
// Writes docs/BALANCE_REPORT.md and exits with code 1 if a goal is missed.
//
//   npm run balance
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, ROOT } from './lib/load-content.mjs';
import { startState, applyChoice, visibleOptions } from '../src/engine.js';

const { rules, empires } = loadContent();

// How likely a player is to pick the best / middle / worst option at each decision.
const POLICIES = {
  strong: { label: 'Strong player', weights: [0.8, 0.2, 0] },
  thoughtful: { label: 'Thoughtful player', weights: [0.55, 0.3, 0.15] },
  random: { label: 'Random clicking', weights: [1 / 3, 1 / 3, 1 / 3] },
  careless: { label: 'Careless player', weights: [0.15, 0.35, 0.5] },
};

function rankWeights(options, weights) {
  const sorted = [...options].sort((a, b) => b.points - a.points);
  const w = new Map();
  sorted.forEach((o, i) => w.set(o.id, weights[i] ?? 0));
  return w;
}

// Returns every finished path with its probability under each policy.
function allPaths(e) {
  const out = [];
  const walk = (state, probs) => {
    if (state.ending) {
      out.push({ state, probs });
      return;
    }
    const opts = visibleOptions(e.nodes[state.nodeId], state.flags);
    const per = Object.fromEntries(Object.entries(POLICIES).map(([k, p]) => [k, rankWeights(opts, p.weights)]));
    for (const o of opts) {
      const next = {};
      for (const k of Object.keys(POLICIES)) next[k] = probs[k] * per[k].get(o.id);
      walk(applyChoice(e, rules, state, o.id), next);
    }
  };
  walk(startState(e, rules), Object.fromEntries(Object.keys(POLICIES).map((k) => [k, 1])));
  return out;
}

function weightedPercentile(samples, q) {
  // samples: [{v, w}]
  const s = samples.filter((x) => x.w > 0).sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= q * total) return x.v;
  }
  return s.length ? s[s.length - 1].v : NaN;
}

const stats = {};
for (const id of rules.empireOrder) {
  const e = empires[id];
  const paths = allPaths(e);
  const survived = paths.filter((p) => p.state.ending.type === 'survived');
  const collapsed = paths.filter((p) => p.state.ending.type === 'collapsed');
  const fs = (p) => p.state.ending.finalScore;
  const pol = {};
  for (const k of Object.keys(POLICIES)) {
    const samples = paths.map((p) => ({ v: fs(p), w: p.probs[k] }));
    const total = samples.reduce((t, x) => t + x.w, 0);
    pol[k] = {
      expected: samples.reduce((t, x) => t + x.v * x.w, 0) / total,
      collapseChance: collapsed.reduce((t, p) => t + p.probs[k], 0) / total,
      median: weightedPercentile(samples, 0.5),
      samples,
      collapseSamples: collapsed.map((p) => ({ v: fs(p), w: p.probs[k] })),
    };
  }
  const best = paths.reduce((a, b) => (fs(b) > fs(a) ? b : a));
  stats[id] = {
    e,
    tier: e.tier,
    paths: paths.length,
    survivedPaths: survived.length,
    collapsedPaths: collapsed.length,
    max: Math.max(...paths.map(fs)),
    min: Math.min(...paths.map(fs)),
    survMin: Math.min(...survived.map(fs)),
    survMax: Math.max(...survived.map(fs)),
    colMax: collapsed.length ? Math.max(...collapsed.map(fs)) : null,
    colMin: collapsed.length ? Math.min(...collapsed.map(fs)) : null,
    earliestCollapse: collapsed.length ? Math.min(...collapsed.map((p) => p.state.history.length)) : null,
    bestPath: best.state.history.map((h) => `${h.nodeId}:${h.optionId}`).join(' > '),
    pol,
  };
}

// Pooled "thoughtful" scores across all empires: what a realistic class looks like.
const pooled = [];
for (const s of Object.values(stats)) for (const x of s.pol.thoughtful.samples) pooled.push({ v: x.v, w: x.w });
const p25 = weightedPercentile(pooled, 0.25);
const p50 = weightedPercentile(pooled, 0.5);

// Share of collapses (as thoughtful players experience them) that land in the bottom quarter.
for (const s of Object.values(stats)) {
  let all = 0, low = 0;
  for (const x of s.pol.thoughtful.collapseSamples) { all += x.w; if (x.v <= p25) low += x.w; }
  s.collapseInBottomQuarter = all ? low / all : 1;
}

// Goal 5: at every decision, the top-scoring option must also lead to the best possible final score.
function greedyProblems(e) {
  const memo = new Map();
  const bestFinal = (state) => {
    if (state.ending) return state.ending.finalScore;
    const key = `${state.nodeId}|${[...state.flags].sort().join(',')}|${state.stability}|${state.points}`;
    if (memo.has(key)) return memo.get(key);
    const opts = visibleOptions(e.nodes[state.nodeId], state.flags);
    const v = Math.max(...opts.map((o) => bestFinal(applyChoice(e, rules, state, o.id))));
    memo.set(key, v);
    return v;
  };
  const found = new Set();
  const walk = (state) => {
    if (state.ending) return;
    const opts = visibleOptions(e.nodes[state.nodeId], state.flags);
    const top = opts.reduce((a, b) => (b.points > a.points ? b : a));
    const topFinal = bestFinal(applyChoice(e, rules, state, top.id));
    for (const o of opts) {
      const next = applyChoice(e, rules, state, o.id);
      if (o !== top && bestFinal(next) > topFinal) found.add(`at "${state.nodeId}", picking "${o.id}" instead of the best option "${top.id}" can lead to a higher final score`);
      walk(next);
    }
  };
  walk(startState(e, rules));
  return [...found];
}

// ---------- checks ----------
const problems = [];
const ids = rules.empireOrder;
const byTier = (t) => ids.filter((id) => stats[id].tier === t);
for (const h of byTier('hard')) {
  for (const ez of byTier('easy')) {
    const H = stats[h], E = stats[ez];
    if (!(H.max > E.max)) problems.push(`Strong-play goal: best ${h} score (${H.max}) should beat best ${ez} score (${E.max}).`);
    if (!(H.pol.strong.expected > E.pol.strong.expected)) problems.push(`Strong-play goal: typical strong ${h} (${H.pol.strong.expected.toFixed(1)}) should beat strong ${ez} (${E.pol.strong.expected.toFixed(1)}).`);
    if (!(H.min < E.min)) problems.push(`Careless goal: worst ${h} score (${H.min}) should be below worst ${ez} score (${E.min}).`);
    if (!(H.pol.careless.expected < E.pol.careless.expected)) problems.push(`Careless goal: careless ${h} (${H.pol.careless.expected.toFixed(1)}) should score below careless ${ez} (${E.pol.careless.expected.toFixed(1)}).`);
    if (!(H.pol.random.collapseChance > E.pol.random.collapseChance)) problems.push(`Collapse goal: ${h} should collapse more often than ${ez} under random play.`);
  }
}
const avgCollapse = (t) => byTier(t).reduce((a, id) => a + stats[id].pol.random.collapseChance, 0) / byTier(t).length;
if (!(avgCollapse('hard') > avgCollapse('medium') && avgCollapse('medium') > avgCollapse('easy'))) {
  problems.push(`Collapse goal: average collapse chance should go easy < medium < hard (got ${avgCollapse('easy').toFixed(2)}, ${avgCollapse('medium').toFixed(2)}, ${avgCollapse('hard').toFixed(2)}).`);
}
for (const id of ids) {
  const s = stats[id];
  if (s.colMax != null && !(s.colMax < p50)) problems.push(`Lower-part goal: best collapse score for ${id} (${s.colMax}) should be below the class median (${p50}).`);
  if (s.collapseInBottomQuarter < 0.75) problems.push(`Lower-part goal: only ${Math.round(s.collapseInBottomQuarter * 100)}% of ${id} collapses land in the bottom quarter (want 75%+).`);
  for (const g of greedyProblems(s.e)) problems.push(`Best-choice goal (${id}): ${g}.`);
}

// ---------- report ----------
const pct = (x) => `${Math.round(x * 100)}%`;
const lines = [];
lines.push('# Balance Report', '');
lines.push('Generated by `npm run balance`. Every possible path through every empire is scored.', '');
lines.push(`Collapse penalty: ${rules.collapsePenalty.explain}`, '');
lines.push('## Score ranges (every path)', '');
lines.push('| Empire | Tier | Paths | Full / collapse | Best score | Worst score | Full-path range | Collapse range | Earliest collapse | Collapses in bottom quarter |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const id of ids) {
  const s = stats[id];
  lines.push(`| ${s.e.name} | ${s.tier} | ${s.paths} | ${s.survivedPaths} / ${s.collapsedPaths} | ${s.max} | ${s.min} | ${s.survMin} to ${s.survMax} | ${s.colMin} to ${s.colMax} | decision ${s.earliestCollapse} | ${pct(s.collapseInBottomQuarter)} |`);
}
lines.push('', '## Typical scores by player type', '');
lines.push('Player types pick the best / middle / worst option with these chances: ' + Object.values(POLICIES).map((p) => `${p.label} ${p.weights.map((w) => Math.round(w * 100) + '%').join('/')}`).join('; ') + '.', '');
lines.push('| Empire | Tier | ' + Object.values(POLICIES).map((p) => `${p.label}: avg score (collapse chance)`).join(' | ') + ' |');
lines.push('|---|---|' + Object.keys(POLICIES).map(() => '---').join('|') + '|');
for (const id of ids) {
  const s = stats[id];
  lines.push(`| ${s.e.name} | ${s.tier} | ` + Object.keys(POLICIES).map((k) => `${s.pol[k].expected.toFixed(1)} (${pct(s.pol[k].collapseChance)})`).join(' | ') + ' |');
}
lines.push('', `Whole class (thoughtful players, all empires mixed): 25th percentile = ${p25}, median = ${p50}.`, '');
lines.push('## Best path per empire', '');
for (const id of ids) lines.push(`- **${stats[id].e.name}** (${stats[id].max}): ${stats[id].bestPath}`);
lines.push('', '## Goal checks', '');
if (problems.length) problems.forEach((p) => lines.push(`- FAIL: ${p}`));
else {
  lines.push('- PASS: strong Hard players finish above strong Easy players (best and typical scores).');
  lines.push('- PASS: careless Hard players can sink below everyone on Easy empires.');
  lines.push(`- PASS: every collapse scores below the class median (${p50}), and most land in the bottom quarter (at or below ${p25}).`);
  lines.push('- PASS: collapse chance rises from Easy to Medium to Hard.');
  lines.push('- PASS: at every decision, the top-scoring option also leads to the best possible final score.');
}
const report = lines.join('\n') + '\n';
writeFileSync(path.join(ROOT, 'docs', 'BALANCE_REPORT.md'), report);
console.log(report);
if (problems.length) {
  console.log(`BALANCE CHECK FAILED (${problems.length} problem(s))`);
  process.exit(1);
}
console.log('BALANCE CHECK PASSED');
