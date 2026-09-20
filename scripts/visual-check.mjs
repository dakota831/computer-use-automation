import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * Visual regression sweep.
 *
 * Screenshots every surface at desktop and phone width and reports any console
 * error or failed request it sees on the way. A page that renders but throws is
 * broken; catching that here is cheaper than noticing it in a demo.
 */
const OUT = "/tmp/visual";
mkdirSync(OUT, { recursive: true });

const CRED = { username: "admin", password: "admin" };
const CONSOLE = "https://console.dexdash.cloud";
const SITE = "https://dexdash.cloud";
const TELLER = "https://teller.dexdash.cloud";

const PAGES = [
  ["site", `${SITE}/`, false],
  ["console-overview", `${CONSOLE}/`, true],
  ["console-interventions", `${CONSOLE}/interventions`, true],
  ["console-capabilities", `${CONSOLE}/capabilities`, true],
  ["console-capdetail", `${CONSOLE}/capabilities/cu.member.read_savings_balance@1.0.0`, true],
  ["console-runs", `${CONSOLE}/runs`, true],
  ["teller-login", `${TELLER}/t/firstcu`, false],
  ["teller-summit", `${TELLER}/t/summit`, false],
];

const b = await chromium.launch();
const problems = [];

for (const [name, url, auth] of PAGES) {
  for (const [label, vp] of [["desktop", { width: 1440, height: 950 }], ["mobile", { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport: vp, ...(auth ? { httpCredentials: CRED } : {}) });
    const p = await ctx.newPage();
    const errs = [];
    p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 120)));
    p.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 120)}`));
    p.on("requestfailed", (r) => errs.push(`requestfailed: ${r.url().slice(0, 80)}`));
    try {
      await p.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await p.waitForTimeout(1200);
      await p.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: label === "desktop" });
      // Horizontal overflow is the classic responsive failure.
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) errs.push(`HORIZONTAL OVERFLOW (${await p.evaluate(() => document.documentElement.scrollWidth)}px)`);
      const status = errs.length ? `ISSUES: ${errs.slice(0, 2).join(" | ")}` : "clean";
      console.log(`${(name + "-" + label).padEnd(34)} ${status}`);
      if (errs.length) problems.push([name, label, errs]);
    } catch (e) {
      console.log(`${(name + "-" + label).padEnd(34)} FAILED: ${String(e).split("\n")[0].slice(0, 70)}`);
      problems.push([name, label, [String(e).slice(0, 120)]]);
    }
    await ctx.close();
  }
}

await b.close();
console.log(`\n${problems.length === 0 ? "ALL CLEAN" : problems.length + " page(s) with issues"}`);
