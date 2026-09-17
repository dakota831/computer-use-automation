/**
 * Two tenants running the *same vendor product*, configured differently.
 *
 * This is the stand-in for the brief's core multi-tenant reality: hundreds of
 * institutions run the same underlying software, branded and versioned per
 * institution. A capability recorded against one should generalise to the other,
 * or degrade in a way we can detect — rather than being re-recorded per tenant.
 *
 * The differences below are deliberately the *kinds* of difference that actually
 * occur in the field, not cosmetic noise:
 *   - different product branding and page titles
 *   - different labels for the same field ("Member ID" vs "Member Number")
 *   - different button text ("Search" vs "Find")
 *   - a different column order on the results table
 *   - one tenant interposes an extra acknowledgement screen after login
 *   - a different generated control-name prefix (the ASP.NET-ism)
 */
export type Tenant = {
  id: string;
  institution: string;
  productVersion: string;
  labels: {
    memberId: string;
    search: string;
    savings: string;
    openSubAccount: string;
    confirm: string;
  };
  controlPrefix: string;
  /** Swaps the order of the Name and Status columns in search results. */
  resultColumnsSwapped: boolean;
  /** Extra "acknowledge terms" screen after login. Recoverable interstitial. */
  postLoginAcknowledgement: boolean;
  theme: { bg: string; bar: string };
};

export const TENANTS: Record<string, Tenant> = {
  firstcu: {
    id: "firstcu",
    institution: "First Community Credit Union",
    productVersion: "8.2.1",
    labels: {
      memberId: "Member ID",
      search: "Search",
      savings: "Savings Balance",
      openSubAccount: "Open Sub-Account",
      confirm: "Confirm",
    },
    controlPrefix: "ctl00$MainContent$",
    resultColumnsSwapped: false,
    postLoginAcknowledgement: false,
    theme: { bg: "#eef2f7", bar: "#1f3a63" },
  },
  summit: {
    id: "summit",
    institution: "Summit Savings Federal CU",
    productVersion: "8.4.0",
    labels: {
      memberId: "Member Number",
      search: "Find",
      savings: "Regular Savings",
      openSubAccount: "Add Sub-Account",
      confirm: "Submit",
    },
    controlPrefix: "ctl00$cphBody$",
    resultColumnsSwapped: true,
    postLoginAcknowledgement: true,
    theme: { bg: "#f4f1ea", bar: "#5a4632" },
  },
};

export const DEFAULT_TENANT = "firstcu";
/** Same vendor product behind both skins. Capabilities bind to this, not to a tenant. */
export const VENDOR_APP = "corelink-teller";
