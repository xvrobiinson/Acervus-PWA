// Collectors and their clients: who sees what, payments that wait for an
// admin's confirmation, assigning clients, and the messages each person gets.

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, todayIn } from "../shared/domain/dates";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const TZ = "America/Santo_Domingo";
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };
const carla = { subject: "user_carla", email: "carla@example.com", emailVerified: true, name: "Carla" };
const luis = { subject: "user_luis", email: "luis@example.com", emailVerified: true, name: "Luis" };
const dario = { subject: "user_dario", email: "dario@example.com", emailVerified: true, name: "Darío" };

type T = ReturnType<typeof convexTest>;

async function errorOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as Record<string, unknown>;
    throw e;
  }
  throw new Error("expected the call to fail");
}

let n = 0;
const op = () => `op-${Date.now()}-${++n}-collect`;
const today = todayIn(TZ);
const blank = { phone: "", email: "", idNumber: "", address: "", notes: "" };
const terms = (start: string, method: "declining" | "interest_only", count: number | null) => ({
  principal: 1_000_000,
  rate: 100_000,
  interestPeriod: "monthly" as const,
  frequency: "monthly" as const,
  startDate: start,
  method,
  installments: count,
  lateFeeRate: 50_000,
});

/** Ana (admin) with Carla and Luis (collectors) and Darío (viewer). */
async function team(t: T) {
  process.env.SITE_URL = "https://app.example.com";
  const asAna = t.withIdentity(ana);
  const businessId = await asAna.mutation(api.businesses.create, { name: "Ana Préstamos", timezone: TZ, language: "es", currencyCode: "DOP" });
  for (const [who, role] of [[carla, "collector"], [luis, "collector"], [dario, "viewer"]] as const) {
    const { url } = await asAna.action(api.invites.create, { businessId, email: who.email, role });
    await t.withIdentity(who).mutation(api.invites.accept, { token: url.split("#token=")[1] });
  }
  await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 50_000_000, occurredOn: addMonths(today, -3), notes: "" });
  const client = async (fullName: string) =>
    (await asAna.mutation(api.clients.create, { businessId, opId: op(), fullName, ...blank })).clientId;
  const loan = (clientId: Id<"clients">, t2 = terms(addMonths(today, -1), "interest_only", null)) =>
    asAna.mutation(api.loans.create, { businessId, clientId, terms: t2, schedule: null, notes: "" });
  return { asAna, asCarla: t.withIdentity(carla), asLuis: t.withIdentity(luis), asDario: t.withIdentity(dario), businessId, client, loan };
}

