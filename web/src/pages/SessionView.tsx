import { useEffect, useRef, useState } from "react";
import { Hand, Play, Radio } from "lucide-react";
import clsx from "clsx";
import { api, type ControlOwner } from "../lib/api.ts";
import { Empty } from "./Interventions.tsx";

/**
 * The handoff surface.
 *
 * Frames arrive over a WebSocket as base64 JPEGs from CDP Page.startScreencast
 * and are painted to a canvas. When the operator holds the control lease, mouse
 * and key events on that canvas are forwarded back over the same socket and
 * dispatched into the *live* page via Input.dispatchMouseEvent — the same
 * browser session the automation was driving, not a fresh one.
 *
 * Input is gated on `owner === "operator"` on BOTH ends. The client will not
 * send while automation holds the lease, and the server will not dispatch. The
 * client-side gate is a courtesy; the server-side one is the actual guarantee.
 */
export function SessionView({ interventionId }: { interventionId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [owner, setOwner] = useState<ControlOwner>("automation");
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Wired up when the server lands; see src/server/.
    setConnected(false);
  }, [interventionId]);

  const take = () =>
    api
      .takeControl(interventionId)
      .then((r) => setOwner(r.owner))
      .catch(() => {});
  const release = () =>
    api
      .releaseControl(interventionId, "operator finished")
      .then((r) => setOwner(r.owner))
      .catch(() => {});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            "flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            owner === "operator"
              ? "bg-ok/15 text-ok"
              : "bg-accent/15 text-accent",
          )}
        >
          <Radio className="size-3" />
          {owner === "operator" ? "You have control" : "Automation has control"}
        </span>
        <span className="font-mono text-xs text-ink-dim">{interventionId}</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={take}
            disabled={owner === "operator"}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-40"
          >
            <Hand className="size-4" /> Take control
          </button>
          <button
            onClick={release}
            disabled={owner !== "operator"}
            className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-sm disabled:opacity-40"
          >
            <Play className="size-4" /> Hand back
          </button>
        </div>
      </div>

      {connected ? (
        <canvas
          ref={canvasRef}
          className="w-full rounded-lg border border-edge bg-black"
        />
      ) : (
        <Empty
          title="No live session attached"
          detail="Screencast transport lands with src/server/."
        />
      )}
    </div>
  );
}
