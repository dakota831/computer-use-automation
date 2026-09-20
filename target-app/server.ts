import express from "express";
import type { Request, Response } from "express";
import { TENANTS, DEFAULT_TENANT, type Tenant } from "./tenants.js";
import {
  MEMBERS,
  CREDENTIALS,
  ACCOUNTS,
  accountBalance,
  adjustments,
  postAdjustment,
  resetLedger,
  memberSavings,
  money,
  type Member,
} from "./data.js";
import {
  accountsPage,
  transactionsPage,
  reportsPage,
  adminPage,
  helpPage,
  recentPanel,
} from "./sections.js";
import {
  shell,
  frameDoc,
  fieldRow,
  panel,
  errorBox,
  warnBox,
  esc,
  crestSvg,
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
  /** Recently viewed members, newest first. A small operator convenience. */
  recent: string[];
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

/** Per-tenant favicon, drawn from the same crest as the brand bar. */
app.get("/t/:tenant/favicon.svg", (req, res) => {
  const t = tenantOf(req);
  res.type("image/svg+xml").send(crestSvg(t));
});

/**
 * The application shell.
 *
 * Which inner page it frames is decided from session state, so signing in is a
 * real full-page transition - the way this class of software actually behaves -
 * and the brand bar can show who is signed in.
 */
app.get("/t/:tenant", (req, res) => {
  const t = tenantOf(req);
  const s = sessionOf(req);
  if (!s) {
    return res.send(
      shell(t, {
        innerPath: `${base(t)}/frame/login`,
        title: "Sign In",
        crumbs: ["Sign In"],
      }),
    );
  }
  if (t.postLoginAcknowledgement && !s.ackDone) {
    return res.send(
      shell(t, {
        innerPath: `${base(t)}/frame/ack`,
        title: "Acknowledgement",
        crumbs: ["Acceptable Use"],
        teller: s.user,
      }),
    );
  }
  return res.send(
    shell(t, {
      innerPath: `${base(t)}/frame/search`,
      title: "Member Lookup",
      active: "members",
      crumbs: ["Members", "Lookup"],
      teller: s.user,
    }),
  );
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
      <form method="post" action="${base(t)}/login" target="_top">
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
    recent: [],
  });
  res.setHeader("Set-Cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  // Back to the shell, which now renders signed in. Summit interposes an
  // acknowledgement screen at that point; First Community does not.
  res.redirect(base(t));
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
       <form method="post" action="${base(t)}/ack" target="_top">
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
  res.redirect(base(t));
});

// ---------------------------------------------------------------- search

