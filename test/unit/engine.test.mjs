import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, plannedPaths } from '../helpers/content.mjs';
import {
  startState, applyChoice, replay, visibleOptions, collapsePenalty, forEachPath, maxScore, ratingFor, publicView, GameError,
} from '../../src/engine.js';

const { rules, empires } = content;

test('points add up and stability drops on bad choices', () => {
  const e = empires.ottoman;
  let s = startState(e, rules);
  assert.equal(s.points, 0);
  assert.equal(s.stability, 3);
  s = applyChoice(e, rules, s, 'c'); // leave Constantinople alone: -1, stability -1
  assert.equal(s.points, -1);
  assert.equal(s.stability, 2);
  assert.equal(s.nodeId, 'walls');
  s = applyChoice(e, rules, s, 'a'); // build the cannons late: +4
  assert.equal(s.points, 3);
  assert.equal(s.history.length, 2);
  assert.deepEqual(s.history[1].best, null, 'best option chosen -> no "best" hint');
  assert.equal(s.history[0].best.points, 6, 'recap shows the best option for a weaker choice');
});

test('collapse penalty is half the points, at least 10', () => {
  assert.equal(collapsePenalty(rules, 0), 10);
  assert.equal(collapsePenalty(rules, 12), 10);
  assert.equal(collapsePenalty(rules, 30), 15);
  assert.equal(collapsePenalty(rules, 51), 26);
  assert.equal(collapsePenalty(rules, -8), 10);
});

test('running out of stability collapses the empire with a penalty', () => {
  const e = empires.spain; // hard: stability 2
  let s = startState(e, rules);
  s = applyChoice(e, rules, s, 'c'); // -2, stability 1
  assert.equal(s.ending, null);
  s = applyChoice(e, rules, s, 'c'); // second_chance c: -2 (no stability loss)
  assert.equal(s.ending, null);
  s = applyChoice(e, rules, s, 'b'); // aztecs b: -2, stability 0 -> collapse
  assert.equal(s.ending.type, 'collapsed');
  assert.equal(s.ending.cause, 'stability');
  assert.equal(s.ending.points, -6);
  assert.equal(s.ending.penalty, 10);
  assert.equal(s.ending.finalScore, -16);
  assert.equal(s.ending.year, 1521);
});

test('a disastrous choice collapses the empire immediately', () => {
  const e = empires.songhai;
  const { collapse } = plannedPaths(e);
  const s = replay(e, rules, collapse.choices);
  assert.equal(s.ending.type, 'collapsed');
  const total = s.history.reduce((t, h) => t + h.points, 0);
  assert.equal(s.ending.points, total);
  assert.equal(s.ending.finalScore, total - collapsePenalty(rules, total));
});

test('every path in every empire scores exactly the sum of its choices (minus any collapse penalty)', () => {
  for (const e of Object.values(empires)) {
    let n = 0;
    forEachPath(e, rules, ({ state }) => {
      n++;
      const sum = state.history.reduce((t, h) => t + h.points, 0);
      const expected = state.ending.type === 'collapsed' ? sum - collapsePenalty(rules, sum) : sum;
      assert.equal(state.ending.finalScore, expected);
    });
    assert.ok(n > 100, `${e.id} should have many paths`);
  }
});

test('the best path for each empire reaches the maximum score and survives', () => {
  for (const e of Object.values(empires)) {
    const { best } = plannedPaths(e);
    assert.equal(best.state.ending.type, 'survived');
    assert.equal(best.state.ending.finalScore, maxScore(e, rules));
    assert.equal(ratingFor(best.state.ending, maxScore(e, rules)), 'Legendary Ruler');
  }
});

test('earlier choices change later options (flags)', () => {
  const e = empires.ottoman;
  const withCannons = replay(e, rules, ['a', 'a']);
  const withoutCannons = replay(e, rules, ['b', 'b']);
  const ids = (s) => visibleOptions(e.nodes[s.nodeId], s.flags).map((o) => o.id).sort();
  assert.equal(withCannons.nodeId, 'chaldiran');
  assert.equal(withoutCannons.nodeId, 'chaldiran');
  assert.deepEqual(ids(withCannons), ['a', 'b', 'c']);
  assert.deepEqual(ids(withoutCannons), ['a2', 'b', 'c']);
});

test('invalid moves are rejected', () => {
  const e = empires.mughal;
  assert.throws(() => replay(e, rules, ['z']), GameError);
  const { best } = plannedPaths(e);
  assert.throws(() => replay(e, rules, [...best.choices, 'a']), GameError);
});

test('the public view never reveals points before a choice', () => {
  const e = empires.safavid;
  const view = publicView(e, rules, startState(e, rules));
  const json = JSON.stringify(view.node);
  assert.ok(!json.includes('points'));
  assert.ok(!json.includes('explanation'));
  assert.equal(view.node.options.length, 3);
});
