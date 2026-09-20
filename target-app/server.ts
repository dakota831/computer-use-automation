import express from "express";
import type { Request, Response } from "express";
import { TENANTS, DEFAULT_TENANT, type Tenant } from "./tenants.js";
import { MEMBERS, CREDENTIALS, type Member } from "./data.js";
import {
  shell,
  frameDoc,
  fieldRow,
  panel,
  errorBox,
  warnBox,
  esc,
} from "./render.js";

/**
 * Stand-in back-office application: "CoreLink Teller".
 *
 * Serves two tenants of the same product at /t/firstcu and /t/summit.
 * Everything is synthetic. See data.ts.
 *
 * Exceptional states are reachable deterministically, by member id, so the
 * replay evidence demonstrates genuine detection rather than an injected mock:
 *   999999 -> not found     200001 -> permission denied
 *   200002 -> interstitial  200003 -> slow      200004 -> app error
 * Session expiry is forced with DEX_SESSION_TTL_MS.
 */

const PORT = Number(process.env.DEX_TARGET_PORT ?? 8080);
const SESSION_TTL_MS = Number(process.env.DEX_SESSION_TTL_MS ?? 30 * 60 * 1000);

type Session = {
  tenant: string;
  user: string;
  createdAt: number;
  ackDone: boolean;
};
const sessions = new Map<string, Session>();
let subAccountSeq = 4400;

const app = express();
app.use(express.urlencoded({ extended: false }));

const readCookie = (req: Request, key: string): string | undefined =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === key)?.[1];

function tenantOf(req: Request): Tenant {
  const key = String(req.params.tenant ?? DEFAULT_TENANT);
  return TENANTS[key] ?? TENANTS[DEFAULT_TENANT]!;
}

/** Returns the live session, or null when absent/expired. */
function sessionOf(req: Request): Session | null {
  const sid = readCookie(req, "sid");
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    return null;
  }
  return s;
}

const base = (t: Tenant) => `/t/${t.id}`;

/** Session-expired screen. A recoverable condition: re-auth and resume. */
function expired(t: Tenant, res: Response) {
  res.status(200).send(
    frameDoc(
      t,
      panel(
        "Session Expired",
        `${warnBox("Your session has timed out due to inactivity. Please sign in again.")}
         <a href="${base(t)}/frame/login">Return to Sign In</a>`,
      ),
    ),
  );
}

// ---------------------------------------------------------------- shell + login

app.get("/t/:tenant", (req, res) => {
  const t = tenantOf(req);
  res.send(shell(t, `${base(t)}/frame/login`, "Sign In"));
});

app.get("/t/:tenant/frame/login", (req, res) => {
  const t = tenantOf(req);
  const err = req.query.err ? errorBox("Invalid username or password.") : "";
  res.send(
    frameDoc(
      t,
      panel(
        "Teller Sign In",
        `${err}
      <form method="post" action="${base(t)}/login">
        <table>
          ${fieldRow("User ID", `${t.controlPrefix}txtUser`)}
          ${fieldRow("Password", `${t.controlPrefix}txtPass`, "password")}
          <tr><td></td><td><input type="submit" name="${t.controlPrefix}btnLogin" value="Sign In"></td></tr>
        </table>
      </form>`,
      ),
    ),
  );
});

