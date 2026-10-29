-- One row per student per class period. Only the first attempt is stored;
-- later attempts are practice runs and are never saved.
--   name       first name as typed (tidied up)
--   name_key   lowercase name with extra spaces removed, used for matching
--   period     class period (1, 2 or 3)
--   empire     which empire they played
--   score      final score (empty while the game is still being played)
--   outcome    'playing', 'survived' or 'collapsed'
--   token      random game code that lets the student's device keep playing
--   progress   list of choices made so far, so the server can check the score
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  period INTEGER NOT NULL CHECK (period IN (1, 2, 3)),
  empire TEXT NOT NULL,
  score INTEGER,
  outcome TEXT NOT NULL DEFAULT 'playing' CHECK (outcome IN ('playing', 'survived', 'collapsed')),
  token TEXT NOT NULL UNIQUE,
  progress TEXT NOT NULL DEFAULT '[]',
  UNIQUE (name_key, period)
);
CREATE INDEX IF NOT EXISTS entries_period ON entries (period);
