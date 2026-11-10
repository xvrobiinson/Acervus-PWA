// Printable receipts on US Letter paper — the desktop's payment and loan
// receipts (src/services/receipt.rs) ported to the browser: the same
// figures from the same engine, the same layout and wording. The page is
// shown in the app and printed with the browser's print dialog, which also
// saves it as a PDF (Android: "Save as PDF"; iPhone: Share › Save to Files).

import { MAX_DAY, type Day } from "../../shared/domain/dates";
import {
  appliedTotal,
  installmentStatus,
  owed,
  planPaidOff,
  principalOutstanding,
  remaining,
  run,
  unpaidFee,
  unpaidInterest,
  type Applied,
  type PlanState,
} from "../../shared/domain/installments";
import { delinquency, owedAtPayment, payoff, type PaymentFact } from "../../shared/domain/ledger";
import { effectiveRate, hasInstallments, periodInterest, rateConverts, type Frequency, type Method } from "../../shared/domain/loans";
import { ratioLabel, type Cents } from "../../shared/domain/money";
import {
  byLedgerOrder,
  loanFacts,
  paymentFact,
  planFor,
  type LateFeeRecord,
  type LoanRecord,
  type PaymentRecord,
} from "../../shared/domain/records";
import type { Fmt } from "../lib/format";
import type { T } from "../lib/i18n";
import { frequencyLabel, frequencyPer, methodShort, paidWithLabel } from "../lib/labels";
import { fill, linesFor, Wording, type RuleSet, type Tags } from "./wording";

export interface ReceiptSettings {
  receiptName: string;
  companyAddress: string;
  companyPhone: string;
  receiptCompany: { name: boolean; address: boolean; phone: boolean };
  receiptClient: { name: boolean; idNumber: boolean; phone: boolean; address: boolean };
  receiptShow?: Partial<ReceiptShow>;
  /** Payment receipts: the full schedule and history (unset), or what was
   *  paid and the next payment (2026-11-09, each business picks). */
  receiptFormat?: ReceiptFormat;
  receiptText: Record<string, string>;
}

export type ReceiptFormat = "full" | "next";

/** The paper this device prints receipts on: Letter, or a thermal roll
 *  (58 mm, 80 mm, 112 mm: the 2¼", 3⅛" and 4" rolls of counter and
 *  Bluetooth printers). Kept per device; rolls always print the short
 *  receipt. */
export type Paper = "letter" | "58mm" | "80mm" | "112mm";
export const PAPERS: Paper[] = ["letter", "80mm", "58mm", "112mm"];
/** Roll width and the width a thermal head prints, in millimetres. */
const ROLL: Record<Exclude<Paper, "letter">, [number, number]> = { "58mm": [58, 48], "80mm": [80, 72], "112mm": [112, 104] };

/** Optional parts of a payment receipt (Settings › Receipts). The business
 *  name, amount paid, date and receipt number always print; the loan
 *  receipt is the client's agreement and keeps every term. */
export interface ReceiptShow {
  loanNumber: boolean;
  amountLent: boolean;
  rate: boolean;
  cycle: boolean;
  installments: boolean;
  split: boolean;
  lateFees: boolean;
  balance: boolean;
  history: boolean;
}

export const SHOW_KEYS: (keyof ReceiptShow)[] = ["loanNumber", "amountLent", "rate", "cycle", "installments", "split", "lateFees", "balance", "history"];

/** Every part shown unless the business switched it off. */
export function receiptShow(s: { receiptShow?: Partial<ReceiptShow> }): ReceiptShow {
  return Object.fromEntries(SHOW_KEYS.map((k) => [k, s.receiptShow?.[k] ?? true])) as unknown as ReceiptShow;
}

export interface ReceiptClient {
  fullName: string;
  idNumber: string;
  phone: string;
  address: string;
}

export interface ReceiptContext {
  t: T;
  fmt: Fmt;
  settings: ReceiptSettings;
  /** Business name, used when the receipt name is empty. */
  businessName: string;
  /** The logo as a data: URL (so it prints offline), or null. */
  logo: string | null;
  /** This device's paper; Letter when unset. Loan receipts are always Letter. */
  paper?: Paper;
}

/** Table rows that fit on one Letter page under the rest of a payment
 *  receipt (measured on the desktop by printing receipts in Edge). */
const PAYMENT_PAGE_ROWS = 26;
const LOAN_PAGE_ROWS = 20;
const LOAN_TEXT_PT = 460;
const SCHEDULE_HEAD_PT = 76;
const SCHEDULE_ROW_PT = 13.7;
const LINE_PT = 12;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CHECK = '<span class="check">&#10003;</span>';

interface Company {
  name: string | null;
  address: string | null;
  phone: string | null;
}

function companyLines(c: ReceiptContext): Company {
  const s = c.settings;
  const keep = (on: boolean, v: string) => (on && v.trim() ? v.trim() : null);
  return {
    name: s.receiptCompany.name ? receiptTitle(c) : null,
    address: keep(s.receiptCompany.address, s.companyAddress),
    phone: keep(s.receiptCompany.phone, s.companyPhone),
  };
}

export function receiptTitle(c: ReceiptContext): string {
  return c.settings.receiptName.trim() || c.businessName || "Acervus Finance";
}

function clientRows(c: ReceiptContext, client: ReceiptClient): [string, string][] {
  const f = c.settings.receiptClient;
  const t = c.t;
  const rows: [boolean, string, string][] = [
    [f.name, t("Name", "Nombre"), client.fullName],
    [f.idNumber, t("ID number", "Identificación"), client.idNumber],
    [f.phone, t("Phone", "Teléfono"), client.phone],
    [f.address, t("Address", "Dirección"), client.address],
  ];
  return rows.filter(([on, , v]) => on && v.trim() !== "").map(([, l, v]) => [l, v.trim()]);
}

function rateLine(t: T, fmt: Fmt, loan: LoanRecord): string {
  const rate = `${fmt.rate(loan.rate)} ${frequencyPer(t, loan.interestPeriod)}`;
  if (loan.interestPeriod === loan.frequency) return rate;
  const paid = frequencyLabel(t, loan.frequency).toLowerCase();
  return t(`${rate} · paid ${paid}`, `${rate} · pago ${paid}`);
}

function conversionNote(t: T, fmt: Fmt, loan: LoanRecord): string | null {
  const r = { rate: loan.rate, per: loan.interestPeriod, every: loan.frequency };
  if (!rateConverts(r)) return null;
  const quoted = `${fmt.rate(loan.rate)} ${frequencyPer(t, loan.interestPeriod)}`;
  const eff = fmt.rate(effectiveRate(r));
  const per = frequencyPer(t, loan.frequency);
  const days: Record<Frequency, number> = { daily: 1, weekly: 7, biweekly: 15, monthly: 30 };
  const [a, b] = [days[loan.frequency], days[loan.interestPeriod]];
  return t(`${quoted} = ${eff} ${per} (${a} of ${b} days)`, `${quoted} = ${eff} ${per} (${a} de ${b} días)`);
}

