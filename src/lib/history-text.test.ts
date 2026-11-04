import { describe, expect, it } from "vitest";
import { makeFmt } from "./format";
import { describeChange, describeFeeGroup, foldLateFees, type HistoryNames, type StoredChange } from "./history-text";

const t = (en: string) => en;
const fmt = makeFmt({ currencyCode: "DOP", numberStyle: "comma_dot", dateStyle: "medium" }, "en", "2026-11-03");
const names: HistoryNames = {
  client: (id) => (id === "c1" ? "María Rodríguez" : undefined),
  member: (id) => (id === "m1" ? "Ana Pérez" : undefined),
  loan: (id) => (id === "l1" ? { recordNo: 4, clientId: "c1" } : undefined),
};
const change = (o: Partial<StoredChange>): StoredChange => ({ entity: "settings", entityId: "s", action: "update", changes: [], reason: "", ...o });

describe("history in plain words", () => {
  it("names only the receipt parts that moved", () => {
    const all = { loanNumber: true, amountLent: true, rate: true, cycle: true, installments: true, split: true, lateFees: true, balance: true, history: true };
    const d = describeChange(change({ changes: [{ field: "receiptShow", old: JSON.stringify(all), new: JSON.stringify({ ...all, balance: false }) }] }), t, fmt, names);
    expect(d.subject).toBe("Settings");
    expect(d.lines).toEqual([{ label: "Receipts · Remaining balance", from: "Shown", to: "Hidden" }]);
  });

  it("writes rates, money, choices and the loan's name the way the app does", () => {
    const d = describeChange(
      change({
        entity: "loan",
        entityId: "l1",
        loanId: "l1",
        changes: [
          { field: "rate", old: "100000", new: "125000" },
          { field: "frequency", old: "weekly", new: "biweekly" },
          { field: "schedule", old: "8|1186664", new: "8|1500000" },
        ],
        reason: "Client asked",
      }),
      t,
      fmt,
      names,
    );
    expect(d.subject).toBe("Loan #4 · María Rodríguez");
    expect(d.lines).toEqual([
      { label: "Interest rate", from: "10%", to: "12.5%" },
      { label: "Payment cycle", from: "Weekly", to: "Every 15 days" },
      { label: "Payment plan", from: "8 installments · total RD$11,866.64", to: "8 installments · total RD$15,000.00" },
    ]);
    expect(d.reason).toBe("Client asked");
  });

  it("keeps a new loan short and a member named", () => {
    const loan = describeChange(
      change({
        entity: "loan",
        entityId: "l1",
        action: "create",
        changes: [
          { field: "client", old: "", new: "c1" },
          { field: "principal", old: "", new: "2500000" },
          { field: "rate", old: "", new: "100000" },
          { field: "interest_period", old: "", new: "monthly" },
        ],
      }),
      t,
      fmt,
      names,
    );
    expect(loan.lines).toEqual([
      { label: "Amount lent", value: "RD$25,000.00" },
      { label: "Interest rate", value: "10% a month" },
    ]);
    const member = describeChange(change({ entity: "member", entityId: "m1", changes: [{ field: "role", old: "collector", new: "viewer" }] }), t, fmt, names);
    expect(member.subject).toBe("Team · Ana Pérez");
    expect(member.lines).toEqual([{ label: "Role", from: "Collector", to: "Viewer" }]);
  });

  it("says which receipt text changed", () => {
    const d = describeChange(change({ changes: [{ field: "receiptText", old: "{}", new: JSON.stringify({ receipt_rules_heading: "=How your payments work" }) }] }), t, fmt, names);
    expect(d.lines).toEqual([{ label: "Heading of “How payments work”", from: "Built-in text", to: "How your payments work" }]);
  });

  it("folds the app's own late fee updates on a loan into one", () => {
    const fee = (seq: number, action: StoredChange["action"], old: string, next: string) => ({
      ...change({ entity: "late_fee", entityId: String(seq), loanId: "l1", action, changes: [{ field: "amount", old, new: next }] }),
      userId: "u1",
    });
    const waived = { ...change({ entity: "late_fee", entityId: "9", loanId: "l1", changes: [{ field: "waived", old: "false", new: "true" }] }), userId: "u1" };
    const list = [fee(4, "delete", "7417", ""), fee(5, "delete", "7417", ""), fee(1, "update", "7417", "9375"), waived, fee(2, "update", "7417", "9375")];
    const folded = foldLateFees(list);
    expect(folded.map((x) => (Array.isArray(x) ? x.length : 1))).toEqual([3, 1, 1]);
    const d = describeFeeGroup(folded[0] as StoredChange[], t, fmt, names);
    expect(d.subject).toBe("Late fees · Loan #4 · María Rodríguez");
    expect(d.lines).toEqual([
      { label: "Recalculated · Installment 1", from: "RD$74.17", to: "RD$93.75" },
      { label: "No longer overdue · Installments 4–5", from: "RD$148.34", to: "RD$0.00" },
    ]);
    // The same installment worked out twice: first value to last, not added up.
    const twice = describeFeeGroup([fee(3, "update", "200", "550"), fee(3, "update", "725", "200"), fee(2, "delete", "375", "")], t, fmt, names);
    expect(twice.lines).toEqual([
      { label: "Recalculated · Installment 3", from: "RD$7.25", to: "RD$5.50" },
      { label: "No longer overdue · Installment 2", from: "RD$3.75", to: "RD$0.00" },
    ]);
  });
});