app.post("/t/:tenant/login", (req, res) => {
  const t = tenantOf(req);
  const u = String(req.body[`${t.controlPrefix}txtUser`] ?? "");
  const p = String(req.body[`${t.controlPrefix}txtPass`] ?? "");
  if (u !== CREDENTIALS.username || p !== CREDENTIALS.password) {
    return res.redirect(`${base(t)}/frame/login?err=1`);
  }
  const sid = `s${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  sessions.set(sid, {
    tenant: t.id,
    user: u,
    createdAt: Date.now(),
    ackDone: false,
  });
  res.setHeader("Set-Cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  // Summit interposes an acknowledgement screen; First Community does not.
  res.redirect(
    t.postLoginAcknowledgement
      ? `${base(t)}/frame/ack`
      : `${base(t)}/frame/search`,
  );
});

/** Per-tenant interstitial. A recoverable condition the capability must dismiss. */
app.get("/t/:tenant/frame/ack", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  res.send(
    frameDoc(
      t,
      panel(
        "Acceptable Use Acknowledgement",
        `${warnBox("Access to member records is monitored. Acknowledge to continue.")}
       <form method="post" action="${base(t)}/ack">
         <input type="submit" name="${t.controlPrefix}btnAck" value="I Acknowledge">
       </form>`,
      ),
    ),
  );
});

app.post("/t/:tenant/ack", (req, res) => {
  const t = tenantOf(req);
  const s = sessionOf(req);
  if (!s) return expired(t, res);
  s.ackDone = true;
  res.redirect(`${base(t)}/frame/search`);
});

// ---------------------------------------------------------------- search

app.get("/t/:tenant/frame/search", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const notFound = req.query.nf
    ? errorBox("No member found matching the ID supplied.")
    : "";
  const invalid = req.query.inv ? errorBox("Member ID must be 6 digits.") : "";
  res.send(
    frameDoc(
      t,
      panel(
        "Member Search",
        `${notFound}${invalid}
      <form method="post" action="${base(t)}/search">
        <table>
          ${fieldRow(t.labels.memberId, `${t.controlPrefix}txtMemberId`)}
          <tr><td></td><td><input type="submit" name="${t.controlPrefix}btnSearch" value="${esc(t.labels.search)}"></td></tr>
        </table>
      </form>`,
      ),
    ),
  );
});

app.post("/t/:tenant/search", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const id = String(req.body[`${t.controlPrefix}txtMemberId`] ?? "").trim();
  if (!/^\d{6}$/.test(id)) return res.redirect(`${base(t)}/frame/search?inv=1`);
  if (!MEMBERS[id]) return res.redirect(`${base(t)}/frame/search?nf=1`);
  res.redirect(`${base(t)}/frame/member?id=${encodeURIComponent(id)}`);
});

// ---------------------------------------------------------------- member detail

const money = (n: number) =>
  `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

function detailRows(t: Tenant, m: Member): string {
  const nameCell = `<tr><td align="right">Name:</td><td>${esc(m.name)}</td></tr>`;
  const statusCell = `<tr><td align="right">Status:</td><td>${esc(m.status)}</td></tr>`;
  return `<table>
    <tr><td align="right">${esc(t.labels.memberId)}:</td><td>${esc(m.memberId)}</td></tr>
    ${t.resultColumnsSwapped ? statusCell + nameCell : nameCell + statusCell}
    <tr><td align="right">SSN:</td><td>***-**-${esc(m.ssnLast4)}</td></tr>
    <tr><td align="right">${esc(t.labels.savings)}:</td><td>${money(m.savingsBalance)}</td></tr>
    <tr><td align="right">Checking Balance:</td><td>${money(m.checkingBalance)}</td></tr>
  </table>`;
}

app.get("/t/:tenant/frame/member", async (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const id = String(req.query.id ?? "");
  const m = MEMBERS[id];
  if (!m) {
    return res.send(
      frameDoc(
        t,
        panel(
          "Member Detail",
          errorBox("No member found matching the ID supplied."),
        ),
      ),
    );
  }

  // Exceptional states, keyed off the fixture so they are reproducible.
  if (m.scenario === "permission_denied") {
    return res
      .status(200)
      .send(
        frameDoc(
          t,
          panel(
            "Member Detail",
            errorBox(
              "You do not have permission to view this member record. Contact your supervisor.",
            ),
          ),
        ),
      );
  }
  if (m.scenario === "app_error") {
    return res
      .status(500)
      .send(
        frameDoc(
          t,
          panel(
            "Application Error",
            errorBox(
              "An unexpected error occurred (ref CLK-500). The record could not be loaded.",
            ),
          ),
        ),
      );
  }
  if (m.scenario === "interstitial" && req.query.ack !== "1") {
    return res.send(
      frameDoc(
        t,
        panel(
          "Additional Verification Required",
          `${warnBox("This member record is flagged for additional verification.")}
         <a href="${base(t)}/frame/member?id=${esc(id)}&ack=1">Continue to Record</a>`,
        ),
      ),
    );
  }
  if (m.scenario === "slow") {
    await new Promise((r) =>
      setTimeout(r, Number(process.env.DEX_SLOW_MS ?? 6000)),
    );
  }

  res.send(
    frameDoc(
      t,
      panel(
        "Member Detail",
        `${detailRows(t, m)}
       <br><a href="${base(t)}/frame/subaccount?id=${esc(id)}">${esc(t.labels.openSubAccount)}</a>`,
      ),
    ),
  );
});

// ---------------------------------------------------------------- sub-account (irreversible)

app.get("/t/:tenant/frame/subaccount", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const id = String(req.query.id ?? "");
  const m = MEMBERS[id];
  if (!m)
    return res.send(
      frameDoc(t, panel(t.labels.openSubAccount, errorBox("No member found."))),
    );
  const err = req.query.err
    ? errorBox("Initial deposit must be at least $25.00.")
    : "";
  res.send(
    frameDoc(
      t,
      panel(
        `${t.labels.openSubAccount} - ${m.name}`,
        `${err}
      <form method="post" action="${base(t)}/subaccount">
        <input type="hidden" name="${t.controlPrefix}hidMemberId" value="${esc(id)}">
        <table>
          ${fieldRow("Account Nickname", `${t.controlPrefix}txtNickname`)}
          ${fieldRow("Initial Deposit", `${t.controlPrefix}txtDeposit`)}
          <tr><td></td><td><input type="submit" name="${t.controlPrefix}btnConfirm" value="${esc(t.labels.confirm)}"></td></tr>
        </table>
      </form>`,
      ),
    ),
  );
});

app.post("/t/:tenant/subaccount", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const id = String(req.body[`${t.controlPrefix}hidMemberId`] ?? "");
  const nickname = String(
    req.body[`${t.controlPrefix}txtNickname`] ?? "",
  ).trim();
  const deposit = Number(
    String(req.body[`${t.controlPrefix}txtDeposit`] ?? "").replace(/[$,]/g, ""),
  );
  if (!Number.isFinite(deposit) || deposit < 25) {
    return res.redirect(
      `${base(t)}/frame/subaccount?id=${encodeURIComponent(id)}&err=1`,
    );
  }
  const ref = `SA-${++subAccountSeq}`;
  res.redirect(
    `${base(t)}/frame/confirm?ref=${ref}&id=${encodeURIComponent(id)}&nn=${encodeURIComponent(nickname)}`,
  );
});

