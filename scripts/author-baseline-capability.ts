import { writeFileSync, mkdirSync } from "node:fs";
import { Capability, SCHEMA_VERSION } from "../src/core/artifact.js";
import type { TargetDescriptor } from "../src/core/targeting.js";

/**
 * Hand-authored baseline capability.
 *
 * This exists so the replay engine could be built and tested before the
 * discovery agent existed, and so there is a known-good artifact to diff the
 * agent's output against. The discovery run produces its own artifact; this one
 * is the reference.
 *
 * Writing it by hand was also the real test of the schema: anything awkward to
 * express here is a schema problem, and two things surfaced that way - the need
 * for ranked strategies to double as the cross-tenant alias mechanism, and the
 * need for `relation` to be enforced rather than decorative.
 */

const APP = "http://127.0.0.1:8080";
const ENTRY = `${APP}/t/firstcu`;

/** A field addressed only by the text beside it. The legacy case. */
const beside = (
  labelText: string,
  controlRole: string,
  describedAs: string,
  alternatives: string[] = [],
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
      rationale: `no accessible name on this control; the visible label is the table cell to its left ("${labelText}")`,
    },
    // Ranked fallbacks double as the cross-tenant alias mechanism: the same
    // artifact resolves "Member Number" on a tenant that renames the field.
    ...alternatives.map((alt) => ({
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

const button = (
  name: string,
  describedAs: string,
  aliases: string[] = [],
): TargetDescriptor => ({
  describedAs,
  framePath: [{ name: "mainFrame" }],
  ambiguityPolicy: "fail",
  strategies: [
    {
      strategy: {
        kind: "role_name",
        role: "button",
        name,
        nameMatch: "alias",
        aliases,
      },
      confidence: 0.95,
      rationale: `button carries a real accessible name; aliases cover tenant wording (${[name, ...aliases].join(" / ")})`,
    },
  ],
});

const capability = Capability.parse({
  schemaVersion: SCHEMA_VERSION,
  id: "cu.member.read_savings_balance",
  version: "1.0.0",
  title: "Read a member's savings balance",
  description:
    "Signs in to the teller console, looks up a member by ID, and returns their current savings balance and name. Read-only: performs no state change.",
  status: "approved",

  surface: {
    kind: "web",
    entryPoint: ENTRY,
    appProfile: { vendorApp: "corelink-teller", versionRange: "8.x" },
  },
  tenant: "base",

  /**
   * Per-tenant specialisation.
   *
   * Summit runs the same CoreLink product on a different host and renames
   * several fields. Almost all of that is already absorbed by the ranked
   * strategies in the base capability - "Member ID" then "Member Number",
   * "Search" aliased to "Find" - so the override carries only what the base
   * genuinely cannot know: where this institution's install lives.
   *
   * The aliases below are redundant with the base today. They are declared
   * anyway because that is the shape a real per-tenant override takes, and
   * because a tenant that renames a field *after* the base was recorded needs
   * somewhere to say so without re-recording the flow.
   */
  tenantOverrides: {
    summit: {
      entryPoint: `${APP}/t/summit`,
      aliases: {
        "the Member ID field": ["Member Number"],
        "the Search button": ["Find"],
        "the savings balance value cell": ["Regular Savings"],
      },
      note: "Summit Savings FCU - CoreLink 8.4.0. Interposes an acceptable-use screen after sign-in, handled by the ACKNOWLEDGEMENT_REQUIRED recovery rule in the base capability.",
    },
  },

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
  ],

  outputs: [
    {
      name: "savingsBalance",
      type: "number",
      description: "Current savings balance in USD.",
      sensitivity: "internal",
      source: beside(
        "Savings Balance",
        "LayoutTableCell",
        "the savings balance value cell",
        ["Regular Savings"],
      ),
      transform: [
        { op: "trim" },
        { op: "strip", chars: "$," },
        { op: "to_number" },
      ],
    },
    {
      name: "memberName",
      type: "string",
      description: "Member's full name as shown on the record.",
      sensitivity: "pii",
      source: beside("Name", "LayoutTableCell", "the member name value cell"),
      transform: [{ op: "trim" }],
    },
  ],

  steps: [
    {
      id: "s1_user",
      intent: "Enter the teller user ID on the sign-in screen",
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
      intent: "Submit the sign-in form and land on member search",
      riskClass: "safe",
      action: {
        type: "click",
        target: button("Sign In", "the Sign In button"),
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
          code: "BAD_CREDENTIALS",
          describedAs: "the console rejected the configured teller credentials",
          detector: {
            kind: "text_present",
            text: "Invalid username or password",
            match: "normalized",
          },
          disposition: "fail",
          maxAttempts: 1,
        },
        {
          // Summit interposes this; First Community does not. One artifact, both tenants.
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
            target: button("I Acknowledge", "the acknowledgement button"),
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
      intent: "Run the search and open the member record",
      riskClass: "safe",
      action: {
        type: "click",
        target: button("Search", "the Search button", ["Find"]),
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
          code: "INVALID_MEMBER_ID",
          describedAs: "the console rejected the member ID format",
          detector: {
            kind: "text_present",
            text: "Member ID must be 6 digits",
            match: "normalized",
          },
          disposition: "business_outcome",
          maxAttempts: 1,
        },
        {
          code: "PERMISSION_DENIED",
          describedAs: "this teller is not permitted to view the member record",
          detector: {
            kind: "text_present",
            text: "do not have permission to view this member record",
            match: "normalized",
          },
          disposition: "business_outcome",
          maxAttempts: 1,
        },
        {
          code: "VERIFICATION_REQUIRED",
          describedAs: "the record is flagged for additional verification",
          detector: {
            kind: "text_present",
            text: "flagged for additional verification",
            match: "normalized",
          },
          disposition: "recover",
          recovery: {
            do: "dismiss",
            describedAs:
              "acknowledge the verification notice and continue to the record",
            target: {
              describedAs: "the Continue to Record link",
              framePath: [{ name: "mainFrame" }],
              ambiguityPolicy: "fail",
              strategies: [
                {
                  strategy: {
                    kind: "role_name",
                    role: "link",
                    name: "Continue to Record",
                    nameMatch: "normalized",
                    aliases: [],
                  },
                  confidence: 0.9,
                  rationale: "link has a real accessible name",
                },
              ],
            },
          },
          maxAttempts: 3,
        },
        {
          code: "APP_ERROR",
          describedAs:
            "the application returned an internal error loading the record",
          detector: {
            kind: "text_present",
            text: "An unexpected error occurred",
            match: "normalized",
          },
          disposition: "fail",
          maxAttempts: 1,
        },
      ],
    },
  ],

  successCondition: {
    describedAs: "a member record with a savings balance is displayed",
    timeoutMs: 10000,
    all: [
      { kind: "text_present", text: "Member Detail", match: "normalized" },
      { kind: "url_matches", pattern: "/frame/member" },
    ],
  },

  // Capability-wide: evaluated after every step, because a session can expire anywhere.
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
  `  steps: ${capability.steps.length}, inputs: ${capability.inputs.map((i) => i.name).join(", ")}, outputs: ${capability.outputs.map((o) => o.name).join(", ")}`,
);
console.log(
  `  declared outcomes: ${[...capability.steps.flatMap((s) => s.outcomes), ...capability.outcomes].map((o) => o.code).join(", ")}`,
);
