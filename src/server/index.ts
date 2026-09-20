import { config as loadEnv } from "dotenv";
// quiet: this CLI writes JSON to stdout, and a dotenv banner makes it unparseable.
loadEnv({ quiet: true });
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { existsSync } from "node:fs";
import { Catalog } from "./catalog.js";
import { interventions } from "./interventions.js";
import { ControlLease } from "./lease.js";
import { replay, type EscalationDecision } from "../replay/executor.js";
import { WebSurface } from "../surface/web.js";
import { isRemoteControllable } from "../surface/types.js";
import { redactor } from "../core/redact.js";

/**
 * The agent-facing API and the operator console's backend.
 *
 * One process serves both because they are two views of the same thing: the
 * catalog is how an agent invokes a capability, and the console is where a human
 * rescues one that got stuck. Splitting them would mean shipping the live
 * session handle across a process boundary for no benefit at this size.
 *
 * Authentication is handled at the edge by nginx (see deploy/). That is the
 * floor, not the answer - a real deployment needs per-operator identity, because
 * "who took control of this session" must name a person. The `actor` field
 * threaded through every transfer is where that identity belongs.
 */

const PORT = Number(process.env.DEX_OPERATOR_PORT ?? 4000);
const SECRETS: Record<string, string> = {
  "corelink.username": process.env.DEX_TELLER_USER ?? "teller1",
  "corelink.password": process.env.DEX_TELLER_PASS ?? "demo-teller-pw",
};
for (const v of Object.values(SECRETS)) redactor.registerSecret(v);

const catalog = new Catalog(process.env.DEX_ARTIFACT_DIR ?? "artifacts").load();
const app = express();
app.use(express.json({ limit: "1mb" }));

/** Live sessions keyed by intervention, so the console can attach to one. */
const sessions = new Map<
  string,
  { surface: WebSurface; lease: ControlLease }
>();

// ------------------------------------------------------------------ catalog

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    capabilities: catalog.list().length,
    interventions: interventions.list().length,
  });
});

app.get("/api/capabilities", (_req, res) => {
  res.json(catalog.load().summaries());
});

/** Tool definitions a function-calling agent can consume directly. */
app.get("/api/capabilities/tools", (req, res) => {
  res.json(
    catalog.load().toolDefinitions({ includeDrafts: req.query.drafts === "1" }),
  );
});

app.get("/api/capabilities/:ref", (req, res) => {
  const found = catalog.find(String(req.params.ref));
  if (!found) return res.status(404).json({ error: "no such capability" });
  res.json(found.capability);
});

/**
 * Invoke a capability. This is the production entry point: an agent calls by
 * name with typed arguments and gets back the structured result contract.
 */
