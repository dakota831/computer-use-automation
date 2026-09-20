/**
 * Two tenants running the *same vendor product*, configured differently.
 *
 * This is the stand-in for the brief's core multi-tenant reality: hundreds of
 * institutions run the same underlying software, branded and versioned per
 * institution. A capability recorded against one should generalise to the other,
 * or degrade in a way we can detect - rather than being re-recorded per tenant.
 *
 * The differences are deliberately the *kinds* that occur in the field:
 *   - different product branding, colours and page titles
 *   - different labels for the same field ("Member ID" vs "Member Number")
 *   - different button text ("Search" vs "Find")
 *   - a different row order on the member record
 *   - one tenant interposes an extra acknowledgement screen after login
 *   - a different generated control-name prefix (the ASP.NET-ism)
 *   - different product versions of the same vendor app
 */
export type Tenant = {
  id: string;
  institution: string;
  shortName: string;
  /** Two-letter mark used in the crest and the favicon. */
  initials: string;
  charter: string;
  productVersion: string;
  appServer: string;
  labels: {
    memberId: string;
    search: string;
    savings: string;
    openSubAccount: string;
    confirm: string;
    /** The adjustment-posting screen, named differently per institution. */
    postAdjustment: string;
    /** "Description" at one institution, "Memo" at the other. */
    memo: string;
  };
  controlPrefix: string;
  resultColumnsSwapped: boolean;
  postLoginAcknowledgement: boolean;
  theme: {
    /** Brand bar gradient endpoints. */
    barFrom: string;
    barTo: string;
    /** Menu bar and accents. */
    menu: string;
    accent: string;
    /** Application background. */
    bg: string;
    panelFrom: string;
    panelTo: string;
  };
};

export const TENANTS: Record<string, Tenant> = {
  firstcu: {
    id: "firstcu",
    institution: "First Community Credit Union",
    shortName: "First Community",
    initials: "FC",
    charter: "Charter No. 24-1187 · Federally Insured by NCUA",
    productVersion: "8.2.1",
    appServer: "CLK-APP-03",
    labels: {
      memberId: "Member ID",
      search: "Search",
      savings: "Savings Balance",
      openSubAccount: "Open Sub-Account",
      confirm: "Confirm",
      postAdjustment: "Post Adjustment",
      memo: "Description",
    },
    controlPrefix: "ctl00$MainContent$",
    resultColumnsSwapped: false,
    postLoginAcknowledgement: false,
    theme: {
      barFrom: "#1b3d6d",
      barTo: "#0d2247",
      menu: "#2f5c99",
      accent: "#c8a24a",
      bg: "#eef1f6",
      panelFrom: "#dfe7f2",
      panelTo: "#c7d4e8",
    },
  },
  summit: {
    id: "summit",
    institution: "Summit Savings Federal Credit Union",
    shortName: "Summit Savings",
    initials: "SS",
    charter: "Charter No. 31-4402 · Federally Insured by NCUA",
    productVersion: "8.4.0",
    appServer: "CLK-APP-11",
    labels: {
      memberId: "Member Number",
      search: "Find",
      savings: "Regular Savings",
      openSubAccount: "Add Sub-Account",
      confirm: "Submit",
      postAdjustment: "Enter Adjustment",
      memo: "Memo",
    },
    controlPrefix: "ctl00$cphBody$",
    resultColumnsSwapped: true,
    postLoginAcknowledgement: true,
    theme: {
      barFrom: "#3c5c3a",
      barTo: "#22361f",
      menu: "#4d7349",
      accent: "#b8863b",
      bg: "#f2f1ea",
      panelFrom: "#e4e7dc",
      panelTo: "#cfd6c4",
    },
  },
};

export const DEFAULT_TENANT = "firstcu";
/** Same vendor product behind both skins. Capabilities bind to this, not to a tenant. */
export const VENDOR_APP = "corelink-teller";
export const VENDOR_NAME = "CoreLink Financial Systems";

/**
 * Menu labels are chosen NOT to collide with any checkpoint text used by the
 * recorded capabilities ("Member Search", "Member Detail", "Sub-Account
 * Created", "Account Nickname"). The shell is part of the visible text an
 * assertion sees, so a nav item called "Member Search" would make a checkpoint
 * pass on every screen in the application.
 */
export const MENU = [
  { id: "members", label: "Members" },
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "reports", label: "Reports" },
  { id: "admin", label: "Administration" },
] as const;
