-- Class Battle results, saved when a battle finishes. Like the leaderboard,
-- only first names, period, empire, role, and score are kept.
--   battles         one row per finished battle (teams = final team results)
--   battle_players  one row per student in that battle
CREATE TABLE IF NOT EXISTS battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period IN (1, 2, 3)),
  finished_at TEXT NOT NULL DEFAULT (datetime('now')),
  teams TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS battle_players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  empire TEXT NOT NULL,
  roles TEXT NOT NULL,
  score INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS battle_players_battle ON battle_players (battle_id);
