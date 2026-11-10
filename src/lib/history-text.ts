// The change history in plain words. The server keeps each change as field
// names and stored values ("defaultRate: 100000 → 150000"); this turns one
// into what a person reads: which record it was, then each change by its
// name in the app, with values written the way the app shows them
// ("Default interest rate: 10% → 15%"). Settings kept as a group of
// switches only name the switches that moved.

import type { Fmt } from "./format";
import type { T } from "./i18n";
import {
  COLLECTOR_VIEW_PARTS,
  CURRENCIES,
  RECEIPT_PART_GROUPS,
  accountLabel,
  contractStatusLabel,
  entryKindLabel,
  frequencyLabel,
  frequencyPer,
  feeModeLabel,
  methodLabel,
  paidWithLabel,
  roleLabel,
} from "./labels";
import { numberStyleLabel, type NumberStyle } from "../../shared/domain/money";
import { formatDay, type DateStyle } from "../../shared/domain/dates";

export interface StoredChange {
  entity: "client" | "loan" | "payment" | "capital" | "entry" | "late_fee" | "settings" | "member";
  entityId: string;
  loanId?: string;
  action: "create" | "update" | "delete";
  changes: { field: string; old: string; new: string }[];
  reason: string;
}

/** Names the history can look up in the books on this device. */
export interface HistoryNames {
  client: (id: string) => string | undefined;
  /** A team member's name, from the member record's id. */
  member: (id: string) => string | undefined;
  loan: (id: string) => { recordNo: number; clientId: string } | undefined;
}

/** One line under a change. `from`/`to` for an edit, `value` otherwise. */
export interface HistoryLine {
  label: string;
  value?: string;
  from?: string;
  to?: string;
}

export interface HistoryText {
  /** What the change was about: "Loan #2 · José Martínez", "Settings". */
  subject: string;
  lines: HistoryLine[];
  /** The reason typed in, or the app's own note in the reader's language. */
  reason: string;
}

const MONEY = new Set(["amount", "principal", "interest", "fee", "fee_base", "received", "capital"]);
const DAYS = new Set(["occurred_on", "paid_on", "start_date", "status_date"]);
const RATES = new Set(["rate", "late_fee_rate", "defaultRate", "lateFeeRate"]);
/** Kept for the server's own bookkeeping, nothing a person changed. */
const HIDDEN = new Set(["businessId"]);

