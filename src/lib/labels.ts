// Words for the engine's keys, in both languages (from the desktop app).

import type { ContractStatus, DisplayStatus } from "../../shared/domain/ledger";
import type { FeeMode, InstallmentStatus } from "../../shared/domain/installments";
import type { Frequency, Method } from "../../shared/domain/loans";
import type { Account, CapitalKind, EntryKind } from "../../shared/domain/portfolio";
import type { ReceiptShow } from "../receipts/receipt";
import type { T } from "./i18n";

export const frequencyLabel = (t: T, f: Frequency) =>
  ({
    daily: t("Daily", "Diario"),
    weekly: t("Weekly", "Semanal"),
    biweekly: t("Every 15 days", "Quincenal"),
    monthly: t("Monthly", "Mensual"),
  })[f];

/** "a month" / "mensual", after a rate: "10% a month". */
export const frequencyPer = (t: T, f: Frequency) =>
  ({
    daily: t("a day", "diario"),
    weekly: t("a week", "semanal"),
    biweekly: t("every 15 days", "quincenal"),
    monthly: t("a month", "mensual"),
  })[f];

/** How a payment was made (convex/schema.ts `paidWith`). */
export type PaidWith = "cash" | "transfer" | "card" | "check" | "other";
export const PAID_WITH: PaidWith[] = ["cash", "transfer", "card", "check", "other"];
export const paidWithLabel = (t: T, p: PaidWith) =>
  ({
    cash: t("Cash", "Efectivo"),
    transfer: t("Transfer", "Transferencia"),
    card: t("Card", "Tarjeta"),
    check: t("Check", "Cheque"),
    other: t("Other", "Otro"),
  })[p];

export const methodLabel = (t: T, m: Method) =>
  ({
    declining: t("Installments · declining balance", "Cuotas · saldo decreciente"),
    flat: t("Installments · flat interest", "Cuotas · interés fijo"),
    interest_only: t("Interest only · no fixed term", "Solo interés · sin plazo"),
  })[m];

export const methodShort = (t: T, m: Method) =>
  ({
    declining: t("Declining balance", "Saldo decreciente"),
    flat: t("Flat interest", "Interés fijo"),
    interest_only: t("Interest only", "Solo interés"),
  })[m];

/** Who each loan type suits, in one line (shown before its explanation). */
export const methodSuits = (t: T, m: Method) =>
  ({
    declining: t("Suits most loans: payments get smaller as the capital comes down.", "Sirve para la mayoría: las cuotas bajan a medida que baja el capital."),
    flat: t("The same payment every time, easy for the client to remember.", "La misma cuota siempre, fácil de recordar para el cliente."),
    interest_only: t("For open-ended loans: the client pays interest and repays the capital when they can.", "Para préstamos sin plazo: el cliente paga interés y devuelve el capital cuando pueda."),
  })[m];

export const methodExplanation = (t: T, m: Method) =>
  ({
    declining: t(
      "Each installment repays an equal part of the capital. Interest is charged each period on the capital still owed when the period begins, so it goes down as the capital is repaid.",
      "Cada cuota paga una parte igual del capital. El interés de cada período se calcula sobre el capital adeudado al empezar el período, así que baja a medida que se paga el capital.",
    ),
    flat: t(
      "Each installment repays an equal part of the capital. Interest is charged each period on the original amount lent, so every installment has the same interest.",
      "Cada cuota paga una parte igual del capital. El interés de cada período se calcula sobre el monto original prestado, así que todas las cuotas tienen el mismo interés.",
    ),
    interest_only: t(
      "No fixed term. Each period's interest is charged on the capital still owed; anything paid above the interest lowers the capital and the next interest.",
      "Sin plazo fijo. El interés de cada período se calcula sobre el capital adeudado; lo que pase del interés baja el capital y el próximo interés.",
    ),
  })[m];

export const displayStatusLabel = (t: T, s: DisplayStatus) =>
  ({
    active: t("Current", "Al día"),
    due_soon: t("Due soon", "Vence pronto"),
    overdue: t("Overdue", "Atrasado"),
    paid_off: t("Paid off", "Saldado"),
    defaulted: t("Defaulted", "Incobrable"),
    restructured: t("Restructured", "Reestructurado"),
  })[s];

/** What a status means, in one sentence (shown on hover and on the loan page). */
export const displayStatusHint = (t: T, s: DisplayStatus) =>
  ({
    active: t("Payments are up to date.", "Los pagos están al día."),
    due_soon: t("A payment falls due within 5 days.", "Un pago vence dentro de 5 días."),
    overdue: t("A due date has passed with something still unpaid.", "Pasó una fecha de pago y queda algo sin pagar."),
    paid_off: t("Everything is paid. The loan is closed.", "Todo está pagado. El préstamo está cerrado."),
    defaulted: t("Marked as unlikely to be paid back: no more interest is charged. Reinstate it to record payments again.", "Marcado como difícil de cobrar: ya no se cobra interés. Reactívalo para volver a registrar pagos."),
    restructured: t("Its terms were replaced on its status date: no new interest is charged on it after that.", "Sus condiciones se reemplazaron en la fecha de su estado: desde entonces no se cobra interés nuevo."),
  })[s];

export const contractStatusLabel = (t: T, s: ContractStatus) =>
  ({
    active: t("Active", "Activo"),
    paid_off: t("Paid off", "Saldado"),
    defaulted: t("Defaulted", "Incobrable"),
    restructured: t("Restructured", "Reestructurado"),
  })[s];

