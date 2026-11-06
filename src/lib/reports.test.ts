import { describe, expect, it } from "vitest";
import { summary } from "../../shared/domain/portfolio";
import { demoSnapshot } from "../demo/demo";
import { computeBooks } from "../state/books";
import { makeFmt } from "./format";
import { collections, monthlyStatement, monthSpan, overdue, reportHtml, reportSheets, type ReportCtx, type ReportTable } from "./reports";
import { xlsx } from "./xlsx";

const today = demoSnapshot.today;
const t = (en: string) => en;
const books = computeBooks(demoSnapshot, today);
const ctx: ReportCtx = { books, snapshot: demoSnapshot, today, t, fmt: makeFmt(demoSnapshot.settings, "en", today) };
const col = (tb: ReportTable, i: number) => tb.rows.reduce<number>((a, r) => a + (Number(r[i]) || 0), 0);

describe("reports on the demo books", () => {
  it("the month's statement ends where the books are on its last day, and its totals add up", () => {
    const month = today.slice(0, 7);
    const r = monthlyStatement(ctx, month);
    const end = summary(books.book, monthSpan(month, today).to);
    expect(r.facts[1].value).toBe(end.portfolioValue);
    for (const tb of r.tables) for (let i = 0; i < tb.columns.length; i++) if (tb.columns[i].kind === "money" && tb.total?.[i] != null) expect(tb.total[i]).toBe(col(tb, i));
  });

  it("collections count every payment in the period once, grouped either way", () => {
    const from = "2000-01-01";
    const all = demoSnapshot.payments.reduce((a, p) => a + p.amount, 0);
    for (const by of ["client", "collector"] as const) {
      const r = collections(ctx, from, today, by);
      expect(r.facts[1].value).toBe(all);
      expect(col(r.tables[0], 4)).toBe(all);
      expect(r.tables[1].rows).toHaveLength(demoSnapshot.payments.length);
    }
  });

  it("the overdue report lists the loans overdue today, the worst first", () => {
    const r = overdue(ctx, today, "all");
    expect(r.facts[0].value).toBe(books.summary.overdueLoans);
    const days = r.tables[0].rows.map((x) => Number(x[4]));
    expect([...days].sort((a, b) => b - a)).toEqual(days);
    const far = overdue(ctx, today, "90+").tables[0].rows;
    expect(far.every((x) => Number(x[4]) > 90)).toBe(true);
  });

  it("prints and exports", () => {
    const r = overdue(ctx, today, "all");
    const html = reportHtml(ctx, r, "Préstamos <Valdez>");
    expect(html).toContain("Préstamos &lt;Valdez&gt;");
    expect(html).toContain("@page { size: letter");
    for (const rep of [r, collections(ctx, "2000-01-01", today, "collector"), monthlyStatement(ctx, today.slice(0, 7))]) expect(reportHtml(ctx, rep, "x")).not.toMatch(/NaN|undefined|Invalid/);
    expect(xlsx(reportSheets(ctx, r, "Préstamos Valdez")).length).toBeGreaterThan(500);
  });
});
