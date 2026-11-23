-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Uniqueness" describes the rules these keep.

-- NAME_FOLD, registered by the app on every connection, compares names as NTFS does beyond
-- ASCII: `Ägypten` and `ägypten` are one name, as they are on disk.
DROP INDEX idx_folder_sibling;
CREATE UNIQUE INDEX idx_folder_sibling
    ON folder(parent_id, title COLLATE NAME_FOLD)
 WHERE deleted_at IS NULL;

DROP INDEX idx_item_disk;
CREATE UNIQUE INDEX idx_item_disk
    ON item(folder_id, disk_name COLLATE NAME_FOLD)
 WHERE trashed_at IS NULL;
