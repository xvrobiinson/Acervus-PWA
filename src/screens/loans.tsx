// Loans: list with filters, the loan page (figures, schedule or periods,
// payments, late fees, status) and the loan form with its schedule.

import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { addDays, type Day } from "../../shared/domain/dates";
import {
  checkSchedule,
  installmentStatus,
  proposedSchedule,
  remaining,
  type Installment,
} from "../../shared/domain/installments";
import { DISPLAY_ORDER, periodStates, type DisplayStatus } from "../../shared/domain/ledger";
import { dueDate, effectiveRate, FREQUENCIES, periodInterest, hasInstallments, rateConverts, RATE_PRESETS, validateTerms, type Frequency, type LoanTerms, type Method } from "../../shared/domain/loans";
import { parseMoney, ratePercentLabel } from "../../shared/domain/money";
import { availableFrom } from "../../shared/domain/portfolio";
import { buildBook, termsFacts, type LoanRecord, type PaymentRecord } from "../../shared/domain/records";
import { useForms } from "../App";
import { describeError, errorData, scheduleErrorText } from "../lib/errors";
import { ReinvestPicker } from "../ui/reinvest";
import { useT } from "../lib/i18n";
import { contractStatusLabel, displayStatusHint, feeModeHint, feeModeLabel, reinvestLabel, displayStatusLabel, frequencyLabel, frequencyPer, installmentStatusLabel, methodExplanation, methodLabel, methodShort, methodSuits } from "../lib/labels";
import { loanSentence } from "../lib/loan-sentence";
import { ReceiptSheet } from "../receipts/view";
import { PendingOnLoan } from "./collect";
import { useBooks } from "../state/app";
import type { LoanView } from "../state/books";
import { DateInput, MoneyInput, RateInput, useMoney, useParseError, useRate } from "../ui/inputs";
import { Avatar, Banner, Button, Card, Count, Confirm, Empty, Field, FilterPill, PaidBack, Pill, Row, Segmented, Sheet, TabsPill, useToast } from "../ui/kit";
import { WaClientButton, WaReceiptButton } from "../ui/whatsapp";

export function statusTone(s: DisplayStatus): "pos" | "warn" | "neg" | undefined {
  return s === "overdue" || s === "defaulted" ? "neg" : s === "due_soon" ? "warn" : s === "paid_off" ? "pos" : undefined;
}

type Filter = "open" | "overdue" | "closed" | "all";

/** A loan's status, with what it means on hover. */
export function StatusPill({ s }: { s: DisplayStatus }) {
  const t = useT();
  return (
    <Pill tone={statusTone(s)} title={displayStatusHint(t, s)}>
      {displayStatusLabel(t, s)}
    </Pill>
  );
}

