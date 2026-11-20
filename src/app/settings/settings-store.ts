import { useSyncExternalStore } from "react";

/** Where Settings opens: a section, and a source whose row is already asking to be removed. */
export type SettingsRequest = { section?: string; asking?: number };

// Null is closed. Held outside the tree, so a menu anywhere can open Settings on a place in it.
let request: SettingsRequest | null = null;
const listeners = new Set<() => void>();

export function openSettings(next: SettingsRequest = {}) {
  request = next;
  for (const listener of listeners) listener();
}

/** A restore running, by the backup's name, and how far it has got. */
export type Restoring = { name: string; percent: number };
/** How a restore ended, kept until Backups is there to say it and put the focus back. */
export type RestoreEnd = { kind: "line" | "band"; sentence: string; focus: string };
type Restore = { restoring: Restoring | null; ended: RestoreEnd | null };

// Outside the tree, so Backups left and opened again finds a restore still running, or how it
// ended; while one runs Settings holds still. Artboards › Backing up the index.
let restore: Restore = { restoring: null, ended: null };
const restoreListeners = new Set<() => void>();

function setRestore(next: Restore) {
  restore = next;
  for (const listener of restoreListeners) listener();
}

export function startRestore(name: string) {
  setRestore({ restoring: { name, percent: 0 }, ended: null });
}

export function restoreProgress(name: string, percent: number) {
  if (restore.restoring?.name !== name) return;
  setRestore({ ...restore, restoring: { name, percent } });
}

export function finishRestore(ended: RestoreEnd) {
  setRestore({ restoring: null, ended });
}

/** Takes how the last restore ended, once it has been said. */
export function takeRestoreEnd() {
  if (restore.ended) setRestore({ ...restore, ended: null });
}

export function useRestore() {
  return useSyncExternalStore(subscribeRestore, () => restore);
}

function subscribeRestore(listener: () => void) {
  restoreListeners.add(listener);
  return () => {
    restoreListeners.delete(listener);
  };
}

/** A remove that failed, kept until the band is dismissed. */
export type RemoveEnd = { sentence: string };
/** The source being removed, by its id. */
type Remove = { removing: number | null; ended: RemoveEnd | null };

// Outside the tree, as a restore is: while one runs Settings holds still. Artboards › Sources.
let remove: Remove = { removing: null, ended: null };
const removeListeners = new Set<() => void>();

function setRemove(next: Remove) {
  remove = next;
  for (const listener of removeListeners) listener();
}

export function startRemove(id: number) {
  setRemove({ removing: id, ended: null });
}

export function finishRemove(ended: RemoveEnd | null) {
  setRemove({ removing: null, ended });
}

export function useRemove() {
  return useSyncExternalStore(subscribeRemove, () => remove);
}

function subscribeRemove(listener: () => void) {
  removeListeners.add(listener);
  return () => {
    removeListeners.delete(listener);
  };
}

/** The Trash emptying: how many of the files counted are settled, of how many. */
export type Emptying = { done: number; whole: number };

// Outside the tree, so Trash left and opened again finds it still counting. Settings does not
// hold still for it: nothing in it can be cancelled. Artboards › The Trash in the Recycle Bin.
let emptying: Emptying | null = null;
const emptyingListeners = new Set<() => void>();

function setEmptying(next: Emptying | null) {
  emptying = next;
  for (const listener of emptyingListeners) listener();
}

export function startEmptying(whole: number) {
  setEmptying({ done: 0, whole });
}

export function emptyingProgress(done: number) {
  if (emptying) setEmptying({ ...emptying, done: Math.min(done, emptying.whole) });
}

export function finishEmptying() {
  setEmptying(null);
}

export function getEmptying() {
  return emptying;
}

export function useEmptying() {
  return useSyncExternalStore(subscribeEmptying, getEmptying);
}

function subscribeEmptying(listener: () => void) {
  emptyingListeners.add(listener);
  return () => {
    emptyingListeners.delete(listener);
  };
}

export function settingsHeld() {
  return restore.restoring !== null || remove.removing !== null;
}

/** Whether a restore or a remove is running, so Settings holds still. */
export function useSettingsHeld() {
  return useSyncExternalStore(subscribeHeld, settingsHeld);
}

function subscribeHeld(listener: () => void) {
  const restoring = subscribeRestore(listener);
  const removing = subscribeRemove(listener);
  return () => {
    restoring();
    removing();
  };
}

export function closeSettings() {
  if (request === null || settingsHeld()) return;
  request = null;
  for (const listener of listeners) listener();
}

export function getSettingsRequest() {
  return request;
}

export function useSettingsRequest() {
  return useSyncExternalStore(subscribe, () => request);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
