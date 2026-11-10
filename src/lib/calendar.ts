// The calendar of payments (2026-11-10, roadmap item 52 / usability 14):
// what falls due on each day and what was received, read from the schedules
// the app already works out; nothing new is calculated. Installment loans:
// each installment on its due date. Interest-only loans: each period's
// interest, and the next one (no schedule beyond it). The Windows app's twin
// is src/services/calendar.rs.

import { addDays, type Day } from "../../shared/domain/dates";
import { installmentStatus, remaining } from "../../shared/domain/installments";
import { periodStates } from "../../shared/domain/ledger";
import type { Cents } from "../../shared/domain/money";
import type { LoanView } from "../state/books";

export type DueState = "paid" | "partly" | "late" | "upcoming";

export interface DueEntry {
  loanId: string;
  loanNo: number;
  clientId: string;
  client: string;
  /** What fell (or falls) due that day. */
  amount: Cents;
  /** What is still unpaid of it. */
  left: Cents;
  state: DueState;
  /** An interest-only loan's interest (not an installment). */
  interest: boolean;
}

export interface PaidEntry {
  paymentId: string;
  loanId: string;
  loanNo: number;
  client: string;
  amount: Cents;
}

export interface CalendarDay {
  due: DueEntry[];
  paid: PaidEntry[];
}

/** Each day from `from` to `to` (inclusive) with something on it. */
export function calendarDays(loans: LoanView[], from: Day, to: Day, today: Day): Map<Day, CalendarDay> {
  const days = new Map<Day, CalendarDay>();
  const day = (d: Day) => {
    let x = days.get(d);
    if (!x) days.set(d, (x = { due: [], paid: [] }));
    return x;
  };
  const inside = (d: Day) => d >= from && d <= to;
  for (const l of loans) {
    if (!l.client) continue;
    const base = { loanId: l.loan._id, loanNo: l.loan.recordNo, clientId: l.client._id, client: l.client.fullName };
    // A defaulted or restructured loan takes no more payments: nothing of
    // it falls due (what it received still shows).
    const closedOut = l.loan.status === "defaulted" || l.loan.status === "restructured";
    if (closedOut) {
      /* only its payments, below */
    } else if (l.plan) {
      for (const x of l.plan.installments) {
        if (!inside(x.due)) continue;
        const st = installmentStatus(x, today);
        const amount = x.principal + x.interest + x.fee;
        const left = Math.max(remaining(x), 0);
        day(x.due).due.push({ ...base, amount, left, state: st === "paid" ? "paid" : st === "overdue" ? "late" : st === "partly_paid" ? "partly" : "upcoming", interest: false });
      }
    } else if (l.loan.status === "active" || l.position.periods.length > 0) {
      const seen = new Set<Day>();
      for (const { period, state, paid } of periodStates(l.position, today)) {
        seen.add(period.due);
        if (!inside(period.due)) continue;
        const left = Math.max(period.interest - paid, 0);
        day(period.due).due.push({ ...base, amount: period.interest, left, state: state === "paid" ? "paid" : state === "overdue" ? "late" : state === "partly_paid" ? "partly" : "upcoming", interest: true });
      }
      // The next interest payment, when it is beyond the periods so far.
      const next = l.delinquency.nextDue;
      if (l.loan.status === "active" && next && !seen.has(next) && inside(next) && l.delinquency.nextDueAmount > 0) {
        const amount = l.delinquency.nextDueAmount - l.delinquency.overdueAmount;
        if (amount > 0) day(next).due.push({ ...base, amount, left: amount, state: "upcoming", interest: true });
      }
    }
    for (const p of l.payments) {
      if (!inside(p.paidOn)) continue;
      day(p.paidOn).paid.push({ paymentId: p._id, loanId: l.loan._id, loanNo: l.loan.recordNo, client: l.client.fullName, amount: p.amount });
    }
  }
  for (const x of days.values()) x.due.sort((a, b) => (a.state === "late" ? -1 : 0) - (b.state === "late" ? -1 : 0) || a.client.localeCompare(b.client));
  return days;
}

/** The days a month view shows: whole weeks from the Monday on or before
 *  the 1st to the Sunday on or after the last day. */
export function monthGrid(month: Day): Day[] {
  const first = `${month.slice(0, 7)}-01`;
  const weekday = (d: Day) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  const start = addDays(first, -weekday(first));
  const next = new Date(`${first}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const last = addDays(next.toISOString().slice(0, 10), -1);
  const end = addDays(last, 6 - weekday(last));
  const out: Day[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The seven days of the week (Monday first) that holds `d`. */
export function weekOf(d: Day): Day[] {
  const weekday = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(d, -weekday);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** What a day's dues add up to: all of it, and what is still unpaid. */
export function dayTotals(x: CalendarDay | undefined): { due: Cents; left: Cents; late: boolean; paid: Cents } {
  if (!x) return { due: 0, left: 0, late: false, paid: 0 };
  return {
    due: x.due.reduce((a, e) => a + e.amount, 0),
    left: x.due.reduce((a, e) => a + e.left, 0),
    late: x.due.some((e) => e.state === "late"),
    paid: x.paid.reduce((a, p) => a + p.amount, 0),
  };
}
