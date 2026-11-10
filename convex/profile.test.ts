// The person's own name and photo (account.profile, setName, setPhoto,
// removePhoto): theirs alone, checked on save, never their email as a name.

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ana = { subject: "user_ana", email: "ana@example.com", emailVerified: true, name: "Ana" };
const noName = { subject: "user_ben", email: "ben@example.com", emailVerified: true, name: "ben@example.com" };

describe("profile", () => {
  it("shows the sign-in's name, but never the email address as a name", async () => {
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(ana).query(api.account.profile, {})).toEqual({ email: "ana@example.com", name: "Ana", photoUrl: null });
    expect((await t.withIdentity(noName).query(api.account.profile, {})).name).toBe("");
  });

  it("keeps the name the person gives, and their teams show it", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.run(async (ctx) => {
      const b = await ctx.db.insert("businesses", { name: "Préstamos", timezone: "America/Santo_Domingo", createdBy: "user_ben", createdAt: 0, nextRecordNo: 1 } as never);
      await ctx.db.insert("members", { businessId: b, userId: "user_ben", email: "ben@example.com", name: "ben@example.com", role: "admin", active: true, joinedAt: 0 });
      return b;
    });
    await t.withIdentity(noName).mutation(api.account.setName, { name: "  Ben   Okafor " });
    expect((await t.withIdentity(noName).query(api.account.profile, {})).name).toBe("Ben Okafor");
    const member = await t.run((ctx) => ctx.db.query("members").filter((q) => q.eq(q.field("businessId"), businessId)).first());
    expect(member?.name).toBe("Ben Okafor");
    await expect(t.withIdentity(noName).mutation(api.account.setName, { name: "   " })).rejects.toThrow();
    await expect(t.withIdentity(noName).mutation(api.account.setName, { name: "x".repeat(101) })).rejects.toThrow();
    await expect(t.mutation(api.account.setName, { name: "Nobody" })).rejects.toThrow();
  });

  it("adds, replaces and removes the photo, and refuses what isn't a picture", async () => {
    const t = convexTest(schema, modules);
    const asAna = t.withIdentity(ana);
    const first = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })));
    await asAna.mutation(api.account.setPhoto, { storageId: first });
    expect((await asAna.query(api.account.profile, {})).photoUrl).toBeTruthy();
    expect((await t.withIdentity(noName).query(api.account.profile, {})).photoUrl).toBeNull();

    const second = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([4, 5])], { type: "image/png" })));
    await asAna.mutation(api.account.setPhoto, { storageId: second });
    expect(await t.run((ctx) => ctx.db.system.get(first))).toBeNull();

    const text = await t.run((ctx) => ctx.storage.store(new Blob(["hello"], { type: "text/plain" })));
    await expect(asAna.mutation(api.account.setPhoto, { storageId: text })).rejects.toThrow();

    await asAna.mutation(api.account.removePhoto, {});
    expect((await asAna.query(api.account.profile, {})).photoUrl).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(second))).toBeNull();
  });

  it("never takes a business's logo or someone else's photo, and leaves them be", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.withIdentity(noName).mutation(api.businesses.create, { name: "Real", timezone: "America/Santo_Domingo", language: "es", currencyCode: "DOP" });
    const logo = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob([new Uint8Array([9])], { type: "image/png" }));
      const s = await ctx.db.query("settings").withIndex("by_business", (q) => q.eq("businessId", businessId)).unique();
      await ctx.db.patch(s!._id, { logoId: id });
      return id;
    });
    // The snapshot names the logo by its address only.
    expect((await t.withIdentity(noName).query(api.data.snapshot, { businessId })).settings?.logoId).toBeUndefined();
    await expect(t.withIdentity(ana).mutation(api.account.setPhoto, { storageId: logo })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.system.get(logo))).not.toBeNull();

    const bens = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([1])], { type: "image/jpeg" })));
    await t.withIdentity(noName).mutation(api.account.setPhoto, { storageId: bens });
    await expect(t.withIdentity(ana).mutation(api.account.setPhoto, { storageId: bens })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.system.get(bens))).not.toBeNull();
  });
});
