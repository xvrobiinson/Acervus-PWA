// One-time import of a desktop app database into a new business
// (docs/DESKTOP-SYNC-PLAN.md, phase 2). `scripts/import-desktop.mjs` reads
// the desktop's export and sends it here in one call; record numbers are the
// desktop's row ids, so receipt numbers stay the same.
//
// Before anything is kept, every loan is worked out again by the shared
// engine from the desktop's records: each payment split, late fee and
// paid-off status must come out exactly as the desktop stored it, and no
// account may go below zero. Any difference refuses the whole import (the
// mutation is one transaction). The figures returned let the script compare
// the cloud's portfolio with the desktop's own figures as of the same day.

import { v, type Infer } from "convex/values";
import { bookDelinquency, bookPosition, summary } from "../shared/domain/portfolio";
import {
  buildBook,
  reallocateLoan,
  type CapitalRecord,
  type EntryRecord,
  type LateFeeRecord,
  type LoanRecord,
  type PaymentRecord,
} from "../shared/domain/records";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { businessArgs, startBusiness } from "./businesses";
import { requireIdentity, requireMember } from "./lib/access";
import { checkCash } from "./lib/books";
import { fail } from "./lib/errors";
import { hitLimit } from "./rateLimit";
import { amount, day, rate, text } from "./lib/validate";
import { account, allocationMode, applied, contractStatus, frequency, installment, method, paidWith } from "./schema";

const client = v.object({
  no: v.number(),
  fullName: v.string(),
  phone: v.string(),
  email: v.string(),
  idNumber: v.string(),
  address: v.string(),
  notes: v.string(),
  createdAt: v.number(),
  archivedAt: v.optional(v.number()),
});

const loan = v.object({
  no: v.number(),
  clientNo: v.number(),
  principal: v.number(),
  rate: v.number(),
  interestPeriod: frequency,
  frequency,
  method,
  installments: v.union(v.number(), v.null()),
  scheduleEdited: v.boolean(),
  schedule: v.array(installment),
  lateFeeRate: v.number(),
  startDate: v.string(),
  status: contractStatus,
  statusDate: v.union(v.string(), v.null()),
  notes: v.string(),
  createdAt: v.number(),
});

const payment = v.object({
  no: v.number(),
  loanNo: v.number(),
  paidOn: v.string(),
  amount: v.number(),
  notes: v.string(),
  paidWith: v.optional(paidWith),
  mode: allocationMode,
  targetSeq: v.optional(v.number()),
  targets: v.optional(v.array(v.object({ seq: v.number(), amount: v.number() }))),
  principal: v.number(),
  interest: v.number(),
  fee: v.number(),
  applied: v.array(applied),
  createdAt: v.number(),
});

