// Loads the game content from disk for the Node scripts and tests.
// (The Worker bundles the same JSON files through src/content.js.)
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTENT_DIR = path.join(ROOT, 'content');

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${err.message}`);
  }
};

export function loadContent() {
  const rules = readJson(path.join(CONTENT_DIR, 'rules.json'));
  const glossary = readJson(path.join(CONTENT_DIR, 'glossary.json'));
  const files = readdirSync(path.join(CONTENT_DIR, 'empires')).filter((f) => f.endsWith('.json'));
  const empires = {};
  for (const f of files) {
    const data = readJson(path.join(CONTENT_DIR, 'empires', f));
    data._file = `content/empires/${f}`;
    empires[f.replace(/\.json$/, '')] = data;
  }
  return { rules, glossary, empires, files };
}

// Class Battle content: rules, clashes, and one campaign per empire.
export function loadBattle(content = loadContent()) {
  const dir = path.join(CONTENT_DIR, 'battle');
  const battleRules = readJson(path.join(dir, 'rules.json'));
  const clashes = readJson(path.join(dir, 'clashes.json'));
  const campaigns = {};
  for (const f of readdirSync(path.join(dir, 'campaigns')).filter((x) => x.endsWith('.json'))) {
    const data = readJson(path.join(dir, 'campaigns', f));
    data._file = `content/battle/campaigns/${f}`;
    campaigns[f.replace(/\.json$/, '')] = data;
  }
  return { soloRules: content.rules, empires: content.empires, glossary: content.glossary, battleRules, clashes, campaigns };
}
