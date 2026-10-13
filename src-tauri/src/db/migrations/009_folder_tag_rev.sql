-- Never edited once shipped; later changes are new numbered files.
-- docs/SCHEMA.md "Indexes" describes what this holds.

CREATE INDEX idx_folder_tag_rev ON folder_tag(tag_id, folder_id);
