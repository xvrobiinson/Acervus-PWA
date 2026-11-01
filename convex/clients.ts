// Clients. Collectors can add them (also offline), and a client a collector
// adds is theirs; admins edit, archive, delete, give clients to collectors
// and manage the ID photo. Clients with loans can't be deleted.

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation } from "./_generated/server";
import { checkVersion, ownRecord, requireMember } from "./lib/access";
import { Diff, logChange, nextRecordNo, priorOperation, rememberOperation } from "./lib/books";
import { fail } from "./lib/errors";
import { activeMembers, limited, notify } from "./lib/team";
import { email, phone, text } from "./lib/validate";

const input = {
  fullName: v.string(),
  phone: v.string(),
  email: v.string(),
  idNumber: v.string(),
  address: v.string(),
  notes: v.string(),
};

function clean(a: { fullName: string; phone: string; email: string; idNumber: string; address: string; notes: string }) {
  return {
    fullName: text("fullName", a.fullName, 200, { required: true, oneLine: true }),
    phone: phone("phone", a.phone),
    email: email("email", a.email),
    idNumber: text("idNumber", a.idNumber, 40, { oneLine: true }),
    address: text("address", a.address, 300, { oneLine: true }),
    notes: text("notes", a.notes, 10_000),
  };
}

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    opId: v.string(),
    deviceRecordedAt: v.optional(v.number()),
    ...input,
  },
  handler: async (ctx, a): Promise<{ clientId: Id<"clients">; duplicate: boolean }> => {
    const access = await requireMember(ctx, a.businessId, "record");
    const prior = await priorOperation(ctx, access, a.opId, "client.create");
    if (prior) return { clientId: prior.resultId as Id<"clients">, duplicate: true };
    const c = clean(a);
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      businessId: a.businessId,
      recordNo: await nextRecordNo(ctx, access.business),
      ...c,
      collectorId: limited(access) ? access.userId : undefined,
      createdAt: now,
      createdBy: access.userId,
      updatedAt: now,
      version: 1,
    });
    const d = new Diff();
    for (const [k, val] of Object.entries(c)) d.added(k, val);
    await logChange(ctx, access, "client", clientId, "create", d, a.deviceRecordedAt ? "Recorded offline" : "", {
      opId: a.opId,
    });
    await rememberOperation(ctx, access, a.opId, "client.create", clientId);
    return { clientId, duplicate: false };
  },
});

/** Gives clients (with all their loans) to a collector or admin, or back to
 *  nobody (`collectorId: null`). The new collector and the one who had them
 *  are told in their messages. */
export const assign = mutation({
  args: { businessId: v.id("businesses"), clientIds: v.array(v.id("clients")), collectorId: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    if (a.clientIds.length === 0 || a.clientIds.length > 500) fail("invalid", { field: "clientIds", reason: "count" });
    const members = await activeMembers(ctx, a.businessId);
    const name = (userId: string | undefined) => (userId ? (members.find((m) => m.userId === userId)?.name ?? "") : "");
    const to = a.collectorId === null ? undefined : a.collectorId;
    if (to !== undefined && !members.some((m) => m.userId === to && (m.role === "collector" || m.role === "admin"))) {
      fail("invalid", { field: "collectorId", reason: "not_a_collector" });
    }
    const given: string[] = [];
    const taken = new Map<string, string[]>();
    const now = Date.now();
    for (const id of new Set(a.clientIds)) {
      const c = await ownRecord(ctx, access, "clients", id);
      if (c.collectorId === to) continue;
      await ctx.db.patch(c._id, { collectorId: to, version: c.version + 1, updatedAt: now });
      await logChange(ctx, access, "client", c._id, "update", new Diff().field("collector", name(c.collectorId), name(to)), "");
      given.push(c.fullName);
      if (c.collectorId !== undefined && c.collectorId !== access.userId) {
        taken.set(c.collectorId, [...(taken.get(c.collectorId) ?? []), c.fullName]);
      }
    }
    if (to !== undefined && to !== access.userId && given.length > 0) {
      await notify(ctx, a.businessId, [to], { kind: "assigned", clientNames: given, fromName: access.name });
    }
    for (const [userId, names] of taken) {
      if (members.some((m) => m.userId === userId)) {
        await notify(ctx, a.businessId, [userId], { kind: "unassigned", clientNames: names, fromName: access.name });
      }
    }
    return { changed: given.length };
  },
});

