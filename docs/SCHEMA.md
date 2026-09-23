# Schema

The tables, and the rules the data keeps. Facts only: why a rule exists is in the
migration's own comments and in [DECISIONS.md](DECISIONS.md).

The schema lives in `src-tauri/src/db/migrations/`, numbered and applied in order. Each
migration arrives with the feature that needs it and is never edited once shipped.

## Tables

| Table | Holds |
| --- | --- |
| `source` | A registered root: its absolute path, a title, and a kind — `library` or `sorting`. |
| `folder` | A real directory: title, parent, status, favourite, notes, cover. |
| `item` | A real file: its folder, its name on disk, its measurements, a uuid, and when it was last read. |
| `tag` | One distinct term: a tag (no key) or a label (a key and a value). |
| `folder_tag` | Terms on a folder, added by its title or by hand. |
| `item_tag` | Tags an item carries itself. |
| `item_effective_tag` | Everything an item carries once inheritance is resolved. |
| `setting` | Key-value pairs. |
| `journal` | Every change the app made on disk, with what reverses it, grouped into batches. |
| `job` | Background work: waiting, running, or failed with its error. |

## Where things live on disk

- **`source.root` is the only absolute path stored.**
- A folder's path is its source's root, then the title of every folder between that root and
  the folder itself. The source's own root folder contributes no title. Derived on every read,
  in `fs::paths::folder_dir`.
- An item's path is its folder's path joined with `disk_name`. A trashed item's file is in the
  app's trash instead, at `ab/cd/<uuid>.<ext>`, sharded as thumbnails are
  (`fs::paths::trash_path`); its row keeps the folder and name it left.
- **Every item has a folder.** A file waiting in a sorting source sits in that source's root
  folder or somewhere beneath it.
- `item.source_id` repeats what the folder's ancestry implies. `items::set_folder` derives it
  on a move; everything else that writes it passes the value its folder implies.

## Uniqueness

- One live folder per parent and title, compared case-insensitively. SQLite folds ASCII only,
  so `Ä` and `ä` are two titles.
- One root folder per source.
- One item per folder and `disk_name`, compared case-insensitively, among items not in the trash.
  A retired item keeps its name; a trashed one gives it up.
- `item.uuid` is unique. It is identity and the thumbnail cache key — never a location.
- `source.root` is unique, and the application also refuses a root that sits inside another
  or contains one.

## Tags and labels

- Keys and values are stored folded to lowercase. A folder's title keeps its case; the tag
  derived from it is folded.
- **A label belongs to a folder only.** Items take tags, and `tags::add_item_tag` has no key
  parameter.
- Every folder carries a tag derived from its title (`folder_tag.source = 'title'`), kept in
  step with the title.
- An item carries its own tags plus every tag and label on its folder and on each ancestor.
  `item_effective_tag.origin_id` records the folder each came from; NULL means the item
  carries it itself.
- `item_effective_tag` is maintained as things change (`tags::rebuild_item`,
  `tags::rebuild_subtree`), not computed when read.

## Lifecycle

- An item has three states. Live: `deleted_at` is NULL. Retired, its file gone: `deleted_at` is
  set and `trashed_at` is NULL, and a file arriving under its name again is the same item.
  Trashed, its file in the app's trash: both are set, and a file arriving under its name is a
  new item.
- A deleted folder, and every folder under it, is retired with one stamp in `deleted_at`, which
  is how an undo finds exactly those again. A retired folder frees its spot for a new folder of
  the same name.
- A walk retires the items it did not find, one source at a time, and the folders whose
  directory is gone — only in sources it could actually read.
- Removing a source deletes its rows outright. Its directory is never touched.
- A file moved or restored to a name that only a retired row holds takes it: that row is deleted
  outright. A trashed row never holds a name.
- A folder moved into another source takes its items with it: their `source_id` follows the
  folder's new ancestry.
- `item.probed_at` is set when the file is read for its shape and dates, and cleared when a walk
  refreshes the row because the file changed. NULL means it is still to be read.
- `captured_at` is only ever the file's own metadata, and `captured_src` says which: `exif` or
  `container`. Neither is ever filled with a guess.

## The undo journal

- A row holds one change: its `op`, the change itself as JSON in `forward`, and what reverses it
  in `inverse`. `batch_id` groups the rows one act wrote, so one undo reverses the act.
- Rows are written in the same transaction as the change to the index they describe, and only
  after the disk has changed.
- An undo applies a batch's rows newest first and writes no row of its own. Each row is deleted
  as it comes back, so a batch that came back in part keeps exactly the rows that stayed.
- Nothing prunes the journal yet.

## Not here yet

Search indexes and destination hotkeys each arrive as a new migration alongside the feature that
uses them.
