-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Lifecycle" describes what this holds and when it changes.

-- A file that expired from the trash to the Recycle Bin: its row is forgotten, and this says what
-- it was, the folder it left and which limit sent it, for a restore that asks for it afterwards.
-- `days` for one past the time to live, `bytes` for one sent to keep the trash under its total.
CREATE TABLE expired (
  item_id    INTEGER PRIMARY KEY,
  disk_name  TEXT    NOT NULL,
  folder_id  INTEGER NOT NULL,
  days       INTEGER,
  bytes      INTEGER,
  expired_at INTEGER NOT NULL,
  CHECK ((days IS NULL) <> (bytes IS NULL))
);

-- The trash, oldest first, and what it weighs, which a run asks again before each file it sends.
CREATE INDEX idx_item_trashed ON item(trashed_at, size_bytes) WHERE trashed_at IS NOT NULL;
