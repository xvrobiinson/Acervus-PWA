// The three reports in the Reports panel, worked out on the device from the
// same books as every screen: a month's portfolio statement, the payments
// collected in a period (by client or by collector), and the loans overdue
// on a date. Each comes back as plain tables, then becomes a printable
// Letter page (PDF through the print dialog) or an Excel workbook.

import { addDays, addMonths, minDay, type Day } from "../../shared/domain/dates";
import { bookDelinquency, bookDisplayStatus, bookPosition, netInvested, summary } from "../../shared/domain/portfolio";
import { payoff } from "../../shared/domain/ledger";
import type { Books } from "../state/books";
import type { Snapshot } from "../state/types";
import type { Fmt } from "./format";
import type { T } from "./i18n";
import { displayStatusLabel, paidWithLabel } from "./labels";
import type { XCell, XKind, XSheet } from "./xlsx";

export interface ReportTable {
  title: string;
  columns: { label: string; kind: XKind }[];
  rows: XCell[][];
  total?: XCell[];
}

export interface Report {
  /** File names start with it. */
  file: string;
  title: string;
  period: string;
  facts: { label: string; value: XCell; kind: XKind }[];
  tables: ReportTable[];
}

export interface ReportCtx {
  books: Books;
  snapshot: Snapshot;
  today: Day;
  t: T;
  fmt: Fmt;
}

const name = (c: ReportCtx, userId: string) => c.snapshot.people.find((p) => p.userId === userId)?.name ?? "—";
const clientOf = (c: ReportCtx, loanId: string) => c.books.loanById.get(loanId)?.client?.fullName ?? "—";
const loanNo = (c: ReportCtx, loanId: string) => c.books.loanById.get(loanId)?.loan.recordNo ?? null;

/** Payments received between two days, both included. */
function paymentsIn(c: ReportCtx, from: Day, to: Day) {
  return c.snapshot.payments.filter((p) => p.paidOn >= from && p.paidOn <= to).sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : a.recordNo - b.recordNo));
}

/** Who brought a payment in: the collector for a confirmed collector payment, else who recorded it. */
function collectorOf(c: ReportCtx, paymentId: string, createdBy: string): string {
  const pending = c.snapshot.pending.find((p) => p.paymentId === paymentId && p.status === "confirmed");
  return pending ? pending.collectorName || name(c, pending.collectedBy) : name(c, createdBy);
}

/** "YYYY-MM" → its first and last day (the last no later than today). */
export function monthSpan(month: string, today: Day): { from: Day; to: Day } {
  const from = `${month}-01`;
  return { from, to: minDay(addDays(addMonths(from, 1), -1), today) };
}

