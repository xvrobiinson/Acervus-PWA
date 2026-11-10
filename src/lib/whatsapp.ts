// WhatsApp, the regular app (2026-11-09, the owner's choice): the app opens
// WhatsApp with the client's number and the message written (wa.me), and the
// person sending presses Send, from their own number. Nothing goes through a
// server. Reminders (the day before an installment is due, on the day, and
// once it is late) and a payment's receipt as text. The same as the Windows
// app's (src/services/whatsapp.rs).

import { addDays, type Day } from "../../shared/domain/dates";
import type { Cents } from "../../shared/domain/money";
import type { NextPayment, ReceiptFormat } from "../receipts/receipt";
import type { LoanView } from "../state/books";
import type { Fmt } from "./format";
import type { T } from "./i18n";
import { fillWa, waTemplate } from "./wa-messages";

export type Due = { kind: "tomorrow" } | { kind: "today" } | { kind: "late"; days: number };

export interface Reminder {
  loanId: string;
  loanNo: number;
  client: string;
  /** Ready for a wa.me link; null when the client has no usable number. */
  phone: string | null;
  due: Due;
  /** The installment due, or everything behind when late. */
  amount: Cents;
  /** The due date, or since when it is late. */
  on: Day;
}

/** What a reminder is for this day, so a sent one stays sent until tomorrow
 *  (and a later stage is a new one). */
export const reminderKey = (r: Reminder, today: Day) => `${today}:${r.loanId}:${r.due.kind}`;

/** A number without a country code gets the business's, from its currency:
 *  pesos and dollars +1, the Caribbean guilder +599. */
function callingCode(currency: string): string | null {
  if (currency === "DOP" || currency === "USD") return "1";
  if (currency === "XCG" || currency === "ANG") return "599";
  return null;
}

