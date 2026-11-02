#!/usr/bin/env node
// Builds docs/BATTLE_CONTENT_REVIEW.md: every Class Battle decision, option,
// point value, clash and explanation in one readable document, with the
// flagged (uncertain or debated) facts from docs/BATTLE_ACCURACY_FLAGS.md at the top.
//
//   npm run review-doc:battle
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBattle, ROOT } from './lib/load-content.mjs';
import { asList } from '../src/engine.js';
import { makeBattle, maxScore, ROLES } from '../src/battle.js';

const B = loadBattle();
const battle = makeBattle({ soloRules: B.soloRules, empires: B.empires, battleRules: B.battleRules, campaigns: B.campaigns, clashes: B.clashes });
const rules = B.battleRules;
const flagsFile = path.join(ROOT, 'docs', 'BATTLE_ACCURACY_FLAGS.md');
const flags = existsSync(flagsFile) ? readFileSync(flagsFile, 'utf8').trim() : '';
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const anchor = (s) => s.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
const regionNames = {};
for (const r of B.clashes.sharedRegions) regionNames[r.id] = r.name;
for (const c of Object.values(B.campaigns)) for (const r of c.regions) regionNames[r.id] = r.name;
const region = (id) => regionNames[id] || id;
const empireName = (id) => B.empires[id]?.name || id;

const condition = (x) => {
  const parts = [];
  if (x.if) parts.push(`only if: ${asList(x.if).join(', ')}`);
  if (x.ifNot) parts.push(`only if NOT: ${asList(x.ifNot).join(', ')}`);
  return parts.length ? ` _(${parts.join('; ')})_` : '';
};

function options(node, { clash = false } = {}) {
  const out = [];
  for (const c of node.context || []) out.push(`- _Extra line shown${condition(c).replace(' _(', ' (').replace(')_', ')')}:_ ${c.text}`);
  if ((node.context || []).length) out.push('');
  for (const o of node.options) {
    const effects = [`**${fmt(o.points)} ${Math.abs(o.points) === 1 ? 'point' : 'points'}**`];
    if (clash) effects.push(`battle strength ${o.power}`);
    if (o.stability) effects.push(`stability ${fmt(o.stability)}`);
    if (o.set) effects.push(`sets flag: ${asList(o.set).join(', ')}`);
    if (o.gain) effects.push(`gains: ${asList(o.gain).map(region).join(', ')}`);
    if (o.lose) effects.push(`loses: ${asList(o.lose).map(region).join(', ')}`);
    out.push(`**${o.id.toUpperCase()}.** ${o.text}${condition(o)}  `);
    out.push(`${effects.join(' · ')}  `);
    out.push(`_What actually happened:_ ${o.explanation}`, '');
  }
  return out;
}

const out = [];
out.push('# Content Review: Class Battle', '');
out.push('This document lists every decision in the live **Class Battle** mode so you can spot-check it. It is generated from the content files by `npm run review-doc:battle`, so it always matches what students see. (The solo game has its own review: `docs/CONTENT_REVIEW.md`.)', '');
out.push(`**How a battle works:** ${rules.rounds} rounds. In each round every empire's Ruler, General and Vizier each get one decision, all at the same time. Options are labeled A/B/C here; each student sees them in a random order. "Flags" are earlier choices the game remembers: they add extra lines, swap options, or prepare an army for a clash. Lines marked "only if" appear only when that earlier choice was made.`, '');
out.push(`**Scoring:** ${Object.entries(rules.stability).map(([t, s]) => `${B.soloRules.tiers[t].label}: ${B.soloRules.tiers[t].pointsMin} to +${B.soloRules.tiers[t].pointsMax} points per decision, starting stability ${s}`).join('; ')}. When stability reaches 0, the empire falls at the end of the round and loses half its points (at least ${B.soloRules.collapsePenalty.minimum}); its students play on in exile for half points.`, '');
out.push(`**Clashes:** the General's clash option has a battle strength (0–3). Each preparation flag the team holds adds ${rules.clashPrepPower}. The stronger side wins the prize region; on a tie, whoever holds it keeps it. A side with no team in the class plays its historical option; a fallen empire fights at strength 0.`, '');
if (flags) out.push(flags, '');
out.push('## Contents', '');
out.push('- [Clashes](#clashes)');
for (const id of battle.order) out.push(`- [${empireName(id)}](#${anchor(empireName(id))}) (${B.soloRules.tiers[B.empires[id].tier].label})`);
out.push('');