const lateFee = v.object({
  loanNo: v.number(),
  seq: v.number(),
  assessedOn: v.string(),
  baseAmount: v.number(),
  rate: v.number(),
  amount: v.number(),
  waivedAt: v.optional(v.number()),
  waiveReason: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const book = v.object({
  business: v.object(businessArgs),
  settings: v.object({
    receiptName: v.string(),
    companyAddress: v.string(),
    companyPhone: v.string(),
    receiptCompany: v.object({ name: v.boolean(), address: v.boolean(), phone: v.boolean() }),
    receiptClient: v.object({ name: v.boolean(), idNumber: v.boolean(), phone: v.boolean(), address: v.boolean() }),
    receiptText: v.record(v.string(), v.string()),
    numberStyle: v.union(v.literal("comma_dot"), v.literal("dot_comma"), v.literal("space_comma")),
    dateStyle: v.union(v.literal("medium"), v.literal("iso"), v.literal("dmy"), v.literal("mdy")),
    defaultRate: v.number(),
    defaultFrequency: frequency,
    lateFeeRate: v.number(),
    receiptAfterPayment: v.boolean(),
    receiptAfterLoan: v.boolean(),
  }),
  clients: v.array(client),
  loans: v.array(loan),
  statusEvents: v.array(
    v.object({ loanNo: v.number(), status: contractStatus, occurredOn: v.string(), note: v.string(), createdAt: v.number() }),
  ),
  payments: v.array(payment),
  lateFees: v.array(lateFee),
  capital: v.array(
    v.object({
      no: v.number(),
      kind: v.union(v.literal("contribution"), v.literal("withdrawal")),
      amount: v.number(),
      occurredOn: v.string(),
      notes: v.string(),
      createdAt: v.number(),
    }),
  ),
  entries: v.array(
    v.object({
      no: v.number(),
      kind: v.union(v.literal("expense"), v.literal("income"), v.literal("transfer"), v.literal("adjustment")),
      account,
      amount: v.number(),
      occurredOn: v.string(),
      description: v.string(),
      createdAt: v.number(),
    }),
  ),
  changes: v.array(
    v.object({
      entity: v.union(
        v.literal("client"),
        v.literal("loan"),
        v.literal("payment"),
        v.literal("capital"),
        v.literal("entry"),
        v.literal("late_fee"),
      ),
      entityNo: v.number(),
      loanNo: v.optional(v.number()),
      action: v.union(v.literal("update"), v.literal("delete")),
      changes: v.array(v.object({ field: v.string(), old: v.string(), new: v.string() })),
      reason: v.string(),
      createdAt: v.number(),
    }),
  ),
});

export type DesktopBook = Infer<typeof book>;

/** Engine ids for the check, before anything is stored. */
const lid = (no: number) => `loan:${no}`;

function engineLoan(l: DesktopBook["loans"][number]): LoanRecord {
  return { ...l, _id: lid(l.no), recordNo: l.no, clientId: `client:${l.clientNo}` };
}

/** Interest-only payments keep the fee as it was entered; installment
 *  payments get theirs from the schedule. Custom splits are the split. */
function paymentFields(p: DesktopBook["payments"][number], hasPlan: boolean) {
  return {
    mode: p.mode,
    targetSeq: p.mode === "installment" ? p.targetSeq : undefined,
    targets: p.mode === "spread" ? p.targets : undefined,
    custom: p.mode === "custom" ? { principal: p.principal, interest: p.interest, fee: p.fee } : undefined,
    feeInput: hasPlan ? 0 : p.fee,
    principal: p.principal,
    interest: p.interest,
    fee: p.fee,
    applied: p.applied,
  };
}

function check(b: DesktopBook) {
  const ids = (xs: { no: number }[], what: string) => {
    const seen = new Set<number>();
    for (const x of xs) {
      if (!Number.isSafeInteger(x.no) || x.no < 1 || seen.has(x.no)) fail("invalid", { field: what, reason: "record_no" });
      seen.add(x.no);
    }
    return seen;
  };
  const clients = ids(b.clients, "clients");
  const loans = ids(b.loans, "loans");
  ids(b.payments, "payments");
  ids(b.capital, "capital");
  ids(b.entries, "entries");
  for (const c of b.clients) {
    text("fullName", c.fullName, 200, { required: true, oneLine: true });
    text("phone", c.phone, 60);
    text("email", c.email, 200);
    text("idNumber", c.idNumber, 60);
    text("address", c.address, 300);
    text("notes", c.notes, 10_000);
  }
  for (const l of b.loans) {
    if (!clients.has(l.clientNo)) fail("invalid", { field: "loan", reason: "client" });
    amount("principal", l.principal);
    rate("rate", l.rate);
    rate("lateFeeRate", l.lateFeeRate);
    day("startDate", l.startDate);
    if (l.statusDate !== null) day("statusDate", l.statusDate);
    for (const x of l.schedule) day("due", x.due);
    text("notes", l.notes, 10_000);
  }
  for (const p of b.payments) {
    if (!loans.has(p.loanNo)) fail("invalid", { field: "payment", reason: "loan" });
    amount("amount", p.amount);
    day("paidOn", p.paidOn);
    text("notes", p.notes, 2000);
  }
  for (const f of b.lateFees) {
    if (!loans.has(f.loanNo)) fail("invalid", { field: "lateFee", reason: "loan" });
    day("assessedOn", f.assessedOn);
  }
  for (const e of b.statusEvents) {
    if (!loans.has(e.loanNo)) fail("invalid", { field: "statusEvent", reason: "loan" });
    day("occurredOn", e.occurredOn);
  }
  for (const c of b.capital) {
    amount("amount", c.amount);
    day("occurredOn", c.occurredOn);
    text("notes", c.notes, 2000);
  }
  for (const e of b.entries) {
    amount("amount", e.amount, { allowNegative: e.kind === "adjustment" });
    day("occurredOn", e.occurredOn);
    text("description", e.description, 2000);
  }
}

const hasPlan = (b: DesktopBook) => new Map(b.loans.map((l) => [l.no, l.method !== "interest_only"]));

/** The book as engine records, with ids made from the desktop numbers. */
function engineBook(b: DesktopBook) {
  const plans = hasPlan(b);
  return {
    loans: b.loans.map(engineLoan),
    payments: b.payments.map(
      (p): PaymentRecord => ({
        _id: `payment:${p.no}`,
        loanId: lid(p.loanNo),
        recordNo: p.no,
        paidOn: p.paidOn,
        amount: p.amount,
        ...paymentFields(p, plans.get(p.loanNo)!),
      }),
    ),
    lateFees: b.lateFees.map((f): LateFeeRecord => ({ ...f, loanId: lid(f.loanNo) })),
    capital: b.capital.map((c): CapitalRecord => ({ ...c, _id: `capital:${c.no}`, recordNo: c.no })),
    entries: b.entries.map((e): EntryRecord => ({ ...e, _id: `entry:${e.no}`, recordNo: e.no })),
  };
}

/** The loans whose stored splits, late fees or paid-off status the engine
 *  would change, with the first reason for each. */
export function mismatches(b: DesktopBook, today: string): { loanNo: number; reason: string }[] {
  const { loans, payments, lateFees: fees } = engineBook(b);
  const out: { loanNo: number; reason: string }[] = [];
  for (const l of loans) {
    const r = reallocateLoan(l, payments, fees, today);
    const reason = !r.ok
      ? `the engine refuses payment ${r.error.paymentId.slice(8)} (${r.error.kind})`
      : r.value.updates.length
        ? `payment ${r.value.updates[0].paymentId.slice(8)} splits differently`
        : r.value.feeChanges.length
          ? `late fee on installment ${"seq" in r.value.feeChanges[0] ? r.value.feeChanges[0].seq : r.value.feeChanges[0].old.seq} differs`
          : l.status === "active" && r.value.paidOffOn
            ? "paid off, but stored as active"
            : l.status === "paid_off" && !r.value.paidOffOn
              ? "stored as paid off, but something is still owed"
              : null;
    if (reason) out.push({ loanNo: l.recordNo, reason });
  }
  return out;
}

/** The desktop engine's figures (export_for_cloud's figures.json). */
const figures = v.object({
  asOf: v.string(),
  summary: v.record(v.string(), v.number()),
  loans: v.array(v.record(v.string(), v.number())),
});

/** Every figure the desktop gave that the cloud works out differently, as
 *  "where: desktop → cloud". */
export function figureDifferences(
  expected: Infer<typeof figures>,
  actual: { summary: Record<string, number>; loans: Record<string, number>[] },
): string[] {
  const out: string[] = [];
  const compare = (where: string, want: Record<string, number>, got: Record<string, number> | undefined) => {
    for (const [k, value] of Object.entries(want)) {
      if (k !== "no" && got?.[k] !== value) out.push(`${where}.${k}: ${value} → ${got?.[k] ?? "missing"}`);
    }
  };
  compare("summary", expected.summary, actual.summary);
  for (const l of expected.loans) compare(`loan ${l.no}`, l, actual.loans.find((x) => x.no === l.no));
  if (expected.loans.length !== actual.loans.length) out.push(`loans: ${expected.loans.length} → ${actual.loans.length}`);
  return out;
}

/** The cloud's figures for the book as of `today`, worked out from the book
 *  alone (nothing is read from the database). */
function figuresOf(b: DesktopBook, today: string) {
  const whole = buildBook(engineBook(b));
  return {
    summary: { ...summary(whole, today) },
    loans: whole.loans.map((l) => {
      const { lastEvent: _l, periods: _p, ...pos } = bookPosition(l, today);
      const late = bookDelinquency(l, today);
      return { no: Number(l.id.slice(5)), ...pos, overdueAmount: late.overdueAmount, daysOverdue: late.daysOverdue };
    }),
  };
}

/** Every check that needs no database: same day as the export, every stored
 *  split and late fee as the engine works them out, every figure as the
 *  desktop has it. Fails before anything is written. */
function verify(b: DesktopBook, expected: Infer<typeof figures>, today: string) {
  check(b);
  // Figures from another day would differ for reasons that aren't errors
  // (interest due, late fees); export again on the day of the import.
  if (expected.asOf !== today) fail("import_stale", { exportedOn: expected.asOf, today });
  const problems = mismatches(b, today);
  if (problems.length) fail("import_mismatch", { differences: problems.map((p) => `loan ${p.loanNo}: ${p.reason}`) });
  const actual = figuresOf(b, today);
  const differences = figureDifferences(expected, actual);
  if (differences.length) fail("import_mismatch", { differences: differences.slice(0, 50) });
  return actual;
}

/** What a client keeps across a restore, by record number. */
type Kept = { collectorId?: string; photoId?: Id<"_storage"> };

/** Writes the book's records into `businessId` (empty of them), numbered as
 *  in the book. `kept` gives clients back their collector and ID photo. */
async function writeBook(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  b: DesktopBook,
  who: { userId: string; name: string },
  kept: Map<number, Kept> = new Map(),
) {
  const stamps = (createdAt: number) => ({ createdAt, createdBy: who.userId, updatedAt: createdAt, version: 1 });
  const clientIds = new Map<number, Id<"clients">>();
  for (const c of b.clients) {
    const { no, createdAt, ...rest } = c;
    const k = kept.get(no) ?? {};
    clientIds.set(
      no,
      await ctx.db.insert("clients", {
        businessId,
        recordNo: no,
        ...rest,
        ...(k.collectorId ? { collectorId: k.collectorId } : {}),
        ...(k.photoId ? { photoId: k.photoId } : {}),
        ...stamps(createdAt),
      }),
    );
  }
  const loanIds = new Map<number, Id<"loans">>();
  const plans = hasPlan(b);
  for (const l of b.loans) {
    const { no, clientNo, createdAt, ...rest } = l;
    loanIds.set(
      no,
      await ctx.db.insert("loans", { businessId, recordNo: no, clientId: clientIds.get(clientNo)!, ...rest, ...stamps(createdAt) }),
    );
  }
  for (const e of b.statusEvents) {
    const { loanNo, ...rest } = e;
    await ctx.db.insert("loanStatusEvents", { businessId, loanId: loanIds.get(loanNo)!, ...rest, createdBy: who.userId });
  }
  const paymentIds = new Map<number, Id<"payments">>();
  for (const p of b.payments) {
    paymentIds.set(
      p.no,
      await ctx.db.insert("payments", {
        businessId,
        loanId: loanIds.get(p.loanNo)!,
        recordNo: p.no,
        paidOn: p.paidOn,
        amount: p.amount,
        notes: p.notes,
        ...(p.paidWith ? { paidWith: p.paidWith } : {}),
        ...paymentFields(p, plans.get(p.loanNo)!),
        recordedOffline: false,
        ...stamps(p.createdAt),
      }),
    );
  }
  for (const f of b.lateFees) {
    const { loanNo, ...rest } = f;
    await ctx.db.insert("lateFees", { businessId, loanId: loanIds.get(loanNo)!, ...rest });
  }
  const capitalIds = new Map<number, Id<"capitalTxs">>();
  for (const c of b.capital) {
    const { no, createdAt, ...rest } = c;
    capitalIds.set(no, await ctx.db.insert("capitalTxs", { businessId, recordNo: no, ...rest, ...stamps(createdAt) }));
  }
  const entryIds = new Map<number, Id<"cashEntries">>();
  for (const e of b.entries) {
    const { no, createdAt, ...rest } = e;
    entryIds.set(
      no,
      await ctx.db.insert("cashEntries", { businessId, recordNo: no, ...rest, recordedOffline: false, ...stamps(createdAt) }),
    );
  }
  // Rows that can't go below zero at any point: the desktop has the same
  // rule, so this only fails for a book changed outside the app.
  await checkCash(ctx, businessId);

  // The desktop's edit and deletion history, as written there. Records that
  // were deleted on the desktop keep their desktop number.
  const known: Record<string, Map<number, string>> = {
    client: clientIds,
    loan: loanIds,
    payment: paymentIds,
    capital: capitalIds,
    entry: entryIds,
  };
  for (const c of b.changes) {
    await ctx.db.insert("changeLog", {
      businessId,
      entity: c.entity,
      entityId: known[c.entity]?.get(c.entityNo) ?? `desktop:${c.entity}:${c.entityNo}`,
      loanId: c.loanNo !== undefined ? loanIds.get(c.loanNo) : undefined,
      action: c.action,
      changes: c.changes,
      reason: c.reason.slice(0, 2000),
      userId: who.userId,
      userName: `${who.name} (desktop)`,
      createdAt: c.createdAt,
    });
  }
  return { clientIds, loanIds, paymentIds };
}

export const desktopBook = mutation({
  args: { book, expected: figures },
  handler: async (ctx, { book: b, expected }) => {
    const who = await requireIdentity(ctx);
    check(b);

    const nos = [b.clients, b.loans, b.payments, b.capital, b.entries].flat().map((x) => x.no);
    const access = await startBusiness(ctx, who, b.business, {
      settings: { ...b.settings, currencyCode: b.business.currencyCode, language: b.business.language },
      nextRecordNo: Math.max(0, ...nos) + 1,
      reason: "Imported from the desktop app",
    });
    const actual = verify(b, expected, access.today);
    const { clientIds } = await writeBook(ctx, access.business._id, b, access);
    return { businessId: access.business._id, clientIds: Object.fromEntries(clientIds), asOf: access.today, ...actual };
  },
});

/** Puts a business's books back as they were in a backup, for every phone
 *  and PC (admins only, once the business's name is typed). The backup is
 *  checked like an import before anything changes; it replaces the clients,
 *  loans, payments, late fees, money records and history. The team,
 *  invitations, settings and logo stay; each client keeps its collector and
 *  ID photo by record number, and collector payments keep their place when
 *  their loan is in the backup (the others go). Record numbers carry on
 *  after the highest ever given, so no receipt number is used twice. One
 *  transaction: any failed check leaves the business as it was. */
export const restoreBook = mutation({
  args: { businessId: v.id("businesses"), confirmName: v.string(), backupDate: v.string(), book, expected: figures },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    if (!(await hitLimit(ctx, `restore:${a.businessId}`, 5, 60 * 60_000))) fail("rate_limited");
    if (a.confirmName.trim() !== access.business.name) fail("invalid", { field: "confirmName", reason: "name" });
    const b = a.book;
    verify(b, a.expected, access.today);
    const businessId = a.businessId;
    // The books a restore replaces, children before parents.
    const current = {
      payments: () => ctx.db.query("payments").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      lateFees: () => ctx.db.query("lateFees").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      loanStatusEvents: () => ctx.db.query("loanStatusEvents").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      loans: () => ctx.db.query("loans").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      clients: () => ctx.db.query("clients").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      capitalTxs: () => ctx.db.query("capitalTxs").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      cashEntries: () => ctx.db.query("cashEntries").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
      changeLog: () => ctx.db.query("changeLog").withIndex("by_business", (q) => q.eq("businessId", businessId)).collect(),
    };

    // What stays, by record number, before the current books go.
    const oldClients = await current.clients();
    const oldLoans = await current.loans();
    const kept = new Map<number, Kept>(oldClients.map((c) => [c.recordNo, { collectorId: c.collectorId, photoId: c.photoId }]));
    const clientNo = new Map(oldClients.map((c) => [c._id as string, c.recordNo]));
    const loanNo = new Map(oldLoans.map((l) => [l._id as string, l.recordNo]));
    for (const rows of Object.values(current)) {
      for (const doc of await rows()) await ctx.db.delete(doc._id);
    }

    const { clientIds, loanIds, paymentIds } = await writeBook(ctx, businessId, b, access, kept);

    // Collector payments follow their loan and client to the restored ones.
    const pending = await ctx.db
      .query("pendingPayments")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect();
    for (const p of pending) {
      const loanId = loanIds.get(loanNo.get(p.loanId) ?? -1);
      const clientId = clientIds.get(clientNo.get(p.clientId) ?? -1);
      if (!loanId || !clientId) {
        await ctx.db.delete(p._id);
        continue;
      }
      await ctx.db.patch(p._id, { loanId, clientId, paymentId: p.paymentId ? paymentIds.get(p.recordNo) : undefined });
    }
    // ID photos of clients that aren't in the backup.
    for (const c of oldClients) {
      if (c.photoId && !clientIds.has(c.recordNo)) await ctx.storage.delete(c.photoId);
    }

    const nos = [b.clients, b.loans, b.payments, b.capital, b.entries].flat().map((x) => x.no);
    const fresh = (await ctx.db.get(businessId))!;
    await ctx.db.patch(businessId, { nextRecordNo: Math.max(fresh.nextRecordNo, Math.max(0, ...nos) + 1) });
    await ctx.db.insert("changeLog", {
      businessId,
      entity: "settings",
      entityId: businessId,
      action: "update",
      changes: [{ field: "backup_restored", old: "", new: a.backupDate }],
      reason: `Books restored from a backup of ${a.backupDate}`,
      userId: access.userId,
      userName: access.name,
      createdAt: Date.now(),
    });
    return { clientIds: Object.fromEntries(clientIds), asOf: access.today };
  },
});
