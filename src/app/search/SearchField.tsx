import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { QueryFault } from "../../ipc/bindings/QueryFault";
import type { QueryTerm } from "../../ipc/bindings/QueryTerm";
import type { Suggestion } from "../../ipc/bindings/Suggestion";
import type { Suggestions as Offered } from "../../ipc/bindings/Suggestions";
import { readQuery, searchSuggestions } from "../../ipc/commands";
import { Glyph } from "../../ui/Glyph";
import type { GlyphName } from "../../ui/glyphs";
import { TermChip } from "../../ui/TermChip";
import { backFrom, getPlace, type Place, placeKey, usePlace } from "../place";
import { faultSentence, marksCharacter } from "./fault";
import { Suggestions } from "./Suggestions";
import { placeName, runQuery, scopeOf } from "./search";
import { type Chip, movePlate, picked, queryOf, scoping, withScope } from "./suggest";

const isChip = (term: QueryTerm): term is QueryTerm & Chip => term.shape.kind !== "text";

const OFFER_GLYPHS: Record<Place["kind"], GlyphName> = {
  folder: "folder",
  sorting: "sortingBox",
  trash: "trash",
  search: "search",
};

// One field in the window; Ctrl+F reaches it from anywhere. DECISIONS.md "Search".
let focusField: ((byKey: boolean) => void) | null = null;

/** Puts the caret in the search field, with the focus ring when it came from a key. */
export function focusSearch(byKey = true) {
  focusField?.(byKey);
}

let scopeField: ((term: string) => void) | null = null;

/**
 * Ctrl+F with the offer taken, for a folder you are not in: the folder becomes the field's scope,
 * its other terms stay, and nothing runs. Components › Search in Folder.
 */
export function searchIn(scope: string) {
  scopeField?.(scope);
}

/** What a query reads as in the field: its folders, places, tags and labels as chips, the rest words. */
async function split(query: string) {
  const { terms } = await readQuery(query);
  return {
    chips: terms.filter(isChip),
    text: terms
      .filter((term) => !isChip(term))
      .map((term) => term.text)
      .join(" "),
  };
}

/**
 * The query, in the bar: the terms it understood as chips and the words as typed. Typing moves only
 * the list under it; Enter or a pick runs the query, and one that does not read runs nothing and
 * says why. Components › "The field holds the query".
 */
