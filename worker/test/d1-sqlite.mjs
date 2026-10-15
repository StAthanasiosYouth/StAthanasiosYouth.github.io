// A D1-compatible binding over node:sqlite, for tests: real SQL, real
// constraints, the same migrations. batch() is one transaction, like D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Stmt(this.db, this.sql, params); }
  _exec() {
    const st = this.db.raw.prepare(this.sql);
    if (/^\s*(SELECT|WITH)|RETURNING/i.test(this.sql)) {
      const rows = st.all(...this.params);
      return { results: rows.map(r => ({ ...r })), meta: { changes: rows.length && /RETURNING/i.test(this.sql) ? rows.length : 0, duration: 0 } };
    }
    const info = st.run(...this.params);
    return { results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid), duration: 0 } };
  }
  async run() { this.db._maybeFail(); return { success: true, ...this._exec() }; }
  async all() { this.db._maybeFail(); return { success: true, ...this._exec() }; }
  async first(col) { this.db._maybeFail(); const r = this._exec().results[0]; return r == null ? null : col ? r[col] : r; }
}

export class D1Sqlite {
  constructor() { this.raw = new DatabaseSync(':memory:'); this.failNext = 0; }
  prepare(sql) { return new Stmt(this, sql); }
  _maybeFail() {
    if (this.failNext > 0) { this.failNext--; throw new Error('D1_ERROR: Network connection lost.'); }
  }
  async batch(stmts) {
    this._maybeFail();
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map(s => ({ success: true, ...s._exec() }));
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql) { this.raw.exec(sql); return { count: 1 }; }
}

export function migratedDb() {
  const db = new D1Sqlite();
  const dir = new URL('../migrations/', import.meta.url);
  db.raw.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT)');
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    db.raw.exec(readFileSync(new URL(f, dir), 'utf8'));
    db.raw.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
  }
  return db;
}