const BASE_CSS = `
  :root { --ink:#17191c; --muted:#5f6570; --rule:#dfe2e7; --soft:#f4f5f7; --accent:#365cf5; --pos:#137a60; --pos-bg:#e7f5f0; --warn:#9a5f0e; --warn-bg:#fbf1e1; --neg:#c2353d; --neg-bg:#fdecec; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin:0; background:#e9ebef; color:var(--ink); font: 9.5pt/1.38 "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-variant-numeric: tabular-nums; }
  .sheet { width: 8.5in; min-height: 11in; margin: 16px auto; padding: 0.5in; background:#fff; box-shadow: 0 1px 3px rgba(15,26,46,.12), 0 12px 32px -8px rgba(15,26,46,.18); }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:16pt; padding-bottom:9pt; border-bottom:1.5pt solid var(--ink); }
  .brand { display:flex; align-items:center; gap:10pt; min-width:0; }
  .logo { display:block; max-width:84pt; max-height:48pt; object-fit:contain; }
  h1 { font-size:15pt; line-height:1.2; margin:0; }
  h2 { font-size:10pt; margin:0 0 4pt; }
  .kind { color:var(--muted); margin:1pt 0 0; }
  .contact { margin:1pt 0 0; font-size:8.5pt; }
  .doc { text-align:right; white-space:nowrap; }
  .doc b { display:block; font-size:11pt; }
  .muted { color:var(--muted); }
  .cols { display:grid; grid-template-columns: 1fr 1fr; gap: 0 22pt; }
  .block { padding-top:8pt; }
  .label { font-size:7.5pt; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin:0 0 3pt; }
  table { width:100%; border-collapse:collapse; }
  td, th { padding:1.6pt 0; vertical-align:top; }
  th { text-align:left; font-weight:600; color:var(--muted); font-size:7.5pt; letter-spacing:.04em; text-transform:uppercase; border-bottom:1pt solid var(--rule); padding-bottom:3pt; }
  td + td, th + th { padding-left:8pt; }
  .num { text-align:right; white-space:nowrap; }
  table.kv td:first-child { color:var(--muted); padding-right:8pt; white-space:nowrap; }
  table.kv.left td:first-child { width:30%; }
  table.kv td:last-child { text-align:right; }
  table.kv.left td:last-child { text-align:left; }
  table.grid tbody tr { border-bottom:0.5pt solid var(--rule); }
  table.grid { font-size:8.5pt; line-height:1.25; }
  table.grid td { padding-top:1.3pt; padding-bottom:1.3pt; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  tr.sub td { color:var(--muted); }
  tr.total td { font-weight:600; font-size:10.5pt; border-top:1pt solid var(--rule); padding-top:4pt; }
  tr.this td { background:#f3f5ff; font-weight:600; }
  .tag { display:inline-block; font-size:7pt; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); margin-left:4pt; }
  .st { display:inline-block; white-space:nowrap; font-weight:600; font-size:7.5pt; line-height:1.3; padding:0 4pt; border-radius:3pt; }
  .st.ok { color:var(--pos); background:var(--pos-bg); }
  .st.part { color:var(--warn); background:var(--warn-bg); }
  .st.late { color:var(--neg); background:var(--neg-bg); }
  .st.pend { color:var(--muted); background:var(--soft); }
  .neg { color:var(--neg); }
  .note { margin:6pt 0 0; padding:5pt 8pt; background:var(--soft); border-radius:4pt; font-size:8.5pt; }
  .done { color:var(--pos); background:var(--pos-bg); font-weight:600; }
  .end { display:flex; justify-content:space-between; gap:16pt; margin-top:12pt; padding-top:6pt; border-top:0.5pt solid var(--rule); color:var(--muted); font-size:8.5pt; }
  .provisional { border:2pt solid var(--warn); color:var(--warn); border-radius:6pt; text-align:center; font-weight:700; font-size:12pt; padding:4pt; margin-bottom:8pt; }
  .provisional span { display:block; font-size:8.5pt; font-weight:400; }
  @media screen and (max-width: 8.6in) { body { zoom: var(--fit, 1); } }
  @media print {
    body { background:#fff; zoom: 1; }
    .sheet { width:auto; min-height:0; margin:0; padding:0; box-shadow:none; }
  }
`;

