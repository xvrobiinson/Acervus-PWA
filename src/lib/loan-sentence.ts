// The new-loan form's sentence in plain words (2026-11-10, usability item 2):
// "Marta pays RD$1,400.00 every week for 8 weeks, RD$11,200.00 in all, the
// first on Nov 17, 2026." Worked out from the schedule the form already
// shows; nothing new is calculated. The Windows app's twin is
// `loan_sentence` in src/ui/forms/loan.rs.

import type { Day } from "../../shared/domain/dates";
import type { Frequency, Method } from "../../shared/domain/loans";
import type { Cents } from "../../shared/domain/money";
import type { Fmt } from "./format";
import type { T } from "./i18n";

export interface SentenceInput {
  /** The client's full name, or null before one is chosen. */
  client: string | null;
  method: Method;
  frequency: Frequency;
  /** Installment loans: the schedule as shown. */
  schedule: { due: Day; principal: Cents; interest: Cents }[];
  /** Interest-only loans: each period's interest and the first due date. */
  periodInterest: Cents;
  firstDue: Day;
}

const every = (t: T, f: Frequency) =>
  ({
    daily: t("every day", "cada día"),
    weekly: t("every week", "cada semana"),
    biweekly: t("every 15 days", "cada 15 días"),
    monthly: t("every month", "cada mes"),
  })[f];

const span = (t: T, f: Frequency, n: number) =>
  ({
    daily: n === 1 ? t("1 day", "1 día") : t(`${n} days`, `${n} días`),
    weekly: n === 1 ? t("1 week", "1 semana") : t(`${n} weeks`, `${n} semanas`),
    biweekly: n === 1 ? t("15 days", "15 días") : t(`${n} payments of 15 days`, `${n} pagos de 15 días`),
    monthly: n === 1 ? t("1 month", "1 mes") : t(`${n} months`, `${n} meses`),
  })[f];

export function loanSentence(s: SentenceInput, t: T, fmt: Fmt): string | null {
  const who = s.client?.trim().split(/\s+/)[0] || t("The client", "El cliente");
  const often = every(t, s.frequency);
  if (s.method === "interest_only") {
    if (s.periodInterest <= 0) return null;
    const i = fmt.money(s.periodInterest);
    const first = fmt.day(s.firstDue);
    return t(
      `${who} pays ${i} of interest ${often}, the first on ${first}, and repays the capital whenever they can. Paying more than the interest lowers the next interest.`,
      `${who} paga ${i} de interés ${often}, el primero el ${first}, y devuelve el capital cuando pueda. Pagar más que el interés baja el próximo interés.`,
    );
  }
  const rows = s.schedule;
  if (rows.length === 0 || rows.some((x) => x.principal < 0 || x.interest < 0)) return null;
  const totals = rows.map((x) => x.principal + x.interest);
  const all = fmt.money(totals.reduce((a, x) => a + x, 0));
  const first = fmt.day(rows[0].due);
  const n = rows.length;
  if (totals.every((x) => x === totals[0])) {
    const each = fmt.money(totals[0]);
    return t(
      `${who} pays ${each} ${often} for ${span(t, s.frequency, n)}, ${all} in all, the first on ${first}.`,
      `${who} paga ${each} ${often} durante ${span(t, s.frequency, n)}, ${all} en total, el primero el ${first}.`,
    );
  }
  // Apart only by the cents of rounding (a flat loan's last installment).
  if (Math.max(...totals) - Math.min(...totals) <= n) {
    const each = fmt.money(totals[0]);
    return t(
      `${who} pays about ${each} ${often} for ${span(t, s.frequency, n)}, ${all} in all, the first on ${first}.`,
      `${who} paga unos ${each} ${often} durante ${span(t, s.frequency, n)}, ${all} en total, el primero el ${first}.`,
    );
  }
  const [a, b] = [fmt.money(totals[0]), fmt.money(totals[n - 1])];
  return t(
    `${who} pays ${n} installments ${often}, from ${a} to ${b}, ${all} in all, the first on ${first}.`,
    `${who} paga ${n} cuotas ${often}, de ${a} a ${b}, ${all} en total, la primera el ${first}.`,
  );
}
