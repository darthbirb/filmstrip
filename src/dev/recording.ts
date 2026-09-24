// For tests: what the app asks the backend while something runs, answered by the dev mock unless
// the test answers first.

type Internals = { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
const internals = () =>
  (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;

/** Every command the app sends while `work` runs, answered as the dev mock answers it. */
export async function recording(
  work: (calls: [string, unknown][]) => Promise<void>,
  answer?: (cmd: string, args: unknown) => unknown,
) {
  const real = internals().invoke;
  const calls: [string, unknown][] = [];
  internals().invoke = (cmd, args, options) => {
    calls.push([cmd, args]);
    const answered = answer?.(cmd, args);
    return answered === undefined ? real(cmd, args, options) : Promise.resolve(answered);
  };
  try {
    await work(calls);
  } finally {
    internals().invoke = real;
  }
}
