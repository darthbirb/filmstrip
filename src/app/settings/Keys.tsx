import type { DestinationKey } from "../../ipc/bindings/DestinationKey";
import { removeDestinationKey } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { DismissButton } from "../../ui/DismissButton";
import { KeyChip } from "../../ui/KeyChip";
import { PlaceButton } from "../../ui/PlaceButton";
import { DIGITS } from "../keys";
import { refreshIndex, useIndex } from "../navigation/index-store";
import { MovePickerHost, openMovePicker } from "../pane/move-picker";

/**
 * All ten destination keys, bound or free, so which are left is read at a glance: each its
 * folder as a button that picks another, its count, and the way to free it. DECISIONS.md
 * "Destination keys".
 */
export function Keys() {
  const { keys } = useIndex();
  return (
    <>
      <div className="flex flex-col rounded-control bg-inset inset-ring inset-ring-line-control">
        {DIGITS.map((digit) => (
          <KeyRow key={digit} digit={digit} held={keys.find((one) => one.key === digit)} />
        ))}
      </div>
      <MovePickerHost inDialog />
    </>
  );
}

function KeyRow({ digit, held }: { digit: string; held?: DestinationKey }) {
  const name = held?.path.at(-1)?.title ?? "";
  const parent = held?.path.at(-2)?.title;
  const choose = (element: HTMLElement) =>
    openMovePicker({
      binding: digit,
      folderId: held && !held.gone ? held.folderId : null,
      anchor: { element },
      inDialog: true,
    });
  return (
    <div className="flex min-h-toolbar items-center gap-2.5 border-line py-1.5 pr-1.5 pl-3 not-first:border-t">
      <KeyChip digit={digit} broken={held?.gone} />
      {held ? (
        <PlaceButton
          label={name}
          // Where it was, for one that has gone: an undo of the delete brings it back.
          detail={held.gone ? (parent ? `gone from ${parent}` : "gone") : parent}
          broken={held.gone}
          onClick={(event) => choose(event.currentTarget)}
        />
      ) : (
        <PlaceButton
          label="Choose Folder…"
          empty
          onClick={(event) => choose(event.currentTarget)}
        />
      )}
      <span className="w-count shrink-0 text-right text-fg-dim text-small tabular-nums">
        {held && !held.gone ? formatCount(held.itemCount) : ""}
      </span>
      {held ? (
        <DismissButton
          label={`Remove Key ${digit}`}
          title="Remove Key"
          onClick={() =>
            void removeDestinationKey(digit)
              .then(() => refreshIndex())
              .catch(() => undefined)
          }
        />
      ) : (
        <span aria-hidden="true" className="size-control shrink-0" />
      )}
    </div>
  );
}
