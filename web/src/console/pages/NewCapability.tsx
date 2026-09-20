import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Sparkles,
  AlertTriangle,
  Building2,
  ChevronDown,
  Loader2,
  Square,
  Info,
} from "lucide-react";
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
import {
  GoalEditor,
  GOAL_PREFIX,
  buildReferences,
  parseParameters,
} from "../GoalEditor.tsx";

/**
 * Teach a new capability.
 *
 * Written for an operations person, not an engineer. They choose an institution
 * from a list rather than typing a URL, describe the task in their own words,
 * and fill in an example for each value they referenced. Everything else — the
 * identifier, the step budget, the credentials — is the system's business.
 */

/** A readable, stable id derived from the title, so nobody has to invent one. */
export function deriveCapabilityId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug ? `cu.${slug}` : "";
}

/** mm:ss, because a run is minutes and a bare second count reads as noise. */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Words that mean "do this N times", where N is only known at run time.
 *
 * A capability is a fixed list of steps, so a goal that needs a loop cannot be
 * recorded as one - the agent will either do it once or wander until the budget
 * runs out. Catching that in the form costs a sentence; catching it after the
 * run costs five minutes and leaves the operator with nothing.
 */
const REPETITION_HINTS =
  /\b(all|each|every|both|any\s+other|remaining|one\s+by\s+one)\b/i;

