import type { Tenant } from "./tenants.js";
import { MENU, VENDOR_NAME } from "./tenants.js";

/**
 * Chrome and markup for the stand-in back-office application.
 *
 * Two goals that are often assumed to conflict, and do not:
 *
 * 1. It should feel like real institutional software. Actual bank back-office
 *    systems are not sparse - they are dense, fully chromed, and carry a lot of
 *    operational furniture: a branded crest, a menu bar, a session clock, a
 *    teller identity, a status bar with the app server name. A stripped-down
 *    page would be an unrealistic target, not a neutral one.
 *
 * 2. It must stay a *hostile* automation surface, because that is what makes it
 *    worth automating against. So all of the following are preserved exactly:
 *      - the working content lives inside an <iframe>, so the agent must cross
 *        a frame boundary to see anything
 *      - forms lay out with nested <table>, not semantic elements
 *      - controls carry generated ASP.NET-style names (ctl00$MainContent$txtX)
 *      - there are no test IDs and no <label for=...> anywhere
 *
 * Visual richness and machine hostility are independent axes. Adding the first
 * does not reduce the second, and the login fields still have no accessible
 * name at all.
 *
 * One constraint the chrome must respect: assertions match against ALL visible
 * text, shell included. Menu labels are therefore chosen not to collide with any
 * checkpoint string used by a recorded capability - see MENU in tenants.ts.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Per-tenant crest, also served as the favicon. */
export function crestSvg(t: Tenant): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" fill="${t.theme.barTo}"/>
  <path d="M16 3 L28 8 V16 C28 23 22 27.5 16 29.5 C10 27.5 4 23 4 16 V8 Z" fill="${t.theme.barFrom}" stroke="${t.theme.accent}" stroke-width="1.5"/>
  <text x="16" y="20" font-family="Georgia,serif" font-size="11" font-weight="bold" fill="#ffffff" text-anchor="middle">${esc(t.initials)}</text>