export const update = mutation({
  args: { businessId: v.id("businesses"), clientId: v.id("clients"), expectedVersion: v.number(), ...input },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "clients", a.clientId);
    checkVersion(old, a.expectedVersion);
    const c = clean(a);
    const d = new Diff();
    for (const k of Object.keys(c) as (keyof typeof c)[]) d.field(k, old[k], c[k]);
    if (d.empty) return;
    await ctx.db.patch(old._id, { ...c, version: old.version + 1, updatedAt: Date.now() });
    await logChange(ctx, access, "client", old._id, "update", d, "");
  },
});

export const setArchived = mutation({
  args: { businessId: v.id("businesses"), clientId: v.id("clients"), archived: v.boolean() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "clients", a.clientId);
    if (Boolean(old.archivedAt) === a.archived) return;
    await ctx.db.patch(old._id, {
      archivedAt: a.archived ? Date.now() : undefined,
      version: old.version + 1,
      updatedAt: Date.now(),
    });
    await logChange(ctx, access, "client", old._id, "update", new Diff().field("archived", !a.archived, a.archived), "");
  },
});

export const remove = mutation({
  args: { businessId: v.id("businesses"), clientId: v.id("clients"), reason: v.string() },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "clients", a.clientId);
    const loan = await ctx.db
      .query("loans")
      .withIndex("by_client", (q) => q.eq("clientId", old._id))
      .first();
    if (loan) fail("client_has_loans");
    const d = new Diff()
      .removed("fullName", old.fullName)
      .removed("phone", old.phone)
      .removed("email", old.email)
      .removed("idNumber", old.idNumber)
      .removed("address", old.address)
      .removed("notes", old.notes)
      .removed("photo", old.photoId ? "on_file" : "");
    if (old.photoId) await ctx.storage.delete(old.photoId);
    await ctx.db.delete(old._id);
    await logChange(ctx, access, "client", old._id, "delete", d, text("reason", a.reason, 2000));
  },
});

// ----- ID photo (admins only) --------------------------------------------

export const photoUploadUrl = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    await requireMember(ctx, a.businessId, "manage");
    return await ctx.storage.generateUploadUrl();
  },
});

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO = 4 * 1024 * 1024;

export const setPhoto = mutation({
  args: { businessId: v.id("businesses"), clientId: v.id("clients"), storageId: v.id("_storage") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "clients", a.clientId);
    const meta = await ctx.db.system.get(a.storageId);
    if (!meta || !PHOTO_TYPES.includes(meta.contentType ?? "") || meta.size > MAX_PHOTO) {
      if (meta) await ctx.storage.delete(a.storageId);
      fail("invalid", { field: "photo", reason: "photo" });
    }
    if (old.photoId) await ctx.storage.delete(old.photoId);
    await ctx.db.patch(old._id, { photoId: a.storageId, version: old.version + 1, updatedAt: Date.now() });
    // The photo itself is never written to the history, only that it changed.
    await logChange(ctx, access, "client", old._id, "update", new Diff().field("photo", old.photoId ? "on_file" : "", old.photoId ? "replaced" : "on_file"), "");
  },
});

export const removePhoto = mutation({
  args: { businessId: v.id("businesses"), clientId: v.id("clients") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const old = await ownRecord(ctx, access, "clients", a.clientId);
    if (!old.photoId) return;
    await ctx.storage.delete(old.photoId);
    await ctx.db.patch(old._id, { photoId: undefined, version: old.version + 1, updatedAt: Date.now() });
    await logChange(ctx, access, "client", old._id, "update", new Diff().field("photo", "on_file", ""), "");
  },
});

/** For the authenticated photo endpoint (http.ts): the storage id of a
 *  client's photo, only for an admin of the client's business. */
export const photoForAdmin = internalQuery({
  args: { businessId: v.id("businesses"), clientId: v.id("clients") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "manage");
    const c = await ownRecord(ctx, access, "clients", a.clientId);
    return c.photoId ?? null;
  },
});
