-- When the file was last read for its shape, length and dates. NULL means never, or changed since:
-- a walk that refreshes an item clears it, and the index job queues every one still NULL.
ALTER TABLE item ADD COLUMN probed_at INTEGER;
