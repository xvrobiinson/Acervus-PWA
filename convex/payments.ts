// Payments. Recording one is allowed for collectors and works offline: the
// device sends a unique operation id (so a retry never records it twice) and
// the loan version it saw. If the loan changed since — usually another
// device recorded a payment on it — the payment is held back as "stale"
// until the person confirms it with the current figures. The split is always
// worked out here, never trusted from the device.
//
// A collector's payment doesn't count yet: it waits as a pending payment
// (no balance, overdue or total changes) until an admin confirms the money
// reached them. Confirmed, it becomes a payment dated the day it was
// collected, so the client isn't charged late fees for the wait.

import { v } from "convex/values";
import type { Instruction } from "../shared/domain/installments";
import { hasInstallments } from "../shared/domain/loans";
import { instructionFields } from "../shared/domain/records";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { checkVersion, ownRecord, requireMember } from "./lib/access";
import {
  checkCash,
  Diff,
  logChange,
  nextRecordNo,
  priorOperation,
  reallocate,
  rememberOperation,
  touchLoan,
} from "./lib/books";
import { fail } from "./lib/errors";
import { adminIds, canSee, limited, notify } from "./lib/team";
import { amount, day, notFuture, text } from "./lib/validate";
import { paidWith } from "./schema";

export const instruction = v.union(
  v.object({ kind: v.literal("auto") }),
  v.object({ kind: v.literal("installment"), seq: v.number() }),
  v.object({ kind: v.literal("spread"), parts: v.array(v.object({ seq: v.number(), amount: v.number() })) }),
  v.object({ kind: v.literal("custom"), principal: v.number(), interest: v.number(), fee: v.number() }),
);

function checkInstruction(i: Instruction, total: number) {
  if (i.kind === "spread") {
    if (i.parts.length === 0 || i.parts.length > 1000) fail("invalid", { field: "instruction", reason: "spread" });
    for (const p of i.parts) amount("instruction", p.amount);
    if (new Set(i.parts.map((p) => p.seq)).size !== i.parts.length) fail("invalid", { field: "instruction", reason: "spread" });
  }
  if (i.kind === "custom") {
    for (const x of [i.principal, i.interest, i.fee]) amount("instruction", x, { allowZero: true });
    if (i.principal + i.interest + i.fee !== total) fail("invalid", { field: "instruction", reason: "split" });
  }
}

function describe(p: Pick<Doc<"payments">, "mode" | "targetSeq" | "targets" | "custom">): string {
  switch (p.mode) {
    case "installment":
      return `installment ${p.targetSeq}`;
    case "spread":
      return `spread ${(p.targets ?? []).map((t) => `${t.seq}:${t.amount}`).join(",")}`;
    case "custom":
      return `custom ${p.custom?.principal}/${p.custom?.interest}/${p.custom?.fee}`;
    default:
      return "auto";
  }
}

