import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { LabelField } from "./LabelField";
import { NoteField } from "./NoteField";
import { TagField } from "./TagField";

const none = async () => [];
const nothing = () => {};

function Fields() {
  return (
    <div>
      <section aria-label="Tags">
        <TagField
          of="sphinx.jpg"
          offers={none}
          refuse={() => null}
          onAdd={async () => {}}
          onEcho={nothing}
          onBackOut={nothing}
        />
      </section>
      <section aria-label="Labels">
        <LabelField
          of="Cairo"
          keyOffers={none}
          valueOffers={none}
          refuseKey={() => null}
          onAdd={async () => {}}
          onEcho={nothing}
        />
      </section>
      <section aria-label="Note">
        <Note />
      </section>
      <button type="button">Elsewhere</button>
    </div>
  );
}

/** A note saved a moment after it is asked, the row drawn afresh, as the folder band does. */
function Note() {
  const [note, setNote] = useState<string | null>(null);
  return (
    <NoteField
      key={note ?? ""}
      note={note}
      of="Cairo"
      onSave={async (kept) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        setNote(kept);
        return null;
      }}
    />
  );
}

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

test("Escape out of Add Tag… gives the focus back to Add Tag…", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toHaveFocus();
});

test("Enter on nothing closes Add Tag… onto its button too", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toHaveFocus();
});

test("a click away closes Add Tag… and leaves the focus where the click put it", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await screen.getByRole("button", { name: "Elsewhere" }).click();
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
});

test("Escape out of Add Label… gives the focus back to Add Label…", async () => {
  const screen = await render(<Fields />);
  const labels = screen.getByRole("region", { name: "Labels" });
  await labels.getByRole("button", { name: "Add Label…" }).click();
  await expect.element(labels.getByRole("button", { name: "Add Label…" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(labels.getByRole("button", { name: "Add Label…" })).toHaveFocus();
});

test("Escape out of Add Note… gives the focus back to Add Note…", async () => {
  const screen = await render(<Fields />);
  const note = screen.getByRole("region", { name: "Note" });
  await note.getByRole("button", { name: "Add Note…" }).click();
  await expect.element(note.getByRole("textbox", { name: "Note on Cairo" })).toHaveFocus();
  await userEvent.keyboard("Felucca{Escape}");
  await expect.element(note.getByRole("button", { name: "Add Note…" })).toHaveFocus();
});

test("Ctrl+Enter saves a first note and gives the focus to the note it became", async () => {
  const screen = await render(<Fields />);
  const note = screen.getByRole("region", { name: "Note" });
  await note.getByRole("button", { name: "Add Note…" }).click();
  await expect.element(note.getByRole("textbox", { name: "Note on Cairo" })).toHaveFocus();
  await userEvent.keyboard("Felucca{Control>}{Enter}{/Control}");
  await expect.element(note.getByRole("button", { name: "Change Note on Cairo" })).toHaveFocus();

  await userEvent.keyboard("{Enter}");
  await expect.element(note.getByRole("textbox", { name: "Note on Cairo" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(note.getByRole("button", { name: "Change Note on Cairo" })).toHaveFocus();
});

test("a click away from the note leaves the focus where the click put it", async () => {
  const screen = await render(<Fields />);
  const note = screen.getByRole("region", { name: "Note" });
  await note.getByRole("button", { name: "Add Note…" }).click();
  await expect.element(note.getByRole("textbox", { name: "Note on Cairo" })).toHaveFocus();
  await userEvent.keyboard("Felucca");
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  await elsewhere.click();
  await expect.element(note.getByRole("button", { name: "Change Note on Cairo" })).toBeVisible();
  await expect.element(elsewhere).toHaveFocus();
});