app.get("/t/:tenant/frame/search", (req, res) => {
  const t = tenantOf(req);
  const sess = sessionOf(req);
  if (!sess) return expired(t, res);
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
      </form>
      <p class="hint">Enter a six digit ${esc(t.labels.memberId.toLowerCase())} to open a record.</p>`,
      ),
    ) + recentPanel(t, sess.recent),
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

// `money` comes from data.ts. There used to be a second copy here that did not
// sign negatives - harmless while every figure on this screen was a balance,
// wrong the moment an adjustment could be a debit.

function detailRows(t: Tenant, m: Member): string {
  const nameCell = `<tr><td align="right">Name:</td><td>${esc(m.name)}</td></tr>`;
  const statusCell = `<tr><td align="right">Status:</td><td>${esc(m.status)}</td></tr>`;
  return `<table>
    <tr><td align="right">${esc(t.labels.memberId)}:</td><td>${esc(m.memberId)}</td></tr>
    ${t.resultColumnsSwapped ? statusCell + nameCell : nameCell + statusCell}
    <tr><td align="right">SSN:</td><td>***-**-${esc(m.ssnLast4)}</td></tr>
    <tr><td align="right">${esc(t.labels.savings)}:</td><td>${money(memberSavings(m))}</td></tr>
    <tr><td align="right">Checking Balance:</td><td>${money(m.checkingBalance)}</td></tr>
  </table>`;
}

app.get("/t/:tenant/frame/member", async (req, res) => {
  const t = tenantOf(req);
  const sess = sessionOf(req);
  if (!sess) return expired(t, res);
  const id = String(req.query.id ?? "");
  if (MEMBERS[id]) {
    sess.recent = [id, ...sess.recent.filter((r) => r !== id)].slice(0, 8);
  }
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
       <br><a href="${base(t)}/frame/subaccount?id=${esc(id)}">${esc(t.labels.openSubAccount)}</a>
       &nbsp;|&nbsp;
       <a href="${base(t)}/frame/adjustment">${esc(t.labels.postAdjustment)}</a>`,
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

// ---------------------------------------------------------------- adjustment (irreversible)
//
// The second write action, and the more consequential one: it moves money.
// There is no reversal screen, which is the point - a capability that drives
// this is exactly the kind that must be reviewed and approved before it is
// allowed to run unattended.
//
// Headings here deliberately avoid every string an existing checkpoint asserts
// on ("Member Detail", "Member Search", "Account Nickname", "Sub-Account
// Created"), for the reason given in tenants.ts: assertions match all visible
// text, so a colliding heading would make a checkpoint pass on the wrong screen.

const ADJUSTMENT_TYPES = ["Fee", "Deposit", "Withdrawal"] as const;

function adjustmentForm(
  t: Tenant,
  opts: { account: string; message?: string; kind?: "err" | "warn" },
): string {
  const notice =
    opts.message === undefined
      ? ""
      : opts.kind === "warn"
        ? warnBox(opts.message)
        : errorBox(opts.message);
  return frameDoc(
    t,
    panel(
      t.labels.postAdjustment,
      `${notice}
      <form method="post" action="${base(t)}/adjustment">
        <table>
          ${fieldRow("Account Number", `${t.controlPrefix}txtAdjAccount`, "text", opts.account, true)}
          <tr><td align="right" class="datalbl">Entry Type:</td>
              <td><select name="${t.controlPrefix}ddlAdjType">
                ${ADJUSTMENT_TYPES.map((k) => `<option value="${k}">${k}</option>`).join("")}
              </select></td></tr>
          ${fieldRow("Amount", `${t.controlPrefix}txtAdjAmount`, "text", "", true)}
          ${fieldRow(t.labels.memo, `${t.controlPrefix}txtAdjMemo`, "text", "", true)}
          <tr><td></td><td><input type="submit" name="${t.controlPrefix}btnPostAdj" value="${esc(t.labels.confirm)}"></td></tr>
        </table>
      </form>
      <p class="hint">A posted entry cannot be reversed from this screen. Contact your supervisor for a correcting entry.</p>`,
      620,
    ),
  );
}

app.get("/t/:tenant/frame/adjustment", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  res.send(adjustmentForm(t, { account: String(req.query.acct ?? "") }));
});

app.post("/t/:tenant/adjustment", (req, res) => {
  const t = tenantOf(req);
  const sess = sessionOf(req);
  if (!sess) return expired(t, res);

  const account = String(
    req.body[`${t.controlPrefix}txtAdjAccount`] ?? "",
  ).trim();
  const memo = String(req.body[`${t.controlPrefix}txtAdjMemo`] ?? "");
  const rawType = String(req.body[`${t.controlPrefix}ddlAdjType`] ?? "Fee");
  const type = (ADJUSTMENT_TYPES as readonly string[]).includes(rawType)
    ? (rawType as (typeof ADJUSTMENT_TYPES)[number])
    : "Fee";
  const amount = Number(
    String(req.body[`${t.controlPrefix}txtAdjAmount`] ?? "").replace(
      /[$,\s]/g,
      "",
    ),
  );

  // A restricted member's records are not postable either. Checked before the
  // ledger so the refusal reads the same as it does on the member record.
  const acct = ACCOUNTS.find((a) => a.number === account);
  if (acct && MEMBERS[acct.memberId]?.scenario === "permission_denied") {
    return res.send(
      adjustmentForm(t, {
        account,
        message:
          "You do not have permission to post to this member record. Contact your supervisor.",
      }),
    );
  }

  const result = postAdjustment({
    account,
    description: memo,
    amount,
    type,
    teller: sess.user,
  });

  if (!result.ok) {
    const message = {
      no_account: "No account found matching the number supplied.",
      not_open: "This account is not open for posting.",
      bad_amount: "Enter an amount greater than zero.",
    }[result.reason];
    return res.send(
      adjustmentForm(t, {
        account,
        message,
        kind: result.reason === "bad_amount" ? "warn" : "err",
      }),
    );
  }

  res.redirect(
    `${base(t)}/frame/adjustment-receipt?ref=${result.adjustment.reference}`,
  );
});

app.get("/t/:tenant/frame/adjustment-receipt", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  const ref = String(req.query.ref ?? "");
  const a = adjustments().find((x) => x.reference === ref);
  if (!a)
    return res.send(
      frameDoc(t, panel("Entry Posted", errorBox("No such reference."))),
    );
  const acct = ACCOUNTS.find((x) => x.number === a.account)!;
  res.send(
    frameDoc(
      t,
      panel(
        "Entry Posted",
        `<table>
         <tr><td align="right">Reference:</td><td>${esc(a.reference)}</td></tr>
         <tr><td align="right">Account:</td><td>${esc(a.account)}</td></tr>
         <tr><td align="right">Entry Type:</td><td>${esc(a.type)}</td></tr>
         <tr><td align="right">${esc(t.labels.memo)}:</td><td>${esc(a.description)}</td></tr>
         <tr><td align="right">Amount:</td><td>${money(a.amount)}</td></tr>
         <tr><td align="right">Resulting Balance:</td><td>${money(accountBalance(acct))}</td></tr>
       </table>
       <p class="hint">Posted by ${esc(a.teller)}. This entry is final.</p>`,
        620,
      ),
    ),
  );
});

