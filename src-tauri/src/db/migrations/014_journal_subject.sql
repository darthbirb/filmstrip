-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "The undo journal" describes this table and the rules it keeps.

-- Each file and folder a journal row names as what it is about, one row each, written and
-- removed with the row by the triggers below. A rewrite of `inverse` that takes a file or folder
-- out of a row deletes its subject here itself.
CREATE TABLE journal_subject (
  entry_id  INTEGER NOT NULL,
  item_id   INTEGER,
  folder_id INTEGER
);
CREATE INDEX idx_journal_subject_entry ON journal_subject(entry_id);
CREATE INDEX idx_journal_subject_item ON journal_subject(item_id);
CREATE INDEX idx_journal_subject_folder ON journal_subject(folder_id);

CREATE TRIGGER journal_subject_insert AFTER INSERT ON journal BEGIN
  INSERT INTO journal_subject (entry_id, item_id, folder_id)
  SELECT NEW.id, s.item_id, s.folder_id FROM (
      SELECT json_extract(NEW.inverse, '$.itemId') AS item_id, NULL AS folder_id
       WHERE NEW.op IN ('item_move', 'item_trash', 'item_rename', 'item_restore', 'item_copy')
    UNION ALL
      SELECT NULL, json_extract(NEW.inverse, '$.folderId')
       WHERE NEW.op IN ('folder_create', 'folder_rename', 'folder_move', 'folder_delete',
                        'folder_copy')
    UNION ALL
      SELECT e.value, NULL FROM json_each(NEW.inverse, '$.itemIds') e
       WHERE NEW.op = 'items_tag'
    UNION ALL
      SELECT json_extract(e.value, '$.itemId'), NULL FROM json_each(NEW.inverse, '$.items') e
       WHERE NEW.op = 'items_untag'
    UNION ALL
      SELECT json_extract(e.value, '$.itemId'), NULL FROM json_each(NEW.inverse, '$.itemUses') e
       WHERE NEW.op = 'retag'
    UNION ALL
      SELECT NULL, json_extract(e.value, '$.folderId')
        FROM json_each(NEW.inverse, '$.folderUses') e
       WHERE NEW.op = 'retag'
  ) s
  WHERE s.item_id IS NOT NULL OR s.folder_id IS NOT NULL;
END;

CREATE TRIGGER journal_subject_delete AFTER DELETE ON journal BEGIN
  DELETE FROM journal_subject WHERE entry_id = OLD.id;
END;

INSERT INTO journal_subject (entry_id, item_id, folder_id)
SELECT s.entry_id, s.item_id, s.folder_id FROM (
    SELECT j.id AS entry_id, json_extract(j.inverse, '$.itemId') AS item_id, NULL AS folder_id
      FROM journal j
     WHERE j.op IN ('item_move', 'item_trash', 'item_rename', 'item_restore', 'item_copy')
  UNION ALL
    SELECT j.id, NULL, json_extract(j.inverse, '$.folderId')
      FROM journal j
     WHERE j.op IN ('folder_create', 'folder_rename', 'folder_move', 'folder_delete',
                    'folder_copy')
  UNION ALL
    SELECT j.id, e.value, NULL FROM journal j, json_each(j.inverse, '$.itemIds') e
     WHERE j.op = 'items_tag'
  UNION ALL
    SELECT j.id, json_extract(e.value, '$.itemId'), NULL
      FROM journal j, json_each(j.inverse, '$.items') e
     WHERE j.op = 'items_untag'
  UNION ALL
    SELECT j.id, json_extract(e.value, '$.itemId'), NULL
      FROM journal j, json_each(j.inverse, '$.itemUses') e
     WHERE j.op = 'retag'
  UNION ALL
    SELECT j.id, NULL, json_extract(e.value, '$.folderId')
      FROM journal j, json_each(j.inverse, '$.folderUses') e
     WHERE j.op = 'retag'
) s
WHERE s.item_id IS NOT NULL OR s.folder_id IS NOT NULL;
