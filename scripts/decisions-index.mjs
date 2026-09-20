import { readFileSync, writeFileSync } from "node:fs";

/**
 * Regenerate the index at the top of DECISIONS.md from its own headings.
 *
 * Generated rather than hand-kept, because an index that drifts from the
 * document is worse than none — it sends a reader to the wrong place.
 */
const P = "DECISIONS.md";
const text = readFileSync(P, "utf8");

const entries = [...text.matchAll(/^## (D\d+) — (.+)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
if (!entries.length) throw new Error("no decision headings found");

const GROUPS = [
  ["Foundations", ["D1", "D2", "D3"]],
  ["The artifact and how controls are found", ["D4", "D5", "D11", "D21"]],
  ["Replay, errors and determinism", ["D9", "D12", "D32"]],
  ["Safety and risk", ["D6", "D8", "D10", "D14", "D31"]],
  ["Discovery and the review loop", ["D15", "D16", "D17", "D26", "D28", "D34"]],
  ["Escalation and control transfer", ["D18", "D19", "D24"]],
  ["Multi-tenant", ["D25"]],
  ["Interface and operations", ["D20", "D22", "D23", "D29", "D30", "D33", "D35", "D36"]],
  ["Measurements and mistakes worth keeping", ["D7", "D13", "D27"]],
];

const byId = new Map(entries.map((e) => [e.id, e]));
const grouped = new Set(GROUPS.flatMap(([, ids]) => ids));
const ungrouped = entries.filter((e) => !grouped.has(e.id));

const lines = [
  "## Index",
  "",
  "Newest entries are at the bottom of the file; this index groups them by subject.",
  "",
];
for (const [name, ids] of GROUPS) {
  const rows = ids.filter((id) => byId.has(id));
  if (!rows.length) continue;
  lines.push(`**${name}**  `);
  lines.push(rows.map((id) => `[${id}](#${slug(id, byId.get(id).title)}) ${byId.get(id).title.toLowerCase()}`).join("  ·  "));
  lines.push("");
}
if (ungrouped.length) {
  lines.push("**Also**  ");
  lines.push(ungrouped.map((e) => `[${e.id}](#${slug(e.id, e.title)}) ${e.title.toLowerCase()}`).join("  ·  "));
  lines.push("");
}

function slug(id, title) {
  return `${id}--${title}`
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

// Replace an existing index, or insert after the file's opening preamble.
const marker = "\n---\n";
const first = text.indexOf(marker);
const head = text.slice(0, first + marker.length);
let body = text.slice(first + marker.length);
body = body.replace(/^\s*## Index[\s\S]*?(?=\n## D1 )/, "");

writeFileSync(P, `${head}\n${lines.join("\n")}\n---\n${body}`);
console.log(`DECISIONS.md: index regenerated for ${entries.length} entries`);