/**
 * Return the application to its seed.
 *
 * A test hook, not a teller feature - it is not linked from any screen. The
 * evidence harness calls it so a committed replay matrix prints the same
 * balances whatever was posted while somebody was clicking around.
 */
app.post("/t/:tenant/admin/reset-ledger", (_req, res) => {
  resetLedger();
  res.json({ ok: true });
});

// ------------------------------------------------------- application sections
//
// Each nav item is a real destination. The shell is rendered at the top level
// and frames the section's content, which is how this class of application
// actually navigates.

type SectionDef = { id: string; title: string; crumbs: string[] };
const SECTIONS: Record<string, SectionDef> = {
  members: {
    id: "members",
    title: "Member Lookup",
    crumbs: ["Members", "Lookup"],
  },
  accounts: {
    id: "accounts",
    title: "Account Register",
    crumbs: ["Accounts", "Register"],
  },
  transactions: {
    id: "transactions",
    title: "Transaction Register",
    crumbs: ["Transactions", "Register"],
  },
  reports: {
    id: "reports",
    title: "Reports",
    crumbs: ["Reports", "Daily Totals"],
  },
  admin: {
    id: "admin",
    title: "Administration",
    crumbs: ["Administration", "Workstation"],
  },
  help: { id: "help", title: "Help", crumbs: ["Help"] },
};

for (const key of Object.keys(SECTIONS)) {
  app.get(`/t/:tenant/${key}`, (req, res) => {
    const t = tenantOf(req);
    const sess = sessionOf(req);
    if (!sess) return res.redirect(base(t));
    const def = SECTIONS[key]!;
    const qs = new URL(req.originalUrl, "http://x").searchParams.toString();
    res.send(
      shell(t, {
        innerPath: `${base(t)}/frame/${key === "members" ? "search" : key}${qs ? `?${qs}` : ""}`,
        title: def.title,
        active: key === "help" ? "members" : key,
        crumbs: def.crumbs,
        teller: sess.user,
      }),
    );
  });
}

/** Member id may arrive under either tenant's generated control name. */
const filterMember = (req: Request): string | undefined => {
  const q = req.query as Record<string, string | undefined>;
  const hit = Object.entries(q).find(([k]) =>
    /txt(FilterMember|TxnMember)$/.test(k),
  );
  const v = (hit?.[1] ?? "").trim();
  return v || undefined;
};

app.get("/t/:tenant/frame/accounts", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  res.send(accountsPage(t, filterMember(req)));
});

app.get("/t/:tenant/frame/transactions", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  res.send(transactionsPage(t, filterMember(req)));
});

app.get("/t/:tenant/frame/reports", (req, res) => {
  const t = tenantOf(req);
  if (!sessionOf(req)) return expired(t, res);
  res.send(reportsPage(t));
});

app.get("/t/:tenant/frame/admin", (req, res) => {
  const t = tenantOf(req);
  const sess = sessionOf(req);
  if (!sess) return expired(t, res);
  res.send(adminPage(t, sess.user));
});

app.get("/t/:tenant/frame/help", (req, res) => {
  const t = tenantOf(req);
  res.send(helpPage(t));
});

app.get("/t/:tenant/signout", (req, res) => {
  const t = tenantOf(req);
  const sid = readCookie(req, "sid");
  if (sid) sessions.delete(sid);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0");
  res.redirect(base(t));
});

/**
 * Institution selector.
 *
 * The vendor-side landing page an operator would reach before choosing their
 * institution. It also makes the multi-tenant story legible at a glance: two
 * installs of one product, different branding, different versions.
 */
