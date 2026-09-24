import { copyItemFile, openItem, revealItem } from "../../ipc/commands";
import type { MenuGroups } from "../../ui/Menu";
import { isFavourite, setFavourite } from "../favourites";
import { deleteFiles } from "../pane/delete";
import { getFullScreen, setFullScreen } from "../pane/full-screen";
import { openMovePicker } from "../pane/move-picker";
import { startRename } from "../pane/rename";

type Item = { id: number; folderId: number; favorite: boolean };

/**
 * A file's right-click menu: the pane's bar in its own order, with only the verbs that exist.
 * `show` puts this item in the pane, as a click on it would. DECISIONS.md "Right-click menus".
 */
export function itemMenu(item: Item, show: () => void): MenuGroups {
  const favourite = isFavourite(item.id, item.favorite);
  const quietly = (work: Promise<void>) => void work.catch(() => undefined);
  return [
    [
      getFullScreen()
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
          },
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
        // The menu has handed the focus back by now, so the picker opens against the file.
        onSelect: () => {
          const element = document.activeElement;
          const anchor = element instanceof HTMLElement ? { element } : { x: 0, y: 0 };
          openMovePicker({ itemIds: [item.id], folderId: item.folderId, anchor });
        },
      },
    ],
    [
      {
        id: "reveal",
        label: "Show in Explorer",
        glyph: "folderOpen",
        onSelect: () => quietly(revealItem(item.id)),
      },
      { id: "copy", label: "Copy", glyph: "copy", onSelect: () => quietly(copyItemFile(item.id)) },
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