function page(c: ReceiptContext, title: string, cls: string, css: string, body: string, paper: Paper = "letter"): string {
  const t = c.t;
  const footer = esc(title).replace(/"/g, "'");
  const roll = paper === "letter" ? null : ROLL[paper];
  const pageRule = roll
    ? `@page { margin: 0; }`
    : `@page { size: letter; margin: 0.5in;
    @bottom-left { content: "${footer}"; font: 7.5pt Arial, sans-serif; color: #5f6570; }
    @bottom-right { content: "${t("Page", "Página")} " counter(page) " ${t("of", "de")} " counter(pages); font: 7.5pt Arial, sans-serif; color: #5f6570; }
  }`;
  const rollCss = roll ? rollCssFor(roll[0], roll[1]) : "";
  return `<!doctype html>
<html lang="${c.fmt.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  ${pageRule}
${BASE_CSS}${css}${rollCss}</style>
</head>
<body>
<div class="sheet ${cls}${roll ? " roll" : ""}">
${body}
</div>
</body>
</html>`;
}

const row = (label: string, value: string, cls = "") =>
  `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${value}</td></tr>`;

const status = (cls: string, text: string, check: boolean) =>
  `<span class="st ${cls}">${check ? `${CHECK} ` : ""}${esc(text)}</span>`;

function header(c: ReceiptContext, company: Company, kind: string, number: string, dateLabel: string, date: string): string {
  const name = company.name ? `<h1>${esc(company.name)}</h1>` : "";
  const contact = [company.address, company.phone].filter((v): v is string => !!v).map(esc);
  const contactHtml = contact.length ? `<p class="contact">${contact.join(" · ")}</p>` : "";
  const logo = c.logo ? `<img class="logo" src="${esc(c.logo)}" alt="">` : "";
  return `<div class="top">
  <div class="brand">${logo}<div>${name}${contactHtml}<p class="kind">${esc(kind)} · ${esc(c.t("No.", "No."))} ${esc(number)}</p></div></div>
  <div class="doc"><span class="muted">${esc(dateLabel)}</span><b>${esc(date)}</b></div>
</div>`;
}

function clientBlock(c: ReceiptContext, client: ReceiptClient): string {
  const rows = clientRows(c, client);
  if (!rows.length) return "";
  const body = rows.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join("");
  return `<div class="block"><p class="label">${esc(c.t("Client", "Cliente"))}</p><table class="kv left">${body}</table></div>`;
}

function loanBlock(c: ReceiptContext, loan: LoanRecord, show: ReceiptShow): string {
  const { t, fmt } = c;
  const rows = [
    show.loanNumber && row(t("Loan", "Préstamo"), `#${loan.recordNo}`),
    show.cycle && row(t("Type", "Tipo"), esc(methodShort(t, loan.method))),
    show.rate && row(t("Interest rate", "Tasa de interés"), esc(rateLine(t, fmt, loan))),
    show.amountLent && row(t("Amount lent", "Monto prestado"), esc(fmt.money(loan.principal))),
    row(t("Loan date", "Fecha del préstamo"), esc(fmt.day(loan.startDate))),
  ]
    .filter(Boolean)
    .join("");
  return `<div class="block"><p class="label">${esc(t("Loan", "Préstamo"))}</p><table class="kv">${rows}</table></div>`;
}

const companyTag = (c: ReceiptContext, company: Company) => (company.name ? receiptTitle(c) : c.t("the lender", "el prestamista"));
const textRows = (s: string) => Math.ceil([...s.trim()].length / 130);

// ----- payment receipt -----------------------------------------------------

type Standing = "paid" | "partly_paid" | "overdue" | "pending";
type PaymentStanding = { kind: "settled" } | { kind: "partial"; left: Cents } | { kind: "paid_off" };

interface InstallmentLine {
  seq: number;
  remaining: Cents;
  paid: boolean;
}

function installmentLines(applied: Applied[], state: PlanState, on: Day): InstallmentLine[] {
  return applied.flatMap((a) => {
    const x = state.installments.find((i) => i.seq === a.seq);
    return x ? [{ seq: a.seq, remaining: remaining(x), paid: installmentStatus(x, on) === "paid" }] : [];
  });
}

/** Everything still to pay right after a payment, as its receipt shows it:
 *  installment loans, all that is left of the schedule; others, capital and
 *  interest still owed. (The WhatsApp receipt text, src/lib/whatsapp.ts.) */
export function balanceAfterPayment(loan: LoanRecord, payments: PaymentRecord[], lateFees: LateFeeRecord[], paymentId: string): Cents | null {
  const payment = payments.find((p) => p._id === paymentId);
  if (!payment) return null;
  const live = payments.filter((p) => p.loanId === loan._id && byLedgerOrder(p, payment) <= 0).sort(byLedgerOrder);
  const facts = loanFacts(loan);
  const plan = planFor(loan, lateFees);
  if (plan) {
    const pays = live.map((p) => ({ paidOn: p.paidOn, amount: p.amount, instruction: { kind: "fixed" as const, applied: p.applied } }));
    const s = run(facts, plan, pays, payment.paidOn, MAX_DAY);
    return s.ok ? s.value.installments.reduce((a, x) => a + remaining(x), 0) : null;
  }
  const pos = owedAtPayment(facts, live.map(paymentFact), payment.paidOn);
  return pos.principalOutstanding + pos.interestOutstanding;
}

/** What to pay next right after a payment (the short receipt and its
 *  WhatsApp text): installment loans, the next installment plus anything
 *  late; interest-only loans, the next interest payment. Null once the loan
 *  is paid off. */
export function nextAfterPayment(loan: LoanRecord, payments: PaymentRecord[], lateFees: LateFeeRecord[], paymentId: string): NextPayment | null {
  const payment = payments.find((p) => p._id === paymentId);
  if (!payment) return null;
  const live = payments.filter((p) => p.loanId === loan._id && byLedgerOrder(p, payment) <= 0).sort(byLedgerOrder);
  const facts = loanFacts(loan);
  const on = payment.paidOn;
  const plan = planFor(loan, lateFees);
  if (plan) {
    const pays = live.map((p) => ({ paidOn: p.paidOn, amount: p.amount, instruction: { kind: "fixed" as const, applied: p.applied } }));
    const s = run(facts, plan, pays, on, MAX_DAY);
    if (!s.ok || s.value.installments.every((x) => remaining(x) <= 0)) return null;
    // The next installment with what is still owed by the payment day; only
    // what fell due before that day is called late (one due that very day
    // isn't late yet).
    const owedNow = s.value.installments.filter((x) => x.due <= on).reduce((a, x) => a + owed(x), 0);
    const late = s.value.installments.filter((x) => x.due < on).reduce((a, x) => a + owed(x), 0);
    const next = s.value.installments.find((x) => x.due > on && remaining(x) > 0);
    if (next) return { on: next.due, amount: remaining(next) + owedNow, late, interest: false };
    return owedNow > 0 ? { on: null, amount: owedNow, late, interest: false } : null;
  }
  const q = delinquency({ ...facts, status: "active" }, live.map(paymentFact), on);
  return q.nextDue ? { on: q.nextDue, amount: q.nextDueAmount, late: q.overdueAmount, interest: true } : null;
}

export function paymentReceiptHtml(
  c: ReceiptContext,
  r: { loan: LoanRecord; client: ReceiptClient; payments: PaymentRecord[]; lateFees: LateFeeRecord[]; paymentId: string },
): string | null {
  const { t, fmt } = c;
  const m = (v: Cents) => esc(fmt.money(v));
  const payment = r.payments.find((p) => p._id === r.paymentId);
  if (!payment) return null;
  const loan = r.loan;
  const installmentLoan = hasInstallments(loan.method);
  const live = r.payments.filter((p) => p.loanId === loan._id && byLedgerOrder(p, payment) <= 0).sort(byLedgerOrder);
  const facts = loanFacts(loan);
  const history: { p: PaymentRecord; standing: PaymentStanding; lines: InstallmentLine[]; capitalLeft: Cents }[] = [];
  let principalBefore = 0;
  let principalAfter = 0;
  let interestAfter = 0;
  let feesAfter = 0;
  let overdueAfter = 0;
  let schedule: { seq: number; due: Day; amount: Cents; paid: Cents; remaining: Cents; standing: Standing; thisPayment: Cents }[] = [];
  let installmentsPaid: [number, number] | null = null;
  let leftToPay: Cents | null = null;
  let nextDue: [Day, Cents] | null = null;
  let thisLines: InstallmentLine[] = [];

  const plan = planFor(loan, r.lateFees);
  if (plan) {
    const pays = [];
    let after: PlanState | null = null;
    for (const p of live) {
      pays.push({ paidOn: p.paidOn, amount: p.amount, instruction: { kind: "fixed" as const, applied: p.applied } });
      const s = run(facts, plan, pays, p.paidOn, MAX_DAY);
      if (!s.ok) return null;
      const lines = installmentLines(p.applied, s.value, p.paidOn);
      const left = lines.filter((x) => !x.paid).reduce((a, x) => a + x.remaining, 0);
      const standing: PaymentStanding = planPaidOff(s.value)
        ? { kind: "paid_off" }
        : left > 0
          ? { kind: "partial", left }
          : { kind: "settled" };
      history.push({ p, standing, lines, capitalLeft: principalOutstanding(s.value) });
      after = s.value;
    }
    if (!after) return null;
    const on = payment.paidOn;
    principalAfter = principalOutstanding(after);
    principalBefore = principalAfter + payment.principal;
    const dueNow = after.installments.filter((x) => x.due <= on);
    interestAfter = dueNow.reduce((a, x) => a + unpaidInterest(x), 0);
    feesAfter = after.installments.reduce((a, x) => a + unpaidFee(x), 0);
    overdueAfter = dueNow.reduce((a, x) => a + owed(x), 0);
    thisLines = installmentLines(payment.applied, after, on);
    schedule = after.installments.map((x) => {
      const st = installmentStatus(x, on);
      return {
        seq: x.seq,
        due: x.due,
        amount: x.principal + x.interest + x.fee,
        paid: x.paidPrincipal + x.paidInterest + x.paidFee,
        remaining: remaining(x),
        standing: st === "paid" ? "paid" : st === "overdue" ? "overdue" : st === "partly_paid" ? "partly_paid" : "pending",
        thisPayment: payment.applied.filter((a) => a.seq === x.seq).reduce((s, a) => s + appliedTotal(a), 0),
      };
    });
    installmentsPaid = [after.installments.filter((x) => remaining(x) <= 0).length, after.installments.length];
    leftToPay = after.installments.reduce((a, x) => a + remaining(x), 0);
    const next = after.installments.find((x) => x.due > on && remaining(x) > 0);
    nextDue = next ? [next.due, remaining(next) + overdueAfter] : null;
  } else {
    const fs: PaymentFact[] = [];
    let pos = null;
    for (const p of live) {
      fs.push(paymentFact(p));
      pos = owedAtPayment(facts, fs, p.paidOn);
      const standing: PaymentStanding =
        payoff(pos) <= 0 ? { kind: "paid_off" } : pos.interestOutstanding > 0 ? { kind: "partial", left: pos.interestOutstanding } : { kind: "settled" };
      history.push({ p, standing, lines: [], capitalLeft: pos.principalOutstanding });
    }
    if (!pos) return null;
    principalBefore = pos.principalOutstanding + payment.principal;
    principalAfter = pos.principalOutstanding;
    interestAfter = pos.interestOutstanding;
  }
  void thisLines;

  const owedAfter = principalAfter + interestAfter + feesAfter;
  const balanceAfter = leftToPay ?? owedAfter;
  const number = String(payment.recordNo).padStart(6, "0");
  const company = companyLines(c);
  const wording = new Wording(c.settings.receiptText, t);

  const show = receiptShow(c.settings);
  const paid = [row(t("Amount paid", "Monto pagado"), m(payment.amount), "total")];
  if (payment.paidWith) paid.push(row(t("Paid with", "Forma de pago"), esc(paidWithLabel(t, payment.paidWith)), "sub"));
  if (payment.fee > 0 && show.lateFees) paid.push(row(installmentLoan ? t("Late fees", "Cargos por mora") : t("Fee", "Cargo"), m(payment.fee), "sub"));
  if (show.split) {
    paid.push(row(t("Interest", "Interés"), m(payment.interest), "sub"));
    paid.push(row(t("Capital", "Abono a capital"), m(payment.principal), "sub"));
  }

  const paper = c.paper ?? "letter";
  if ((c.settings.receiptFormat ?? "full") === "next" || paper !== "letter") {
    const next = balanceAfter <= 0 ? null : nextAfterPayment(loan, r.payments, r.lateFees, payment._id);
    return nextPaymentReceipt(c, { loan, client: r.client, payment, number, company, footer: wording.paymentFooter(), show, balanceAfter, next, installmentsPaid, principalAfter }, paper);
  }

  const bal = [
    row(t("Capital before this payment", "Capital antes de este pago"), m(principalBefore)),
    row(t("Capital remaining", "Capital pendiente"), m(principalAfter)),
  ];
  if (interestAfter > 0) bal.push(row(t("Interest pending", "Interés pendiente"), m(interestAfter)));
  if (feesAfter > 0 && show.lateFees) bal.push(row(t("Late fees pending", "Cargos por mora pendientes"), `<span class="neg">${m(feesAfter)}</span>`));
  if (overdueAfter > 0 && installmentLoan) bal.push(row(t("Due and unpaid now", "Vencido sin pagar"), `<span class="neg">${m(overdueAfter)}</span>`));
  bal.push(
    leftToPay !== null
      ? row(t("Total left to pay", "Total por pagar"), m(leftToPay), "total")
      : row(t("Total owed now", "Total adeudado"), m(owedAfter), "total"),
  );
  const repaid = ratioLabel(loan.principal - principalAfter, loan.principal) ?? "0.0%";
  const nextLine =
    nextDue && show.installments
      ? t(` Next installment: ${fmt.day(nextDue[0])} · ${fmt.money(nextDue[1])}.`, ` Próxima cuota: ${fmt.day(nextDue[0])} · ${fmt.money(nextDue[1])}.`)
      : "";
  const progress = (show.balance ? t(`${repaid} of the capital repaid.`, `${repaid} del capital pagado.`) + nextLine : nextLine).trim();
  const statusLine =
    balanceAfter <= 0
      ? `<p class="note done">${CHECK} ${esc(t("This loan is fully paid. Thank you!", "Este préstamo quedó saldado. ¡Gracias!"))}</p>`
      : progress
        ? `<p class="note">${esc(progress)}</p>`
        : "";
  const notes = payment.notes?.trim() ? `<p class="muted">${esc(t("Note:", "Nota:"))} ${esc(payment.notes)}</p>` : "";

  const standingHtml = (s: Standing, paidAmt: Cents) =>
    s === "paid"
      ? status("ok", t("Paid", "Pagada"), true)
      : s === "partly_paid"
        ? status("part", t("Partly paid", "Pago parcial"), false)
        : s === "overdue"
          ? status("late", paidAmt > 0 ? t("Overdue · partly paid", "Atrasada · pago parcial") : t("Overdue", "Atrasada"), false)
          : status("pend", t("Pending", "Pendiente"), false);

  const scheduleHtml = installmentLoan && show.installments
    ? `<div class="block"><h2>${esc(t("Installments", "Cuotas"))} <span class="muted">· ${esc(
        t(`${installmentsPaid![0]} of ${installmentsPaid![1]} paid in full`, `${installmentsPaid![0]} de ${installmentsPaid![1]} pagadas por completo`),
      )}</span></h2>
<table class="grid"><thead><tr><th>#</th><th>${esc(t("Due date", "Vence"))}</th><th class="num">${esc(t("Amount", "Monto"))}</th><th class="num">${esc(
        t("This payment", "Este pago"),
      )}</th><th class="num">${esc(t("Paid", "Pagado"))}</th><th class="num">${esc(t("Left", "Falta"))}</th><th>${esc(t("Status", "Estado"))}</th></tr></thead><tbody>${schedule
        .map(
          (x) =>
            `<tr class="${x.thisPayment > 0 ? "this" : ""}"><td>${x.seq}</td><td>${esc(fmt.day(x.due))}</td><td class="num">${m(x.amount)}</td><td class="num">${
              x.thisPayment > 0 ? m(x.thisPayment) : ""
            }</td><td class="num">${m(x.paid)}</td><td class="num">${x.remaining > 0 ? m(x.remaining) : "—"}</td><td>${standingHtml(x.standing, x.paid)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`
    : "";

  const historyRows = history
    .map((h) => {
      const current = h.p._id === payment._id;
      const applied = installmentLoan
        ? h.lines.map((x) => (x.paid ? `#${x.seq} ${CHECK}` : `#${x.seq} (${esc(t(`${fmt.money(x.remaining)} left`, `faltan ${fmt.money(x.remaining)}`))})`)).join(" · ")
        : (
            [
              [t("Fee", "Cargo"), h.p.fee],
              [t("Interest", "Interés"), h.p.interest],
              [t("Capital", "Capital"), h.p.principal],
            ] as [string, number][]
          )
            .filter(([, v]) => v > 0)
            .map(([l, v]) => `${esc(l)} ${m(v)}`)
            .join(" · ");
      const st =
        h.standing.kind === "paid_off"
          ? status("ok", t("Loan paid off", "Préstamo saldado"), true)
          : h.standing.kind === "settled"
            ? status("ok", installmentLoan ? t("Settled", "Saldado") : t("Interest paid to date", "Interés al día"), true)
            : status(
                "part",
                installmentLoan
                  ? t(`Partly paid · ${fmt.money(h.standing.left)} left`, `Pago parcial · faltan ${fmt.money(h.standing.left)}`)
                  : t(`Partly paid · ${fmt.money(h.standing.left)} interest left`, `Pago parcial · faltan ${fmt.money(h.standing.left)} de interés`),
                false,
              );
      const tag = current ? `<span class="tag">${esc(t("This receipt", "Este recibo"))}</span>` : "";
      return `<tr class="${current ? "this" : ""}"><td>${esc(fmt.day(h.p.paidOn))}${tag}</td><td class="num amt">${m(h.p.amount)}</td><td>${applied}</td><td class="num">${m(
        h.capitalLeft,
      )}</td><td>${st}</td></tr>`;
    })
    .join("");
  const n = history.length;
  const historyHtml = `<div class="block"><h2>${esc(t("Payment history", "Historial de pagos"))} <span class="muted">· ${esc(
    t(`${n} ${n === 1 ? "payment" : "payments"}, oldest first`, `${n} ${n === 1 ? "pago" : "pagos"}, del más antiguo al más reciente`),
  )}</span></h2>
<table class="grid"><thead><tr><th>${esc(t("Date", "Fecha"))}</th><th class="num">${esc(t("Amount", "Monto"))}</th><th>${esc(
    installmentLoan ? t("Installments", "Cuotas") : t("Applied to", "Aplicado a"),
  )}</th><th class="num">${esc(t("Capital left", "Capital restante"))}</th><th>${esc(t("Status", "Estado"))}</th></tr></thead><tbody>${historyRows}</tbody></table></div>`;

  const footerText = wording.paymentFooter();
  const extra = (company.address || company.phone ? 1 : 0) + Math.max(textRows(footerText) - 1, 0);
  const scheduleRows = schedule.length && scheduleHtml ? schedule.length + 2 : 0;
  const historyRowCount = show.history ? history.reduce((a, h) => a + Math.max(h.lines.length, 1), 0) : 0;
  const rows = scheduleRows + historyRowCount + extra;
  const overflow =
    rows > PAYMENT_PAGE_ROWS
      ? `<p class="note">${esc(
          t(
            "This loan has a long history, so the receipt continues on the next page. Every payment is listed.",
            "Este préstamo tiene un historial largo, así que el recibo continúa en la página siguiente. Aparecen todos los pagos.",
          ),
        )}</p>`
      : "";
  const title = t(`Receipt ${number}`, `Recibo ${number}`);
  const body = `${header(c, company, t("Payment receipt", "Recibo de pago"), number, t("Date paid", "Fecha de pago"), fmt.day(payment.paidOn))}
<div class="cols">${clientBlock(c, r.client)}${loanBlock(c, loan, show)}</div>
<div class="cols">
  <div class="block"><p class="label">${esc(t("This payment", "Este pago"))}</p><table class="kv">${paid.join("")}</table></div>
  ${show.balance ? `<div class="block"><p class="label">${esc(t("Balance after this payment", "Saldo después de este pago"))}</p><table class="kv">${bal.join("")}</table></div>` : ""}
</div>
${statusLine}
${overflow}
${scheduleHtml}
${show.history ? historyHtml : ""}
${notes}
<div class="end"><span>${esc(fill(footerText, { company: companyTag(c, company) }))}</span><span>${
    show.loanNumber ? `${esc(t("Loan", "Préstamo"))} #${loan.recordNo} · ` : ""
  }${esc(t("Receipt", "Recibo"))} ${number}</span></div>`;
  return page(c, title, "", "", body);
}

// ----- payment receipt, next payment only (2026-11-09) --------------------

export interface NextPayment {
  /** Null when everything left is already late. */
  on: Day | null;
  /** All to pay by that date to be up to date (the late part included). */
  amount: Cents;
  late: Cents;
  /** An interest-only loan's next interest payment. */
  interest: boolean;
}

/** What was paid now and what to pay next: always one short page, and the
 *  receipt on thermal rolls. The same figures as the full receipt. */
function nextPaymentReceipt(
  c: ReceiptContext,
  r: {
    loan: LoanRecord;
    client: ReceiptClient;
    payment: PaymentRecord;
    number: string;
    company: Company;
    footer: string;
    show: ReceiptShow;
    balanceAfter: Cents;
    next: NextPayment | null;
    installmentsPaid: [number, number] | null;
    principalAfter: Cents;
  },
  paper: Paper,
): string {
  const { t, fmt } = c;
  const m = (v: Cents) => esc(fmt.money(v));
  const { payment, loan, show, next } = r;
  const installmentLoan = hasInstallments(loan.method);
  const split: string[] = [];
  if (payment.paidWith) split.push(row(t("Paid with", "Forma de pago"), esc(paidWithLabel(t, payment.paidWith)), "sub"));
  if (payment.fee > 0 && show.lateFees) split.push(row(installmentLoan ? t("Late fees", "Cargos por mora") : t("Fee", "Cargo"), m(payment.fee), "sub"));
  if (show.split) {
    split.push(row(t("Interest", "Interés"), m(payment.interest), "sub"));
    split.push(row(t("Capital", "Abono a capital"), m(payment.principal), "sub"));
  }
  const loanRows = [show.loanNumber && row(t("Loan", "Préstamo"), `#${loan.recordNo}`), row(t("Loan date", "Fecha del préstamo"), esc(fmt.day(loan.startDate)))]
    .filter(Boolean)
    .join("");
  let nextHtml = "";
  if (r.balanceAfter <= 0) {
    nextHtml = `<p class="note done">${CHECK} ${esc(t("This loan is fully paid. Thank you!", "Este préstamo quedó saldado. ¡Gracias!"))}</p>`;
  } else if (next) {
    const label = next.interest ? t("Your next interest payment", "Su próximo pago de interés") : t("Your next payment", "Su próximo pago");
    const when = next.on ? t(`By ${fmt.day(next.on)}`, `A más tardar el ${fmt.day(next.on)}`) : t("Due now", "Vence ahora");
    const late =
      next.late <= 0
        ? ""
        : next.on
          ? `<p class="late">${esc(
              t(
                `Includes ${fmt.money(next.late)} that is already late. Please pay it as soon as you can.`,
                `Incluye ${fmt.money(next.late)} que ya está atrasado. Por favor páguelo lo antes posible.`,
              ),
            )}</p>`
          : `<p class="late">${esc(t("All of it is already late. Please pay it as soon as you can.", "Todo ya está atrasado. Por favor páguelo lo antes posible."))}</p>`;
    nextHtml = `<div class="next"><p class="label">${esc(label)}</p><div class="next-row"><span class="when">${esc(when)}</span><span class="amt">${m(next.amount)}</span></div>${late}</div>`;
  }
  const facts: [string, string][] =
    show.balance && r.balanceAfter > 0
      ? [
          [t("Still owed in total", "Total pendiente"), fmt.money(r.balanceAfter)],
          ...(r.installmentsPaid
            ? ([[t("Installments paid in full", "Cuotas pagadas por completo"), t(`${r.installmentsPaid[0]} of ${r.installmentsPaid[1]}`, `${r.installmentsPaid[0]} de ${r.installmentsPaid[1]}`)]] as [string, string][])
            : []),
          [t("Capital repaid", "Capital pagado"), ratioLabel(loan.principal - r.principalAfter, loan.principal) ?? "0.0%"],
        ]
      : [];
  const factsHtml = facts.length ? `<div class="facts">${facts.map(([l, v]) => `<span>${esc(l)} <b>${esc(v)}</b></span>`).join("")}</div>` : "";
  const notes = payment.notes?.trim() ? `<p class="muted">${esc(t("Note:", "Nota:"))} ${esc(payment.notes)}</p>` : "";
  const title = t(`Receipt ${r.number}`, `Recibo ${r.number}`);
  const body = `${header(c, r.company, t("Payment receipt", "Recibo de pago"), r.number, t("Date paid", "Fecha de pago"), fmt.day(payment.paidOn))}
<div class="cols">${clientBlock(c, r.client)}<div class="block"><p class="label">${esc(t("Loan", "Préstamo"))}</p><table class="kv">${loanRows}</table></div></div>
<div class="block"><p class="label">${esc(t("This payment", "Este pago"))}</p>
<div class="paid-big"><span>${esc(t("Amount paid", "Monto pagado"))}</span><span class="amt">${m(payment.amount)}</span></div>
${split.length ? `<table class="kv">${split.join("")}</table>` : ""}</div>
${nextHtml}
${factsHtml}
${notes}
<div class="end"><span>${esc(fill(r.footer, { company: companyTag(c, r.company) }))}</span><span>${show.loanNumber ? `${esc(t("Loan", "Préstamo"))} #${loan.recordNo} · ` : ""}${esc(t("Receipt", "Recibo"))} ${r.number}</span></div>`;
  return page(c, title, "short", NEXT_CSS, body, paper);
}