app.post("/api/capabilities/:ref/invoke", async (req, res) => {
  const found = catalog.find(String(req.params.ref));
  if (!found) return res.status(404).json({ error: "no such capability" });

  const cap = found.capability;
  const inputs = (req.body?.inputs ?? {}) as Record<string, unknown>;
  const attended = req.body?.attended === true;
  const mode = attended ? "replay_attended" : "replay_unattended";

  // The server owns the surface so the console can attach to the live session
  // if this run escalates. Replay will not close a surface it did not create.
  const surface = await WebSurface.launch({
    headless: true,
    allowedOrigins: cap.policy.allowedOrigins,
  });
  const lease = new ControlLease(`${cap.id}@${cap.version}`);

  try {
    const result = await replay(cap, {
      mode,
      inputs,
      secrets: (k) => SECRETS[k],
      surface,
      evidenceDir: process.env.DEX_EVIDENCE_DIR ?? "evidence",
      beforeAction: () => lease.awaitAutomation(),
      onEscalation: async (ctx) => {
        const { intervention, decided } = interventions.raise({
          ctx,
          surface,
          lease,
          version: cap.version,
        });
        sessions.set(intervention.id, { surface, lease });
        // The run is now suspended on a live session. It resumes when a human
        // resolves the intervention, not when a timer fires.
        const decision = await decided;
        sessions.delete(intervention.id);
        return decision;
      },
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  } finally {
    await surface.close().catch(() => {});
  }
});

// ------------------------------------------------------------ interventions

app.get("/api/interventions", (_req, res) => res.json(interventions.list()));

app.get("/api/interventions/:id", (req, res) => {
  const i = interventions.get(String(req.params.id));
  if (!i) return res.status(404).json({ error: "no such intervention" });
  res.json(interventions.view(i));
});

app.post("/api/interventions/:id/take", (req, res) => {
  try {
    const actor = String(req.body?.actor ?? "operator");
    res.json(interventions.take(String(req.params.id), actor));
  } catch (e) {
    res.status(409).json({ error: String(e) });
  }
});

app.post("/api/interventions/:id/release", (req, res) => {
  try {
    const actor = String(req.body?.actor ?? "operator");
    const action = String(req.body?.action ?? "resume");
    const note = String(req.body?.note ?? "");
    const decision: EscalationDecision =
      action === "step_completed"
        ? { action: "step_completed", note: note || "completed manually" }
        : action === "abandon"
          ? { action: "abandon", note: note || "operator abandoned the run" }
          : { action: "resume" };
    res.json(interventions.release(String(req.params.id), actor, decision));
  } catch (e) {
    res.status(409).json({ error: String(e) });
  }
});

// -------------------------------------------------------------- static console

const consoleDir = "dist-web";
if (existsSync(consoleDir)) {
  app.use(express.static(consoleDir));
  app.get(/^\/(?!api|ws).*/, (_req, res) =>
    res.sendFile("index.html", { root: consoleDir }),
  );
}

// --------------------------------------------------------------- live session

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/ws")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

wss.on("connection", async (ws: WebSocket, req) => {
  const url = new URL(req.url ?? "/ws", "http://localhost");
  const id = url.searchParams.get("intervention") ?? "";
  const session = sessions.get(id);
  const intervention = interventions.get(id);

  if (!session || !intervention) {
    ws.send(
      JSON.stringify({
        t: "error",
        message: "no live session for that intervention",
      }),
    );
    return ws.close();
  }

  const { surface, lease } = session;
  const send = (o: unknown) =>
    ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
  const pushState = () =>
    send({
      t: "state",
      owner: lease.owner,
      holder: lease.holder,
      status: intervention.status,
      url: surface.url(),
    });

  pushState();
  const { width, height } = surface.viewportSize();
  send({
    t: "meta",
    width,
    height,
    stepId: intervention.stepId,
    reason: intervention.reason,
  });

  if (isRemoteControllable(surface)) {
    await surface.startScreencast((f) =>
      send({ t: "frame", data: f.dataBase64, w: f.width, h: f.height }),
    );
  } else {
    send({ t: "error", message: "this surface cannot be viewed remotely" });
  }

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    // The enforcement point for the operator side of the lease. The console
    // also disables its own input, but that is a courtesy; this is the
    // guarantee. A client that ignores the UI state still cannot act.
    try {
      lease.assertHolder("operator");
    } catch (e) {
      return send({ t: "denied", message: String(e) });
    }
    if (!isRemoteControllable(surface)) return;

    if (msg.t === "mouse") {
      await surface.dispatchMouse({
        type: msg.type,
        x: msg.x,
        y: msg.y,
        button: msg.button,
        clickCount: msg.clickCount,
      });
      if (msg.type === "mousePressed") {
        interventions.recordHumanAction(id, {
          at: new Date().toISOString(),
          kind: "click",
          detail: { x: msg.x, y: msg.y },
        });
      }
    } else if (msg.t === "key") {
      await surface.dispatchKey({
        type: msg.type,
        key: msg.key,
        code: msg.code,
        text: msg.text,
        modifiers: msg.modifiers,
      });
      if (msg.type === "keyDown") {
        // Key *names* are recorded, never typed characters - an operator
        // entering a member ID or a credential must not have it logged.
        interventions.recordHumanAction(id, {
          at: new Date().toISOString(),
          kind: "key",
          detail: { key: msg.key },
        });
      }
    } else if (msg.t === "state") {
      pushState();
    }
  });

  const poll = setInterval(pushState, 1500);
  ws.on("close", async () => {
    clearInterval(poll);
    if (isRemoteControllable(surface))
      await surface.stopScreencast().catch(() => {});
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[server] http://127.0.0.1:${PORT}  capabilities=${catalog.list().length}`,
  );
});
