#!/usr/bin/env node
// Re-formats every content JSON file consistently (npm run format-content).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CONTENT_DIR } from './lib/load-content.mjs';
import { formatJson } from './lib/format-json.mjs';

const files = ['rules.json', 'glossary.json', ...readdirSync(path.join(CONTENT_DIR, 'empires')).map((f) => path.join('empires', f))];
for (const f of files) {
  const p = path.join(CONTENT_DIR, f);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, formatJson(data) + '\n');
}
console.log(`Formatted ${files.length} files.`);
