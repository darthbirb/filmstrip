-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "The undo journal" describes this table and the rules it keeps.

-- Every change the app makes on disk, with what reverses it. One undo reverses
-- a whole batch, newest row first.
CREATE TABLE journal (
  id         INTEGER PRIMARY KEY,
  batch_id   TEXT    NOT NULL,
  op         TEXT    NOT NULL,
  forward    TEXT    NOT NULL,
  inverse    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_journal_batch ON journal(batch_id);
