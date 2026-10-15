import { listen } from "@tauri-apps/api/event";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { Backup } from "../../ipc/bindings/Backup";
import type { Shelved } from "../../ipc/bindings/Shelved";
import { backUpNow, listBackups, restoreBackup, setBackupsKept } from "../../ipc/commands";
import { formatBytes, formatCount, formatWhen } from "../../lib/format";
import { BackupGroup, BackupRow, RowProgress } from "../../ui/BackupTable";
import { Band } from "../../ui/Band";
import { Bar } from "../../ui/Bar";
import { Button } from "../../ui/Button";
import { Dropdown } from "../../ui/Dropdown";
import { EmptyState } from "../../ui/EmptyState";
import { Line } from "../../ui/Line";
import { PushDown } from "../../ui/PushDown";
import { RowQuestion } from "../../ui/TermTable";
import { libraryChanged } from "../library";
import { setNews } from "../navigation/foot-slot";
import { useWork } from "../navigation/work-store";
import { backupWhen, howTaken, notBackedUp, whyFailed } from "./backup-words";
import { Rows } from "./Rows";
import { holdSettings } from "./settings-store";

// The index's backups, taken by hand and restored on their row. Artboards › Backing up the index;
// DECISIONS.md "Backing up the index".

const KEPT = [3, 7, 14, 30].map((kept) => ({ value: String(kept), label: String(kept) }));

const plural = (n: number, one: string) => `${formatCount(n)} ${n === 1 ? one : `${one}s`}`;
const Term = ({ children }: { children: ReactNode }) => <span className="text-fg">{children}</span>;

type Said = { kind: "line"; sentence: string } | { kind: "band"; sentence: string; path?: string };

