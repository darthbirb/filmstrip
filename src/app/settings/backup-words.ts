import { useEffect } from "react";

import type { Backup } from "../../ipc/bindings/Backup";
import type { Reason } from "../../ipc/bindings/Reason";
import type { Taken } from "../../ipc/bindings/Taken";
import { type AppError, launchBackupRefusal, listBackups } from "../../ipc/commands";
import { formatWhen } from "../../lib/format";
import { setNews } from "../navigation/foot-slot";
import { reasonText } from "../undo/lines";

// How the index's backups are worded, and the launch's refused. Artboards › Backing up the index.

const HOW: Record<Taken, string> = {
  launch: "at launch",
  hand: "by hand",
  restore: "before restore",
};

export function howTaken(how: Taken) {
  return HOW[how];
}

export function backupWhen(backup: Backup, now = new Date()) {
  return formatWhen(backup.takenAt, now);
}

/** Why a backup or a restore failed, as the band says it after its first sentence. */
export function whyFailed(error: unknown): string {
  const failed = error as Partial<AppError> | null;
  if (failed?.reason) return reasonText(failed.reason);
  const message = failed?.message ?? "Something went wrong";
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export function notBackedUp(why: string) {
  return `The index could not be backed up. ${why}.`;
}

/** The launch's backup, refused, says so at the foot of navigation; the app opens as ever. */
export function useLaunchBackup() {
  useEffect(() => {
    let live = true;
    void launchBackupRefusal()
      .then(async (reason: Reason | null) => {
        if (!reason || !live) return;
        const { dir } = await listBackups();
        setNews({ kind: "keyRefused", line: notBackedUp(reasonText(reason)), path: dir });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
}
