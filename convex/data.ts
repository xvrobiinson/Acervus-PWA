// What the app shows, in one reactive query per business: every record the
// figures are worked out from (on the device, with the same engine the
// server uses). The app also keeps the last copy for offline use. Client ID
// photos are not included — only whether one is on file.
//
// A collector gets only their own part of the business (convex/lib/team.ts):
// the clients assigned to them, those clients' loans
// and payments, the expenses and income they recorded themselves and their
// own pending payments. Never capital, the rest of the income and expenses,
// or their teammates' email addresses.

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMember } from "./lib/access";
import { loadRecords } from "./lib/books";
import { fail } from "./lib/errors";
import { canSee, limited } from "./lib/team";

/** Decided pending payments stay listed this long (the collector's "my
 *  recent payments", the admin's confirmed and rejected). */
const DECIDED_MS = 30 * 24 * 60 * 60 * 1000;

export const snapshot = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "read");
    const [records, allClients, settings, members, allEvents, pendingRows] = await Promise.all([
      loadRecords(ctx, a.businessId),
      ctx.db
        .query("clients")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
      ctx.db
        .query("settings")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .unique(),
      ctx.db
        .query("members")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
      ctx.db
        .query("loanStatusEvents")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
      ctx.db
        .query("pendingPayments")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
    ]);
    const own = limited(access);
    const clients = allClients.filter((c) => canSee(access, c));
    const clientIds = new Set(clients.map((c) => c._id as string));
    const loans = own ? records.loans.filter((l) => clientIds.has(l.clientId)) : records.loans;
    const loanIds = new Set(loans.map((l) => l._id as string));
    const mineOnly = <T extends { loanId: string }>(rows: T[]) => (own ? rows.filter((r) => loanIds.has(r.loanId)) : rows);
    const now = Date.now();
    const pending = pendingRows.filter(
      (p) => (!own || p.collectedBy === access.userId) && (p.status === "waiting" || now - (p.decidedAt ?? 0) < DECIDED_MS),
    );
    const logoUrl = settings?.logoId ? await ctx.storage.getUrl(settings.logoId) : null;
    return {
      business: {
        _id: access.business._id,
        name: access.business.name,
        timezone: access.business.timezone,
      },
      me: { userId: access.userId, role: access.member.role, name: access.name },
      today: access.today,
      settings: settings ? { ...settings, logoUrl } : null,
      clients: clients.map(({ photoId, ...c }) => ({ ...c, hasPhoto: photoId !== undefined })),
      loans,
      payments: mineOnly(records.payments),
      lateFees: mineOnly(records.lateFees),
      capital: own ? [] : records.capital,
      entries: own ? records.entries.filter((e) => e.createdBy === access.userId) : records.entries,
      statusEvents: mineOnly(allEvents),
      pending,
      /** Names for the history ("recorded by") and the collector lists. */
      people: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: own && m.userId !== access.userId ? "" : m.email,
        role: m.role,
        active: m.active,
      })),
    };
  },
});

/** The change history, newest first, a page at a time. */
export const changes = query({
  args: { businessId: v.id("businesses"), loanId: v.optional(v.id("loans")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    const access = await requireMember(ctx, a.businessId, "read");
    if (a.loanId) {
      const loanId = a.loanId;
      if (limited(access)) {
        // Only the history of loans the collector can see.
        const loan = await ctx.db.get(loanId);
        const client = loan && loan.businessId === a.businessId ? await ctx.db.get(loan.clientId) : null;
        if (!client || !canSee(access, client)) fail("not_found", { table: "loans" });
      }
      return await ctx.db
        .query("changeLog")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .order("desc")
        .filter((q) => q.eq(q.field("businessId"), a.businessId))
        .paginate(a.paginationOpts);
    }
    // The whole business's history is for admins and viewers.
    if (limited(access)) fail("forbidden", { need: "manage" });
    return await ctx.db
      .query("changeLog")
      .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
      .order("desc")
      .paginate(a.paginationOpts);
  },
});
