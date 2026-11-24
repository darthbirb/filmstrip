-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Where things live on disk" describes what these hold.

-- Whether the item's thumbnail, and a video's scrub frames, are in the cache, so a listing reads
-- it here instead of looking for each file. The job that makes one sets it, and every walk sets
-- both to what the cache holds.
ALTER TABLE item ADD COLUMN thumbed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN scrubbed INTEGER NOT NULL DEFAULT 0;
