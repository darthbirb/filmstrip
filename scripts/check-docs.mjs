// Fails on a doc pointer to a heading that does not exist, and on a comment block longer
// than MAX_COMMENT_LINES. DEVELOPMENT.md "Keeping the docs true".
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DOCS = ["PRODUCT", "DECISIONS", "DEVELOPMENT", "SCHEMA"];
const MAX_COMMENT_LINES = 3;
const SCANNED = ["src", "src-tauri/src", "tests", "scripts"];
const GENERATED = ["src/ipc/bindings"];
const PROSE = ["AGENTS.md", "CLAUDE.md", "README.md", ...DOCS.map((d) => `docs/${d}.md`)];

const headings = new Map(
  DOCS.map((doc) => {
    const text = readFileSync(join(ROOT, "docs", `${doc}.md`), "utf8");
    const titles = [...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
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

for (const dir of SCANNED) {
  for (const entry of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = relative(ROOT, join(entry.parentPath, entry.name)).replaceAll("\\", "/");
    if (GENERATED.some((g) => file.startsWith(`${g}/`))) continue;
    const text = readFileSync(join(ROOT, file), "utf8");
    checkPointers(file, text);
    checkCommentLength(file, text);
  }
}
for (const file of PROSE) checkPointers(file, readFileSync(join(ROOT, file), "utf8"));

for (const failure of failures) console.error(failure);
console.log(`${pointers} pointers checked, ${failures.length} problems`);
process.exit(failures.length ? 1 : 0);
