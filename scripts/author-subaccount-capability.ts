import { writeFileSync, mkdirSync } from "node:fs";
import { Capability, SCHEMA_VERSION } from "../src/core/artifact.js";
import type { TargetDescriptor } from "../src/core/targeting.js";

/**
 * A capability with a genuinely irreversible step, so the escalation path is
 * exercised by something real rather than a simulated trigger.
 *
 * Opening a sub-account creates a record. Under the default policy
 * (`confirmAtOrAbove: "irreversible"`) replay will not perform that step on its
 * own authority - it stops and asks for a human, every time, even though the
 * capability is approved and every preceding step ran unattended.
 */

const APP = "http://127.0.0.1:8080";
const ENTRY = `${APP}/t/firstcu`;

const beside = (
  labelText: string,
  controlRole: string,
  describedAs: string,
  alts: string[] = [],
): TargetDescriptor => ({
  describedAs,
  framePath: [{ name: "mainFrame" }],
  ambiguityPolicy: "fail",
  strategies: [
    {
      strategy: {
        kind: "label_proximity",
        labelText,
        labelMatch: "normalized",
        relation: "right_of",
        controlRole,
      },
      confidence: 0.9,
      rationale: `no accessible name; visible label is the cell to the left ("${labelText}")`,
    },
    ...alts.map((alt) => ({
      strategy: {
        kind: "label_proximity" as const,
        labelText: alt,
        labelMatch: "normalized" as const,
        relation: "right_of" as const,
        controlRole,
      },
      confidence: 0.7,
      rationale: `tenant variant label for "${labelText}"`,
    })),
  ],
});

const named = (
  role: string,
  name: string,
  describedAs: string,
  aliases: string[] = [],
): TargetDescriptor => ({
  describedAs,
  framePath: [{ name: "mainFrame" }],
  ambiguityPolicy: "fail",
  strategies: [
    {
      strategy: { kind: "role_name", role, name, nameMatch: "alias", aliases },
      confidence: 0.95,
      rationale: `${role} has a real accessible name; aliases cover tenant wording`,
    },
  ],
});

