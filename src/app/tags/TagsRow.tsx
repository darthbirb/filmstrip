import { useRef, useState } from "react";

import type { EffectiveTag } from "../../ipc/bindings/EffectiveTag";
import { tagOffers } from "../../ipc/commands";
import { labelTerm, tagTerm } from "../../lib/queryTerm";
import { Chip } from "../../ui/Chip";
import { type Refusal, TagField } from "../../ui/TagField";
import { failed, sayFailed } from "../failure";
import { addToSearch, searchFor } from "../search/search";

/** What the owner's own name says under the pointer, and what its tail leaves out. */
export type NameTitle = { title: string; description: string };

/** What a chip's tooltip says: whose it is when it comes from above, else what a click searches. */
export function titleOf(tag: EffectiveTag, nameTitle?: NameTitle) {
  if (tag.from) return tag.name ? `The name of ${tag.from.title}` : `From ${tag.from.title}`;
  if (tag.name && nameTitle) return nameTitle.title;
  return tag.key ? `Search ${tag.key}: ${tag.value}` : `Search ${tag.value}`;
}

/** Every button in a row the keyboard stops on, in order. */
export function stopsIn(row: HTMLElement | null) {
  return [...(row?.querySelectorAll<HTMLElement>("button:not([tabindex='-1'])") ?? [])];
}

/**
 * Takes a tag or a label off; one taken off with the keyboard hands the focus to the next. `what`
 * is what the foot says when it could not be.
 */
export function takeOff(remove: () => Promise<unknown>, stops: () => HTMLElement[], what: string) {
  const at = stops().indexOf(document.activeElement as HTMLElement);
  void remove()
    // What was after it now stands where it stood.
    .then(() => at >= 0 && requestAnimationFrame(() => stops()[at]?.focus()))
    .catch(failed(what));
}

type ChipsProps = {
  tags: EffectiveTag[];
  nameTitle?: NameTitle;
  /** Takes off one of the owner's own; a name and what it inherits are never offered. */
  onRemove?: (tag: EffectiveTag) => void;
  /** The tag a value being typed repeats. */
  echo?: number | null;
};

/** Each tag or label as a chip that searches for itself on a click, and adds itself on Ctrl+Click. */
export function Chips({ tags, nameTitle, onRemove, echo = null }: ChipsProps) {
  return tags.map((tag) => {
    const term = tag.key ? labelTerm(tag.key, tag.value) : tagTerm(tag.value);
    const own = tag.from === null && !tag.name;
    return (
      <Chip
        key={`${tag.tagId}-${tag.from?.id ?? "own"}`}
        value={tag.value}
        tagKey={tag.key}
        inherited={tag.from !== null}
        name={tag.name}
        echoed={tag.tagId === echo}
        title={titleOf(tag, nameTitle)}
        description={tag.name && !tag.from ? nameTitle?.description : undefined}
        onSearch={(adding) => void (adding ? addToSearch(term) : searchFor(term))}
        onRemove={own && onRemove ? () => onRemove(tag) : undefined}
      />
    );
  });
}

type TagsRowProps = {
  /** Whose tags they are, for the field's name and the refusals' words. */
  owner: string;
  /** Its tags, never its labels: its own first, then what it inherits. */
  tags: EffectiveTag[];
  nameTitle?: NameTitle;
  /** Resolve once the change is made; what the owner carries is read again after, unawaited. */
  onAdd: (value: string) => Promise<void>;
  onRemove: (tagId: number) => Promise<void>;
};

/**
 * Its tags and Add Tag…, one control for a folder's band and a file's details. A tag it carries
 * already, its own or from above, is refused where it is typed. DECISIONS.md "A folder's details".
 */
export function TagsRow({ owner, tags, nameTitle, onAdd, onRemove }: TagsRowProps) {
  const row = useRef<HTMLSpanElement>(null);
  const [echo, setEcho] = useState<number | null>(null);

  const refuse = (value: string): Refusal | null => {
    const had = tags.find((tag) => tag.value === value);
    if (!had) return null;
    const line = had.from
      ? `${owner} already has ${value}, ${had.name ? "the name of" : "from"} ${had.from.title}.`
      : had.name
        ? `${value} is this folder’s name.`
        : `${owner} already has ${value}.`;
    return { line, tagId: had.tagId };
  };
  const backOut = () => {
    const own = row.current?.querySelectorAll<HTMLElement>("button[data-removable]");
    own?.[own.length - 1]?.focus();
  };

  return (
    <span ref={row} className="flex flex-wrap items-center gap-1.5 py-px">
      <Chips
        tags={tags}
        nameTitle={nameTitle}
        echo={echo}
        onRemove={(tag) =>
          takeOff(
            () => onRemove(tag.tagId),
            () => stopsIn(row.current),
            `Could not take ${tag.value} off ${owner}.`,
          )
        }
      />
      <TagField
        of={owner}
        offers={tagOffers}
        refuse={refuse}
        onAdd={(value) =>
          onAdd(value).catch((error: unknown) => {
            sayFailed(`Could not add ${value} to ${owner}.`, error);
            throw error;
          })
        }
        onEcho={setEcho}
        onBackOut={backOut}
      />
    </span>
  );
}
