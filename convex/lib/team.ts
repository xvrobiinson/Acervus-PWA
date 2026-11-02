// Collectors and their clients. Each client belongs to at most one
// collector (or admin), with all their loans. A collector sees only the
// clients assigned to them; admins and viewers see
// everything. Payments a collector records wait as pending payments until an
// admin confirms them (convex/payments.ts).

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Access } from "./access";

/** Whether this member's view is limited to their own clients. */
export function limited(access: Access): boolean {
  return access.member.role === "collector";
}

export const FULL_VIEW = { amountLent: true, rate: true, contact: true, idNumber: true, history: true, lateFees: true };

/** What this member sees of their clients: a collector's switches, or all. */
export function viewOf(access: Access) {
  return limited(access) ? (access.member.collectorView ?? FULL_VIEW) : FULL_VIEW;
}

/** Whether `access` may see and collect for `client`. */
export function canSee(access: Access, client: Pick<Doc<"clients">, "collectorId">): boolean {
  return !limited(access) || client.collectorId === access.userId;
}

export async function activeMembers(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">) {
  return (
    await ctx.db
      .query("members")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect()
  ).filter((m) => m.active);
}

type Message = Omit<Doc<"messages">, "_id" | "_creationTime" | "businessId" | "toUserId" | "createdAt" | "readAt">;

/** Leaves `m` in the bell of each of `to` (once each). */
export async function notify(ctx: MutationCtx, businessId: Id<"businesses">, to: string[], m: Message) {
  const now = Date.now();
  for (const userId of new Set(to)) {
    await ctx.db.insert("messages", { businessId, toUserId: userId, createdAt: now, ...m });
  }
}

/** Every active admin, to tell them something about the business. */
export async function adminIds(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">): Promise<string[]> {
  return (await activeMembers(ctx, businessId)).filter((m) => m.role === "admin").map((m) => m.userId);
}

/** Clients given to `userId` go back to having no collector (they left the
 *  team or no longer collect). Their pending payments stay for an admin. */
export async function releaseClients(ctx: MutationCtx, businessId: Id<"businesses">, userId: string) {
  const clients = await ctx.db
    .query("clients")
    .withIndex("by_business", (q) => q.eq("businessId", businessId))
    .collect();
  const now = Date.now();
  for (const c of clients) {
    if (c.collectorId === userId) await ctx.db.patch(c._id, { collectorId: undefined, version: c.version + 1, updatedAt: now });
  }
}
