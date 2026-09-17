import type { Tenant } from "./tenants.js";

/**
 * Deliberately legacy HTML.
 *
 * The point of this app is to be a *hostile* automation surface in the specific
 * ways the brief describes, because an agent that only works against clean
 * markup proves nothing about the real environment. Concretely, every page here:
 *
 *   - lays out with nested <table> rather than semantic elements
 *   - names controls with generated ASP.NET-style ids (ctl00$MainContent$txtX)
 *   - has no test IDs, and no <label for=...> association anywhere
 *   - puts the working content inside an <iframe>, so the agent has to traverse
 *     a frame boundary to see anything at all
 *
 * The one thing it does NOT do is randomise itself between loads. These are
 * stable enterprise apps; the brief is explicit that the hard part is runtime
 * error states, not drift. Faking drift would be solving the wrong problem.
 */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Outer shell: a nav bar and an iframe. The agent must cross into the frame. */
export function shell(t: Tenant, innerPath: string, title: string): string {
  return `<!doctype html>
<html><head><title>${esc(t.institution)} - ${esc(title)}</title>
<style>
 body{margin:0;font-family:Verdana,Arial,sans-serif;font-size:12px;background:${t.theme.bg}}
 .topbar{background:${t.theme.bar};color:#fff;padding:8px 12px;font-weight:bold}
 .topbar span.ver{float:right;font-weight:normal;font-size:10px;opacity:.75}
 iframe{width:100%;height:560px;border:1px solid #999;background:#fff}
</style></head>
<body>
 <div class="topbar">${esc(t.institution)} &mdash; Teller Console
   <span class="ver">CoreLink ${esc(t.productVersion)}</span></div>
 <iframe name="mainFrame" src="${esc(innerPath)}"></iframe>
</body></html>`;
}

/** Inner frame document: table-based chrome, no semantic landmarks. */
export function frameDoc(t: Tenant, bodyHtml: string): string {
  return `<!doctype html>
<html><head><title>${esc(t.institution)}</title>
<style>
 body{font-family:Verdana,Arial,sans-serif;font-size:12px;margin:10px;background:#fff}
 table{border-collapse:collapse}
 td{padding:4px 8px;font-size:12px}
 .panel{border:1px solid #b6bfcc;background:#fbfcfe}
 .panelhdr{background:#dde5ef;font-weight:bold;padding:5px 8px;border-bottom:1px solid #b6bfcc}
 .err{color:#a10000;background:#ffecec;border:1px solid #f0b0b0;padding:8px;margin:6px 0}
 .warn{color:#7a4a00;background:#fff6e0;border:1px solid #e8cf94;padding:8px;margin:6px 0}
 input[type=text],input[type=password]{font-family:Verdana;font-size:12px;padding:2px;border:1px solid #7a869a}
 input[type=submit]{font-family:Verdana;font-size:12px;padding:3px 10px}
 .grid td{border:1px solid #c9d2df}
 .grid th{border:1px solid #c9d2df;background:#e8eef6;padding:4px 8px;font-size:12px;text-align:left}
</style></head>
<body>${bodyHtml}</body></html>`;
}

/** A labelled field rendered the legacy way: label in one cell, unlabelled input in the next. */
export function fieldRow(label: string, controlName: string, type = "text", value = ""): string {
  return `<tr><td align="right">${esc(label)}:</td>
    <td><input type="${type}" name="${esc(controlName)}" value="${esc(value)}" size="24"></td></tr>`;
}

export function panel(title: string, inner: string): string {
  return `<table class="panel" cellspacing="0" width="640"><tr><td class="panelhdr">${esc(title)}</td></tr>
          <tr><td>${inner}</td></tr></table>`;
}

export const errorBox = (msg: string) => `<div class="err">${esc(msg)}</div>`;
export const warnBox = (msg: string) => `<div class="warn">${esc(msg)}</div>`;
export { esc };
