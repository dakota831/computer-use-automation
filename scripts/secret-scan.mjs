import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Refuse to let a live credential reach the repository.
 *
 * .gitignore is the first line and it is enough right up until somebody runs
 * `git add -f`, renames a file, or pastes a key into a README while writing an
 * example. This is the check that does not depend on remembering. It scans what
 * git actually tracks, because that is what gets pushed.
 */
const PATTERNS = [
  [/\bnvapi-[A-Za-z0-9_-]{20,}/, "NVIDIA API key"],
  [/\bsk-[A-Za-z0-9]{20,}/, "OpenAI-style API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
];

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  // Binary and generated output: nothing here is hand-edited, and a false
  // positive in a screenshot would only teach people to pass --no-verify.
  .filter((f) => !/\.(png|jpe?g|gif|ico|woff2?|pdf)$/i.test(f));

/**
 * An exemption has to be visible at the thing it exempts.
 *
 * Redaction tests need values shaped like real credentials, so some true
 * pattern matches are deliberate. The first version of this hardcoded the
 * fixture strings here, which meant the scanner and the tests had to be kept
 * in step by memory and a new fixture would silently be allowed or silently
 * fail. A pragma on the line, or the line above, says so where a reader of
 * that line will see it.
 */
const ALLOW = /secret-scan-allow/;

const findings = [];
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (const [re, label] of PATTERNS) {
    lines.forEach((line, i) => {
      const m = line.match(re);
      if (!m) return;
      if (ALLOW.test(line) || ALLOW.test(lines[i - 1] ?? "")) return;
      findings.push(`${f}:${i + 1}: ${label} — ${m[0].slice(0, 12)}…`);
    });
  }
}

if (findings.length) {
  console.error("SECRETS FOUND in tracked files:\n  " + findings.join("\n  "));
  console.error(
    "\nRemove it, rotate the credential, and put the value in .env or a sealed key.",
  );
  process.exit(1);
}
console.log(`no credentials in ${files.length} tracked files`);