export function LoansScreen() {
  const t = useT();
  const { books, fmt, can, mode } = useBooks();
  const open = useForms();
  // /loans?show=overdue (the Overview's "Open late loans") starts on Overdue.
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(params.get("show") === "overdue" ? "overdue" : "open");
  const { snapshot } = useBooks();
  const lentShown = snapshot.me.view.amountLent;
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return books.loans
      .filter((l) =>
        filter === "all"
          ? true
          : filter === "overdue"
            ? l.display === "overdue"
            : filter === "open"
              ? l.loan.status === "active"
              : l.loan.status !== "active",
      )
      .filter((l) => !needle || (l.client?.fullName ?? "").toLowerCase().includes(needle) || String(l.loan.recordNo) === needle.replace("#", ""))
      .sort((a, b) => DISPLAY_ORDER.indexOf(a.display) - DISPLAY_ORDER.indexOf(b.display) || b.loan.recordNo - a.loan.recordNo);
  }, [books.loans, filter, q]);
  const owed = list.reduce((x, l) => x + l.payoff, 0);
  return (
    <div>
      <div className="topbar page-head">
        <div className="grow">
          <h1>{t("Loans", "Préstamos")}</h1>
          <div className="small muted">{t(`${list.length} loan(s) · ${fmt.money(owed)} to collect · figures as of ${fmt.day(books.today)}`, `${list.length} préstamo(s) · ${fmt.money(owed)} por cobrar · cifras al ${fmt.day(books.today)}`)}</div>
        </div>
        {can("manage") && mode === "online" && (
          <Button variant="primary" size="small" icon="plus" onClick={() => open({ kind: "loan" })}>
            {t("New loan", "Nuevo préstamo")}
          </Button>
        )}
      </div>
      <div className="page-tools">
        <FilterPill value={q} onChange={setQ} placeholder={t("Client or loan number", "Cliente o número de préstamo")} label={t("Search loans", "Buscar préstamos")} />
        <TabsPill
          label={t("Show", "Mostrar")}
          value={filter}
          onChange={setFilter}
          options={[
            ["open", t("Open", "Abiertos")],
            ["overdue", t("Overdue", "Atrasados"), books.loans.filter((l) => l.display === "overdue").length],
            ["closed", t("Closed", "Cerrados")],
            ["all", t("All", "Todos")],
          ]}
        />
      </div>
      <div className="tbl-wrap">
        {list.length === 0 ? (
          <Empty icon="loans">{t("No loans here.", "No hay préstamos aquí.")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("Loan", "Préstamo")}</th>
                <th>{t("Client", "Cliente")}</th>
                <th className="wide-only">{t("Next", "Próximo")}</th>
                {lentShown && <th className="wide-only num">{t("Lent", "Prestado")}</th>}
                {lentShown && <th className="wide-only">{t("Paid back", "Devuelto")}</th>}
                <th className="num">{t("To pay it off", "Para saldarlo")}</th>
                <th>{t("Status", "Estado")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <LoanRow key={l.loan._id} l={l} lentShown={lentShown} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function LoanRow({ l, lentShown }: { l: LoanView; lentShown: boolean }) {
  const t = useT();
  const { fmt } = useBooks();
  const navigate = useNavigate();
  const go = () => navigate(`/loans/${l.loan._id}`);
  const q = l.delinquency;
  const back = l.loan.principal > 0 ? l.position.principalPaid / l.loan.principal : 0;
  const next =
    l.display === "overdue"
      ? t(`${q.daysOverdue} days late · ${fmt.money(q.overdueAmount)}`, `${q.daysOverdue} días de atraso · ${fmt.money(q.overdueAmount)}`)
      : q.nextDue && l.loan.status === "active"
        ? `${fmt.dayShort(q.nextDue)} · ${fmt.money(q.nextDueAmount)}`
        : `${methodShort(t, l.loan.method)} · ${fmt.day(l.loan.startDate)}`;
  return (
    <tr className="link" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === "Enter" && go()}>
      <td className="muted">#{l.loan.recordNo}</td>
      <td>
        <span className="cell-who">
          <Avatar name={l.client?.fullName ?? "?"} />
          <span className="ellipsis">{l.client?.fullName ?? "—"}</span>
        </span>
      </td>
      <td className={`wide-only nowrap ${l.display === "overdue" ? "neg" : "muted"}`}>{next}</td>
      {lentShown && <td className="wide-only num">{fmt.money(l.loan.principal)}</td>}
      {lentShown && (
        <td className="wide-only">
          <PaidBack value={back} label={t(`${Math.round(Math.min(1, back) * 100)}% of the capital paid back`, `${Math.round(Math.min(1, back) * 100)}% del capital devuelto`)} />
        </td>
      )}
      <td className="num strong">{fmt.money(l.payoff)}</td>
      <td>
        <StatusPill s={l.display} />
      </td>
    </tr>
  );
}

export function rateLine(t: ReturnType<typeof useT>, fmtRate: (r: number) => string, loan: { rate: number; interestPeriod: Frequency; frequency: Frequency }) {
  const rate = `${fmtRate(loan.rate)} ${frequencyPer(t, loan.interestPeriod)}`;
  return loan.interestPeriod === loan.frequency ? rate : t(`${rate} · paid ${frequencyLabel(t, loan.frequency).toLowerCase()}`, `${rate} · pago ${frequencyLabel(t, loan.frequency).toLowerCase()}`);
}

export function LoanDetail() {
  const t = useT();
  const { id } = useParams();
  const app = useBooks();
  const { books, fmt, can, mode, businessId, ops, snapshot, today } = app;
  // A collector's switches (convex/lib/team.ts); everything for anyone else.
  const view = snapshot.me.view;
  const navigate = useNavigate();
  const open = useForms();
  const toast = useToast();
  const [receipt, setReceipt] = useState<{ kind: "payment" | "loan"; id: string } | null>(null);
  const [ask, setAsk] = useState<null | "delete" | "default" | { deletePayment: string } | { waive: number; waived: boolean }>(null);
  const removeLoan = useMutation(api.loans.remove);
  const markDefaulted = useMutation(api.loans.markDefaulted);
  const reinstate = useMutation(api.loans.reinstate);
  const removePayment = useMutation(api.payments.remove);
  const waive = useMutation(api.loans.setLateFeeWaived);
  const l = books.loanById.get(id ?? "");
  if (!l) return <Empty icon="loans">{t("This loan no longer exists.", "Este préstamo ya no existe.")}</Empty>;
  const loan = l.loan;
  const online = mode === "online";
  const admin = can("manage") && online;
  const pending = ops.filter((o) => o.kind === "payment.record" && o.status !== "synced" && o.args.loanId === loan._id);
  const fees = snapshot.lateFees.filter((f) => f.loanId === loan._id);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      throw new Error(describeError(t, fmt, e));
    }
  };
  const p = l.position;
  return (
    <div>
      <div className="topbar">
        <Button variant="ghost" icon="back" className="back" aria-label={t("Back", "Atrás")} onClick={() => navigate(-1)} />
        <h1 className="ellipsis">
          {l.client?.fullName ?? "—"} · #{loan.recordNo}
        </h1>
        <StatusPill s={l.display} />
      </div>
      {(l.display === "defaulted" || l.display === "restructured") && <p className="small muted status-note">{displayStatusHint(t, l.display)}</p>}
      <div className="actions" style={{ marginBottom: 12 }}>
        {can("record") && loan.status === "active" && (
          <Button variant="primary" icon="receipt" onClick={() => open({ kind: "payment", loanId: loan._id })}>
            {t("Record payment", "Registrar pago")}
          </Button>
        )}
        <Button icon="printer" onClick={() => setReceipt({ kind: "loan", id: loan._id })}>
          {t("Loan receipt", "Recibo del préstamo")}
        </Button>
        {l.client && <WaClientButton clientId={l.client._id} loanId={loan._id} />}
        {admin && <Button icon="edit" onClick={() => open({ kind: "loan", loanId: loan._id })}>{t("Edit", "Editar")}</Button>}
        {l.client && <Button variant="ghost" onClick={() => navigate(`/clients/${l.client!._id}`)}>{t("Client", "Cliente")}</Button>}
      </div>
      {pending.length > 0 && (
        <Banner tone="warn" icon="clock">
          {t(
            `${pending.length} payment(s) recorded on this device are not in these figures yet; they count once synced.`,
            `${pending.length} pago(s) registrados en este dispositivo aún no están en estas cifras; cuentan al sincronizarse.`,
          )}
        </Banner>
      )}
      <Card>
        <div className="stats">
          <div className="stat lead">
            <div className="label">{t("Owed now to close it", "Adeuda ahora para saldarlo")}</div>
            <div className="value"><Count v={l.payoff} fmt={fmt} /></div>
            {l.loan.status === "active" && l.delinquency.nextDue && (
              <div className="caption">
                {t(`Next: ${fmt.day(l.delinquency.nextDue)} · ${fmt.money(l.delinquency.nextDueAmount)}`, `Próximo: ${fmt.day(l.delinquency.nextDue)} · ${fmt.money(l.delinquency.nextDueAmount)}`)}
              </div>
            )}
          </div>
          <div className="stat">
            <div className="label">{t("Capital owed", "Capital adeudado")}</div>
            <div className="value"><Count v={p.principalOutstanding} fmt={fmt} /></div>
          </div>
          <div className="stat">
            <div className="label">{t("Interest owed", "Interés pendiente")}</div>
            <div className="value"><Count v={p.interestOutstanding} fmt={fmt} /></div>
          </div>
          {view.lateFees && (
            <div className="stat">
              <div className="label">{t("Late fees owed", "Mora pendiente")}</div>
              <div className={`value ${p.feesOutstanding ? "neg" : ""}`}><Count v={p.feesOutstanding} fmt={fmt} /></div>
            </div>
          )}
          <div className="stat">
            <div className="label">{t("Overdue", "Atrasado")}</div>
            <div className={`value ${l.delinquency.overdueAmount ? "neg" : ""}`}><Count v={l.delinquency.overdueAmount} fmt={fmt} /></div>
            {l.delinquency.overdueSince && <div className="caption">{t(`${l.delinquency.daysOverdue} days`, `${l.delinquency.daysOverdue} días`)}</div>}
          </div>
          <div className="stat">
            <div className="label">{t("Paid so far", "Pagado hasta ahora")}</div>
            <div className="value"><Count v={p.paidTotal} fmt={fmt} /></div>
            <div className="caption">
              {t("interest", "interés")} {fmt.money(p.interestPaid)} · {t("capital", "capital")} {fmt.money(p.principalPaid)}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div>
          {l.plan ? (
            <Card title={t("Installments", "Cuotas")} action={loan.scheduleEdited ? <Pill tone="accent">{t("Set by hand", "Fijado a mano")}</Pill> : null}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("Due", "Vence")}</th>
                      <th className="num">{t("Amount", "Monto")}</th>
                      <th className="num">{t("Left", "Falta")}</th>
                      <th>{t("Status", "Estado")}</th>
                      {view.lateFees && <th className="num">{t("Late fee", "Mora")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {l.plan.installments.map((x) => {
                      const st = installmentStatus(x, books.today);
                      const fee = fees.find((f) => f.seq === x.seq);
                      return (
                        <tr key={x.seq} className={st === "paid" ? "dim" : ""}>
                          <td>{x.seq}</td>
                          <td>{fmt.dayShort(x.due)}</td>
                          <td className="num">{fmt.money(x.principal + x.interest + x.fee)}</td>
                          <td className="num">{remaining(x) > 0 ? fmt.money(remaining(x)) : "—"}</td>
                          <td>
                            <Pill tone={st === "paid" ? "pos" : st === "overdue" ? "neg" : st === "partly_paid" ? "warn" : undefined}>{installmentStatusLabel(t, st)}</Pill>
                          </td>
                          {view.lateFees && <td className="num">
                            {x.feeAssessedOn ? (
                              <span className="row" style={{ justifyContent: "flex-end", gap: 4 }}>
                                <span className={x.feeWaived ? "faint" : ""} style={x.feeWaived ? { textDecoration: "line-through" } : undefined}>
                                  {fmt.money(x.feeWaived ? x.feeAssessed : x.fee)}
                                </span>
                                {admin && fee && (
                                  <Button size="small" variant="ghost" onClick={() => setAsk({ waive: x.seq, waived: !x.feeWaived })}>
                                    {x.feeWaived ? t("Restore", "Restaurar") : t("Waive", "Perdonar")}
                                  </Button>
                                )}
                              </span>
                            ) : (
                              ""
                            )}
                          </td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title={t("Interest periods", "Períodos de interés")}>
              <p className="card-note">{t("Interest is charged once a period on the capital still owed. Payments cover the oldest period first.", "El interés se cobra una vez por período sobre el capital que se debe. Los pagos cubren primero el período más antiguo.")}</p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>{t("Due", "Vence")}</th>
                      <th className="num">{t("On capital", "Sobre capital")}</th>
                      <th className="num">{t("Interest", "Interés")}</th>
                      <th className="num">{t("Paid", "Pagado")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodStates(p, books.today)
                      .slice()
                      .reverse()
                      .map(({ period, state, paid }) => (
                        <tr key={period.seq} className={state === "paid" ? "dim" : ""}>
                          <td>
                            {fmt.dayShort(period.due)} {state === "overdue" && <Pill tone="neg">{t("Overdue", "Atrasado")}</Pill>}
                          </td>
                          <td className="num">{fmt.money(period.balance)}</td>
                          <td className="num">{fmt.money(period.interest)}</td>
                          <td className="num">{fmt.money(paid)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {p.periods.length === 0 && <Empty icon="clock">{t("No interest charged yet.", "Aún no se ha cobrado interés.")}</Empty>}
            </Card>
          )}

          <Card title={t("Payments", "Pagos")} className="section">
            <ul className="list">
              <PendingOnLoan loanId={l.loan._id} />
              {pending.map((o) => (
                <Row key={o.opId} to="/sync" title={fmt.money(Number(o.args.amount))} sub={`${o.summary.on ? fmt.day(o.summary.on) : ""} · ${t("on this device, not synced", "en este dispositivo, sin sincronizar")}`} trail={<Pill tone="warn">{o.status === "needs_review" ? t("Review", "Revisar") : t("Pending", "Pendiente")}</Pill>} />
              ))}
              {(view.history ? [...l.payments].reverse() : []).map((pay) => (
                <li key={pay._id}>
                  <div className="list-row">
                    <div className="grow">
                      <div className="title">
                        {fmt.money(pay.amount)} <span className="muted small">· {fmt.day(pay.paidOn)}</span>
                      </div>
                      <div className="sub">
                        {[pay.fee && view.lateFees ? `${t("fees", "mora")} ${fmt.money(pay.fee)}` : "", `${t("interest", "interés")} ${fmt.money(pay.interest)}`, `${t("capital", "capital")} ${fmt.money(pay.principal)}`]
                          .filter(Boolean)
                          .join(" · ")}
                        {pay.recordedOffline ? ` · ${t("recorded offline", "registrado sin conexión")}` : ""}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 2 }}>
                      <Button size="small" variant="ghost" icon="printer" aria-label={t("Receipt", "Recibo")} onClick={() => setReceipt({ kind: "payment", id: pay._id })} />
                      <WaReceiptButton payment={pay} />
                      {admin && <Button size="small" variant="ghost" icon="edit" aria-label={t("Edit", "Editar")} onClick={() => open({ kind: "payment", paymentId: pay._id })} />}
                      {admin && <Button size="small" variant="ghost" icon="trash" aria-label={t("Delete", "Eliminar")} onClick={() => setAsk({ deletePayment: pay._id })} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {(l.payments.length === 0 || !view.history) && pending.length === 0 && !snapshot.pending.some((p) => p.loanId === l.loan._id && p.status === "waiting") && <Empty icon="receipt">{t("No payments yet.", "Aún no hay pagos.")}</Empty>}
          </Card>
        </div>
        <div>
          <Card title={t("Terms", "Condiciones")}>
            <dl className="kv card-body">
              {view.amountLent && (
                <>
                  <dt>{t("Amount lent", "Monto prestado")}</dt>
                  <dd>{fmt.money(loan.principal)}</dd>
                </>
              )}
              <dt>{t("Type", "Tipo")}</dt>
              <dd>{methodShort(t, loan.method)}</dd>
              {view.rate && (
                <>
                  <dt>{t("Rate", "Tasa")}</dt>
                  <dd>{rateLine(t, fmt.rate, loan)}</dd>
                </>
              )}
              <dt>{t("Payments", "Pagos")}</dt>
              <dd>{frequencyLabel(t, loan.frequency)}</dd>
              {loan.installments && (
                <>
                  <dt>{t("Installments", "Cuotas")}</dt>
                  <dd>{loan.schedule.length}</dd>
                  {view.lateFees && (
                    <>
                      <dt>{t("Late fee", "Mora")}</dt>
                      <dd title={feeModeHint(t, loan.lateFeeMode)}>
                        {fmt.rate(loan.lateFeeRate)} · {feeModeLabel(t, loan.lateFeeMode).toLowerCase()}
                      </dd>
                    </>
                  )}
                </>
              )}
              {app.can("manage") && (
                <>
                  <dt>{t("Interest", "Interés")}</dt>
                  <dd>{reinvestLabel(t, (loan.reinvest ?? []).filter((c) => c.from <= today).at(-1)?.percent ?? 0)}</dd>
                </>
              )}
              <dt>{t("Loan date", "Fecha")}</dt>
              <dd>{fmt.day(loan.startDate)}</dd>
              <dt>{t("Status", "Estado")}</dt>
              <dd>
                {contractStatusLabel(t, loan.status)}
                {loan.statusDate && loan.status !== "active" ? ` · ${fmt.dayShort(loan.statusDate)}` : ""}
              </dd>
            </dl>
            {loan.notes && <p className="card-body small" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{loan.notes}</p>}
          </Card>
          {admin && (
            <div className="actions" style={{ marginTop: 16 }}>
              {loan.status === "active" && <Button onClick={() => setAsk("default")}>{t("Mark as defaulted", "Marcar incobrable")}</Button>}
              {loan.status === "defaulted" && (
                <Button onClick={() => void run(() => reinstate({ businessId, loanId: loan._id, expectedVersion: loan.version }), t("Loan reinstated.", "Préstamo reactivado.")).catch((e) => toast(String(e.message), true))}>
                  {t("Reinstate", "Reactivar")}
                </Button>
              )}
              <Button variant="danger-ghost" icon="trash" onClick={() => setAsk("delete")}>
                {t("Delete loan", "Eliminar préstamo")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {receipt && <ReceiptSheet kind={receipt.kind} id={receipt.id} onClose={() => setReceipt(null)} />}
      {ask === "delete" && (
        <Confirm
          title={t("Delete loan", "Eliminar préstamo")}
          danger
          needsReason
          confirmLabel={t("Delete", "Eliminar")}
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            await run(() => removeLoan({ businessId, loanId: loan._id, expectedVersion: loan.version, reason }));
            navigate("/loans", { replace: true });
          }}
        >
          {t(
            `This deletes the loan and its ${l.payments.length} payment(s). It is refused if the money was already used. The deletion is kept in the history.`,
            `Esto elimina el préstamo y sus ${l.payments.length} pago(s). Se rechaza si el dinero ya se usó. La eliminación queda en el historial.`,
          )}
        </Confirm>
      )}
      {ask === "default" && <DefaultSheet loanId={loan._id} version={loan.version} onClose={() => setAsk(null)} onSave={(on, note) => run(() => markDefaulted({ businessId, loanId: loan._id, expectedVersion: loan.version, on, note }), t("Marked as defaulted.", "Marcado como incobrable."))} />}
      {ask && typeof ask === "object" && "deletePayment" in ask && (
        <Confirm
          title={t("Delete payment", "Eliminar pago")}
          danger
          needsReason
          confirmLabel={t("Delete", "Eliminar")}
          onClose={() => setAsk(null)}
          onConfirm={async (reason) => {
            const pay = l.payments.find((x) => x._id === ask.deletePayment)!;
            await run(() => removePayment({ businessId, paymentId: pay._id, expectedVersion: pay.version, reason }), t("Payment deleted.", "Pago eliminado."));
          }}
        >
          {t("Every other payment on this loan is split again without it.", "Los demás pagos del préstamo se reparten de nuevo sin este.")}
        </Confirm>
      )}
      {ask && typeof ask === "object" && "waive" in ask && (
        <Confirm
          title={ask.waived ? t(`Waive the late fee of installment ${ask.waive}`, `Perdonar la mora de la cuota ${ask.waive}`) : t(`Restore the late fee of installment ${ask.waive}`, `Restaurar la mora de la cuota ${ask.waive}`)}
          needsReason={ask.waived}
          confirmLabel={ask.waived ? t("Waive", "Perdonar") : t("Restore", "Restaurar")}
          onClose={() => setAsk(null)}
          onConfirm={(reason) => run(() => waive({ businessId, loanId: loan._id, expectedVersion: loan.version, seq: ask.waive, waived: ask.waived, reason }))}
        >
          {t("Payments on the loan are worked out again.", "Los pagos del préstamo se recalculan.")}
        </Confirm>
      )}
    </div>
  );
}

function DefaultSheet({ onClose, onSave }: { loanId: Id<"loans">; version: number; onClose: () => void; onSave: (on: Day, note: string) => Promise<void> }) {
  const t = useT();
  const { today } = useBooks();
  const [on, setOn] = useState(today);
  const [note, setNote] = useState("");
  return (
    <Confirm title={t("Mark as defaulted", "Marcar incobrable")} danger confirmLabel={t("Mark as defaulted", "Marcar incobrable")} onClose={onClose} onConfirm={() => onSave(on, note)}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t("No interest or late fees are charged after this date, and what is owed is left out of portfolio value.", "No se cobra interés ni mora después de esta fecha, y lo adeudado sale del valor del portafolio.")}
        </p>
        <Field label={t("Date", "Fecha")}>{(id) => <DateInput id={id} value={on} max={today} onChange={setOn} />}</Field>
        <Field label={t("Note", "Nota")}>{(id) => <input id={id} className="input" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Confirm>
  );
}

// ----- the loan form -------------------------------------------------------

interface EditRow {
  seq: number;
  due: Day;
  principal: string;
  interest: string;
}

const toRows = (s: Installment[]): EditRow[] => s.map((x) => ({ seq: x.seq, due: x.due, principal: (x.principal / 100).toFixed(2), interest: (x.interest / 100).toFixed(2) }));

export function LoanForm({ clientId, loanId, onClose }: { clientId?: string; loanId?: string; onClose: () => void }) {
  const t = useT();
  const app = useBooks();
  const { books, fmt, snapshot, today, businessId } = app;
  const toast = useToast();
  const navigate = useNavigate();
  const open = useForms();
  const create = useMutation(api.loans.create);
  const update = useMutation(api.loans.update);
  const existing = loanId ? books.loanById.get(loanId)?.loan : undefined;
  const s = snapshot.settings!;
  const [client, setClient] = useState<string>(existing?.clientId ?? clientId ?? "");
  const [amount, setAmount] = useMoney(existing?.principal ?? null);
  const [start, setStart] = useState<Day>(existing?.startDate ?? today);
  const [method, setMethod] = useState<Method>(existing?.method ?? "declining");
  const [rate, setRate] = useRate(existing?.rate ?? s.defaultRate);
  const [period, setPeriod] = useState<Frequency>(existing?.interestPeriod ?? s.defaultFrequency);
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? s.defaultFrequency);
  const [count, setCount] = useState(String(existing?.installments ?? 5));
  const [lateFee, setLateFee] = useRate(existing?.lateFeeRate ?? s.lateFeeRate);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<EditRow[] | null>(existing?.scheduleEdited ? toRows(existing.schedule) : null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showErr = useParseError();
  // 0.15: the loan's late-fee way (new loans take the business's) and where
  // its interest goes (a change applies from today on).
  const feeMode = existing ? (existing.lateFeeMode ?? "installment") : (s.lateFeeMode ?? "installment");
  const reinvestNow = existing ? ((existing.reinvest ?? []).filter((c) => c.from <= today).at(-1)?.percent ?? 0) : (s.defaultReinvest ?? 0);
  const [reinvest, setReinvest] = useState(reinvestNow);

  const n = Number(count);
  const terms: LoanTerms | null =
    amount.value !== null && rate.value !== null && lateFee.value !== null
      ? {
          principal: amount.value,
          rate: rate.value,
          interestPeriod: period,
          frequency,
          startDate: start,
          method,
          installments: hasInstallments(method) ? (Number.isInteger(n) ? n : NaN) : null,
          lateFeeRate: hasInstallments(method) ? lateFee.value : 0,
        }
      : null;
  const termsProblem = terms ? validateTerms(terms) : null;
  const proposed = terms && !termsProblem && hasInstallments(method) ? proposedSchedule(termsFacts(terms), method, terms.installments!) : [];
  const edited: Installment[] | null = rows
    ? rows.map((r) => {
        const p = parseMoney(r.principal);
        const i = parseMoney(r.interest);
        return { seq: r.seq, due: r.due, principal: p.ok ? p.value : -1, interest: i.ok ? i.value : -1 };
      })
    : null;
  const schedule = edited ?? proposed;
  const scheduleProblem = terms && hasInstallments(method) && edited ? checkSchedule(terms.principal, start, edited) : null;
  const available = useMemo(() => {
    const others = { ...snapshot, loans: snapshot.loans.filter((x) => x._id !== loanId) };
    const book = buildBook({
      loans: others.loans as unknown as LoanRecord[],
      payments: snapshot.payments.filter((p) => p.loanId !== loanId) as unknown as PaymentRecord[],
      lateFees: snapshot.lateFees as never,
      capital: snapshot.capital as never,
      entries: snapshot.entries as never,
    });
    return availableFrom(book, start, null);
  }, [snapshot, loanId, start]);
  const activeClients = books.clients.filter((c) => !c.client.archivedAt || c.client._id === existing?.clientId).sort((a, b) => a.client.fullName.localeCompare(b.client.fullName));

  const save = async (addCapital?: number) => {
    setTried(true);
    setError(null);
    if (!client) return setError(t("Choose a client", "Elige un cliente"));
    if (!terms || termsProblem) return;
    if (scheduleProblem) return setError(scheduleErrorText(t, fmt, scheduleProblem));
    setBusy(true);
    try {
      if (existing) {
        await update({
          businessId,
          loanId: existing._id,
          expectedVersion: existing.version,
          clientId: client as Id<"clients">,
          terms,
          schedule: edited,
          notes,
          reason,
          ...(reinvest !== reinvestNow ? { reinvest } : {}),
          ...(addCapital ? { addCapital } : {}),
        });
        toast(t("Loan saved; every payment was worked out again.", "Préstamo guardado; todos los pagos se recalcularon."));
        onClose();
      } else {
        const id = await create({
          businessId,
          clientId: client as Id<"clients">,
          terms,
          schedule: edited,
          notes,
          lateFeeMode: feeMode,
          reinvest,
          ...(addCapital ? { addCapital } : {}),
        });
        toast(t("Loan created.", "Préstamo creado."));
        onClose();
        navigate(`/loans/${id}`);
      }
    } catch (e) {
      const d = errorData(e);
      setError(describeError(t, fmt, e) + (d?.code === "insufficient_cash" && !d.account && admin ? " " + t("Use \"Lend and add capital\" above.", "Usa \"Prestar y agregar capital\" arriba.") : ""));
    } finally {
      setBusy(false);
    }
  };
  // What is missing to lend this amount on that date, if anything.
  const admin = app.can("manage");
  // (\`available\` already leaves out the loan being edited.)
  const short = amount.value !== null && amount.value > Math.max(available, 0) ? amount.value - Math.max(available, 0) : 0;

  // The loan in one plain sentence, from the schedule shown below it.
  const sentence =
    terms && !termsProblem
      ? loanSentence(
          {
            client: books.clientById.get(client)?.client.fullName ?? null,
            method,
            frequency,
            schedule: hasInstallments(method) ? schedule : [],
            periodInterest: hasInstallments(method) ? 0 : periodInterest({ rate: terms.rate, per: period, every: frequency }, terms.principal),
            firstDue: dueDate(frequency, start, 1),
          },
          t,
          fmt,
        )
      : null;

  const diff = terms && edited ? terms.principal - edited.reduce((a, x) => a + Math.max(x.principal, 0), 0) : 0;
  const pr = { rate: rate.value ?? 0, per: period, every: frequency };
  return (
    <Sheet
      wide
      title={existing ? t(`Edit loan #${existing.recordNo}`, `Editar préstamo #${existing.recordNo}`) : t("New loan", "Nuevo préstamo")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {existing ? t("Save", "Guardar") : t("Create loan", "Crear préstamo")}
          </Button>
        </>
      }
    >
      <div className="form-grid two">
        <div className="span2">
          <Field label={t("Client", "Cliente")} error={tried && !client ? t("Choose a client", "Elige un cliente") : null}>
            {(id) => (
              <div className="row">
                <select id={id} className="input grow" value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">{t("Choose…", "Elige…")}</option>
                  {activeClients.map((c) => (
                    <option key={c.client._id} value={c.client._id}>
                      {c.client.fullName}
                    </option>
                  ))}
                </select>
                <Button icon="plus" aria-label={t("New client", "Nuevo cliente")} onClick={() => open({ kind: "client", afterCreate: (cid) => { setClient(cid); open({ kind: "loan", clientId: cid }); } })} />
              </div>
            )}
          </Field>
        </div>
        <Field label={t("Amount lent", "Monto prestado")} error={showErr(amount, tried) ?? (tried && termsProblem === "principal" ? t("Enter an amount greater than zero", "Escribe un monto mayor que cero") : null)} hint={t(`Available on that date: ${fmt.money(Math.max(available, 0))}`, `Disponible en esa fecha: ${fmt.money(Math.max(available, 0))}`)}>
          {(id) => (
            <div className="stack tight">
              <MoneyInput id={id} value={amount.text} onChange={setAmount} symbol={fmt.symbol} invalid={!!amount.error && tried} />
              {short > 0 && admin && app.mode === "online" && (
                <p className="short-cash">
                  {t(`${fmt.money(short)} more capital is needed on that date.`, `Faltan ${fmt.money(short)} de capital en esa fecha.`)}{" "}
                  <Button size="small" variant="primary" loading={busy} onClick={() => void save(short)}>
                    {existing ? t(`Save and add ${fmt.money(short)} of capital`, `Guardar y agregar ${fmt.money(short)} de capital`) : t(`Lend and add ${fmt.money(short)} of capital`, `Prestar y agregar ${fmt.money(short)} de capital`)}
                  </Button>
                </p>
              )}
            </div>
          )}
        </Field>
        <Field label={t("Loan date", "Fecha del préstamo")}>{(id) => <DateInput id={id} value={start} max={today} onChange={setStart} />}</Field>
        <div className="span2">
          <Field label={t("Type", "Tipo")} hint={`${methodSuits(t, method)} ${methodExplanation(t, method)}`}>
            {() => (
              <Segmented
                label={t("Type", "Tipo")}
                value={method}
                onChange={(m) => {
                  setMethod(m);
                  setRows(null);
                }}
                options={[
                  ["declining", t("Declining", "Decreciente")],
                  ["flat", t("Flat", "Fijo")],
                  ["interest_only", t("Interest only", "Solo interés")],
                ]}
              />
            )}
          </Field>
        </div>
        <Field label={t("Interest rate", "Tasa de interés")} error={showErr(rate, tried) ?? (termsProblem === "rate" ? t("The rate must be between 0% and 100% per period", "La tasa debe estar entre 0% y 100% por período") : null)}>
          {(id) => (
            <div className="stack tight">
              <RateInput id={id} value={rate.text} onChange={setRate} />
              <div className="chips">
                {RATE_PRESETS.map((r) => (
                  <button key={r} type="button" className={`chip ${rate.value === r ? "on" : ""}`} onClick={() => setRate(String(r / 10_000))}>
                    {ratePercentLabel(r)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Field>
        <Field label={t("Rate is per", "La tasa es por")}>
          {(id) => (
            <select id={id} className="input" value={period} onChange={(e) => setPeriod(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{frequencyLabel(t, f)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("Payments", "Pagos")}
          hint={rateConverts(pr) && rate.value !== null ? t(`${fmt.rate(rate.value)} ${frequencyPer(t, period)} = ${fmt.rate(effectiveRate(pr))} ${frequencyPer(t, frequency)} (30-day month)`, `${fmt.rate(rate.value)} ${frequencyPer(t, period)} = ${fmt.rate(effectiveRate(pr))} ${frequencyPer(t, frequency)} (mes de 30 días)`) : undefined}
        >
          {(id) => (
            <select id={id} className="input" value={frequency} onChange={(e) => { setFrequency(e.target.value as Frequency); setRows(null); }}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>{frequencyLabel(t, f)}</option>
              ))}
            </select>
          )}
        </Field>
        {hasInstallments(method) && (
          <>
            <Field label={t("Installments", "Cuotas")} error={tried && termsProblem === "installments" ? t("Enter between 1 and 1,000 installments", "Escribe entre 1 y 1,000 cuotas") : null}>
              {(id) => <input id={id} className="input money" inputMode="numeric" value={count} onChange={(e) => { setCount(e.target.value.replace(/\D/g, "")); setRows(null); }} />}
            </Field>
            <Field label={t("Late fee", "Cargo por mora")} hint={`${feeModeLabel(t, feeMode)}. ${feeModeHint(t, feeMode)}`} error={showErr(lateFee, tried)}>
              {(id) => <RateInput id={id} value={lateFee.text} onChange={setLateFee} />}
            </Field>
          </>
        )}
        <div className="span2">
          <Field
            label={t("Interest collected", "Interés cobrado")}
            hint={
              existing
                ? t("Which account each payment's interest goes to. A change applies to payments from today on. Late fees stay profit.", "A qué cuenta va el interés de cada pago. Un cambio aplica a los pagos de hoy en adelante. Las moras quedan como ganancia.")
                : t("Which account each payment's interest goes to. Late fees stay profit.", "A qué cuenta va el interés de cada pago. Las moras quedan como ganancia.")
            }
          >
            {() => <ReinvestPicker value={reinvest} onChange={setReinvest} label={t("Interest collected", "Interés cobrado")} />}
          </Field>
        </div>
        <div className="span2">
          <Field label={t("Notes", "Notas")}>{(id) => <textarea id={id} className="input" maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        {existing && (
          <div className="span2">
            <Field label={t("Reason for the change (kept in the history)", "Motivo del cambio (queda en el historial)")}>{(id) => <input id={id} className="input" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          </div>
        )}
      </div>

      {terms && !termsProblem && (
        <div className="preview" style={{ marginTop: 16 }}>
          {sentence && <p className="loan-sentence">{sentence}</p>}
          {hasInstallments(method) ? (
            <>
              <div className="row between" style={{ marginBottom: 8 }}>
                <strong>{t("Schedule", "Calendario")}</strong>
                {rows ? (
                  <Button size="small" variant="ghost" onClick={() => setRows(null)}>{t("Use the calculated schedule", "Usar el calendario calculado")}</Button>
                ) : (
                  <Button size="small" variant="ghost" icon="edit" onClick={() => setRows(toRows(proposed))}>{t("Edit schedule", "Editar calendario")}</Button>
                )}
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("Due", "Vence")}</th>
                      <th className="num">{t("Capital", "Capital")}</th>
                      <th className="num">{t("Interest", "Interés")}</th>
                      <th className="num">{t("Total", "Total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.slice(0, rows ? 1000 : 60).map((x, i) => (
                      <tr key={x.seq}>
                        <td>{x.seq}</td>
                        {rows ? (
                          <>
                            <td><input type="date" className="input" style={{ minWidth: 140 }} value={rows[i].due} min={addDays(start, 1)} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, due: e.target.value } : r)))} /></td>
                            <td><input className="input money" inputMode="decimal" style={{ minWidth: 100 }} value={rows[i].principal} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, principal: e.target.value } : r)))} /></td>
                            <td><input className="input money" inputMode="decimal" style={{ minWidth: 100 }} value={rows[i].interest} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, interest: e.target.value } : r)))} /></td>
                          </>
                        ) : (
                          <>
                            <td>{fmt.dayShort(x.due)}</td>
                            <td className="num">{fmt.money(x.principal)}</td>
                            <td className="num">{fmt.money(x.interest)}</td>
                          </>
                        )}
                        <td className="num">{x.principal >= 0 && x.interest >= 0 ? fmt.money(x.principal + x.interest) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows && schedule.length > 60 && <p className="micro muted">{t(`…and ${schedule.length - 60} more.`, `…y ${schedule.length - 60} más.`)}</p>}
              <dl className="kv" style={{ marginTop: 8 }}>
                <dt>{t("Total interest", "Interés total")}</dt>
                <dd>{fmt.money(schedule.reduce((a, x) => a + Math.max(x.interest, 0), 0))}</dd>
                <dt className="total">{t("Total to repay", "Total a pagar")}</dt>
                <dd className="total">{fmt.money(schedule.reduce((a, x) => a + Math.max(x.principal, 0) + Math.max(x.interest, 0), 0))}</dd>
              </dl>
              {scheduleProblem && (
                <div className="banner warn" style={{ marginTop: 8 }}>
                  <div className="grow">{scheduleErrorText(t, fmt, scheduleProblem)}</div>
                  {scheduleProblem.code === "unallocated" && rows && (
                    <Button size="small" onClick={() => setRows(rows.map((r, j) => (j === rows.length - 1 ? { ...r, principal: ((Math.max(edited![j].principal, 0) + diff) / 100).toFixed(2) } : r)))}>
                      {t("Put the difference on the last one", "Poner la diferencia en la última")}
                    </Button>
                  )}
                </div>
              )}
              {rows && existing && <p className="micro muted">{t("An edited schedule is stored as written and its interest is used as typed.", "Un calendario editado se guarda tal cual y su interés se usa como se escribió.")}</p>}
            </>
          ) : (
            <dl className="kv">
              <dt>{t("Interest per payment", "Interés por pago")}</dt>
              <dd>{fmt.money(periodInterest(pr, amount.value ?? 0))}</dd>
            </dl>
          )}
          {!hasInstallments(method) && rateConverts(pr) && <p className="micro muted">{methodLabel(t, method)}</p>}
        </div>
      )}
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
    </Sheet>
  );
}
