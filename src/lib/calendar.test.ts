import { describe, expect, it } from "vitest";
import { computeBooks } from "../state/books";
import snap from "../demo/snapshot.json";
import { calendarDays, dayTotals, monthGrid, weekOf } from "./calendar";

// The demo books: loan #9 (monthly, installments late), #8 (weekly), and
// interest-only loans such as #1.
const s = snap as never as Parameters<typeof computeBooks>[0];
const today = (snap as { today: string }).today;

describe("the calendar", () => {
  it("puts each installment on its due date, as it stands today", () => {
    const books = computeBooks(s, today);
    const days = calendarDays(books.loans, "2026-07-01", "2026-12-31", today);
    const aug1 = days.get("2026-08-01")!.due.find((e) => e.loanNo === 9)!;
    expect(aug1.state).toBe("late");
    expect(aug1.left).toBe(30000);
    const jul1 = days.get("2026-07-01")!.due.find((e) => e.loanNo === 9)!;
    expect(jul1.state).toBe("paid");
    expect(jul1.left).toBe(0);
  });

  it("shows interest-only loans' interest and what was received", () => {
    const books = computeBooks(s, today);
    const days = calendarDays(books.loans, "2026-01-01", "2027-03-31", today);
    const all = [...days.values()];
    expect(all.some((d) => d.due.some((e) => e.interest && e.loanNo === 1))).toBe(true);
    const received = all.flatMap((d) => d.paid).reduce((a, p) => a + p.amount, 0);
    const inRange = (snap as { payments: { paidOn: string; amount: number }[] }).payments.filter((p) => p.paidOn >= "2026-01-01" && p.paidOn <= "2027-03-31").reduce((a, p) => a + p.amount, 0);
    expect(received).toBe(inRange);
    expect(dayTotals(days.get("2026-08-01")).late).toBe(true);
  });

  it("lays out whole weeks, Monday first", () => {
    const g = monthGrid("2026-11-10");
    expect(g[0]).toBe("2026-10-26");
    expect(g[g.length - 1]).toBe("2026-12-06");
    expect(g.length % 7).toBe(0);
    expect(weekOf("2026-11-10")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });
});
