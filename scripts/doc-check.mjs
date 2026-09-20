import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * Verify the documentation against the repository it describes.
 *
 * Docs drift silently: a renamed script or a moved file leaves prose that still
 * reads fine and no longer works. This checks the parts that can be checked —
 * file paths, npm scripts, cited counts, and the artifacts and evidence the
 * text claims exist.
 */
const DOCS = [
  "README.md",
  "REPORT.md",
  "DECISIONS.md",
  "evidence/README.md",
  "deploy/README.md",
];
const problems = [];
const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => {
  console.log(`  BAD   ${m}`);
  problems.push(m);
};

const stripAnsi = (s) =>
  s.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = Object.keys(pkg.scripts);

for (const doc of DOCS) {
  if (!existsSync(doc)) {
    bad(`${doc} is missing`);
    continue;
  }
  const text = readFileSync(doc, "utf8");
  const base = doc.includes("/")
    ? doc.split("/").slice(0, -1).join("/") + "/"
    : "";

  for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s#]+)/g)) {
    const p = m[1].replace(/\/$/, "");
    if (!existsSync(p) && !existsSync(base + p))
      bad(`${doc}: link to missing path "${m[1]}"`);
  }

  for (const m of text.matchAll(
    /`((?:src|web|target-app|scripts|tests|deploy|artifacts|evidence|docs)\/[^`\s]+)`/g,
  )) {
    const p = m[1].replace(/\/$/, "");
    if (!existsSync(p)) bad(`${doc}: reference to missing path "${p}"`);
  }

  // DECISIONS.md is a historical log: it legitimately names scripts that were
  // removed. Commands are only checked where a reader would type them.
  if (doc !== "DECISIONS.md") {
    // Hyphens are part of a script name. Without them "npm run seal-key"
    // parsed as "npm run seal" and this check reported a script that the
    // docs never mentioned - a checker producing false alarms gets ignored,
    // which costs more than the check was worth.
    for (const m of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
      if (!scripts.includes(m[1]))
        bad(`${doc}: "npm run ${m[1]}" is not a script`);
    }
  }
}
ok(`${DOCS.length} docs scanned for paths and commands`);

const testOut = stripAnsi(
  execSync("npx vitest run 2>&1 || true", { encoding: "utf8" }),
);
const realTests = Number(/Tests\s+(\d+) passed/.exec(testOut)?.[1] ?? 0);
const readme = readFileSync("README.md", "utf8");
const claimed = Number(/(\d+) unit tests/.exec(readme)?.[1] ?? 0);
if (realTests === 0) bad("could not determine the real test count");
else if (claimed !== realTests)
  bad(`README claims ${claimed} unit tests, actual is ${realTests}`);
else ok(`test count matches (${realTests})`);

for (const m of readme.matchAll(/cu\.member\.[a-z_]+(@\d+\.\d+\.\d+)?/g)) {
  const [id, ver] = m[0].split("@");
  const hits = execSync(`ls artifacts/ | grep -c "^${id}@" || true`, {
    encoding: "utf8",
  }).trim();
  if (hits === "0") bad(`README names capability "${m[0]}" with no artifact`);
  else if (ver && !existsSync(`artifacts/${id}@${ver}.json`))
    bad(`README names "${m[0]}" but that version is absent`);
}
ok("capabilities named in README all exist");

const evReadme = readFileSync("evidence/README.md", "utf8");
for (const m of evReadme.matchAll(/`(\d\d-[a-z-]+)`/g)) {
  if (!existsSync(`evidence/${m[1]}`))
    bad(`evidence/README.md describes missing run "${m[1]}"`);
}
ok("evidence runs described all present");

for (const m of readme.matchAll(/\(docs\/screenshots\/([^)]+)\)/g)) {
  if (!existsSync(`docs/screenshots/${m[1]}`))
    bad(`README embeds missing screenshot "${m[1]}"`);
}
ok("screenshots embedded in README all present");

console.log(
  `\n${problems.length === 0 ? "DOCS CONSISTENT" : problems.length + " problem(s)"}`,
);
process.exit(problems.length ? 1 : 0);
