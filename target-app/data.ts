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

/**
 * The restricted member's account.
 *
 * Added so the permission refusal on the posting screen is reachable at all:
 * without an account row the lookup failed first and the screen answered "no
 * such account", which is a different refusal with a different meaning. An
 * exceptional state that cannot be reached is not covered, it is only claimed.
 */
ACCOUNTS.push({
  number: "0001-200001-S0",
  memberId: "200001",
  kind: "Regular Savings",
  opened: "2020-05-30",
  status: "Open",
  balance: 0,
});

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

/* -------------------------------------------------------------------------
 * The posting ledger.
 *
 * Everything above is seed data and never changes. Adjustments posted through
 * the teller screen are held here instead of being written back over the seed,
 * and every balance the application renders is the seed folded with whatever
 * has been posted against it.
 *
 * That split is what lets the application have a genuinely irreversible write
 * action - a teller cannot un-post an adjustment, and the balance they see
 * afterwards is the one they changed - while the recorded evidence stays
 * reproducible: `resetLedger()` returns the whole application to its seed, so
 * a replay matrix run today prints the same numbers as one run next week.
 * ---------------------------------------------------------------------- */

export type Adjustment = {
  reference: string;
  account: string;
  memberId: string;
  description: string;
  type: Txn["type"];
  /** Signed: a fee is negative. */
  amount: number;
  posted: string;
  teller: string;
};

const ledger: Adjustment[] = [];
let adjustmentSeq = 7200;

export const adjustments = (): readonly Adjustment[] => ledger;

/** Drop everything posted this session. Used by the evidence harness. */
export function resetLedger(): void {
  ledger.length = 0;
  adjustmentSeq = 7200;
}

/** Net of everything posted against one account. */
const postedAgainst = (accountNumber: string): number =>
  ledger
    .filter((a) => a.account === accountNumber)
    .reduce((s, a) => s + a.amount, 0);

/** An account's balance as the application should display it. */
export const accountBalance = (a: Account): number =>
  round2(a.balance + postedAgainst(a.number));

/**
 * A member's savings balance as the member record should display it.
 *
 * The member record and the account register are separate screens reading
 * separate seed fields, and they are seeded to agree. They have to keep
 * agreeing after a posting, or the application would contradict itself in a
 * way no real core system does - so both fold the same ledger.
 */
export function memberSavings(m: Member): number {
  const savings = ACCOUNTS.find(
    (a) => a.memberId === m.memberId && a.kind === "Regular Savings",
  );
  return round2(
    m.savingsBalance + (savings ? postedAgainst(savings.number) : 0),
  );
}

/** Money is decimal; floating point addition is not. Round at every boundary. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

export type PostResult =
  | { ok: true; adjustment: Adjustment; balance: number }
  | { ok: false; reason: "no_account" | "not_open" | "bad_amount" };

/**
 * Post an adjustment. Irreversible by design: there is no reversal screen,
 * which is exactly why the capability that drives it has to be reviewed and
 * approved before it may run unattended.
 */
export function postAdjustment(input: {
  account: string;
  description: string;
  amount: number;
  type: Txn["type"];
  teller: string;
}): PostResult {
  const acct = ACCOUNTS.find((a) => a.number === input.account.trim());
  if (!acct) return { ok: false, reason: "no_account" };
  if (acct.status !== "Open") return { ok: false, reason: "not_open" };
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    return { ok: false, reason: "bad_amount" };

  // A fee or withdrawal debits; anything else credits.
  const signed =
    input.type === "Fee" || input.type === "Withdrawal"
      ? -round2(input.amount)
      : round2(input.amount);

  const adjustment: Adjustment = {
    reference: `ADJ-${++adjustmentSeq}`,
    account: acct.number,
    memberId: acct.memberId,
    description: input.description.trim() || input.type,
    type: input.type,
    amount: signed,
    posted: "2026-09-20",
    teller: input.teller,
  };
  ledger.push(adjustment);
  return { ok: true, adjustment, balance: accountBalance(acct) };
}

/** Posted adjustments rendered as register rows, newest first. */
export const adjustmentTxns = (): Txn[] =>
  [...ledger].reverse().map((a) => ({
    posted: a.posted,
    account: a.account,
    memberId: a.memberId,
    description: a.description,
    type: a.type,
    amount: a.amount,
    balance: accountBalance(ACCOUNTS.find((x) => x.number === a.account)!),
  }));

export const money = (n: number): string =>
  `${n < 0 ? "-" : ""}$${Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
