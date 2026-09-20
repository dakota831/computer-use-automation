import { config as loadEnv } from "dotenv";
// quiet: this CLI writes JSON to stdout, and a dotenv banner makes it unparseable.
loadEnv({ quiet: true });
import { chromium } from "playwright";

/**
 * Screenshot the operator console while a real intervention is live.
 * Used to produce evidence that the handoff surface works against an actual
 * paused run, not a mocked one.
 */
const API = "http://127.0.0.1:4000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const j = async (r: Response) => r.json() as Promise<any>;

const invocation = fetch(
  `${API}/api/capabilities/cu.member.open_subaccount/invoke`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs: {
        memberId: "100003",
        nickname: "Holiday Savings",
        initialDeposit: 75,
      },
    }),
  },
).then(j);

let iv: any;
for (let i = 0; i < 60 && !iv; i++) {
  await sleep(500);
  iv = (await fetch(`${API}/api/interventions`).then(j)).find(
    (x: any) => x.status === "pending",
  );
}
if (!iv) throw new Error("no intervention raised");
console.log(`intervention ${iv.id} on ${iv.stepId}`);

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${API}/#/`, { waitUntil: "networkidle" });
await sleep(1200);
await page.screenshot({ path: "/tmp/console-queue.png" });
console.log("captured: interventions queue");

await page.goto(`${API}/#/session/${iv.id}`, { waitUntil: "networkidle" });
await sleep(3500); // let screencast frames arrive
await page.screenshot({ path: "/tmp/console-viewing.png" });
console.log("captured: live session, automation in control");

await page.getByRole("button", { name: /take control/i }).click();
await sleep(2500);
await page.screenshot({ path: "/tmp/console-control.png" });
console.log("captured: operator in control");

const frames = await page
  .locator("text=/live · \\d+ frames/")
  .first()
  .textContent()
  .catch(() => null);
console.log(`console reports: ${frames ?? "(frame counter not found)"}`);

await page.getByRole("button", { name: /approve & resume/i }).click();
await sleep(1500);
const result = await invocation;
console.log(
  `run resumed -> ${result.status} ${JSON.stringify(result.outputs ?? result.failure?.code ?? "")}`,
);
await b.close();
