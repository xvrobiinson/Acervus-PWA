// Deleting your own account. The request waits 7 days (signing in lets the
// person cancel it, in case of a mistake or a hacked account), then the sign-in
// and personal details go. The business's records stay: what was recorded in
// the person's name then says "Former team member". The only admin of a
// business must hand it over or delete it first.

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { requireIdentity } from "./lib/access";
import { fail } from "./lib/errors";
import { activeMembers, releaseClients } from "./lib/team";

export const DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Businesses where `userId` is the only admin. */
async function soleAdminOf(ctx: QueryCtx, userId: string): Promise<string[]> {
  const mine = (
    await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  ).filter((m) => m.active && m.role === "admin");
  const names: string[] = [];
  for (const m of mine) {
    const admins = (await activeMembers(ctx, m.businessId)).filter((x) => x.role === "admin");
    const business = await ctx.db.get(m.businessId);
    if (business && admins.length === 1) names.push(business.name);
  }
  return names;
}

const pendingFor = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("accountDeletions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

export const status = query({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const pending = await pendingFor(ctx, who.userId);
    return { deletesAt: pending?.runAt ?? null, soleAdminOf: await soleAdminOf(ctx, who.userId) };
  },
});

export const requestDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const blocked = await soleAdminOf(ctx, who.userId);
    if (blocked.length > 0) fail("sole_admin", { businesses: blocked.join(", ") });
    const pending = await pendingFor(ctx, who.userId);
    if (pending) return pending.runAt;
    const now = Date.now();
    const runAt = now + DELETE_AFTER_MS;
    await ctx.db.insert("accountDeletions", { userId: who.userId, email: who.email, requestedAt: now, runAt });
    return runAt;
  },
});

export const cancelDeletion = mutation({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const pending = await pendingFor(ctx, who.userId);
    if (pending) await ctx.db.delete(pending._id);
  },
});

export const runDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("accountDeletions")
      .withIndex("by_run", (q) => q.lte("runAt", now))
      .take(20);
    for (const d of due) {
      // Became the only admin during the wait: a business can't be left
      // without one, so it waits until that changes or the person cancels.
      if ((await soleAdminOf(ctx, d.userId)).length > 0) continue;
      await ctx.scheduler.runAfter(0, internal.account.erase, { userId: d.userId, email: d.email, deletionId: d._id });
    }
  },
});

/** Takes the person out of every business; their records stay, without their name. */
export const erase = internalMutation({
  args: { userId: v.string(), email: v.string(), deletionId: v.id("accountDeletions") },
  handler: async (ctx, a) => {
    if (!(await ctx.db.get(a.deletionId))) return;
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", a.userId))
      .collect();
    const now = Date.now();
    for (const m of memberships) {
      await eraseFrom(ctx, m.businessId, a.userId, m.name, a.email);
      await ctx.db.patch(m._id, { active: false, removedAt: m.removedAt ?? now, name: await formerLabel(ctx, m.businessId), email: "", collectorView: undefined });
    }
    for await (const i of ctx.db.query("invites").withIndex("by_email", (q) => q.eq("email", a.email))) await ctx.db.delete(i._id);
    for await (const p of ctx.db.query("userPrefs").withIndex("by_user", (q) => q.eq("userId", a.userId))) await ctx.db.delete(p._id);
    await ctx.db.delete(a.deletionId);
    await ctx.scheduler.runAfter(0, internal.account.removeSignIn, { userId: a.userId });
  },
});

async function formerLabel(ctx: QueryCtx, businessId: Id<"businesses">): Promise<string> {
  const s = await ctx.db
    .query("settings")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .unique();
  return s?.language === "en" ? "Former team member" : "Antiguo miembro del equipo";
}

async function eraseFrom(ctx: Parameters<typeof releaseClients>[0], businessId: Id<"businesses">, userId: string, name: string, email: string) {
  const label = await formerLabel(ctx, businessId);
  await releaseClients(ctx, businessId, userId);
  const log = await ctx.db
    .query("changeLog")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  for (const row of log) {
    const changes = row.changes.map((c) => ({ ...c, old: c.old === email ? "" : c.old, new: c.new === email ? "" : c.new }));
    const changed = changes.some((c, i) => c.old !== row.changes[i].old || c.new !== row.changes[i].new);
    if (row.userId === userId || changed) await ctx.db.patch(row._id, { userName: row.userId === userId ? label : row.userName, changes });
  }
  const pending = await ctx.db
    .query("pendingPayments")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  for (const p of pending) if (p.collectedBy === userId) await ctx.db.patch(p._id, { collectorName: label });
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  for (const m of messages) {
    if (m.toUserId === userId) await ctx.db.delete(m._id);
    else if (m.fromName === name) await ctx.db.patch(m._id, { fromName: label });
  }
}

/** The sign-in itself: the account, its sessions and linked Google login. */
export const removeSignIn = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, a) => {
    const paginationOpts = { numItems: 200, cursor: null };
    for (const model of ["session", "account"] as const) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model, where: [{ field: "userId", value: a.userId }] },
        paginationOpts,
      });
    }
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "user", where: [{ field: "_id", value: a.userId }] },
      paginationOpts,
    });
  },
});
