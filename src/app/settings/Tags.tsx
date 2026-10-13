import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Batch } from "../../ipc/bindings/Batch";
import type { KeyClash } from "../../ipc/bindings/KeyClash";
import type { KeyRow } from "../../ipc/bindings/KeyRow";
import type { TagRow } from "../../ipc/bindings/TagRow";
import type { ValueRow } from "../../ipc/bindings/ValueRow";
import type { Vocabulary } from "../../ipc/bindings/Vocabulary";
import {
  deleteLabelKey,
  deleteLabelValue,
  deleteTag,
  labelKeyClash,
  listTags,
  mergeLabelKeys,
  mergeLabelValues,
  mergeTags,
  renameLabelKey,
  renameLabelValue,
  renameTag,
} from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { fold, labelTerm, tagTerm } from "../../lib/queryTerm";
import { Button } from "../../ui/Button";
import { Chip, KeyOnlyChip } from "../../ui/Chip";
import { EmptyState } from "../../ui/EmptyState";
import { FilterField } from "../../ui/FilterField";
import { Glyph } from "../../ui/Glyph";
import { Line } from "../../ui/Line";
import { ContextMenu, type MenuAnchor, type MenuGroups } from "../../ui/Menu";
import type { OfferRow } from "../../ui/OfferList";
import { TermField } from "../../ui/TermField";
import { MoreButton, RowQuestion, TermGroup, TermRow, type TermSort } from "../../ui/TermTable";
import { libraryChanged, whenLibraryChanges } from "../library";
import { setNews, useNews } from "../navigation/foot-slot";
import { addToSearch, searchFor } from "../search/search";
import { filesAndFolders } from "../undo/lines";
import { afterAct, undo } from "../undo/undo";
import { closeSettings } from "./settings-store";

// The library's vocabulary, renamed, merged and deleted where each row stands. Artboards › Tags;
// DECISIONS.md "The tags screen".

type Mode = "rename" | "merge" | "askMerge" | "askDelete";
/** The row being acted on, and for a merge the term it goes into. */
type Editing = { row: string; mode: Mode; into?: string };
type Menu = { row: string; label: string; anchor: MenuAnchor; groups: MenuGroups };