const capability = Capability.parse({
  schemaVersion: SCHEMA_VERSION,
  id: "cu.member.open_subaccount",
  version: "1.0.0",
  title: "Open a sub-account for a member",
  description:
    "Signs in, opens a member record, and creates a new sub-account with the supplied nickname and initial deposit. Creates a record: the final confirmation always requires a human.",
  status: "approved",
  surface: {
    kind: "web",
    entryPoint: ENTRY,
    appProfile: { vendorApp: "corelink-teller", versionRange: "8.x" },
  },
  tenant: "base",

  inputs: [
    {
      name: "memberId",
      type: "string",
      required: true,
      description: "Six-digit member number.",
      sensitivity: "pii",
      pattern: "^\\d{6}$",
      example: "100001",
    },
    {
      name: "nickname",
      type: "string",
      required: true,
      description: "Display name for the new sub-account.",
      sensitivity: "internal",
      example: "Vacation Fund",
    },
    {
      name: "initialDeposit",
      type: "number",
      required: true,
      description: "Opening deposit in USD. Must be at least 25.",
      sensitivity: "internal",
      example: "50",
    },
  ],

  outputs: [
    {
      name: "reference",
      type: "string",
      description: "Reference number of the created sub-account.",
      sensitivity: "internal",
      source: beside(
        "Reference",
        "LayoutTableCell",
        "the reference number cell",
      ),
      transform: [{ op: "trim" }],
    },
  ],

  steps: [
    {
      id: "s1_user",
      intent: "Enter the teller user ID",
      riskClass: "safe",
      action: {
        type: "type",
        target: beside("User ID", "textbox", "the User ID field"),
        value: "{{secret:corelink.username}}",
        clearFirst: true,
      },
    },
    {
      id: "s2_pass",
      intent: "Enter the teller password",
      riskClass: "safe",
      action: {
        type: "type",
        target: beside("Password", "textbox", "the Password field"),
        value: "{{secret:corelink.password}}",
        clearFirst: true,
      },
    },
    {
      id: "s3_signin",
      intent: "Sign in and reach member search",
      riskClass: "safe",
      action: {
        type: "click",
        target: named("button", "Sign In", "the Sign In button"),
      },
      checkpoint: {
        describedAs: "the member search screen is showing",
        timeoutMs: 10000,
        all: [
          { kind: "text_present", text: "Member Search", match: "normalized" },
        ],
      },
      outcomes: [
        {
          code: "ACKNOWLEDGEMENT_REQUIRED",
          describedAs:
            "an acceptable-use acknowledgement is blocking the session",
          detector: {
            kind: "text_present",
            text: "Acceptable Use Acknowledgement",
            match: "normalized",
          },
          disposition: "recover",
          recovery: {
            do: "dismiss",
            target: named(
              "button",
              "I Acknowledge",
              "the acknowledgement button",
            ),
            describedAs: "accept the acceptable-use notice",
          },
          maxAttempts: 2,
        },
      ],
    },
    {
      id: "s4_member_id",
      intent: "Type the member ID into the search field",
      riskClass: "safe",
      action: {
        type: "type",
        target: beside("Member ID", "textbox", "the Member ID field", [
          "Member Number",
        ]),
        value: "{{memberId}}",
        clearFirst: true,
      },
    },
    {
      id: "s5_search",
      intent: "Open the member record",
      riskClass: "safe",
      action: {
        type: "click",
        target: named("button", "Search", "the Search button", ["Find"]),
      },
      checkpoint: {
        describedAs: "the member detail record is showing",
        timeoutMs: 12000,
        all: [
          { kind: "text_present", text: "Member Detail", match: "normalized" },
        ],
      },
      outcomes: [
        {
          code: "MEMBER_NOT_FOUND",
          describedAs: "no member exists with the supplied ID",
          detector: {
            kind: "text_present",
            text: "No member found matching the ID supplied",
            match: "normalized",
          },
          disposition: "business_outcome",
          maxAttempts: 1,
        },
        {
          code: "PERMISSION_DENIED",
          describedAs: "this teller may not view the member record",
          detector: {
            kind: "text_present",
            text: "do not have permission to view this member record",
            match: "normalized",
          },
          disposition: "business_outcome",
          maxAttempts: 1,
        },
      ],
    },
    {
      id: "s6_open_form",
      intent: "Open the new sub-account form",
      riskClass: "safe",
      action: {
        type: "click",
        target: named("link", "Open Sub-Account", "the Open Sub-Account link", [
          "Add Sub-Account",
        ]),
      },
      checkpoint: {
        describedAs: "the sub-account form is showing",
        timeoutMs: 10000,
        all: [
          {
            kind: "text_present",
            text: "Account Nickname",
            match: "normalized",
          },
        ],
      },
    },
    {
      id: "s7_nickname",
      intent: "Enter the sub-account nickname",
      riskClass: "safe",
      action: {
        type: "type",
        target: beside(
          "Account Nickname",
          "textbox",
          "the Account Nickname field",
        ),
        value: "{{nickname}}",
        clearFirst: true,
      },
    },
    {
      id: "s8_deposit",
      intent: "Enter the initial deposit",
      riskClass: "safe",
      action: {
        type: "type",
        target: beside(
          "Initial Deposit",
          "textbox",
          "the Initial Deposit field",
        ),
        value: "{{initialDeposit}}",
        clearFirst: true,
      },
    },
    {
      id: "s9_confirm",
      intent: "Submit the form and create the sub-account",
      // The whole point. Creating an account is not undoable by clicking back.
      riskClass: "irreversible",
      action: {
        type: "click",
        target: named("button", "Confirm", "the Confirm button", ["Submit"]),
      },
      checkpoint: {
        describedAs: "the sub-account confirmation screen is showing",
        timeoutMs: 12000,
        all: [
          {
            kind: "text_present",
            text: "Sub-Account Created",
            match: "normalized",
          },
        ],
      },
      outcomes: [
        {
          code: "DEPOSIT_TOO_SMALL",
          describedAs: "the opening deposit is below the institution minimum",
          detector: {
            kind: "text_present",
            text: "Initial deposit must be at least",
            match: "normalized",
          },
          disposition: "business_outcome",
          maxAttempts: 1,
        },
      ],
    },
  ],

  successCondition: {
    describedAs: "the sub-account was created and a reference number is shown",
    timeoutMs: 10000,
    all: [
      {
        kind: "text_present",
        text: "Sub-Account Created",
        match: "normalized",
      },
      { kind: "url_matches", pattern: "/frame/confirm" },
    ],
  },

  outcomes: [
    {
      code: "SESSION_EXPIRED",
      describedAs: "the teller session timed out",
      detector: {
        kind: "text_present",
        text: "Your session has timed out",
        match: "normalized",
      },
      disposition: "recover",
      recovery: { do: "reauthenticate" },
      maxAttempts: 2,
    },
  ],

  policy: {
    allowedOrigins: [`${APP}/t/firstcu/*`, `${APP}/t/summit/*`],
    allowedActions: [
      "navigate",
      "click",
      "type",
      "select",
      "press",
      "read",
      "wait_for",
    ],
    confirmAtOrAbove: "irreversible",
  },

  provenance: {
    discoveredBy: { provider: "hand-authored", model: "none" },
    runId: "baseline",
    createdAt: new Date().toISOString(),
    transcriptSha256: "",
    humanAssisted: true,
  },
});

mkdirSync("artifacts", { recursive: true });
const path = `artifacts/${capability.id}@${capability.version}.json`;
writeFileSync(path, JSON.stringify(capability, null, 2) + "\n", "utf8");
console.log(`wrote ${path}`);
console.log(
  `  steps: ${capability.steps.length}  irreversible: ${capability.steps
    .filter((s) => s.riskClass === "irreversible")
    .map((s) => s.id)
    .join(", ")}`,
);
