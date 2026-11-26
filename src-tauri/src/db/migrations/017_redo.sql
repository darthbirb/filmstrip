-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "The undo journal" describes this column and the rules it keeps.

-- A row an undo took back stays as the redo, numbered by the undo that took it, until the next
-- act is journalled.
ALTER TABLE journal ADD COLUMN undone INTEGER;
CREATE INDEX idx_journal_undone ON journal(undone) WHERE undone IS NOT NULL;
