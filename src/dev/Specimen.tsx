import { convertFileSrc } from "@tauri-apps/api/core";
import { type ReactNode, useState } from "react";

import { useGridItems } from "../app/grid/useGridItems";
import { Navigation } from "../app/navigation/Navigation";
import { Details, Title } from "../app/pane/Details";
import { showInPane, usePaneItem } from "../app/pane/pane-store";
import { useItemDetail } from "../app/pane/useItemDetail";
import { usePlace } from "../app/place";
import { formatBytes, formatDimensions } from "../lib/format";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Disclosure } from "../ui/Disclosure";
import { GlyphButton } from "../ui/GlyphButton";
import { SearchField } from "../ui/SearchField";
import { Segmented } from "../ui/Segmented";
import { Slider } from "../ui/Slider";
import { Strip } from "../ui/Strip";
import { THUMB_FRAME, ThumbFace } from "../ui/Thumb";

// Every basic shape over the current look, fed by whatever the app has open. Dev only.
// DESIGN.md "Components".

const ROLES = [
  "ground",
  "panel",
  "raised",
  "well",
  "line",
  "line-strong",
  "fg",
  "fg-muted",
  "fg-faint",
  "hover",
  "press",
  "selected",
  "accent",
  "accent-hover",
  "on-accent",
  "focus",
  "danger",
  "on-danger",
] as const;

// Literal class names, so Tailwind finds them. Each sample is copy the app really shows.
const TYPE = [
  ["title", "font-title text-title", "Click a picture to see it here."],
  ["ui", "text-ui", "Sorting Box"],
  ["caption", "text-caption", "No pictures here."],
  ["label", "text-label", "Dimensions"],
] as const;

const SURFACES = [
  ["ground", "bg-ground"],
  ["panel", "bg-panel"],
  ["raised", "bg-raised"],
  ["well", "bg-well"],
] as const;

const LAYOUTS = [
  { value: "rows", label: "Rows" },
  { value: "squares", label: "Squares" },
] as const;

export function Specimen() {
  const items = useGridItems(usePlace()) ?? [];
  const chosen = usePaneItem() ?? items[0]?.id ?? null;
  const shown = useItemDetail(chosen);
  const [layout, setLayout] = useState<"rows" | "squares">("rows");
  const [size, setSize] = useState(10);
  const [query, setQuery] = useState("");
  const frames = items.map((item) => ({
    id: item.id,
    label: item.diskName,
    src: item.thumb ? convertFileSrc(item.thumb) : undefined,
    aspect: item.width && item.height ? item.width / item.height : 1,
  }));

  return (
    <main aria-label="Specimen" className="min-h-0 flex-1 overflow-auto border-line border-t">
      <div className="flex flex-col gap-8 p-6">
        <Section title="Colour roles">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--frame-nav-min),1fr))] gap-3">
            {ROLES.map((role) => (
              <Swatch key={role} role={role} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {SURFACES.map(([name, surface]) => (
              <div
                key={name}
                className={`flex w-(--frame-nav-min) flex-col gap-1 rounded-surface border border-line p-3 ${surface}`}
              >
                <span className="text-ui">{name}</span>
                <span className="text-caption text-fg-muted">muted text on {name}</span>
                <span className="text-caption text-accent">accent on {name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type">
          {TYPE.map(([role, classes, sample]) => (
            <div key={role} className="flex items-baseline gap-4">
              <span className="w-(--spacing-caption-button) shrink-0 font-numeric text-fg-muted text-label">
                {role}
              </span>
              <span className={classes}>{sample}</span>
            </div>
          ))}
          <div className="flex items-baseline gap-4">
            <span className="w-(--spacing-caption-button) shrink-0 font-numeric text-fg-muted text-label">
              numeric
            </span>
            <span className="font-numeric text-caption tabular-nums">
              4000 × 3000 · 2.3 MB · 0:12
            </span>
          </div>
        </Section>

        <Section title="Controls">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Retry</Button>
            <Button tone="quiet">Cancel</Button>
            <Button tone="accent">Add a source</Button>
            <Button glyph="folder">Open folder</Button>
            <Button pressed>Pressed</Button>
            <Button disabled>Unavailable</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <GlyphButton glyph="dockLeft" label="Hide navigation" onClick={() => undefined} />
            <Segmented label="Layout" options={LAYOUTS} value={layout} onChange={setLayout} />
            <Slider label="Size" min={6} max={20} value={size} onChange={setSize} />
            <div className="flex w-(--frame-pane)">
              <SearchField label="Search" value={query} onChange={setQuery} placeholder="Search" />
            </div>
          </div>
        </Section>

        <Section title="Navigation">
          <div className="h-(--frame-pane) w-(--frame-nav) overflow-auto rounded-surface bg-panel">
            <Navigation />
          </div>
        </Section>

        <Section title="Tiles and the filmstrip">
          <div className="flex flex-wrap gap-tile-gap">
            {frames.slice(0, 8).map((frame) => (
              <button
                key={frame.id}
                type="button"
                aria-label={frame.label}
                onClick={() => showInPane(frame.id)}
                className={`focus-ring h-(--tile-default) ${THUMB_FRAME}`}
                style={{ aspectRatio: frame.aspect }}
              >
                <ThumbFace src={frame.src} current={frame.id === chosen} />
              </button>
            ))}
          </div>
          <div className="w-(--frame-pane-max) max-w-full rounded-surface bg-panel">
            <Strip label="Filmstrip" frames={frames} current={chosen} onChoose={showInPane} />
          </div>
        </Section>

        <Section title="The pane's parts">
          {shown.status === "ready" ? (
            <div className="flex w-(--frame-pane) flex-col gap-2 rounded-surface bg-panel p-3">
              <Title item={shown.item} />
              <Disclosure
                label="Details"
                summary={[
                  shown.item.width && shown.item.height
                    ? formatDimensions(shown.item.width, shown.item.height)
                    : null,
                  formatBytes(shown.item.sizeBytes),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <Details item={shown.item} tags={shown.tags} />
              </Disclosure>
              <div className="flex flex-wrap gap-1">
                {shown.tags.map((tag) => (
                  <Chip
                    key={`${tag.tagId}-${tag.originId ?? "own"}`}
                    value={tag.value}
                    tagKey={tag.key}
                    inherited={tag.originId !== null}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="m-0 text-caption text-fg-muted">
              Open a folder with pictures to see these.
            </p>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 font-title text-title">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ role }: { role: string }) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--color-${role}`)
    .trim();
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-control shrink-0 rounded-control border border-line"
        style={{ background: `var(--color-${role})` }}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-ui">{role}</span>
        <span className="truncate font-numeric text-fg-muted text-label">{value}</span>
      </span>
    </div>
  );
}
