import { chromium } from "playwright";

/**
 * Exercise the console the way an operator would.
 *
 * The visual sweep proves pages render without throwing; this proves the
 * controls on them actually do something. Every assertion is a behaviour a
 * reviewer might try.
 */
const CONSOLE = process.env.DEX_CONSOLE ?? "https://console.dexdash.cloud";
const CRED = { username: "admin", password: "admin" };
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: CRED });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 100)));
let expectRejection = false;
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // The invalid-edit step provokes a 400 on purpose; that is the assertion.
  if (expectRejection && /400|Bad Request/.test(m.text())) return;
  errors.push(m.text().slice(0, 100));
});

const go = async (p) => { await page.goto(`${CONSOLE}${p}`, { waitUntil: "networkidle" }); await page.waitForTimeout(700); };

// --- navigation -------------------------------------------------------------
await go("/");
check("overview renders stat tiles", (await page.locator("text=Capabilities").count()) > 0);

await page.keyboard.press("g");
await page.keyboard.press("c");
await page.waitForTimeout(900);
check("hotkey 'g c' navigates to capabilities", page.url().endsWith("/capabilities"), page.url());

await page.keyboard.press("g");
await page.keyboard.press("r");
await page.waitForTimeout(900);
check("hotkey 'g r' navigates to runs", page.url().endsWith("/runs"), page.url());

