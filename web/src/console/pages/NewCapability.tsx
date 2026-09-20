import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Sparkles, AlertTriangle } from "lucide-react";
import {
  authoring,
  type DiscoveryInfo,
  type DiscoveryJob,
} from "../lib/api.ts";
import {
  Card,
  Button,
  Badge,
  Mono,
  StatusBadge,
  ErrorState,
  EmptyState,
} from "../../shared/ui.tsx";
import { useToast } from "../../shared/Toast.tsx";
import { formatRelative } from "../../shared/hooks.ts";
import { Crumbs, PageHead } from "../App.tsx";
import { GoalEditor, GOAL_PREFIX, buildReferences } from "../GoalEditor.tsx";

/**
 * Run discovery from the console.
 *
 * This is the "learning" half of the system made operable. An LLM drives the
 * application against a goal and the run is recorded as a draft capability -
 * which is where the review workflow on the detail page picks up.
 *
 * Discovery has its own allowlist, separate from any capability's policy:
 * "signed in to the console" and "may point an LLM-driven browser at an
 * arbitrary URL" are different privileges and are gated separately.
 */
export function NewCapability() {
  const nav = useNavigate();
  const toast = useToast();
  const [info, setInfo] = useState<DiscoveryInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [busy, setBusy] = useState(false);

  const [f, setF] = useState({
    capabilityId: "cu.member.lookup_balance",
    title: "Look up a member's savings balance",
    description:
      "Signs in, finds a member by ID, opens the record and reads the savings balance.",
    goal: "look up the member whose ID is {{memberId}}, open their record, and read their savings balance and name.",
    entryPoint: "http://127.0.0.1:8080/t/firstcu",
    paramName: "memberId",
    paramValue: "100001",
    maxSteps: "22",
  });

  useEffect(() => {
    authoring
      .info()
      .then(setInfo)
      .catch((e) => setErr(String(e)));
  }, []);

  // Poll the job until it settles.
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(() => {
      authoring
        .job(job.id)
        .then((j) => {
          setJob(j);
          if (j.status === "succeeded")
            toast(`Discovered ${j.capabilityId}@${j.version}`, "ok");
          if (j.status === "failed")
            toast(`Discovery failed: ${j.error?.slice(0, 80)}`, "danger");
        })
        .catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [job, toast]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      setJob(
        await authoring.start({
          ...f,
          // The fixed clause is part of the goal the agent receives; the
          // operator only ever edits what follows it.
          goal: GOAL_PREFIX + f.goal.trim(),
          maxSteps: Number(f.maxSteps),
        }),
      );
      toast("Discovery started — the agent is driving the application", "info");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    k: keyof typeof f,
    label: string,
    hint?: string,
    long = false,
  ) => (
    <label className="flex flex-col gap-1">
      <span className="label-caps text-ink-faint">{label}</span>
      {long ? (
        <textarea
          rows={3}
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
          className="rule min-w-0 bg-paper-sunk px-2 py-1.5 font-mono text-xs outline-none focus:bg-paper-raised"
        />
      ) : (
        <input
          value={f[k]}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
          className="rule min-w-0 bg-paper-sunk px-2 py-1.5 font-mono text-sm outline-none focus:bg-paper-raised"
        />
      )}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
    </label>
  );

  return (
    <>
      <Crumbs
        trail={[
          { label: "Capabilities", to: "/capabilities" },
          { label: "New" },
        ]}
      />
      <PageHead
        title="Teach a new capability"
        lede="An LLM drives the application against your goal. The successful run is recorded as a draft capability you can then review and approve."
      />

      {info && !info.configured && (
        <div className="rule mb-4 border-warn bg-warn-pale p-3 text-sm text-warn">
          <p className="label-caps">Model not configured</p>
          <p className="mt-1">
            <Mono>NVIDIA_API_KEY</Mono> is not set on the server, so discovery
            cannot run. Replay is unaffected — it never calls a model.
          </p>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Goal">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="label-caps text-ink-faint">
                What should the agent accomplish
              </span>
              <GoalEditor
                value={f.goal}
                onChange={(v) => setF({ ...f, goal: v })}
                references={buildReferences(
                  f.paramName,
                  info?.secretKeys ?? [],
                )}
              />
            </div>
            {field(
              "entryPoint",
              "Entry point",
              info ? `Allowed: ${info.allowedOrigins.join(", ")}` : undefined,
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {field("capabilityId", "Capability id")}
              {field("maxSteps", "Max steps")}
            </div>
            {field("title", "Title")}
            {field("description", "Description", undefined, true)}
            <div className="grid gap-3 sm:grid-cols-2">
              {field("paramName", "Parameter name", "Becomes a typed input")}
              {field("paramValue", "Example value", "Used for this run only")}
            </div>

            {err && <ErrorState error={err} />}

            <Button
              variant="primary"
              onClick={start}
              disabled={
                busy || job?.status === "running" || info?.configured === false
              }
            >
              <Sparkles className="size-4" />
              {job?.status === "running"
                ? "Agent is working…"
                : busy
                  ? "Starting…"
                  : "Run discovery"}
            </Button>
            <p className="text-xs text-ink-faint">
              A run takes roughly 15&ndash;60 seconds and costs a handful of
              model calls. Every action is policy-checked and the agent never
              sees a credential.
            </p>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="This run">
            {!job ? (
              <EmptyState
                title="Nothing running"
                detail="Set a goal and start a discovery run."
              />
            ) : (
              <dl className="flex flex-col gap-1.5 text-sm">
                <Row k="Job">
                  <Mono>{job.id}</Mono>
                </Row>
                <Row k="Status">
                  <StatusBadge
                    status={
                      job.status === "succeeded"
                        ? "success"
                        : job.status === "failed"
                          ? "failed"
                          : "pending"
                    }
                  />
                </Row>
                {job.modelCalls !== undefined && (
                  <Row k="Model calls">
                    <Mono>{job.modelCalls}</Mono>
                  </Row>
                )}
                {job.steps !== undefined && (
                  <Row k="Steps recorded">
                    <Mono>{job.steps}</Mono>
                  </Row>
                )}
                {job.runId && (
                  <Row k="Evidence">
                    <Link
                      to={`/runs/${job.runId}`}
                      className="text-blue hover:underline"
                    >
                      <Mono>{job.runId}</Mono>
                    </Link>
                  </Row>
                )}
                {job.error && (
                  <div className="rule mt-1 border-danger bg-danger-pale p-2 text-xs text-danger">
                    <AlertTriangle className="mr-1 inline size-3.5" />
                    {job.error}
                  </div>
                )}
                {job.status === "succeeded" && job.capabilityId && (
                  <Button
                    variant="primary"
                    className="mt-2"
                    onClick={() =>
                      nav(`/capabilities/${job.capabilityId}@${job.version}`)
                    }
                  >
                    Review the draft
                  </Button>
                )}
              </dl>
            )}
          </Card>

          <Card title="Recent discovery runs">
            {!info?.jobs.length ? (
              <p className="text-xs text-ink-faint">
                None yet in this server session.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-xs">
                {info.jobs.map((j) => (
                  <li
                    key={j.id}
                    className="flex flex-wrap items-center gap-2 border-b border-rule-soft pb-1.5 last:border-0"
                  >
                    <Badge
                      tone={
                        j.status === "succeeded"
                          ? "ok"
                          : j.status === "failed"
                            ? "danger"
                            : "info"
                      }
                    >
                      {j.status}
                    </Badge>
                    <Mono className="truncate">
                      {j.capabilityId ?? j.goal.slice(0, 28)}
                    </Mono>
                    <span className="ml-auto text-ink-faint">
                      {formatRelative(j.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <dt className="label-caps w-28 shrink-0 text-ink-faint">{k}</dt>
    <dd className="min-w-0 break-all">{children}</dd>
  </div>
);