/** "receiptAfterLoan" / "late_fee_rate" → "Receipt after loan" / "Late fee rate". */
function words(field: string): string {
  const w = field
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function parse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

function asSwitches(v: string): Record<string, boolean> | null {
  const o = parse(v);
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  return Object.values(o).every((x) => typeof x === "boolean") ? (o as Record<string, boolean>) : null;
}

export function describeChange(c: StoredChange, t: T, fmt: Fmt, names: HistoryNames): HistoryText {
  const yes = t("Yes", "Sí");
  const no = t("No", "No");
  const shown = t("Shown", "Se muestra");
  const hidden = t("Hidden", "Oculto");
  const fieldOf = (f: string) => c.changes.find((x) => x.field === f);
  const valueOf = (f: string) => {
    const ch = fieldOf(f);
    return ch ? ch.new || ch.old : "";
  };

  const loanName = (id: string | undefined) => loanTitle(id, t, names);

  const label = (f: string): string => {
    const byEntity: Record<string, string> = {
      // Words that depend on what changed.
      amount: c.entity === "late_fee" ? t("Late fee", "Mora") : t("Amount", "Monto"),
      principal: c.entity === "loan" ? t("Amount lent", "Monto prestado") : t("Capital", "Capital"),
      kind: t("Type", "Tipo"),
      notes: c.entity === "entry" || c.entity === "capital" ? t("Description", "Descripción") : t("Notes", "Notas"),
    };
    const all: Record<string, string> = {
      account: t("Account", "Cuenta"),
      address: t("Address", "Dirección"),
      allocation: t("Applied to", "Aplicado a"),
      backup_restored: t("Backup restored, made on", "Copia restaurada, hecha el"),
      business_name: t("Business name", "Nombre del negocio"),
      client: t("Client", "Cliente"),
      collector: t("Collector", "Cobrador"),
      description: t("Description", "Descripción"),
      email: t("Email", "Correo"),
      fee: t("Late fee", "Mora"),
      fee_base: t("Overdue amount it was charged on", "Monto vencido sobre el que se cobró"),
      frequency: t("Payment cycle", "Frecuencia de pago"),
      fullName: t("Name", "Nombre"),
      idNumber: t("ID number", "Identificación"),
      installments: t("Installments", "Cuotas"),
      interest: t("Interest", "Interés"),
      interest_period: t("Interest charged", "Interés cobrado"),
      invited: t("Invited", "Invitado"),
      late_fee_rate: t("Late fee rate", "Tasa de mora"),
      late_fee_mode: t("How late fees are charged", "Cómo se cobra la mora"),
      lateFeeMode: t("How late fees are charged", "Cómo se cobra la mora"),
      reinvest: t("Interest reinvested", "Interés reinvertido"),
      defaultReinvest: t("Interest reinvested on new loans", "Interés reinvertido en préstamos nuevos"),
      method: t("Loan type", "Tipo de préstamo"),
      occurred_on: t("Date", "Fecha"),
      paid_on: t("Paid on", "Pagado el"),
      paid_with: t("Paid with", "Forma de pago"),
      payments: t("Payments", "Pagos"),
      phone: t("Phone", "Teléfono"),
      rate: t("Interest rate", "Tasa de interés"),
      received: t("Received", "Recibido"),
      role: t("Role", "Rol"),
      schedule: t("Payment plan", "Plan de pagos"),
      schedule_edited: t("Plan changed by hand", "Plan cambiado a mano"),
      start_date: t("Start date", "Fecha de inicio"),
      status: t("Status", "Estado"),
      status_date: t("Since", "Desde"),
      timezone: t("Time zone", "Zona horaria"),
      waived: t("Waived", "Perdonada"),
      // Settings.
      receiptName: t("Name on receipts", "Nombre en los recibos"),
      companyAddress: t("Business address", "Dirección del negocio"),
      companyPhone: t("Business phone", "Teléfono del negocio"),
      currencyCode: t("Currency", "Moneda"),
      numberStyle: t("Number format", "Formato de números"),
      dateStyle: t("Date format", "Formato de fechas"),
      language: t("Business language", "Idioma del negocio"),
      defaultRate: t("Default interest rate", "Tasa de interés predeterminada"),
      defaultFrequency: t("Default payment cycle", "Frecuencia de pago predeterminada"),
      lateFeeRate: t("Default late fee rate", "Tasa de mora predeterminada"),
      receiptAfterPayment: t("Show the receipt after recording a payment", "Mostrar el recibo al registrar un pago"),
      receiptAfterLoan: t("Show the receipt after creating a loan", "Mostrar el recibo al crear un préstamo"),
      receiptFormat: t("Payment receipt", "Recibo de pago"),
    };
    return byEntity[f] ?? all[f] ?? words(f);
  };

  const value = (f: string, v: string): string => {
    if (v === "") return "—";
    const n = Number(v);
    const isInt = /^-?\d+$/.test(v);
    if (MONEY.has(f) && isInt) return fmt.money(n);
    if (RATES.has(f) && isInt) return fmt.rate(n);
    if (DAYS.has(f) && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmt.day(v);
    if (v === "true" || v === "false") return v === "true" ? yes : no;
    switch (f) {
      case "client":
        return names.client(v) ?? t("A client no longer in the books", "Un cliente que ya no está");
      case "frequency":
      case "interest_period":
      case "defaultFrequency":
        return frequencyLabel(t, v as never) ?? v;
      case "method":
        return methodLabel(t, v as never) ?? v;
      case "late_fee_mode":
      case "lateFeeMode":
        return feeModeLabel(t, v as never);
      case "reinvest":
      case "defaultReinvest":
        return isInt ? `${n}%` : v;
      case "paid_with":
        return paidWithLabel(t, v as never) ?? v;
      case "status":
        return contractStatusLabel(t, v as never) ?? v;
      case "role":
        return roleLabel(t, v as never) ?? v;
      case "account":
        return accountLabel(t, v as never) ?? v;
      case "kind":
        return entryKindLabel(t, v as never) ?? v;
      case "currencyCode": {
        const cur = CURRENCIES.find((x) => x.code === v);
        return cur ? `${fmt.lang === "es" ? cur.es : cur.en} (${cur.symbol})` : v;
      }
      case "numberStyle":
        return numberStyleLabel(v as NumberStyle);
      case "dateStyle":
        return formatDay("2026-12-31", v as DateStyle, fmt.lang);
      case "receiptFormat":
        return v === "next" ? t("Next payment", "Próximo pago") : t("Full schedule", "Calendario completo");
      case "language":
        return v === "es" ? "Español" : v === "en" ? "English" : v;
      case "schedule": {
        // "<installments>|<total of principal and interest>"
        const [count, total] = v.split("|").map(Number);
        if (!Number.isFinite(count) || !Number.isFinite(total)) return v;
        return `${count} ${t("installments", "cuotas")} · ${t("total", "total")} ${fmt.money(total)}`;
      }
      case "allocation": {
        if (v === "auto") return t("Oldest installment first", "La cuota más antigua primero");
        const m = v.match(/^installment (\d+)$/);
        if (m) return `${t("Installment", "Cuota")} ${m[1]}`;
        if (v.startsWith("spread ")) {
          const parts = v.slice(7).split(",").filter(Boolean).map((p) => {
            const [seq, amt] = p.split(":");
            return `${t("Installment", "Cuota")} ${seq}: ${fmt.money(Number(amt))}`;
          });
          return parts.join(" · ");
        }
        const cu = v.match(/^custom (-?\d+)\/(-?\d+)\/(-?\d+)$/);
        if (cu) {
          return `${t("Capital", "Capital")} ${fmt.money(Number(cu[1]))} · ${t("Interest", "Interés")} ${fmt.money(Number(cu[2]))} · ${t("Late fee", "Mora")} ${fmt.money(Number(cu[3]))}`;
        }
        return v;
      }
    }
    if (f === "installments" || f === "payments") return isInt ? String(n) : v;
    return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  };

  /** A group of switches: one line per switch that moved. */
  const switches = (f: string, old: string, next: string): HistoryLine[] | null => {
    const a = asSwitches(old) ?? {};
    const b = asSwitches(next);
    if (!b) return null;
    const parts: { key: string; name: string }[] = [];
    let group = "";
    if (f === "receiptShow") {
      group = t("Receipts", "Recibos");
      for (const [, keys] of RECEIPT_PART_GROUPS) for (const [k, en, es] of keys) parts.push({ key: k, name: t(en, es) });
    } else if (f === "receiptCompany") {
      group = t("Receipts", "Recibos");
      parts.push(
        { key: "name", name: t("Business name", "Nombre del negocio") },
        { key: "address", name: t("Business address", "Dirección del negocio") },
        { key: "phone", name: t("Business phone", "Teléfono del negocio") },
      );
    } else if (f === "receiptClient") {
      group = t("Receipts", "Recibos");
      parts.push(
        { key: "name", name: t("Client's name", "Nombre del cliente") },
        { key: "idNumber", name: t("Client's ID number", "Identificación del cliente") },
        { key: "phone", name: t("Client's phone", "Teléfono del cliente") },
        { key: "address", name: t("Client's address", "Dirección del cliente") },
      );
    } else if (f === "collector_view") {
      group = t("What they see", "Lo que ve");
      for (const [k, en, es] of COLLECTOR_VIEW_PARTS) parts.push({ key: k, name: t(en, es) });
    }
    const known = new Set(parts.map((p) => p.key));
    for (const k of Object.keys(b)) if (!known.has(k)) parts.push({ key: k, name: words(k) });
    const out: HistoryLine[] = [];
    for (const p of parts) {
      // A switch never saved before was on.
      const was = a[p.key] ?? true;
      const now = b[p.key] ?? true;
      if (was !== now) out.push({ label: group ? `${group} · ${p.name}` : p.name, from: was ? shown : hidden, to: now ? shown : hidden });
    }
    return out;
  };

  const lines: HistoryLine[] = [];
  for (const ch of c.changes) {
    if (HIDDEN.has(ch.field)) continue;
    if (ch.field === "receiptText") {
      lines.push(...wording(ch.old, ch.new, t));
      continue;
    }
    if (c.action !== "update") {
      // The subject already says it: "Expense", "Capital added", the loan's client.
      if (ch.field === "kind" && (c.entity === "entry" || c.entity === "capital")) continue;
      if (ch.field === "client" && c.entity === "loan" && names.loan(c.entityId)) continue;
      // A part of a payment that was zero: nothing to say.
      if (c.entity === "payment" && (ch.new || ch.old) === "0") continue;
      // "10% a month" on one line.
      if (ch.field === "interest_period" && fieldOf("rate")) continue;
      if (ch.field === "rate" && fieldOf("interest_period")) {
        const v = c.action === "delete" ? ch.old : ch.new;
        const per = valueOf("interest_period");
        lines.push({ label: label("rate"), value: `${value("rate", v)} ${frequencyPer(t, per as never) ?? ""}`.trim() });
        continue;
      }
    }
    if (ch.field === "archived") {
      lines.push({ label: t("Status", "Estado"), value: ch.new === "true" ? t("Archived", "Archivado") : t("Back in the active list", "De vuelta en la lista activa") });
      continue;
    }
    if (ch.field === "photo" || ch.field === "logo") {
      const what = ch.field === "photo" ? t("Photo", "Foto") : t("Logo", "Logo");
      const done = ch.new === "" ? t("Removed", "Se quitó") : ch.old === "" ? t("Added", "Se agregó") : t("Replaced", "Se reemplazó");
      lines.push({ label: what, value: done });
      continue;
    }
    const group = switches(ch.field, ch.old, ch.new);
    if (group) {
      lines.push(...group);
      continue;
    }
    const name = label(ch.field);
    if (c.action === "update") lines.push({ label: name, from: value(ch.field, ch.old), to: value(ch.field, ch.new) });
    else if ((c.action === "delete" ? ch.old : ch.new) !== "") lines.push({ label: name, value: value(ch.field, c.action === "delete" ? ch.old : ch.new) });
  }

  let subject: string;
  switch (c.entity) {
    case "client":
{
      const who = names.client(c.entityId) ?? valueOf("fullName");
      subject = who ? `${t("Client", "Cliente")} · ${who}` : t("Client", "Cliente");
    }
      break;
    case "loan":
      subject = loanName(c.loanId ?? c.entityId);
      break;
    case "payment":
      subject = `${t("Payment", "Pago")} · ${loanName(c.loanId)}`;
      break;
    case "late_fee":
      subject = `${t("Late fee", "Mora")} · ${t("Installment", "Cuota")} ${c.entityId} · ${loanName(c.loanId)}`;
      break;
    case "capital":
    case "entry": {
      const kind = valueOf("kind");
      subject = kind ? entryKindLabel(t, kind as never) ?? t("Money", "Dinero") : t("Money", "Dinero");
      break;
    }
    case "member": {
      const who = names.member(c.entityId) || valueOf("email") || valueOf("invited");
      subject = `${t("Team", "Equipo")}${who ? ` · ${who}` : ""}`;
      break;
    }
    default:
      subject = t("Settings", "Ajustes");
  }

  return { subject, lines, reason: reasonText(c.reason, t) };
}

function loanTitle(id: string | undefined, t: T, names: HistoryNames): string {
  const l = id ? names.loan(id) : undefined;
  if (!l) return t("Loan", "Préstamo");
  const who = names.client(l.clientId);
  return `${t("Loan", "Préstamo")} #${l.recordNo}${who ? ` · ${who}` : ""}`;
}

/** A late fee the app worked out again by itself (not one a person waived). */
const automaticFee = (c: StoredChange) =>
  c.entity === "late_fee" && c.changes.every((x) => x.field === "amount" || x.field === "fee_base");

/** The history with the app's own late fee updates folded: a run of them on
 *  one loan by one change becomes one group, instead of a row per installment. */
export function foldLateFees<C extends StoredChange & { userId: string }>(list: C[]): (C | C[])[] {
  const out: (C | C[])[] = [];
  for (const c of list) {
    const last = out[out.length - 1];
    const prev = Array.isArray(last) ? last[0] : last;
    if (automaticFee(c) && prev && automaticFee(prev) && prev.loanId === c.loanId && prev.userId === c.userId) {
      if (Array.isArray(last)) last.push(c);
      else out[out.length - 1] = [last, c];
    } else out.push(c);
  }
  return out;
}

/** "1–3, 5": installment numbers, runs shortened. */
function runs(nums: number[]): string {
  const n = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    parts.push(j > i ? `${n[i]}–${n[j]}` : String(n[i]));
    i = j;
  }
  return parts.join(", ");
}

/** A folded run of late fee updates: what was charged, worked out again or
 *  dropped, by installment, with the totals. */
export function describeFeeGroup(list: StoredChange[], t: T, fmt: Fmt, names: HistoryNames): HistoryText {
  const amount = (c: StoredChange, side: "old" | "new") => Number(c.changes.find((x) => x.field === "amount")?.[side] || 0);
  const which = (n: number[]) => (n.length === 1 ? `${t("Installment", "Cuota")} ${n[0]}` : `${t("Installments", "Cuotas")} ${runs(n)}`);
  // Per installment (newest first in `list`): from what it was before the
  // oldest change to what the newest one left.
  const added: number[] = [];
  const changed: number[] = [];
  const dropped: number[] = [];
  let [addedNew, changedOld, changedNew, droppedOld] = [0, 0, 0, 0];
  for (const seq of [...new Set(list.map((c) => Number(c.entityId)))].sort((a, b) => a - b)) {
    const of = list.filter((c) => Number(c.entityId) === seq);
    const [newest, oldest] = [of[0], of[of.length - 1]];
    if (newest.action === "delete") {
      if (oldest.action === "create") continue; // charged and dropped again: nothing left to say
      dropped.push(seq);
      droppedOld += amount(oldest, "old");
    } else if (oldest.action === "create") {
      added.push(seq);
      addedNew += amount(newest, "new");
    } else {
      changed.push(seq);
      changedOld += amount(oldest, "old");
      changedNew += amount(newest, "new");
    }
  }
  const lines: HistoryLine[] = [];
  if (added.length) lines.push({ label: `${t("Charged", "Cobrada")} · ${which(added)}`, value: fmt.money(addedNew) });
  if (changed.length) lines.push({ label: `${t("Recalculated", "Recalculada")} · ${which(changed)}`, from: fmt.money(changedOld), to: fmt.money(changedNew) });
  if (dropped.length) lines.push({ label: `${t("No longer overdue", "Ya no está vencida")} · ${which(dropped)}`, from: fmt.money(droppedOld), to: fmt.money(0) });
  return {
    subject: `${t("Late fees", "Moras")} · ${loanTitle(list[0]?.loanId, t, names)}`,
    lines,
    reason: t("Worked out again after a change to the loan or its payments", "Recalculadas después de un cambio en el préstamo o sus pagos"),
  };
}

/** Receipt wording: which text changed. Stored as "=<text>" under the
 *  keys in src/receipts/wording.ts; a missing key is the built-in text. */
function wording(old: string, next: string, t: T): HistoryLine[] {
  const map = (v: string): Record<string, string> => {
    const o = parse(v);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, string>) : {};
  };
  const [a, b] = [map(old), map(next)];
  const builtIn = t("Built-in text", "Texto predeterminado");
  const texts: Record<string, string> = {
    receipt_rules_heading: t("Heading of “How payments work”", "Título de “Cómo funcionan los pagos”"),
    receipt_payment_footer: t("Closing line of payment receipts", "Línea final del recibo de pago"),
    receipt_client_sign: t("Under the client's signature", "Bajo la firma del cliente"),
    receipt_lender_sign: t("Under the lender's signature", "Bajo la firma del prestamista"),
    receipt_loan_footer: t("Closing line of loan receipts", "Línea final del recibo de préstamo"),
  };
  const rules: Record<string, string> = {
    receipt_rules_declining: t("Declining", "Decreciente"),
    receipt_rules_flat: t("Flat", "Fijo"),
    receipt_rules_interest_only: t("Interest only", "Solo interés"),
  };
  const shown = (v: string | undefined) => (v ? v.replace(/^=/, "") || "—" : builtIn);
  const out: HistoryLine[] = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
    if (a[k] === b[k]) continue;
    if (rules[k]) {
      out.push({
        label: `${t("“How payments work” lines", "Líneas de “Cómo funcionan los pagos”")} · ${rules[k]}`,
        value: b[k] === undefined ? t("Back to the built-in lines", "De vuelta al texto predeterminado") : t("Edited", "Editadas"),
      });
    } else {
      const cut = (v: string) => (v.length > 120 ? `${v.slice(0, 120)}…` : v);
      out.push({ label: texts[k] ?? t("Receipt wording", "Texto de los recibos"), from: cut(shown(a[k])), to: cut(shown(b[k])) });
    }
  }
  return out;
}

