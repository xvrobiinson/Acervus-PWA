// Calendar (2026-11-10, roadmap item 52): what falls due when, by month or
// by week, with each day's total; a day opens its loans, to record a payment
// or send a reminder from there. Collectors see their own clients only (their
// books hold nothing else). Reads the schedules (src/lib/calendar.ts).

import { useMemo, useState } from "react";
import { addDays, type Day } from "../../shared/domain/dates";
import { useForms } from "../App";
import { calendarDays, dayTotals, monthGrid, weekOf, type DueState } from "../lib/calendar";
import { useT } from "../lib/i18n";
import { useBooks } from "../state/app";
import { Button, Card, Empty, Pill, Row, Segmented } from "../ui/kit";
import { Icon } from "../ui/icons";
import { WaClientButton } from "../ui/whatsapp";

type View = "month" | "week";

export function CalendarScreen() {
  const t = useT();
  const { books, fmt, today, can } = useBooks();
  const open = useForms();
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.innerWidth < 700 ? "week" : "month"));
  const [anchor, setAnchor] = useState<Day>(today);
  const [picked, setPicked] = useState<Day>(today);
  const grid = view === "month" ? monthGrid(anchor) : weekOf(anchor);
  const data = useMemo(() => calendarDays(books.loans, grid[0], grid[grid.length - 1], today), [books.loans, grid[0], grid[grid.length - 1], today]); // eslint-disable-line react-hooks/exhaustive-deps
  const locale = fmt.lang === "es" ? "es" : "en";
  const month = anchor.slice(0, 7);
  const title =
    view === "month"
      ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`))
      : `${fmt.dayShort(grid[0])} – ${fmt.dayShort(grid[6])}`;
  const weekdays = weekOf("2026-11-09").map((d) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`)));
  const step = (dir: 1 | -1) => {
    if (view === "week") return setAnchor(addDays(anchor, 7 * dir));
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + dir);
    setAnchor(d.toISOString().slice(0, 10));
  };
  // The period's totals, for the line under the title.
  const period = grid.filter((d) => view === "week" || d.slice(0, 7) === month).map((d) => dayTotals(data.get(d)));
  const dueLeft = period.reduce((a, x) => a + x.left, 0);
  const received = period.reduce((a, x) => a + x.paid, 0);
  const day = data.get(picked);
  const totals = dayTotals(day);
  const stateLabel: Record<DueState, string> = {
    paid: t("Paid", "Pagada"),
    partly: t("Partly paid", "Pago parcial"),
    late: t("Late", "Atrasada"),
    upcoming: t("Due", "Vence"),
  };
  const tone: Record<DueState, "pos" | "warn" | "neg" | undefined> = { paid: "pos", partly: "warn", late: "neg", upcoming: undefined };

  return (
    <div className="calendar">
      <div className="topbar page-head">
        <div className="grow">
          <h1>{t("Calendar", "Calendario")}</h1>
          <div className="small muted">
            {t(`${fmt.money(dueLeft)} still to collect · ${fmt.money(received)} received`, `${fmt.money(dueLeft)} por cobrar · ${fmt.money(received)} recibido`)}
          </div>
        </div>
        <Segmented
          label={t("View", "Vista")}
          value={view}
          onChange={setView}
          options={[
            ["month", t("Month", "Mes")],
            ["week", t("Week", "Semana")],
          ]}
        />
      </div>
      <div className="cal-layout">
        <Card className="cal-card">
          <div className="cal-head">
            <Button variant="ghost" size="small" icon="left" aria-label={t("Previous", "Anterior")} onClick={() => step(-1)} />
            <h2>{title}</h2>
            <Button variant="ghost" size="small" icon="right" aria-label={t("Next", "Siguiente")} onClick={() => step(1)} />
            <span className="grow" />
            <Button
              size="small"
              onClick={() => {
                setAnchor(today);
                setPicked(today);
              }}
            >
              {t("Today", "Hoy")}
            </Button>
          </div>
          <div className={`cal-grid ${view}`} role="grid" aria-label={title}>
            {weekdays.map((w) => (
              <div key={w} className="cal-wd" role="columnheader">
                {w}
              </div>
            ))}
            {grid.map((d) => {
              const x = data.get(d);
              const s = dayTotals(x);
              const out = view === "month" && d.slice(0, 7) !== month;
              const names = x?.due.slice(0, view === "week" ? 4 : 0) ?? [];
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-selected={d === picked}
                  className={["cal-day", out && "out", d === today && "today", d === picked && "picked", s.late && "late"].filter(Boolean).join(" ")}
                  onClick={() => setPicked(d)}
                >
                  <span className="cal-n">{Number(d.slice(8))}</span>
                  {s.due > 0 && <span className={`cal-amt num ${s.left === 0 ? "done" : ""}`}>{fmt.compact(s.left > 0 ? s.left : s.due)}</span>}
                  {s.paid > 0 && <span className="cal-paid num">+{fmt.compact(s.paid)}</span>}
                  {names.map((e) => (
                    <span key={e.loanId} className={`cal-who ${e.state}`}>
                      {e.client.split(/\s+/)[0]}
                    </span>
                  ))}
                  {view === "week" && x && x.due.length > names.length && <span className="cal-who more">+{x.due.length - names.length}</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-legend small muted">
            <span>
              <i className="dot late" /> {t("Something late", "Algo atrasado")}
            </span>
            <span>
              <i className="dot paid" /> {t("Received", "Recibido")}
            </span>
          </div>
        </Card>

        <Card title={fmt.day(picked)} className="cal-side" action={totals.due > 0 ? <span className="small muted num">{t(`${fmt.money(totals.left)} to collect`, `${fmt.money(totals.left)} por cobrar`)}</span> : null}>
          {!day ? (
            <Empty icon="calendar">{t("Nothing falls due and nothing was received this day.", "Nada vence y no se recibió nada este día.")}</Empty>
          ) : (
            <>
              {day.due.length > 0 && (
                <ul className="list ruled">
                  {day.due.map((e) => (
                    <Row
                      key={`${e.loanId}-${e.interest}`}
                      to={`/loans/${e.loanId}`}
                      title={e.client}
                      sub={
                        <>
                          {e.interest ? t(`Loan #${e.loanNo} · interest`, `Préstamo #${e.loanNo} · interés`) : t(`Loan #${e.loanNo} · installment`, `Préstamo #${e.loanNo} · cuota`)} · <Pill tone={tone[e.state]}>{stateLabel[e.state]}</Pill>
                        </>
                      }
                      trail={<span className={`amount num ${e.state === "late" ? "neg" : ""}`}>{fmt.money(e.left > 0 ? e.left : e.amount)}</span>}
                      aside={
                        e.left > 0 ? (
                          <span className="cal-acts">
                            {can("record") && (
                              <Button size="small" variant="ghost" icon="receipt" aria-label={t("Record payment", "Registrar pago")} title={t("Record payment", "Registrar pago")} onClick={() => open({ kind: "payment", loanId: e.loanId })} />
                            )}
                            <WaClientButton clientId={e.clientId} loanId={e.loanId} small />
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </ul>
              )}
              {day.paid.length > 0 && (
                <>
                  <div className="cal-sub">
                    <Icon name="check" /> {t("Received this day", "Recibido este día")}
                  </div>
                  <ul className="list ruled">
                    {day.paid.map((p) => (
                      <Row key={p.paymentId} to={`/loans/${p.loanId}`} title={p.client} sub={t(`Loan #${p.loanNo}`, `Préstamo #${p.loanNo}`)} trail={<span className="amount num pos">+{fmt.money(p.amount)}</span>} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
