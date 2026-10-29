// A tiny stand-in for Cloudflare D1 built on Node's SQLite, so the API can be
// tested without a network or a Cloudflare account. Same methods the app uses.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../scripts/lib/load-content.mjs';

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }
  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r })) };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createTestDb() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(ROOT, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(dir, f), 'utf8'));
  return { prepare: (sql) => new Statement(db, sql), raw: db };
}
