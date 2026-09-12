# Schema

The tables, and the rules the data keeps. Facts only: why a rule exists is in the
migration's own comments and in [DECISIONS.md](DECISIONS.md).

The schema lives in `src-tauri/src/db/migrations/`. There is one migration today,
`001_initial.sql`.

## Tables

| Table | Holds |
| --- | --- |
| `source` | A registered root: its absolute path, a title, and a kind — `library` or `sorting`. |
| `folder` | A real directory: title, parent, status, favourite, notes, cover. |
| `item` | A real file: its folder, its name on disk, its measurements, and a uuid. |
| `tag` | One distinct term: a tag (no key) or a label (a key and a value). |
| `folder_tag` | Terms on a folder, added by its title or by hand. |
| `item_tag` | Tags an item carries itself. |
| `item_effective_tag` | Everything an item carries once inheritance is resolved. |
| `setting` | Key-value pairs. |
| `job` | Background work: waiting, running, or failed with its error. |

## Where things live on disk

- **`source.root` is the only absolute path stored.**
- A folder's path is its source's root, then the title of every folder between that root and
  the folder itself. The source's own root folder contributes no title. Derived on every read,
  in `fs::paths::folder_dir`.
- An item's path is its folder's path joined with `disk_name`.
- **Every item has a folder.** A file waiting in a sorting source sits in that source's root
  folder or somewhere beneath it.
- `item.source_id` repeats what the folder's ancestry implies. `items::set_folder` derives it
  on a move; everything else that writes it passes the value its folder implies.

## Uniqueness

- One live folder per parent and title, compared case-insensitively. SQLite folds ASCII only,
  so `Ä` and `ä` are two titles.
- One root folder per source.
- One item per folder and `disk_name`, compared case-insensitively.
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

- Trashing sets `deleted_at` and removes nothing. A trashed folder frees its spot for a new
  folder of the same name.
- A walk retires the items it did not find, one source at a time, and the folders whose
  directory is gone — only in sources it could actually read.
- Removing a source deletes its rows outright. Its directory is never touched.

## Not here yet

Search indexes, the undo journal and destination hotkeys each arrive as a new migration
alongside the feature that uses them.
