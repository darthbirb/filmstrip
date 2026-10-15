import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { Naming } from "../../ipc/bindings/Naming";
import { Button } from "../../ui/Button";
import { Glyph } from "../../ui/Glyph";
import { keepEscape, SURFACE } from "../../ui/Menu";
import { Segmented } from "../../ui/Segmented";
import { getPreferences } from "../preferences";
import { openSheet, type Sheet, skippedNote, startSheet, useSheet } from "./export";

const HEADING = "m-0 flex h-chip shrink-0 items-center px-2 text-eyebrow text-fg-dim uppercase";
const RULE = "mx-2 my-1 h-px shrink-0 border-0 bg-line";
const NAMINGS = [
  { value: "keep", label: "Keep Names" },
  { value: "folders", label: "From Folders" },
] as const;

/** The export sheet, while one is open. */
export function ExportSheetHost() {
  const sheet = useSheet();
  return sheet ? <ExportSheet key={sheet.zip.path} sheet={sheet} /> : null;
}

/**
 * How the files are named, the first as it will be in the zip, the zip, and Export: against what
 * asked, in the menu's surface and width. Artboards › Exporting a zip.
 */
export function ExportSheet({ sheet }: { sheet: Sheet }) {
  const { plan, zip, anchor, below } = sheet;
  const name = `--export-sheet-${useId().replace(/[^\w-]/g, "")}`;
  const surface = useRef<HTMLDivElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  const [naming, setNaming] = useState<Naming>(() => getPreferences().exportNaming ?? "keep");

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    anchor.style.setProperty("anchor-name", name);
    if (!element.matches(":popover-open")) element.showPopover();
    go.current?.focus();
    return () => {
      anchor.style.removeProperty("anchor-name");
    };
  }, [anchor, name]);

  // The sheet goes with what it hangs from.
  useEffect(() => {
    if (!anchor.isConnected) openSheet(null);
  });

  const close = () => {
    if (surface.current?.matches(":popover-open")) surface.current.hidePopover();
  };

  return (
    <div
      ref={surface}
      popover="auto"
      role="dialog"
      aria-label={sheet.heading}
      onToggle={(event) => {
        if (event.newState !== "closed") return;
        if (
          surface.current?.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          anchor.focus({ preventScroll: true });
        openSheet(null);
      }}
      onKeyDown={keepEscape}
      style={
        {
          positionAnchor: name,
          left: "anchor(left)",
          ...(below ? { top: "anchor(bottom)" } : { bottom: "anchor(top)" }),
          positionTryFallbacks: "flip-block",
        } as CSSProperties
      }
      className={`${below ? "mt-tile-gap" : "mb-tile-gap"} ${SURFACE}`}
    >
      <p className={`${HEADING} truncate`}>{sheet.heading}</p>
      <div className="flex flex-col gap-2 px-1 pt-0.5 pb-1.5">
        <Segmented
          label="Names in the zip"
          options={NAMINGS}
          value={naming}
          onChange={setNaming}
          fill
        />
        <span className="flex flex-col gap-0.5 px-1 text-small">
          <span className="truncate text-fg-dim">{plan.first.dir}</span>
          <span className="truncate text-fg-mid">
            {naming === "keep" ? plan.first.keep : plan.first.folders}
          </span>
        </span>
      </div>
      <hr className={RULE} />
      <span title={zip.path} className="flex h-control items-center gap-2 px-2 text-ui">
        <Glyph name="zip" className="shrink-0 text-fg-dim text-glyph" />
        <span className="min-w-0 flex-1 truncate">{zip.zip}</span>
        <span className="shrink-0 text-fg-dim text-small">{zip.place}</span>
      </span>
      {plan.away > 0 && (
        <span className="flex items-start gap-2 px-2 py-1 text-fg-dim text-small">
          <Glyph name="unplugged" className="shrink-0 text-fg-faint text-glyph" />
          <span className="text-pretty">{skippedNote(plan)}</span>
        </span>
      )}
      <hr className={RULE} />
      <div className="flex gap-1.5 p-1">
        <Button
          ref={go}
          glyph="zip"
          onClick={() => {
            close();
            void startSheet(sheet, naming);
          }}
        >
          Export
        </Button>
        <Button tone="quiet" onClick={close}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
