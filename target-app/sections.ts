import type { Tenant } from "./tenants.js";
import {
  ACCOUNTS,
  TRANSACTIONS,
  DAILY_TOTALS,
  AUDIT_LOG,
  MEMBERS,
  accountBalance,
  adjustmentTxns,
  money,
} from "./data.js";
import { frameDoc, panel, esc, fieldRow } from "./render.js";

/**
 * The rest of the application.
 *
 * A teller console with exactly one working screen is not a credible target.
 * These sections exist so the app can be clicked through like real software -
 * and so the automation is demonstrably driving an application rather than a
 * single page dressed up as one.
 *
 * Same construction rules as everywhere else: nested tables, generated control
 * names, no test IDs, no label association. Headings deliberately avoid the
 * strings any recorded checkpoint asserts on ("Member Detail", "Member Search",
 * "Sub-Account Created"), because assertions match all visible text and a
 * colliding heading elsewhere in the app would make a checkpoint pass on the
 * wrong screen.
 */

const grid = (headers: string[], rows: string[][]): string => `
<table class="grid" cellspacing="0" width="100%" style="border:1px solid #c3ccda">
  <tr>${headers.map((h) => `<th align="left" style="background:#e8eef6;border-bottom:1px solid #c3ccda;padding:5px 8px;font-size:11px">${esc(h)}</th>`).join("")}</tr>
  ${rows
    .map(
      (r, i) =>
        `<tr style="background:${i % 2 ? "#f7f9fc" : "#fff"}">${r
          .map(
            (c) =>
              `<td style="border-bottom:1px solid #e3e8f0;padding:4px 8px">${c}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}
</table>`;

const num = (v: number) =>
  `<span style="font-family:Consolas,monospace;color:${v < 0 ? "#8a1010" : "#15603a"}">${esc(money(v))}</span>`;

export function accountsPage(t: Tenant, memberId?: string): string {
  const rows = ACCOUNTS.filter((a) => !memberId || a.memberId === memberId).map(
    (a) => [
      `<a href="/t/${t.id}/frame/member?id=${esc(a.memberId)}">${esc(a.number)}</a>`,
      esc(a.kind),
      esc(a.memberId),
      esc(a.opened),
      esc(a.status),
      num(accountBalance(a)),
    ],
  );
  const total = ACCOUNTS.filter(
    (a) => !memberId || a.memberId === memberId,
  ).reduce((s, a) => s + accountBalance(a), 0);

  return frameDoc(
    t,
    panel(
      memberId ? `Account Register — Member ${memberId}` : "Account Register",
      `<form method="get" action="/t/${t.id}/accounts">
         <table><tr>
           <td align="right" class="datalbl">Filter by ${esc(t.labels.memberId)}:</td>
           <td><input type="text" name="${esc(t.controlPrefix)}txtFilterMember" value="${esc(memberId ?? "")}" size="16"></td>
           <td><input type="submit" name="${esc(t.controlPrefix)}btnFilter" value="Apply Filter"></td>
         </tr></table>
       </form>
       ${grid(["Account Number", "Product", "Member", "Opened", "Status", "Current Balance"], rows)}
       <p class="hint">${rows.length} account(s) &mdash; aggregate ${money(total)}</p>`,
      900,
    ),
  );
}

export function transactionsPage(t: Tenant, memberId?: string): string {
  const rows = [...adjustmentTxns(), ...TRANSACTIONS]
    .filter((x) => !memberId || x.memberId === memberId)
    .map((x) => [
      esc(x.posted),
      esc(x.account),
      esc(x.description),
      esc(x.type),
      num(x.amount),
      num(x.balance),
    ]);
  return frameDoc(
    t,
    panel(
      "Transaction Register",
      `<form method="get" action="/t/${t.id}/transactions">
         <table><tr>
           <td align="right" class="datalbl">Filter by ${esc(t.labels.memberId)}:</td>
           <td><input type="text" name="${esc(t.controlPrefix)}txtTxnMember" value="${esc(memberId ?? "")}" size="16"></td>
           <td><input type="submit" name="${esc(t.controlPrefix)}btnTxnFilter" value="Apply Filter"></td>
         </tr></table>
       </form>
       ${grid(["Posted", "Account", "Description", "Type", "Amount", "Running Balance"], rows)}
       <p class="hint">Showing posted items for the current business day and the preceding 30 days.</p>
       <p><a href="/t/${t.id}/frame/adjustment">${esc(t.labels.postAdjustment)}</a></p>`,
      900,
    ),
  );
}

export function reportsPage(t: Tenant): string {
  const rows = DAILY_TOTALS.map((d) => [
    esc(d.label),
    String(d.count),
    num(d.amount),
  ]);
  const catalogue = [
    ["RPT-014", "Daily Branch Totals", "Ready", "Every business day 18:00"],
    [
      "RPT-022",
      "Dormant Account Review",
      "Ready",
      "Monthly, first business day",
    ],
    ["RPT-031", "Large Item Exception", "Queued", "On demand"],
    ["RPT-047", "Regulation D Monitoring", "Ready", "Monthly"],
  ].map((r) => [
    `<a href="/t/${t.id}/reports">${esc(r[0]!)}</a>`,
    esc(r[1]!),
    esc(r[2]!),
    esc(r[3]!),
  ]);

  return frameDoc(
    t,
    `${panel("Daily Totals — Branch 004", grid(["Category", "Items", "Amount"], rows), 660)}
     <br>
     ${panel("Report Catalogue", grid(["Report", "Title", "Status", "Schedule"], catalogue), 660)}`,
  );
}

export function adminPage(t: Tenant, teller: string): string {
  const audit = AUDIT_LOG.map((a) => [
    esc(a.at),
    esc(a.actor),
    esc(a.action),
    esc(a.detail),
  ]);
  return frameDoc(
    t,
    `${panel(
      "Workstation Settings",
      `<table>
         ${fieldRow("Operator", `${t.controlPrefix}txtOperator`, "text", teller)}
         ${fieldRow("Branch", `${t.controlPrefix}txtBranch`, "text", "004 — Main")}
         ${fieldRow("Cash Drawer", `${t.controlPrefix}txtDrawer`, "text", "TLR-04")}
         <tr><td></td><td><input type="submit" name="${t.controlPrefix}btnSaveSettings" value="Save Settings"></td></tr>
       </table>
       <p class="hint">Settings apply to this workstation only and are not persisted in this demonstration build.</p>`,
      660,
    )}
     <br>
     ${panel("Activity Log", grid(["Timestamp", "Operator", "Action", "Detail"], audit), 900)}`,
  );
}

export function helpPage(t: Tenant): string {
  return frameDoc(
    t,
    panel(
      "Help &amp; Support",
      `<p><b>CoreLink Teller ${esc(t.productVersion)}</b> &mdash; licensed to ${esc(t.institution)}.</p>
       <p class="hint">This is a synthetic demonstration system built to exercise UI automation.
       It represents no real institution, member or account, and no data entered here is stored
       beyond the lifetime of the process.</p>
       <table>
         <tr><td align="right" class="datalbl">Support desk:</td><td>1-800-555-0147 (synthetic)</td></tr>
         <tr><td align="right" class="datalbl">App server:</td><td>${esc(t.appServer)}</td></tr>
         <tr><td align="right" class="datalbl">Demo credentials:</td><td><b>admin</b> / <b>admin</b></td></tr>
       </table>`,
      660,
    ),
  );
}

/** Small "recently viewed" list — the kind of affordance a teller actually uses. */
export function recentPanel(t: Tenant, recent: string[]): string {
  if (!recent.length) return "";
  const rows = recent
    .slice(0, 5)
    .map((id) => [
      `<a href="/t/${t.id}/frame/member?id=${esc(id)}">${esc(id)}</a>`,
      esc(MEMBERS[id]?.name ?? "—"),
    ]);
  return `<br>${panel("Recently Viewed", grid([t.labels.memberId, "Name"], rows), 400)}`;
}
