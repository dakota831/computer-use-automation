import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Play, Radio, ShieldAlert } from "lucide-react";
import clsx from "clsx";
import { api, type ControlOwner, type Intervention } from "../lib/api.ts";
import { Empty } from "./Interventions.tsx";

/**
 * The handoff surface.
 *
 * Frames arrive over a WebSocket as base64 JPEGs from CDP Page.startScreencast
 * and are painted to a canvas. When this operator holds the control lease,
 * pointer and key events on that canvas are forwarded back over the same socket
 * and dispatched into the *live* page - the same browser session the automation
 * was driving, not a fresh one.
 *
 * Input is gated on both ends. Disabling the canvas here is a courtesy so the
 * operator is not typing into a void; the actual guarantee is server-side,
 * which refuses to dispatch anything unless the lease says operator. Treating
 * the client gate as the real one would be a mistake.
 */

type Frame = { data: string; w: number; h: number };

export function SessionView({ interventionId }: { interventionId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [owner, setOwner] = useState<ControlOwner>("automation");
  const [holder, setHolder] = useState("automation");
  const [connected, setConnected] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    width: number;
    height: number;
    stepId?: string;
    reason?: string;
  } | null>(null);
  const [detail, setDetail] = useState<Intervention | null>(null);
  const [frames, setFrames] = useState(0);

  // Natural size of the remote viewport, needed to map a click on the scaled
  // canvas back to a coordinate in the real page.
  const natural = useRef({ w: 1280, h: 900 });

  useEffect(() => {
    api
      .intervention(interventionId)
      .then(setDetail)
      .catch(() => {});
  }, [interventionId]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws?intervention=${encodeURIComponent(interventionId)}`,
    );
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "frame") {
        paint(m as Frame);
        setFrames((n) => n + 1);
      } else if (m.t === "state") {
        setOwner(m.owner);
        setHolder(m.holder);
      } else if (m.t === "meta") {
        natural.current = { w: m.width, h: m.height };
        setMeta(m);
      } else if (m.t === "denied") {
        setDenied(m.message);
        setTimeout(() => setDenied(null), 4000);
      }
    };
    return () => ws.close();
  }, [interventionId]);

  const paint = (f: Frame) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
        natural.current = { w: img.width, h: img.height };
      }
      canvas.getContext("2d")?.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${f.data}`;
  };

  /** Canvas coordinates -> real viewport coordinates. */
  const toPage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * natural.current.w),
      y: Math.round(((e.clientY - r.top) / r.height) * natural.current.h),
    };
  };

  const send = useCallback((msg: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const hasControl = owner === "operator";

  const onPointer =
    (type: "mousePressed" | "mouseReleased" | "mouseMoved") =>
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!hasControl) return;
      const { x, y } = toPage(e);
      send({
        t: "mouse",
        type,
        x,
        y,
        button: type === "mouseMoved" ? "none" : "left",
        clickCount: type === "mouseMoved" ? 0 : 1,
      });
    };

  const onKey = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!hasControl) return;
    e.preventDefault();
    const printable = e.key.length === 1;
    send({
      t: "key",
      type: "keyDown",
      key: e.key,
      code: e.code,
      ...(printable ? { text: e.key } : {}),
    });
    send({ t: "key", type: "keyUp", key: e.key, code: e.code });
  };

  const take = () =>
    api
      .takeControl(interventionId, "operator")
      .then((r) => (setOwner(r.owner), setHolder(r.holder)));
  const release = (action: "resume" | "step_completed" | "abandon") =>
    api
      .releaseControl(interventionId, action, noteFor(action))
      .then((r) => (setOwner(r.owner), setHolder(r.holder)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={clsx(
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            hasControl ? "bg-ok/15 text-ok" : "bg-accent/15 text-accent",
          )}
        >
          <Radio className="size-3" />
          {hasControl
            ? `You have control (${holder})`
            : "Automation has control"}
        </span>
        <span className="font-mono text-xs text-ink-dim">{interventionId}</span>
        <span className="font-mono text-xs text-ink-dim">
          {connected ? `live · ${frames} frames` : "disconnected"}
        </span>

        <div className="ml-auto flex gap-2">
          <button
            onClick={take}
            disabled={hasControl}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            <Hand className="size-4" /> Take control
          </button>
          <button
            onClick={() => release("resume")}
            disabled={!hasControl}
            className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-sm disabled:opacity-40"
            title="Authorise the step; automation performs it"
          >
            <Play className="size-4" /> Approve &amp; resume
          </button>
          <button
            onClick={() => release("step_completed")}
            disabled={!hasControl}
            className="rounded-md border border-edge px-3 py-1.5 text-sm disabled:opacity-40"
            title="You performed this step yourself; automation skips it"
          >
            I did it
          </button>
        </div>
      </div>

      {detail && (
        <div className="rounded-lg border border-edge bg-surface-raised p-4 text-sm">
          <div className="font-medium">{detail.capabilityId}</div>
          <div className="mt-1 text-ink-dim">
            {meta?.reason ?? detail.reason}
          </div>
          <div className="mt-2 font-mono text-xs text-ink-dim">
            step {meta?.stepId ?? detail.stepId} &middot; {detail.stepIntent}
          </div>
        </div>
      )}

      {denied && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <ShieldAlert className="size-4 shrink-0" />
          <span className="font-mono text-xs">{denied}</span>
        </div>
      )}

      {connected ? (
        <canvas
          ref={canvasRef}
          tabIndex={0}
          onPointerDown={onPointer("mousePressed")}
          onPointerUp={onPointer("mouseReleased")}
          onPointerMove={onPointer("mouseMoved")}
          onKeyDown={onKey}
          className={clsx(
            "w-full rounded-lg border bg-black outline-none",
            hasControl
              ? "cursor-crosshair border-ok/50"
              : "cursor-not-allowed border-edge opacity-90",
          )}
        />
      ) : (
        <Empty
          title="No live session attached"
          detail="The run may have finished, or this intervention is already resolved."
        />
      )}

      {!hasControl && connected && (
        <p className="text-xs text-ink-dim">
          Viewing only. Input is refused by the server until you take control
          &mdash; the disabled cursor here is a courtesy, not the guarantee.
        </p>
      )}
    </div>
  );
}

const noteFor = (a: string) =>
  a === "step_completed"
    ? "operator completed this step manually"
    : a === "abandon"
      ? "operator abandoned the run"
      : "operator reviewed and approved";
