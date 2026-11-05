// The periods the Overview's Interest earned can show: today, this week
// (from Monday), this month, this year, or all time. Each one also has the
// same stretch of the period before ("vs last month" compares Nov 1–5 with
// Oct 1–5), so the comparison is fair partway through a period.

import { addDays, addMonths, daysBetween, makeDay, type Day } from "../../shared/domain/dates";
import type { Book } from "../../shared/domain/portfolio";

export type Period = "day" | "week" | "month" | "year" | "all";
export const PERIODS: Period[] = ["day", "week", "month", "year", "all"];

export interface Span {
  from: Day;
  to: Day;
}

/** Monday of the week `d` is in. */
function monday(d: Day): Day {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(d, -((wd + 6) % 7));
}

/** This period up to today, and the same stretch of the one before it
 *  (none for all time). */
export function spans(p: Period, today: Day): { now: Span; before: Span } | null {
  if (p === "all") return null;
  if (p === "day") return { now: { from: today, to: today }, before: { from: addDays(today, -1), to: addDays(today, -1) } };
  if (p === "week") {
    const from = monday(today);
    return { now: { from, to: today }, before: { from: addDays(from, -7), to: addDays(today, -7) } };
  }
  const months = p === "month" ? 1 : 12;
  const from = p === "month" ? makeDay(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1) : `${today.slice(0, 4)}-01-01`;
  const prevFrom = addMonths(from, -months);
  // The same number of days into the period before, not past its end.
  const prevEnd = addDays(from, -1);
  const prevTo = addDays(prevFrom, daysBetween(from, today));
  return { now: { from, to: today }, before: { from: prevFrom, to: prevTo < prevEnd ? prevTo : prevEnd } };
}

/** Interest and late fees received from payments dated within `s`. */
export function interestIn(book: Book, s: Span): number {
  let sum = 0;
  for (const l of book.loans) for (const p of l.payments) if (p.paidOn >= s.from && p.paidOn <= s.to) sum += p.interest + p.fee;
  return sum;
}
