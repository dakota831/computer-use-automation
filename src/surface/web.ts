import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright";
import type { FrameStep, TargetDescriptor } from "../core/targeting.js";
import {
  INTERACTIVE_ROLES,
  READABLE_ROLES,
  normalizeName,
  type FrameInfo,
  type Observation,
  type Rect,
  type Resolution,
  type ScreenshotOptions,
  type Surface,
  type SurfaceNode,
} from "./types.js";
import { resolveTarget } from "./resolve.js";
import type { RemoteControllable } from "./types.js";

/**
 * Web surface adapter, built on CDP rather than the DOM.
 *
 * Perception is the accessibility tree (`Accessibility.getFullAXTree`), because
 * role/name/value is the one vocabulary that also exists on Windows (UI
 * Automation) and macOS (AX API). Building on CSS selectors would make the
 * desktop story fiction. Three things measured against the real target app shape
 * this implementation (see DECISIONS.md D7):
 *
 *   1. The top-level AX tree stops at the iframe boundary, so every frame is
 *      walked separately using ids from `Page.getFrameTree`.
 *   2. Playwright's internal frame handle is NOT a CDP frame id. Passing it
 *      silently returns the top frame's tree again rather than erroring.
 *   3. Legacy form controls frequently have no accessible name at all - the
 *      label lives in the adjacent table cell. The AX tree alone cannot address
 *      them, so unnamed interactive nodes are enriched from the DOM.
 *
 * Point 3 is where this adapter does real work. The AX tree remains the source
 * of truth for structure and roles; the DOM is consulted only to answer "what is
 * this control called?" when the platform declines to say. The desktop analogue
 * is UIA's LabeledBy plus neighbour heuristics, so the seam holds.
 *
 * Actions are dispatched as real input events (`Input.dispatchMouseEvent`) at the
 * control''s coordinates rather than by calling element.click(). That keeps this
 * honest to the "computer use" framing, and means the human handoff forwards
 * input through exactly the same path the automation uses.
 */

/** Ancestor roles worth scoping a search to. */
const CONTAINER_ROLES = new Set([
  "form",
  "dialog",
  "table",
  "LayoutTable",
  "region",
  "main",
  "navigation",
  "group",
]);

type NodeInternals = { backendNodeId: number; frameId: string };

export type LaunchOptions = {
  headless?: boolean;
  /** Origins the browser is permitted to talk to. Enforced at the network layer. */
  allowedOrigins?: string[];
  onBlockedRequest?: (url: string) => void;
  viewport?: { width: number; height: number };
};

export class WebSurface implements Surface, RemoteControllable {
  private internals = new Map<string, NodeInternals>();
  private lastObservation: Observation | null = null;
  private refSeq = 0;

