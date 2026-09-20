import type {
  FrameStep,
  TargetDescriptor,
  ContainerRef,
  LocatorStrategy,
} from "../core/targeting.js";

/**
 * The surface seam.
 *
 * Everything above this line - the discovery loop, the replay executor, the
 * artifact schema - is written against these types and must never import
 * Playwright, CDP, or anything web-specific. That is the whole point: the same
 * recorded flow should be executable against a desktop surface by swapping the
 * implementation, because role/name/value is the vocabulary that UI Automation
 * (Windows) and the AX API (macOS) expose too.
 *
 * What a surface owes its caller is narrow on purpose:
 *   observe()  - what is on screen right now, as structured nodes
 *   resolve()  - turn a recorded TargetDescriptor into one concrete node
 *   act()      - do one thing
 * Everything else (which step we are on, whether we are allowed to, what it
 * means) belongs above the seam.
 */

export type Rect = { x: number; y: number; width: number; height: number };

/** How a node's usable label was arrived at. Recorded so the recorder can reason about robustness. */
export type LabelSource =
  /** The platform gave us an accessible name directly. Most trustworthy. */
  | "accessible_name"
  /** Derived from a wrapping <label>, or aria-labelledby. */
  | "associated_label"
  /** Derived from adjacent text, e.g. the table cell to the left. The legacy case. */
  | "adjacent_text"
  /** Last resort: placeholder, title, or the control's own name attribute. */
  | "attribute";

/** One perceived control or region. */
export type SurfaceNode = {
  /** Ephemeral id, stable only within a single Observation. Never persisted in an artifact. */
  ref: string;
  role: string;
  /** Platform-provided accessible name. Often empty on legacy surfaces. */
  name: string;
  /**
   * The name we will actually reason with: `name` when present, otherwise
   * inferred from the surrounding document. This is what makes an unlabelled
   * <input> in a table cell addressable at all.
   */
  label: string;
  labelSource: LabelSource;
  /**
   * Text of the neighbouring label, kept separate from the node's own name.
   *
   * These are different facts and conflating them loses information. An
   * unlabelled input has no name of its own, so its adjacent text *becomes* its
   * label. A value cell reading "$8,214.55" has a perfectly good name already,
   * but the only way to find it is "the cell beside the one saying Savings
   * Balance" - so it needs both.
   */
  adjacentLabel?: string;
  /**
   * Which direction the adjacent label was found in. Without this the recorded
   * `relation` on a descriptor is decorative: on a two-column layout the cell to
   * the RIGHT of "Name:" and the cell BELOW "Name:" both report the same
   * adjacent text, and a descriptor that cannot tell them apart is ambiguous.
   */
  adjacentRelation?: "right_of" | "below" | "wraps";
  /** True when the node is readable but not actionable (a value cell). */
  readOnly?: boolean;
  value?: string;
  disabled?: boolean;
  focusable?: boolean;
  /** Nearest meaningful ancestor, used to scope "the Search button in this panel". */
  container?: ContainerRef;
  framePath: FrameStep[];
  /** Absolute viewport coordinates. Evidence and input forwarding only, never a locator. */
  bbox?: Rect;
};

export type FrameInfo = {
  id: string;
  name: string;
  url: string;
  depth: number;
  parentId?: string;
};

/** A complete perception of the surface at one moment. */
export type Observation = {
  url: string;
  title: string;
  frames: FrameInfo[];
  nodes: SurfaceNode[];
  /** Flattened visible text, for text-based assertions and outcome detectors. */
  text: string;
  capturedAt: string;
};

/**
 * The outcome of resolving a recorded descriptor.
 *
 * `ambiguous` is a first-class result rather than an internal detail, because
 * silently taking the first of several matches is the failure this system exists
 * to avoid. The caller decides what to do; the surface only reports the truth.
 */
export type Resolution =
  | {
      ok: true;
      node: SurfaceNode;
      strategyIndex: number;
      strategy: LocatorStrategy;
      confidence: number;
    }
  | { ok: false; reason: "not_found"; tried: LocatorStrategy[] }
  | {
      ok: false;
      reason: "ambiguous";
      strategy: LocatorStrategy;
      candidates: SurfaceNode[];
    };

export type ScreenshotOptions = {
  /** Nodes whose pixels must be blacked out before the image is written. */
  maskRefs?: string[];
  quality?: number;
};

export interface Surface {
  observe(): Promise<Observation>;
  resolve(
    target: TargetDescriptor,
    observation?: Observation,
  ): Promise<Resolution>;
  click(node: SurfaceNode): Promise<void>;
  type(node: SurfaceNode, text: string, clearFirst: boolean): Promise<void>;
  select(node: SurfaceNode, value: string): Promise<void>;
  press(key: string): Promise<void>;
  navigate(url: string): Promise<void>;
  readText(node: SurfaceNode): Promise<string>;
  screenshot(opts?: ScreenshotOptions): Promise<Buffer>;
  url(): string;
  close(): Promise<void>;
}

/**
 * Roles that carry readable values but are not actionable. Included in an
 * observation so declared outputs can be extracted, and so text assertions can
 * be scoped to a region rather than matched against the whole page.
 */
export const READABLE_ROLES = new Set([
  "cell",
  "LayoutTableCell",
  "gridcell",
  "rowheader",
  "columnheader",
  "paragraph",
  "heading",
]);

/** Roles we treat as actionable. Kept explicit so the agent is not offered scenery. */
export const INTERACTIVE_ROLES = new Set([
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "checkbox",
  "radio",
  "link",
  "menuitem",
  "tab",
  "switch",
  "slider",
  "spinbutton",
]);

/** Normalisation used by every "normalized" name comparison in the system. */
export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[:*]+\s*$/, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
