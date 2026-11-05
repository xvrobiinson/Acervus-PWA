import { describe, expect, it } from "vitest";
import { interestIn, spans } from "./periods";
import type { Book } from "../../shared/domain/portfolio";

describe("periods", () => {
  it("starts weeks on Monday and compares the same stretch before", () => {
    // 2026-11-05 is a Thursday.
    expect(spans("week", "2026-11-05")).toEqual({ now: { from: "2026-11-02", to: "2026-11-05" }, before: { from: "2026-10-26", to: "2026-10-29" } });
    expect(spans("week", "2026-11-02")!.now.from).toBe("2026-11-02");
    expect(spans("week", "2026-11-08")!.now.from).toBe("2026-11-02");
  });

  it("compares month and year to date, never past the earlier period's end", () => {
    expect(spans("month", "2026-11-05")).toEqual({ now: { from: "2026-11-01", to: "2026-11-05" }, before: { from: "2026-10-01", to: "2026-10-05" } });
    expect(spans("month", "2026-03-31")!.before).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(spans("year", "2026-11-05")).toEqual({ now: { from: "2026-01-01", to: "2026-11-05" }, before: { from: "2025-01-01", to: "2025-11-05" } });
    expect(spans("day", "2026-11-05")!.before).toEqual({ from: "2026-11-04", to: "2026-11-04" });
    expect(spans("all", "2026-11-05")).toBeNull();
  });

  it("adds interest and fees of the payments in the span", () => {
    const pay = (paidOn: string, interest: number, fee: number) => ({ paidOn, interest, fee });
    const book = { loans: [{ payments: [pay("2026-10-31", 100, 0), pay("2026-11-01", 200, 50), pay("2026-11-05", 300, 0)] }], capital: [], entries: [] } as unknown as Book;
    expect(interestIn(book, { from: "2026-11-01", to: "2026-11-05" })).toBe(550);
    expect(interestIn(book, { from: "2026-11-06", to: "2026-11-30" })).toBe(0);
  });
});
