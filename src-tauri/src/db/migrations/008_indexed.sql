-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Lifecycle" describes what this holds and when it changes.

-- When a walk last read the whole source. NULL until the first walk finishes.
ALTER TABLE source ADD COLUMN indexed_at INTEGER;
