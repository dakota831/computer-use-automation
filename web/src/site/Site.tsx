import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bot,
  FileCode2,
  RefreshCw,
  ShieldCheck,
  UserCog,
  Building2,
  Terminal,
} from "lucide-react";
import { Header, Footer, CopyButton } from "../shared/Chrome.tsx";
import { Badge, Card, Mono } from "../shared/ui.tsx";

/**
 * dexdash.cloud — the front door.
 *
 * Its job is to make the through-line legible in about thirty seconds, then send
 * the reader to whichever of the three interfaces they actually want. Everything
 * it claims is something you can click through and verify, which is why the
 * status strip is live rather than a static badge.
 */

type Status = {
  ok: boolean;
  capabilities: number;
  interventions: number;
} | null;

const NAV = [
  { label: "How it works", href: "#how" },
  { label: "Interfaces", href: "#interfaces" },
  { label: "Safety", href: "#safety" },
  {
    label: "Source",
    href: "https://github.com/dakota831/computer-use-automation",
    external: true,
  },
];

export default function Site() {
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <Header sub="Automation Platform" nav={NAV} homeHref="/" />

      {/* Status strip: proof of life, not decoration. */}
      <div className="rule-b bg-paper-sunk">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-1 px-3 py-1.5 text-xs sm:px-5">
          <span className="flex items-center gap-1.5">
            <span
              className={`size-2 ${status?.ok ? "bg-ok" : "bg-ink-faint"}`}
              aria-hidden
            />
            <span className="label-caps">
              {status?.ok ? "Systems nominal" : "Status unknown"}
            </span>
          </span>
          {status && (
            <>
              <span className="text-ink-dim">
                <Mono>{status.capabilities}</Mono> capabilities registered
              </span>
              <span className="text-ink-dim">
                <Mono>{status.interventions}</Mono> open interventions
              </span>
            </>
          )}
          <span className="ml-auto hidden text-ink-faint sm:inline">
            Demo environment · synthetic data
          </span>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-5">
        {/* ---------------------------------------------------------- hero */}
        <section className="grid gap-8 py-10 lg:grid-cols-[1.15fr_1fr] lg:py-14">
          <div>
            <Badge tone="info">Back-office integration layer</Badge>
            <h1 className="mt-4 text-3xl leading-[1.1] font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Give an AI agent hands inside software that has no API.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-dim">
              Banks and credit unions run a long tail of core systems, servicing
              tools and admin consoles where the only way in is to drive the
              screen the way a human operator would. DexDash uses a model to
              work out how to do a task <em>once</em>, records what it learned
              as a reviewable capability, and then replays that capability
              deterministically — no model, no re-reasoning, same steps every
              time.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="https://teller.dexdash.cloud"
                className="press rule inline-flex items-center gap-2 bg-blue px-4 py-2.5 text-sm font-medium text-white no-underline shadow-hard"
              >
                Open the demo application <ArrowRight className="size-4" />
              </a>
              <a
                href="https://console.dexdash.cloud"
                className="press rule inline-flex items-center gap-2 bg-paper-raised px-4 py-2.5 text-sm font-medium no-underline shadow-hard"
              >
                Operator console
              </a>
            </div>

            <p className="mt-3 text-xs text-ink-faint">
              Console and API sign-in: <Mono>admin</Mono> / <Mono>admin</Mono>
              <CopyButton
                value="admin"
                label="username"
                className="ml-2 align-middle"
              />
            </p>
          </div>

          <ThroughLine />
        </section>

        {/* ------------------------------------------------------ interfaces */}
        <section id="interfaces" className="scroll-mt-20 py-8">
          <SectionHead
            eyebrow="Three interfaces"
            title="The surfaces, and who each one is for"
            lede="The system is deliberately split by audience: the application an agent drives, the console a human rescues it from, and the API another agent calls."
          />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <InterfaceCard
              icon={<Building2 className="size-5" />}
              name="CoreLink Teller"
              href="https://teller.dexdash.cloud"
              audience="The target application"
              body="A synthetic credit-union back-office console. Frameset shell, table layout, generated control names, no test IDs — and login fields with no accessible name at all."
              note="Deliberately ugly. It is the thing being automated, and it has to be hard."
              meta="teller.dexdash.cloud · open"
            />
            <InterfaceCard
              icon={<UserCog className="size-5" />}
              name="Operator Console"
              href="https://console.dexdash.cloud"
              audience="For a human operator"
              body="Escalation queue, live session takeover over a screencast, capability catalog, and a browsable evidence trail for every run."
              note="Authenticated: it can take control of a live browser session."
              meta="console.dexdash.cloud · admin / admin"
            />
            <InterfaceCard
              icon={<Terminal className="size-5" />}
              name="Capability API"
              href="https://api.dexdash.cloud/api/capabilities"
              audience="For a calling agent"
              body="Saved capabilities as callable tools with generated JSON Schema, invoked by name with typed arguments and returning a structured result."
              note="Only approved capabilities are offered for unattended invocation."
              meta="api.dexdash.cloud · admin / admin"
            />
          </div>
        </section>

        {/* -------------------------------------------------------- how */}
        <section id="how" className="scroll-mt-20 py-8">
          <SectionHead
            eyebrow="How it works"
            title="Discover once. Replay forever."
            lede="The expensive, uncertain part happens exactly one time and is turned into something a human can review and a machine can repeat."
          />
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <Step
              n="01"
              icon={<Bot className="size-5" />}
              title="The model discovers"
              body="An LLM drives the real UI — observing the accessibility tree, deciding, acting — until the goal is met or a stopping condition is hit. It never sees a credential: it emits a secret reference and the executor substitutes the value at the moment of typing."
            />
            <Step
              n="02"
              icon={<FileCode2 className="size-5" />}
              title="The run becomes a capability"
              body="A typed, versioned artifact: ordered steps, ranked strategies for finding each control, typed inputs and outputs, checkpoints, and a declared table of business outcomes. Reviewable by a person, callable by an agent."
            />
            <Step
              n="03"
              icon={<RefreshCw className="size-5" />}
              title="Replay is deterministic"
              body="Production runs the artifact with no model in the decision loop. It verifies every checkpoint, distinguishes a legitimate business answer from a recoverable hiccup from a real failure, and escalates to a human when it cannot safely continue."
            />
          </div>
        </section>

        {/* ---------------------------------------------------- distinction */}
        <section className="py-8">
          <Card title="The distinction the whole system is built around">
            <p className="max-w-3xl text-sm text-ink-dim">
              &ldquo;No such member&rdquo; is a correct answer, not a crash.
              Conflating the two is the most common way systems like this go
              wrong, so the result contract makes it structurally impossible — a
              business outcome is not an error type and cannot be thrown.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Outcome
                tone="ok"
                label="Success"
                body="The goal was reached and the declared outputs were extracted and type-coerced."
                example='{"savingsBalance": 8214.55}'
              />
              <Outcome
                tone="warn"
                label="Business outcome"
                body="The application answered correctly and the caller needs that answer. Exits zero."
                example="MEMBER_NOT_FOUND"
              />
              <Outcome
                tone="danger"
                label="Failure"
                body="Something genuinely broke. Reports which step, what was expected, what was observed."
                example="APP_ERROR @s5_search"
              />
            </div>
          </Card>
        </section>

        {/* -------------------------------------------------------- safety */}
        <section id="safety" className="scroll-mt-20 py-8 pb-14">
          <SectionHead
            eyebrow="Safety"
            title="What the agent is not allowed to do"
          />
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card title="Guardrails">
              <ul className="flex flex-col gap-2.5 text-sm text-ink-dim">
                <Bullet>
                  An allowlist is enforced before <em>every</em> action, and
                  again at the network layer — so even a page-initiated redirect
                  cannot carry the session off-list.
                </Bullet>
                <Bullet>
                  Risk is classified when the capability is recorded, not
                  guessed at runtime. Replay can only execute steps that were
                  recorded and approved earlier.
                </Bullet>
                <Bullet>
                  Irreversible steps stop and ask a human every time, even on an
                  approved capability that has run unattended for eight steps.
                </Bullet>
                <Bullet>
                  Redaction happens on the write path, inside the logger —
                  because the call site that forgets is the expected case.
                </Bullet>
              </ul>
            </Card>
            <Card title="Human in the loop">
              <ul className="flex flex-col gap-2.5 text-sm text-ink-dim">
                <Bullet>
                  Exactly one party holds the control lease. When a person takes
                  over, automation <em>parks</em> — it does not die, because the
                  session has to survive the handoff.
                </Bullet>
                <Bullet>
                  The operator drives the same live browser session over a
                  screencast, through the same input path the automation uses.
                </Bullet>
                <Bullet>
                  Both sides are gated server-side. Input sent before taking
                  control is refused by the server, not merely greyed out in the
                  UI.
                </Bullet>
                <Bullet>
                  Approving a step and performing it yourself are recorded as
                  different things, because an audit trail needs to tell them
                  apart.
                </Bullet>
              </ul>
            </Card>
          </div>
        </section>
      </main>

      <Footer
        current="site"
        note={
          <span>
            Build: demo environment · <Mono>synthetic</Mono>
          </span>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function ThroughLine() {
  const rows = [
    {
      k: "Goal",
      v: "Look up member 100001 and read their savings balance",
      tone: "text-ink",
    },
    {
      k: "Discovery",
      v: "10 model calls · 15s · 7 steps recorded",
      tone: "text-blue",
    },
    {
      k: "Artifact",
      v: "cu.member.lookup_savings@1.0.0 (draft)",
      tone: "font-mono text-xs",
    },
    {
      k: "Replay",
      v: "2.9s · no model · savingsBalance = 8214.55",
      tone: "text-ok",
    },
  ];
  return (
    <Card title="One capability, end to end" className="self-start">
      <ol className="flex flex-col">
        {rows.map((r, i) => (
          <li
            key={r.k}
            className="grid grid-cols-[auto_1fr] gap-3 border-b border-rule-soft py-2.5 last:border-0"
          >
            <span className="label-caps w-20 pt-0.5 text-ink-faint">
              {String(i + 1).padStart(2, "0")} {r.k}
            </span>
            <span className={`text-sm break-words ${r.tone}`}>{r.v}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t-2 border-rule pt-3 text-xs text-ink-faint">
        The artifact stays a <strong>draft</strong> until a human reviews it:
        one happy-path run cannot know what the error states look like.
      </p>
    </Card>
  );
}

function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="label-caps text-blue">{eyebrow}</p>
      <h2 className="mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lede && (
        <p className="mt-2 text-sm leading-relaxed text-ink-dim">{lede}</p>
      )}
    </div>
  );
}

function InterfaceCard(p: {
  icon: React.ReactNode;
  name: string;
  href: string;
  audience: string;
  body: string;
  note: string;
  meta: string;
}) {
  return (
    <a
      href={p.href}
      className="press rule group flex flex-col bg-paper-raised no-underline shadow-hard hover:shadow-hard-lg"
    >
      <div className="rule-b flex items-center gap-2 bg-navy px-3 py-2 text-white">
        {p.icon}
        <span className="font-bold">{p.name}</span>
        <ArrowRight className="ml-auto size-4 opacity-60 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="label-caps text-blue">{p.audience}</p>
        <p className="text-sm text-ink-dim">{p.body}</p>
        <p className="mt-auto border-t border-rule-soft pt-2 text-xs text-ink-faint italic">
          {p.note}
        </p>
        <p className="font-mono text-[0.6875rem] text-ink-faint">{p.meta}</p>
      </div>
    </a>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rule flex flex-col bg-paper-raised shadow-hard">
      <div className="rule-b flex items-center gap-2 bg-paper-sunk px-3 py-2">
        <span className="font-mono text-lg font-bold text-blue">{n}</span>
        {icon}
        <span className="font-bold">{title}</span>
      </div>
      <p className="p-3 text-sm text-ink-dim">{body}</p>
    </div>
  );
}

function Outcome({
  tone,
  label,
  body,
  example,
}: {
  tone: "ok" | "warn" | "danger";
  label: string;
  body: string;
  example: string;
}) {
  const bar =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-danger";
  return (
    <div className="rule flex gap-0 bg-paper-raised">
      <div className={`w-1.5 shrink-0 ${bar}`} aria-hidden />
      <div className="p-3">
        <p className="label-caps">{label}</p>
        <p className="mt-1 text-xs text-ink-dim">{body}</p>
        <p className="mt-2 font-mono text-[0.6875rem] break-all text-ink-faint">
          {example}
        </p>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-blue" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
