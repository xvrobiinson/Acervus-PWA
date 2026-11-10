import { describe, expect, it } from "vitest";
import { makeFmt } from "./format";
import { loanSentence } from "./loan-sentence";

const t = (en: string) => en;
const fmt = makeFmt({ currencyCode: "DOP", numberStyle: "comma_dot", dateStyle: "medium" }, "en", "2026-11-10");
const row = (due: string, principal: number, interest: number) => ({ due, principal, interest });

describe("the new loan's sentence", () => {
  it("names the same payment for a flat loan", () => {
    const s = loanSentence(
      { client: "Marta Quiroga", method: "flat", frequency: "weekly", schedule: [row("2026-11-17", 100000, 40000), row("2026-11-24", 100000, 40000)], periodInterest: 0, firstDue: "2026-11-17" },
      t,
      fmt,
    );
    expect(s).toBe("Marta pays RD$1,400.00 every week for 2 weeks, RD$2,800.00 in all, the first on Nov 17, 2026.");
  });

  it("gives the range for a declining loan", () => {
    const s = loanSentence(
      { client: null, method: "declining", frequency: "monthly", schedule: [row("2026-12-10", 50000, 10000), row("2027-01-10", 50000, 5000)], periodInterest: 0, firstDue: "2026-12-10" },
      t,
      fmt,
    );
    expect(s).toBe("The client pays 2 installments every month, from RD$600.00 to RD$550.00, RD$1,150.00 in all, the first on Dec 10, 2026.");
  });

  it("says about when installments differ only by a cent of rounding", () => {
    const s = loanSentence(
      { client: "Ana", method: "flat", frequency: "monthly", schedule: [row("2026-12-10", 333333, 0), row("2027-01-10", 333333, 0), row("2027-02-10", 333334, 0)], periodInterest: 0, firstDue: "2026-12-10" },
      t,
      fmt,
    );
    expect(s).toContain("pays about RD$3,333.33 every month");
  });

  it("says interest only and when the first is due", () => {
    const s = loanSentence({ client: "Priya Raman", method: "interest_only", frequency: "monthly", schedule: [], periodInterest: 25000, firstDue: "2026-12-10" }, t, fmt);
    expect(s).toContain("Priya pays RD$250.00 of interest every month, the first on Dec 10, 2026");
  });

  it("stays quiet while the schedule is being typed", () => {
    expect(loanSentence({ client: "A", method: "flat", frequency: "weekly", schedule: [row("2026-11-17", -1, 0)], periodInterest: 0, firstDue: "2026-11-17" }, t, fmt)).toBeNull();
  });
});
