// The bell: messages for the signed-in person in one business, and the
// hourly reminder that a payment is due soon on a client nobody collects
// from (only in businesses that have collectors; without any, every client
// is the admins' own).

import { v } from "convex/values";
import { addDays, todayIn } from "../shared/domain/dates";
import { bookDelinquency } from "../shared/domain/portfolio";
import { buildBook } from "../shared/domain/records";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/access";
import { engineRecords, loadRecords } from "./lib/books";
import { activeMembers } from "./lib/team";

/** How many days ahead a due date makes admins assign a collector. */
export const REMIND_DAYS = 3;
/** Messages are kept this long. */
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export const mine = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "read");
    return await ctx.db
      .query("messages")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId).eq("toUserId", access.userId))
      .order("desc")
      .take(50);
  },
});

export const markRead = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "read");
    const now = Date.now();
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId).eq("toUserId", access.userId))
      .order("desc")
      .take(200);
    for (const m of rows) if (m.readAt === undefined) await ctx.db.patch(m._id, { readAt: now });
  },
});

export const remindAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    for await (const b of ctx.db.query("businesses")) {
      await ctx.scheduler.runAfter(0, internal.messages.remindBusiness, { businessId: b._id });
    }
  },
});

export const remindBusiness = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const business = await ctx.db.get(a.businessId);
    if (!business) return 0;
    const now = Date.now();
    // Old messages go.
    const all = await ctx.db
      .query("messages")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    for (const m of all) if (now - m.createdAt > KEEP_MS) await ctx.db.delete(m._id);

    const members = await activeMembers(ctx, a.businessId);
    if (!members.some((m) => m.role === "collector")) return 0;
    const admins = members.filter((m) => m.role === "admin").map((m) => m.userId);
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .collect();
    const open = new Map(clients.filter((c) => c.collectorId === undefined && c.archivedAt === undefined).map((c) => [c._id as string, c]));
    if (open.size === 0) return 0;
    const today = todayIn(business.timezone);
    const until = addDays(today, REMIND_DAYS);
    const r = await loadRecords(ctx, a.businessId);
    const active = new Set(r.loans.filter((l) => l.status === "active").map((l) => l._id as string));
    let sent = 0;
    for (const lb of buildBook(engineRecords(r)).loans) {
      const client = open.get(lb.clientId);
      if (!client || !active.has(lb.id)) continue;
      const q = bookDelinquency(lb, today);
      if (!q.nextDue || q.nextDue > until || q.nextDueAmount <= 0) continue;
      const key = `due:${lb.id}:${q.nextDue}`;
      const seen = await ctx.db
        .query("messages")
        .withIndex("by_key", (x) => x.eq("businessId", a.businessId).eq("key", key))
        .first();
      if (seen) continue;
      for (const userId of admins) {
        await ctx.db.insert("messages", {
          businessId: a.businessId,
          toUserId: userId,
          kind: "due_unassigned",
          clientNames: [client.fullName],
          fromName: "",
          amount: q.nextDueAmount,
          dueOn: q.nextDue,
          clientId: client._id,
          key,
          createdAt: now,
        });
      }
      sent += 1;
    }
    return sent;
  },
});
