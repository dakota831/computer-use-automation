import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/**
 * Capture the screenshots embedded in README.md.
 *
 * Reproducible on purpose: a reviewer can re-run this and get the same images,
 * and they cannot drift from the running system without someone noticing.
 * Requires the target app and the API server to be up.
 */
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const CRED = { username: "admin", password: "admin" };
const SITE = process.env.DEX_SITE ?? "https://dexdash.cloud";
const CONSOLE = process.env.DEX_CONSOLE ?? "https://console.dexdash.cloud";
const TELLER = process.env.DEX_TELLER ?? "https://teller.dexdash.cloud";
const API = process.env.DEX_API ?? "http://127.0.0.1:4000";

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => r.json();

const b = await chromium.launch();

async function shot(
  name,
  url,
  { vp = DESK, auth = false, full = false, prep } = {},
) {
  const ctx = await b.newContext({
    viewport: vp,
    ...(auth ? { httpCredentials: CRED } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  if (prep) await prep(page);
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log(`  ${name}.png`);
  await ctx.close();
}

console.log("capturing:");
await shot("01-landing", `${SITE}/`);
await shot("02-teller-hub", `${TELLER}/`);
await shot("03-teller-login", `${TELLER}/t/firstcu`);

// Signed-in teller: member record and the account register.
{
  const ctx = await b.newContext({ viewport: DESK });
  const page = await ctx.newPage();
  await page.goto(`${TELLER}/t/firstcu`, { waitUntil: "networkidle" });
  let f = page.frame({ name: "mainFrame" });
  await f.fill('input[type="text"]', "admin");
  await f.fill('input[type="password"]', "admin");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle" }),
    f.click("input[type=submit]"),
  ]);
  f = page.frame({ name: "mainFrame" });
  await f.fill('input[type="text"]', "100001");
  await f.click("input[type=submit]");
  await sleep(1300);
  await page.screenshot({ path: `${OUT}/04-teller-member.png` });
  console.log("  04-teller-member.png");
  await page.goto(`${TELLER}/t/firstcu/accounts`, { waitUntil: "networkidle" });
  await sleep(900);
  await page.screenshot({ path: `${OUT}/05-teller-accounts.png` });
  console.log("  05-teller-accounts.png");
  await ctx.close();
}

await shot("06-console-overview", `${CONSOLE}/`, { auth: true });
await shot("07-console-capabilities", `${CONSOLE}/capabilities`, {
  auth: true,
});
await shot(
  "08-capability-detail",
  `${CONSOLE}/capabilities/cu.member.open_subaccount@1.0.0`,
  { auth: true },
);
await shot(
  "09-capability-diff",
  `${CONSOLE}/capabilities/compare?a=cu.member.lookup_savings@1.0.0&b=cu.member.lookup_savings@1.1.0`,
  { auth: true },
);
await shot("10-new-capability", `${CONSOLE}/capabilities/new`, { auth: true });
await shot("11-runs", `${CONSOLE}/runs`, { auth: true });

// A real run timeline, with the anomaly control visible.
{
  const runs = await fetch(`${API}/api/runs`).then(j);
  const failed = runs.find((r) => r.status === "failed") ?? runs[0];
  if (failed)
    await shot("12-run-timeline", `${CONSOLE}/runs/${failed.id}`, {
      auth: true,
    });
}

// The handoff, against a genuinely paused run.
{
  const invocation = fetch(
    `${API}/api/capabilities/cu.member.open_subaccount/invoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: {
          memberId: "100001",
          nickname: "Vacation Fund",
          initialDeposit: 50,
        },
      }),
    },
  ).then(j);

  let iv = null;
  for (let i = 0; i < 60 && !iv; i++) {
    await sleep(500);
    iv = (await fetch(`${API}/api/interventions`).then(j)).find(
      (x) => x.status === "pending",
    );
  }
  if (iv) {
    const ctx = await b.newContext({ viewport: DESK, httpCredentials: CRED });
    const page = await ctx.newPage();
    await page.goto(`${CONSOLE}/interventions`, { waitUntil: "networkidle" });
    await sleep(900);
    await page.screenshot({ path: `${OUT}/13-interventions.png` });
    console.log("  13-interventions.png");
    await page.goto(`${CONSOLE}/session/${iv.id}`, {
      waitUntil: "networkidle",
    });
    await sleep(3200);
    await page.getByRole("button", { name: /take control/i }).click();
    await sleep(2200);
    await page.screenshot({ path: `${OUT}/14-live-handoff.png` });
    console.log("  14-live-handoff.png");
    await page.getByRole("button", { name: /approve & resume/i }).click();
    await ctx.close();
  }
  const r = await invocation;
  console.log(`  (handoff run finished: ${r.status})`);
}

await shot("15-mobile-landing", `${SITE}/`, { vp: PHONE });
await shot("16-mobile-console", `${CONSOLE}/`, { vp: PHONE, auth: true });

await b.close();
console.log("done");