const NEXT_CSS = `
  .sheet.short { min-height: 0; }
  .paid-big { display:flex; justify-content:space-between; align-items:baseline; gap:12pt; padding:4pt 0 5pt; border-bottom:1pt solid var(--rule); margin-bottom:3pt; }
  .paid-big .amt { font-size:18pt; font-weight:700; white-space:nowrap; }
  .next { margin-top:12pt; border:1.2pt solid var(--ink); border-radius:6pt; padding:9pt 11pt; display:grid; gap:3pt; }
  .next .label { margin:0; }
  .next-row { display:flex; justify-content:space-between; align-items:baseline; gap:12pt; flex-wrap:wrap; }
  .next .when { font-size:11.5pt; font-weight:600; }
  .next .amt { font-size:15pt; font-weight:700; white-space:nowrap; }
  .late { margin:0; color:var(--neg); }
  .facts { display:flex; flex-wrap:wrap; gap:3pt 16pt; margin-top:9pt; font-size:8.5pt; color:var(--muted); }
  .facts b { color:var(--ink); font-weight:600; white-space:nowrap; }
`;

/** A thermal roll: one column at the head's printing width, black only
 *  (thermal heads print no colors or fills), as long as the receipt. On
 *  screen it shows as a strip of paper. */
function rollCssFor(paperMm: number, printMm: number): string {
  const small = printMm < 60;
  const side = (paperMm - printMm) / 2;
  return `
  :root { --ink:#000; --muted:#000; --rule:#000; --soft:#fff; --accent:#000; --pos:#000; --pos-bg:#fff; --warn:#000; --warn-bg:#fff; --neg:#000; --neg-bg:#fff; }
  body { font-size:${small ? 7.5 : 8.5}pt; line-height:1.3; }
  .sheet.roll { width:${paperMm}mm; min-height:0; padding:4mm ${side}mm 6mm; }
  .roll .top { flex-direction:column; align-items:center; text-align:center; gap:3pt; border-bottom-width:1pt; }
  .roll .brand { flex-direction:column; gap:4pt; }
  .roll .doc { text-align:center; }
  .roll h1 { font-size:${small ? 11 : 12.5}pt; }
  .roll .cols { grid-template-columns:1fr; }
  .roll .block { padding-top:6pt; }
  .roll table.kv.left td:first-child { width:auto; }
  .roll .paid-big .amt { font-size:${small ? 13 : 15}pt; }
  .roll .next { border-width:1pt; border-radius:3pt; padding:6pt; }
  .roll .next .amt { font-size:${small ? 12 : 13.5}pt; }
  .roll .next .when { font-size:inherit; }
  ${small ? ".roll .next-row { flex-direction:column; align-items:flex-start; gap:1pt; }" : ""}
  .roll .late { font-weight:700; }
  .roll .note { background:none; border:1pt solid #000; }
  .roll .facts { flex-direction:column; gap:1pt; }
  .roll .facts span { display:flex; justify-content:space-between; gap:8pt; }
  .roll .end { flex-direction:column; align-items:center; text-align:center; gap:2pt; }
  .roll .stamp { display:block; text-align:center; }
  .roll .signs { grid-template-columns:1fr; gap:26pt; margin-top:26pt; }
  @media print { .sheet.roll { width:${paperMm}mm; padding:2mm ${side}mm 8mm; } }
`;
}

