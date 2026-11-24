import { listen } from "@tauri-apps/api/event";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

import type { Counted } from "../../ipc/bindings/Counted";
import type { ToEmpty } from "../../ipc/bindings/ToEmpty";
import { emptyTrash, trashToEmpty } from "../../ipc/commands";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { Glyph } from "../../ui/Glyph";
import type { GlyphName } from "../../ui/glyphs";
import { RowQuestion } from "../../ui/TermTable";
import { libraryChanged } from "../library";
import { setNews } from "../navigation/foot-slot";
import { useIndex } from "../navigation/index-store";
import { showReport } from "../undo/report-store";
import { whyFailed } from "./backup-words";
import {
  emptiedBannerLine,
  emptiedLine,
  emptyingLine,
  emptyQuestion,
  heldLine,
  type Said,
  skippedLine,
} from "./empty-words";
import {
  emptyingProgress,
  finishEmptying,
  getEmptying,
  startEmptying,
  useEmptying,
} from "./settings-store";

// What the library has in the Recycle Bin, where a deleted file goes, and emptying it. Artboards ›
// The Trash in the Recycle Bin; DECISIONS.md "The Trash is the Recycle Bin" and "Emptying the
// Trash".

export function Trash() {
  const held = useIndex().totals?.trash;
  const [asking, setAsking] = useState<ToEmpty | null>(null);
  const emptying = useEmptying();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const ask = () => {
    void trashToEmpty()
      .then((asked) => setAsking(asked.files.length > 0 ? asked : null))
      .catch(() => undefined);
  };
  const cancel = () => {
    setAsking(null);
    button.current?.focus();
  };
  const answer = (asked: ToEmpty) => {
    setAsking(null);
    root.current?.focus({ preventScroll: true });
    void emptyAll(asked.files);
  };
  const questionKeys = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  let said = held ? heldLine(held) : "";
  let action: ReactNode = null;
  if (emptying) {
    said = emptyingLine(emptying.done, emptying.whole);
    action = (
      <span className="w-head-progress shrink-0">
        <Bar percent={emptying.whole > 0 ? (emptying.done / emptying.whole) * 100 : 0} />
      </span>
    );
  } else if (held && held.count > 0) {
    action = (
      <Button ref={button} tone="danger" onClick={ask}>
        Empty Trash…
      </Button>
    );
  }
  return (
    <div ref={root} tabIndex={-1} className="flex flex-col gap-2.5 outline-none">
      <header className="flex min-h-control shrink-0 items-center gap-2">
        <h3 className="m-0 font-semibold text-fg-hi text-row">Trash</h3>
        <span title={said} className="min-w-0 flex-1 truncate text-fg-dim text-small tabular-nums">
          {said}
        </span>
        {action}
      </header>
      {asking && !emptying && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape from either answer puts the question away.
        <div
          onKeyDown={questionKeys}
          className="overflow-hidden rounded-control border border-line-danger"
        >
          <RowQuestion
            answers={
              <>
                <Button tone="danger" onClick={() => answer(asking)}>
                  Empty Trash
                </Button>
                <Button tone="quiet" onClick={cancel}>
                  Cancel
                </Button>
              </>
            }
          >
            <Pieces said={emptyQuestion(asking.held)} />
          </RowQuestion>
        </div>
      )}
      <Note glyph="recycle">
        Deleted files go to the Windows Recycle Bin, on their own drive. Restore brings them back
        from the Trash.
      </Note>
      <Note glyph="usb">
        On a drive with no Recycle Bin, such as a USB stick or a network share, Delete asks first,
        and deletes for good.
      </Note>
    </div>
  );
}

/** Deletes the files counted for good, outside the section, so leaving it loses nothing. */
async function emptyAll(counted: Counted[]) {
  if (getEmptying()) return;
  startEmptying(counted.length);
  const heard = listen<number>("empty-progress", (event) => emptyingProgress(event.payload)).catch(
    () => undefined,
  );
  try {
    const emptied = await emptyTrash(counted);
    await libraryChanged();
    const whole = emptied.deleted + emptied.gone + emptied.kept;
    if (whole === 0) return;
    const [first] = emptied.stayed;
    if (whole === emptied.deleted) setNews({ kind: "said", line: emptiedLine(emptied) });
    else setNews({ kind: "skipped", line: skippedLine(emptied), first: first?.id ?? null });
    showReport(first ? { sentence: emptiedBannerLine(emptied), rows: emptied.stayed } : null);
  } catch (error) {
    await libraryChanged();
    setNews({
      kind: "skipped",
      line: `The Trash could not be emptied. ${whyFailed(error)}. What is still in it stays.`,
      first: null,
    });
  } finally {
    void heard.then((unlisten) => unlisten?.());
    finishEmptying();
  }
}

/** A sentence in pieces, the terms it names in `fg`. */
function Pieces({ said }: { said: Said }) {
  return (
    <>
      {said.map((part, index) =>
        typeof part === "string" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one sentence, in order.
          <span key={index}>{part}</span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one sentence, in order.
          <span key={index} className="whitespace-nowrap text-fg">
            {part.term}
          </span>
        ),
      )}
    </>
  );
}

/** One line under the head on where a deleted file goes. */
function Note({ glyph, children }: { glyph: GlyphName; children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-2 px-1 text-fg-dim text-small">
      <Glyph name={glyph} className="shrink-0 text-glyph" />
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
    </p>
  );
}