// --- command palette --------------------------------------------------------
await page.keyboard.press("Control+k");
await page.waitForTimeout(700);
const paletteOpen = await page.getByRole("dialog", { name: /command palette/i }).isVisible().catch(() => false);
check("command palette opens on ctrl+k", paletteOpen);
if (paletteOpen) {
  await page.keyboard.type("subaccount");
  await page.waitForTimeout(600);
  const hits = await page.getByRole("option").count();
  check("palette finds a capability by name", hits > 0, `${hits} result(s)`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  check("palette selection navigates", page.url().includes("/capabilities/"), page.url());
  }

// --- filters ----------------------------------------------------------------
await go("/capabilities");
const beforeFilter = await page.locator("section").count();
await page.getByRole("button", { name: /^draft$/i }).click();
await page.waitForTimeout(600);
const afterFilter = await page.locator("section").count();
check("status filter narrows the list", afterFilter < beforeFilter, `${beforeFilter} → ${afterFilter}`);

await page.getByLabel(/filter capabilities/i).fill("zzzznope");
await page.waitForTimeout(600);
check("text filter can produce an empty state", (await page.getByText(/no capabilities match/i).count()) > 0);

// --- approval toggle --------------------------------------------------------
await go("/capabilities/cu.member.lookup_savings@1.0.0");
const text = async () => (await page.locator("main").innerText()).toLowerCase();
const statusBefore = (await text()).includes("draft");
await page.getByRole("button", { name: /^approve$/i }).click();
await page.waitForTimeout(1500);
const statusAfter = (await text()).includes("approved");
check("approve flips a draft", statusBefore && statusAfter);
await page.getByRole("button", { name: /return to draft/i }).click();
await page.waitForTimeout(1500);
check("approval is reversible", (await text()).includes("draft"));

// --- editor -----------------------------------------------------------------
await page.getByRole("button", { name: /^edit$/i }).click();
await page.waitForTimeout(500);
check("editor opens with the artifact JSON", (await page.getByLabel(/capability json/i).count()) > 0);
const ta = page.getByLabel(/capability json/i);
const original = await ta.inputValue();
expectRejection = true;
await ta.fill(original.replace('"riskClass": "safe"', '"riskClass": "nonsense"'));
await page.getByRole("button", { name: /^save$/i }).click();
await page.waitForTimeout(1500);
check("invalid edit is rejected with a schema error", (await page.getByText(/schema error/i).count()) > 0);
expectRejection = false;

// --- run timeline + anomaly jump -------------------------------------------
await go("/runs");
const firstRun = page.locator("tbody tr a").first();
const runHref = await firstRun.getAttribute("href");
await firstRun.click();
await page.waitForTimeout(1500);
check("run row opens its timeline", page.url().includes("/runs/"), runHref ?? "");
const notable = await page.getByRole("button", { name: /notable/i }).textContent().catch(() => null);
check("timeline reports notable events", Boolean(notable && /\d+ notable/.test(notable)), notable ?? "none");
if (notable && /\d+ notable/.test(notable)) {
  await page.getByRole("button", { name: /notable/i }).click();
  await page.waitForTimeout(700);
  check("anomaly jump highlights a row", (await page.locator("li.ring-2").count()) > 0);
}

// --- diff -------------------------------------------------------------------
await go("/capabilities/compare?a=cu.member.lookup_savings@1.0.0&b=cu.member.lookup_savings@1.1.0");
const diffText = await page.locator("main").innerText();
check("diff shows the status change review made", diffText.includes('"status"'), "");
check("diff counts additions and removals", /\+\d+/.test(diffText) && /−\d+|-\d+/.test(diffText));

// --- discovery form ---------------------------------------------------------
await go("/capabilities/new");
check("discovery form renders", (await page.getByRole("button", { name: /run discovery/i }).count()) > 0);

// --- footer: cross-surface links must leave the console ---------------------
await go("/");
const learn = page.locator("footer").getByRole("link", { name: /how it works/i });
check("footer 'How it works' exists", (await learn.count()) > 0);
if (await learn.count()) {
  const href = await learn.getAttribute("href");
  check("footer 'How it works' points at the public site", href?.startsWith("https://dexdash.cloud") ?? false, href ?? "");
}
const whatIs = page.locator("footer").getByRole("link", { name: /what dexdash is/i });
check("footer links to the explainer", (await whatIs.count()) > 0 && (await whatIs.getAttribute("href")) === "https://dexdash.cloud");
const selfLink = await page.locator("footer").getByRole("link", { name: /operator console/i }).count();
check("footer does not link the console to itself", selfLink === 0);

// --- keyboard help overlay --------------------------------------------------
await page.keyboard.press("?");
await page.waitForTimeout(600);
const help = page.getByRole("dialog", { name: /keyboard shortcuts/i });
check("'?' opens the shortcut overlay", await help.isVisible().catch(() => false));
if (await help.isVisible().catch(() => false)) {
  check("overlay documents the sequences", (await help.getByText(/go to runs/i).count()) > 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  check("escape closes the overlay", !(await help.isVisible().catch(() => false)));
}

// --- auto-refresh pause, and that it persists -------------------------------
const liveBtn = page.getByRole("button", { name: /pause auto-refresh/i });
check("auto-refresh starts live", (await liveBtn.count()) > 0);
if (await liveBtn.count()) {
  await liveBtn.click();
  await page.waitForTimeout(500);
  check("pausing flips the control", (await page.getByRole("button", { name: /resume auto-refresh/i }).count()) > 0);
  const stored = await page.evaluate(() => localStorage.getItem("dex.autorefresh"));
  check("pause is persisted", stored === "false", String(stored));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("pause survives a reload", (await page.getByRole("button", { name: /resume auto-refresh/i }).count()) > 0);
  await page.getByRole("button", { name: /resume auto-refresh/i }).click();
  await page.waitForTimeout(400);
}

// --- copy to clipboard ------------------------------------------------------
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
await go("/capabilities/cu.member.open_subaccount@1.0.0");
const copyBtn = page.getByRole("button", { name: /copy identifier/i }).first();
check("identifier has a copy control", (await copyBtn.count()) > 0);
if (await copyBtn.count()) {
  await copyBtn.click();
  await page.waitForTimeout(600);
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("copy puts the identifier on the clipboard", clip.includes("cu.member.open_subaccount"), clip);
  check("copy confirms with a toast", (await page.getByText(/copied/i).count()) > 0);
}

// --- breadcrumbs ------------------------------------------------------------
const crumb = page.getByRole("navigation", { name: /breadcrumb/i }).getByRole("link", { name: /capabilities/i });
check("detail page has a breadcrumb", (await crumb.count()) > 0);
if (await crumb.count()) {
  await crumb.click();
  await page.waitForTimeout(900);
  check("breadcrumb navigates up", page.url().endsWith("/capabilities"), page.url());
}

console.log("");
check("no uncaught JS errors during the whole walk", errors.length === 0, errors.slice(0, 2).join(" | "));

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"}  (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