// ----- receipt for a collected payment waiting for confirmation -----------

/** What a collector hands the client: the amount and date, marked as
 *  pending. No balances: the payment doesn't count until an admin confirms
 *  it; the confirmed receipt (same number) shows them. */
export function pendingReceiptHtml(
  c: ReceiptContext,
  r: {
    loan: LoanRecord;
    client: ReceiptClient;
    pending: { recordNo: number; paidOn: Day; amount: Cents; notes: string; collectorName: string };
  },
): string {
  const { t, fmt } = c;
  const p = r.pending;
  const number = String(p.recordNo).padStart(6, "0");
  const company = companyLines(c);
  const show = receiptShow(c.settings);
  const lender = companyTag(c, company);
  const paid = [
    row(t("Amount received", "Monto recibido"), esc(fmt.money(p.amount)), "total"),
    row(t("Received by", "Recibido por"), esc(t(`${p.collectorName}, collector`, `${p.collectorName}, cobrador`))),
  ].join("");
  const notes = p.notes.trim() ? `<p class="muted">${esc(t("Note:", "Nota:"))} ${esc(p.notes)}</p>` : "";
  const title = t(`Receipt ${number} (pending)`, `Recibo ${number} (pendiente)`);
  const body = `${header(c, company, t("Payment receipt", "Recibo de pago"), number, t("Date paid", "Fecha de pago"), fmt.day(p.paidOn))}
<p class="stamp">${esc(t("Pending confirmation", "Pendiente de confirmación"))}</p>
<div class="cols">${clientBlock(c, r.client)}${loanBlock(c, r.loan, show)}</div>
<div class="cols"><div class="block"><p class="label">${esc(t("This payment", "Este pago"))}</p><table class="kv">${paid}</table></div></div>
<p class="note">${esc(
    t(
      `${lender} applies this payment to the loan once it is confirmed, counted from the date above. The new balance is on the confirmed receipt, with the same number.`,
      `${lender} aplica este pago al préstamo cuando lo confirme, contado desde la fecha de arriba. El nuevo saldo aparece en el recibo confirmado, con el mismo número.`,
    ),
  )}</p>
${notes}
<div class="signs"><span>${esc(t("Client", "Cliente"))}</span><span>${esc(t("Collector", "Cobrador"))}</span></div>
<div class="end"><span>${esc(lender)}</span><span>${show.loanNumber ? `${esc(t("Loan", "Préstamo"))} #${r.loan.recordNo} · ` : ""}${esc(t("Receipt", "Recibo"))} ${number}</span></div>`;
  const css = `
  .stamp { display:inline-block; margin:8pt 0 0; padding:3pt 8pt; border:1pt solid var(--warn); color:var(--warn); background:var(--warn-bg); border-radius:3pt; font-weight:700; font-size:8.5pt; letter-spacing:0.06em; text-transform:uppercase; }
  .signs { display:grid; grid-template-columns:1fr 1fr; gap:36pt; margin-top:40pt; color:var(--muted); font-size:8.5pt; text-align:center; }
  .signs span { border-top:0.5pt solid var(--muted); padding-top:4pt; }
`;
  return page(c, title, "", css, body, c.paper ?? "letter");
}