/** The app's own notes in the reader's language; a typed reason as it is. */
function reasonText(r: string, t: T): string {
  const fixed: Record<string, string> = {
    "Recalculated after a change": t("Recalculated after a change", "Recalculada después de un cambio"),
    "No longer overdue after a change": t("No longer overdue after a change", "Ya no está vencida después de un cambio"),
    "Recorded offline": t("Recorded offline", "Registrado sin conexión"),
    "Recorded offline; confirmed after the loan changed": t("Recorded offline; confirmed after the loan changed", "Registrado sin conexión; confirmado después de que el préstamo cambió"),
    Invitation: t("Invitation", "Invitación"),
    "Invitation revoked": t("Invitation revoked", "Invitación cancelada"),
    "Accepted an invitation": t("Accepted an invitation", "Aceptó una invitación"),
    "Created the business": t("Created the business", "Creó el negocio"),
    Reinstated: t("Back to active", "De vuelta a activo"),
    "Imported from the desktop app": t("Imported from the desktop app", "Importado de la app de escritorio"),
  };
  if (fixed[r]) return fixed[r];
  const confirmed = r.match(/^Collected by (.+); confirmed by (.+)$/);
  if (confirmed) return t(`Collected by ${confirmed[1]}; confirmed by ${confirmed[2]}`, `Cobrado por ${confirmed[1]}; confirmado por ${confirmed[2]}`);
  const rejected = r.match(/^Collected by (.+); rejected: ([\s\S]+)$/);
  if (rejected) return t(`Collected by ${rejected[1]}; rejected: ${rejected[2]}`, `Cobrado por ${rejected[1]}; rechazado: ${rejected[2]}`);
  return r;
}
