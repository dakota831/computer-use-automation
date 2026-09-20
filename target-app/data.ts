/**
 * Seeded fixtures for the stand-in back-office app.
 *
 * ALL DATA HERE IS SYNTHETIC. No real member, account or institution is
 * represented. Names are invented, balances are invented, and the "SSN" field
 * is a fixed non-issuable 000-xx-xxxx placeholder that exists only so the
 * redaction pipeline has something realistic to prove it strips.
 */

export type Member = {
  memberId: string;
  name: string;
  status: "active" | "restricted" | "closed";
  ssnLast4: string;
  savingsBalance: number;
  checkingBalance: number;
  /** Drives the exceptional-state scenarios; see SCENARIOS below. */
  scenario?: "permission_denied" | "interstitial" | "slow" | "app_error";
};

export const MEMBERS: Record<string, Member> = {
  "100001": {
    memberId: "100001",
    name: "Alina Marsh",
    status: "active",
    ssnLast4: "4417",
    savingsBalance: 8214.55,
    checkingBalance: 1320.08,
  },
  "100002": {
    memberId: "100002",
    name: "Cedric Nwosu",
    status: "active",
    ssnLast4: "9082",
    savingsBalance: 142.1,
    checkingBalance: 55.0,
  },
  "100003": {
    memberId: "100003",
    name: "Priya Raghavan",
    status: "active",
    ssnLast4: "3351",
    savingsBalance: 61230.0,
    checkingBalance: 9401.77,
  },
  // Exceptional-state fixtures. Each exists to exercise one branch of the
  // error taxonomy, so the replay evidence can show real detection rather than
  // a simulated failure.
  "200001": {
    memberId: "200001",
    name: "Restricted Account",
    status: "restricted",
    ssnLast4: "0000",
    savingsBalance: 0,
    checkingBalance: 0,
    scenario: "permission_denied",
  },
  "200002": {
    memberId: "200002",
    name: "Dana Whitfield",
    status: "active",
    ssnLast4: "7719",
    savingsBalance: 305.25,
    checkingBalance: 12.0,
    scenario: "interstitial",
  },
  "200003": {
    memberId: "200003",
    name: "Slow Record",
    status: "active",
    ssnLast4: "5560",
    savingsBalance: 990.0,
    checkingBalance: 4.25,
    scenario: "slow",
  },
  "200004": {
    memberId: "200004",
    name: "Broken Record",
    status: "active",
    ssnLast4: "1108",
    savingsBalance: 0,
    checkingBalance: 0,
    scenario: "app_error",
  },
};

/** Not in MEMBERS on purpose: the "record not found" business outcome. */
export const NOT_FOUND_EXAMPLE = "999999";

export const CREDENTIALS = { username: "teller1", password: "demo-teller-pw" };

export const SCENARIOS = {
  "100001": "happy path, has savings balance",
  "100002": "happy path, small balance",
  "100003": "happy path, large balance",
  "200001": "permission denied on detail view",
  "200002": "unexpected confirmation interstitial before detail loads",
  "200003": "slow load, recoverable by waiting",
  "200004": "application error page",
  "999999": "no such member (business outcome, not a failure)",
} as const;
