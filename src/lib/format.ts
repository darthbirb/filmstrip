// How the interface words sizes, lengths, shapes and dates.

const UNITS = ["KB", "MB", "GB", "TB"];

/** A count as the machine groups its figures, so four of them read as one number. */
export function formatCount(count: number) {
  return count.toLocaleString();
}

/** Bytes as Windows counts them: steps of 1024, under the familiar names. */
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

/** How far into a clip, in whole seconds gone, its own length once over, and as many places as that length needs: 0:31, or 0:00:31 of 1:02:03. */
export function formatElapsed(ms: number, lengthMs: number) {
  const length = formatDuration(lengthMs);
  if (lengthMs > 0 && ms >= lengthMs) return length;
  const clock = formatDuration(Math.floor(ms / 1000) * 1000);
  const places = (text: string) => text.split(":").length;
  return places(clock) < places(length) ? `0:${clock.padStart(5, "0")}` : clock;
}

export function formatDimensions(width: number, height: number) {
  return `${width} × ${height}`;
}

type Moment = {
  now?: Date;
  /** A camera's clock, shown as it was written. DECISIONS.md "Capture dates". */
  floating?: boolean;
};

const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(shape: string, options: Intl.DateTimeFormatOptions) {
  let made = formatters.get(shape);
  if (!made) {
    made = new Intl.DateTimeFormat(undefined, options);
    formatters.set(shape, made);
  }
  return made;
}

function dayOf(at: Date, floating: boolean) {
  return floating
    ? Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / DAY
    : Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY;
}

/** The date style: Today, Yesterday, 3 Oct, or 3 Oct 2025 outside this year. DESIGN.md "Words". */
export function formatDate(seconds: number, { now = new Date(), floating = false }: Moment = {}) {
  const at = new Date(seconds * 1000);
  const ago = dayOf(now, false) - dayOf(at, floating);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  const year = floating ? at.getUTCFullYear() : at.getFullYear();
  const withYear = year !== now.getFullYear();
  return formatter(`date ${withYear} ${floating}`, {
    day: "numeric",
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: floating ? "UTC" : undefined,
  }).format(at);
}

/** The date-and-time style: the date, then the time on the system's clock. Today, 14:02. */
export function formatWhen(seconds: number, moment: Moment = {}) {
  const floating = moment.floating ?? false;
  const time = formatter(`time ${floating}`, {
    timeStyle: "short",
    timeZone: floating ? "UTC" : undefined,
  }).format(new Date(seconds * 1000));
  return `${formatDate(seconds, moment)}, ${time}`;
}

/** A date or a date and time inside a sentence, where today and yesterday are not capitalised. */
export function midSentence(when: string) {
  return when.replace(/^(Today|Yesterday)/, (word) => word.toLowerCase());
}
