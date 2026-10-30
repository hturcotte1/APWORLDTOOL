#!/usr/bin/env node
// Content validation: checks every empire's decision graph against the rules
// in content/rules.json. Exits with code 1 if any check fails.
//
//   npm run validate
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, ROOT } from './lib/load-content.mjs';
import { asList, visibleOptions, forEachPath, startState, applyChoice } from '../src/engine.js';

const { rules, glossary, empires, files } = loadContent();
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const ABBREVIATIONS = /\b(St|Mt|Dr|Jr|Sr|vs|c|ca|e\.g|i\.e|U\.S|A\.D|B\.C)\.(?=\s)/g;
export function sentenceCount(text) {
  const cleaned = String(text).replace(ABBREVIATIONS, '$1').trim();
  if (!cleaned) return 0;
  return cleaned.split(/(?<=[.!?]["”’)]?)\s+(?=["“(]?[A-Z0-9])/).length;
}
const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;

// ---------- turning-point map scenes ----------
// The world map's edges (see public/map-data.js).
const MAP_BOUNDS = { lon0: -130, lon1: 165, lat0: -45, lat1: 75 };
const SCENE_KINDS = ['city', 'battle', 'arrow', 'route', 'area', 'text', 'link', 'network'];
const CITY_MARKS = ['home', 'taken', 'lost', 'ally', 'foe', 'new', 'plain', 'revolt'];
const SIDES = ['own', 'foe', 'neutral'];
const ARROW_STYLES = ['solid', 'retreat', 'exile', 'repelled', 'flow'];
const ROUTE_KINDS = ['silver', 'gold', 'salt', 'trade', 'travel'];
const LABEL_POS = ['above', 'below', 'left', 'right'];
function validateScene(where, sc) {
  const S = `${where} scene`;
  if (!sc || typeof sc !== 'object') return err(S, 'must be an object');
  if (!sc.year || typeof sc.year !== 'string') err(S, 'needs a "year" (text, for example "1526")');
  if (!sc.title || words(sc.title) > 6) err(S, 'needs a short "title" (at most 6 words)');
  if (!sc.caption) err(S, 'needs a "caption"');
  else {
    if (words(sc.caption) > 40) err(S, `caption is too long (${words(sc.caption)} words, max 40)`);
    if (sentenceCount(sc.caption) > 3) err(S, 'caption should be at most 3 sentences');
  }
  const v = sc.view;
  const viewOk = Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) && v[0] < v[2] && v[1] < v[3]
    && v[0] >= MAP_BOUNDS.lon0 && v[2] <= MAP_BOUNDS.lon1 && v[1] >= MAP_BOUNDS.lat0 && v[3] <= MAP_BOUNDS.lat1;
  if (!viewOk) return err(S, `"view" must be [west, south, east, north] inside the map (longitude ${MAP_BOUNDS.lon0} to ${MAP_BOUNDS.lon1}, latitude ${MAP_BOUNDS.lat0} to ${MAP_BOUNDS.lat1})`);
  // Points may sit a little outside the view (the map shows more on wide screens), not far.
  const M = 3;
  const point = (p, what) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return err(S, `${what} must be a [longitude, latitude] pair`);
    if (p[0] < v[0] - M || p[0] > v[2] + M || p[1] < v[1] - M || p[1] > v[3] + M) err(S, `${what} [${p}] is outside the scene's view`);
  };
  const points = (list, what, min) => {
    if (!Array.isArray(list) || list.length < min) return err(S, `${what} needs at least ${min} points`);
    list.forEach((p, i) => point(p, `${what} point ${i + 1}`));
  };
  if (!Array.isArray(sc.steps) || sc.steps.length < 2 || sc.steps.length > 9) return err(S, 'needs 2-9 "steps"');
  sc.steps.forEach((st, i) => {
    const kinds = SCENE_KINDS.filter((k) => k in st);
    const T = `step ${i + 1}`;
    if (kinds.length !== 1) return err(S, `${T} must have exactly one of: ${SCENE_KINDS.join(', ')}`);
    const kind = kinds[0];
    if (st.pos !== undefined && !LABEL_POS.includes(st.pos)) err(S, `${T} "pos" must be one of ${LABEL_POS.join(', ')}`);
    if (kind === 'city') {
      if (!st.city) err(S, `${T} city needs a name`);
      point(st.at, `${T} (${st.city})`);
      if (!CITY_MARKS.includes(st.mark)) err(S, `${T} city "mark" must be one of ${CITY_MARKS.join(', ')}`);
    } else if (kind === 'battle') {
      if (typeof st.battle !== 'string') err(S, `${T} battle needs a name (or "" for none)`);
      point(st.at, `${T} (battle)`);
      if (typeof st.won !== 'boolean') err(S, `${T} battle needs "won": true or false`);
    } else if (kind === 'arrow') {
      points(st.arrow, `${T} arrow`, 2);
      if (!SIDES.includes(st.side)) err(S, `${T} arrow "side" must be one of ${SIDES.join(', ')}`);
      if (st.style !== undefined && !ARROW_STYLES.includes(st.style)) err(S, `${T} arrow "style" must be one of ${ARROW_STYLES.join(', ')}`);
    } else if (kind === 'route') {
      points(st.route, `${T} route`, 2);
      if (!ROUTE_KINDS.includes(st.kind)) err(S, `${T} route "kind" must be one of ${ROUTE_KINDS.join(', ')}`);
    } else if (kind === 'area') {
      if (!st.area) err(S, `${T} area needs a label`);
      point(st.at, `${T} (area)`);
      if (!Array.isArray(st.size) || st.size.length !== 2 || !st.size.every((x) => x > 0)) err(S, `${T} area "size" must be [width, height] in degrees`);
      if (!SIDES.includes(st.side)) err(S, `${T} area "side" must be one of ${SIDES.join(', ')}`);
    } else if (kind === 'text') {
      if (!st.text) err(S, `${T} text needs words to show`);
      point(st.at, `${T} (text)`);
      if (!['geo', 'event'].includes(st.kind)) err(S, `${T} text "kind" must be geo or event`);
    } else if (kind === 'link') {
      points(st.link, `${T} link`, 2);
    } else if (kind === 'network') {
      point(st.network, `${T} network hub`);
      points(st.to, `${T} network`, 2);
    }
  });
}

