// Pure game logic, shared by the Worker, the scripts and the tests.
// Nothing in this file touches the network, the database or the page.
//
// A game is replayed from the list of option ids the player picked, so the
// server never has to trust a score sent by the browser.

export class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// An item (option or context line) can carry `if` / `ifNot` flag conditions.
export function conditionMet(item, flags) {
  return (
    asList(item.if).every((f) => flags.includes(f)) &&
    asList(item.ifNot).every((f) => !flags.includes(f))
  );
}

export function visibleOptions(node, flags) {
  return node.options.filter((o) => conditionMet(o, flags));
}

export function contextLines(node, flags) {
  return (node.context || []).filter((c) => conditionMet(c, flags)).map((c) => c.text);
}

export function tierOf(rules, empire) {
  const tier = rules.tiers[empire.tier];
  if (!tier) throw new GameError('bad_tier', `Unknown tier "${empire.tier}" for ${empire.id}`);
  return tier;
}

export function collapsePenalty(rules, points) {
  const p = rules.collapsePenalty;
  return Math.max(p.minimum, Math.round(Math.max(points, 0) * p.fraction));
}

export function startState(empire, rules) {
  const stability = tierOf(rules, empire).stability;
  return {
    nodeId: empire.start,
    flags: [],
    stability,
    maxStability: stability,
    points: 0,
    history: [],
    ending: null,
  };
}

export function applyChoice(empire, rules, state, optionId) {
  if (state.ending) throw new GameError('game_over', 'This game has already ended.');
  const node = empire.nodes[state.nodeId];
  if (!node) throw new GameError('bad_node', `Missing node ${state.nodeId}`);
  const options = visibleOptions(node, state.flags);
  const option = options.find((o) => o.id === optionId);
  if (!option) throw new GameError('bad_option', `Option "${optionId}" is not available here.`);

  const best = options.reduce((a, b) => (b.points > a.points ? b : a));
  const flags = [...state.flags];
  for (const f of asList(option.set)) if (!flags.includes(f)) flags.push(f);

  const stability = Math.min(
    state.maxStability,
    Math.max(0, state.stability + (option.stability || 0)),
  );
  const points = state.points + option.points;

  const entry = {
    nodeId: state.nodeId,
    optionId,
    year: node.year,
    title: node.title,
    choice: option.text,
    points: option.points,
    stabilityDelta: stability - state.stability,
    explanation: option.explanation,
    best: best.id === option.id ? null : { text: best.text, points: best.points },
  };
  const history = [...state.history, entry];

  let ending = null;
  let nodeId = state.nodeId;
  if (option.collapse || stability <= 0) {
    const penalty = collapsePenalty(rules, points);
    ending = {
      type: 'collapsed',
      cause: option.collapse ? 'disaster' : 'stability',
      year: (option.collapse && option.collapse.year) || node.year,
      text: (option.collapse && option.collapse.text) || empire.collapse.text,
      points,
      penalty,
      finalScore: points - penalty,
    };
  } else if (option.next === 'end') {
    ending = {
      type: 'survived',
      cause: null,
      year: empire.endYear,
      text: empire.survive.text,
      points,
      penalty: 0,
      finalScore: points,
    };
  } else {
    nodeId = option.next;
  }
  return { ...state, nodeId, flags, stability, points, history, ending };
}

export function replay(empire, rules, choices) {
  if (!Array.isArray(choices)) throw new GameError('bad_choices', 'choices must be a list');
  let state = startState(empire, rules);
  for (const id of choices) state = applyChoice(empire, rules, state, String(id));
  return state;
}

// Walk every possible play-through. Calls visit(path) for each finished game,
// where path = { choices, state }. Returns nothing; used by scripts and tests.
export function forEachPath(empire, rules, visit) {
  const walk = (state, choices) => {
    if (state.ending) return visit({ choices, state });
    const node = empire.nodes[state.nodeId];
    for (const o of visibleOptions(node, state.flags)) {
      walk(applyChoice(empire, rules, state, o.id), [...choices, o.id]);
    }
  };
  walk(startState(empire, rules), []);
}

// Highest final score reachable for an empire (used for the end-screen rating).
const maxCache = new WeakMap();
export function maxScore(empire, rules) {
  if (maxCache.has(empire)) return maxCache.get(empire);
  let best = -Infinity;
  forEachPath(empire, rules, ({ state }) => {
    if (state.ending.finalScore > best) best = state.ending.finalScore;
  });
  maxCache.set(empire, best);
  return best;
}

export function ratingFor(ending, max) {
  if (ending.type === 'collapsed') return 'Collapsed';
  const pct = max > 0 ? ending.finalScore / max : 0;
  if (pct >= 0.9) return 'Legendary Ruler';
  if (pct >= 0.7) return 'Skilled Ruler';
  if (pct >= 0.45) return 'Survivor';
  return 'Barely Hanging On';
}

// What the browser is allowed to see: the current decision without points,
// the result of the last choice, and (when finished) the full recap.
export function publicView(empire, rules, state) {
  const last = state.history[state.history.length - 1] || null;
  const view = {
    empire: empire.id,
    decision: state.history.length + (state.ending ? 0 : 1),
    points: state.points,
    stability: state.stability,
    maxStability: state.maxStability,
    lastResult: last && {
      year: last.year,
      title: last.title,
      choice: last.choice,
      points: last.points,
      stabilityDelta: last.stabilityDelta,
      explanation: last.explanation,
    },
    node: null,
    ending: null,
  };
  if (state.ending) {
    const max = maxScore(empire, rules);
    view.ending = {
      ...state.ending,
      maxScore: max,
      rating: ratingFor(state.ending, max),
      recap: state.history.map((h, i) => ({
        decision: i + 1,
        year: h.year,
        title: h.title,
        choice: h.choice,
        points: h.points,
        stabilityDelta: h.stabilityDelta,
        best: h.best,
      })),
      timeline: empire.timeline,
    };
  } else {
    const node = empire.nodes[state.nodeId];
    view.node = {
      id: state.nodeId,
      year: node.year,
      title: node.title,
      milestone: !!node.milestone,
      text: node.text,
      context: contextLines(node, state.flags),
      options: visibleOptions(node, state.flags).map((o) => ({ id: o.id, text: o.text })),
    };
  }
  return view;
}
