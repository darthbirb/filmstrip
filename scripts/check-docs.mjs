// Fails on a doc pointer to a heading that does not exist, on a comment block longer than
// MAX_COMMENT_LINES, and on DESIGN.md's tokens disagreeing with app.css.
// DEVELOPMENT.md "Keeping the docs true".
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DOCS = ["PRODUCT", "DECISIONS", "DEVELOPMENT", "SCHEMA", "DESIGN"];
const MAX_COMMENT_LINES = 3;
const SCANNED = ["src", "src-tauri/src", "tests", "scripts"];
const GENERATED = ["src/ipc/bindings"];
const PROSE = ["AGENTS.md", "CLAUDE.md", "README.md", ...DOCS.map((d) => `docs/${d}.md`)];
const read = (file) => readFileSync(join(ROOT, file), "utf8").replaceAll("\r\n", "\n");

const headings = new Map(
  DOCS.map((doc) => {
    const titles = [...read(`docs/${doc}.md`).matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
    return [doc, new Set(titles)];
  }),
);

const POINTER = new RegExp(String.raw`\b(${DOCS.join("|")})\.md "([^"\n]*)("?)`, "g");
const failures = [];
let pointers = 0;

function checkPointers(file, text) {
  text.split("\n").forEach((line, index) => {
    for (const [, doc, title, closed] of line.matchAll(POINTER)) {
      pointers++;
      const where = `${file}:${index + 1}`;
      if (!closed) failures.push(`${where}  pointer wraps onto the next line: ${doc}.md "${title}`);
      else if (!headings.get(doc).has(title))
        failures.push(`${where}  no heading ${doc}.md "${title}"`);
    }
  });
}

function commentMarker(file) {
  if (file.endsWith(".sql")) return /^\s*--/;
  if (/\.(rs|ts|tsx|mjs|js)$/.test(file)) return /^\s*\/\//;
  return null;
}

function checkCommentLength(file, text) {
  const marker = commentMarker(file);
  if (!marker) return;
  let start = 0;
  let run = 0;
  [...text.split("\n"), ""].forEach((line, index) => {
    if (marker.test(line)) {
      if (run === 0) start = index + 1;
      run++;
      return;
    }
    if (run > MAX_COMMENT_LINES) {
      failures.push(`${file}:${start}  comment runs ${run} lines (at most ${MAX_COMMENT_LINES})`);
    }
    run = 0;
  });
}

/** The base look's tokens: every `:root` and `@theme static` block, with var() resolved. */
function cssTokens() {
  const css = read("src/styles/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const raw = new Map();
  for (const [, body] of css.matchAll(/(?:^|\n)(?::root|@theme static)\s*\{([^}]*)\}/g)) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      raw.set(name, value.trim());
    }
  }
  const resolve = (value, depth = 0) =>
    depth > 8
      ? value
      : value.replace(/var\((--[\w-]+)\)/g, (whole, name) =>
          raw.has(name) ? resolve(raw.get(name), depth + 1) : whole,
        );
  return new Map([...raw].map(([name, value]) => [name, resolve(value)]));
}

/** The front matter's nested maps, as far as DESIGN.md uses YAML: keys, maps and scalars. */
function frontMatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const line of block.split("\n")) {
    const entry = line.trim().match(/^([^:#]+):\s*(.*)$/);
    if (!entry) continue;
    const indent = line.length - line.trimStart().length;
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1).node;
    const [, key, value] = entry;
    if (value === "") {
      parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = value.replace(/^"(.*)"$/, "$1");
    }
  }
  return root;
}

const same = (a, b) =>
  a.replace(/\s+/g, " ").toLowerCase() === b.replace(/\s+/g, " ").toLowerCase();
const firstFamily = (value) =>
  value
    .split(",")[0]
    .trim()
    .replace(/^"(.*)"$/, "$1");

function checkDesignTokens() {
  const tokens = cssTokens();
  const design = frontMatter(read("docs/DESIGN.md"));
  const documented = new Set();
  const expect = (where, name, stated) => {
    documented.add(name);
    const actual = tokens.get(name);
    if (actual === undefined) failures.push(`docs/DESIGN.md  ${where} is not in app.css (${name})`);
    else if (!same(actual, stated))
      failures.push(`docs/DESIGN.md  ${where} is ${stated}, but app.css says ${actual}`);
  };

  const groups = { colors: "--color-", rounded: "--radius-", spacing: "--spacing-" };
  for (const [group, prefix] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(design[group] ?? {})) {
      expect(`${group}.${key}`, prefix + key, value);
    }
  }
  const families = new Set(
    [...tokens]
      .filter(([name]) => name.startsWith("--font-"))
      .map(([, value]) => firstFamily(value)),
  );
  const fields = {
    fontSize: "",
    lineHeight: "--line-height",
    fontWeight: "--font-weight",
    letterSpacing: "--letter-spacing",
  };
  for (const [key, style] of Object.entries(design.typography ?? {})) {
    for (const [field, suffix] of Object.entries(fields)) {
      if (style[field] !== undefined)
        expect(`typography.${key}.${field}`, `--text-${key}${suffix}`, style[field]);
    }
    if (!families.has(style.fontFamily)) {
      failures.push(
        `docs/DESIGN.md  typography.${key}.fontFamily is no --font-* family in app.css`,
      );
    }
  }
  for (const name of tokens.keys()) {
    if (/^--(color|radius|spacing|text)-/.test(name) && !documented.has(name)) {
      failures.push(`docs/DESIGN.md  does not list ${name}`);
    }
  }
  for (const [component, properties] of Object.entries(design.components ?? {})) {
    for (const [property, value] of Object.entries(properties)) {
      for (const [, group, key] of value.matchAll(/\{(\w+)\.([\w-]+)\}/g)) {
        if (design[group]?.[key] === undefined) {
          failures.push(
            `docs/DESIGN.md  components.${component}.${property} names no {${group}.${key}}`,
          );
        }
      }
    }
  }
}

for (const dir of SCANNED) {
  for (const entry of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/");
    if (GENERATED.some((g) => file.startsWith(`${g}/`))) continue;
    const text = read(file);
    checkPointers(file, text);
    checkCommentLength(file, text);
  }
}
for (const file of PROSE) checkPointers(file, read(file));
checkDesignTokens();

for (const failure of failures) console.error(failure);
console.log(`${pointers} pointers checked, ${failures.length} problems`);
process.exit(failures.length ? 1 : 0);
