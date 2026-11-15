import { listen } from "@tauri-apps/api/event";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ToEmpty } from "../../ipc/bindings/ToEmpty";
import type { TrashLimit } from "../../ipc/bindings/TrashLimit";
import type { TrashLimits } from "../../ipc/bindings/TrashLimits";
import type { TrashSettings } from "../../ipc/bindings/TrashSettings";
import { emptyTrash, setTrashLimit, trashLimits, trashToEmpty } from "../../ipc/commands";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { Glyph } from "../../ui/Glyph";
import { RowQuestion } from "../../ui/TermTable";
import { libraryChanged, whenLibraryChanges } from "../library";
import { setNews } from "../navigation/foot-slot";
import { whyFailed } from "./backup-words";
import {
  dueLine,
  emptiedLine,
  emptyingLine,
  emptyQuestion,
  heldLine,
  keptLine,
  type Said,
} from "./expiry-words";
import { Rows } from "./Rows";
import {
  emptyingProgress,
  finishEmptying,
  getEmptying,
  startEmptying,
  useEmptying,
} from "./settings-store";

// The Trash's limits, what the next run sends past them, and emptying it. Artboards › The Trash's
// limits; DECISIONS.md "Expiry goes to the Recycle Bin" and "Emptying the trash".

const NONE = "none";
const NO_LIMIT = { value: NONE, label: "No Limit" };
const answers = (values: readonly number[], label: (value: number) => string) => [
  ...values.map((value) => ({ value: String(value), label: label(value) })),
  NO_LIMIT,
];
const gb = (value: number) => `${value} GB`;
const days = (value: number) => (value === 365 ? "1 Year" : `${value} Days`);

const LIMITS: readonly {
  limit: TrashLimit;
  key: keyof TrashLimits;
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    limit: "keepFor",
    key: "keepDays",
    label: "Keep For",
    options: answers([7, 14, 30, 90, 365], days),
  },
  {
    limit: "totalSize",
    key: "totalGb",
    label: "Total Size",
    options: answers([10, 25, 50, 100, 250], gb),
  },
  {
    limit: "sizePerFile",
    key: "fileGb",
    label: "Size per File",
    options: answers([1, 2, 5, 10, 25], gb),
  },
];

export function Trash() {
  const [shown, setShown] = useState<TrashSettings | null>(null);
  const [asking, setAsking] = useState<ToEmpty | null>(null);
  const emptying = useEmptying();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    void trashLimits()
      .then(setShown)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const heard = listen("trash-expired", load).catch(() => undefined);
    const changes = whenLibraryChanges(load);
    return () => {
      changes();
      void heard.then((unlisten) => unlisten?.());
    };
  }, [load]);

  if (!shown) return <Head held="" />;
  const { limits } = shown;

  const ask = () => {
    void trashToEmpty()
      .then((asked) => setAsking(asked.itemIds.length > 0 ? asked : null))
      .catch(() => undefined);
  };
  const cancel = () => {
    setAsking(null);
    button.current?.focus();
  };
  const answer = (asked: ToEmpty) => {
    setAsking(null);
    root.current?.focus({ preventScroll: true });
    void emptyAll(asked.itemIds);
  };
  const questionKeys = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };

  const change = (limit: TrashLimit, key: keyof TrashLimits, chosen: string) => {
    const value = chosen === NONE ? null : Number(chosen);
    setShown({ ...shown, limits: { ...limits, [key]: value } });
    void setTrashLimit(limit, value)
      .catch(() => undefined)
      .finally(load);
  };

  const unlimited = limits.keepDays === null && limits.totalGb === null;
  let action: ReactNode = null;
  if (emptying) {
    action = (
      <span className="w-head-progress shrink-0">
        <Bar percent={emptying.whole > 0 ? (emptying.done / emptying.whole) * 100 : 0} />
      </span>
    );
  } else if (shown.held.count > 0) {
    action = (
      <Button ref={button} tone="danger" onClick={ask}>
        Empty Trash…
      </Button>
    );
  }
  return (
    <div ref={root} tabIndex={-1} className="flex flex-col gap-2.5 outline-none">
      <Head
        held={
          emptying
            ? emptyingLine(emptying.done, emptying.whole)
            : heldLine(shown.held, limits.totalGb)
        }
        action={action}
      />
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
      <Rows
        rows={LIMITS.map(({ limit, key, label, options }) => ({
          label,
          control: (
            <Dropdown
              label={label}
              align="end"
              options={options}
              value={limits[key] === null ? NONE : String(limits[key])}
              onChange={(chosen) => change(limit, key, chosen)}
            />
          ),
        }))}
      />
      {unlimited ? (
        <Note
          glyph="infinity"
          said={["With no limits, nothing leaves the Trash until it is restored or emptied."]}
        />
      ) : (
        <Note
          glyph="recycle"
          said={dueLine(shown.due, limits.keepDays, limits.totalGb, shown.at)}
        />
      )}
    </div>
  );
}

/** Deletes the files asked about for good, outside the section so leaving it loses nothing. */
async function emptyAll(itemIds: number[]) {
  if (getEmptying()) return;
  startEmptying(itemIds.length);
  const heard = listen<number>("empty-progress", (event) => emptyingProgress(event.payload)).catch(
    () => undefined,
  );
  try {
    const emptied = await emptyTrash(itemIds);
    await libraryChanged().catch(() => undefined);
    setNews(
      emptied.kept > 0
        ? { kind: "stayInTrash", sentence: keptLine(emptied), first: emptied.firstKept }
        : { kind: "said", line: emptiedLine(emptied) },
    );
  } catch (error) {
    await libraryChanged().catch(() => undefined);
    setNews({
      kind: "stayInTrash",
      sentence: "The Trash could not be emptied.",
      detail: `${whyFailed(error)}. What is still in it stays.`,
      first: null,
    });
  } finally {
    void heard.then((unlisten) => unlisten?.());
    finishEmptying();
  }
}

/**
 * The section's own head: its name, what the Trash holds against its total, or how far emptying
 * has got, and Empty Trash… or the walk's bar in its place.
 */
function Head({ held, action = null }: { held: string; action?: ReactNode }) {
  return (
    <header className="flex min-h-control shrink-0 items-center gap-2">
      <h3 className="m-0 font-semibold text-fg-hi text-row">Trash</h3>
      <span title={held} className="min-w-0 flex-1 truncate text-fg-dim text-small tabular-nums">
        {held}
      </span>
      {action}
    </header>
  );
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
          <span key={index} className="text-fg">
            {part.term}
          </span>
        ),
      )}
    </>
  );
}

/** One line under the limits on where a file goes past them, the terms it names in `fg`. */
function Note({ glyph, said }: { glyph: "recycle" | "infinity"; said: Said }) {
  return (
    <p className="m-0 flex items-start gap-2 px-1 text-fg-dim text-small tabular-nums">
      <Glyph name={glyph} className="shrink-0 text-glyph" />
      <span className="min-w-0 flex-1 text-pretty">
        <Pieces said={said} />
      </span>
    </p>
  );
}
