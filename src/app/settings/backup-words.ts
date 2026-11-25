import { useEffect } from "react";

import type { Reason } from "../../ipc/bindings/Reason";
import type { Taken } from "../../ipc/bindings/Taken";
import { launchBackupRefusal, listBackups } from "../../ipc/commands";
import { unasked } from "../failure";
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
      .catch(unasked);
    return () => {
      live = false;
    };
  }, []);
}
