// Leaderboard storage (Cloudflare D1, which is SQLite).

export async function findEntry(db, nameKey, period) {
  return db.prepare('SELECT * FROM entries WHERE name_key = ? AND period = ?').bind(nameKey, period).first();
}

export async function findByToken(db, token) {
  return db.prepare('SELECT * FROM entries WHERE token = ?').bind(token).first();
}

// Creates the student's one official entry. Returns null if this name already
// has an entry in this period (so this attempt is a practice run).
export async function createEntry(db, { name, nameKey, period, empire, token }) {
  const res = await db
    .prepare(
      `INSERT INTO entries (name, name_key, period, empire, outcome, token, progress)
       VALUES (?, ?, ?, ?, 'playing', ?, '[]')
       ON CONFLICT (name_key, period) DO NOTHING`,
    )
    .bind(name, nameKey, period, empire, token)
    .run();
  return res.meta.changes === 1 ? findByToken(db, token) : null;
}

// Saves progress only if nobody else changed it first (guards against double clicks).
export async function saveProgress(db, id, oldProgress, newProgress, finished) {
  const res = finished
    ? await db
        .prepare(
          `UPDATE entries SET progress = ?, score = ?, outcome = ?
           WHERE id = ? AND progress = ? AND outcome = 'playing'`,
        )
        .bind(newProgress, finished.score, finished.outcome, id, oldProgress)
        .run()
    : await db
        .prepare(`UPDATE entries SET progress = ? WHERE id = ? AND progress = ? AND outcome = 'playing'`)
        .bind(newProgress, id, oldProgress)
        .run();
  return res.meta.changes === 1;
}

export async function listEntries(db, period) {
  const sql = 'SELECT id, name, period, empire, score, outcome FROM entries';
  const res = period
    ? await db.prepare(`${sql} WHERE period = ? ORDER BY id`).bind(period).all()
    : await db.prepare(`${sql} ORDER BY id`).all();
  return res.results || [];
}

export async function deleteEntry(db, id) {
  const res = await db.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  return res.meta.changes;
}

export async function clearEntries(db, period) {
  const res = period
    ? await db.prepare('DELETE FROM entries WHERE period = ?').bind(period).run()
    : await db.prepare('DELETE FROM entries').run();
  return res.meta.changes;
}

// Count, average, and best score of each period's finished official games.
export async function periodStats(db) {
  const res = await db
    .prepare(
      `SELECT period, COUNT(*) AS games, AVG(score) AS average, MAX(score) AS best,
              SUM(CASE WHEN outcome = 'survived' THEN 1 ELSE 0 END) AS survived
       FROM entries WHERE outcome != 'playing' GROUP BY period`,
    )
    .all();
  return res.results || [];
}

// Every official game with its saved choices (for the teacher's class report).
export async function listGames(db) {
  const res = await db.prepare('SELECT period, empire, score, outcome, progress FROM entries ORDER BY id').all();
  return res.results || [];
}

// ---------- Class Battle results ----------
export async function saveBattle(db, { code, period, teams, players }) {
  const summary = teams.map((t) => ({ empire: t.empire, finalScore: t.finalScore, collapsed: t.collapsed, rating: t.rating }));
  const row = await db
    .prepare('INSERT INTO battles (code, period, teams) VALUES (?, ?, ?) RETURNING id')
    .bind(code, period, JSON.stringify(summary))
    .first();
  if (players.length) {
    await db.batch(players.map((p) => db
      .prepare('INSERT INTO battle_players (battle_id, name, empire, roles, score) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, p.name, p.empire, p.roles.join(','), p.score)));
  }
  return row.id;
}

export async function listBattles(db, limit = 20) {
  const battles = (await db.prepare('SELECT id, code, period, finished_at, teams FROM battles ORDER BY id DESC LIMIT ?').bind(limit).all()).results || [];
  if (!battles.length) return [];
  const ids = battles.map((b) => b.id);
  const players = (await db.prepare(`SELECT battle_id, name, empire, roles, score FROM battle_players WHERE battle_id IN (${ids.map(() => '?').join(',')}) ORDER BY score DESC`).bind(...ids).all()).results || [];
  return battles.map((b) => ({
    id: b.id,
    code: b.code,
    period: b.period,
    finishedAt: b.finished_at,
    teams: JSON.parse(b.teams),
    players: players.filter((p) => p.battle_id === b.id).map((p) => ({ name: p.name, empire: p.empire, roles: p.roles.split(','), score: p.score })),
  }));
}

export async function deleteBattle(db, id) {
  await db.prepare('DELETE FROM battle_players WHERE battle_id = ?').bind(id).run();
  const res = await db.prepare('DELETE FROM battles WHERE id = ?').bind(id).run();
  return res.meta.changes;
}