const OFFERS = 7;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${formatCount(n)} ${n === 1 ? one : many}`;
const article = (word: string) => (/^[aeiou]/.test(word) ? "an" : "a");
const Term = ({ children }: { children: ReactNode }) => <span className="text-fg">{children}</span>;

/** "2 folders and the 38 files that carry it", or either alone. */
function comesOff(folders: number, files: number, carry: string) {
  const parts = [
    ...(folders > 0 ? [plural(folders, "folder")] : []),
    ...(files > 0 ? [`the ${plural(files, "file")} ${carry}`] : []),
  ];
  return parts.join(" and ");
}

/** The band's words for a key merge that would give a branch a key twice. */
export function clashLine(clash: KeyClash, from: string, into: string) {
  switch (clash.kind) {
    case "both":
      return `${clash.folder} already has ${article(into)} ${into}.`;
    case "above":
      return `${clash.folder} has ${article(from)} ${from}, and ${into} comes from ${clash.above}.`;
    case "below":
      return `${clash.folder} has ${article(from)} ${from}, and ${clash.below}, inside ${clash.folder}, already has ${article(into)} ${into}.`;
  }
}

const byName = (a: string, b: string) => a.localeCompare(b);

/** Rows in the heading's order, a tie between two counts by name. */
function order<T extends { files: number; folders: number }>(
  rows: readonly T[],
  name: (row: T) => string,
  sort: TermSort,
): T[] {
  const way = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) =>
    sort.by === "name"
      ? way * byName(name(a), name(b))
      : way * (a[sort.by] - b[sort.by]) || byName(name(a), name(b)),
  );
}

/** Every tag, then every label key with its values, each with what carries it. */
export function Tags() {
  const [vocabulary, setVocabulary] = useState<Vocabulary | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<TermSort>({ by: "name", dir: "asc" });
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [clashes, setClashes] = useState<Record<string, string>>({});
  const mine = useRef(new Set<string>());
  const mores = useRef(new Map<string, HTMLButtonElement>());
  const back = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const news = useNews();

  const load = useCallback(() => {
    void listTags()
      .then(setVocabulary)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    return whenLibraryChanges(load);
  }, [load]);

  // Back to the row's ⋯ once a field or a question has gone, or to the section when the act took
  // the row away, so the keyboard, and Ctrl+Z, stay here.
  useEffect(() => {
    if (editing || !back.current) return;
    (mores.current.get(back.current) ?? root.current)?.focus({ preventScroll: true });
    back.current = null;
  });

  const line =
    news && (news.kind === "done" || news.kind === "undone") && news.batchId
      ? mine.current.has(news.batchId)
        ? news
        : null
      : null;

  const stop = () => {
    if (editing) back.current = editing.row;
    setEditing(null);
  };
  const act = async (run: () => Promise<Batch | null>) => {
    const row = editing?.row ?? null;
    setEditing(null);
    try {
      const batch = await run();
      if (batch) {
        mine.current.add(batch.batchId);
        afterAct(batch);
        await libraryChanged();
      }
      setVocabulary(await listTags());
    } catch {
      load();
    }
    back.current = row;
  };

  if (!vocabulary) return <Head count="" />;
  const { tags, keys } = vocabulary;
  const values = keys.reduce((sum, key) => sum + key.values.length, 0);
  const headCount = [
    plural(tags.length, "tag"),
    ...(keys.length > 0 ? [plural(keys.length, "key")] : []),
  ].join(" · ");
  if (tags.length === 0 && keys.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3.5">
        <Head count={headCount} />
        <EmptyState glyph="tag" title="No Tags Yet" />
      </div>
    );
  }

  const term = fold(filter);
  const hits = (text: string) => term === "" || text.includes(term);
  const shownTags = order(
    tags.filter((tag) => hits(tag.value)),
    (tag) => tag.value,
    sort,
  );
  const shownKeys = order(
    keys.flatMap((key) => {
      const matching = key.values.filter((value) => hits(value.value));
      const keyHit = hits(key.key);
      if (!keyHit && matching.length === 0) return [];
      return [{ ...key, keyHit, matching }];
    }),
    (key) => key.key,
    sort,
  );
  const found =
    shownTags.length +
    shownKeys.reduce((sum, key) => sum + (term && key.keyHit ? 1 : 0) + key.matching.length, 0);
  const total = tags.length + keys.length + values;

  const search = (query: string) => (adding: boolean) => {
    closeSettings();
    void (adding ? addToSearch(query) : searchFor(query));
  };
  const openMenu = (row: string, label: string, groups: MenuGroups) => (event: MouseEvent) =>
    setMenu({
      row,
      label,
      anchor: { element: event.currentTarget as HTMLElement, align: "end" },
      groups,
    });
  const moreFor = (row: string, label: string, groups: MenuGroups) => (
    <MoreButton
      ref={(element) => {
        if (element) mores.current.set(row, element);
        else mores.current.delete(row);
      }}
      label={label}
      open={menu?.row === row}
      onOpen={openMenu(row, label, groups)}
    />
  );
  /** F2 renames, Delete asks, and the menu key opens ⋯, from anywhere on the row but a field. */
  const rowKeys =
    (row: string, rename: () => void, remove: () => void) => (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape" && editing?.row === row) {
        event.preventDefault();
        event.stopPropagation();
        stop();
      } else if (editing?.row === row) return;
      else if (event.key === "F2") {
        event.preventDefault();
        rename();
      } else if (event.key === "Delete") {
        event.preventDefault();
        remove();
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        const more = mores.current.get(row);
        if (!more) return;
        event.preventDefault();
        more.click();
      }
    };
  const editingOf = (row: string) => (editing?.row === row ? editing : null);
  const cancelButton = (
    <Button tone="quiet" onClick={stop}>
      Cancel
    </Button>
  );

  const tagRow = (tag: TagRow) => {
    const row = `tag:${tag.tagId}`;
    const now = editingOf(row);
    const nameOnly = tag.named.length > 0 && tag.ownFiles === 0 && tag.handFolders === 0;
    const unused = tag.files === 0 && tag.folders === 0;
    const named = tag.named.length > 0;
    const whose =
      tag.named.length === 1 ? (tag.named[0]?.title ?? "") : plural(tag.named.length, "folder");
    const keeps = named
      ? tag.named.length === 1
        ? ` ${whose} keeps it as its name.`
        : ` ${whose} keep it as their name.`
      : "";
    const [files, folders] = named ? [tag.ownFiles, tag.handFolders] : [tag.files, tag.folders];
    const rename = () => setEditing({ row, mode: "rename" });
    const remove = () =>
      unused ? void act(() => deleteTag(tag.tagId)) : setEditing({ row, mode: "askDelete" });
    const into = (value: string) => tags.find((other) => other.value === value);
    const offers = (typed: string): OfferRow[] =>
      tags
        .filter((other) => other.tagId !== tag.tagId && other.value.startsWith(typed))
        .sort((a, b) => b.files - a.files || byName(a.value, b.value))
        .slice(0, OFFERS)
        .map((other) => ({
          value: other.value,
          said: other.value,
          count: `on ${plural(other.files, "file")}`,
        }));
    const chip = (
      <Chip
        value={tag.value}
        name={named}
        inherited={named}
        title={`Search ${tagTerm(tag.value)}`}
        onSearch={search(tagTerm(tag.value))}
      />
    );
    let name: ReactNode;
    if (now?.mode === "rename") {
      name = (
        <TermField
          label={`Rename ${tag.value}`}
          value={tag.value}
          shape="tag"
          onCancel={stop}
          onCommit={(to) => {
            if (to === tag.value) return stop();
            if (into(to)) return setEditing({ row, mode: "askMerge", into: to });
            void act(() => renameTag(tag.tagId, to));
          }}
        />
      );
    } else if (now?.mode === "merge") {
      name = (
        <>
          {chip}
          <Glyph name="into" className="shrink-0 text-fg-dim text-glyph-small" />
          <TermField
            label={`Merge ${tag.value} into`}
            shape="tag"
            offers={offers}
            onCancel={stop}
            onCommit={(to) => setEditing({ row, mode: "askMerge", into: to })}
          />
        </>
      );
    } else {
      name = (
        <>
          {chip}
          {named && <Said>name of {whose}</Said>}
          {unused && <Said>unused</Said>}
        </>
      );
    }
    let asking: ReactNode = null;
    const target = now?.mode === "askMerge" && now.into ? into(now.into) : undefined;
    if (target) {
      const what = filesAndFolders(files, folders);
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                glyph="merge"
                onClick={() => void act(() => mergeTags(tag.tagId, target.tagId))}
              >
                Merge Tags
              </Button>
              {cancelButton}
            </>
          }
        >
          <Term>{target.value}</Term> is already a tag, on {plural(target.files, "file")}. Merge{" "}
          <Term>{tag.value}</Term> into it?
          {what && (
            <>
              {" "}
              Its {what} take <Term>{target.value}</Term>, none of them twice.
            </>
          )}
          {keeps}
        </RowQuestion>
      );
    } else if (now?.mode === "askDelete") {
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                tone="danger"
                glyph="trash"
                onClick={() => void act(() => deleteTag(tag.tagId))}
              >
                Delete Tag
              </Button>
              {cancelButton}
            </>
          }
        >
          Delete <Term>{tag.value}</Term>? It comes off{" "}
          {comesOff(folders, files, named ? "that carry it themselves" : "that carry it")}.{keeps}
        </RowQuestion>
      );
    }
    return (
      <TermRow
        key={row}
        name={name}
        files={tag.files}
        folders={tag.folders}
        asking={asking}
        onKeyDown={nameOnly ? undefined : rowKeys(row, rename, remove)}
        more={
          nameOnly
            ? undefined
            : moreFor(row, `More for ${tag.value}`, [
                [
                  { id: "rename", label: "Rename…", glyph: "rename", onSelect: rename },
                  {
                    id: "merge",
                    label: "Merge Into…",
                    glyph: "merge",
                    onSelect: () => setEditing({ row, mode: "merge" }),
                  },
                ],
                [
                  {
                    id: "delete",
                    label: "Delete Tag",
                    glyph: "trash",
                    tone: "danger",
                    onSelect: remove,
                  },
                ],
              ])
        }
      />
    );
  };

  const loadClashes = (from: string) => {
    for (const other of keys) {
      if (other.key === from) continue;
      void labelKeyClash(from, other.key)
        .then((clash) =>
          setClashes((was) => ({
            ...was,
            [`${from}\u0000${other.key}`]: clash ? clashLine(clash, from, other.key) : "",
          })),
        )
        .catch(() => undefined);
    }
  };
  const clashOf = (from: string, into: string) => clashes[`${from}\u0000${into}`] || null;

  const keyRow = (key: KeyRow & { keyHit: boolean; matching: ValueRow[] }) => {
    const row = `key:${key.key}`;
    const now = editingOf(row);
    const open = (term !== "" && key.matching.length > 0) || opened.has(key.key);
    const listed = term !== "" && key.matching.length > 0 ? key.matching : key.values;
    const counted =
      listed.length < key.values.length
        ? `${formatCount(listed.length)} of ${plural(key.values.length, "value")}`
        : plural(key.values.length, "value");
    const keyTerm = `${key.key}:*`;
    const rename = () => {
      loadClashes(key.key);
      setEditing({ row, mode: "rename" });
    };
    const remove = () =>
      key.folders === 0
        ? void act(() => deleteLabelKey(key.key))
        : setEditing({ row, mode: "askDelete" });
    const existing = (to: string) =>
      keys.find((other) => other.key === to && other.key !== key.key);
    const refuse = (to: string) => (existing(to) ? clashOf(key.key, to) : null);
    const toggle = () =>
      setOpened((was) => {
        const next = new Set(was);
        if (next.has(key.key)) next.delete(key.key);
        else next.add(key.key);
        return next;
      });
    const chevron = (
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} the values of ${key.key}`}
        onClick={toggle}
        className="focus-ring grid h-chip w-chevron shrink-0 place-items-center rounded-badge text-fg-dim text-glyph-small hover:text-fg"
      >
        <Glyph name={open ? "chevronDown" : "chevronRight"} />
      </button>
    );
    const chip = (
      <KeyOnlyChip tagKey={key.key} title={`Search ${keyTerm}`} onSearch={search(keyTerm)} />
    );
    let name: ReactNode;
    if (now?.mode === "rename" || now?.mode === "merge") {
      const merging = now.mode === "merge";
      name = (
        <>
          {chevron}
          {merging && chip}
          {merging && <Glyph name="into" className="shrink-0 text-fg-dim text-glyph-small" />}
          <TermField
            label={merging ? `Merge ${key.key} into` : `Rename ${key.key}`}
            value={merging ? "" : key.key}
            shape="key"
            refuse={refuse}
            offers={
              merging
                ? (typed) =>
                    keys
                      .filter((other) => other.key !== key.key && other.key.startsWith(typed))
                      .sort((a, b) => b.folders - a.folders || byName(a.key, b.key))
                      .slice(0, OFFERS)
                      .map((other) => ({
                        value: other.key,
                        said: other.key,
                        count: `on ${plural(other.folders, "folder")}`,
                      }))
                : undefined
            }
            trail={merging ? undefined : <Said>{counted}</Said>}
            onCancel={stop}
            onCommit={(to) => {
              if (to === key.key) return stop();
              if (existing(to)) return setEditing({ row, mode: "askMerge", into: to });
              void act(() => renameLabelKey(key.key, to));
            }}
          />
        </>
      );
    } else {
      name = (
        <>
          {chevron}
          {chip}
          <Said>{counted}</Said>
        </>
      );
    }
    let asking: ReactNode = null;
    const target = now?.mode === "askMerge" && now.into ? existing(now.into) : undefined;
    if (target) {
      const kept = key.values.map((value) => `${target.key}: ${value.value}`);
      const as =
        kept.length > 0 && kept.length <= 3
          ? kept.flatMap((one, at) => [
              ...(at === 0 ? [] : [at === kept.length - 1 ? " and " : ", "]),
              <Term key={one}>{one}</Term>,
            ])
          : null;
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                glyph="merge"
                onClick={() => void act(() => mergeLabelKeys(key.key, target.key))}
              >
                Merge Keys
              </Button>
              {cancelButton}
            </>
          }
        >
          <Term>{target.key}</Term> is already a key, on {plural(target.folders, "folder")}. Merge{" "}
          <Term>{key.key}</Term> into it? Its {plural(key.folders, "folder")}{" "}
          {key.folders === 1 ? "keeps its value" : "keep their values"}
          {as ? <>, as {as}</> : <>, under {target.key}</>}.
        </RowQuestion>
      );
    } else if (now?.mode === "askDelete") {
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                tone="danger"
                glyph="trash"
                onClick={() => void act(() => deleteLabelKey(key.key))}
              >
                Delete Key
              </Button>
              {cancelButton}
            </>
          }
        >
          Delete <Term>{key.key}</Term>? It comes off{" "}
          {comesOff(key.folders, key.files, key.folders === 1 ? "under it" : "under them")}.
        </RowQuestion>
      );
    }
    return [
      <TermRow
        key={row}
        name={name}
        files={key.files}
        folders={key.folders}
        asking={asking}
        onKeyDown={rowKeys(row, rename, remove)}
        more={moreFor(row, `More for ${key.key}`, [
          [
            { id: "rename", label: "Rename Key…", glyph: "rename", onSelect: rename },
            {
              id: "merge",
              label: "Merge Into…",
              glyph: "merge",
              onSelect: () => {
                loadClashes(key.key);
                setEditing({ row, mode: "merge" });
              },
            },
          ],
          [{ id: "delete", label: "Delete Key", glyph: "trash", tone: "danger", onSelect: remove }],
        ])}
      />,
      ...(open
        ? order(listed, (value) => value.value, sort).map((value) => valueRow(key, value))
        : []),
    ];
  };

  const valueRow = (key: KeyRow, value: ValueRow) => {
    const row = `value:${value.tagId}`;
    const now = editingOf(row);
    const label = `${key.key}: ${value.value}`;
    const rename = () => setEditing({ row, mode: "rename" });
    const remove = () =>
      value.folders === 0
        ? void act(() => deleteLabelValue(value.tagId))
        : setEditing({ row, mode: "askDelete" });
    const existing = (to: string) =>
      key.values.find((other) => other.value === to && other.tagId !== value.tagId);
    const chip = (
      <Chip
        value={value.value}
        tagKey={key.key}
        title={`Search ${labelTerm(key.key, value.value)}`}
        onSearch={search(labelTerm(key.key, value.value))}
      />
    );
    let name: ReactNode = chip;
    if (now?.mode === "rename" || now?.mode === "merge") {
      const merging = now.mode === "merge";
      name = (
        <>
          {merging && chip}
          {merging && <Glyph name="into" className="shrink-0 text-fg-dim text-glyph-small" />}
          <TermField
            label={merging ? `Merge ${label} into` : `Rename ${label}`}
            value={merging ? "" : value.value}
            shape={{ key: key.key }}
            offers={
              merging
                ? (typed) =>
                    key.values
                      .filter(
                        (other) => other.tagId !== value.tagId && other.value.startsWith(typed),
                      )
                      .slice(0, OFFERS)
                      .map((other) => ({
                        value: other.value,
                        said: other.value,
                        count: `on ${plural(other.folders, "folder")}`,
                      }))
                : undefined
            }
            onCancel={stop}
            onCommit={(to) => {
              if (to === value.value) return stop();
              if (existing(to)) return setEditing({ row, mode: "askMerge", into: to });
              void act(() => renameLabelValue(value.tagId, to));
            }}
          />
        </>
      );
    }
    let asking: ReactNode = null;
    const target = now?.mode === "askMerge" && now.into ? existing(now.into) : undefined;
    if (target) {
      const into = `${key.key}: ${target.value}`;
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                glyph="merge"
                onClick={() => void act(() => mergeLabelValues(value.tagId, target.tagId))}
              >
                Merge Values
              </Button>
              {cancelButton}
            </>
          }
        >
          <Term>{into}</Term> is already a value, on {plural(target.folders, "folder")}. Merge{" "}
          <Term>{label}</Term> into it? Its {plural(value.folders, "folder")}{" "}
          {value.folders === 1 ? "takes" : "take"} <Term>{into}</Term>.
        </RowQuestion>
      );
    } else if (now?.mode === "askDelete") {
      asking = (
        <RowQuestion
          answers={
            <>
              <Button
                tone="danger"
                glyph="trash"
                onClick={() => void act(() => deleteLabelValue(value.tagId))}
              >
                Delete Value
              </Button>
              {cancelButton}
            </>
          }
        >
          Delete <Term>{label}</Term>? It comes off{" "}
          {comesOff(value.folders, value.files, value.folders === 1 ? "under it" : "under them")}.
        </RowQuestion>
      );
    }
    return (
      <TermRow
        key={row}
        nested
        name={name}
        files={value.files}
        folders={value.folders}
        asking={asking}
        onKeyDown={rowKeys(row, rename, remove)}
        more={moreFor(row, `More for ${label}`, [
          [
            { id: "rename", label: "Rename Value…", glyph: "rename", onSelect: rename },
            {
              id: "merge",
              label: "Merge Into…",
              glyph: "merge",
              onSelect: () => setEditing({ row, mode: "merge" }),
            },
          ],
          [
            {
              id: "delete",
              label: "Delete Value",
              glyph: "trash",
              tone: "danger",
              onSelect: remove,
            },
          ],
        ])}
      />
    );
  };

  // While the line stands, Ctrl+Z here takes its act back: the list it changed is in view.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (event.key.toLowerCase() !== "z" || line?.kind !== "done") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("input, textarea, select")) return;
    event.preventDefault();
    void undo(line.batchId);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Ctrl+Z reaches the section from whatever in it has the focus.
    <div
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3.5">
        <Head count={headCount} />
        <FilterField
          label="Filter tags and keys"
          value={filter}
          onChange={setFilter}
          count={term ? `${formatCount(found)} of ${formatCount(total)}` : undefined}
        />
        {shownTags.length === 0 && shownKeys.length === 0 ? (
          <EmptyState glyph="tag" title="No Tags Match" note={`“${filter.trim()}”`} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto">
            {shownTags.length > 0 && (
              <TermGroup label="Tags in the library" heading="Tag" sort={sort} onSort={setSort}>
                {shownTags.map(tagRow)}
              </TermGroup>
            )}
            {shownKeys.length > 0 && (
              <TermGroup label="Labels in the library" heading="Label" sort={sort} onSort={setSort}>
                {shownKeys.flatMap(keyRow)}
              </TermGroup>
            )}
          </div>
        )}
      </div>
      {line?.kind === "done" && (
        <Line
          glyph="done"
          sentence={line.line}
          action={
            <Button glyph="undo" title="Undo · Ctrl+Z" onClick={() => void undo(line.batchId)}>
              Undo
            </Button>
          }
          onDismiss={() => setNews(null)}
        />
      )}
      {line?.kind === "undone" && (
        <Line glyph="undo" sentence={line.line} onDismiss={() => setNews(null)} />
      )}
      {menu && (
        <ContextMenu
          label={menu.label}
          groups={menu.groups}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The section's own head: its name, and what it holds. */
function Head({ count }: { count: string }) {
  return (
    <header className="flex shrink-0 items-baseline gap-2">
      <h3 className="m-0 font-semibold text-fg-hi text-row">Tags</h3>
      <span className="text-fg-dim text-small tabular-nums">{count}</span>
    </header>
  );
}

/** What is said after a chip: whose name it is, how many values, or that nothing carries it. */
function Said({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate text-fg-dim text-small">{children}</span>;
}
