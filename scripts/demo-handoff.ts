import "dotenv/config";
import WebSocket from "ws";

/**
 * End-to-end demonstration of the human-in-the-loop handoff.
 *
 * Exercises the control-transfer model against a live session, including the
 * negative case - operator input is refused by the *server* before control is
 * granted, not merely greyed out in the console.
 *
 * Flow: invoke a capability whose final step is irreversible -> replay stops and
 * escalates -> a named human takes the lease -> drives the same live session ->
 * approves -> automation resumes and completes the step it was not allowed to
 * take on its own authority.
 */

const API = process.env.DEX_API ?? "http://127.0.0.1:4000";
const CAP = "cu.member.open_subaccount";
const OPERATOR = "dakota@operator";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const j = async (r: Response) => r.json() as Promise<any>;

console.log(`invoking ${CAP} (final step is irreversible)\n`);

// Fire the invocation; it will suspend at the irreversible step.
const invocation = fetch(`${API}/api/capabilities/${CAP}/invoke`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    inputs: {
      memberId: "100001",
      nickname: "Vacation Fund",
      initialDeposit: 50,
    },
  }),
}).then(j);

// Wait for the escalation to appear.
let iv: any;
for (let i = 0; i < 60 && !iv; i++) {
  await sleep(500);
  const list = await fetch(`${API}/api/interventions`).then(j);
  iv = list.find((x: any) => x.status === "pending");
}
if (!iv)
  throw new Error(
    "no intervention was raised - the irreversible step did not escalate",
  );

console.log("ESCALATION RAISED");
console.log(`  id       ${iv.id}`);
console.log(`  step     ${iv.stepId} - ${iv.stepIntent}`);
console.log(`  reason   ${iv.reason}`);
console.log(`  owner    ${iv.owner} (${iv.holder})`);
console.log(`  url      ${iv.url}\n`);

const ws = new WebSocket(
  `${API.replace("http", "ws")}/ws?intervention=${iv.id}`,
);
let frames = 0;
let denied: string | null = null;
let meta: any = null;

await new Promise<void>((resolve, reject) => {
  ws.on("open", () => resolve());
  ws.on("error", reject);
});
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === "frame") frames++;
  else if (m.t === "denied") denied = m.message;
  else if (m.t === "meta") meta = m;
});

await sleep(1500);
console.log("LIVE SESSION ATTACHED");
console.log(`  screencast frames received: ${frames}`);
console.log(`  viewport: ${meta?.width}x${meta?.height}\n`);

// Negative case first: automation still holds the lease.
ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x: 100, y: 100 }));
await sleep(600);
console.log("INPUT BEFORE TAKING CONTROL");
console.log(
  `  server response: ${denied ? "REFUSED - " + denied.slice(0, 74) : "ACCEPTED (this would be a bug)"}\n`,
);

// Take control as a named human.
const taken = await fetch(`${API}/api/interventions/${iv.id}/take`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ actor: OPERATOR }),
}).then(j);
console.log("CONTROL TAKEN");
console.log(`  owner    ${taken.owner} (${taken.holder})`);
console.log(`  status   ${taken.status}\n`);

// Now the same input is permitted and recorded.
const before = frames;
ws.send(JSON.stringify({ t: "mouse", type: "mouseMoved", x: 400, y: 300 }));
await sleep(300);
ws.send(JSON.stringify({ t: "key", type: "keyDown", key: "Shift" }));
await sleep(900);

const mid = await fetch(`${API}/api/interventions/${iv.id}`).then(j);
console.log("OPERATOR ACTIONS RECORDED");
for (const a of mid.humanActions)
  console.log(`  ${a.kind.padEnd(6)} ${JSON.stringify(a.detail)}`);
console.log(`  further frames while controlling: ${frames - before}\n`);

// Approve. The automation performs the irreversible step it was not allowed to
// take unattended; the human authorised it rather than doing it themselves.
const released = await fetch(`${API}/api/interventions/${iv.id}/release`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    actor: OPERATOR,
    action: "resume",
    note: "reviewed the deposit amount, approved",
  }),
}).then(j);
console.log("CONTROL HANDED BACK");
console.log(`  owner    ${released.owner} (${released.holder})`);
for (const h of released.leaseHistory)
  console.log(`  ${h.at}  ${h.from} -> ${h.to}  by ${h.actor}: ${h.reason}`);

const result = await invocation;
console.log("\nRUN RESUMED AND COMPLETED");
console.log(`  status   ${result.status}`);
console.log(
  `  outputs  ${JSON.stringify(result.outputs ?? result.outcome ?? result.failure?.code)}`,
);
ws.close();
