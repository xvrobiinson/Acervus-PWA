// The desktop import (convex/imports.ts) with a real desktop export:
// `fixtures/desktop-demo.json` is the desktop's `seed_demo` book plus every
// payment mode, a waived late fee, a defaulted loan and an archived client, run through
// `export_for_cloud` and `scripts/import-desktop.mjs --json` (demo data only).

import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import demo from "./fixtures/desktop-demo.json";
import type { DesktopBook } from "./imports";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "user_owner", email: "owner@example.com", emailVerified: true, name: "Owner" };
const fixture = demo as unknown as { book: DesktopBook; expected: { asOf: string; summary: Record<string, number>; loans: Record<string, number>[] } };

const copy = () => structuredClone(fixture);

async function errorOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConvexError) return e.data as Record<string, unknown>;
    throw e;
  }
  throw new Error("expected the call to fail");
}

describe("desktop import", () => {
  beforeEach(() => {
    // The figures are the desktop's as of this day, at noon in the business's
    // time zone (UTC−4).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${fixture.expected.asOf}T16:00:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  it("imports the whole book when every split and figure matches the desktop", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(owner);
    const r = await asOwner.mutation(api.imports.desktopBook, copy());
    expect(r.summary).toMatchObject(fixture.expected.summary);

    const snap = await asOwner.query(api.data.snapshot, { businessId: r.businessId });
    expect(snap.me.role).toBe("admin");
    expect(snap.business.name).toBe(fixture.book.business.name);
    expect(snap.clients.map((c) => c.recordNo).sort()).toEqual(fixture.book.clients.map((c) => c.no).sort());
    expect(snap.loans).toHaveLength(fixture.book.loans.length);
    expect(snap.payments).toHaveLength(fixture.book.payments.length);
    expect(snap.lateFees).toHaveLength(fixture.book.lateFees.length);
    // Receipt numbers stay the desktop's.
    const pay = snap.payments.find((p) => p.recordNo === fixture.book.payments[0].no)!;
    expect(pay.amount).toBe(fixture.book.payments[0].amount);

    // New records are numbered after every imported one.
    const maxNo = Math.max(...[fixture.book.clients, fixture.book.loans, fixture.book.payments].flat().map((x) => x.no));
    const created = await asOwner.mutation(api.clients.create, {
      businessId: r.businessId,
      opId: "op-after-import-000001",
      fullName: "Nuevo Cliente",
      phone: "",
      email: "",
      idNumber: "",
      address: "",
      notes: "",
    });
    const after = await asOwner.query(api.data.snapshot, { businessId: r.businessId });
    expect(after.clients.find((c) => c._id === created.clientId)!.recordNo).toBeGreaterThan(maxNo);
  });

  it("keeps nothing when a stored split differs from the engine's", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(owner);
    const book = copy();
    const p = book.book.payments.find((p) => p.interest > 0 && p.principal > 0)!;
    p.interest -= 100;
    p.principal += 100;
    for (const a of p.applied) {
      if (a.interest >= 100) {
        a.interest -= 100;
        a.principal += 100;
        break;
      }
    }
    const err = await errorOf(asOwner.mutation(api.imports.desktopBook, book));
    expect(err.code).toBe("import_mismatch");
    expect(String((err.differences as string[])[0])).toContain(`loan ${p.loanNo}`);
    expect(await asOwner.query(api.businesses.mine, {})).toEqual([]);
  });

  it("keeps nothing when a desktop figure differs", async () => {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(owner);
    const book = copy();
    book.expected.summary.portfolioValue += 1;
    const err = await errorOf(asOwner.mutation(api.imports.desktopBook, book));
    expect(err).toMatchObject({ code: "import_mismatch", differences: [expect.stringContaining("summary.portfolioValue")] });
    expect(await asOwner.query(api.businesses.mine, {})).toEqual([]);
  });

  it("refuses figures from another day", async () => {
    vi.setSystemTime(new Date(`${fixture.expected.asOf}T16:00:00Z`).getTime() + 24 * 60 * 60_000);
    const t = convexTest(schema, modules);
    const err = await errorOf(t.withIdentity(owner).mutation(api.imports.desktopBook, copy()));
    expect(err).toMatchObject({ code: "import_stale", exportedOn: fixture.expected.asOf });
  });

  it("needs a signed-in user", async () => {
    const t = convexTest(schema, modules);
    expect((await errorOf(t.mutation(api.imports.desktopBook, copy()))).code).toBe("unauthenticated");
  });
});

