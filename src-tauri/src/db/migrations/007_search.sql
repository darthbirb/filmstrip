-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Query language" describes what these hold and when they change.

-- A file's name and everything it carries, tokenised. Each table keeps its own copy of the
-- text, so a row is replaced by its rowid, which is the item's or the folder's id.
CREATE VIRTUAL TABLE item_fts USING fts5(name, tags);

-- A folder's own tags only, its title's among them: never an ancestor's.
CREATE VIRTUAL TABLE folder_fts USING fts5(tags);

INSERT INTO item_fts (rowid, name, tags)
SELECT i.id, i.disk_name,
       COALESCE((SELECT group_concat(t.value, ' ')
                   FROM item_effective_tag e JOIN tag t ON t.id = e.tag_id
                  WHERE e.item_id = i.id), '')
  FROM item i;

INSERT INTO folder_fts (rowid, tags)
SELECT f.id,
       COALESCE((SELECT group_concat(t.value, ' ')
                   FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = f.id), '')
  FROM folder f;
