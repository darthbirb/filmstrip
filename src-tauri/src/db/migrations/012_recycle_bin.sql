-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Where things live on disk" describes what these hold.

-- A trashed item's file is in the Windows Recycle Bin: `bin_path` is the name the bin keeps it
-- under, and `bin_file` the file itself on its volume, so it is found again there or back where
-- it was.
ALTER TABLE item ADD COLUMN bin_path TEXT;
ALTER TABLE item ADD COLUMN bin_file TEXT;

-- The trash keeps no limits of its own, so nothing expires from it.
DROP TABLE expired;
DELETE FROM setting WHERE key = 'expiry_refused';