// ----- loan receipt --------------------------------------------------------

export function loanReceiptHtml(c: ReceiptContext, r: { loan: LoanRecord; client: ReceiptClient }): string {
  const { t, fmt } = c;
  const loan = r.loan;
  const m = (v: Cents) => esc(fmt.money(v));
  const number = String(loan.recordNo).padStart(6, "0");
  const installmentLoan = hasInstallments(loan.method);
  const company = companyLines(c);
  const wording = new Wording(c.settings.receiptText, t);
  const pr = { rate: loan.rate, per: loan.interestPeriod, every: loan.frequency };
  const interestPerPeriod = periodInterest(pr, loan.principal);
  const half = Math.trunc(loan.principal / 2);
  const interestAfterHalf = periodInterest(pr, loan.principal - half);
  const conversion = conversionNote(t, fmt, loan);

  // The same switches as payment receipts (Settings › Receipts).
  const show = receiptShow(c.settings);
  const scheduleShown = installmentLoan && show.installments;
  const terms: string[] = [];
  if (show.amountLent) terms.push(row(t("Amount lent", "Monto prestado"), m(loan.principal), "total"));
  if (show.cycle) terms.push(row(t("Loan type", "Tipo de préstamo"), esc(methodShort(t, loan.method))));
  if (show.rate) terms.push(row(t("Interest rate", "Tasa de interés"), esc(rateLine(t, fmt, loan))));
  if (show.cycle) terms.push(row(t("Payments", "Pagos"), esc(frequencyLabel(t, loan.frequency))));
  let scheduleHtml = "";
  if (installmentLoan) {
    const totalInterest = loan.schedule.reduce((a, x) => a + x.interest, 0);
    if (show.installments) terms.push(row(t("Installments", "Cuotas"), String(loan.schedule.length)));
    if (show.rate) terms.push(row(t("Total interest", "Interés total"), m(totalInterest)));
    if (loan.lateFeeRate > 0 && show.lateFees) terms.push(row(t("Late fee", "Cargo por mora"), esc(fmt.rate(loan.lateFeeRate))));
    if (show.amountLent && show.rate) terms.push(row(t("Total to repay", "Total a pagar"), m(loan.principal + totalInterest), "total"));
    let left = loan.principal;
    const rows = loan.schedule
      .map((x) => {
        left -= x.principal;
        return `<tr><td>${x.seq}</td><td>${esc(fmt.day(x.due))}</td><td class="num">${m(x.principal)}</td><td class="num">${m(x.interest)}</td><td class="num"><b>${m(
          x.principal + x.interest,
        )}</b></td><td class="num">${m(left)}</td></tr>`;
      })
      .join("");
    scheduleHtml = `<div class="block"><h2>${esc(t("Payment schedule", "Calendario de pagos"))}</h2><table class="grid"><thead><tr><th>#</th><th>${esc(
      t("Due date", "Vence"),
    )}</th><th class="num">${esc(t("Capital", "Capital"))}</th><th class="num">${esc(t("Interest", "Interés"))}</th><th class="num">${esc(
      t("Payment", "Cuota"),
    )}</th><th class="num">${esc(t("Capital left", "Restante"))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    if (!show.installments) scheduleHtml = "";
  } else if (show.rate) {
    terms.push(row(t("Interest per payment", "Interés por pago"), m(interestPerPeriod)));
  }

  const tags: Partial<Tags> = {
    amount: fmt.money(loan.principal),
    interest: fmt.money(interestPerPeriod),
    late_fee: fmt.rate(loan.lateFeeRate),
    conversion: conversion ?? "",
    example_payment: fmt.money(interestPerPeriod + half),
    example_capital: fmt.money(half),
    next_interest: fmt.money(interestAfterHalf),
    company: companyTag(c, company),
  };
  const lateFee = installmentLoan && loan.lateFeeRate > 0 && show.lateFees;
  const edited = installmentLoan && loan.scheduleEdited;
  // Those lines quote the amount and the interest, so they go when either is hidden.
  const rules = show.amountLent && show.rate ? linesFor(wording.rules(loan.method as RuleSet as Method & RuleSet), tags, conversion !== null, lateFee, edited) : [];
  const heading = fill(wording.heading(), tags);
  const rulesHtml = rules.length
    ? `<div class="rules">${heading.trim() ? `<h2>${esc(heading)}</h2>` : ""}<ul>${rules.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`
    : "";
  const notes = loan.notes?.trim() ? `<p class="muted">${esc(t("Notes:", "Notas:"))} ${esc(loan.notes)}</p>` : "";
  const caption = fill(wording.clientSign(), tags);
  const clientName = c.settings.receiptClient.name && r.client.fullName.trim() ? r.client.fullName.trim() : null;
  const [amount, date] = [fmt.money(loan.principal), fmt.day(loan.startDate)];
  const received = show.amountLent
    ? clientName
      ? t(`${clientName} received ${amount} on ${date}.`, `${clientName} recibió ${amount} el ${date}.`)
      : t(`The client received ${amount} on ${date}.`, `El cliente recibió ${amount} el ${date}.`)
    : clientName
      ? t(`${clientName} received this loan on ${date}.`, `${clientName} recibió este préstamo el ${date}.`)
      : t(`The client received this loan on ${date}.`, `El cliente recibió este préstamo el ${date}.`);
  const clientSign = clientName ? (caption.trim() ? `${caption}: ${clientName}` : clientName) : caption;
  const closing = fill(wording.loanFooter(), tags);
  const closingHtml = closing.trim() ? `<p class="closing">${esc(closing)}</p>` : "";

  const rulesPt = rules.length ? 14 + rules.reduce((a, l) => a + Math.max(Math.ceil([...l].length / 140), 1) * 10.1 + 2, 0) : 0;
  const paragraphPt = (s: string) => (textRows(s) ? 10 + textRows(s) * LINE_PT : 0);
  let used = rulesPt + paragraphPt(loan.notes ?? "") + paragraphPt(closing);
  if (company.address || company.phone) used += LINE_PT;
  if (scheduleShown) used += SCHEDULE_HEAD_PT + SCHEDULE_ROW_PT * loan.schedule.length;
  const overflow =
    scheduleShown && loan.schedule.length > LOAN_PAGE_ROWS
      ? `<p class="note">${esc(t("The schedule continues on the next page; the signatures are at the end.", "El calendario continúa en la página siguiente; las firmas están al final."))}</p>`
      : used > LOAN_TEXT_PT
        ? `<p class="note">${esc(t("This receipt continues on the next page; the signatures are at the end.", "Este recibo continúa en la página siguiente; las firmas están al final."))}</p>`
        : "";

  const css = `
  .sheet.loan { display:flex; flex-direction:column; }
  .loan .body { flex:1 0 auto; }
  .received { margin:10pt 0 0; padding:6pt 9pt; background:#f3f5ff; border-radius:4pt; font-size:10pt; }
  .rules { margin-top:10pt; font-size:7.5pt; line-height:1.35; color:var(--muted); }
  .rules h2 { font-size:8pt; color:var(--ink); margin-bottom:2pt; }
  .rules ul { margin:0; padding-left:12pt; }
  .rules li { margin:1pt 0; }
  .foot { break-inside:avoid; padding-top:36pt; }
  .sign { display:flex; gap:28pt; }
  .sign div { flex:1; border-top:1pt solid var(--ink); padding-top:4pt; text-align:center; font-size:8.5pt; color:var(--muted); overflow-wrap:anywhere; }
  .closing { margin:10pt 0 0; text-align:center; font-size:8.5pt; color:var(--muted); }
  @media print { .sheet.loan { min-height:9.9in; } }
`;
  const title = t(`Loan receipt ${number}`, `Recibo de préstamo ${number}`);
  const body = `<div class="body">
${header(c, company, t("Loan receipt", "Recibo de préstamo"), number, t("Loan date", "Fecha del préstamo"), fmt.day(loan.startDate))}
<div class="cols">${clientBlock(c, r.client)}<div class="block"><p class="label">${esc(show.loanNumber ? t(`Loan #${loan.recordNo}`, `Préstamo #${loan.recordNo}`) : t("Loan", "Préstamo"))}</p><table class="kv">${terms.join(
    "",
  )}</table></div></div>
<p class="received">${esc(received)}</p>
${overflow}
${scheduleHtml}
${rulesHtml}
${notes}
</div>
<div class="foot"><div class="sign"><div>${esc(clientSign)}</div><div>${esc(fill(wording.lenderSign(), tags))}</div></div>${closingHtml}</div>`;
  return page(c, title, "loan", css, body);
}
