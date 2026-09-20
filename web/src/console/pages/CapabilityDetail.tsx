import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Play,
  ShieldAlert,
  Terminal,
  Pencil,
  CheckCircle2,
  GitCompare,
  Save,
  X,
  AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { evidence, authoring, type CapabilityDoc } from "../lib/api.ts";
import {
  Card,
  StatusBadge,
  Badge,
  Field,
  Mono,
  Skeleton,
  ErrorState,
  Button,
  TableWrap,
  Th,
  Td,
} from "../../shared/ui.tsx";
import { CopyButton } from "../../shared/Chrome.tsx";
import { useToast } from "../../shared/Toast.tsx";
import { Crumbs, PageHead } from "../App.tsx";
import { CapabilityEditor, isSignInStep } from "../CapabilityEditor.tsx";

/**
 * Capability detail: the contract, made readable.
 *
 * This is the review surface. Someone deciding whether to move a capability from
 * draft to approved needs to see the ranked targeting strategies and the outcome
 * table, not just the step list — those are the two things that determine whether
 * replay will behave sensibly when the application does something unexpected.
 */
export function CapabilityDetail() {
  const { ref = "" } = useParams();
  const toast = useToast();
  const [doc, setDoc] = useState<CapabilityDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftJson, setDraftJson] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    evidence
      .capability(ref)
      .then((d) => {
        setDoc(d);
        setDraftJson(JSON.stringify(d, null, 2));
      })
      .catch((e) => setError(String(e)));

  useEffect(() => {
    void load();
  }, [ref]);

  /**
   * The review gate, as one click. A draft a human has read and added an
   * outcome table to becomes approved; an approved capability can be pulled
   * back to draft, which immediately stops it running unattended.
   */
  const toggleApproval = async (d: CapabilityDoc) => {
    const next = d.status === "approved" ? "draft" : "approved";
    try {
      await authoring.setStatus(`${d.id}@${d.version}`, next);
      toast(
        next === "approved"
          ? "Approved for unattended replay"
          : "Returned to draft",
        next === "approved" ? "ok" : "warn",
      );
      await load();
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e), "danger");
    }
  };

  /** Save a document the visual editor assembled. */
  const saveDoc = async (next: CapabilityDoc) => {
    setSaving(true);
    setSaveError(null);
    try {
      const r = await authoring.save(`${next.id}@${next.version}`, next);
      toast(`Saved ${r.id}@${r.version}`, "ok");
      setEditing(false);
      await load();
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const parsed = JSON.parse(draftJson);
      const r = await authoring.save(`${parsed.id}@${parsed.version}`, parsed);
      toast(`Saved ${r.id}@${r.version}`, "ok");
      setEditing(false);
      await load();
    } catch (e) {
      // Server-side Zod validation surfaces here, so an artifact the replay
      // engine would reject cannot be written in the first place.
      setSaveError(String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorState error={error} />;
  if (!doc) return <Skeleton rows={6} />;

  const risky = doc.steps.filter((s) => s.riskClass !== "safe");
  const allOutcomes = [
    ...doc.steps.flatMap((s) => s.outcomes),
    ...doc.outcomes,
  ];

  return (
    <>
      <Crumbs
        trail={[
          { label: "Capabilities", to: "/capabilities" },
          { label: doc.id },
        ]}
      />
      <PageHead
        title={doc.title}
        lede={doc.description}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={doc.status} />
            <Link
              to={`/capabilities/compare?a=${ref}`}
              className="no-underline"
            >
              <Button size="sm" title="Compare with another capability">
                <GitCompare className="size-4" /> Compare
              </Button>
            </Link>
            <Button size="sm" onClick={() => setEditing((e) => !e)}>
              {editing ? (
                <X className="size-4" />
              ) : (
                <Pencil className="size-4" />
              )}
              {editing ? "Cancel" : "Edit"}
            </Button>
            <Button
              size="sm"
              variant={doc.status === "approved" ? "default" : "primary"}
              onClick={() => toggleApproval(doc)}
              title={
                doc.status === "approved"
                  ? "Return to draft"
                  : "Approve for unattended replay"
              }
            >
              <CheckCircle2 className="size-4" />
              {doc.status === "approved" ? "Return to draft" : "Approve"}
            </Button>
          </div>
        }
      />

      {editing && (
        <div className="mb-4">
          <CapabilityEditor
            doc={doc}
            saving={saving}
            error={saveError}
            onSave={(next) => saveDoc(next)}
          />
          <details className="mt-3">
            <summary className="label-caps cursor-pointer text-ink-faint hover:text-blue">
              Advanced — edit the raw document
            </summary>
            <p className="mt-2 mb-1 text-xs text-ink-dim">
              Validated against the same schema the replay engine parses with,
              so anything saved here is executable. Change <Mono>version</Mono>{" "}
              to write a new capability instead of replacing this one.
            </p>
            <textarea
              value={draftJson}
              onChange={(e) => setDraftJson(e.target.value)}
              spellCheck={false}
              rows={20}
              aria-label="Capability JSON"
              className="rule w-full min-w-0 bg-paper-sunk p-2 font-mono text-[0.6875rem] leading-relaxed outline-none focus:bg-paper-raised"
            />
            <Button size="sm" className="mt-2" onClick={save} disabled={saving}>
              <Save className="size-4" /> Save raw document
            </Button>
          </details>
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Steps">
            <ol className="flex flex-col">
              {doc.steps
                .filter((_, i) => !isSignInStep(doc, i))
                .map((s, i) => (
                  <li
                    key={s.id}
                    className="border-b border-rule-soft py-3 last:border-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink-faint">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <Mono className="text-blue">{s.id}</Mono>
                      <Badge
                        tone={
                          s.riskClass === "irreversible"
                            ? "danger"
                            : s.riskClass === "risky"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {s.riskClass}
                      </Badge>
                      <Badge>{s.action.type}</Badge>
                    </div>
                    <p className="mt-1.5 text-sm">{s.intent}</p>

                    {s.reviewNote && (
                      // The reason this draft should not be approved as it
                      // stands. Loud on purpose: it replays cleanly and does
                      // the wrong thing, so nothing downstream will catch it.
                      <div className="rule mt-2 border-warn bg-warn-pale p-2 text-xs break-words text-ink">
                        <AlertTriangle className="mr-1 inline size-3.5" />
                        <strong>Needs a look.</strong> {s.reviewNote}
                      </div>
                    )}

                    {s.action.value && (
                      <p className="mt-1">
                        <Mono className="text-ink-dim">
                          value: {s.action.value}
                        </Mono>
                      </p>
                    )}

                    {s.action.target && (
                      <details className="mt-2">
                        <summary className="label-caps cursor-pointer text-ink-faint hover:text-blue">
                          targeting · {s.action.target.strategies.length} ranked
                          strategies
                        </summary>
                        <ol className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-rule-soft pl-3">
                          {s.action.target.strategies.map((st, n) => (
                            <li key={n} className="text-xs">
                              <span className="flex flex-wrap items-center gap-2">
                                <Badge
                                  tone={
                                    st.confidence >= 0.85
                                      ? "ok"
                                      : st.confidence >= 0.6
                                        ? "warn"
                                        : "danger"
                                  }
                                >
                                  {st.confidence.toFixed(2)}
                                </Badge>
                                <Mono>{String((st.strategy as any).kind)}</Mono>
                              </span>
                              <p className="mt-0.5 text-ink-dim">
                                {st.rationale}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {s.checkpoint && (
                      <p className="mt-1.5 text-xs text-ink-dim">
                        <span className="label-caps text-ink-faint">
                          checkpoint{" "}
                        </span>
                        {s.checkpoint.describedAs}
                      </p>
                    )}
                  </li>
                ))}
            </ol>
          </Card>

          <Card title={`Declared outcomes (${allOutcomes.length})`}>
            {allOutcomes.length === 0 ? (
              <div className="rule border-warn bg-warn-pale p-3 text-sm">
                <p className="label-caps text-warn">No outcomes declared</p>
                <p className="mt-1 text-ink-dim">
                  This capability came straight from a discovery run. One
                  happy-path run cannot know what the error states look like, so
                  the outcome table is authored during review — which is why it
                  is still a draft.
                </p>
              </div>
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Disposition</Th>
                    <Th>Detected when</Th>
                  </tr>
                </thead>
                <tbody>
                  {allOutcomes.map((o) => (
                    <tr key={o.code}>
                      <Td>
                        <Mono className="font-semibold">{o.code}</Mono>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            o.disposition === "business_outcome"
                              ? "warn"
                              : o.disposition === "recover"
                                ? "info"
                                : o.disposition === "escalate"
                                  ? "live"
                                  : "danger"
                          }
                        >
                          {o.disposition.replace(/_/g, " ")}
                        </Badge>
                      </Td>
                      <Td className="text-ink-dim">{o.describedAs}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <InvokePanel doc={doc} />

          <Card title="Contract">
            <dl>
              <Field label="Identifier" mono>
                {doc.id}@{doc.version}{" "}
                <CopyButton
                  value={`${doc.id}@${doc.version}`}
                  label="identifier"
                  className="ml-1 align-middle"
                />
              </Field>
              <Field label="Vendor app" mono>
                {doc.surface.appProfile.vendorApp}{" "}
                {doc.surface.appProfile.versionRange}
              </Field>
              <Field label="Tenant" mono>
                {doc.tenant}
              </Field>
              <Field label="Entry point" mono>
                {doc.surface.entryPoint}
              </Field>
              <Field label="Success when">
                {doc.successCondition.describedAs}
              </Field>
            </dl>
          </Card>

          <Card title="Inputs & outputs">
            <p className="label-caps mb-1 text-ink-faint">Inputs</p>
            <ul className="mb-3 flex flex-col gap-1.5">
              {doc.inputs.map((i) => (
                <li key={i.name} className="text-xs">
                  <Mono className="font-semibold">{i.name}</Mono>
                  <Mono className="text-ink-faint">
                    {" "}
                    : {i.type}
                    {i.required ? "" : "?"}
                  </Mono>
                  <Badge
                    tone={
                      i.sensitivity === "pii" || i.sensitivity === "secret"
                        ? "danger"
                        : "neutral"
                    }
                    className="ml-1.5"
                  >
                    {i.sensitivity}
                  </Badge>
                  <p className="mt-0.5 text-ink-dim">{i.description}</p>
                </li>
              ))}
              {!doc.inputs.length && (
                <li className="text-xs text-ink-faint">none</li>
              )}
            </ul>
            <p className="label-caps mb-1 text-ink-faint">Outputs</p>
            <ul className="flex flex-col gap-1.5">
              {doc.outputs.map((o) => (
                <li key={o.name} className="text-xs">
                  <Mono className="font-semibold">{o.name}</Mono>
                  <Mono className="text-ink-faint"> : {o.type}</Mono>
                  <Badge
                    tone={o.sensitivity === "pii" ? "danger" : "neutral"}
                    className="ml-1.5"
                  >
                    {o.sensitivity}
                  </Badge>
                  <p className="mt-0.5 text-ink-dim">{o.description}</p>
                </li>
              ))}
              {!doc.outputs.length && (
                <li className="text-xs text-ink-faint">none</li>
              )}
            </ul>
          </Card>

          <Card title="Policy">
            <dl>
              <Field label="Allowed origins" mono>
                {doc.policy.allowedOrigins.join("\n")}
              </Field>
              <Field label="Allowed actions" mono>
                {doc.policy.allowedActions.join(", ")}
              </Field>
              <Field label="Human confirms at">
                <Badge tone="danger">{doc.policy.confirmAtOrAbove}</Badge>
                {risky.length > 0 && (
                  <span className="ml-2 text-xs text-ink-dim">
                    {risky.length} step(s) affected
                  </span>
                )}
              </Field>
            </dl>
          </Card>

          <Card title="Provenance">
            <dl>
              <Field label="Discovered by" mono>
                {doc.provenance.discoveredBy.provider} /{" "}
                {doc.provenance.discoveredBy.model}
              </Field>
              <Field label="Run" mono>
                {doc.provenance.runId}
              </Field>
              <Field label="Created" mono>
                {doc.provenance.createdAt}
              </Field>
              <Field label="Transcript sha256" mono>
                {doc.provenance.transcriptSha256.slice(0, 24) || "—"}
              </Field>
            </dl>
            <p className="mt-2 border-t border-rule-soft pt-2 text-xs text-ink-faint">
              The transcript itself is evidence, not part of the contract: it is
              large and contains unredacted screen text, so only its hash is
              recorded here.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Invoke form, generated from the declared input schema. */
function InvokePanel({ doc }: { doc: CapabilityDoc }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(doc.inputs.map((i) => [i.name, i.example ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [confirming, setConfirming] = useState(false);

  const hasIrreversible = doc.steps.some((s) => s.riskClass === "irreversible");

  const run = async () => {
    setBusy(true);
    setResult(null);
    setConfirming(false);
    try {
      const r = await evidence.invoke(
        `${doc.id}@${doc.version}`,
        values,
        doc.status !== "approved",
      );
      setResult(r);
      const status = String(r.status);
      toast(
        `Invocation finished: ${status}`,
        status === "success" ? "ok" : status === "outcome" ? "warn" : "danger",
      );
    } catch (e) {
      toast(String(e), "danger");
    } finally {
      setBusy(false);
    }
  };

  const curl = `curl -u admin:admin -X POST https://api.dexdash.cloud/api/capabilities/${doc.id}/invoke \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ inputs: values })}'`;

  return (
    <Card
      title="Invoke"
      aside={<CopyButton value={curl} label="curl command" />}
    >
      <div className="flex flex-col gap-2.5">
        {doc.inputs.map((i) => (
          <label key={i.name} className="flex flex-col gap-1">
            <span className="label-caps text-ink-faint">
              {i.name}
              {i.required && <span className="text-danger"> *</span>}
            </span>
            <input
              value={values[i.name] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [i.name]: e.target.value })
              }
              placeholder={i.example ?? i.type}
              pattern={i.pattern}
              className="rule bg-paper-sunk px-2 py-1.5 font-mono text-sm outline-none focus:bg-paper-raised"
            />
          </label>
        ))}

        {hasIrreversible && (
          <p className="rule flex items-start gap-2 border-warn bg-warn-pale p-2 text-xs text-warn">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            This capability contains an irreversible step. Replay will pause and
            raise an intervention before it runs.
          </p>
        )}

        {!confirming ? (
          <Button
            variant="primary"
            onClick={() => (hasIrreversible ? setConfirming(true) : run())}
            disabled={busy}
          >
            <Play className="size-4" /> {busy ? "Running…" : "Invoke"}
          </Button>
        ) : (
          <div className="rule border-danger bg-danger-pale p-2">
            <p className="text-xs text-danger">
              This will act on the live application. Continue?
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" size="sm" onClick={run}>
                Yes, invoke
              </Button>
              <Button size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {result && (
          <pre className="rule max-h-64 min-w-0 max-w-full overflow-auto bg-paper-sunk p-2 font-mono text-[0.6875rem] leading-relaxed">
            {JSON.stringify(result, null, 2)}
          </pre>
        )}

        <details className="text-xs">
          <summary className="label-caps cursor-pointer text-ink-faint hover:text-blue">
            <Terminal className="mr-1 inline size-3.5" /> call it from a shell
          </summary>
          <pre className="rule mt-1.5 min-w-0 max-w-full overflow-auto bg-paper-sunk p-2 font-mono text-[0.625rem]">
            {curl}
          </pre>
        </details>
      </div>
    </Card>
  );
}
