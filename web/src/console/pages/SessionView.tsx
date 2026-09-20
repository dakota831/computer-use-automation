import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Hand, Play, Radio, ShieldAlert, CheckCheck } from "lucide-react";
import clsx from "clsx";
import { api, type ControlOwner, type Intervention } from "../lib/api.ts";
import {
  Card,
  Badge,
  Button,
  Mono,
  Field,
  EmptyState,
} from "../../shared/ui.tsx";
import { CopyButton } from "../../shared/Chrome.tsx";
import { useToast } from "../../shared/Toast.tsx";
import { formatAbsolute } from "../../shared/hooks.ts";
import { Crumbs, PageHead } from "../App.tsx";

/**
 * The handoff surface.
 *
 * Frames arrive over a WebSocket as base64 JPEGs from CDP Page.startScreencast
 * and are painted to a canvas. When this operator holds the control lease,
 * pointer and key events on the canvas are forwarded back over the same socket
 * and dispatched into the *live* page — the same browser session the automation
 * was driving, not a fresh one.
 *
 * Input is gated on both ends. Disabling the canvas here is a courtesy so the
 * operator is not typing into a void; the actual guarantee is server-side, which
 * refuses to dispatch unless the lease says operator. Treating the client gate
 * as the real one would be a mistake.
 */
export function SessionView() {
  const { id = "" } = useParams();
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const natural = useRef({ w: 1280, h: 900 });

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

  const reload = useCallback(() => {
    api
      .intervention(id)
      .then(setDetail)
      .catch(() => {});
  }, [id]);
  useEffect(reload, [reload]);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${location.host}/ws?intervention=${encodeURIComponent(id)}`,
    );
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "frame") {
        paint(m.data);
        setFrames((n) => n + 1);
      } else if (m.t === "state") {
        setOwner(m.owner);
        setHolder(m.holder);
      } else if (m.t === "meta") {
        natural.current = { w: m.width, h: m.height };
        setMeta(m);
      } else if (m.t === "denied") {
        setDenied(m.message);
        setTimeout(() => setDenied(null), 5000);
      }
    };
    return () => ws.close();
  }, [id]);

  const paint = (b64: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width) {
        canvas.width = img.width;
        canvas.height = img.height;
        natural.current = { w: img.width, h: img.height };
      }
      canvas.getContext("2d")?.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${b64}`;
  };

  const send = (msg: unknown) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const hasControl = owner === "operator";

  /** Canvas coordinates → real viewport coordinates. */
  const toPage = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - r.left) / r.width) * natural.current.w),
      y: Math.round(((e.clientY - r.top) / r.height) * natural.current.h),
    };
  };

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
      .takeControl(id, "admin")
      .then((r) => {
        setOwner(r.owner);
        setHolder(r.holder);
        reload();
        toast(`Control taken by ${r.holder}`, "ok");
      })
      .catch((e) => toast(String(e), "danger"));

  const release = (action: "resume" | "step_completed") =>
    api
      .releaseControl(
        id,
        action,
        action === "resume"
          ? "operator reviewed and approved"
          : "operator completed this step manually",
        "admin",
      )
      .then((r) => {
        setOwner(r.owner);
        setHolder(r.holder);
        reload();
        toast(
          action === "resume"
            ? "Approved — automation is resuming"
            : "Recorded as completed by you",
          "ok",
        );
      })
      .catch((e) => toast(String(e), "danger"));

  return (
    <>
      <Crumbs
        trail={[
          { label: "Interventions", to: "/interventions" },
          { label: id },
        ]}
      />
      <PageHead
        title="Live session"
        right={
          <Badge tone={hasControl ? "ok" : "info"}>
            <Radio className="size-3" />{" "}
            {hasControl
              ? `you have control (${holder})`
              : "automation has control"}
          </Badge>
        }
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={take}
              disabled={hasControl || !connected}
            >
              <Hand className="size-4" /> Take control
            </Button>
            <Button
              onClick={() => release("resume")}
              disabled={!hasControl}
              title="Authorise the step; automation performs it"
            >
              <Play className="size-4" /> Approve &amp; resume
            </Button>
            <Button
              onClick={() => release("step_completed")}
              disabled={!hasControl}
              title="You performed this step yourself; automation skips it"
            >
              <CheckCheck className="size-4" /> I did it
            </Button>
            <span className="ml-auto font-mono text-xs text-ink-faint">
              {connected ? `live · ${frames} frames` : "disconnected"}
            </span>
          </div>

          {denied && (
            <div className="rule flex items-start gap-2 border-danger bg-danger-pale p-2.5 text-sm text-danger">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span className="font-mono text-xs break-words">{denied}</span>
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
              aria-label="Live application session"
              className={clsx(
                "rule w-full bg-black shadow-hard outline-none",
                hasControl
                  ? "cursor-crosshair border-ok"
                  : "cursor-not-allowed opacity-95",
              )}
            />
          ) : (
            <EmptyState
              title="No live session attached"
              detail="The run may have finished, or this intervention is already resolved."
            />
          )}

          {!hasControl && connected && (
            <p className="text-xs text-ink-faint">
              Viewing only. Input is refused by the <strong>server</strong>{" "}
              until you take control — the disabled cursor here is a courtesy,
              not the guarantee.
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Why this stopped">
            <p className="text-sm">{meta?.reason ?? detail?.reason ?? "—"}</p>
            <dl className="mt-3">
              <Field label="Capability" mono>
                {detail?.capabilityId ?? "—"}
              </Field>
              <Field label="Step" mono>
                {meta?.stepId ?? detail?.stepId ?? "—"}
              </Field>
              <Field label="Intent">{detail?.stepIntent ?? "—"}</Field>
              <Field label="Intervention" mono>
                {id}{" "}
                <CopyButton
                  value={id}
                  label="intervention id"
                  className="ml-1 align-middle"
                />
              </Field>
              <Field label="Raised" mono>
                {formatAbsolute(detail?.raisedAt)}
              </Field>
            </dl>
          </Card>

          <Card title="Control history">
            {!detail?.leaseHistory.length ? (
              <p className="text-xs text-ink-faint">
                Automation has held this session throughout.
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5 text-xs">
                {detail.leaseHistory.map((h, i) => (
                  <li
                    key={i}
                    className="border-b border-rule-soft pb-1.5 last:border-0"
                  >
                    <Mono>
                      {h.from} → {h.to}
                    </Mono>
                    <p className="text-ink-dim">
                      by {h.actor}: {h.reason}
                    </p>
                    <p className="font-mono text-[0.625rem] text-ink-faint">
                      {h.at}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card
            title={`Operator actions (${detail?.humanActions.length ?? 0})`}
          >
            {!detail?.humanActions.length ? (
              <p className="text-xs text-ink-faint">Nothing recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 font-mono text-[0.6875rem]">
                {detail.humanActions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <Badge>{a.kind}</Badge>
                    <span className="text-ink-dim">
                      {JSON.stringify(a.detail)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 border-t border-rule-soft pt-2 text-[0.6875rem] text-ink-faint">
              Key <em>names</em> are recorded, never typed characters — an
              operator entering a member ID must not have it captured in an
              audit log.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
