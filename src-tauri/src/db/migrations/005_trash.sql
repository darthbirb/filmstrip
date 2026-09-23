-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Lifecycle" describes the rules these keep.

-- A trashed item has left its folder: its file is in the app's trash, and its name there is free
-- for another file. A retired item, whose file a walk found gone, still holds its name, so the file
-- coming back is the same item.
ALTER TABLE item ADD COLUMN trashed_at INTEGER;

DROP INDEX idx_item_disk;
CREATE UNIQUE INDEX idx_item_disk
    ON item(folder_id, disk_name COLLATE NOCASE)
 WHERE trashed_at IS NULL;
