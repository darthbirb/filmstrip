import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import type { TrashLimit } from "../../ipc/bindings/TrashLimit";
import type { TrashLimits } from "../../ipc/bindings/TrashLimits";
import type { TrashSettings } from "../../ipc/bindings/TrashSettings";
import { setTrashLimit, trashLimits } from "../../ipc/commands";
import { Dropdown } from "../../ui/Dropdown";
import { Glyph } from "../../ui/Glyph";
import { whenLibraryChanges } from "../library";
import { dueLine, heldLine, type Said } from "./expiry-words";
import { Rows } from "./Rows";

// The Trash's limits, and what the next run sends past them. Artboards › The Trash's limits;
// DECISIONS.md "Expiry goes to the Recycle Bin".

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

  const change = (limit: TrashLimit, key: keyof TrashLimits, chosen: string) => {
    const value = chosen === NONE ? null : Number(chosen);
    setShown({ ...shown, limits: { ...limits, [key]: value } });
    void setTrashLimit(limit, value)
      .catch(() => undefined)
      .finally(load);
  };

  const unlimited = limits.keepDays === null && limits.totalGb === null;
  return (
    <div className="flex flex-col gap-2.5">
      <Head held={heldLine(shown.held, limits.totalGb)} />
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
          said={["With no limits, nothing leaves the Trash until it is restored."]}
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

/** The section's own head: its name, and what the Trash holds against its total. */
function Head({ held }: { held: string }) {
  return (
    <header className="flex shrink-0 items-center gap-2">
      <h3 className="m-0 font-semibold text-fg-hi text-row">Trash</h3>
      <span title={held} className="min-w-0 flex-1 truncate text-fg-dim text-small tabular-nums">
        {held}
      </span>
    </header>
  );
}

/** One line under the limits on where a file goes past them, the terms it names in `fg`. */
function Note({ glyph, said }: { glyph: "recycle" | "infinity"; said: Said }) {
  return (
    <p className="m-0 flex items-start gap-2 px-1 text-fg-dim text-small tabular-nums">
      <Glyph name={glyph} className="shrink-0 text-glyph" />
      <span className="min-w-0 flex-1 text-pretty">
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
      </span>
    </p>
  );
}