</svg>`;
}

const shellStyles = (t: Tenant) => `
 *{box-sizing:border-box}
 body{margin:0;background:${t.theme.bg};font-family:"Segoe UI",Tahoma,Verdana,Arial,sans-serif;font-size:12px;color:#1a1a1a}
 a{color:#14396b}
 .brand{background:linear-gradient(to bottom,${t.theme.barFrom},${t.theme.barTo});color:#fff;
   border-bottom:3px solid ${t.theme.accent};padding:7px 12px;display:flex;align-items:center;gap:10px}
 .crest{width:34px;height:34px;flex:0 0 auto}
 .brandtext{line-height:1.25}
 .brandtext .nm{font-family:Georgia,"Times New Roman",serif;font-size:16px;font-weight:bold;letter-spacing:.2px}
 .brandtext .ch{font-size:10px;opacity:.78}
 .whoami{margin-left:auto;text-align:right;font-size:11px;line-height:1.5}
 .whoami b{font-weight:600}
 .whoami .sep{opacity:.5;margin:0 5px}
 .menu{background:${t.theme.menu};border-bottom:1px solid rgba(0,0,0,.35);padding:0 8px;display:flex;flex-wrap:wrap}
 .menu a{color:#fff;text-decoration:none;font-size:11.5px;padding:6px 11px;display:block;border-right:1px solid rgba(255,255,255,.18)}
 .menu a:hover{background:rgba(255,255,255,.14)}
 .menu a.on{background:${t.theme.bg};color:#1a1a1a;font-weight:600}
 .ctx{background:#fff;border-bottom:1px solid #b9c3d2;padding:5px 12px;font-size:11px;color:#41506b;display:flex;gap:8px;flex-wrap:wrap}
 .ctx .crumb{opacity:.75}
 .ctx .now{margin-left:auto;font-family:Consolas,monospace;opacity:.7}
 .frameWrap{padding:10px 12px}
 iframe{width:100%;height:430px;border:1px solid #93a2b8;background:#fff;box-shadow:inset 0 1px 0 #fff}
 .status{border-top:1px solid #b9c3d2;background:linear-gradient(to bottom,#f7f9fc,#e6ebf3);
   padding:5px 12px;font-size:10.5px;color:#4a5568;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
 .status .dot{width:7px;height:7px;background:#2e8b57;display:inline-block;border-radius:0}
 .status .right{margin-left:auto}
 .foot{padding:9px 12px 16px;font-size:10.5px;color:#6b7280;text-align:center;line-height:1.7}
 .foot a{color:#41506b;margin:0 6px}
 @media (max-width:640px){
   .brandtext .nm{font-size:13px}
   .whoami{display:none}
   iframe{height:420px}
   .menu a{padding:6px 8px;font-size:11px}
 }
`;

export type ShellOpts = {
  innerPath: string;
  title: string;
  /** Which top-level menu item is highlighted. */
  active?: string;
  /** Breadcrumb trail shown in the context bar. */
  crumbs?: string[];
  /** Operator identity shown in the brand bar once signed in. */
  teller?: string;
};

export function shell(t: Tenant, o: ShellOpts): string {
  const now = new Date();
  const menu = MENU.map(
    (m) =>
      `<a href="/t/${t.id}/${m.id}" ${m.id === (o.active ?? "members") ? 'class="on"' : ""}>${esc(m.label)}</a>`,
  ).join("");

  const crumbs = (o.crumbs ?? [o.title])
    .map(
      (c, i, all) =>
        `<span class="crumb">${esc(c)}</span>${i < all.length - 1 ? "<span>&rsaquo;</span>" : ""}`,
    )
    .join(" ");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(t.institution)} &mdash; ${esc(o.title)} | CoreLink Teller</title>
<link rel="icon" type="image/svg+xml" href="/t/${t.id}/favicon.svg">
<style>${shellStyles(t)}</style>
</head><body>

<div class="brand">
  <div class="crest">${crestSvg(t)}</div>
  <div class="brandtext">
    <div class="nm">${esc(t.institution)}</div>
    <div class="ch">${esc(t.charter)}</div>
  </div>
  <div class="whoami">
    <div>Teller: <b>${esc(o.teller ?? "Not signed in")}</b><span class="sep">|</span>Branch <b>004 &mdash; Main</b></div>
    <div>${now.toDateString()}<span class="sep">|</span>CoreLink Teller ${esc(t.productVersion)}${o.teller ? `<span class="sep">|</span><a href="/t/${t.id}/signout" style="color:#fff;text-decoration:underline">Sign Out</a>` : ""}</div>
  </div>
</div>

<div class="menu">${menu}</div>

<div class="ctx">
  ${crumbs}
  <span class="now">${now.toTimeString().slice(0, 8)}</span>
</div>

<div class="frameWrap">
  <iframe name="mainFrame" title="Application content" src="${esc(o.innerPath)}"></iframe>
</div>

<div class="status">
  <span><span class="dot"></span> Connected</span>
  <span>App server: <b>${esc(t.appServer)}</b></span>
  <span>Region: US-EAST</span>
  <span>Session: <b id="sessclk">00:00:00</b></span>\n  <span class="right">Environment: <b>DEMONSTRATION</b> &mdash; all data is synthetic</span>
</div>

<div class="foot">
  CoreLink Teller ${esc(t.productVersion)} &mdash; licensed to ${esc(t.institution)}<br>
  &copy; ${now.getFullYear()} ${esc(VENDOR_NAME)}. All rights reserved.
  <a href="/t/${t.id}/help">Help</a>&middot;
  <a href="/t/${t.id}/help#support">Contact Support</a>&middot;
  <a href="/t/${t.id}/help#privacy">Privacy</a>&middot;
  <a href="/t/${t.id}/help#terms">Terms of Use</a><br>
  <span style="opacity:.75">This is a synthetic demonstration system. It represents no real institution, member or account.</span>
</div>

<script>
(function(){
  var el = document.getElementById("sessclk"); if (!el) return;
  var t0 = Date.now();
  setInterval(function(){
    var s = Math.floor((Date.now()-t0)/1000);
    el.textContent = [Math.floor(s/3600), Math.floor(s/60)%60, s%60]
      .map(function(n){ return String(n).padStart(2,"0"); }).join(":");
  }, 1000);
})();
</script>
</body></html>`;
}

/**
 * Inner frame document. Styled like the rest of the product, but structurally
 * unchanged: nested tables, generated control names, no label association.
 */
export function frameDoc(t: Tenant, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(t.institution)}</title>
<style>
 body{font-family:"Segoe UI",Tahoma,Verdana,Arial,sans-serif;font-size:12px;margin:10px;background:#fff;color:#1a1a1a}
 table{border-collapse:collapse}
 td{padding:4px 8px;font-size:12px}
 .panel{border:1px solid #93a2b8;background:#fbfcfe;box-shadow:0 1px 2px rgba(20,40,70,.12)}
 .panelhdr{background:linear-gradient(to bottom,${t.theme.panelFrom},${t.theme.panelTo});
   font-weight:600;padding:6px 9px;border-bottom:1px solid #93a2b8;color:#17243a;font-size:12px}
 .panelbody{padding:9px}
 .err{color:#8a1010;background:#fdecec;border:1px solid #e3a1a1;padding:8px 10px;margin:6px 0}
 .warn{color:#7a4a00;background:#fff7e3;border:1px solid #e3cc92;padding:8px 10px;margin:6px 0}
 .hint{color:#5a6a85;font-size:11px;margin:6px 0 0}
 input[type=text],input[type=password]{font-family:inherit;font-size:12px;padding:3px 4px;
   border:1px solid #7a869a;border-top-color:#5c6a80;background:#fff}
 input[type=text]:focus,input[type=password]:focus{outline:2px solid ${t.theme.menu};outline-offset:0}
 input[type=submit]{font-family:inherit;font-size:12px;padding:4px 13px;cursor:pointer;
   border:1px solid #6d7c93;background:linear-gradient(to bottom,#fdfefe,#dfe5ee);box-shadow:inset 0 1px 0 #fff}
 input[type=submit]:hover{background:linear-gradient(to bottom,#fff,#d2dbe8)}
 input[type=submit]:active{background:#c8d3e3}
 .reqmark{color:#a10000}
 .datalbl{color:#41506b}
 a{color:#14396b}
</style></head>
<body>${bodyHtml}</body></html>`;
}

/** A labelled field the legacy way: label in one cell, unlabelled input in the next. */
export function fieldRow(
  label: string,
  controlName: string,
  type = "text",
  value = "",
  required = false,
): string {
  return `<tr><td align="right" class="datalbl">${esc(label)}:${required ? ' <span class="reqmark">*</span>' : ""}</td>
    <td><input type="${type}" name="${esc(controlName)}" value="${esc(value)}" size="26"></td></tr>`;
}

export function panel(title: string, inner: string, width = 660): string {
  return `<table class="panel" cellspacing="0" width="${width}"><tr><td class="panelhdr">${esc(title)}</td></tr>
          <tr><td class="panelbody">${inner}</td></tr></table>`;
}

export const errorBox = (msg: string) => `<div class="err">${esc(msg)}</div>`;
export const warnBox = (msg: string) => `<div class="warn">${esc(msg)}</div>`;
export { esc };