  private constructor(
    private readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async launch(opts: LaunchOptions = {}): Promise<WebSurface> {
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 900 },
    });

    /**
     * Network-level allowlist. This is defence in depth, not decoration: the
     * PolicyEngine gates actions the system *chooses*, but a page can redirect
     * itself. This makes it impossible for the session to reach an off-list
     * origin at all, whoever initiated the request.
     */
    if (opts.allowedOrigins?.length) {
      const { urlMatchesEntry } = await import("../core/policy.js");
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (url.startsWith("data:") || url.startsWith("about:"))
          return route.continue();
        if (opts.allowedOrigins!.some((e) => urlMatchesEntry(url, e)))
          return route.continue();
        opts.onBlockedRequest?.(url);
        return route.abort("blockedbyclient");
      });
    }

    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Accessibility.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return new WebSurface(browser, context, page, cdp);
  }

  url(): string {
    return this.page.url();
  }

  // ----------------------------------------------------------------- observe

  private async frameTree(): Promise<FrameInfo[]> {
    const { frameTree } = await this.cdp.send("Page.getFrameTree");
    const out: FrameInfo[] = [];
    const walk = (n: any, depth: number, parentId?: string) => {
      out.push({
        id: n.frame.id,
        name: n.frame.name ?? "",
        url: n.frame.url ?? "",
        depth,
        parentId,
      });
      for (const c of n.childFrames ?? []) walk(c, depth + 1, n.frame.id);
    };
    walk(frameTree, 0, undefined);
    return out;
  }

  /** Frame path from the top document down to this frame, as recorded in artifacts. */
  private framePathFor(frames: FrameInfo[], frame: FrameInfo): FrameStep[] {
    if (frame.depth === 0) return [];
    return [
      {
        name: frame.name || undefined,
        urlPattern: parameterizeUrl(frame.url),
        index: frame.depth,
      },
    ];
  }

  async observe(): Promise<Observation> {
    const frames = await this.frameTree();
    this.internals.clear();
    this.refSeq = 0;
    const nodes: SurfaceNode[] = [];
    const textParts: string[] = [];

    for (const frame of frames) {
      let axNodes: any[];
      try {
        const r = await this.cdp.send("Accessibility.getFullAXTree", {
          frameId: frame.id,
        } as any);
        axNodes = r.nodes ?? [];
      } catch {
        continue; // frame detached mid-observation; not fatal
      }

      const byId = new Map<string, any>(axNodes.map((n) => [n.nodeId, n]));
      const frameOffset = await this.frameOffset(frame.id, frames);

      for (const ax of axNodes) {
        const role = ax.role?.value ?? "";
        if (!role || role === "none" || role === "InlineTextBox") continue;

        const name = String(ax.name?.value ?? "").trim();
        if (name) textParts.push(name);

        const interactive = INTERACTIVE_ROLES.has(role);
        const readable = READABLE_ROLES.has(role);
        if (!interactive && !readable && !CONTAINER_ROLES.has(role)) continue;
        if (role === "StaticText") continue;

        const backendNodeId = ax.backendDOMNodeId as number | undefined;

        let label = name;
        let labelSource: SurfaceNode["labelSource"] = "accessible_name";
        let adjacentLabel: string | undefined;
        let adjacentRelation: SurfaceNode["adjacentRelation"];
        let bbox: Rect | undefined;

        // Enrichment runs for anything actionable or readable, not only for
        // nameless nodes: a value cell has a name of its own and still needs to
        // know what sits beside it.
        if (backendNodeId !== undefined && (interactive || readable)) {
          const enriched = await this.enrich(backendNodeId, frameOffset);
          if (enriched) {
            bbox = enriched.bbox;
            adjacentLabel = enriched.adjacentLabel || undefined;
            adjacentRelation = enriched.adjacentRelation;
            if (!label && enriched.adjacentLabel) {
              label = enriched.adjacentLabel;
              labelSource = enriched.labelSource;
            }
          }
        }

        if (interactive && !label) continue; // unaddressable; nothing useful to record
        if (readable && !label && !adjacentLabel) continue;

        // Numbered only once the node is known to be kept, so the refs the
        // model sees are contiguous rather than pocked with gaps where skipped
        // nodes consumed a number.
        const ref = `ref_${++this.refSeq}`;

        const node: SurfaceNode = {
          ref,
          role,
          name,
          label,
          labelSource,
          value:
            ax.value?.value !== undefined ? String(ax.value.value) : undefined,
          disabled:
            ax.properties?.find((p: any) => p.name === "disabled")?.value
              ?.value === true || undefined,
          focusable:
            ax.properties?.find((p: any) => p.name === "focusable")?.value
              ?.value === true || undefined,
          adjacentLabel,
          adjacentRelation,
          readOnly: readable && !interactive ? true : undefined,
          container: nearestContainer(ax, byId),
          framePath: this.framePathFor(frames, frame),
          bbox,
        };
        nodes.push(node);
        if (backendNodeId !== undefined)
          this.internals.set(ref, { backendNodeId, frameId: frame.id });
      }
    }

    const obs: Observation = {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      frames,
      nodes,
      text: textParts.join("\n"),
      capturedAt: new Date().toISOString(),
    };
    this.lastObservation = obs;
    return obs;
  }

  /**
   * Offset of a frame within the top-level viewport.
   *
   * Element geometry from getBoundingClientRect() is relative to the element's
   * own frame, but Input.dispatchMouseEvent takes top-level viewport
   * coordinates. Without this correction every click inside an iframe lands
   * short by the height of whatever chrome sits above it - a silent misclick,
   * not an error, so it has to be right.
   *
   * Walks up the frame chain via DOM.getFrameOwner, adding each owning iframe's
   * position plus its border (clientLeft/clientTop), since the rect includes the
   * border but the content box starts inside it.
   */
  private async frameOffset(
    frameId: string,
    frames: FrameInfo[],
  ): Promise<{ x: number; y: number }> {
    let x = 0;
    let y = 0;
    let current: string | undefined = frameId;
    const byId = new Map(frames.map((f) => [f.id, f]));

    while (current && byId.get(current)?.parentId) {
      try {
        const { backendNodeId } = await this.cdp.send("DOM.getFrameOwner", {
          frameId: current,
        });
        const { object } = await this.cdp.send("DOM.resolveNode", {
          backendNodeId,
        });
        if (!object?.objectId) break;
        const { result } = await this.cdp.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          returnByValue: true,
          functionDeclaration:
            "function () { const r = this.getBoundingClientRect(); return JSON.stringify({ x: r.x + this.clientLeft, y: r.y + this.clientTop }); }",
        });
        const r = JSON.parse(String(result?.value ?? '{"x":0,"y":0}'));
        x += r.x;
        y += r.y;
      } catch {
        break;
      }
      current = byId.get(current)?.parentId;
    }
    return { x, y };
  }

  /**
   * Ask the DOM what a control is called when the platform would not say.
   *
   * Order matters and encodes what is actually trustworthy on legacy markup:
   * an associated <label> beats the table cell to the left, which beats the cell
   * above, which beats a placeholder, which beats the generated name attribute.
   */
  private async enrich(
    backendNodeId: number,
    offset: { x: number; y: number },
  ): Promise<{
    adjacentLabel: string;
    labelSource: SurfaceNode["labelSource"];
    adjacentRelation?: SurfaceNode["adjacentRelation"];
    bbox?: Rect;
  } | null> {
    try {
      const { object } = await this.cdp.send("DOM.resolveNode", {
        backendNodeId,
      });
      if (!object?.objectId) return null;
      const { result } = await this.cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const el = this;
          const txt = (n) => (n && n.innerText ? n.innerText.trim().replace(/\\s+/g, " ") : "");
          let label = "", src = "attribute", rel = "";

          const lbl = el.closest("label") || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
          if (txt(lbl)) { label = txt(lbl); src = "associated_label"; rel = "wraps"; }

          if (!label) {
            const td = el.closest("td, th");
            if (td) {
              const prev = td.previousElementSibling;
              if (txt(prev)) { label = txt(prev); src = "adjacent_text"; rel = "right_of"; }
              if (!label) {
                const tr = td.closest("tr");
                const idx = tr ? Array.prototype.indexOf.call(tr.children, td) : -1;
                const above = tr && tr.previousElementSibling ? tr.previousElementSibling.children[idx] : null;
                if (txt(above)) { label = txt(above); src = "adjacent_text"; rel = "below"; }
              }
            }
          }
          if (!label && el.placeholder) { label = el.placeholder; src = "attribute"; }
          if (!label && el.title) { label = el.title; src = "attribute"; }
          if (!label && el.value && el.type === "submit") { label = el.value; src = "attribute"; }
          if (!label && el.name) { label = String(el.name).split("$").pop(); src = "attribute"; }

          const r = el.getBoundingClientRect();
          return JSON.stringify({ label, src, rel, x: r.x, y: r.y, width: r.width, height: r.height });
        }`,
      });
      const v = JSON.parse(String(result?.value ?? "{}"));
      const bbox: Rect | undefined =
        v.width > 0 && v.height > 0
          ? {
              x: v.x + offset.x,
              y: v.y + offset.y,
              width: v.width,
              height: v.height,
            }
          : undefined;
      return {
        adjacentLabel: String(v.label ?? "").trim(),
        labelSource: v.src,
        adjacentRelation: v.rel || undefined,
        bbox,
      };
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------- resolve

  async resolve(
    target: TargetDescriptor,
    observation?: Observation,
  ): Promise<Resolution> {
    const obs = observation ?? this.lastObservation ?? (await this.observe());
    return resolveTarget(target, obs);
  }

  // ------------------------------------------------------------------ actions

  private center(node: SurfaceNode): { x: number; y: number } | null {
    if (!node.bbox) return null;
    return {
      x: node.bbox.x + node.bbox.width / 2,
      y: node.bbox.y + node.bbox.height / 2,
    };
  }

  async click(node: SurfaceNode): Promise<void> {
    const c = this.center(node);
    if (!c)
      throw new Error(
        `node ${node.ref} (${node.role} "${node.label}") has no geometry to click`,
      );
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: c.x,
      y: c.y,
      button: "none",
      clickCount: 0,
    });
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: c.x,
      y: c.y,
      button: "left",
      clickCount: 1,
    });
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: c.x,
      y: c.y,
      button: "left",
      clickCount: 1,
    });
  }

  async type(
    node: SurfaceNode,
    text: string,
    clearFirst = true,
  ): Promise<void> {
    await this.click(node);
    if (clearFirst) {
      const mod = process.platform === "darwin" ? 4 : 2; // Meta : Control
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        modifiers: mod,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
      });
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: mod,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
      });
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Delete",
        code: "Delete",
        windowsVirtualKeyCode: 46,
      });
      await this.cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Delete",
        code: "Delete",
        windowsVirtualKeyCode: 46,
      });
    }
    await this.cdp.send("Input.insertText", { text });
  }

  async select(node: SurfaceNode, value: string): Promise<void> {
    const internals = this.internals.get(node.ref);
    if (!internals)
      throw new Error(`node ${node.ref} is not from the current observation`);
    const { object } = await this.cdp.send("DOM.resolveNode", {
      backendNodeId: internals.backendNodeId,
    });
    if (!object?.objectId) throw new Error(`could not resolve ${node.ref}`);
    await this.cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      arguments: [{ value }],
      functionDeclaration: `function (v) {
        this.value = v;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
    });
  }

  async press(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /**
   * Navigate and wait for the content to actually be there.
   *
   * `domcontentloaded` fires before child frames load, and on a frameset app all
   * the real content is in a child frame - so observing immediately after
   * returns an empty screen. That is not a benign race: the agent saw no
   * controls and correctly gave up on a page that was about to be fine.
   */
  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "load" });
    await this.page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});
  }

  async readText(node: SurfaceNode): Promise<string> {
    const internals = this.internals.get(node.ref);
    if (!internals) return node.value ?? node.label;
    const { object } = await this.cdp.send("DOM.resolveNode", {
      backendNodeId: internals.backendNodeId,
    });
    if (!object?.objectId) return node.value ?? node.label;
    const { result } = await this.cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        if (this.value !== undefined && this.tagName === "INPUT") return String(this.value);
        return (this.innerText || this.textContent || "").trim().replace(/\\s+/g, " ");
      }`,
    });
    return String(result?.value ?? "");
  }

  /**
   * Screenshots mask declared-sensitive regions at capture time, because an
   * image cannot be scrubbed after the fact the way text can.
   */
  async screenshot(opts: ScreenshotOptions = {}): Promise<Buffer> {
    const masks = (opts.maskRefs ?? [])
      .map((r) => this.lastObservation?.nodes.find((n) => n.ref === r)?.bbox)
      .filter((b): b is Rect => !!b);
    if (masks.length) {
      await this.cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.querySelectorAll("[data-dex-mask]").forEach(e => e.remove());
          for (const m of ${JSON.stringify(masks)}) {
            const d = document.createElement("div");
            d.setAttribute("data-dex-mask", "1");
            d.style.cssText = "position:fixed;z-index:2147483647;background:#000;left:"+m.x+"px;top:"+m.y+"px;width:"+m.width+"px;height:"+m.height+"px";
            document.body.appendChild(d);
          }
        })()`,
      });
    }
    const { data } = await this.cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: opts.quality ?? 70,
    });
    if (masks.length) {
      await this.cdp.send("Runtime.evaluate", {
        expression: `document.querySelectorAll("[data-dex-mask]").forEach(e => e.remove())`,
      });
    }
    return Buffer.from(data, "base64");
  }

  // ------------------------------------------------- remote control (handoff)

  private screencasting = false;

  /**
   * Stream the live page to an operator.
   *
   * Every frame must be acknowledged or Chromium stops sending them, which
   * presents as a screencast that shows one frame and then freezes.
   */
  async startScreencast(
    onFrame: (frame: {
      dataBase64: string;
      width: number;
      height: number;
    }) => void,
  ): Promise<void> {
    if (this.screencasting) return;
    this.screencasting = true;
    this.cdp.on("Page.screencastFrame", async (params: any) => {
      onFrame({
        dataBase64: params.data,
        width: params.metadata?.deviceWidth ?? 0,
        height: params.metadata?.deviceHeight ?? 0,
      });
      try {
        await this.cdp.send("Page.screencastFrameAck", {
          sessionId: params.sessionId,
        });
      } catch {
        /* page navigated mid-frame; the next frame supersedes it */
      }
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 1280,
      maxHeight: 900,
      everyNthFrame: 1,
    });
  }

  async stopScreencast(): Promise<void> {
    if (!this.screencasting) return;
    this.screencasting = false;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
  }

  /**
   * Operator input goes through the same CDP Input domain the automation uses.
   * One code path exercised by both, so the handoff cannot drift from the
   * behaviour of the thing it is taking over from.
   */
  async dispatchMouse(
    ev: Parameters<RemoteControllable["dispatchMouse"]>[0],
  ): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: ev.type,
      x: ev.x,
      y: ev.y,
      button: ev.button ?? (ev.type === "mouseMoved" ? "none" : "left"),
      clickCount: ev.clickCount ?? (ev.type === "mouseMoved" ? 0 : 1),
    });
  }

  async dispatchKey(
    ev: Parameters<RemoteControllable["dispatchKey"]>[0],
  ): Promise<void> {
    await this.cdp.send("Input.dispatchKeyEvent", {
      type: ev.type,
      ...(ev.key ? { key: ev.key } : {}),
      ...(ev.code ? { code: ev.code } : {}),
      ...(ev.text ? { text: ev.text } : {}),
      ...(ev.modifiers ? { modifiers: ev.modifiers } : {}),
    });
  }

  viewportSize(): { width: number; height: number } {
    return this.page.viewportSize() ?? { width: 1280, height: 900 };
  }

  async close(): Promise<void> {
    await this.browser.close().catch(() => {});
  }
}

/** Nearest ancestor worth naming, used to scope ambiguous matches. */
function nearestContainer(
  ax: any,
  byId: Map<string, any>,
): SurfaceNode["container"] {
  let cur = ax.parentId ? byId.get(ax.parentId) : undefined;
  let hops = 0;
  while (cur && hops++ < 12) {
    const role = cur.role?.value;
    const name = String(cur.name?.value ?? "").trim();
    if (role && CONTAINER_ROLES.has(role) && name) return { role, name };
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return undefined;
}

/**
 * Turn a concrete URL into a pattern, so a recorded frame path is not bound to
 * one member id or one tenant host. This is the first half of the cross-tenant
 * reuse story: /t/firstcu/frame/member?id=100001 becomes /t/:seg/frame/member.
 */
export function parameterizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/\d+(?=\/|$)/g, "/:id");
    return path;
  } catch {
    return url;
  }
}

export { normalizeName };