export function NewCapability() {
  const nav = useNavigate();
  const toast = useToast();
  const [info, setInfo] = useState<DiscoveryInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  /** Ticks once a second so elapsed time moves even between polls. */
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const [targetId, setTargetId] = useState("");
  const [title, setTitle] = useState("Look up a member's savings balance");
  const [description, setDescription] = useState(
    "Signs in, finds a member by ID, opens the record and reads the savings balance.",
  );
  const [goal, setGoal] = useState(
    "look up the member whose ID is {{memberId}}, open their record, and read their savings balance and name.",
  );
  const [values, setValues] = useState<Record<string, string>>({
    memberId: "100001",
  });
  const [idOverride, setIdOverride] = useState("");

  useEffect(() => {
    authoring
      .info()
      .then((i) => {
        setInfo(i);
        setTargetId((t) => t || (i.targets[0]?.id ?? ""));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(() => {
      authoring
        .job(job.id)
        .then((j) => {
          setJob(j);
          if (j.status === "succeeded")
            toast(`Learned ${j.capabilityId}`, "ok");
          if (j.status === "failed")
            toast(`Could not finish: ${j.error?.slice(0, 80)}`, "danger");
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(t);
  }, [job, toast]);

  /** The values the goal references. Rows appear and disappear as it is edited. */
  const params = useMemo(() => parseParameters(goal), [goal]);
  const capabilityId = idOverride.trim() || deriveCapabilityId(title);
  const target = info?.targets.find((t) => t.id === targetId);

  const missing = params.filter((p) => !(values[p] ?? "").trim());
  const ready = Boolean(
    target &&
    title.trim() &&
    goal.trim() &&
    capabilityId &&
    missing.length === 0,
  );

  const start = async () => {
    if (!target) return;
    setBusy(true);
    setErr(null);
    try {
      setJob(
        await authoring.start({
          goal: GOAL_PREFIX + goal.trim(),
          entryPoint: target.entryPoint,
          capabilityId,
          title: title.trim(),
          description: description.trim() || title.trim(),
          parameters: params.map((name) => ({
            name,
            value: values[name] ?? "",
          })),
        }),
      );
      toast("The agent is working through your task", "info");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

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
        lede="Describe a task in your own words. The agent works through it once in the real application, and what it learns is saved so it can be repeated without the agent."
      />

      {info && !info.configured && (
        <div className="rule mb-4 border-warn bg-warn-pale p-3 text-sm text-warn">
          <p className="label-caps">Not available right now</p>
          <p className="mt-1">
            No language model is configured on this server, so new capabilities
            cannot be learned. Existing ones still run — replaying never uses a
            model.
          </p>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="1 · Which application">
            <label className="flex flex-col gap-1">
              <span className="label-caps text-ink-faint">Institution</span>
              <div className="rule flex items-center gap-2 bg-paper-sunk px-2">
                <Building2 className="size-4 shrink-0 text-ink-faint" />
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  aria-label="Institution"
                  className="w-full min-w-0 bg-transparent py-1.5 text-sm outline-none"
                >
                  {(info?.targets ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {target && (
                <span className="text-xs text-ink-faint">
                  Signing in as the configured teller.
                </span>
              )}
            </label>
          </Card>

          <Card title="2 · What should it do">
            <GoalEditor
              value={goal}
              onChange={setGoal}
              references={buildReferences(goal)}
            />
          </Card>

          <Card title="3 · An example for each value">
            {params.length === 0 ? (
              <p className="text-xs text-ink-faint">
                Your task does not reference any values yet. If it should work
                for a different member or account each time, mention one above
                using <Mono>{"{{ }}"}</Mono>.
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-ink-dim">
                  Used for this run only. The saved capability keeps the
                  placeholder, so the caller supplies a real value each time.
                </p>
                <div className="flex flex-col gap-2">
                  {params.map((name) => (
                    <label
                      key={name}
                      className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="label-caps shrink-0 text-ink-faint sm:w-40">
                        <Mono>{`{{${name}}}`}</Mono>
                      </span>
                      <input
                        value={values[name] ?? ""}
                        onChange={(e) =>
                          setValues({ ...values, [name]: e.target.value })
                        }
                        placeholder={`example ${name}`}
                        aria-label={`Example value for ${name}`}
                        className="rule min-w-0 flex-1 bg-paper-sunk px-2 py-1.5 font-mono text-sm outline-none focus:bg-paper-raised"
                      />
                    </label>
                  ))}
                </div>
                {missing.length > 0 && (
                  <p className="mt-2 text-xs text-warn">
                    Needs an example for{" "}
                    {missing.map((m) => `{{${m}}}`).join(", ")}.
                  </p>
                )}
              </>
            )}
          </Card>

          <Card title="4 · Name it">
            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="label-caps text-ink-faint">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Title"
                  className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm outline-none focus:bg-paper-raised"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="label-caps text-ink-faint">Description</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-label="Description"
                  className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm outline-none focus:bg-paper-raised"
                />
                <span className="text-xs text-ink-faint">
                  What a calling agent reads when deciding whether to use this.
                </span>
              </label>

              <button
                type="button"
                onClick={() => setAdvanced((a) => !a)}
                className="label-caps flex items-center gap-1 self-start text-ink-faint hover:text-blue"
              >
                <ChevronDown
                  className={advanced ? "size-3.5 rotate-180" : "size-3.5"}
                />
                Advanced
              </button>
              {advanced && (
                <label className="flex flex-col gap-1">
                  <span className="label-caps text-ink-faint">Identifier</span>
                  <input
                    value={idOverride}
                    onChange={(e) => setIdOverride(e.target.value)}
                    placeholder={deriveCapabilityId(title)}
                    aria-label="Identifier"
                    className="rule min-w-0 bg-paper-sunk px-2 py-1.5 font-mono text-sm outline-none focus:bg-paper-raised"
                  />
                  <span className="text-xs text-ink-faint">
                    Derived from the title unless you set one. Lowercase,
                    dotted.
                  </span>
                </label>
              )}
              {!advanced && (
                <p className="text-xs text-ink-faint">
                  Saved as <Mono>{capabilityId || "—"}</Mono>
                </p>
              )}
            </div>
          </Card>

          {REPETITION_HINTS.test(goal) && (
            <div className="rule border-warn bg-warn-pale p-3 text-xs text-ink">
              <Info className="mr-1 inline size-3.5" />
              This reads like it should be repeated for several records
              (&ldquo;all&rdquo;, &ldquo;each&rdquo;, &ldquo;every&rdquo;). A
              capability is a fixed list of steps, so it will be learned once,
              for one record. Describe the task for a single record and let the
              caller run it once per record.
            </div>
          )}

          {err && <ErrorState error={err} />}

          <div>
            <Button
              variant="primary"
              onClick={start}
              disabled={
                busy ||
                !ready ||
                job?.status === "running" ||
                info?.configured === false
              }
            >
              <Sparkles className="size-4" />
              {job?.status === "running"
                ? "Working…"
                : busy
                  ? "Starting…"
                  : "Start learning"}
            </Button>
            <p className="mt-2 text-xs text-ink-faint">
              Usually 20&ndash;60 seconds. Every action is checked against the
              safety rules first, and the agent is never shown a password.
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Progress">
            {!job ? (
              <EmptyState
                title="Nothing running"
                detail="Describe a task and start learning."
              />
            ) : (
              <dl className="flex flex-col gap-1.5 text-sm">
                <Row k="Status">
                  <StatusBadge
                    status={
                      job.status === "succeeded"
                        ? "success"
                        : job.status === "failed"
                          ? "failed"
                          : "running"
                    }
                  />
                </Row>
                {job.status === "running" && (
                  <>
                    <Row k="Working on">
                      <Mono>
                        step {job.step ?? 1}
                        {job.maxSteps ? ` of ${job.maxSteps}` : ""}
                      </Mono>
                    </Row>
                    <Row k="Elapsed">
                      <Mono>
                        {elapsed(now - Date.parse(job.startedAt))}
                        {job.deadline
                          ? ` / ${elapsed(job.deadline - Date.parse(job.startedAt))} budget`
                          : ""}
                      </Mono>
                    </Row>
                    {job.lastAction && (
                      <div className="rule mt-1 border-blue bg-blue-pale p-2 text-xs break-words text-ink">
                        <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                        {job.lastAction}
                      </div>
                    )}
                  </>
                )}
                {job.steps !== undefined && (
                  <Row k="Steps learned">
                    <Mono>{job.steps}</Mono>
                  </Row>
                )}
                {job.modelCalls !== undefined && (
                  <Row k="Model calls">
                    <Mono>{job.modelCalls}</Mono>
                  </Row>
                )}
                {job.runId && (
                  <Row k="Evidence">
                    <Link
                      to={`/runs/${job.runId}`}
                      className="text-blue hover:underline"
                    >
                      <Mono>see what it did</Mono>
                    </Link>
                  </Row>
                )}
                {job.error && (
                  <div className="rule mt-1 border-danger bg-danger-pale p-2 text-xs break-words text-danger">
                    <AlertTriangle className="mr-1 inline size-3.5" />
                    {job.error}
                  </div>
                )}
                {job.status === "running" && (
                  <Button
                    variant="ghost"
                    className="mt-2"
                    onClick={async () => {
                      try {
                        await authoring.cancel(job.id);
                        toast("Stopping the run", "info");
                      } catch (e) {
                        toast(String(e), "danger");
                      }
                    }}
                  >
                    <Square className="size-4" />
                    Stop it
                  </Button>
                )}
                {job.status === "succeeded" && job.capabilityId && (
                  <Button
                    variant="primary"
                    className="mt-2"
                    onClick={() =>
                      nav(`/capabilities/${job.capabilityId}@${job.version}`)
                    }
                  >
                    Review it
                  </Button>
                )}
              </dl>
            )}
          </Card>

          <Card title="What happens next">
            <ol className="flex flex-col gap-2 text-xs text-ink-dim">
              <li>
                <strong className="text-ink">1.</strong> The agent works through
                your task in the real application, one step at a time.
              </li>
              <li>
                <strong className="text-ink">2.</strong> What it did is saved as
                a <Badge tone="warn">draft</Badge> — repeatable, but not yet
                trusted to run on its own.
              </li>
              <li>
                <strong className="text-ink">3.</strong> You review it and add
                what should happen when things go wrong, then approve it. One
                successful run cannot know what the error cases look like.
              </li>
            </ol>
          </Card>

          {info?.jobs.length ? (
            <Card title="Recent">
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
                      {j.capabilityId ?? j.goal.slice(0, 26)}
                    </Mono>
                    <span className="ml-auto text-ink-faint">
                      {formatRelative(j.startedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
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
