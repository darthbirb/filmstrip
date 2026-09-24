import { useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";
import { ContextMenu } from "./Menu";

/** One answer. `short` names it in the folded menu, where the question already says the verb. */
export type Answer = { id: string; label: string; short: string; onChoose: () => void };

type Props = {
  sentence: string;
  /** Answers that stand on the line together, or all fold into one button whose menu names them. */
  choices: readonly Answer[];
  /** The folded menu's glyph for each answer. */
  choiceGlyph: GlyphName;
  /** What the one button says once the answers have folded into it. */
  fold: string;
  /** The answer that destroys: last on the line, and never folded. */
  last: { label: string; onChoose: () => void };
  box?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  onDismiss: () => void;
};

/**
 * Something only you can settle, above the grid in the banner's shape: the question, its answers
 * under it, and × to answer none. The answers hold one line or all fold into one button, and a
 * fold that still does not fit stacks. Measured against its own line. DESIGN.md "Components".
 */
export function Question({ sentence, choices, choiceGlyph, fold, last, box, onDismiss }: Props) {
  const said = useId();
  const root = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const named = useRef<HTMLDivElement>(null);
  const folded = useRef<HTMLDivElement>(null);
  const foldButton = useRef<HTMLButtonElement>(null);
  const [shape, setShape] = useState<"named" | "folded" | "stacked">("named");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const labels = choices.map((choice) => choice.label).join("\n");

  // The question has just come up in answer to a key or a click: the keyboard goes to it.
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const element = line.current;
    if (!element || labels === "") return;
    const measure = () => {
      const room = element.clientWidth;
      const width = (row: typeof named) => row.current?.scrollWidth ?? 0;
      if (room <= 0) return;
      setShape(width(named) <= room ? "named" : width(folded) <= room ? "folded" : "stacked");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [labels]);

  const lastButton = (
    <Button tone="danger" onClick={last.onChoose}>
      {last.label}
    </Button>
  );
  // Drawn twice, once out of sight to be measured, so only the one on the line holds the ref.
  const foldedButton = (shown: boolean) => (
    <Button
      ref={shown ? foldButton : undefined}
      expanded={menu !== null}
      detail={<Glyph name="chevronDown" className="text-glyph-small" />}
      onClick={() => setMenu(foldButton.current)}
    >
      {fold}
    </Button>
  );
  const everyChoice = choices.map((choice) => (
    <Button key={choice.id} onClick={choice.onChoose}>
      {choice.label}
    </Button>
  ));

  return (
    <div className="shrink-0 px-3 pb-2">
      <section
        ref={root}
        aria-labelledby={said}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          onDismiss();
        }}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 rounded-control bg-panel py-2 pr-2 pl-3 outline-none inset-ring inset-ring-line-danger"
      >
        <Glyph name="warning" className="text-danger text-icon" />
        <span id={said} className="min-w-0 text-fg text-ui tabular-nums">
          {sentence}
        </span>
        <button
          type="button"
          aria-label="Cancel"
          title="Cancel"
          onClick={onDismiss}
          className="focus-ring grid size-control shrink-0 place-items-center rounded-control text-fg-dim text-glyph transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
        >
          <Glyph name="close" />
        </button>
        <div ref={line} className="relative col-span-2 col-start-2 min-w-0">
          {/* Both lines as they would be drawn, out of sight, so the fold is measured, not guessed. */}
          <div ref={named} inert aria-hidden className="invisible absolute flex w-max gap-1.5">
            {everyChoice}
            {lastButton}
          </div>
          <div ref={folded} inert aria-hidden className="invisible absolute flex w-max gap-1.5">
            {foldedButton(false)}
            {lastButton}
          </div>
          <div
            className={`flex gap-1.5 ${shape === "stacked" ? "flex-col items-start" : "items-center"}`}
          >
            {shape === "named" ? everyChoice : foldedButton(true)}
            {lastButton}
          </div>
        </div>
        {box && (
          <div className="col-span-2 col-start-2">
            <Checkbox label={box.label} checked={box.checked} onChange={box.onChange} />
          </div>
        )}
      </section>
      {menu && (
        <ContextMenu
          label={fold}
          groups={[
            choices.map((choice) => ({
              id: choice.id,
              label: choice.short,
              glyph: choiceGlyph,
              onSelect: choice.onChoose,
            })),
          ]}
          anchor={{ element: menu }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