// ---------- empire list ----------
const order = rules.empireOrder;
for (const f of files) {
  const id = f.replace(/\.json$/, '');
  if (!order.includes(id)) err('rules.json', `empireOrder is missing "${id}" (from ${f})`);
}
for (const id of order) if (!empires[id]) err('rules.json', `empireOrder lists "${id}" but content/empires/${id}.json is missing`);

const contentJs = readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
for (const id of order) {
  if (!contentJs.includes(`../content/empires/${id}.json`)) err('src/content.js', `does not import content/empires/${id}.json`);
}

// ---------- glossary ----------
const checkGlossary = (where, list) => {
  if (!Array.isArray(list)) return err(where, 'glossary must be a list');
  for (const g of list) {
    if (!g.term || !g.def) err(where, `glossary entry needs "term" and "def": ${JSON.stringify(g)}`);
    if (g.def && words(g.def) > 22) warn(where, `glossary definition for "${g.term}" is long (${words(g.def)} words)`);
  }
};
checkGlossary('content/glossary.json', glossary.terms);

// ---------- per empire ----------
const summary = [];
for (const id of order) {
  const e = empires[id];
  if (!e) continue;
  const W = e._file;
  const tier = rules.tiers[e.tier];
  if (e.id !== id) err(W, `"id" is "${e.id}" but the file name says "${id}"`);
  if (!tier) { err(W, `unknown tier "${e.tier}"`); continue; }
  for (const k of ['name', 'tierReason', 'summary', 'color', 'emblem', 'intro', 'start']) {
    if (!e[k] || typeof e[k] !== 'string') err(W, `missing text field "${k}"`);
  }
  if (!Number.isInteger(e.startYear) || !Number.isInteger(e.endYear) || e.startYear >= e.endYear) err(W, 'startYear/endYear must be whole years with startYear < endYear');
  if (e.startYear < 1440 || e.endYear > 1760) warn(W, `years ${e.startYear}-${e.endYear} stretch outside 1450-1750`);
  if (!e.collapse || !e.collapse.text) err(W, 'missing collapse.text');
  if (!e.survive || !e.survive.text) err(W, 'missing survive.text');
  if (e.tierReason && words(e.tierReason) > 22) warn(W, 'tierReason should be one short line');
  if (e.glossary) checkGlossary(W, e.glossary);

  // timeline
  const tl = e.timeline || [];
  if (tl.length < rules.timelineLength.min || tl.length > rules.timelineLength.max) err(W, `timeline has ${tl.length} entries (needs ${rules.timelineLength.min}-${rules.timelineLength.max})`);
  for (let i = 0; i < tl.length; i++) {
    if (!tl[i].year || !tl[i].text) err(W, `timeline entry ${i + 1} needs year and text`);
    if (i && String(tl[i].year).localeCompare(String(tl[i - 1].year), undefined, { numeric: true }) < 0) err(W, 'timeline is not in time order');
  }

  // nodes
  const nodes = e.nodes || {};
  const ids = Object.keys(nodes);
  if (ids.length < rules.nodesPerEmpire.min || ids.length > rules.nodesPerEmpire.max) err(W, `has ${ids.length} decision nodes (needs ${rules.nodesPerEmpire.min}-${rules.nodesPerEmpire.max})`);
  if (!nodes[e.start]) err(W, `start node "${e.start}" does not exist`);

  const flagsSet = new Set();
  const flagsUsed = new Set();
  let instantCollapses = 0;
  for (const nid of ids) {
    const n = nodes[nid];
    const N = `${W} node "${nid}"`;
    if (!n.title) err(N, 'missing title');
    if (!n.text) err(N, 'missing text');
    if (n.text && words(n.text) > 120) warn(N, `text is long (${words(n.text)} words)`);
    if (n.milestone && !n.scene) err(N, 'turning points (milestone) need a map "scene"');
    if (n.scene) validateScene(N, n.scene);
    if (!Number.isInteger(n.year)) err(N, 'year must be a whole number');
    else if (n.year < e.startYear || n.year > e.endYear) err(N, `year ${n.year} is outside ${e.startYear}-${e.endYear}`);
    for (const c of n.context || []) {
      if (!c.text) err(N, 'context entry without text');
      asList(c.if).forEach((f) => flagsUsed.add(f));
      asList(c.ifNot).forEach((f) => flagsUsed.add(f));
    }
    if (!Array.isArray(n.options) || n.options.length < rules.optionsPerNode) { err(N, 'needs at least 3 options'); continue; }
    const seen = new Set();
    for (const o of n.options) {
      const O = `${N} option "${o.id}"`;
      if (!o.id) err(N, 'option without id');
      if (seen.has(o.id)) err(O, 'duplicate option id');
      seen.add(o.id);
      if (!o.text) err(O, 'missing text');
      if (o.text && words(o.text) > 40) warn(O, `option text is long (${words(o.text)} words)`);
      if (!o.explanation) err(O, 'missing explanation');
      else {
        const s = sentenceCount(o.explanation);
        if (s > rules.maxExplanationSentences) err(O, `explanation has ${s} sentences (max ${rules.maxExplanationSentences})`);
        if (words(o.explanation) > 75) warn(O, `explanation is long (${words(o.explanation)} words)`);
      }
      if (!Number.isInteger(o.points)) err(O, 'points must be a whole number');
      else if (o.points < tier.pointsMin || o.points > tier.pointsMax) err(O, `points ${o.points} outside ${e.tier} range ${tier.pointsMin} to ${tier.pointsMax}`);
      if (o.stability != null && (!Number.isInteger(o.stability) || o.stability < -2 || o.stability > 1)) err(O, 'stability change must be -2, -1, 0 or +1');
      if (o.collapse) {
        instantCollapses++;
        if (!o.collapse.text) err(O, 'collapse needs text');
        if (o.collapse.year != null && !Number.isInteger(o.collapse.year)) err(O, 'collapse.year must be a whole number');
        if (o.next) err(O, 'an option that collapses the empire should not also have "next"');
      } else if (o.next !== 'end' && !nodes[o.next]) {
        err(O, `"next" points to "${o.next}", which does not exist (broken link)`);
      } else if (o.next !== 'end' && Number.isInteger(n.year) && nodes[o.next].year < n.year) {
        err(O, `goes back in time (${n.year} -> ${nodes[o.next].year})`);
      }
      asList(o.set).forEach((f) => flagsSet.add(f));
      asList(o.if).forEach((f) => flagsUsed.add(f));
      asList(o.ifNot).forEach((f) => flagsUsed.add(f));
    }
  }
  for (const f of flagsUsed) if (!flagsSet.has(f)) err(W, `flag "${f}" is checked but never set (typo?)`);
  for (const f of flagsSet) if (!flagsUsed.has(f)) warn(W, `flag "${f}" is set but never used`);
  if (instantCollapses > tier.maxInstantCollapses) err(W, `${instantCollapses} instant-collapse options; ${e.tier} allows at most ${tier.maxInstantCollapses}`);

  // reachability + cycles (ignoring flags)
  const reach = new Set();
  const stack = [e.start];
  while (stack.length) {
    const cur = stack.pop();
    if (reach.has(cur) || !nodes[cur]) continue;
    reach.add(cur);
    for (const o of nodes[cur].options || []) if (o.next && o.next !== 'end') stack.push(o.next);
  }
  for (const nid of ids) if (!reach.has(nid)) err(W, `node "${nid}" can never be reached`);
  const color = {};
  const hasCycle = (nid) => {
    color[nid] = 1;
    for (const o of nodes[nid].options || []) {
      const nx = o.next;
      if (!nx || nx === 'end' || !nodes[nx]) continue;
      if (color[nx] === 1 || (!color[nx] && hasCycle(nx))) return true;
    }
    color[nid] = 2;
    return false;
  };
  if (nodes[e.start] && hasCycle(e.start)) err(W, 'the graph has a loop (a path can repeat forever)');
  if (errors.length) continue; // structural problems make path walking unsafe

  // walk every reachable state: exactly 3 options showing, unique best answer
  const stateIssues = new Set();
  const optionSets = new Map(); // every distinct set of options a student can see
  const visitStates = (state, depth) => {
    if (state.ending) return;
    if (depth > 30) { stateIssues.add('path too deep (loop?)'); return; }
    const node = nodes[state.nodeId];
    const opts = visibleOptions(node, state.flags);
    if (opts.length !== rules.optionsPerNode) stateIssues.add(`node "${state.nodeId}" shows ${opts.length} options when flags = [${state.flags.join(', ')}] (must be ${rules.optionsPerNode})`);
    const top = Math.max(...opts.map((o) => o.points));
    if (opts.filter((o) => o.points === top).length > 1) stateIssues.add(`node "${state.nodeId}" has a tie for the best option when flags = [${state.flags.join(', ')}]`);
    optionSets.set(`${state.nodeId}:${opts.map((o) => o.id).join(',')}`, opts);
    for (const o of opts) visitStates(applyChoice(e, rules, state, o.id), depth + 1);
  };
  visitStates(startState(e, rules), 0);
  stateIssues.forEach((m) => err(W, m));
  if (stateIssues.size) continue;

  // option length must not give away the best answer (students notice "longest = best")
  const sets = [...optionSets.values()];
  let bestLongest = 0, bestShortest = 0, bestLen = 0, avgLen = 0;
  for (const opts of sets) {
    const byLen = [...opts].sort((a, b) => b.text.length - a.text.length);
    const best = opts.reduce((a, b) => (b.points > a.points ? b : a));
    if (byLen[0] === best) bestLongest++;
    if (byLen.at(-1) === best) bestShortest++;
    bestLen += best.text.length;
    avgLen += opts.reduce((a, o) => a + o.text.length, 0) / opts.length;
  }
  const share = (x) => x / sets.length;
  if (share(bestLongest) > 0.45) err(W, `the best option is also the longest on ${Math.round(100 * share(bestLongest))}% of decision screens (max 45%): vary option lengths so length doesn't give away the answer`);
  if (share(bestShortest) < 0.2) err(W, `the best option is the shortest on only ${Math.round(100 * share(bestShortest))}% of decision screens (min 20%): vary option lengths so length doesn't give away the answer`);
  if (bestLen / avgLen > 1.2 || bestLen / avgLen < 0.8) err(W, `best options average ${(bestLen / avgLen).toFixed(2)}x the length of a typical option (must be 0.8-1.2)`);
  // ...and neither should sentence count or a comma-separated list of steps
  const commas = (t) => (t.match(/,/g) || []).length;
  const guesses = {
    'the option with the fewest sentences': (o) => -sentenceCount(o.text),
    'the option with the most sentences': (o) => sentenceCount(o.text),
    'the option with the most commas (a multi-part plan)': (o) => commas(o.text),
    'the option with the fewest commas': (o) => -commas(o.text),
  };
  for (const [name, f] of Object.entries(guesses)) {
    let hits = 0;
    for (const opts of sets) {
      const top = Math.max(...opts.map(f));
      const picks = opts.filter((o) => f(o) === top);
      if (picks.some((o) => o.points === Math.max(...opts.map((x) => x.points)))) hits += 1 / picks.length;
    }
    if (share(hits) > 0.5) err(W, `picking ${name} finds the best answer on ${Math.round(100 * share(hits))}% of decision screens (max 50%): vary how options are written`);
  }

  const milestones = ids.filter((nid) => nodes[nid].milestone);
  let survived = 0, collapsed = 0, minLen = Infinity, maxLen = 0, maxPts = -Infinity, minPts = Infinity;
  const badLen = new Set();
  const missedMilestones = new Set();
  forEachPath(e, rules, ({ choices, state }) => {
    const len = choices.length;
    if (state.ending.type === 'survived') {
      survived++;
      minLen = Math.min(minLen, len);
      maxLen = Math.max(maxLen, len);
      if (len < rules.pathLength.min || len > rules.pathLength.max) badLen.add(`${len} decisions: ${state.history.map((h) => h.nodeId).join(' > ')}`);
      const visited = new Set(state.history.map((h) => h.nodeId));
      milestones.forEach((m) => { if (!visited.has(m)) missedMilestones.add(m); });
    } else collapsed++;
    maxPts = Math.max(maxPts, state.ending.finalScore);
    minPts = Math.min(minPts, state.ending.finalScore);
  });
  badLen.forEach((m) => err(W, `full path has wrong length (${rules.pathLength.min}-${rules.pathLength.max}): ${m}`));
  missedMilestones.forEach((m) => err(W, `milestone "${m}" is skipped by some full path`));
  if (!survived) err(W, 'no path survives to the end');
  if (!collapsed) err(W, 'no path leads to an early collapse');
  if (!milestones.length) warn(W, 'no milestone (turning point) nodes marked');

  // glossary terms should actually appear in this empire's text
  const allText = JSON.stringify(e.nodes).toLowerCase();
  for (const g of e.glossary || []) {
    const variants = [g.term, ...asList(g.match)].map((v) => v.toLowerCase());
    if (!variants.some((v) => allText.includes(v))) warn(W, `glossary term "${g.term}" never appears in the story`);
  }

  summary.push({ id, tier: e.tier, nodes: ids.length, milestones: milestones.length, survived, collapsed, len: `${minLen}-${maxLen}`, minPts, maxPts, instantCollapses, bestLongest: `${Math.round(100 * share(bestLongest))}%` });
}

// ---------- report ----------
console.log('\nContent validation');
console.log('==================');
if (summary.length) {
  console.log('empire     tier    nodes  turning-pts  full-paths  collapse-paths  path-length  score-range  instant-collapses  best-is-longest');
  for (const s of summary) {
    console.log(`${s.id.padEnd(10)} ${s.tier.padEnd(7)} ${String(s.nodes).padStart(5)}  ${String(s.milestones).padStart(11)}  ${String(s.survived).padStart(10)}  ${String(s.collapsed).padStart(14)}  ${s.len.padStart(11)}  ${`${s.minPts} to ${s.maxPts}`.padStart(11)}  ${String(s.instantCollapses).padStart(17)}  ${s.bestLongest.padStart(15)}`);
  }
}
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
console.log('\nAll checks passed: no dead ends, no broken links, every path reaches an ending,');
console.log(`full paths are ${rules.pathLength.min}-${rules.pathLength.max} decisions, points match the tier rules, and option length`);
console.log("doesn't give away the best answer.");
