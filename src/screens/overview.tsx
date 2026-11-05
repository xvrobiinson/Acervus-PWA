// Overview: where the money is and who owes it, before anything to do.
// Each person can arrange it (Customize): blocks and figures shown or
// hidden, in their order, half or full width. Kept on this device.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { addMonths, maxDay } from "../../shared/domain/dates";
import { firstActivity, gain, history, netInvested, realizedIncome } from "../../shared/domain/portfolio";
import { ratioLabel } from "../../shared/domain/money";
import { useT } from "../lib/i18n";
import { displayStatusLabel } from "../lib/labels";
import {
  defaultLayout,
  dropFigureOnto,
  dropOnto,
  layoutRows,
  nudge,
  nudgeFigure,
  parseLayout,
  setFigureShown,
  setHalf,
  setShown,
  sizable,
  type Block,
  type Figure,
  type OverviewLayout,
} from "../lib/overview-layout";
import { needsAttention } from "../state/books";
import { PERIODS, interestIn, spans, type Period } from "../lib/periods";
import { useApp, useBooks } from "../state/app";
import { GrowthChart } from "../ui/chart";
import { Avatar, Banner, Button, Card, Empty, LinkButton, Pill, Row, Segmented, Stat } from "../ui/kit";
import { Icon } from "../ui/icons";
import { useFlip } from "../ui/motion";
import type { Fmt } from "../lib/format";

const fmtMoney = (fmt: Fmt, v: number) => fmt.money(v);
import { pendingStatus } from "./collect";
import { statusTone } from "./loans";

/** The person's arrangement on this device, and a way to change it. */
function useOverviewLayout(userId: string | undefined) {
  const key = `acervus.overview.${userId ?? "anon"}`;
  const read = () => {
    try {
      return parseLayout(localStorage.getItem(key));
    } catch {
      return defaultLayout();
    }
  };
  const [layout, setLayout] = useState(read);
  // Another person signed in on this device: their own arrangement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setLayout(read()), [key]);
  const save = (l: OverviewLayout) => {
    setLayout(l);
    try {
      localStorage.setItem(key, JSON.stringify(l));
    } catch {
      // Storage full or blocked: it still applies until the app closes.
    }
  };
  return [layout, save] as const;
}

/** The period Interest earned shows, kept on this device per person. */
function useStoredPeriod(userId: string | undefined) {
  const key = `acervus.interestPeriod.${userId ?? "anon"}`;
  const read = (): Period => {
    try {
      const v = localStorage.getItem(key) as Period | null;
      return v && PERIODS.includes(v) ? v : "month";
    } catch {
      return "month";
    }
  };
  const [period, set] = useState(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => set(read()), [key]);
  const save = (p: Period) => {
    set(p);
    try {
      localStorage.setItem(key, p);
    } catch {
      // Still applies until the app closes.
    }
  };
  return [period, save] as const;
}

