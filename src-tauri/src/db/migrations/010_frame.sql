-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Lifecycle" describes what this holds and when it changes.

-- One of a video's frames, in microseconds, from its probe. NULL for a file probed before it.
ALTER TABLE item ADD COLUMN frame_us INTEGER;
