import { copyItemPaths, openItem, revealItem } from "../../ipc/commands";
import { formatCounted } from "../../lib/format";
import type { HeadedMenu, MenuAction, MenuGroups } from "../../ui/Menu";
import { exportChecked } from "../export/export";
import { failed } from "../failure";
import { isFavourite, setFavourite, setFavourites } from "../favourites";
import { oneFolder } from "../grid/selection";
import { deleteFiles } from "../pane/delete";
import { getFullScreen, setFullScreen } from "../pane/full-screen";
import { openMovePicker } from "../pane/move-picker";
import { startRename } from "../pane/rename";
import { restoreFiles } from "../pane/restore";
import { copyFiles } from "../paste/clipboard";
import { openTagSheet } from "../tags/TagSheet";
import { copiedFailed, openFailed, pathsFailed, shownFailed } from "../undo/lines";

/** A file, with when it went to the Trash when it is there; a checked branch's go unnamed. */
type Item = {
  id: number;
  folderId: number;
  diskName?: string;
  favorite: boolean;
  trashedAt?: number | null;
};

// The menu has handed the focus back by now, so the picker opens against the file.
const anchor = () => {
  const element = document.activeElement;
  return element instanceof HTMLElement ? { element } : { x: 0, y: 0 };
};

/**
 * The menu on a checked tile: the files it will act on, counted at its head, and only the verbs
 * that mean something for a set. In the Trash, the way back. Components › Right-click.
 */
export function setMenu(items: readonly Item[], trash: boolean): HeadedMenu {
  const ids = items.map((item) => item.id);
  const count = formatCounted(ids.length, "File");
  const folderId = oneFolder(items);
  if (trash) {
    return {
      heading: count,
      groups: [
        [
          {
            id: "restore",
            label: "Restore",
            glyph: "putBack",
            onSelect: () => void restoreFiles(ids),
          },
          {
            id: "restore-to",
            label: "Restore to…",
            glyph: "moveTo",
            onSelect: () => openMovePicker({ restoring: ids, folderId, anchor: anchor() }),
          },
        ],
      ],
    };
  }
  const favourite = items.every((item) => isFavourite(item.id, item.favorite));
  return {
    heading: count,
    groups: [
      [
        {
          id: "favourite",
          label: favourite ? "Remove Favourite" : "Favourite",
          glyph: "star",
          filled: favourite,
          onSelect: () => setFavourites(items, !favourite),
        },
        { id: "tag", label: "Tag…", glyph: "tag", onSelect: openTagSheet },
        {
          id: "move",
          label: "Move to…",
          glyph: "moveTo",
          onSelect: () => openMovePicker({ itemIds: ids, folderId, anchor: anchor() }),
        },
      ],
      [
        {
          id: "copy",
          label: "Copy",
          glyph: "copy",
          onSelect: () => void copyFiles(ids).catch(failed(copiedFailed(items))),
        },
        {
          id: "copy-path",
          label: "Copy Path",
          glyph: "copy",
          onSelect: () => void copyItemPaths(ids).catch(failed(pathsFailed(items))),
        },
        { id: "export", label: "Export…", glyph: "zip", onSelect: () => exportChecked(ids) },
      ],
      [
        {
          id: "delete",
          label: `Delete ${count}`,
          glyph: "trash",
          tone: "danger",
          onSelect: () => void deleteFiles(ids),
        },
      ],
    ],
  };
}

/**
 * A file's right-click menu: the pane's bar in its own order, with only the verbs that exist.
 * `show` puts this item in the pane, as a click on it would. DECISIONS.md "Right-click menus".
 */
export function itemMenu(item: Item & { diskName: string }, show: () => void): MenuGroups {
  const favourite = isFavourite(item.id, item.favorite);
  const saying = (work: Promise<void>, what: string) => void work.catch(failed(what));
  const full: MenuAction = getFullScreen()
    ? {
        id: "leave",
        label: "Exit Full Screen",
        glyph: "leaveFullScreen",
        onSelect: () => setFullScreen(false),
      }
    : {
        id: "full",
        label: "Full Screen",
        glyph: "fullScreen",
        onSelect: () => {
          show();
          setFullScreen(true);
        },
      };
  // In the Trash the way back is all there is: anything else would act on a file not in the library.
  if (item.trashedAt != null) {
    return [
      [full],
      [
        {
          id: "restore",
          label: "Restore",
          glyph: "putBack",
          onSelect: () => void restoreFiles([item.id]),
        },
        {
          id: "restore-to",
          label: "Restore to…",
          glyph: "moveTo",
          onSelect: () =>
            openMovePicker({ restoring: [item.id], folderId: item.folderId, anchor: anchor() }),
        },
      ],
    ];
  }
  return [
    [
      full,
      {
        id: "favourite",
        label: favourite ? "Remove Favourite" : "Favourite",
        glyph: "star",
        filled: favourite,
        onSelect: () => setFavourite(item, !favourite),
      },
      {
        id: "move",
        label: "Move to…",
        glyph: "moveTo",
        onSelect: () =>
          openMovePicker({ itemIds: [item.id], folderId: item.folderId, anchor: anchor() }),
      },
    ],
    [
      {
        id: "reveal",
        label: "Show in Explorer",
        glyph: "folderOpen",
        onSelect: () => saying(revealItem(item.id), shownFailed(item.diskName)),
      },
      {
        id: "copy",
        label: "Copy",
        glyph: "copy",
        onSelect: () => saying(copyFiles([item.id]), copiedFailed([item])),
      },
      {
        id: "copy-path",
        label: "Copy Path",
        glyph: "copy",
        onSelect: () => saying(copyItemPaths([item.id]), pathsFailed([item])),
      },
      {
        id: "open",
        label: "Open with Default App",
        glyph: "openExternal",
        onSelect: () => saying(openItem(item.id), openFailed(item.diskName)),
      },
      {
        id: "rename",
        label: "Rename",
        glyph: "rename",
        // The pane's Name row is where a name is changed, so the file goes there first.
        onSelect: () => {
          show();
          startRename(item.id);
        },
      },
    ],
    [
      {
        id: "delete",
        label: "Delete",
        glyph: "trash",
        tone: "danger",
        onSelect: () => void deleteFiles([item.id]),
      },
    ],
  ];
}
