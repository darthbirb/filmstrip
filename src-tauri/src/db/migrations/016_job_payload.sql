-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Indexes" describes what this is for.

-- A job is looked up by its kind and payload before another like it is queued, once per file a
-- walk finds; without this each lookup reads the whole table.
CREATE INDEX idx_job_payload ON job(kind, payload);
