-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md describes these tables and the rules they keep.

-- `root` is the only absolute path stored anywhere. No root may contain
-- another; the application checks before inserting.
CREATE TABLE source (
  id       INTEGER PRIMARY KEY,
  root     TEXT    NOT NULL UNIQUE,
  title    TEXT    NOT NULL,
  kind     TEXT    NOT NULL CHECK (kind IN ('library', 'sorting')),
  added_at INTEGER NOT NULL
);

-- A real directory; its path is derived from ancestry, never stored.
-- `source_id` is set on a source's root folder and nowhere else.
CREATE TABLE folder (
  id            INTEGER PRIMARY KEY,
  title         TEXT    NOT NULL,
  parent_id     INTEGER REFERENCES folder(id) ON DELETE CASCADE,
  source_id     INTEGER REFERENCES source(id),
  cover_item_id INTEGER REFERENCES item(id),
  status        TEXT    CHECK (status IN ('wip', 'complete') OR status IS NULL),
  status_set_at INTEGER,
  favorite      INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  last_added_at INTEGER,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_folder_parent ON folder(parent_id);
CREATE INDEX idx_folder_status ON folder(status, last_added_at);

-- NOCASE because Windows cannot hold `Ana` and `ana` side by side (ASCII only);
-- partial, so a trashed folder frees its spot.
CREATE UNIQUE INDEX idx_folder_sibling
    ON folder(parent_id, title COLLATE NOCASE)
 WHERE deleted_at IS NULL;

-- `parent_id IS NULL` means exactly one thing: a source's own root folder.
-- Two of them for one source is the bug this index exists to refuse.
CREATE UNIQUE INDEX idx_folder_one_root_per_source
    ON folder(source_id)
 WHERE parent_id IS NULL AND deleted_at IS NULL;

-- A real file. `folder_id` is NOT NULL: everything is somewhere. `uuid` is
-- identity, never a location; `source_id` must match the folder's ancestry.
CREATE TABLE item (
  id           INTEGER PRIMARY KEY,
  uuid         TEXT    NOT NULL UNIQUE,
  source_id    INTEGER NOT NULL REFERENCES source(id),
  folder_id    INTEGER NOT NULL REFERENCES folder(id),
  disk_name    TEXT    NOT NULL,
  ext          TEXT    NOT NULL,
  orig_name    TEXT,
  hash         TEXT,
  size_bytes   INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  width        INTEGER,
  height       INTEGER,
  duration_ms  INTEGER,
  codec        TEXT,
  bitrate      INTEGER,
  captured_at  INTEGER,
  captured_src TEXT,
  added_at     INTEGER NOT NULL,
  favorite     INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  phash        BLOB,
  deleted_at   INTEGER
);

-- Per directory, which is Windows' own rule. Two folders may each hold an
-- `IMG_0031.jpg`.
CREATE UNIQUE INDEX idx_item_disk     ON item(folder_id, disk_name COLLATE NOCASE);
CREATE INDEX        idx_item_folder   ON item(folder_id) WHERE deleted_at IS NULL;
CREATE INDEX        idx_item_source   ON item(source_id) WHERE deleted_at IS NULL;
CREATE INDEX        idx_item_hash     ON item(hash);
CREATE INDEX        idx_item_captured ON item(captured_at);
CREATE INDEX        idx_item_phash    ON item(phash);
CREATE INDEX        idx_item_favorite ON item(favorite) WHERE favorite = 1;

-- `key IS NULL` is a tag; a key and value together are a label, which only a
-- folder may carry — enforced in `db::tags`, since a CHECK cannot see items.
CREATE TABLE tag (
  id    INTEGER PRIMARY KEY,
  key   TEXT,
  value TEXT NOT NULL,
  UNIQUE(key, value)
);
CREATE INDEX idx_tag_value ON tag(value COLLATE NOCASE);
CREATE INDEX idx_tag_key   ON tag(key   COLLATE NOCASE);

-- `source` records what put it there: 'title' for the one derived from the
-- folder's own name, 'manual' for everything a person added.
CREATE TABLE folder_tag (
  folder_id INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tag(id),
  source    TEXT    NOT NULL,
  PRIMARY KEY (folder_id, tag_id)
);

CREATE TABLE item_tag (
  item_id  INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tag(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_item_tag_rev ON item_tag(tag_id, item_id);

-- Resolved inheritance, maintained on write. `origin_id` is the folder a tag
-- came from, NULL when the item carries it itself.
CREATE TABLE item_effective_tag (
  item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tag(id),
  origin_id INTEGER REFERENCES folder(id),
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_eff_rev ON item_effective_tag(tag_id, item_id);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
