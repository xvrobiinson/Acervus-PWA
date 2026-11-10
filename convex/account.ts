// The person's profile (their name and photo, 2026-11-10), and deleting
// their own account. The request waits 7 days (signing in lets the
// person cancel it, in case of a mistake or a hacked account), then the sign-in
// and personal details go. The business's records stay: what was recorded in
// the person's name then says "Former team member". The only admin of a
// business must hand it over or delete it first.

import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireIdentity } from "./lib/access";
import { fail } from "./lib/errors";
import { hitLimit } from "./rateLimit";
import { activeMembers, releaseClients } from "./lib/team";

export const DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// ----- Profile -------------------------------------------------------------

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO = 2 * 1024 * 1024;
/** A photo must be one just uploaded, never an older file named by its id. */
const FRESH_UPLOAD_MS = 60 * 60_000;

/** A file another record already uses (a business's logo, someone's photo)
 *  can't be taken as a photo: refused, and never deleted here. */
async function inUse(ctx: QueryCtx, id: Id<"_storage">, userId: string): Promise<boolean> {
  const logo = await ctx.db
    .query("settings")
    .withIndex("by_logo", (q) => q.eq("logoId", id))
    .first();
  if (logo) return true;
  const photo = await ctx.db
    .query("userPrefs")
    .withIndex("by_photo", (q) => q.eq("photoId", id))
    .first();
  return !!photo && photo.userId !== userId;
}

const prefsOf = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query("userPrefs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();

async function patchPrefs(ctx: MutationCtx, userId: string, change: { name?: string; photoId?: Id<"_storage"> | undefined }) {
  const p = await prefsOf(ctx, userId);
  if (p) await ctx.db.patch(p._id, { ...change, updatedAt: Date.now() });
  else await ctx.db.insert("userPrefs", { userId, ...change, updatedAt: Date.now() });
}

/** The name and photo shown for a person: the name they gave (else their
 *  sign-in's, but never their email address) and the photo they added. */
export async function profileOf(ctx: QueryCtx, userId: string, signInName: string, email: string) {
  const p = await prefsOf(ctx, userId);
  const given = (p?.name ?? "").trim();
  const fromSignIn = signInName.trim().toLowerCase() === email.trim().toLowerCase() ? "" : signInName.trim();
  return { name: given || fromSignIn, photoUrl: p?.photoId ? await ctx.storage.getUrl(p.photoId) : null };
}

export const profile = query({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const signIn = (await ctx.auth.getUserIdentity())?.name ?? "";
    return { email: who.email, ...(await profileOf(ctx, who.userId, signIn, who.email)) };
  },
});

export const setName = mutation({
  args: { name: v.string() },
  handler: async (ctx, a) => {
    const who = await requireIdentity(ctx);
    const name = a.name.trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 100) fail("invalid", { field: "name" });
    if (!(await hitLimit(ctx, `profile:${who.userId}`, 30, 60_000))) fail("rate_limited");
    await patchPrefs(ctx, who.userId, { name });
    // The person's place in each of their businesses' teams shows it too.
    for await (const m of ctx.db.query("members").withIndex("by_user", (q) => q.eq("userId", who.userId))) {
      if (m.active && m.name !== name) await ctx.db.patch(m._id, { name });
    }
    // And the sign-in, so what they record from now on carries it.
    await ctx.scheduler.runAfter(0, internal.account.renameSignIn, { userId: who.userId, name });
  },
});

export const renameSignIn = internalMutation({
  args: { userId: v.string(), name: v.string() },
  handler: async (ctx, a) => {
    await ctx.runMutation(components.betterAuth.adapter.updateOne, {
      input: { model: "user", update: { name: a.name, updatedAt: Date.now() }, where: [{ field: "_id", value: a.userId }] },
    });
  },
});

export const photoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    if (!(await hitLimit(ctx, `profile-photo:${who.userId}`, 20, 60 * 60_000))) fail("rate_limited");
    return await ctx.storage.generateUploadUrl();
  },
});

export const setPhoto = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, a) => {
    const who = await requireIdentity(ctx);
    const meta = await ctx.db.system.get("_storage", a.storageId);
    const fresh = !!meta && Date.now() - meta._creationTime <= FRESH_UPLOAD_MS;
    if (!meta || !fresh || !PHOTO_TYPES.includes(meta.contentType ?? "") || meta.size > MAX_PHOTO || (await inUse(ctx, a.storageId, who.userId))) {
      fail("invalid", { field: "photo", reason: "photo" });
    }
    const old = (await prefsOf(ctx, who.userId))?.photoId;
    if (old === a.storageId) return;
    await patchPrefs(ctx, who.userId, { photoId: a.storageId });
    if (old) await ctx.storage.delete(old);
  },
});

export const removePhoto = mutation({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const old = (await prefsOf(ctx, who.userId))?.photoId;
    if (!old) return;
    await patchPrefs(ctx, who.userId, { photoId: undefined });
    await ctx.storage.delete(old);
  },
});

// ----- Deleting the account -----------------------------------------------

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
    for await (const p of ctx.db.query("userPrefs").withIndex("by_user", (q) => q.eq("userId", a.userId))) {
      if (p.photoId) await ctx.storage.delete(p.photoId);
      await ctx.db.delete(p._id);
    }
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
