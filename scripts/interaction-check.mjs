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
// The raw document now lives behind an Advanced disclosure; the default editor
// is the visual one, so this has to be opened before the textarea is usable.
await page.getByText(/advanced — edit the raw document/i).click();
await page.waitForTimeout(400);
check("the raw document is reachable for power users", await page.getByLabel(/capability json/i).isVisible());
const ta = page.getByLabel(/capability json/i);
const original = await ta.inputValue();
expectRejection = true;
await ta.fill(original.replace('"riskClass": "safe"', '"riskClass": "nonsense"'));
await page.getByRole("button", { name: /save raw document/i }).click();
await page.waitForTimeout(1500);
check("invalid edit is rejected with a schema error", (await page.getByText(/schema error/i).count()) > 0);
expectRejection = false;

// --- the visual capability editor -------------------------------------------
await go("/capabilities/cu.member.lookup_savings@1.1.0");
check("sign-in steps are hidden from the step list", !(await page.locator("main").innerText()).toLowerCase().includes("secret:"));
await page.getByRole("button", { name: /^edit$/i }).click();
await page.waitForTimeout(800);
check("editing is visual, not a JSON box", (await page.getByRole("textbox", { name: /capability title/i }).count()) > 0);
check("the hidden steps are explained", (await page.getByText(/signs in automatically/i).count()) > 0);
check("outcomes are asked for in plain language", (await page.getByLabel(/what happened/i).count()) > 0);
const disp = await page.getByLabel(/what should happen/i).locator("option").allTextContents();
check("dispositions are worded for people", disp.some((o) => /report it as the answer/i.test(o)), disp.join(" | "));
check("the raw document is available but not the default", (await page.getByText(/advanced — edit the raw document/i).count()) > 0);
await page.getByRole("button", { name: /cancel/i }).click();
await page.waitForTimeout(400);

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

// --- teach a new capability -------------------------------------------------
await go("/capabilities/new");
check("the page renders", (await page.getByRole("button", { name: /start learning/i }).count()) > 0);
check("institution is a choice, not a URL box", (await page.getByLabel("Institution").count()) > 0);
const institutions = await page.getByLabel("Institution").locator("option").allTextContents();
check("both institutions are offered", institutions.length === 2, institutions.join(" | "));
check("no step budget is asked for", (await page.getByText(/max steps/i).count()) === 0);
check("no credential reference is shown", (await page.getByText(/secret:/i).count()) === 0);
check("the sign-in clause is fixed, not typed each time", (await page.getByText("Sign in to the teller console,").count()) > 0);

const goal = page.getByLabel("Goal");
const chips = page.locator("button[draggable=true]");

// A value used in the goal gets a row to fill in; removing it takes the row away.
check("a referenced value gets a row", (await page.getByLabel(/example value for memberId/i).count()) > 0);
await goal.fill("open the account {{accountNumber}} for member {{memberId}}");
await page.waitForTimeout(500);
check("a newly referenced value adds a row", (await page.getByLabel(/example value for accountNumber/i).count()) > 0);
await goal.fill("look up member {{memberId}}");
await page.waitForTimeout(500);
check("dropping a reference removes its row", (await page.getByLabel(/example value for accountNumber/i).count()) === 0);

// Autocomplete
await goal.fill("");
await goal.type("read {{mem");
await page.waitForTimeout(500);
// Scoped to the suggestion list: a native <select> also exposes role=option,
// so an unscoped query picks up the institution choices too.
const sugg = await page
  .getByRole("listbox", { name: /template suggestions/i })
  .getByRole("option")
  .allTextContents();
check("typing {{mem suggests only matching names", sugg.length === 1 && sugg[0].includes("memberId"), sugg.join(" | "));
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
check("accepting a suggestion closes the token", (await goal.inputValue()) === "read {{memberId}}", await goal.inputValue());

await goal.type(" and {{acc");
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check("escape dismisses and stays dismissed", !(await page.getByRole("listbox", { name: /template suggestions/i }).isVisible().catch(() => false)));

// Insert by click and by drag
await goal.fill("balance for ");
await goal.click();
await page.keyboard.press("End");
await chips.filter({ hasText: "{{memberId}}" }).first().click();
await page.waitForTimeout(400);
check("clicking a value inserts it at the caret", (await goal.inputValue()) === "balance for {{memberId}}", await goal.inputValue());

await goal.fill("transfer ");
await chips.filter({ hasText: "{{amount}}" }).first().dragTo(goal);
await page.waitForTimeout(600);
check("dragging a value into the task inserts it", (await goal.inputValue()).includes("{{amount}}"), await goal.inputValue());

// The identifier is derived, not demanded.
await page.getByLabel("Title").fill("Read a member balance");
await page.waitForTimeout(400);
check("the identifier is derived from the title", (await page.getByText(/cu\.read_a_member_balance/).count()) > 0);

console.log("");
check("no uncaught JS errors during the whole walk", errors.length === 0, errors.slice(0, 2).join(" | "));

await b.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"}  (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