export function monthlyStatement(c: ReportCtx, month: string): Report {
  const { t, books } = c;
  const { from, to } = monthSpan(month, c.today);
  const before = summary(books.book, addDays(from, -1));
  const after = summary(books.book, to);
  const pays = paymentsIn(c, from, to);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const newLoans = c.snapshot.loans.filter((l) => l.startDate >= from && l.startDate <= to);
  const capIn = c.snapshot.capital.filter((x) => x.occurredOn >= from && x.occurredOn <= to);
  const entries = c.snapshot.entries.filter((x) => x.occurredOn >= from && x.occurredOn <= to);
  const loans = books.loans
    .filter((l) => l.loan.startDate <= to)
    .map((l) => {
      const pos = bookPosition(l.book, to);
      return { l, pos, status: bookDisplayStatus(l.book, to) };
    })
    .filter((x) => x.pos.principalOutstanding > 0 || x.l.loan.startDate >= from || x.pos.lastEvent === null || x.pos.lastEvent >= from)
    .sort((a, b) => a.l.loan.recordNo - b.l.loan.recordNo);
  return {
    file: `statement-${month}`,
    title: t("Monthly portfolio statement", "Estado mensual del portafolio"),
    period: `${c.fmt.day(from)} – ${c.fmt.day(to)}`,
    facts: [
      { label: t("Portfolio value at the start", "Valor del portafolio al inicio"), value: before.portfolioValue, kind: "money" },
      { label: t("Portfolio value at the end", "Valor del portafolio al final"), value: after.portfolioValue, kind: "money" },
      { label: t("Change in the month", "Cambio en el mes"), value: after.portfolioValue - before.portfolioValue, kind: "money" },
      { label: t("Capital invested", "Capital invertido"), value: netInvested(after), kind: "money" },
      { label: t("Payments received", "Pagos recibidos"), value: pays.length, kind: "int" },
      { label: t("Collected", "Cobrado"), value: sum(pays.map((p) => p.amount)), kind: "money" },
      { label: t("Interest and late fees collected", "Interés y mora cobrados"), value: sum(pays.map((p) => p.interest + p.fee)), kind: "money" },
      { label: t("New loans", "Préstamos nuevos"), value: newLoans.length, kind: "int" },
      { label: t("Lent in new loans", "Prestado en préstamos nuevos"), value: sum(newLoans.map((l) => l.principal)), kind: "money" },
      { label: t("Capital added", "Capital agregado"), value: sum(capIn.filter((x) => x.kind === "contribution").map((x) => x.amount)), kind: "money" },
      { label: t("Capital withdrawn", "Capital retirado"), value: sum(capIn.filter((x) => x.kind === "withdrawal").map((x) => x.amount)), kind: "money" },
      { label: t("Expenses", "Gastos"), value: sum(entries.filter((x) => x.kind === "expense").map((x) => x.amount)), kind: "money" },
      { label: t("Other income", "Otros ingresos"), value: sum(entries.filter((x) => x.kind === "income").map((x) => x.amount)), kind: "money" },
      { label: t("Overdue at the end", "Atrasado al final"), value: after.overdueAmount, kind: "money" },
      { label: t("Loans overdue at the end", "Préstamos atrasados al final"), value: after.overdueLoans, kind: "int" },
    ],
    tables: [
      {
        title: t("Loans at the end of the month", "Préstamos al final del mes"),
        columns: [
          { label: t("Loan", "Préstamo"), kind: "int" },
          { label: t("Client", "Cliente"), kind: "text" },
          { label: t("Started", "Inicio"), kind: "date" },
          { label: t("Lent", "Prestado"), kind: "money" },
          { label: t("Capital owed", "Capital adeudado"), kind: "money" },
          { label: t("Owed in total", "Total adeudado"), kind: "money" },
          { label: t("Status", "Estado"), kind: "text" },
        ],
        rows: loans.map(({ l, pos, status }) => [l.loan.recordNo, l.client?.fullName ?? "—", l.loan.startDate, l.loan.principal, pos.principalOutstanding, payoff(pos), displayStatusLabel(t, status)]),
        total: [t("Total", "Total"), null, null, sum(loans.map((x) => x.l.loan.principal)), sum(loans.map((x) => x.pos.principalOutstanding)), sum(loans.map((x) => payoff(x.pos))), null],
      },
      {
        title: t("Payments in the month", "Pagos del mes"),
        columns: [
          { label: t("Date", "Fecha"), kind: "date" },
          { label: t("Client", "Cliente"), kind: "text" },
          { label: t("Loan", "Préstamo"), kind: "int" },
          { label: t("Capital", "Capital"), kind: "money" },
          { label: t("Interest and fees", "Interés y mora"), kind: "money" },
          { label: t("Amount", "Monto"), kind: "money" },
        ],
        rows: pays.map((p) => [p.paidOn, clientOf(c, p.loanId), loanNo(c, p.loanId), p.principal, p.interest + p.fee, p.amount]),
        total: [t("Total", "Total"), null, null, sum(pays.map((p) => p.principal)), sum(pays.map((p) => p.interest + p.fee)), sum(pays.map((p) => p.amount))],
      },
    ],
  };
}

