// Each person's own choices (the Overview hero, Interest earned's period)
// are theirs alone, checked on save, and gone with the account.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };
const ben = { subject: "user_ben", email: "ben@example.com", emailVerified: true, name: "Ben" };
const hero = JSON.stringify([{ big: "portfolio", rows: ["gain6m", "none"] }, { big: "none", rows: ["none", "none"] }]);

describe("prefs", () => {
  it("saves and reads back the person's own choices only", async () => {
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(ana).query(api.prefs.mine, {})).toEqual({ hero: null, interestPeriod: null, tour: null });
    await t.withIdentity(ana).mutation(api.prefs.save, { hero });
    await t.withIdentity(ana).mutation(api.prefs.save, { interestPeriod: "week" });
    expect(await t.withIdentity(ana).query(api.prefs.mine, {})).toEqual({ hero, interestPeriod: "week", tour: null });
    expect(await t.withIdentity(ben).query(api.prefs.mine, {})).toEqual({ hero: null, interestPeriod: null, tour: null });
  });

  it("keeps whether the welcome tour was finished or skipped", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    await asAna.mutation(api.prefs.save, { tour: "skipped:1" });
    expect((await asAna.query(api.prefs.mine, {})).tour).toBe("skipped:1");
    await asAna.mutation(api.prefs.save, { tour: "done:1" });
    expect((await asAna.query(api.prefs.mine, {})).tour).toBe("done:1");
    await expect(asAna.mutation(api.prefs.save, { tour: "maybe" })).rejects.toThrow();
  });

  it("refuses odd layouts, unknown periods and anonymous calls", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    await expect(asAna.mutation(api.prefs.save, { hero: "not json" })).rejects.toThrow();
    await expect(asAna.mutation(api.prefs.save, { hero: JSON.stringify([{ big: "<script>", rows: ["a", "b"] }]) })).rejects.toThrow();
    await expect(asAna.mutation(api.prefs.save, { hero: JSON.stringify(Array(5).fill({ big: "a", rows: ["a", "b"] })) })).rejects.toThrow();
    await expect(asAna.mutation(api.prefs.save, { interestPeriod: "decade" })).rejects.toThrow();
    await expect(t.query(api.prefs.mine, {})).rejects.toThrow();
    await expect(t.mutation(api.prefs.save, { hero })).rejects.toThrow();
  });
});
