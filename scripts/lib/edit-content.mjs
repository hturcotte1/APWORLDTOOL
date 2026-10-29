// Helper for scripted content edits: replace text inside one field and fail
// loudly if the old text isn't found. Paths look like:
//   "intro", "nodes.horde.text", "nodes.law_code.options.c.text",
//   "glossary.Tatars.def", "timeline.1545.text"
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR } from './load-content.mjs';
import { formatJson } from './format-json.mjs';

function resolve(obj, p) {
  const parts = p.split('.');
  const key = parts.pop();
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i];
    if (Array.isArray(cur)) {
      cur = cur.find((x) => x.id === k || x.term === k || String(x.year) === k) ?? (/^\d$/.test(k) ? cur[Number(k)] : undefined);
    } else if (k === 'options' && Array.isArray(cur.options)) {
      const id = parts[++i];
      cur = cur.options.find((o) => o.id === id);
    } else cur = cur[k];
    if (cur == null) throw new Error(`path not found: ${p} (at ${k})`);
  }
  return [cur, key];
}

export function editEmpire(file, edits) {
  const p = file.endsWith('.json') ? path.join(CONTENT_DIR, file) : path.join(CONTENT_DIR, 'empires', `${file}.json`);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  for (const [fieldPath, oldText, newText] of edits) {
    const [obj, key] = resolve(data, fieldPath);
    if (oldText === null) { obj[key] = newText; continue; }
    if (typeof obj[key] !== 'string' || !obj[key].includes(oldText)) throw new Error(`${file}: "${oldText}" not found in ${fieldPath}: ${JSON.stringify(obj[key])}`);
    obj[key] = obj[key].replace(oldText, newText);
  }
  writeFileSync(p, formatJson(data) + '\n');
  return data;
}