export function collections(c: ReportCtx, from: Day, to: Day, by: "client" | "collector"): Report {
  const { t } = c;
  const pays = paymentsIn(c, from, to);
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const keyOf = (p: (typeof pays)[number]) => (by === "client" ? clientOf(c, p.loanId) : collectorOf(c, p._id, p.createdBy));
  const groups = new Map<string, typeof pays>();
  for (const p of pays) groups.set(keyOf(p), [...(groups.get(keyOf(p)) ?? []), p]);
  const grouped = [...groups.entries()].sort((a, b) => sum(b[1].map((p) => p.amount)) - sum(a[1].map((p) => p.amount)));
  return {
    file: `collections-${from}-${to}`,
    title: t("Collections report", "Reporte de cobros"),
    period: `${c.fmt.day(from)} – ${c.fmt.day(to)}`,
    facts: [
      { label: t("Payments", "Pagos"), value: pays.length, kind: "int" },
      { label: t("Collected", "Cobrado"), value: sum(pays.map((p) => p.amount)), kind: "money" },
      { label: t("Capital", "Capital"), value: sum(pays.map((p) => p.principal)), kind: "money" },
      { label: t("Interest and late fees", "Interés y mora"), value: sum(pays.map((p) => p.interest + p.fee)), kind: "money" },
    ],
    tables: [
      {
        title: by === "client" ? t("By client", "Por cliente") : t("By collector", "Por cobrador"),
        columns: [
          { label: by === "client" ? t("Client", "Cliente") : t("Collector", "Cobrador"), kind: "text" },
          { label: t("Payments", "Pagos"), kind: "int" },
          { label: t("Capital", "Capital"), kind: "money" },
          { label: t("Interest and fees", "Interés y mora"), kind: "money" },
          { label: t("Collected", "Cobrado"), kind: "money" },
        ],
        rows: grouped.map(([k, ps]) => [k, ps.length, sum(ps.map((p) => p.principal)), sum(ps.map((p) => p.interest + p.fee)), sum(ps.map((p) => p.amount))]),
        total: [t("Total", "Total"), pays.length, sum(pays.map((p) => p.principal)), sum(pays.map((p) => p.interest + p.fee)), sum(pays.map((p) => p.amount))],
      },
      {
        title: t("Every payment", "Cada pago"),
        columns: [
          { label: t("Date", "Fecha"), kind: "date" },
          { label: t("Client", "Cliente"), kind: "text" },
          { label: t("Loan", "Préstamo"), kind: "int" },
          { label: t("Collector", "Cobrador"), kind: "text" },
          { label: t("Paid with", "Pagado con"), kind: "text" },
          { label: t("Amount", "Monto"), kind: "money" },
        ],
        rows: pays.map((p) => [p.paidOn, clientOf(c, p.loanId), loanNo(c, p.loanId), collectorOf(c, p._id, p.createdBy), p.paidWith ? paidWithLabel(t, p.paidWith) : "", p.amount]),
        total: [t("Total", "Total"), null, null, null, null, sum(pays.map((p) => p.amount))],
      },
    ],
  };
}

export type OverdueBand = "all" | "1-30" | "31-90" | "90+";
const inBand = (days: number, b: OverdueBand) => (b === "all" ? true : b === "1-30" ? days <= 30 : b === "31-90" ? days > 30 && days <= 90 : days > 90);

export function overdue(c: ReportCtx, asOf: Day, band: OverdueBand): Report {
  const { t } = c;
  const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
  const late = c.books.loans
    .filter((l) => l.loan.startDate <= asOf && bookDisplayStatus(l.book, asOf) === "overdue")
    .map((l) => ({ l, d: bookDelinquency(l.book, asOf), pos: bookPosition(l.book, asOf) }))
    .filter((x) => inBand(x.d.daysOverdue, band))
    .sort((a, b) => b.d.daysOverdue - a.d.daysOverdue);
  return {
    file: `overdue-${asOf}`,
    title: t("Overdue report", "Reporte de atrasos"),
    period: t(`As of ${c.fmt.day(asOf)}`, `Al ${c.fmt.day(asOf)}`),
    facts: [
      { label: t("Loans overdue", "Préstamos atrasados"), value: late.length, kind: "int" },
      { label: t("Amount behind", "Monto atrasado"), value: sum(late.map((x) => x.d.overdueAmount)), kind: "money" },
      { label: t("Owed in total on them", "Total adeudado en ellos"), value: sum(late.map((x) => payoff(x.pos))), kind: "money" },
    ],
    tables: [
      {
        title: t("Loans overdue", "Préstamos atrasados"),
        columns: [
          { label: t("Loan", "Préstamo"), kind: "int" },
          { label: t("Client", "Cliente"), kind: "text" },
          { label: t("Phone", "Teléfono"), kind: "text" },
          { label: t("Late since", "Atrasado desde"), kind: "date" },
          { label: t("Days late", "Días de atraso"), kind: "int" },
          { label: t("Amount behind", "Monto atrasado"), kind: "money" },
          { label: t("Owed in total", "Total adeudado"), kind: "money" },
        ],
        rows: late.map(({ l, d, pos }) => [l.loan.recordNo, l.client?.fullName ?? "—", l.client?.phone ?? "", d.overdueSince, d.daysOverdue, d.overdueAmount, payoff(pos)]),
        total: [t("Total", "Total"), null, null, null, null, sum(late.map((x) => x.d.overdueAmount)), sum(late.map((x) => payoff(x.pos)))],
      },
    ],
  };
}

// ----- output --------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function show(c: ReportCtx, v: XCell, kind: XKind): string {
  if (v === null || v === "") return "";
  if (kind === "money" && typeof v === "number") return c.fmt.money(v);
  if (kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return c.fmt.day(v);
  if (kind === "int" && typeof v === "number") return String(v);
  return String(v);
}

