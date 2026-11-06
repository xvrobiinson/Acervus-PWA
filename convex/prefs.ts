// Each person's own choices that follow them to every device: which figures
// the Overview's hero shows (src/lib/hero-layout.ts) and the period for
// Interest earned. They belong to the person, not to a business, so only
// the signed-in person can read or change their own; the app still checks
// each figure against the person's role in the open business when it shows
// them, so a saved choice never reveals a total.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./lib/access";
import { fail } from "./lib/errors";
import { hitLimit } from "./rateLimit";

const PERIODS = ["day", "week", "month", "year", "all"];
const NAME = /^[a-zA-Z0-9]{1,32}$/;

/** A hero layout as JSON: at most four places, each a big figure and two
 *  rows, all short plain names. Anything else is refused. */
function checkHero(text: string) {
  if (text.length > 1500) fail("invalid", { field: "hero" });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("invalid", { field: "hero" });
  }
  if (!Array.isArray(raw) || raw.length > 4) fail("invalid", { field: "hero" });
  for (const s of raw as unknown[]) {
    const slot = s as { big?: unknown; rows?: unknown };
    if (!slot || typeof slot !== "object" || typeof slot.big !== "string" || !NAME.test(slot.big)) fail("invalid", { field: "hero" });
    if (!Array.isArray(slot.rows) || slot.rows.length !== 2 || slot.rows.some((r) => typeof r !== "string" || !NAME.test(r))) fail("invalid", { field: "hero" });
  }
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const who = await requireIdentity(ctx);
    const p = await ctx.db
      .query("userPrefs")
      .withIndex("by_user", (q) => q.eq("userId", who.userId))
      .unique();
    return { hero: p?.hero ?? null, interestPeriod: p?.interestPeriod ?? null };
  },
});

export const save = mutation({
  args: { hero: v.optional(v.string()), interestPeriod: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const who = await requireIdentity(ctx);
    if (a.hero !== undefined) checkHero(a.hero);
    if (a.interestPeriod !== undefined && !PERIODS.includes(a.interestPeriod)) fail("invalid", { field: "interestPeriod" });
    if (!(await hitLimit(ctx, `prefs:${who.userId}`, 120, 60_000))) fail("rate_limited");
    const p = await ctx.db
      .query("userPrefs")
      .withIndex("by_user", (q) => q.eq("userId", who.userId))
      .unique();
    const change = { ...(a.hero !== undefined ? { hero: a.hero } : {}), ...(a.interestPeriod !== undefined ? { interestPeriod: a.interestPeriod } : {}), updatedAt: Date.now() };
    if (p) await ctx.db.patch(p._id, change);
    else await ctx.db.insert("userPrefs", { userId: who.userId, ...change });
  },
});
