-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Destination keys" describes the rules these keep.

-- A digit bound to a folder, so a press moves files there. It names the folder, not its path, so a
-- rename or a move keeps it; a folder retired by a delete keeps its row and so its key, which an
-- undo makes work again. A folder deleted outright, as removing its source does, takes its key.
CREATE TABLE destination_key (
  key       TEXT    PRIMARY KEY CHECK (key GLOB '[0-9]'),
  folder_id INTEGER NOT NULL UNIQUE REFERENCES folder(id) ON DELETE CASCADE
);