/** The small calendar button by Interest earned's title: a menu of periods. */
function PeriodPicker({ value, names, onChange }: { value: Period; names: Record<Period, string>; onChange: (p: Period) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const label = t("Choose the period", "Elegir el período");
  return (
    <span className="period-pick" ref={box}>
      <button type="button" className={`period-btn ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name="calendar" />
      </button>
      {open && (
        <span className="period-menu" role="menu">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === value}
              className={p === value ? "on" : ""}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              {names[p]}
              {p === value && <Icon name="check" />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

/** What is being dragged while arranging. */
type Dragged = { kind: "block"; id: Block } | { kind: "figure"; id: Figure };

export function OverviewScreen() {
  const t = useT();
  const { books, fmt, snapshot, today, can, role } = useBooks();
  const { user } = useApp();
  const admin = can("manage");
  const s = books.summary;
  const [range, setRange] = useState<"3" | "6" | "12" | "all">("6");
  const points = useMemo(() => {
    const first = firstActivity(books.book);
    if (!first) return [];
    const from = range === "all" ? first : maxDay(first, addMonths(today, -Number(range)));
    return history(books.book, from, today);
  }, [books.book, today, range]);
  const attention = needsAttention(books).slice(0, 8);
  const recent = [...snapshot.payments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const collector = role === "collector";
  const waiting = snapshot.pending.filter((p) => p.status === "waiting");
  const waitingSum = waiting.reduce((a, p) => a + p.amount, 0);
  // A collector's own payments, waiting or decided, newest first.
  const mine = [...snapshot.pending].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const ret = ratioLabel(gain(s), netInvested(s));
  const [period, setPeriod] = useStoredPeriod(user?.id);
  const span = spans(period, today);

  // Arranging: what this person may see, in their order.
  const [layout, saveLayout] = useOverviewLayout(user?.id);
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const dragged = useRef<Dragged | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const flip = useFlip(box, `${JSON.stringify(layout)}|${editing}`);
  const edit = (next: OverviewLayout) => {
    flip.capture();
    saveLayout(next);
  };
  const arrange = (on: boolean) => {
    flip.capture();
    setEditing(on);
  };
  const allowedBlocks: Block[] = ["figures", ...(admin ? (["growth"] as Block[]) : []), "attention", collector ? "mine" : "recent"];
  const allowedFigures: Figure[] = admin
    ? ["portfolio", "availableCapital", "availableInterest", "lentOut", "interestEarned", "overdue", "receivable"]
    : ["active", "overdue", "receivable", ...(collector ? (["toConfirm"] as Figure[]) : [])];
  const blockLabel: Record<Block, string> = {
    figures: t("Key figures", "Cifras clave"),
    growth: t("Growth", "Crecimiento"),
    attention: t("Needs attention", "Requiere atención"),
    mine: t("My recent payments", "Mis cobros recientes"),
    recent: t("Recent payments", "Pagos recientes"),
  };

  const overdue = (caption: string, lead: boolean) => (
    <Stat
      lead={lead}
      icon="alert"
      hue={s.overdueAmount > 0 ? "neg" : "neutral"}
      label={t("Overdue", "Atrasado")}
      value={fmt.money(s.overdueAmount)}
      count={{ value: s.overdueAmount, format: fmt.money }}
      tone={s.overdueAmount > 0 ? "neg" : undefined}
      caption={caption}
    />
  );
  // Each figure; the first one shown is the lead (bigger, full width).
  const figure = (f: Figure, lead: boolean): { label: string; el: ReactNode } => {
    switch (f) {
      case "portfolio":
        return {
          label: t("Portfolio value", "Valor del portafolio"),
          el: (
            <Stat
              lead={lead}
              icon="wallet"
              label={t("Portfolio value", "Valor del portafolio")}
              value={fmt.money(s.portfolioValue)}
              count={{ value: s.portfolioValue, format: fmt.money }}
              caption={
                <span className={gain(s) >= 0 ? "pos" : "neg"}>
                  {fmt.signed(gain(s))} {ret ? `(${ret})` : ""} · {t("on capital invested", "sobre capital invertido")}
                </span>
              }
            />
          ),
        };
      case "availableCapital":
        return {
          label: t("Available capital", "Capital disponible"),
          el: <Stat lead={lead} icon="briefcase" label={t("Available capital", "Capital disponible")} value={fmt.money(s.availableCapital)} count={{ value: s.availableCapital, format: fmt.money }} />,
        };
      case "availableInterest":
        return {
          label: t("Available interest", "Interés disponible"),
          el: <Stat lead={lead} icon="receipt" hue="pos" label={t("Available interest", "Interés disponible")} value={fmt.money(s.availableInterest)} count={{ value: s.availableInterest, format: fmt.money }} />,
        };
      case "lentOut":
        return {
          label: t("Capital lent out", "Capital prestado"),
          el: (
            <Stat
              lead={lead}
              icon="loans"
              hue="info"
              label={t("Capital lent out", "Capital prestado")}
              value={fmt.money(s.outstandingPrincipal)}
              count={{ value: s.outstandingPrincipal, format: fmt.money }}
              caption={t(`${s.activeLoans} active loans`, `${s.activeLoans} préstamos activos`)}
            />
          ),
        };
      case "interestEarned": {
        const now = span ? interestIn(books.book, span.now) : realizedIncome(s);
        const before = span ? interestIn(books.book, span.before) : 0;
        const diff = now - before;
        const pct = before > 0 ? ` (${diff >= 0 ? "+" : ""}${((diff / before) * 100).toFixed(1)}%)` : "";
        const versus: Record<Period, string> = {
          day: t("vs yesterday", "vs ayer"),
          week: t("vs last week", "vs la semana pasada"),
          month: t("vs last month", "vs el mes pasado"),
          year: t("vs last year", "vs el año pasado"),
          all: "",
        };
        const named: Record<Period, string> = {
          day: t("Today", "Hoy"),
          week: t("This week", "Esta semana"),
          month: t("This month", "Este mes"),
          year: t("This year", "Este año"),
          all: t("All time", "Todo el tiempo"),
        };
        return {
          label: t("Interest earned", "Interés cobrado"),
          el: (
            <Stat
              lead={lead}
              icon="chart"
              hue="pos"
              label={t("Interest earned", "Interés cobrado")}
              value={fmt.money(now)}
              count={{ value: now, format: fmt.money }}
              action={
                editing ? undefined : (
                  <PeriodPicker value={period} names={named} onChange={setPeriod} />
                )
              }
              above={named[period]}
              caption={
                span ? (
                  <>
                    <span className={diff > 0 ? "pos" : diff < 0 ? "neg" : ""}>
                      {fmt.signed(diff)}
                      {pct}
                    </span>{" "}
                    {versus[period]}
                  </>
                ) : (
                  t(`${fmt.money(s.expectedMonthlyInterest)} expected a month`, `${fmt.money(s.expectedMonthlyInterest)} esperados al mes`)
                )
              }
            />
          ),
        };
      }
      case "active":
        return {
          label: t("Active loans", "Préstamos activos"),
          el: (
            <Stat
              lead={lead}
              icon="loans"
              label={t("Active loans", "Préstamos activos")}
              value={String(s.activeLoans)}
              count={{ value: s.activeLoans, format: String }}
              caption={t(`${s.dueSoonLoans} due soon`, `${s.dueSoonLoans} vencen pronto`)}
            />
          ),
        };
      case "overdue":
        return {
          label: t("Overdue", "Atrasado"),
          el: overdue(
            admin
              ? t(`${s.overdueLoans} loans · ${s.dueSoonLoans} due soon`, `${s.overdueLoans} préstamos · ${s.dueSoonLoans} vencen pronto`)
              : t(`${s.overdueLoans} loans`, `${s.overdueLoans} préstamos`),
            lead,
          ),
        };
      case "receivable":
        return {
          label: t("Receivable", "Por cobrar"),
          el: (
            <Stat
              lead={lead}
              icon="clock"
              hue="info"
              label={t("Receivable", "Por cobrar")}
              value={fmt.money(s.interestReceivable + s.feesReceivable)}
              count={{ value: s.interestReceivable + s.feesReceivable, format: fmt.money }}
              caption={t("Interest and late fees due, unpaid", "Interés y mora vencidos sin pagar")}
            />
          ),
        };
      case "toConfirm":
        return {
          label: t("To confirm", "Por confirmar"),
          el: (
            <Stat
              lead={lead}
              icon="wallet"
              hue={waiting.length > 0 ? "warn" : "neutral"}
              label={t("To confirm", "Por confirmar")}
              value={fmt.money(waitingSum)}
              count={{ value: waitingSum, format: fmt.money }}
              caption={t(`${waiting.length} payment(s) waiting for the office`, `${waiting.length} pago(s) esperando a la oficina`)}
            />
          ),
        };
    }
  };

  // Dragging with a mouse; on touch screens the arrows do the moving.
  const dragProps = (d: Dragged) =>
    editing
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            dragged.current = d;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", d.id);
          },
          onDragEnd: () => {
            dragged.current = null;
            setOver(null);
          },
        }
      : {};
  const dropProps = (d: Dragged) =>
    editing
      ? {
          onDragOver: (e: DragEvent) => {
            const g = dragged.current;
            if (!g || g.kind !== d.kind || g.id === d.id) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(`${d.kind}-${d.id}`);
          },
          onDragLeave: () => setOver((o) => (o === `${d.kind}-${d.id}` ? null : o)),
          onDrop: (e: DragEvent) => {
            const g = dragged.current;
            if (!g || g.kind !== d.kind || g.id === d.id) return;
            e.preventDefault();
            e.stopPropagation();
            setOver(null);
            edit(g.kind === "block" ? dropOnto(layout, g.id, d.id as Block) : dropFigureOnto(layout, g.id, d.id as Figure));
          },
        }
      : {};

  const figures = () => {
    const order = layout.figures.filter((f) => allowedFigures.includes(f) && (editing || !layout.hiddenFigures.includes(f)));
    const shownOrder = order.filter((f) => !layout.hiddenFigures.includes(f));
    if (order.length === 0) return null;
    return (
      <Card>
        <div className={`stats ${editing ? "arranging" : ""}`}>
          {order.map((f, i) => {
            const hidden = layout.hiddenFigures.includes(f);
            const lead = f === shownOrder[0];
            const { label, el } = figure(f, lead);
            return (
              <div
                key={f}
                data-flip={`f-${f}`}
                className={`stat-cell ${lead ? "lead" : ""} ${hidden ? "off" : ""} ${over === `figure-${f}` ? "drop" : ""}`}
                {...dragProps({ kind: "figure", id: f })}
                {...dropProps({ kind: "figure", id: f })}
              >
                {el}
                {editing && (
                  <div className="stat-tools">
                    <Button
                      variant="ghost"
                      size="small"
                      icon="left"
                      aria-label={t(`Move ${label} earlier`, `Mover ${label} antes`)}
                      disabled={i === 0}
                      onClick={() => edit(nudgeFigure(layout, f, -1, allowedFigures))}
                    />
                    <Button
                      variant="ghost"
                      size="small"
                      icon="right"
                      aria-label={t(`Move ${label} later`, `Mover ${label} después`)}
                      disabled={i === order.length - 1}
                      onClick={() => edit(nudgeFigure(layout, f, 1, allowedFigures))}
                    />
                    <Button
                      variant="ghost"
                      size="small"
                      icon={hidden ? "eye" : "eyeOff"}
                      aria-label={hidden ? t(`Show ${label}`, `Mostrar ${label}`) : t(`Hide ${label}`, `Ocultar ${label}`)}
                      onClick={() => edit(setFigureShown(layout, f, hidden))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  const growth = () => (
    <Card
      title={t("Growth", "Crecimiento")}
      action={
        <div style={{ width: 200 }}>
          <Segmented
            label={t("Range", "Rango")}
            value={range}
            onChange={setRange}
            options={[
              ["3", "3M"],
              ["6", "6M"],
              ["12", t("1Y", "1A")],
              ["all", t("All", "Todo")],
            ]}
          />
        </div>
      }
    >
      <div className="card-body">
        {points.length > 1 ? (
          <>
            <GrowthChart points={points} fmt={fmt} label={t("Portfolio value over time", "Valor del portafolio en el tiempo")} />
            <p className="micro muted">{t("Solid: portfolio value. Dashed: capital invested.", "Línea continua: valor del portafolio. Discontinua: capital invertido.")}</p>
          </>
        ) : (
          <Empty icon="chart">{t("The chart appears once there is activity on more than one day.", "El gráfico aparece cuando hay actividad en más de un día.")}</Empty>
        )}
      </div>
    </Card>
  );

  const attentionList = () => (
    <Section
      title={t("Needs attention", "Requiere atención")}
      count={attention.length > 0 ? t(`${attention.length} loans`, `${attention.length} préstamos`) : undefined}
      action={<LinkButton to="/loans" size="small" variant="ghost">{t("All loans", "Préstamos")}</LinkButton>}
    >
      {attention.length === 0 ? (
        <Card>
          <Empty icon="check">{t("Nothing overdue or due in the next 5 days.", "Nada atrasado ni por vencer en los próximos 5 días.")}</Empty>
        </Card>
      ) : (
        <ul className="list boxed">
          {attention.map((l) => (
            <Row
              key={l.loan._id}
              to={`/loans/${l.loan._id}`}
              lead={<Avatar name={l.client?.fullName ?? "?"} />}
              title={l.client?.fullName ?? "—"}
              sub={
                l.display === "overdue"
                  ? t(`${l.delinquency.daysOverdue} days overdue`, `${l.delinquency.daysOverdue} días de atraso`)
                  : l.delinquency.nextDue
                    ? t(`Due ${fmt.dayShort(l.delinquency.nextDue)}`, `Vence ${fmt.dayShort(l.delinquency.nextDue)}`)
                    : ""
              }
              trail={
                <>
                  <span className="amount num">{fmt.money(l.display === "overdue" ? l.delinquency.overdueAmount : l.delinquency.nextDueAmount)}</span>
                  <Pill tone={statusTone(l.display)}>{displayStatusLabel(t, l.display)}</Pill>
                </>
              }
            />
          ))}
        </ul>
      )}
    </Section>
  );

  const mineList = () => (
    <Section title={t("My recent payments", "Mis cobros recientes")}>
      {mine.length === 0 ? (
        <Card>
          <Empty icon="receipt">{t("Payments you collect show here until the office confirms them.", "Los cobros que hagas aparecen aquí hasta que la oficina los confirme.")}</Empty>
        </Card>
      ) : (
        <ul className="list boxed">
          {mine.map((p) => {
            const st = pendingStatus(t, p);
            const l = books.loanById.get(p.loanId);
            return (
              <Row
                key={p._id}
                to={`/loans/${p.loanId}`}
                lead={<Avatar name={l?.client?.fullName ?? "?"} />}
                title={l?.client?.fullName ?? "—"}
                sub={p.status === "rejected" ? `${fmt.dayShort(p.paidOn)} · “${p.reason}”` : fmt.dayShort(p.paidOn)}
                trail={
                  <>
                    <span className="amount num">{fmt.money(p.amount)}</span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </>
                }
              />
            );
          })}
        </ul>
      )}
    </Section>
  );

  const recentList = () => (
    <Section title={t("Recent payments", "Pagos recientes")} action={admin && <LinkButton to="/money" size="small" variant="ghost">{t("Money", "Dinero")}</LinkButton>}>
      {recent.length === 0 ? (
        <Card>
          <Empty icon="receipt">{t("No payments yet.", "Aún no hay pagos.")}</Empty>
        </Card>
      ) : (
        <ul className="list boxed">
          {recent.map((p) => {
            const l = books.loanById.get(p.loanId);
            return (
              <Row
                key={p._id}
                to={`/loans/${p.loanId}`}
                lead={<Avatar name={l?.client?.fullName ?? "?"} />}
                title={l?.client?.fullName ?? "—"}
                sub={`${fmt.dayShort(p.paidOn)} · ${t("interest", "interés")} ${fmt.money(p.interest)} · ${t("capital", "capital")} ${fmt.money(p.principal)}`}
                trail={<span className="amount num pos">{fmt.money(p.amount)}</span>}
              />
            );
          })}
        </ul>
      )}
    </Section>
  );

  const content: Record<Block, () => ReactNode> = { figures, growth, attention: attentionList, mine: mineList, recent: recentList };
  const shownBlocks = layout.blocks.filter((b) => allowedBlocks.includes(b) && !layout.hidden.includes(b));

  // A block; while arranging, framed with a bar to drag it by, arrows,
  // Half/Full and Hide.
  const block = (b: Block) => {
    const at = shownBlocks.indexOf(b);
    const label = blockLabel[b];
    return (
      <div
        key={b}
        data-flip={`b-${b}`}
        className={`ov-block ${editing ? "framed" : ""} ${over === `block-${b}` ? "drop" : ""}`}
        {...dropProps({ kind: "block", id: b })}
      >
        {editing && (
          <div className="ov-bar">
            <span className="ov-grip" {...dragProps({ kind: "block", id: b })}>
              <Icon name="grip" />
              <span className="ellipsis">{label}</span>
            </span>
            <Button variant="ghost" size="small" icon="up" aria-label={t(`Move ${label} up`, `Subir ${label}`)} disabled={at === 0} onClick={() => edit(nudge(layout, b, -1, allowedBlocks))} />
            <Button
              variant="ghost"
              size="small"
              icon="down"
              aria-label={t(`Move ${label} down`, `Bajar ${label}`)}
              disabled={at === shownBlocks.length - 1}
              onClick={() => edit(nudge(layout, b, 1, allowedBlocks))}
            />
            {sizable(b) && (
              <span className="ov-size">
                <Segmented
                  label={t(`Width of ${label}`, `Ancho de ${label}`)}
                  value={layout.half.includes(b) ? "half" : "full"}
                  onChange={(v) => edit(setHalf(layout, b, v === "half"))}
                  options={[
                    ["half", t("Half", "Mitad")],
                    ["full", t("Full", "Completo")],
                  ]}
                />
              </span>
            )}
            <Button variant="ghost" size="small" icon="eyeOff" aria-label={t(`Hide ${label}`, `Ocultar ${label}`)} onClick={() => edit(setShown(layout, b, false))} />
          </div>
        )}
        {content[b]()}
      </div>
    );
  };

  const rows = layoutRows(layout, allowedBlocks);
  // A finger can't drag here; the hint says so.
  const touch = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  const hiddenBlocks = allowedBlocks.filter((b) => layout.hidden.includes(b));
  return (
    <div>
      <div className="topbar">
        <div className="grow">
          <h1>{greeting(t)}</h1>
          <div className="small muted ellipsis">{snapshot.business.name}</div>
        </div>
      </div>
      {editing && (
        <div className="ov-editbar">
          <Icon name="sliders" />
          <span className="grow">
            <b>{t("Arranging your Overview.", "Organizando tu Resumen.")}</b>{" "}
            {touch
              ? t("Use the buttons on each block and figure to move or hide it.", "Usa los botones de cada bloque y cifra para moverlo u ocultarlo.")
              : t("Drag a block by its bar, or use the buttons on each one.", "Arrastra un bloque por su barra o usa los botones de cada uno.")}
          </span>
          <Button size="small" onClick={() => edit(defaultLayout())}>
            {t("Reset", "Restablecer")}
          </Button>
          <Button size="small" variant="primary" icon="check" onClick={() => arrange(false)}>
            {t("Done", "Listo")}
          </Button>
        </div>
      )}
      {!collector && waiting.length > 0 && (
        <Banner tone="warn" icon="wallet" action={<LinkButton to="/confirm" size="small" variant="primary">{t("Review", "Revisar")}</LinkButton>}>
          {t(
            `${waiting.length} payment(s) collected, ${fmtMoney(fmt, waitingSum)}, wait for you to confirm the money reached you.`,
            `${waiting.length} pago(s) cobrado(s), ${fmtMoney(fmt, waitingSum)}, esperan que confirmes que el dinero te llegó.`,
          )}
        </Banner>
      )}
      <div ref={box} className="ov-blocks">
        {rows.map((row) =>
          row.length === 2 ? (
            <div key={row.join("+")} className="ov-pair" style={{ "--cols": row.map((b) => (b === "growth" ? "2fr" : "1fr")).join(" ") } as CSSProperties}>
              {row.map(block)}
            </div>
          ) : (
            block(row[0])
          ),
        )}
        {editing && hiddenBlocks.length > 0 && (
          <div className="ov-tray">
            <Icon name="eyeOff" />
            <span>{t("Hidden from your Overview:", "Ocultos en tu Resumen:")}</span>
            {hiddenBlocks.map((b) => (
              <Button key={b} size="small" icon="plus" onClick={() => edit(setShown(layout, b, true))}>
                {blockLabel[b]}
              </Button>
            ))}
          </div>
        )}
      </div>
      {!editing && (
        <div className="ov-arrange">
          <button type="button" onClick={() => arrange(true)}>
            <Icon name="sliders" />
            {t("Arrange this Overview", "Organizar este Resumen")}
          </button>
        </div>
      )}
    </div>
  );
}

/** A list that stands on the page: a heading, an optional count pill and
 *  one action, over rows that are each their own small card. */
function Section({ title, count, action, children }: { title: string; count?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section-list">
      <div className="section-head">
        <h2>{title}</h2>
        {count && <Pill tone="accent">{count}</Pill>}
        <span className="spacer" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** The Overview title: a greeting for the time of day. */
function greeting(t: (en: string, es: string) => string): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t("Good morning", "Buenos días");
  if (h >= 12 && h < 18) return t("Good afternoon", "Buenas tardes");
  return t("Good evening", "Buenas noches");
}
