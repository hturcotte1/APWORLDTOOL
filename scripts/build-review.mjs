#!/usr/bin/env node
// Builds docs/CONTENT_REVIEW.md: every empire's decisions, options, points,
// stability effects and explanations in one readable document, with the
// flagged (uncertain or debated) facts from docs/ACCURACY_FLAGS.md at the top.
//
//   npm run review-doc
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, ROOT } from './lib/load-content.mjs';
import { asList, startState, applyChoice, visibleOptions } from '../src/engine.js';

const { rules, glossary, empires } = loadContent();
const flags = readFileSync(path.join(ROOT, 'docs', 'ACCURACY_FLAGS.md'), 'utf8').trim();
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);

// Order nodes the way players meet them: breadth-first from the start.
function nodeOrder(e) {
  const seen = [];
  const queue = [e.start];
  while (queue.length) {
    const id = queue.shift();
    if (seen.includes(id)) continue;
    seen.push(id);
    for (const o of e.nodes[id].options) if (o.next && o.next !== 'end' && !seen.includes(o.next)) queue.push(o.next);
  }
  return seen.sort((a, b) => e.nodes[a].year - e.nodes[b].year || seen.indexOf(a) - seen.indexOf(b));
}

function bestPath(e) {
  let s = startState(e, rules);
  const steps = [];
  while (!s.ending) {
    const opts = visibleOptions(e.nodes[s.nodeId], s.flags);
    const top = opts.reduce((a, b) => (b.points > a.points ? b : a));
    steps.push(`${e.nodes[s.nodeId].title} (${top.id.toUpperCase()})`);
    s = applyChoice(e, rules, s, top.id);
  }
  return { steps, score: s.ending.finalScore };
}

const condition = (x) => {
  const parts = [];
  if (x.if) parts.push(`only if: ${asList(x.if).join(', ')}`);
  if (x.ifNot) parts.push(`only if NOT: ${asList(x.ifNot).join(', ')}`);
  return parts.length ? ` _(${parts.join('; ')})_` : '';
};

const out = [];
out.push('# Content Review: Rule the Empire', '');
out.push('This document lists every decision in the game so you can spot-check it. It is generated from the content files by `npm run review-doc`, so it always matches what students see.', '');
out.push('**How to read it:** each empire has 12–15 decisions, but a student sees only about 8 in one play-through. Options are labeled A/B/C here; in the game they appear in a random order. "Next" shows where each choice leads. "Stability −1" means the choice weakens the empire; if stability runs out, the empire collapses. "Flags" are earlier choices the game remembers to change later situations.', '');
out.push(`**Scoring rules:** ${Object.values(rules.tiers).map((t) => `${t.label}: ${t.pointsMin} to +${t.pointsMax} points per decision, starting stability ${t.stability}`).join('; ')}. ${rules.collapsePenalty.explain}`, '');
out.push(flags, '');
out.push('## Contents', '');
for (const id of rules.empireOrder) out.push(`- [${empires[id].name}](#${empires[id].name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-')}) (${rules.tiers[empires[id].tier].label})`);
out.push('- [Shared key terms](#shared-key-terms)', '');

for (const id of rules.empireOrder) {
  const e = empires[id];
  const tier = rules.tiers[e.tier];
  const best = bestPath(e);
  out.push('---', '', `## ${e.name}`, '');
  out.push(`**Tier:** ${tier.label} (${tier.pointsMin} to +${tier.pointsMax} points per decision, starting stability ${tier.stability}). **Years:** ${e.startYear}–${e.endYear}.  `);
  out.push(`**Why ${tier.label.toLowerCase()}:** ${e.tierReason}  `);
  out.push(`**Intro shown to students:** ${e.intro}`, '');
  out.push(`**Best possible path (${best.score} points):** ${best.steps.join(' → ')}`, '');
  out.push(`**If the empire survives:** ${e.survive.text}  `);
  out.push(`**If it collapses (default text):** ${e.collapse.text}`, '');
  out.push('### Real-history timeline (end screen)', '');
  for (const t of e.timeline) out.push(`- **${t.year}:** ${t.text}`);
  out.push('');
  for (const nid of nodeOrder(e)) {
    const n = e.nodes[nid];
    out.push(`### ${n.year} · ${n.title}${n.milestone ? ' ★ turning point (every player sees this)' : ''}`, '');
    out.push(`<sub>id: \`${nid}\`</sub>`, '');
    out.push(`> ${n.text}`, '');
    for (const c of n.context || []) out.push(`- _Extra line shown${condition(c).replace(' _(', ' (').replace(')_', ')')}:_ ${c.text}`);
    if ((n.context || []).length) out.push('');
    for (const o of n.options) {
      const effects = [`**${fmt(o.points)} points**`];
      if (o.stability) effects.push(`stability ${fmt(o.stability)}`);
      if (o.collapse) effects.push(`**EMPIRE COLLAPSES (${o.collapse.year || n.year})**`);
      else effects.push(`next: ${o.next === 'end' ? 'END (survived)' : `\`${o.next}\``}`);
      if (o.set) effects.push(`sets flag: ${asList(o.set).join(', ')}`);
      out.push(`**${o.id.toUpperCase()}.** ${o.text}${condition(o)}  `);
      out.push(`${effects.join(' · ')}  `);
      out.push(`_What actually happened:_ ${o.explanation}${o.collapse ? `  \n_Collapse text:_ ${o.collapse.text}` : ''}`, '');
    }
  }
  if (e.glossary?.length) {
    out.push(`### Key terms defined in the ${e.name} story`, '');
    for (const g of e.glossary) out.push(`- **${g.term}**: ${g.def}`);
    out.push('');
  }
}
out.push('---', '', '## Shared key terms', '', 'Defined the first time they appear in any empire (an empire can override one with its own definition).', '');
for (const g of glossary.terms) out.push(`- **${g.term}**: ${g.def}`);
out.push('');

writeFileSync(path.join(ROOT, 'docs', 'CONTENT_REVIEW.md'), out.join('\n'));
console.log(`Wrote docs/CONTENT_REVIEW.md (${out.length} lines).`);
