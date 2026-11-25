import { useEffect } from "react";

import type { Reason } from "../../ipc/bindings/Reason";
import type { Taken } from "../../ipc/bindings/Taken";
import { type AppError, launchBackupRefusal, listBackups } from "../../ipc/commands";
import { setNews } from "../navigation/foot-slot";
import { reasonSentence } from "../undo/lines";

// How the index's backups are worded, and the launch's refused. Artboards › Backing up the index.

const HOW: Record<Taken, string> = {
  launch: "at launch",
  hand: "by hand",
  restore: "before restore",
};

export function howTaken(how: Taken) {
  return HOW[how];
}

/** Why a backup, a restore or a removal failed, as the sentence after the one that says so. */
export function whyFailed(error: unknown): string {
  const failed = error as Partial<AppError> | null;
  return reasonSentence(failed?.reason ?? { kind: "other" });
}

export function notBackedUp(why: string) {
  return `The index could not be backed up. ${why}`;
}

/** The launch's backup, refused, says so at the foot of navigation; the app opens as ever. */
export function useLaunchBackup() {
  useEffect(() => {
    let live = true;
    void launchBackupRefusal()
      .then(async (reason: Reason | null) => {
        if (!reason || !live) return;
        const { dir } = await listBackups();
        setNews({ kind: "keyRefused", line: notBackedUp(reasonSentence(reason)), path: dir });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
}