describe("restoring a backup", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${fixture.expected.asOf}T16:00:00Z`));
  });
  afterEach(() => vi.useRealTimers());

  /** A business made from the fixture, with one client added after it (as
   *  if recorded after the backup was made). */
  async function business() {
    const t = convexTest(schema, modules);
    const asOwner = t.withIdentity(owner);
    const { businessId } = await asOwner.mutation(api.imports.desktopBook, copy());
    const later = await asOwner.mutation(api.clients.create, {
      businessId,
      opId: "op-after-backup-000001",
      fullName: "Cliente Nuevo",
      phone: "",
      email: "",
      idNumber: "",
      address: "",
      notes: "",
    });
    const name = (await t.run((ctx) => ctx.db.get(businessId)))!.name;
    return { t, asOwner, businessId, later, name };
  }
  const restore = (businessId: string, confirmName: string) => ({
    businessId: businessId as never,
    confirmName,
    backupDate: "2026-11-01",
    ...copy(),
  });

  it("puts the backup's books back for everyone, keeping collectors and record numbers", async () => {
    const { t, asOwner, businessId, later, name } = await business();
    const first = fixture.book.clients[0].no;
    await t.run(async (ctx) => {
      const c = (await ctx.db.query("clients").collect()).find((c) => c.recordNo === first)!;
      await ctx.db.patch(c._id, { collectorId: "user_collector" });
    });
    const laterNo = (await asOwner.query(api.data.snapshot, { businessId })).clients.find((c) => c._id === later.clientId)!.recordNo;

    await asOwner.mutation(api.imports.restoreBook, restore(businessId, ` ${name} `));
    const snap = await asOwner.query(api.data.snapshot, { businessId });
    expect(snap.clients.map((c) => c.recordNo).sort()).toEqual(fixture.book.clients.map((c) => c.no).sort());
    expect(snap.loans).toHaveLength(fixture.book.loans.length);
    expect(snap.payments).toHaveLength(fixture.book.payments.length);
    const restored = await t.run((ctx) => ctx.db.query("clients").collect());
    expect(restored.find((c) => c.recordNo === first)!.collectorId).toBe("user_collector");
    // The history says so, and a new record never reuses a number given before.
    const log = await t.run((ctx) => ctx.db.query("changeLog").collect());
    expect(log.some((c) => c.reason === "Books restored from a backup of 2026-11-01")).toBe(true);
    const again = await asOwner.mutation(api.clients.create, {
      businessId,
      opId: "op-after-restore-000001",
      fullName: "Otro",
      phone: "",
      email: "",
      idNumber: "",
      address: "",
      notes: "",
    });
    const after = await asOwner.query(api.data.snapshot, { businessId });
    expect(after.clients.find((c) => c._id === again.clientId)!.recordNo).toBeGreaterThan(laterNo);
  });

  it("changes nothing without the business's exact name", async () => {
    const { asOwner, businessId, name } = await business();
    const before = await asOwner.query(api.data.snapshot, { businessId });
    const err = await errorOf(asOwner.mutation(api.imports.restoreBook, restore(businessId, name.toLowerCase() + "x")));
    expect(err.code).toBe("invalid");
    expect((await asOwner.query(api.data.snapshot, { businessId })).clients).toHaveLength(before.clients.length);
  });

  it("changes nothing when the backup's figures don't add up", async () => {
    const { asOwner, businessId, name } = await business();
    const before = await asOwner.query(api.data.snapshot, { businessId });
    const args = restore(businessId, name);
    args.expected.summary.portfolioValue += 1;
    expect((await errorOf(asOwner.mutation(api.imports.restoreBook, args))).code).toBe("import_mismatch");
    const now = await asOwner.query(api.data.snapshot, { businessId });
    expect(now.clients).toHaveLength(before.clients.length);
    expect(now.payments).toHaveLength(before.payments.length);
  });

  it("is for admins only", async () => {
    const { t, businessId, name } = await business();
    const viewer = { subject: "user_viewer", email: "viewer@example.com", emailVerified: true, name: "Viewer" };
    await t.run((ctx) =>
      ctx.db.insert("members", { businessId, userId: viewer.subject, email: viewer.email, name: viewer.name, role: "viewer", active: true, joinedAt: 0 }),
    );
    const err = await errorOf(t.withIdentity(viewer).mutation(api.imports.restoreBook, restore(businessId, name)));
    expect(err.code).toBe("forbidden");
  });
});
