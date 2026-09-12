-- Work done in the background: walking the sources, making thumbnails. A job is deleted when it
-- succeeds; a failure stays, with its error, until the next walk or a retry.
CREATE TABLE job (
  id         INTEGER PRIMARY KEY,
  kind       TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('pending', 'running', 'failed')),
  priority   INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_job_claim ON job(status, priority DESC, id);
