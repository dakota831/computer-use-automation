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

/** Demo credentials. admin/admin everywhere, because this is a demo tool. */
export const CREDENTIALS = { username: "admin", password: "admin" };

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

/* -------------------------------------------------------------------------
 * Supporting fixtures for the rest of the application.
 *
 * The teller console needs more than one working screen to be a believable
 * target: an operator who can only search members would notice immediately, and
 * so would anyone evaluating whether the automation is driving a real app. These
 * back the Accounts, Transactions, Reports and Administration sections.
 *
 * Still entirely synthetic, and deliberately deterministic - no random data, so
 * a screenshot taken today matches one taken next week.
 * ---------------------------------------------------------------------- */

export type Account = {
  number: string;
  memberId: string;
  kind: "Regular Savings" | "Share Draft" | "Certificate" | "Sub-Account";
  opened: string;
  status: "Open" | "Dormant" | "Closed";
  balance: number;
};

export type Txn = {
  posted: string;
  account: string;
  memberId: string;
  description: string;
  type: "Deposit" | "Withdrawal" | "Transfer" | "Fee" | "Dividend";
  amount: number;
  balance: number;
};

export const ACCOUNTS: Account[] = [
  {
    number: "0001-100001-S0",
    memberId: "100001",
    kind: "Regular Savings",
    opened: "2019-03-14",
    status: "Open",
    balance: 8214.55,
  },
  {
    number: "0001-100001-D0",
    memberId: "100001",
    kind: "Share Draft",
    opened: "2019-03-14",
    status: "Open",
    balance: 1320.08,
  },
  {
    number: "0001-100001-C1",
    memberId: "100001",
    kind: "Certificate",
    opened: "2023-11-02",
    status: "Open",
    balance: 15000.0,
  },
  {
    number: "0001-100002-S0",
    memberId: "100002",
    kind: "Regular Savings",
    opened: "2021-07-09",
    status: "Open",
    balance: 142.1,
  },
  {
    number: "0001-100002-D0",
    memberId: "100002",
    kind: "Share Draft",
    opened: "2021-07-09",
    status: "Dormant",
    balance: 55.0,
  },
  {
    number: "0001-100003-S0",
    memberId: "100003",
    kind: "Regular Savings",
    opened: "2015-01-22",
    status: "Open",
    balance: 61230.0,
  },
  {
    number: "0001-100003-D0",
    memberId: "100003",
    kind: "Share Draft",
    opened: "2015-01-22",
    status: "Open",
    balance: 9401.77,
  },
  {
    number: "0001-200002-S0",
    memberId: "200002",
    kind: "Regular Savings",
    opened: "2022-05-30",
    status: "Open",
    balance: 305.25,
  },
  {
    number: "0001-200003-S0",
    memberId: "200003",
    kind: "Regular Savings",
    opened: "2020-09-17",
    status: "Open",
    balance: 990.0,
  },
];

export const TRANSACTIONS: Txn[] = [
  {
    posted: "2026-09-19",
    account: "0001-100001-S0",
    memberId: "100001",
    description: "Payroll deposit — ACH",
    type: "Deposit",
    amount: 1450.0,
    balance: 8214.55,
  },
  {
    posted: "2026-09-15",
    account: "0001-100001-D0",
    memberId: "100001",
    description: "Debit card purchase — grocery",
    type: "Withdrawal",
    amount: -86.42,
    balance: 1320.08,
  },
  {
    posted: "2026-09-12",
    account: "0001-100001-S0",
    memberId: "100001",
    description: "Transfer to share draft",
    type: "Transfer",
    amount: -200.0,
    balance: 6764.55,
  },
  {
    posted: "2026-09-01",
    account: "0001-100001-S0",
    memberId: "100001",
    description: "Quarterly dividend",
    type: "Dividend",
    amount: 12.18,
    balance: 6964.55,
  },
  {
    posted: "2026-09-18",
    account: "0001-100003-S0",
    memberId: "100003",
    description: "Wire received — domestic",
    type: "Deposit",
    amount: 20000.0,
    balance: 61230.0,
  },
  {
    posted: "2026-09-10",
    account: "0001-100003-D0",
    memberId: "100003",
    description: "Bill pay — utilities",
    type: "Withdrawal",
    amount: -212.44,
    balance: 9401.77,
  },
  {
    posted: "2026-09-08",
    account: "0001-100002-S0",
    memberId: "100002",
    description: "Branch deposit — cash",
    type: "Deposit",
    amount: 40.0,
    balance: 142.1,
  },
  {
    posted: "2026-09-02",
    account: "0001-100002-D0",
    memberId: "100002",
    description: "Monthly service charge",
    type: "Fee",
    amount: -5.0,
    balance: 55.0,
  },
  {
    posted: "2026-09-16",
    account: "0001-200002-S0",
    memberId: "200002",
    description: "Mobile deposit",
    type: "Deposit",
    amount: 120.0,
    balance: 305.25,
  },
];

/** Static figures for the Reports section. Deterministic on purpose. */
export const DAILY_TOTALS = [
  { label: "Deposits posted", count: 148, amount: 412_880.14 },
  { label: "Withdrawals posted", count: 201, amount: -188_402.55 },
  { label: "Transfers", count: 64, amount: 0 },
  { label: "Fees assessed", count: 22, amount: -1_140.0 },
  { label: "Dividends credited", count: 310, amount: 8_921.66 },
];

export const AUDIT_LOG = [
  {
    at: "2026-09-20 08:02:11",
    actor: "admin",
    action: "Signed in",
    detail: "Branch 004 workstation TLR-04",
  },
  {
    at: "2026-09-20 08:14:52",
    actor: "admin",
    action: "Member record viewed",
    detail: "Member 100001",
  },
  {
    at: "2026-09-20 09:31:07",
    actor: "admin",
    action: "Sub-account opened",
    detail: "Reference SA-4401",
  },
  {
    at: "2026-09-19 16:48:20",
    actor: "supervisor2",
    action: "Permission override",
    detail: "Restricted record 200001 — denied",
  },
  {
    at: "2026-09-19 11:05:44",
    actor: "admin",
    action: "Report generated",
    detail: "Daily totals — branch 004",
  },
];

export const money = (n: number): string =>
  `${n < 0 ? "-" : ""}$${Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