/** A printable Letter page (the print dialog saves the PDF). */
export function reportHtml(c: ReportCtx, r: Report, business: string): string {
  const generated = c.t(`Made on ${c.fmt.day(c.today)} with Acervus Finance`, `Hecho el ${c.fmt.day(c.today)} con Acervus Finance`);
  const right = (k: XKind) => (k === "money" || k === "int" ? ' class="n"' : "");
  const table = (tb: ReportTable) =>
    `<h2>${esc(tb.title)}</h2>` +
    (tb.rows.length === 0
      ? `<p class="none">${esc(c.t("Nothing in this period.", "Nada en este período."))}</p>`
      : `<table><thead><tr>${tb.columns.map((col) => `<th${right(col.kind)}>${esc(col.label)}</th>`).join("")}</tr></thead><tbody>` +
        tb.rows.map((row) => `<tr>${tb.columns.map((col, i) => `<td${right(col.kind)}>${esc(show(c, row[i] ?? null, col.kind))}</td>`).join("")}</tr>`).join("") +
        `${tb.total ? `<tr class="total">${tb.columns.map((col, i) => `<td${right(col.kind)}>${esc(show(c, tb.total![i] ?? null, col.kind))}</td>`).join("")}</tr>` : ""}</tbody></table>`);
  return `<!doctype html><html lang="${c.fmt.lang === "en" ? "en" : "es"}"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
@page { size: letter; margin: 0.6in; }
:root { --fit: 1; }
* { box-sizing: border-box; }
html { background: #e9ecee; }
body { margin: 0 auto; width: 816px; min-height: 1056px; background: #fff; color: #1a1d21; font: 12px/1.45 Inter, "Segoe UI", system-ui, sans-serif; padding: 56px; transform: scale(var(--fit)); transform-origin: top left; font-variant-numeric: tabular-nums; }
@media print { html { background: none; } body { width: auto; min-height: 0; padding: 0; transform: none; } }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1a1d21; padding-bottom: 12px; margin-bottom: 18px; }
header .biz { font-size: 12px; color: #5f656b; }
h1 { font-size: 22px; font-weight: 600; margin: 2px 0 0; letter-spacing: -0.01em; }
header .period { font-size: 12.5px; text-align: right; }
.facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin-bottom: 20px; }
.facts div { border-bottom: 1px solid #e3e6e9; padding: 4px 0 6px; }
.facts span { display: block; color: #5f656b; font-size: 11px; }
.facts b { font-weight: 600; font-size: 13px; }
h2 { font-size: 13.5px; margin: 22px 0 8px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 600; font-size: 11px; color: #5f656b; border-bottom: 1px solid #c9ced2; padding: 5px 6px; }
td { padding: 5px 6px; border-bottom: 1px solid #eef0f2; }
tr.total td { font-weight: 600; border-top: 1px solid #1a1d21; border-bottom: 0; }
.n { text-align: right; white-space: nowrap; }
tr { page-break-inside: avoid; }
.none { color: #5f656b; }
footer { margin-top: 28px; color: #7d838a; font-size: 10.5px; }
</style></head><body>
<header><div><div class="biz">${esc(business)}</div><h1>${esc(r.title)}</h1></div><div class="period">${esc(r.period)}</div></header>
<section class="facts">${r.facts.map((f) => `<div><span>${esc(f.label)}</span><b>${esc(show(c, f.value, f.kind))}</b></div>`).join("")}</section>
${r.tables.map(table).join("")}
<footer>${esc(generated)}</footer>
</body></html>`;
}

/** The same report as Excel sheets: the figures first, then each table. */
export function reportSheets(c: ReportCtx, r: Report, business: string): XSheet[] {
  return [
    {
      name: c.t("Summary", "Resumen"),
      title: `${r.title} · ${business}`,
      subtitle: r.period,
      columns: [
        { label: c.t("Figure", "Cifra"), kind: "text", width: 38 },
        { label: c.t("Amount", "Monto"), kind: "money", width: 16 },
        { label: c.t("Count", "Cantidad"), kind: "int", width: 10 },
      ],
      rows: r.facts.map((f) => [f.label, f.kind === "int" ? null : f.value, f.kind === "int" ? f.value : null]),
    },
    ...r.tables.map((tb) => ({ name: tb.title, title: tb.title, subtitle: `${business} · ${r.period}`, columns: tb.columns, rows: tb.rows, total: tb.total })),
  ];
}
