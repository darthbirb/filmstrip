// How the interface words sizes, lengths, shapes and dates.

const UNITS = ["KB", "MB", "GB", "TB"];

/** Bytes as Windows counts them: steps of 1024, under the familiar names. */
/** A count as the machine groups its figures, so four of them read as one number. */
export function formatCount(count: number) {
  return count.toLocaleString();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

/** 0:12, 4:05, 1:02:03. */
export function formatDuration(ms: number) {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

export function formatDimensions(width: number, height: number) {
  return `${width} × ${height}`;
}

/** The day a moment fell on, as a heading: Today, Yesterday, then the date, its year only when it is not this one. */
export function formatDay(seconds: number, now = new Date()) {
  const day = new Date(seconds * 1000);
  const midnight = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  // Rounded, so a day an hour short or long at a change of clocks still counts as one.
  const ago = Math.round((midnight(now) - midnight(day)) / 86_400_000);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  const year = day.getFullYear() === now.getFullYear() ? undefined : "numeric";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year }).format(day);
}

/** A moment as its day and its time: Today, 14:02. */
export function formatWhen(seconds: number, now = new Date()) {
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
    new Date(seconds * 1000),
  );
  return `${formatDay(seconds, now)}, ${time}`;
}

/** A moment, in seconds since 1970. A floating one is a camera's clock, shown as it was written. DECISIONS.md "Capture dates". */
export function formatDate(seconds: number, floating = false) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: floating ? "UTC" : undefined,
  }).format(new Date(seconds * 1000));
}
