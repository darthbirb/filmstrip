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

/** A moment, in seconds since 1970. A floating one is a camera's clock, shown as it was written. DECISIONS.md "Capture dates". */
export function formatDate(seconds: number, floating = false) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: floating ? "UTC" : undefined,
  }).format(new Date(seconds * 1000));
}
