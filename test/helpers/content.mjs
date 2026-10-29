// Test helpers: load content, find a strong path and a collapse path for an empire.
import { loadContent } from '../../scripts/lib/load-content.mjs';
import { forEachPath } from '../../src/engine.js';

export const content = loadContent();

// Best-scoring full path, and the collapse path that ends earliest (ties: lowest score).
export function plannedPaths(empire) {
  let best = null;
  let collapse = null;
  forEachPath(empire, content.rules, (p) => {
    const e = p.state.ending;
    if (e.type === 'survived' && (!best || e.finalScore > best.state.ending.finalScore)) best = p;
    if (e.type === 'collapsed') {
      const better = !collapse
        || p.choices.length < collapse.choices.length
        || (p.choices.length === collapse.choices.length && e.finalScore < collapse.state.ending.finalScore);
      if (better) collapse = p;
    }
  });
  return { best, collapse };
}