export function SearchField() {
  const place = usePlace();
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [ringed, setRinged] = useState(false);
  const [plated, setPlated] = useState(false);
  const [fault, setFault] = useState<QueryFault | null>(null);
  const [offered, setOffered] = useState<Offered | null>(null);
  const [plate, setPlate] = useState<number | null>(null);
  // Counts the askings, so an answer for text since typed over is dropped.
  const asked = useRef(0);
  const anchor = `--search-${useId().replace(/[^\w-]/g, "")}`;
  const sentence = fault ? faultSentence(fault.why) : null;
  // The list and the sentence share one place, and the sentence has it first.
  const listed = focused && !fault && offered !== null;

  // The field holds the query that made the results, and nothing anywhere else.
  const key = placeKey(place);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the place.
  useEffect(() => {
    void hold();
  }, [key]);

  function closeList() {
    asked.current += 1;
    setOffered(null);
    setPlate(null);
  }

  /** Asks for the rows the word being typed begins; nothing is plated until a key moves. */
  async function offer(typed: string) {
    asked.current += 1;
    const mine = asked.current;
    const scope = chips.find(scoping)?.text ?? null;
    const found = await searchSuggestions(scope, typed).catch(() => null);
    if (mine !== asked.current) return;
    setOffered(found && found.rows.length > 0 ? found : null);
    setPlate(null);
  }

  async function hold() {
    const here = getPlace();
    setFault(null);
    setPlated(false);
    closeList();
    if (here?.kind !== "search") {
      setChips([]);
      setText("");
      return;
    }
    const held = await split(here.query).catch(() => ({ chips: [], text: here.query }));
    setChips(held.chips);
    setText(held.text);
  }

  useEffect(() => {
    focusField = (byKey) => {
      setRinged(byKey);
      input.current?.focus();
    };
    scopeField = async (term) => {
      const reading = await readQuery(term).catch(() => null);
      const chip = reading?.terms.find(isChip);
      if (!chip) return;
      setChips((held) => [chip, ...held.filter((one) => !scoping(one))]);
      setFault(null);
      setRinged(true);
      input.current?.focus();
    };
    return () => {
      focusField = null;
      scopeField = null;
    };
  }, []);

  // A dropped popover leaves the top layer, so the sentence is shown again whenever it changes.
  const line = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (sentence && focused) line.current?.showPopover();
  }, [sentence, focused]);

  // Where you stand is offered, never written: a search starts everywhere. DECISIONS.md "Search".
  const here = backFrom(place);
  const scope = scopeOf(here);
  const offering = focused && here !== null && scope !== null && !chips.some(scoping);

  /** Takes the offer: where you stand becomes the first term. */
  async function takeOffer() {
    if (!scope) return;
    const reading = await readQuery(scope).catch(() => null);
    const chip = reading?.terms.find(isChip);
    if (!chip) return;
    setChips((held) => [...withScope({ chips: held, text }, chip).chips]);
    setFault(null);
  }

  /** Once a space closes a word, the terms it read as take their chips; words stay words. */
  async function absorb(typed: string) {
    const reading = await readQuery(typed).catch(() => null);
    if (!reading || reading.fault) return;
    const taken = reading.terms.filter(isChip);
    if (taken.length === 0) return;
    let rest = typed;
    for (const term of [...taken].reverse()) {
      rest = `${rest.slice(0, term.start)}${rest.slice(term.end)}`;
    }
    // A term the query already holds is not added twice.
    setChips((held) => [
      ...held,
      ...taken.filter((term) => !held.some((chip) => chip.text === term.text)),
    ]);
    setText(rest.replace(/\s+/g, " ").trimStart());
  }

  async function run(query = queryOf({ chips, text })) {
    closeList();
    if (query === "") return;
    const { fault: why } = await readQuery(query).catch(() => ({ fault: null }));
    if (why) {
      setFault(why);
      return;
    }
    input.current?.blur();
    runQuery(query);
  }

  /** Writes a row's term where the word was, then runs the query it makes. */
  function pick(row: Suggestion) {
    const held = picked({ chips, text }, offered?.from ?? text.length, row);
    setChips([...held.chips]);
    setText(held.text);
    void run(queryOf(held));
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const row = listed && plate !== null ? offered.rows[plate] : undefined;
    if (listed && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setPlate(movePlate(plate, event.key === "ArrowDown" ? 1 : -1, offered.rows.length));
    } else if (row && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(row);
    } else if (offering && event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      void takeOffer();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      // Each Escape takes back one thing: the list, what did not read, then what was typed.
      if (listed) closeList();
      else if (fault) setFault(null);
      else {
        void hold();
        input.current?.blur();
      }
    } else if (event.key === "Backspace") {
      const at = event.currentTarget;
      if (at.selectionStart !== 0 || at.selectionEnd !== 0 || chips.length === 0) return;
      event.preventDefault();
      if (plated) {
        setChips((held) => held.slice(0, -1));
        setPlated(false);
      } else setPlated(true);
    } else if (plated) setPlated(false);
  };

  const prefix = chips.map((chip) => `${chip.text} `).join("").length;
  const marked = fault && marksCharacter(fault.why) ? fault.at - prefix : -1;
  const marking = marked >= 0 && marked < text.length;
  const resting = !focused && chips.length === 0 && text === "";
  const ring = fault
    ? "inset-ring-danger"
    : focused
      ? "inset-ring-line-strong"
      : "inset-ring-line-control hover:inset-ring-line-control-hi";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the input is the control; a press anywhere on its frame only hands it the caret.
    <div
      style={{ anchorName: anchor } as CSSProperties}
      className={`relative flex h-full min-w-0 flex-1 cursor-text items-center gap-1.5 overflow-hidden rounded-nested pr-1 pl-2.5 inset-ring ${ring} ${focused ? "bg-well" : "bg-ground"} ${ringed && focused ? "outline-(length:--focus-width) outline-focus outline-offset-(--focus-gap) outline-solid" : ""} ${resting ? "justify-center" : ""}`}
      onMouseDown={(event) => {
        setRinged(false);
        if (event.target !== input.current) {
          event.preventDefault();
          input.current?.focus();
        }
      }}
    >
      <Glyph
        name="search"
        className={`shrink-0 text-glyph ${focused ? "text-fg-mid" : "text-fg-dim"}`}
      />
      {resting && <span className="truncate text-fg-dim text-ui">Search</span>}
      {chips.map((chip, index) => (
        <TermChip
          key={chip.text}
          shape={chip.shape}
          text={chip.text}
          plated={plated && index === chips.length - 1}
          onRemove={() => {
            setChips((held) => held.filter((_, at) => at !== index));
            setFault(null);
          }}
        />
      ))}
      {/* Resting, the field is the centred word; the input lies over it all, unseen, to take the click. */}
      <div
        className={`h-full ${resting ? "absolute inset-0 opacity-0" : "relative min-w-16 flex-1"}`}
      >
        {marking && (
          <div
            ref={mirror}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-fg text-ui"
          >
            {text.slice(0, marked)}
            <span className="text-danger underline decoration-danger underline-offset-3">
              {text[marked]}
            </span>
            {text.slice(marked + 1)}
          </div>
        )}
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? `${anchor}-list` : undefined}
          aria-activedescendant={listed && plate !== null ? `${anchor}-list-${plate}` : undefined}
          aria-invalid={fault ? true : undefined}
          aria-describedby={sentence ? `${anchor}-fault` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setRinged(false);
            setPlated(false);
            closeList();
          }}
          onChange={(event) => {
            const typed = event.currentTarget.value;
            setText(typed);
            setFault(null);
            setPlated(false);
            void offer(typed);
            if (/\s$/.test(typed)) void absorb(typed);
          }}
          onScroll={(event) => {
            if (mirror.current) {
              mirror.current.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`;
            }
          }}
          onKeyDown={onKeyDown}
          className={`h-full w-full min-w-0 appearance-none bg-transparent text-ui outline-none [&::-webkit-search-cancel-button]:hidden ${marking ? "text-transparent caret-fg" : "text-fg"}`}
        />
      </div>
      {offering && (
        // Dashed, because it is not yet a term. The caret stays in the field; Tab takes it too.
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Search Only in ${placeName(here)}`}
          title={`Search Only in ${placeName(here)} · Tab`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void takeOffer()}
          className="flex h-badge shrink-0 items-center gap-1.25 whitespace-nowrap rounded-badge border border-line-strong border-dashed pr-0.75 pl-1.5 text-fg-dim text-small hover:bg-panel hover:text-fg"
        >
          <Glyph name={OFFER_GLYPHS[here.kind]} className="text-glyph-small" />
          in {placeName(here)}
          <span className="flex items-center rounded-badge bg-panel px-1.25 text-eyebrow text-fg-dim inset-ring inset-ring-line-control">
            Tab
          </span>
        </button>
      )}
      {listed && (
        <Suggestions
          id={`${anchor}-list`}
          anchor={anchor}
          rows={offered.rows}
          typed={text.trim()}
          plate={plate}
          onPick={pick}
        />
      )}
      {sentence && focused && (
        <div
          ref={line}
          id={`${anchor}-fault`}
          popover="manual"
          role="alert"
          style={
            {
              positionAnchor: anchor,
              top: "anchor(bottom)",
              left: "anchor(left)",
              width: "anchor-size(width)",
            } as CSSProperties
          }
          className="m-0 mt-1 flex min-h-control items-center gap-2 rounded-control border-0 bg-panel px-2.5 py-1.5 text-fg text-ui shadow-overlay inset-ring inset-ring-line-danger"
        >
          <Glyph name="warning" className="shrink-0 text-danger text-glyph" />
          <span className="text-pretty">{sentence}</span>
        </div>
      )}
    </div>
  );
}
