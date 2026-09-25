import { copyItems, openItem, revealItem } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import type { HeadedMenu, MenuAction, MenuGroups } from "../../ui/Menu";
import { isFavourite, setFavourite, setFavourites } from "../favourites";
import { oneFolder } from "../grid/selection";
import { deleteFiles } from "../pane/delete";
import { getFullScreen, setFullScreen } from "../pane/full-screen";
import { openMovePicker } from "../pane/move-picker";
import { startRename } from "../pane/rename";
import { restoreFiles } from "../pane/restore";

/** A file, with when it went to the Trash when it is there. */
type Item = { id: number; folderId: number; favorite: boolean; trashedAt?: number | null };

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
  const count = `${formatCount(ids.length)} ${ids.length === 1 ? "File" : "Files"}`;
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
          onSelect: () => setFavourites(ids, !favourite),
        },
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
          onSelect: () => void copyItems(ids).catch(() => undefined),
        },
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
export function itemMenu(item: Item, show: () => void): MenuGroups {
  const favourite = isFavourite(item.id, item.favorite);
  const quietly = (work: Promise<void>) => void work.catch(() => undefined);
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
        onSelect: () => setFavourite(item.id, !favourite),
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
        onSelect: () => quietly(revealItem(item.id)),
      },
      { id: "copy", label: "Copy", glyph: "copy", onSelect: () => quietly(copyItems([item.id])) },
      {
        id: "open",
        label: "Open with Default App",
        glyph: "openExternal",
        onSelect: () => quietly(openItem(item.id)),
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