describe("collectors", () => {
  let t: T;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("see only the clients assigned to them", async () => {
    const { asAna, asCarla, asDario, businessId, client, loan } = await team(t);
    const mine = await client("Para Carla");
    const luisOnly = await client("Para Luis");
    await client("Sin cobrador");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [mine], collectorId: carla.subject });
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [luisOnly], collectorId: luis.subject });
    const hidden = await loan(luisOnly);
    await loan(mine);
    await asAna.mutation(api.money.addEntry, {
      businessId, opId: op(), kind: "expense", account: "capital", amount: 1_000, occurredOn: today, description: "Gasolina",
    });

    const snap = await asCarla.query(api.data.snapshot, { businessId });
    expect(snap.clients.map((c) => c.fullName)).toEqual(["Para Carla"]);
    expect(snap.loans).toHaveLength(1);
    expect(snap.capital).toEqual([]);
    expect(snap.entries).toEqual([]);
    expect(snap.people.filter((p) => p.userId !== carla.subject).every((p) => p.email === "")).toBe(true);
    // Nor through the history or the team list.
    expect(await errorOf(asCarla.query(api.data.changes, { businessId, loanId: hidden, paginationOpts: { numItems: 10, cursor: null } }))).toMatchObject({
      code: "not_found",
    });
    expect(await errorOf(asCarla.query(api.data.changes, { businessId, paginationOpts: { numItems: 10, cursor: null } }))).toMatchObject({ code: "forbidden" });
    expect((await asCarla.query(api.businesses.members, { businessId })).filter((m) => m.email !== "").map((m) => m.email)).toEqual([carla.email]);
    // Viewers and admins see everything.
    expect((await asDario.query(api.data.snapshot, { businessId })).clients).toHaveLength(3);
    expect((await asAna.query(api.data.snapshot, { businessId })).capital).toHaveLength(1);
  });

  it("can't collect from someone else's client; the clients they add are theirs", async () => {
    const { asAna, asCarla, businessId, client, loan } = await team(t);
    const other = await client("De Luis");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [other], collectorId: luis.subject });
    const loanId = await loan(other);
    expect(
      await errorOf(asCarla.mutation(api.payments.record, {
        businessId, opId: op(), loanId, loanVersion: 1, amount: 10_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
      })),
    ).toMatchObject({ code: "not_found" });
    const { clientId } = await asCarla.mutation(api.clients.create, { businessId, opId: op(), fullName: "Nuevo", ...blank });
    const c = await t.run((ctx) => ctx.db.get(clientId));
    expect(c?.collectorId).toBe(carla.subject);
  });

  it("their payments count only once an admin confirms them, from the day they were collected", async () => {
    const { asAna, asCarla, businessId, client, loan } = await team(t);
    const clientId = await client("María");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [clientId], collectorId: carla.subject });
    const loanId = await loan(clientId);
    const collectedOn = addDays(today, -2);
    const args = {
      businessId, opId: op(), loanId, loanVersion: 1, amount: 10_000, fee: 0, paidOn: collectedOn, notes: "", instruction: { kind: "auto" as const },
    };
    const r = await asCarla.mutation(api.payments.record, args);
    expect(r.pendingId).toBeDefined();
    expect(r.paymentId).toBeUndefined();
    // Sent again (a lost reply): the same pending payment.
    expect(await asCarla.mutation(api.payments.record, args)).toMatchObject({ pendingId: r.pendingId, duplicate: true });

    // Nothing counts yet, for anyone.
    const before = await asAna.query(api.data.snapshot, { businessId });
    expect(before.payments).toEqual([]);
    expect(before.pending.map((p) => p.status)).toEqual(["waiting"]);
    expect((await asCarla.query(api.data.snapshot, { businessId })).pending).toHaveLength(1);
    const told = await asAna.query(api.messages.mine, { businessId });
    expect(told[0]).toMatchObject({ kind: "collected", fromName: "Carla", clientNames: ["María"], amount: 10_000 });

    const { paymentId } = await asAna.mutation(api.payments.confirm, { businessId, pendingId: r.pendingId! });
    const after = await asAna.query(api.data.snapshot, { businessId });
    const pay = after.payments.find((p) => p._id === paymentId)!;
    expect(pay).toMatchObject({ paidOn: collectedOn, amount: 10_000, createdBy: carla.subject, recordNo: before.pending[0].recordNo });
    expect(after.pending[0]).toMatchObject({ status: "confirmed", paymentId });
    expect((await asCarla.query(api.messages.mine, { businessId }))[0]).toMatchObject({ kind: "confirmed", amount: 10_000 });
    expect(await errorOf(asAna.mutation(api.payments.confirm, { businessId, pendingId: r.pendingId! }))).toMatchObject({ code: "already_decided" });
    // Only admins decide.
    const r2 = await asCarla.mutation(api.payments.record, { ...args, opId: op() });
    expect(await errorOf(asCarla.mutation(api.payments.confirm, { businessId, pendingId: r2.pendingId! }))).toMatchObject({ code: "forbidden" });
  });

  it("a rejected payment never counts, and the collector is told why", async () => {
    const { asAna, asCarla, businessId, client, loan } = await team(t);
    const rosa = await client("Rosa");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [rosa], collectorId: carla.subject });
    const loanId = await loan(rosa);
    const { pendingId } = await asCarla.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: 1, amount: 5_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
    });
    expect(await errorOf(asAna.mutation(api.payments.reject, { businessId, pendingId: pendingId!, reason: " " }))).toMatchObject({ code: "invalid" });
    await asAna.mutation(api.payments.reject, { businessId, pendingId: pendingId!, reason: "Recorded twice" });
    const snap = await asAna.query(api.data.snapshot, { businessId });
    expect(snap.payments).toEqual([]);
    expect(snap.pending[0]).toMatchObject({ status: "rejected", reason: "Recorded twice" });
    expect((await asCarla.query(api.messages.mine, { businessId }))[0]).toMatchObject({ kind: "rejected", reason: "Recorded twice" });
  });

  it("each collector's switches hide what the admin chose, for that collector only", async () => {
    const { asAna, asCarla, asLuis, businessId, client, loan } = await team(t);
    const { clientId: a } = await asAna.mutation(api.clients.create, { businessId, opId: op(), fullName: "Con datos", ...blank, phone: "809-555-0101", idNumber: "001", address: "Calle 1" });
    const b = await client("Otro");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [a], collectorId: carla.subject });
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [b], collectorId: luis.subject });
    await loan(a);
    const members = await asAna.query(api.businesses.members, { businessId });
    const memberId = members.find((m) => m.userId === carla.subject)!._id;
    // Everything shows until an admin says otherwise.
    expect((await asCarla.query(api.data.snapshot, { businessId })).clients[0]).toMatchObject({ phone: "809-555-0101", idNumber: "001" });
    const view = { amountLent: false, rate: false, contact: false, idNumber: false, history: false, lateFees: true };
    await asAna.mutation(api.businesses.setCollectorView, { businessId, memberId, view });
    const snap = await asCarla.query(api.data.snapshot, { businessId });
    expect(snap.clients[0]).toMatchObject({ phone: "", email: "", address: "", idNumber: "" });
    expect(snap.me.view).toEqual(view);
    expect(snap.settings?.receiptShow).toMatchObject({ amountLent: false, rate: false, history: false, lateFees: true, balance: true });
    // Another collector and the admin are unaffected; the record itself is untouched.
    expect((await asLuis.query(api.data.snapshot, { businessId })).me.view.rate).toBe(true);
    expect((await asAna.query(api.data.snapshot, { businessId })).clients.find((c) => c._id === a)).toMatchObject({ phone: "809-555-0101", idNumber: "001" });
    // Only admins set them, and only on collectors.
    expect(await errorOf(asCarla.mutation(api.businesses.setCollectorView, { businessId, memberId, view }))).toMatchObject({ code: "forbidden" });
    const adminId = members.find((m) => m.userId === ana.subject)!._id;
    expect(await errorOf(asAna.mutation(api.businesses.setCollectorView, { businessId, memberId: adminId, view }))).toMatchObject({ code: "invalid" });
  });

  it("admins' own payments count right away", async () => {
    const { asAna, businessId, client, loan } = await team(t);
    const loanId = await loan(await client("Pedro"));
    const r = await asAna.mutation(api.payments.record, {
      businessId, opId: op(), loanId, loanVersion: 1, amount: 10_000, fee: 0, paidOn: today, notes: "", instruction: { kind: "auto" },
    });
    expect(r.paymentId).toBeDefined();
    expect((await asAna.query(api.data.snapshot, { businessId })).payments).toHaveLength(1);
  });

  it("assigning tells the new and the old collector, and only collectors or admins can be given clients", async () => {
    const { asAna, asCarla, asLuis, businessId, client } = await team(t);
    const a = await client("Uno");
    const b = await client("Dos");
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [a, b], collectorId: carla.subject });
    expect((await asCarla.query(api.messages.mine, { businessId }))[0]).toMatchObject({ kind: "assigned", clientNames: ["Uno", "Dos"], fromName: "Ana" });
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [b], collectorId: luis.subject });
    expect((await asCarla.query(api.messages.mine, { businessId }))[0]).toMatchObject({ kind: "unassigned", clientNames: ["Dos"] });
    expect((await asLuis.query(api.messages.mine, { businessId }))[0]).toMatchObject({ kind: "assigned", clientNames: ["Dos"] });
    // The admin can be the collector; a viewer can't.
    await asAna.mutation(api.clients.assign, { businessId, clientIds: [a], collectorId: ana.subject });
    expect(await errorOf(asAna.mutation(api.clients.assign, { businessId, clientIds: [a], collectorId: dario.subject }))).toMatchObject({
      code: "invalid",
    });
    // Someone who leaves the team gives their clients back.
    const members = await asAna.query(api.businesses.members, { businessId });
    await asAna.mutation(api.businesses.removeMember, { businessId, memberId: members.find((m) => m.userId === luis.subject)!._id, reason: "" });
    expect((await t.run((ctx) => ctx.db.get(b)))?.collectorId).toBeUndefined();
  });

  it("admins are reminded to assign a collector a few days before a payment is due", async () => {
    const { asAna, businessId, client, loan } = await team(t);
    const nobody = await client("Yolanda");
    // First installment due in two days.
    await loan(nobody, terms(addMonths(addDays(today, 2), -1), "declining", 6));
    await t.mutation(internal.messages.remindBusiness, { businessId });
    await t.mutation(internal.messages.remindBusiness, { businessId });
    const due = (await asAna.query(api.messages.mine, { businessId })).filter((m) => m.kind === "due_unassigned");
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ clientNames: ["Yolanda"], dueOn: addDays(today, 2) });
    await asAna.mutation(api.messages.markRead, { businessId });
    expect((await asAna.query(api.messages.mine, { businessId })).every((m) => m.readAt !== undefined)).toBe(true);
  });

  it("a business without collectors gets no reminders: every client is the admin's", async () => {
    const t2 = convexTest(schema, modules);
    const asAna = t2.withIdentity(ana);
    const businessId = await asAna.mutation(api.businesses.create, { name: "Sola", timezone: TZ, language: "es", currencyCode: "DOP" });
    await asAna.mutation(api.money.addCapital, { businessId, kind: "contribution", amount: 50_000_000, occurredOn: addMonths(today, -3), notes: "" });
    const { clientId } = await asAna.mutation(api.clients.create, { businessId, opId: op(), fullName: "Yolanda", ...blank });
    await asAna.mutation(api.loans.create, { businessId, clientId, terms: terms(addMonths(addDays(today, 2), -1), "declining", 6), schedule: null, notes: "" });
    expect(await t2.mutation(internal.messages.remindBusiness, { businessId })).toBe(0);
  });
});