out.push('---', '', '## Clashes', '');
out.push('| Round | Clash | Sides | Prize (starts with) |', '|---|---|---|---|');
const shared = Object.fromEntries(B.clashes.sharedRegions.map((r) => [r.id, r]));
for (const c of Object.values(B.clashes.clashes).sort((a, b) => a.round - b.round)) {
  const sides = Object.keys(c.sides).map(empireName);
  if (c.ai) sides.push(`${c.ai.name} (computer, strength ${c.ai.power})`);
  const startOwner = shared[c.prize]?.owner || Object.keys(B.campaigns).find((e) => B.campaigns[e].regions.some((r) => r.id === c.prize && r.start));
  out.push(`| ${ROMAN[c.round]} | [${c.title} (${c.year})](#${anchor(`${c.title} ${c.year}`)}) | ${sides.join(' vs. ')} | ${region(c.prize)} (${startOwner === 'ai' ? c.ai?.name || 'computer' : empireName(startOwner)}) |`);
}
out.push('');
for (const c of Object.values(B.clashes.clashes).sort((a, b) => a.round - b.round)) {
  out.push(`### ${c.title} ${c.year}`, '');
  out.push(`**Round ${ROMAN[c.round]}.** Prize: **${region(c.prize)}**.${c.ai ? ` The computer plays ${c.ai.name} at strength ${c.ai.power}.` : ''}`, '');
  for (const [emp, side] of Object.entries(c.sides)) {
    out.push(`#### ${empireName(emp)}'s General: ${side.node.title} (${side.node.year})`, '');
    out.push(`> ${side.node.text}`, '');
    out.push(`**What really happened:** option ${side.historical.toUpperCase()} (used when no team plays this empire).  `);
    out.push(`**Preparation:** ${side.prep.length ? side.prep.map((p) => `\`${p.flag}\` (${p.why})`).join(', ') : 'none'}.  `);
    out.push(`**If they win:** ${side.win}  `);
    out.push(`**If they lose:** ${side.lose}${side.onLose ? ` (also: ${[side.onLose.lose ? `loses ${asList(side.onLose.lose).map(region).join(', ')}` : '', side.onLose.stability ? `stability ${fmt(side.onLose.stability)}` : ''].filter(Boolean).join(', ')})` : ''}`, '');
    out.push(...options(side.node, { clash: true }));
  }
  if (c.scene) out.push(`🗺 **Map scene ("What really happened" on the projector): "${c.scene.title}" (${c.scene.year}).** ${c.scene.caption}`, '');
}

for (const id of battle.order) {
  const camp = B.campaigns[id];
  const tier = B.soloRules.tiers[B.empires[id].tier];
  out.push('---', '', `## ${empireName(id)}`, '');
  out.push(`**Tier:** ${tier.label} (${tier.pointsMin} to +${tier.pointsMax} points per decision, starting stability ${rules.stability[B.empires[id].tier]}). **Best possible team score:** ${maxScore(battle, id)}.  `);
  out.push(`**Offices:** ${ROLES.map((r) => `${rules.roles[r].label}: ${camp.titles[r]}`).join(' · ')}.  `);
  out.push(`**Regions on the map:** ${camp.regions.map((r) => `${r.name}${r.start ? ' (held at the start)' : ''}`).join(', ')}.`, '');
  camp.rounds.forEach((rd, i) => {
    out.push(`### Round ${ROMAN[i + 1]}: ${rd.title} (${rd.years})`, '');
    for (const role of ROLES) {
      const slot = rd[role];
      if (slot.clash) {
        const c = B.clashes.clashes[slot.clash];
        out.push(`#### ${camp.titles[role]}: clash, ${c.title} (${c.year})`, '', `See [${c.title} ${c.year}](#${anchor(`${c.title} ${c.year}`)}) above.`, '');
        continue;
      }
      out.push(`#### ${camp.titles[role]}: ${slot.title} (${slot.year})`, '');
      out.push(`> ${slot.text}`, '');
      out.push(...options(slot));
    }
  });
}

writeFileSync(path.join(ROOT, 'docs', 'BATTLE_CONTENT_REVIEW.md'), out.join('\n'));
console.log(`Wrote docs/BATTLE_CONTENT_REVIEW.md (${out.length} lines).`);
