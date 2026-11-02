// Class Battle rules, tested on a small made-up battle so the mechanics are
// checked independently of the real content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, newGame, resolveRound, teamResult, maxScore, describe, decisionView } from '../../src/battle.js';

const opt = (id, points, extra = {}) => ({ id, text: `Option ${id}`, points, explanation: `What happened after ${id}.`, ...extra });
const node = (title, options, extra = {}) => ({ year: 1500, title, text: `${title}.`, options, ...extra });
const plain = (title, extra) => node(title, [opt('a', 5, extra?.a), opt('b', 2, extra?.b), opt('c', 0, extra?.c)]);

function fixture() {
  const soloRules = {
    empireOrder: ['alpha', 'beta', 'gamma'],
    tiers: {
      easy: { label: 'Easy', pointsMin: 0, pointsMax: 5 },
      hard: { label: 'Hard', pointsMin: -3, pointsMax: 8 },
    },
    collapsePenalty: { fraction: 0.5, minimum: 10 },
  };
  const empires = { alpha: { name: 'Alpha', tier: 'easy' }, beta: { name: 'Beta', tier: 'hard' }, gamma: { name: 'Gamma', tier: 'hard' } };
  const battleRules = { rounds: 2, stability: { easy: 3, hard: 2 }, clashPrepPower: 1, exileFactor: 0.5 };
  const sides = (power) => node('Clash', [opt('a', 5, { power: power[0] }), opt('b', 1, { power: power[1] }), opt('c', 0, { power: power[2] })]);
  const clashes = {
    sharedRegions: [{ id: 'pass', name: 'The Pass', at: [0, 0], size: [1, 1], owner: 'beta' }],
    clashes: {
      border: {
        round: 1, year: 1500, title: 'Border War', prize: 'pass',
        sides: {
          alpha: { historical: 'a', prep: [{ flag: 'guns', why: 'guns' }], win: 'Alpha wins.', lose: 'Alpha loses.', node: sides([2, 1, 0]) },
          beta: { historical: 'b', prep: [], win: 'Beta wins.', lose: 'Beta loses.', node: sides([2, 1, 0]) },
        },
      },
      raid: {
        round: 2, year: 1510, title: 'Raid', prize: 'home', ai: { name: 'Raiders', power: 2 },
        sides: { gamma: { historical: 'b', prep: [], win: 'Held.', lose: 'Lost.', onLose: { lose: ['home'], stability: -1 }, node: sides([3, 1, 0]) } },
      },
    },
  };
  const campaigns = {
    alpha: {
      regions: [{ id: 'core', start: true }, { id: 'east' }],
      rounds: [
        { ruler: plain('A1 ruler', { a: { gain: 'east' } }), general: { clash: 'border' }, vizier: plain('A1 vizier', { a: { set: ['guns'] } }) },
        {
          ruler: node('A2 ruler', [opt('a', 5), opt('b', 2), opt('c', 0, { ifNot: 'guns' }), opt('d', 1, { if: 'guns' })]),
          general: plain('A2 general'),
          vizier: plain('A2 vizier', { c: { lose: 'east', stability: -1 } }),
        },
      ],
    },
    beta: {
      regions: [{ id: 'hills', start: true }],
      rounds: [
        { ruler: plain('B1 ruler', { c: { stability: -1 } }), general: { clash: 'border' }, vizier: plain('B1 vizier', { c: { stability: -1 } }) },
        { ruler: plain('B2 ruler'), general: plain('B2 general'), vizier: plain('B2 vizier') },
      ],
    },
    gamma: {
      regions: [{ id: 'home', start: true }],
      rounds: [
        { ruler: plain('G1 ruler'), general: plain('G1 general'), vizier: plain('G1 vizier') },
        { ruler: plain('G2 ruler'), general: { clash: 'raid' }, vizier: plain('G2 vizier') },
      ],
    },
  };
  return makeBattle({ soloRules, empires, battleRules, campaigns, clashes });
}

test('only played empires get teams; shared regions start with their owners', () => {
  const b = fixture();
  const g = newGame(b, ['alpha', 'gamma']);
  assert.deepEqual(Object.keys(g.teams), ['alpha', 'gamma']);
  assert.equal(g.teams.alpha.stability, 3);
  assert.deepEqual(g.teams.alpha.regions, ['core']);
  assert.equal(g.owners.pass, 'beta');
});

test('points, regions, and flags: a flag set this round changes options next round', () => {
  const b = fixture();
  let g = newGame(b, ['alpha']);
  assert.deepEqual(decisionView(b, g, 'alpha', 2, 'ruler').options.map((o) => o.id), ['a', 'b', 'c']);
  g = resolveRound(b, g, { alpha: { ruler: 'a', general: 'b', vizier: 'a' } });
  const t = g.teams.alpha;
  assert.equal(t.points, 5 + 1 + 5);
  assert.deepEqual(t.regions, ['core', 'east']);
  assert.ok(t.flags.includes('guns'));
  assert.deepEqual(decisionView(b, g, 'alpha', 2, 'ruler').options.map((o) => o.id), ['a', 'b', 'd']);
  g = resolveRound(b, g, { alpha: { ruler: 'd', general: 'a', vizier: 'c' } });
  assert.deepEqual(g.teams.alpha.regions, ['core']);
  assert.equal(g.teams.alpha.stability, 2);
  const words = describe(b, 'alpha', g.teams.alpha.history.find((h) => h.round === 2 && h.role === 'ruler'));
  assert.equal(words.choice, 'Option d');
  assert.equal(words.best.text, 'Option a');
});