export const record = mutation({
  args: {
    businessId: v.id("businesses"),
    opId: v.string(),
    loanId: v.id("loans"),
    /** The loan version the person saw when they entered the payment. */
    loanVersion: v.number(),
    /** They saw the loan's newer figures and still want it recorded. */
    confirmedStale: v.optional(v.boolean()),
    amount: v.number(),
    /** Extra fee entered with the payment (interest-only loans). */
    fee: v.number(),
    paidOn: v.string(),
    notes: v.string(),
    /** How it was paid (cash, transfer…); older apps leave it out. */
    paidWith: v.optional(paidWith),
    instruction,
    deviceRecordedAt: v.optional(v.number()),
  },
  handler: async (
    ctx,
    a,
  ): Promise<{
    /** Recorded (an admin's payment). */
    paymentId?: Id<"payments">;
    /** Waiting for an admin to confirm it (a collector's payment). */
    pendingId?: Id<"pendingPayments">;
    duplicate: boolean;
    loanVersionBefore?: number;
    loanVersionAfter?: number;
  }> => {
    const access = await requireMember(ctx, a.businessId, "record");
    const prior = await priorOperation(ctx, access, a.opId, "payment.record");
    if (prior) {
      const pendingId = ctx.db.normalizeId("pendingPayments", prior.resultId);
      if (pendingId) return { pendingId, duplicate: true };
      return {
        paymentId: prior.resultId as Id<"payments">,
        duplicate: true,
        loanVersionBefore: prior.loanVersionBefore,
        loanVersionAfter: prior.loanVersionAfter,
      };
    }
    amount("amount", a.amount);
    amount("fee", a.fee, { allowZero: true });
    if (a.fee > a.amount) fail("invalid", { field: "fee", reason: "fee_too_large" });
    const paidOn = day("paidOn", a.paidOn);
    notFuture("paidOn", paidOn, access.today);
    const notes = text("notes", a.notes, 2000);
    const loan = await ownRecord(ctx, access, "loans", a.loanId);
    if (loan.status !== "active") fail("loan_closed");
    const collector = limited(access);
    if (collector) {
      const client = await ctx.db.get(loan.clientId);
      if (!client || !canSee(access, client)) fail("not_found", { table: "loans" });
    }
    // A collector's payment is applied when an admin confirms it, to the
    // figures of that moment, so what they saw can't be out of date.
    if (!collector && loan.version !== a.loanVersion && !a.confirmedStale) {
      const recent = (
        await ctx.db
          .query("payments")
          .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
          .collect()
      )
        .sort((x, y) => y.createdAt - x.createdAt)
        .slice(0, 3)
        .map((p) => ({ paidOn: p.paidOn, amount: p.amount, createdAt: p.createdAt }));
      fail("stale", { loanVersion: loan.version, seen: a.loanVersion, recent });
    }
    const installments = hasInstallments(loan.method);
    if (installments && a.fee > 0) fail("invalid", { field: "fee", reason: "automatic_late_fees" });
    if (!installments && a.instruction.kind !== "auto") fail("invalid", { field: "instruction", reason: "no_installments" });
    checkInstruction(a.instruction, a.amount);
    const now = Date.now();
    if (collector) {
      const pendingId = await ctx.db.insert("pendingPayments", {
        businessId: a.businessId,
        loanId: loan._id,
        clientId: loan.clientId,
        recordNo: await nextRecordNo(ctx, access.business),
        paidOn,
        amount: a.amount,
        fee: a.fee,
        notes,
        paidWith: a.paidWith,
        ...instructionFields(a.instruction),
        collectedBy: access.userId,
        collectorName: access.name,
        status: "waiting",
        reason: "",
        recordedOffline: a.deviceRecordedAt !== undefined,
        deviceRecordedAt: a.deviceRecordedAt,
        createdAt: now,
      });
      const client = (await ctx.db.get(loan.clientId))!;
      await notify(ctx, a.businessId, await adminIds(ctx, a.businessId), {
        kind: "collected",
        clientNames: [client.fullName],
        fromName: access.name,
        amount: a.amount,
        pendingId,
      });
      await rememberOperation(ctx, access, a.opId, "payment.record", pendingId);
      return { pendingId, duplicate: false };
    }
    const paymentId = await ctx.db.insert("payments", {
      businessId: a.businessId,
      loanId: loan._id,
      recordNo: await nextRecordNo(ctx, access.business),
      paidOn,
      amount: a.amount,
      notes,
      paidWith: a.paidWith,
      ...instructionFields(a.instruction),
      feeInput: a.fee,
      // Placeholder split; reallocate() works out the real one below.
      principal: a.amount - a.fee,
      interest: 0,
      fee: a.fee,
      applied: [],
      recordedOffline: a.deviceRecordedAt !== undefined,
      deviceRecordedAt: a.deviceRecordedAt,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    const saved = (await ctx.db.get(paymentId))!;
    const d = new Diff()
      .added("amount", a.amount)
      .added("paid_on", paidOn)
      .added("allocation", describe(saved))
      .added("principal", saved.principal)
      .added("interest", saved.interest)
      .added("fee", saved.fee)
      .added("paid_with", a.paidWith ?? "")
      .added("notes", notes);
    const reason = a.deviceRecordedAt ? (a.confirmedStale ? "Recorded offline; confirmed after the loan changed" : "Recorded offline") : "";
    await logChange(ctx, access, "payment", paymentId, "create", d, reason, { loanId: loan._id, opId: a.opId });
    const versions = { loanVersionBefore: loan.version, loanVersionAfter: loan.version + 1 };
    await rememberOperation(ctx, access, a.opId, "payment.record", paymentId, versions);
    return { paymentId, duplicate: false, ...versions };
  },
});

/** An admin confirms a collector's payment reached them: it becomes a
 *  payment, dated the day it was collected, with its receipt number. */
export const confirm = mutation({
  args: { businessId: v.id("businesses"), pendingId: v.id("pendingPayments") },
  handler: async (ctx, a): Promise<{ paymentId: Id<"payments"> }> => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const p = await ctx.db.get(a.pendingId);
    if (!p || p.businessId !== a.businessId) fail("not_found", { table: "pendingPayments" });
    if (p.status !== "waiting") fail("already_decided", { status: p.status });
    const loan = await ownRecord(ctx, access, "loans", p.loanId);
    if (loan.status !== "active") fail("loan_closed");
    const now = Date.now();
    const paymentId = await ctx.db.insert("payments", {
      businessId: a.businessId,
      loanId: loan._id,
      recordNo: p.recordNo,
      paidOn: p.paidOn,
      amount: p.amount,
      notes: p.notes,
      paidWith: p.paidWith,
      mode: p.mode,
      targetSeq: p.targetSeq,
      targets: p.targets,
      custom: p.custom,
      feeInput: p.fee,
      // Placeholder split; reallocate() works out the real one below.
      principal: p.amount - p.fee,
      interest: 0,
      fee: p.fee,
      applied: [],
      recordedOffline: p.recordedOffline,
      deviceRecordedAt: p.deviceRecordedAt,
      createdAt: now,
      // The history says who collected it.
      createdBy: p.collectedBy,
      updatedAt: now,
      version: 1,
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    const saved = (await ctx.db.get(paymentId))!;
    const d = new Diff()
      .added("amount", p.amount)
      .added("paid_on", p.paidOn)
      .added("allocation", describe(saved))
      .added("principal", saved.principal)
      .added("interest", saved.interest)
      .added("fee", saved.fee)
      .added("notes", p.notes);
    await logChange(ctx, access, "payment", paymentId, "create", d, `Collected by ${p.collectorName}; confirmed by ${access.name}`, { loanId: loan._id });
    await ctx.db.patch(p._id, { status: "confirmed", paymentId, decidedBy: access.userId, decidedAt: now });
    const client = await ctx.db.get(p.clientId);
    await notify(ctx, a.businessId, [p.collectedBy], {
      kind: "confirmed",
      clientNames: [client?.fullName ?? ""],
      fromName: access.name,
      amount: p.amount,
      pendingId: p._id,
    });
    return { paymentId };
  },
});

/** An admin turns down a collector's payment (it never reached them, it was
 *  entered twice…). It never counted, so nothing else changes; the
 *  collector is told why. */
export const reject = mutation({
  args: { businessId: v.id("businesses"), pendingId: v.id("pendingPayments"), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const reason = text("reason", a.reason, 500, { required: true });
    const p = await ctx.db.get(a.pendingId);
    if (!p || p.businessId !== a.businessId) fail("not_found", { table: "pendingPayments" });
    if (p.status !== "waiting") fail("already_decided", { status: p.status });
    const now = Date.now();
    await ctx.db.patch(p._id, { status: "rejected", reason, decidedBy: access.userId, decidedAt: now });
    const d = new Diff().removed("amount", p.amount).removed("paid_on", p.paidOn).removed("notes", p.notes);
    await logChange(ctx, access, "payment", p._id, "delete", d, `Collected by ${p.collectorName}; rejected: ${reason}`, { loanId: p.loanId });
    const client = await ctx.db.get(p.clientId);
    await notify(ctx, a.businessId, [p.collectedBy], {
      kind: "rejected",
      clientNames: [client?.fullName ?? ""],
      fromName: access.name,
      amount: p.amount,
      reason,
      pendingId: p._id,
    });
  },
});

export const update = mutation({
  args: {
    businessId: v.id("businesses"),
    paymentId: v.id("payments"),
    expectedVersion: v.number(),
    amount: v.number(),
    fee: v.number(),
    paidOn: v.string(),
    notes: v.string(),
    /** Left out (older apps): kept as it was. */
    paidWith: v.optional(paidWith),
    instruction,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "payments", a.paymentId);
    checkVersion(old, a.expectedVersion);
    amount("amount", a.amount);
    amount("fee", a.fee, { allowZero: true });
    if (a.fee > a.amount) fail("invalid", { field: "fee", reason: "fee_too_large" });
    const paidOn = day("paidOn", a.paidOn);
    notFuture("paidOn", paidOn, access.today);
    const notes = text("notes", a.notes, 2000);
    const loan = await ownRecord(ctx, access, "loans", old.loanId);
    const installments = hasInstallments(loan.method);
    if (installments && a.fee > 0) fail("invalid", { field: "fee", reason: "automatic_late_fees" });
    if (!installments && a.instruction.kind !== "auto") fail("invalid", { field: "instruction", reason: "no_installments" });
    checkInstruction(a.instruction, a.amount);
    const fields = instructionFields(a.instruction);
    const d = new Diff()
      .field("amount", old.amount, a.amount)
      .field("fee", old.feeInput, a.fee)
      .field("paid_on", old.paidOn, paidOn)
      .field("allocation", describe(old), describe(fields))
      .field("paid_with", old.paidWith ?? "", a.paidWith ?? old.paidWith ?? "")
      .field("notes", old.notes, notes);
    if (d.empty) return;
    await ctx.db.patch(old._id, {
      amount: a.amount,
      feeInput: a.fee,
      paidOn,
      notes,
      ...(a.paidWith ? { paidWith: a.paidWith } : {}),
      ...fields,
      version: old.version + 1,
      updatedAt: Date.now(),
    });
    await reallocate(ctx, access, loan._id);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, loan._id);
    await logChange(ctx, access, "payment", old._id, "update", d, text("reason", a.reason, 2000), { loanId: loan._id });
  },
});

export const remove = mutation({
  args: { businessId: v.id("businesses"), paymentId: v.id("payments"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "payments", a.paymentId);
    checkVersion(old, a.expectedVersion);
    const d = new Diff()
      .removed("amount", old.amount)
      .removed("interest", old.interest)
      .removed("principal", old.principal)
      .removed("fee", old.fee)
      .removed("paid_on", old.paidOn)
      .removed("notes", old.notes);
    await ctx.db.delete(old._id);
    await reallocate(ctx, access, old.loanId);
    await checkCash(ctx, a.businessId);
    await touchLoan(ctx, old.loanId);
    await logChange(ctx, access, "payment", old._id, "delete", d, text("reason", a.reason, 2000), { loanId: old.loanId });
  },
});