export const installmentStatusLabel = (t: T, s: InstallmentStatus) =>
  ({
    paid: t("Paid", "Pagada"),
    partly_paid: t("Partly paid", "Pago parcial"),
    overdue: t("Overdue", "Atrasada"),
    due: t("Current", "En curso"),
    upcoming: t("Upcoming", "Próxima"),
  })[s];

export const accountLabel = (t: T, a: Account) =>
  a === "capital" ? t("Available capital", "Capital disponible") : t("Available interest", "Interés disponible");

export const entryKindLabel = (t: T, k: EntryKind | CapitalKind) =>
  ({
    expense: t("Expense", "Gasto"),
    income: t("Income", "Ingreso"),
    transfer: t("Money moved", "Dinero movido"),
    adjustment: t("Balance adjustment", "Ajuste de saldo"),
    contribution: t("Capital added", "Capital agregado"),
    withdrawal: t("Capital withdrawn", "Capital retirado"),
  })[k];

export const roleLabel = (t: T, r: "admin" | "collector" | "viewer") =>
  ({ admin: t("Admin", "Administrador"), collector: t("Collector", "Cobrador"), viewer: t("Viewer", "Solo lectura") })[r];

export const CURRENCIES = [
  { code: "DOP", symbol: "RD$", en: "Dominican peso", es: "Peso dominicano" },
  { code: "USD", symbol: "US$", en: "US dollar", es: "Dólar estadounidense" },
  { code: "EUR", symbol: "€", en: "Euro", es: "Euro" },
  { code: "MXN", symbol: "MX$", en: "Mexican peso", es: "Peso mexicano" },
  { code: "COP", symbol: "COL$", en: "Colombian peso", es: "Peso colombiano" },
  { code: "GBP", symbol: "£", en: "Pound sterling", es: "Libra esterlina" },
  { code: "CAD", symbol: "CA$", en: "Canadian dollar", es: "Dólar canadiense" },
  // Curaçao and Sint Maarten; replaced the Netherlands Antillean guilder (ANG).
  { code: "XCG", symbol: "Cg", en: "Caribbean guilder", es: "Florín del Caribe" },
];

export function currencySymbol(code: string): string {
  return (CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]).symbol;
}

/** The receipt part switches, grouped as Settings shows them. */
export const RECEIPT_PART_GROUPS: [[string, string], [keyof ReceiptShow, string, string][]][] = [
  [
    ["Loan details", "Datos del préstamo"],
    [
      ["loanNumber", "Loan number", "Número de préstamo"],
      ["amountLent", "Amount lent", "Monto prestado"],
      ["rate", "Interest rate", "Tasa de interés"],
      ["cycle", "Payment cycle", "Frecuencia de pago"],
    ],
  ],
  [
    ["Payment details", "Datos del pago"],
    [
      ["installments", "Installments covered", "Cuotas cubiertas"],
      ["split", "Interest and capital split", "División entre interés y capital"],
      ["lateFees", "Late fees", "Mora"],
    ],
  ],
  [
    ["Balances", "Saldos"],
    [
      ["balance", "Remaining balance", "Saldo pendiente"],
      ["history", "Payment history", "Historial de pagos"],
    ],
  ],
];

export type CollectorViewPart = "amountLent" | "rate" | "contact" | "idNumber" | "history" | "lateFees" | "notes";

/** What a collector can be shown, as the Team page lists it. */
export const COLLECTOR_VIEW_PARTS: [CollectorViewPart, string, string][] = [
  ["amountLent", "Amount lent", "Monto prestado"],
  ["rate", "Interest rate", "Tasa de interés"],
  ["contact", "Client phone and address", "Teléfono y dirección del cliente"],
  ["idNumber", "Client ID number", "Cédula del cliente"],
  ["history", "Payment history", "Historial de pagos"],
  ["lateFees", "Late fees", "Mora"],
  ["notes", "Client notes", "Notas del cliente"],
];

/** The ways of charging late fees (0.15), in plain words. */
export function feeModeLabel(t: T, m: FeeMode | undefined): string {
  switch (m ?? "installment") {
    case "monthly":
      return t("Each month it stays late", "Cada mes que siga atrasada");
    case "overdue":
      return t("On everything overdue", "Sobre todo lo atrasado");
    case "balance":
      return t("On what is left of the loan", "Sobre lo que queda del préstamo");
    default:
      return t("Once on the late installment", "Una vez sobre la cuota atrasada");
  }
}

export function feeModeHint(t: T, m: FeeMode | undefined): string {
  switch (m ?? "installment") {
    case "monthly":
      return t(
        "The day after a due date, on what is unpaid of that installment, then again every 30 days while it stays unpaid.",
        "El día después del vencimiento, sobre lo que falte de esa cuota, y otra vez cada 30 días mientras siga sin pagar.",
      );
    case "overdue":
      return t("The day after each due date, on everything overdue on the loan that day.", "El día después de cada vencimiento, sobre todo lo atrasado del préstamo ese día.");
    case "balance":
      return t("The day after each missed due date, on all the capital still owed.", "El día después de cada vencimiento sin pagar, sobre todo el capital que se debe.");
    default:
      return t("Charged once on what is unpaid, the day after a due date.", "Se cobra una vez sobre lo que falte, el día después del vencimiento.");
  }
}

/** Where a loan's collected interest goes (0.15). */
export function reinvestLabel(t: T, percent: number): string {
  if (percent <= 0) return t("Kept as profit", "Se queda como ganancia");
  if (percent >= 100) return t("Reinvested into capital", "Se reinvierte en capital");
  return t(`${percent}% reinvested, the rest kept as profit`, `${percent}% se reinvierte, el resto queda como ganancia`);
}
