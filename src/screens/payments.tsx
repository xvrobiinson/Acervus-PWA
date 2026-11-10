// Payments: every payment received, newest first, with a period and a
// search by client or loan number, the count and the total; and (for the
// office) the To confirm tab with what collectors brought in. Each row opens
// its loan.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { addMonths, monthStart } from "../../shared/domain/dates";
import { useT } from "../lib/i18n";
import { paidWithLabel } from "../lib/labels";
import { useBooks } from "../state/app";
import { Avatar, Empty, FilterPill, Segmented, TabsPill } from "../ui/kit";
import { WaReceiptButton } from "../ui/whatsapp";
import { ConfirmScreen } from "./collect";

type Range = "month" | "3m" | "year" | "all";

export function PaymentsScreen() {
  const t = useT();
  const { snapshot, books, fmt, today, role, user } = useBooks();
  const nameOf = (id: string) => (id === user?.id ? t("You", "Tú") : (snapshot.people.find((p) => p.userId === id)?.name ?? "—"));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const office = role !== "collector";
  const tab = office && params.get("tab") === "confirm" ? "confirm" : "all";
  const waiting = snapshot.pending.filter((p) => p.status === "waiting").length;
  const [range, setRange] = useState<Range>("3m");
  const [q, setQ] = useState("");
  const from = range === "month" ? monthStart(today) : range === "3m" ? addMonths(today, -3) : range === "year" ? `${today.slice(0, 4)}-01-01` : "";
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, "");
    return snapshot.payments
      .filter((p) => (!from || p.paidOn >= from) && p.paidOn <= today)
      .map((p) => ({ p, l: books.loanById.get(p.loanId) }))
      .filter(({ l }) => !s || (l?.client?.fullName ?? "").toLowerCase().includes(s) || String(l?.loan.recordNo ?? "") === s)
      .sort((a, b) => (a.p.paidOn < b.p.paidOn ? 1 : a.p.paidOn > b.p.paidOn ? -1 : b.p.recordNo - a.p.recordNo));
  }, [snapshot.payments, books, from, today, q]);
  const total = rows.reduce((a, r) => a + r.p.amount, 0);
  const show = (next: "all" | "confirm") => setParams(next === "confirm" ? { tab: "confirm" } : {}, { replace: true });
  return (
    <div>
      <div className="topbar page-head">
        <div className="grow">
          <h1>{t("Payments", "Pagos")}</h1>
          {tab === "all" && (
            <div className="small muted">
              {t(`${rows.length} payment(s) · ${fmt.money(total)}`, `${rows.length} pago(s) · ${fmt.money(total)}`)}
            </div>
          )}
        </div>
        {office && (
          <TabsPill
            label={t("Payments", "Pagos")}
            value={tab}
            onChange={show}
            options={[
              ["all", t("All payments", "Todos los pagos")],
              ["confirm", t("To confirm", "Por confirmar"), waiting],
            ]}
          />
        )}
      </div>
      {tab === "confirm" ? (
        <ConfirmScreen embedded />
      ) : (
        <>
          <div className="page-tools">
            <FilterPill value={q} onChange={setQ} placeholder={t("Client or loan number", "Cliente o número de préstamo")} label={t("Filter payments", "Filtrar pagos")} />
            <Segmented
              label={t("Period", "Período")}
              value={range}
              onChange={setRange}
              options={[
                ["month", t("This month", "Este mes")],
                ["3m", t("3 months", "3 meses")],
                ["year", t("This year", "Este año")],
                ["all", t("All", "Todo")],
              ]}
            />
          </div>
          {rows.length === 0 ? (
            <div className="tbl-wrap">
              <Empty icon="receipt">{q.trim() ? t("No payments match.", "Ningún pago coincide.") : t("No payments in this period.", "No hay pagos en este período.")}</Empty>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("Date", "Fecha")}</th>
                    <th>{t("Client", "Cliente")}</th>
                    <th>{t("Loan", "Préstamo")}</th>
                    <th className="wide-only">{t("Paid with", "Pagado con")}</th>
                    <th className="wide-only">{t("Recorded by", "Registrado por")}</th>
                    <th className="num">{t("Amount", "Monto")}</th>
                    <th className="act" aria-label={t("Receipt", "Recibo")} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ p, l }) => (
                    <tr key={p._id} className="link" tabIndex={0} onClick={() => navigate(`/loans/${p.loanId}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/loans/${p.loanId}`)}>
                      <td className="muted nowrap">{fmt.dayShort(p.paidOn)}</td>
                      <td>
                        <span className="cell-who">
                          <Avatar name={l?.client?.fullName ?? "?"} />
                          <span className="ellipsis">{l?.client?.fullName ?? "—"}</span>
                        </span>
                      </td>
                      <td className="muted">#{l?.loan.recordNo ?? "—"}</td>
                      <td className="wide-only">{p.paidWith ? paidWithLabel(t, p.paidWith) : "—"}</td>
                      <td className="wide-only muted">{nameOf(p.createdBy)}</td>
                      <td className="num pos strong">+{fmt.money(p.amount)}</td>
                      <td className="act">
                        <WaReceiptButton payment={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
