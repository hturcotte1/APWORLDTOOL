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
