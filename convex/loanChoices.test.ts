// Version 0.15: each loan's way of charging late fees and part of its
// interest reinvested (from the business's defaults unless given), and
// "Lend and add capital" in one save.

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { todayIn } from "../shared/domain/dates";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TZ = "America/Santo_Domingo";
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };

async function errorOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as Record<string, unknown>;
    throw e;
  }
  throw new Error("expected the call to fail");
}

const terms = (start: string) => ({
  principal: 1_000_000,
  rate: 100_000,
  interestPeriod: "monthly" as const,
  frequency: "monthly" as const,
  startDate: start,
  method: "declining" as const,
  installments: 5,
  lateFeeRate: 50_000,
});

async function setup() {
  const t = convexTest(schema, modules);
  const asAna = t.withIdentity(ana);
  const businessId = await asAna.mutation(api.businesses.create, { name: "Ana Préstamos", timezone: TZ, language: "es", currencyCode: "DOP" });
  const { clientId } = await asAna.mutation(api.clients.create, {
    businessId, opId: "op-choices-client-01", fullName: "Marta Quiroga", phone: "", email: "", idNumber: "", address: "", notes: "",
  });
  const today = todayIn(TZ);
  return { t, asAna, businessId, clientId, today };
}

describe("loan choices (0.15)", () => {
  it("lends and adds the missing capital in one save, or refuses without it", async () => {
    const { asAna, businessId, clientId, today } = await setup();
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 400_000, occurredOn: today, notes: "" });
    // 10,000 with 4,000 in hand: refused as before.
    expect(await errorOf(asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "" }))).toMatchObject({
      code: "insufficient_cash",
    });
    // With the 6,000 it's short of, both are saved.
    const loanId = await asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "", addCapital: 600_000 });
    const snap = await asAna.query(api.data.snapshot, { businessId });
    const added = snap.capital.find((c) => c.amount === 600_000)!;
    expect(added).toMatchObject({ kind: "contribution", occurredOn: today, notes: "Added to lend to Marta Quiroga" });
    expect(snap.loans.find((l) => l._id === loanId)).toBeTruthy();
    // Never more than the loan itself.
    expect(
      await errorOf(asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "", addCapital: 2_000_000 })),
    ).toMatchObject({ code: "invalid", field: "addCapital" });
  });

  it("takes the business's defaults, and keeps a reinvest change from its day on", async () => {
    const { t, asAna, businessId, clientId, today } = await setup();
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 5_000_000, occurredOn: today, notes: "" });
    // No defaults yet: today's way, all interest kept as profit.
    const plain = await asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "" });
    // The business picks way B and 60% reinvested for new loans.
    await t.run(async (ctx) => {
      const s = await ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", businessId)).unique();
      await ctx.db.patch(s!._id, { lateFeeMode: "monthly", defaultReinvest: 60 });
    });
    const chosen = await asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "" });
    const own = await asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(today), schedule: null, notes: "", lateFeeMode: "balance", reinvest: 0 });
    let snap = await asAna.query(api.data.snapshot, { businessId });
    const loan = (id: string) => snap.loans.find((l) => l._id === id)!;
    expect([loan(plain).lateFeeMode, loan(plain).reinvest]).toEqual(["installment", []]);
    expect([loan(chosen).lateFeeMode, loan(chosen).reinvest]).toEqual(["monthly", [{ from: today, percent: 60 }]]);
    expect([loan(own).lateFeeMode, loan(own).reinvest]).toEqual(["balance", []]);

    // Changing it on the loan applies from today; an older app's save keeps it.
    const l = loan(plain);
    const base = { businessId, loanId: plain, clientId, terms: terms(today), schedule: null, notes: "", reason: "" };
    await asAna.mutation(api.loans.update, { ...base, expectedVersion: l.version, reinvest: 100 });
    snap = await asAna.query(api.data.snapshot, { businessId });
    expect(loan(plain).reinvest).toEqual([{ from: today, percent: 100 }]);
    await asAna.mutation(api.loans.update, { ...base, notes: "older app", expectedVersion: loan(plain).version });
    snap = await asAna.query(api.data.snapshot, { businessId });
    expect(loan(plain).reinvest).toEqual([{ from: today, percent: 100 }]);
    expect(await errorOf(asAna.mutation(api.loans.update, { ...base, expectedVersion: loan(plain).version, reinvest: 101 }))).toMatchObject({
      code: "invalid",
      field: "reinvest",
    });
  });
});