/** A phone number as wa.me wants it: digits only, with its country code. */
export function phoneForLink(raw: string, currency: string): string | null {
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7) return null;
  if (international) return digits;
  const code = callingCode(currency);
  if (code === "1") {
    // A 10-digit North American number gets the 1 it lacks; 7 digits in
    // dollars are Bonaire's, Saba's or Statia's (+599); a Dominican number
    // without its area code can't be completed.
    if (digits.length === 10) return `1${digits}`;
    if (digits.length === 7 && currency === "USD") return `599${digits}`;
    return digits.length >= 11 ? digits : null;
  }
  if (code && digits.length <= 8) return `${code}${digits}`;
  return digits;
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** The reminders to send today, most urgent first. */
export function reminders(loans: LoanView[], today: Day, currency: string): Reminder[] {
  const tomorrow = addDays(today, 1);
  const out: Reminder[] = [];
  for (const l of loans) {
    if (!["active", "due_soon", "overdue"].includes(l.display)) continue;
    const d = l.delinquency;
    let due: Due;
    let amount: Cents;
    let on: Day;
    if (d.overdueAmount > 0) {
      due = { kind: "late", days: d.daysOverdue };
      amount = d.overdueAmount;
      on = d.overdueSince ?? today;
    } else if (d.nextDue === today && d.nextDueAmount > 0) {
      due = { kind: "today" };
      amount = d.nextDueAmount;
      on = today;
    } else if (d.nextDue === tomorrow && d.nextDueAmount > 0) {
      due = { kind: "tomorrow" };
      amount = d.nextDueAmount;
      on = tomorrow;
    } else continue;
    if (!l.client) continue;
    out.push({
      loanId: l.loan._id,
      loanNo: l.loan.recordNo,
      client: l.client.fullName,
      phone: l.client.phone ? phoneForLink(l.client.phone, currency) : null,
      due,
      amount,
      on,
    });
  }
  const urgency = (r: Reminder) => (r.due.kind === "late" ? -r.due.days : r.due.kind === "today" ? 1 : 2);
  return out.sort((a, b) => urgency(a) - urgency(b) || a.loanNo - b.loanNo);
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

/** The reminder's words, signed with the business's name. */
/** A reminder in the business's own wording (Settings › WhatsApp messages),
 *  else the built-in one. */
export function reminderText(r: Reminder, t: T, fmt: Fmt, business: string, wording?: Record<string, string>): string {
  const tags = { client: firstName(r.client), amount: fmt.money(r.amount), date: fmt.day(r.on), loan: String(r.loanNo), business };
  return fillWa(waTemplate(wording, r.due.kind, t), tags);
}

export interface ReceiptFacts {
  number: number;
  business: string;
  paidOn: Day;
  amount: Cents;
  paidWith: string | null;
  principal: Cents;
  interest: Cents;
  fee: Cents;
  loanNo: number;
  balance: Cents | null;
  show: { split: boolean; lateFees: boolean; loanNumber: boolean; balance: boolean };
  /** The business's receipt format; "next" adds the next payment. */
  format?: ReceiptFormat;
  /** The client's name and the business's own opening and closing lines. */
  client?: string;
  wording?: Record<string, string>;
  next?: NextPayment | null;
}

/** A payment's receipt as text, as the business's receipt switches allow. */
export function receiptText(r: ReceiptFacts, t: T, fmt: Fmt): string {
  const m = fmt.money;
  const tags = { client: firstName(r.client ?? ""), amount: m(r.amount), date: fmt.day(r.paidOn), loan: String(r.loanNo), business: r.business };
  const top = fillWa(waTemplate(r.wording, "receiptTop", t), tags).trim();
  const lines = top ? [top, ""] : [];
  lines.push(t(`Receipt #${r.number} — ${r.business}`, `Recibo #${r.number} — ${r.business}`), t(`Date: ${fmt.day(r.paidOn)}`, `Fecha: ${fmt.day(r.paidOn)}`));
  lines.push(r.paidWith ? t(`Paid: ${m(r.amount)} (${r.paidWith})`, `Pagado: ${m(r.amount)} (${r.paidWith})`) : t(`Paid: ${m(r.amount)}`, `Pagado: ${m(r.amount)}`));
  if (r.show.split) {
    let split = t(`Capital ${m(r.principal)} · Interest ${m(r.interest)}`, `Capital ${m(r.principal)} · Interés ${m(r.interest)}`);
    if (r.fee > 0 && r.show.lateFees) split += t(` · Late fee ${m(r.fee)}`, ` · Mora ${m(r.fee)}`);
    lines.push(split);
  }
  if (r.show.loanNumber) lines.push(t(`Loan #${r.loanNo}`, `Préstamo #${r.loanNo}`));
  if (r.format === "next" && r.next) {
    const n = r.next;
    const what = n.interest ? t("Next interest payment", "Próximo pago de interés") : t("Next payment", "Próximo pago");
    lines.push(n.on ? t(`${what}: ${m(n.amount)} by ${fmt.day(n.on)}`, `${what}: ${m(n.amount)} a más tardar el ${fmt.day(n.on)}`) : t(`Due now: ${m(n.amount)}`, `Vence ahora: ${m(n.amount)}`));
    if (n.late > 0 && n.on) lines.push(t(`(includes ${m(n.late)} already late)`, `(incluye ${m(n.late)} ya atrasado)`));
  }
  if (r.show.balance && r.balance !== null) lines.push(t(`Still owed: ${m(r.balance)}`, `Saldo pendiente: ${m(r.balance)}`));
  const end = fillWa(waTemplate(r.wording, "receiptEnd", t), tags).trim();
  if (end) lines.push(end);
  return lines.join("\n");
}

/** Which reminders this device sent today (only today's are kept). */
const SENT_KEY = "acervus.waSent";
export function sentToday(today: Day): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(SENT_KEY) ?? "[]") as string[];
    return new Set(all.filter((k) => k.startsWith(`${today}:`)));
  } catch {
    return new Set();
  }
}
export function markSent(key: string, today: Day): Set<string> {
  const now = sentToday(today);
  now.add(key);
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify([...now]));
  } catch {
    /* storage blocked: it stays marked until the page closes */
  }
  return now;
}