app.get("/t/:tenant/frame/confirm", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const ref = String(req.query.ref ?? "");
  const nn = String(req.query.nn ?? "");
  res.send(
    frameDoc(
      t,
      panel(
        "Sub-Account Created",
        `<table>
         <tr><td align="right">Reference:</td><td>${esc(ref)}</td></tr>
         <tr><td align="right">Nickname:</td><td>${esc(nn)}</td></tr>
         <tr><td align="right">Status:</td><td>Created</td></tr>
       </table>`,
      ),
    ),
  );
});

app.get("/", (_req, res) => {
  const links = Object.values(TENANTS)
    .map(
      (t) =>
        `<li><a href="/t/${t.id}">${esc(t.institution)}</a> (CoreLink ${esc(t.productVersion)})</li>`,
    )
    .join("");
  res.send(`<!doctype html><title>CoreLink Teller (synthetic)</title>
    <body style="font-family:Verdana;font-size:13px;margin:3rem auto;max-width:40rem">
    <h2>CoreLink Teller &mdash; synthetic test instances</h2>
    <p>Two tenants running the same vendor product. All data is fabricated.</p>
    <ul>${links}</ul></body>`);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[target-app] http://127.0.0.1:${PORT}  tenants: ${Object.keys(TENANTS).join(", ")}`,
  );
});