app.get("/", (_req, res) => {
  const cards = Object.values(TENANTS)
    .map(
      (t) => `
      <a class="card" href="/t/${t.id}" style="border-top:4px solid ${t.theme.accent}">
        <div class="cardhd" style="background:linear-gradient(to bottom,${t.theme.barFrom},${t.theme.barTo})">
          <span class="crest">${crestSvg(t)}</span>
          <span>
            <b>${esc(t.institution)}</b>
            <small>${esc(t.charter)}</small>
          </span>
        </div>
        <table class="meta">
          <tr><td>Product</td><td>CoreLink Teller ${esc(t.productVersion)}</td></tr>
          <tr><td>App server</td><td>${esc(t.appServer)}</td></tr>
          <tr><td>Instance</td><td>/t/${t.id}</td></tr>
          <tr><td>Sign-in</td><td><b>admin</b> / <b>admin</b></td></tr>
        </table>
        <span class="go">Open teller console &rsaquo;</span>
      </a>`,
    )
    .join("");

  res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CoreLink Financial Systems &mdash; Institution Portal</title>
<link rel="icon" type="image/svg+xml" href="/t/firstcu/favicon.svg">
<style>
 *{box-sizing:border-box}
 body{margin:0;background:#eef1f6;font-family:"Segoe UI",Tahoma,Verdana,Arial,sans-serif;font-size:13px;color:#1a1a1a}
 .top{background:linear-gradient(to bottom,#243b57,#14233a);color:#fff;border-bottom:3px solid #c8a24a;padding:14px 18px}
 .top b{font-family:Georgia,serif;font-size:19px;letter-spacing:.2px}
 .top small{display:block;opacity:.75;margin-top:2px}
 .wrap{max-width:900px;margin:0 auto;padding:22px 16px 40px}
 h1{font-size:17px;margin:0 0 4px}
 .lede{color:#4a5568;margin:0 0 20px;max-width:60ch;line-height:1.6}
 .cards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
 .card{display:block;background:#fff;border:1px solid #93a2b8;text-decoration:none;color:inherit;
   box-shadow:0 1px 3px rgba(20,40,70,.14)}
 .card:hover{box-shadow:0 3px 10px rgba(20,40,70,.22)}
 .cardhd{display:flex;gap:10px;align-items:center;color:#fff;padding:10px 12px}
 .cardhd b{display:block;font-family:Georgia,serif;font-size:15px}
 .cardhd small{opacity:.8;font-size:10.5px}
 .crest{width:30px;height:30px;flex:0 0 auto}
 .meta{width:100%;border-collapse:collapse;font-size:12px}
 .meta td{padding:5px 12px;border-bottom:1px solid #eef1f6}
 .meta td:first-child{color:#5a6a85;width:38%}
 .go{display:block;padding:9px 12px;background:#f5f7fb;border-top:1px solid #e0e6ef;color:#14396b;font-weight:600}
 .note{margin-top:24px;border-left:4px solid #c8a24a;background:#fffdf5;padding:11px 14px;color:#5a4a20;line-height:1.6}
 .foot{border-top:1px solid #cdd6e2;margin-top:28px;padding-top:14px;color:#6b7280;font-size:11px;line-height:1.7}
 .foot a{color:#41506b}
 @media (max-width:640px){ .top b{font-size:16px} .wrap{padding:16px 12px 32px} }
</style></head><body>

<div class="top">
  <b>CoreLink Financial Systems</b>
  <small>Teller Platform &mdash; Institution Portal</small>
</div>

<div class="wrap">
  <h1>Select an institution</h1>
  <p class="lede">
    Two institutions running the same CoreLink Teller product, configured, branded and
    versioned independently &mdash; the arrangement this platform is designed around.
  </p>

  <div class="cards">${cards}</div>

  <div class="note">
    <b>Demonstration environment.</b> Every institution, member, account and balance in this
    system is fabricated. It exists to exercise UI automation against a realistic
    back-office surface. See
    <a href="https://dexdash.cloud">dexdash.cloud</a> for what is being demonstrated.
  </div>

  <div class="foot">
    &copy; ${new Date().getFullYear()} CoreLink Financial Systems. All rights reserved.<br>
    <a href="https://dexdash.cloud">Platform overview</a> &middot;
    <a href="https://console.dexdash.cloud">Operator console</a> &middot;
    <a href="/t/firstcu/help">Help</a>
  </div>
</div>

</body></html>`);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[target-app] http://127.0.0.1:${PORT}  tenants: ${Object.keys(TENANTS).join(", ")}`,
  );
});
