// Receipt parts switched on or off in Settings are kept with the business,
// and a save from an older app that doesn't know about them keeps them.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };

const parts = { loanNumber: true, amountLent: false, rate: true, cycle: true, installments: true, split: false, lateFees: true, balance: true, history: false };

describe("Caribbean guilder", () => {
  it("is accepted for a new business and as a business's currency", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const businessId = await asAna.mutation(api.businesses.create, { name: "Kòrsou", timezone: "America/Curacao", language: "es", currencyCode: "XCG" });
    const s = (await t.run((ctx) => ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", businessId)).unique()))!;
    expect(s.currencyCode).toBe("XCG");
    // And an existing business can switch to it; nothing is converted.
    const other = await asAna.mutation(api.businesses.create, { name: "Otra", timezone: "America/Curacao", language: "es", currencyCode: "DOP" });
    const o = (await t.run((ctx) => ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", other)).unique()))!;
    const { _id, _creationTime, businessId: _b, updatedAt, version, logoId, ...rest } = o;
    void _id; void _creationTime; void _b; void updatedAt; void logoId;
    await asAna.mutation(api.settings.update, { ...rest, businessId: other, expectedVersion: version, currencyCode: "XCG" });
    const after = (await t.run((ctx) => ctx.db.get(o._id)))!;
    expect(after.currencyCode).toBe("XCG");
  });
});

describe("settings.update receipt parts", () => {
  it("stores the switches, and an older app's save keeps them", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const businessId = await asAna.mutation(api.businesses.create, { name: "Prueba", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
    const read = () => t.run((ctx) => ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", businessId)).unique());
    const s = (await read())!;
    // New businesses have no switches stored: every part prints.
    expect(s.receiptShow).toBeUndefined();

    const base = {
      businessId,
      receiptName: s.receiptName,
      companyAddress: s.companyAddress,
      companyPhone: s.companyPhone,
      receiptCompany: s.receiptCompany,
      receiptClient: s.receiptClient,
      receiptText: s.receiptText,
      currencyCode: s.currencyCode,
      numberStyle: s.numberStyle,
      dateStyle: s.dateStyle,
      language: s.language,
      defaultRate: s.defaultRate,
      defaultFrequency: s.defaultFrequency,
      lateFeeRate: s.lateFeeRate,
      receiptAfterPayment: s.receiptAfterPayment,
      receiptAfterLoan: s.receiptAfterLoan,
    };
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: s.version, receiptShow: parts });
    const saved = (await read())!;
    expect(saved.receiptShow).toEqual(parts);

    // An app from before the switches sends none: they stay as they were.
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: saved.version, receiptName: "Otro nombre" });
    const after = (await read())!;
    expect(after.receiptName).toBe("Otro nombre");
    expect(after.receiptShow).toEqual(parts);

    // The payment receipt format: unset is the full schedule; a save without
    // it (an older app) keeps the business's choice.
    expect(after.receiptFormat).toBeUndefined();
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: after.version, receiptFormat: "next" });
    const chosen = (await read())!;
    expect(chosen.receiptFormat).toBe("next");
    await asAna.mutation(api.settings.update, { ...base, expectedVersion: chosen.version, receiptName: "Tercero" });
    expect((await read())!.receiptFormat).toBe("next");
  });
});
