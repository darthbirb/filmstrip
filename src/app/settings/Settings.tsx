import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { Dropdown } from "../../ui/Dropdown";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import type { GlyphName } from "../../ui/glyphs";
import { DEFAULT_LAYOUT, type LayoutMode } from "../grid/layout";
import { SCALES, updatePreferences, usePreferences } from "../preferences";
import { Sources } from "./Sources";

type Row = { label: string; control: ReactNode };

type Section = {
  id: string;
  /** The heading it sits under in the rail. */
  group: string;
  title: string;
  glyph: GlyphName;
  caption: string;
  rows: Row[];
  /** A section whose shape is its own, rather than a list of labels and controls. */
  body?: ReactNode;
};

const SIZES = SCALES.map((scale) => ({ value: String(scale), label: `${scale * 100}%` }));

const LAYOUTS: readonly { value: LayoutMode; label: string; glyph: GlyphName }[] = [
  { value: "justified", label: "Rows", glyph: "rows" },
  { value: "uniform", label: "Squares", glyph: "squares" },
];

/** Every preference with nowhere on screen to set it. DECISIONS.md "Settings". */
function useSections(): Section[] {
  const { scale, layout = DEFAULT_LAYOUT } = usePreferences();
  return [
    {
      id: "appearance",
      group: "This app",
      title: "Appearance",
      glyph: "appearance",
      caption: "The interface",
      rows: [
        {
          label: "Interface size",
          control: (
            <Dropdown
              label="Interface size"
              align="end"
              options={SIZES}
              value={String(scale)}
              onChange={(size) => updatePreferences({ scale: Number(size) })}
            />
          ),
        },
        {
          label: "Grid layout",
          control: (
            <Dropdown
              label="Grid layout"
              align="end"
              options={LAYOUTS}
              value={layout}
              onChange={(mode) => updatePreferences({ layout: mode })}
            />
          ),
        },
      ],
    },
    {
      id: "sources",
      group: "Your library",
      title: "Sources",
      glyph: "source",
      caption: "Sources",
      rows: [],
      body: <Sources />,
    },
  ];
}

type Props = { open: boolean; onClose: () => void };

/** A dialog over the window. Every control writes as it is touched, so nothing needs saving. */
export function Settings({ open, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape already closes a modal dialog; the click is for the backdrop.
    <dialog
      ref={dialog}
      aria-labelledby="settings-title"
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself, never on the panel inside it.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto h-dialog-height w-dialog overflow-hidden rounded-control border-0 bg-panel p-0 text-fg shadow-overlay inset-ring inset-ring-line-control backdrop:bg-scrim"
    >
      {open && <Body onClose={onClose} />}
    </dialog>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const term = query.trim().toLowerCase();
  const found = useSections()
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.label.toLowerCase().includes(term)),
    }))
    .filter((section) =>
      section.body ? section.title.toLowerCase().includes(term) : section.rows.length > 0,
    );
  const shown = found.find((section) => section.id === chosen) ?? found[0];
  const groups = [...new Set(found.map((section) => section.group))];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-toolbar shrink-0 items-center gap-2 border-line border-b pr-1.5 pl-3.5">
        <h2 id="settings-title" className="m-0 min-w-0 flex-1 truncate text-fg-hi text-title">
          Settings
        </h2>
        <GlyphButton glyph="close" label="Close settings" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Sections"
          className="flex w-dialog-rail shrink-0 flex-col gap-px overflow-auto border-line border-r p-1.5"
        >
          <label className="relative mb-1 flex">
            <span className="sr-only">Find a setting</span>
            <Glyph
              name="search"
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-dim text-glyph"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a setting"
              className="focus-ring h-control w-full min-w-0 rounded-nested bg-ground pr-2 pl-7 text-fg text-ui inset-ring inset-ring-line-control placeholder:text-fg-dim"
            />
          </label>
          {groups.map((group) => (
            <Fragment key={group}>
              <p className="m-0 px-2 pt-2.5 pb-1 text-eyebrow text-fg-dim uppercase">{group}</p>
              {found
                .filter((section) => section.group === group)
                .map((section) => {
                  const current = section.id === shown?.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      aria-current={current || undefined}
                      onClick={() => setChosen(section.id)}
                      className={`focus-ring flex h-row shrink-0 items-center gap-2 rounded-nested px-2 text-left text-ui transition-colors duration-(--motion-quick) motion-reduce:transition-none ${current ? "bg-raised-hi text-fg-hi" : "text-fg-mid hover:bg-wash hover:text-fg"}`}
                    >
                      <Glyph
                        name={section.glyph}
                        filled
                        className={`text-glyph ${current ? "" : "text-fg-dim"}`}
                      />
                      <span className="min-w-0 flex-1 truncate">{section.title}</span>
                    </button>
                  );
                })}
            </Fragment>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto p-3.5">
          {shown ? (
            <section aria-label={shown.title} className="flex flex-col gap-1.5">
              <h3 className="m-0 pl-0.5 text-eyebrow text-fg-dim uppercase">{shown.caption}</h3>
              {shown.body ?? (
                <div className="flex flex-col rounded-control bg-inset inset-ring inset-ring-line-control">
                  {shown.rows.map((row) => (
                    <div
                      key={row.label}
                      className="flex min-h-toolbar items-center gap-4 border-line px-3 py-1.5 not-first:border-t"
                    >
                      <span className="min-w-0 flex-1 text-fg text-ui">{row.label}</span>
                      {row.control}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <p className="m-0 text-fg-dim text-ui">No setting matches “{query.trim()}”.</p>
          )}
        </div>
      </div>
    </div>
  );
}