test('an option chosen from a later situation is refused (start-of-round flags decide what is visible)', () => {
  const b = fixture();
  let g = newGame(b, ['alpha']);
  g = resolveRound(b, g, { alpha: { ruler: 'a', general: 'a', vizier: 'b' } }); // no guns
  g = resolveRound(b, g, { alpha: { ruler: 'd', general: 'a', vizier: 'a' } }); // d needs guns
  const h = g.teams.alpha.history.find((x) => x.round === 2 && x.role === 'ruler');
  assert.equal(h.optionId, null);
  assert.equal(h.missed, true);
  assert.equal(h.points, 0);
});

test('a missed decision scores nothing and changes nothing', () => {
  const b = fixture();
  let g = newGame(b, ['alpha']);
  g = resolveRound(b, g, { alpha: { ruler: null, general: 'a' } });
  const missed = g.teams.alpha.history.filter((h) => h.missed).map((h) => h.role).sort();
  assert.deepEqual(missed, ['ruler', 'vizier']);
  assert.deepEqual(g.teams.alpha.regions, ['core']);
});

test('clash: power plus preparation wins the prize; same-round preparation counts', () => {
  const b = fixture();
  let g = newGame(b, ['alpha', 'beta']);
  // Both pick power 2; alpha's vizier sets "guns" this round, so alpha has 3.
  g = resolveRound(b, g, { alpha: { ruler: 'b', general: 'a', vizier: 'a' }, beta: { ruler: 'a', general: 'a', vizier: 'a' } });
  const c = g.reports[0].clashes[0];
  assert.equal(c.sides.alpha.power, 3);
  assert.deepEqual(c.sides.alpha.prep, ['guns']);
  assert.equal(c.winner, 'alpha');
  assert.equal(g.owners.pass, 'alpha');
  assert.equal(g.teams.alpha.history.find((h) => h.role === 'general').won, true);
  assert.equal(g.teams.beta.history.find((h) => h.role === 'general').won, false);
});

test('clash: a tie leaves the prize with whoever holds it; an absent side uses its historical choice', () => {
  const b = fixture();
  let g = newGame(b, ['alpha', 'beta']);
  g = resolveRound(b, g, { alpha: { ruler: 'b', general: 'a', vizier: 'b' }, beta: { ruler: 'a', general: 'a', vizier: 'a' } });
  assert.equal(g.reports[0].clashes[0].winner, 'beta'); // 2 vs 2, beta holds the pass
  let g2 = newGame(b, ['alpha']); // beta absent: historical "b" (power 1)
  g2 = resolveRound(b, g2, { alpha: { ruler: 'b', general: 'b', vizier: 'b' } });
  const c = g2.reports[0].clashes[0];
  assert.equal(c.sides.beta.played, false);
  assert.equal(c.sides.beta.power, 1);
  assert.equal(c.winner, 'beta'); // 1 vs 1 tie: beta keeps it
});

test('a clash against a computer enemy can cost regions and stability', () => {
  const b = fixture();
  let g = newGame(b, ['gamma']);
  g = resolveRound(b, g, { gamma: { ruler: 'a', general: 'a', vizier: 'a' } });
  g = resolveRound(b, g, { gamma: { ruler: 'a', general: 'b', vizier: 'a' } }); // power 1 vs raiders 2
  const c = g.reports[1].clashes[0];
  assert.equal(c.winner, 'ai');
  assert.deepEqual(g.teams.gamma.regions, []);
  assert.equal(g.teams.gamma.stability, 1);
  let w = newGame(b, ['gamma']);
  w = resolveRound(b, w, { gamma: { ruler: 'a', general: 'a', vizier: 'a' } });
  w = resolveRound(b, w, { gamma: { ruler: 'a', general: 'a', vizier: 'a' } }); // power 3 beats 2
  assert.equal(w.reports[1].clashes[0].winner, 'gamma');
  assert.deepEqual(w.teams.gamma.regions, ['home']);
});

test('an empire collapses when stability runs out; exiles keep deciding but change nothing', () => {
  const b = fixture();
  let g = newGame(b, ['beta']);
  g = resolveRound(b, g, { beta: { ruler: 'c', general: 'c', vizier: 'c' } }); // stability 2 -> 0
  assert.deepEqual(g.reports[0].collapsed, ['beta']);
  const t = g.teams.beta;
  assert.equal(t.collapsed, true);
  const pointsAtFall = t.points;
  g = resolveRound(b, g, { beta: { ruler: 'a', general: 'a', vizier: 'a' } });
  assert.equal(g.teams.beta.points, pointsAtFall);
  assert.equal(g.teams.beta.history.filter((h) => h.round === 2).every((h) => h.points === 0 && h.optionPoints === 5), true);
  const r = teamResult(b, g.teams.beta);
  assert.equal(r.collapsed, true);
  assert.equal(r.penalty, 10);
  assert.equal(r.finalScore, pointsAtFall - 10);
  assert.equal(r.rating, 'Collapsed');
});

test('max score follows the best path, including options that need flags', () => {
  const b = fixture();
  // alpha: round 1 = 5 + 5 (clash a) + 5; round 2 = 5 + 5 + 5
  assert.equal(maxScore(b, 'alpha'), 30);
});

test('the battle ends after the last round', () => {
  const b = fixture();
  let g = newGame(b, ['alpha']);
  g = resolveRound(b, g, {});
  g = resolveRound(b, g, {});
  assert.throws(() => resolveRound(b, g, {}), /over/);
});
