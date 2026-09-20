import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * Visual sweep across every surface, at desktop and phone width.
 *
 * Checks three things per page: console errors, failed requests, and horizontal
 * overflow (scrollWidth > innerWidth), which is the classic responsive failure
 * and the one most easily missed by eye. A page that renders but throws is
 * broken; catching that here is cheaper than noticing it in a demo.
 */
const OUT = "/tmp/visual";
mkdirSync(OUT, { recursive: true });

const CRED = { username: "admin", password: "admin" };
const CONSOLE = process.env.DEX_CONSOLE ?? "https://console.dexdash.cloud";
const SITE = process.env.DEX_SITE ?? "https://dexdash.cloud";
const TELLER = process.env.DEX_TELLER ?? "https://teller.dexdash.cloud";

const DESK = { width: 1440, height: 950 };
const PHONE = { width: 390, height: 844 };

const b = await chromium.launch();
const problems = [];

async function check(page, name, label) {
  const errs = page.__errs;
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: label === "desktop" });
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  const iw = await page.evaluate(() => window.innerWidth);
  if (sw > iw + 1) errs.push(`HORIZONTAL OVERFLOW ${sw}px > ${iw}px`);
  const ok = errs.length === 0;
  console.log(`${(name + " · " + label).padEnd(40)} ${ok ? "clean" : "ISSUES: " + errs.slice(0, 2).join(" | ")}`);
  if (!ok) problems.push([name, label, [...errs]]);
  errs.length = 0;
}

function instrument(page) {
  page.__errs = [];
  page.on("console", (m) => m.type() === "error" && page.__errs.push(m.text().slice(0, 110)));
  page.on("pageerror", (e) => page.__errs.push(`pageerror: ${String(e).slice(0, 110)}`));
  page.on("requestfailed", (r) => page.__errs.push(`requestfailed: ${r.url().slice(0, 70)}`));
  return page;
}

/** Plain pages, no session needed. */
for (const [name, url, auth] of [
  ["site", `${SITE}/`, false],
  ["teller-hub", `${TELLER}/`, false],
  ["teller-login", `${TELLER}/t/firstcu`, false],
  ["teller-login-summit", `${TELLER}/t/summit`, false],
  ["console-overview", `${CONSOLE}/`, true],
  ["console-interventions", `${CONSOLE}/interventions`, true],
  ["console-capabilities", `${CONSOLE}/capabilities`, true],
  ["console-capdetail", `${CONSOLE}/capabilities/cu.member.open_subaccount@1.0.0`, true],
  ["console-runs", `${CONSOLE}/runs`, true],
  ["console-new-capability", `${CONSOLE}/capabilities/new`, true],
  [
    "console-diff",
    `${CONSOLE}/capabilities/compare?a=cu.member.lookup_savings@1.0.0&b=cu.member.lookup_savings@1.1.0`,
    true,
  ],
]) {
  for (const [label, vp] of [["desktop", DESK], ["mobile", PHONE]]) {
    const ctx = await b.newContext({ viewport: vp, ...(auth ? { httpCredentials: CRED } : {}) });
    const page = instrument(await ctx.newPage());
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await check(page, name, label);
    } catch (e) {
      console.log(`${(name + " · " + label).padEnd(40)} FAILED: ${String(e).split("\n")[0].slice(0, 60)}`);
      problems.push([name, label, [String(e).slice(0, 110)]]);
    }
    await ctx.close();
  }
}

/** Signed-in teller sections, per tenant. */
for (const tenant of ["firstcu", "summit"]) {
  for (const [label, vp] of [["desktop", DESK], ["mobile", PHONE]]) {
    const ctx = await b.newContext({ viewport: vp });
    const page = instrument(await ctx.newPage());
    try {
      await page.goto(`${TELLER}/t/${tenant}`, { waitUntil: "networkidle" });
      let f = page.frame({ name: "mainFrame" });
      await f.fill('input[type="text"]', "admin");
      await f.fill('input[type="password"]', "admin");
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), f.click("input[type=submit]")]);

      // Summit interposes an acknowledgement screen.
      f = page.frame({ name: "mainFrame" });
      if ((await f.content()).includes("Acceptable Use")) {
        await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), f.click("input[type=submit]")]);
      }
      page.__errs.length = 0;

      for (const section of ["members", "accounts", "transactions", "reports", "admin", "help"]) {
        await page.goto(`${TELLER}/t/${tenant}/${section}`, { waitUntil: "networkidle" });
        await check(page, `teller-${tenant}-${section}`, label);
      }

      // A member record, which is what the automation actually drives.
      await page.goto(`${TELLER}/t/${tenant}/members`, { waitUntil: "networkidle" });
      f = page.frame({ name: "mainFrame" });
      await f.fill('input[type="text"]', "100001");
      await f.click("input[type=submit]");
      await page.waitForTimeout(1200);
      await check(page, `teller-${tenant}-member`, label);
    } catch (e) {
      console.log(`${("teller-" + tenant + " · " + label).padEnd(40)} FAILED: ${String(e).split("\n")[0].slice(0, 60)}`);
      problems.push([`teller-${tenant}`, label, [String(e).slice(0, 110)]]);
    }
    await ctx.close();
  }
}

await b.close();
console.log(`\n${problems.length === 0 ? "ALL CLEAN" : problems.length + " page/viewport combination(s) with issues"}`);
for (const [n, l, e] of problems) console.log(`  ${n} (${l}): ${e.join(" | ")}`);