export function Backups() {
  const [shelved, setShelved] = useState<Shelved | null>(null);
  const [writing, setWriting] = useState<number | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<{ name: string; percent: number } | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const root = useRef<HTMLDivElement>(null);
  const { progress } = useWork();

  const load = useCallback(() => {
    void listBackups()
      .then(setShelved)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const heard = listen("backups-changed", load).catch(() => undefined);
    return () => {
      void heard.then((unlisten) => unlisten?.());
    };
  }, [load]);

  useEffect(() => {
    if (focus === null || asking || restoring) return;
    const button = buttons.current.get(focus);
    if (!button && shelved?.backups.some((backup) => backup.name === focus)) return;
    (button ?? root.current)?.focus({ preventScroll: true });
    setFocus(null);
  });

  if (!shelved) return <Head count="" onBackUp={() => undefined} />;
  const { backups, keep } = shelved;
  const busy = restoring !== null;

  const backUp = () => {
    if (writing !== null || busy) return;
    setWriting(Math.floor(Date.now() / 1000));
    setSaid(null);
    void backUpNow()
      .catch((error: unknown) =>
        setSaid({ kind: "band", sentence: notBackedUp(whyFailed(error)), path: shelved.dir }),
      )
      .finally(() => {
        setWriting(null);
        load();
      });
  };

  const restore = async (backup: Backup) => {
    const when = backupWhen(backup);
    setAsking(null);
    setSaid(null);
    setRestoring({ name: backup.name, percent: 0 });
    holdSettings(true);
    const heard = listen<number>("restore-progress", (event) =>
      setRestoring((now) => now && { ...now, percent: event.payload }),
    ).catch(() => undefined);
    try {
      const restored = await restoreBackup(backup.name);
      if (restored.kind === "unreadable") {
        setSaid({
          kind: "band",
          sentence: `The backup from ${when} could not be read. The index is as it was.`,
        });
        setFocus(backup.name);
      } else {
        setNews(null);
        setSaid({ kind: "line", sentence: `Restored the index from ${when}.` });
        setFocus(restored.back.name);
        await libraryChanged();
      }
    } catch (error) {
      setSaid({
        kind: "band",
        sentence: `The index could not be restored. ${whyFailed(error)}. The index is as it was.`,
      });
      setFocus(backup.name);
    } finally {
      void heard.then((unlisten) => unlisten?.());
      holdSettings(false);
      setRestoring(null);
      load();
    }
  };

  const cancel = (name: string) => {
    setAsking(null);
    setFocus(name);
  };
  const rowKeys = (name: string) => (event: KeyboardEvent) => {
    if (event.key !== "Escape" || asking !== name) return;
    event.preventDefault();
    event.stopPropagation();
    cancel(name);
  };

  const total = backups.reduce((sum, backup) => sum + backup.bytes, 0);
  const count =
    backups.length > 0
      ? `${plural(backups.length, "backup")} · ${formatBytes(total)}`
      : plural(0, "backup");
  const pending = writing ?? (shelved.writing ? Math.floor(Date.now() / 1000) : null);
  const going = (at: number) => backups.length > keep && at >= keep - 1;

  const row = (backup: Backup, at: number) => {
    const when = formatWhen(backup.takenAt);
    const how = !backup.readable
      ? "unreadable"
      : going(at)
        ? "removed at the next backup"
        : howTaken(backup.how);
    const here = restoring?.name === backup.name;
    let under: ReactNode = null;
    if (here && restoring) {
      under = (
        <RowProgress sentence={`Restoring the index from ${when}…`} percent={restoring.percent} />
      );
    } else if (asking === backup.name) {
      under = (
        <RowQuestion
          answers={
            <>
              <Button tone="danger" glyph="undo" onClick={() => void restore(backup)}>
                Restore Index
              </Button>
              <Button tone="quiet" onClick={() => cancel(backup.name)}>
                Cancel
              </Button>
            </>
          }
        >
          Restore the index from <Term>{when}</Term>? Tags, labels, notes, statuses, covers,
          favourites, keys and the undo journal go back to then. The index as it is now is kept as a
          backup first.{stopping(progress?.copies.length ?? 0, progress?.exports.length ?? 0)}
        </RowQuestion>
      );
    }
    return (
      <BackupRow
        key={backup.name}
        when={when}
        how={how}
        going={going(at)}
        size={formatBytes(backup.bytes)}
        asking={under}
        onKeyDown={rowKeys(backup.name)}
        action={
          backup.readable && (
            <Button
              small
              ref={(element) => {
                if (element) buttons.current.set(backup.name, element);
                else buttons.current.delete(backup.name);
              }}
              onClick={() => {
                if (!busy) setAsking(backup.name);
              }}
            >
              Restore…
            </Button>
          )
        }
      />
    );
  };

  return (
    <div ref={root} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3.5">
        <Head count={count} onBackUp={backUp} />
        <Rows
          rows={[
            {
              label: "Backups to Keep",
              control: (
                <Dropdown
                  label="Backups to Keep"
                  align="end"
                  options={KEPT}
                  value={String(keep)}
                  onChange={(kept) => {
                    setShelved({ ...shelved, keep: Number(kept) });
                    void setBackupsKept(Number(kept))
                      .catch(() => undefined)
                      .finally(load);
                  }}
                />
              ),
            },
          ]}
        />
        {backups.length === 0 && pending === null ? (
          <div className="flex min-h-0 flex-1 flex-col justify-center rounded-control bg-inset inset-ring inset-ring-line-control">
            <EmptyState glyph="backups" title="No Backups Yet" />
          </div>
        ) : (
          <BackupGroup label="Backups of the index">
            <PushDown open={pending !== null}>
              {pending !== null && (
                <BackupRow
                  when={formatWhen(pending)}
                  how="backing up…"
                  size={<Bar percent={0} />}
                />
              )}
            </PushDown>
            {backups.map(row)}
          </BackupGroup>
        )}
      </div>
      {said?.kind === "line" && (
        <Line glyph="done" sentence={said.sentence} onDismiss={() => setSaid(null)} />
      )}
      {said?.kind === "band" && (
        <Band sentence={said.sentence} path={said.path} onDismiss={() => setSaid(null)} />
      )}
    </div>
  );
}

/** What a restore stops first, said on its question while it runs. */
function stopping(copies: number, exports: number) {
  const what = [
    ...(copies > 0 ? [copies === 1 ? "the copy" : "the copies"] : []),
    ...(exports > 0 ? [exports === 1 ? "the export" : "the exports"] : []),
  ].join(" and ");
  if (!what) return "";
  const one = copies + exports === 1;
  return ` ${what.charAt(0).toUpperCase()}${what.slice(1)} running now ${one ? "is" : "are"} stopped first, as Cancel would stop ${one ? "it" : "them"}.`;
}

/** The section's own head: its name, how many it keeps and what they weigh, and Back Up Now. */
function Head({ count, onBackUp }: { count: string; onBackUp: () => void }) {
  return (
    <header className="flex shrink-0 items-center gap-2">
      <h3 className="m-0 font-semibold text-fg-hi text-row">Backups</h3>
      <span className="min-w-0 flex-1 truncate text-fg-dim text-small tabular-nums">{count}</span>
      <Button onClick={onBackUp}>Back Up Now</Button>
    </header>
  );
}
