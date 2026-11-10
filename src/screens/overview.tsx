// Overview: the hero's four figures (each person chooses them), then on the
// panel the growth chart beside where the money is, and the loans that need
// attention beside the latest payments. Each person can arrange the blocks
// (shown or hidden, in their order, half or full width), kept on this device;
// the figures and Interest earned's period follow the person to every device.

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { addDays, addMonths, maxDay, monthStart } from "../../shared/domain/dates";
import { firstActivity, history, netInvested, realizedIncome } from "../../shared/domain/portfolio";
import { ratioLabel } from "../../shared/domain/money";
import { useForms } from "../App";
import { useT } from "../lib/i18n";
import { SixFigures } from "./six-figures";
import { markSent, reminderKey, reminders as remindersFor, reminderText, sentToday, waLink } from "../lib/whatsapp";
import { allowedFigures, defaultHero, parseHero, ROW_ONLY, setPick, shownSlots, type HeroFigure, type HeroLayout, type HeroRole, type Pick } from "../lib/hero-layout";
import { defaultLayout, dropOnto, layoutRows, nudge, parseLayout, setHalf, setShown, type Block, type OverviewLayout } from "../lib/overview-layout";
import { needsAttention } from "../state/books";
import { PERIODS, interestIn, spans, type Period } from "../lib/periods";
import { useApp, useBooks } from "../state/app";
import { GrowthChart } from "../ui/chart";
import { InHero } from "../ui/hero";
import { Avatar, Banner, Button, Card, Empty, LinkButton, Pill, Row, Segmented } from "../ui/kit";
import { Icon } from "../ui/icons";
import { WaLogo, WaReceiptButton } from "../ui/whatsapp";
import { useFlip } from "../ui/motion";
import type { Fmt } from "../lib/format";
import { pendingStatus } from "./collect";
import { StatusPill } from "./loans";

/** A value kept on this device per person (JSON), with a way to change it. */
function useStored<T>(key: string, parse: (text: string | null) => T) {
  const read = () => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  };
  const [value, setValue] = useState(read);
  // Another person signed in on this device: their own.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setValue(read()), [key]);
  const save = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v));
    } catch {
      // Storage full or blocked: it still applies until the app closes.
    }
  };
  return [value, save] as const;
}

/** A choice that follows the person to every device (convex/prefs.ts),
 *  with this device's copy for offline and the demo. A copy made before
 *  the account kept it goes up the first time. */
function useAccountPref<T>(field: "hero" | "interestPeriod", localKey: string, parse: (text: string | null) => T, text: (v: T) => string) {
  const { mode } = useApp();
  const online = mode === "online";
  const remote = useQuery(api.prefs.mine, online ? {} : "skip");
  const send = useMutation(api.prefs.save);
  const [value, saveLocal] = useStored<T>(localKey, parse);
  const saved = remote?.[field];
  const hadLocal = useRef(true);
  useEffect(() => {
    if (remote === undefined) return;
    if (saved != null) {
      if (saved !== text(value)) saveLocal(parse(saved));
    } else if (hadLocal.current) {
      try {
        if (localStorage.getItem(localKey) !== null) void send({ [field]: text(value) }).catch(() => {});
      } catch {
        /* nothing to carry up */
      }
    }
    hadLocal.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, remote === undefined]);
  const save = (v: T) => {
    saveLocal(v);
    // Offline the device keeps it; the next change online carries it up.
    if (online) void send({ [field]: text(v) }).catch(() => {});
  };
  return [value, save] as const;
}

/** Closes on Escape or a click elsewhere. */
function usePopover() {
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
  return { open, setOpen, box };
}

/** The small faint calendar by Interest earned's title: a menu of periods. */
function PeriodPicker({ value, names, onChange }: { value: Period; names: Record<Period, string>; onChange: (p: Period) => void }) {
  const t = useT();
  const { open, setOpen, box } = usePopover();
  const label = `${t("Choose the period", "Elegir el período")} (${names[value]})`;
  return (
    <span className="period-pick" ref={box}>
      <button type="button" className={`period-btn ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={names[value]} onClick={() => setOpen(!open)}>
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

/** An amount as the hero shows it: the decimals faded. */
function Amount({ text }: { text: string }) {
  const m = /^(.*?)([.,]\d{2})(\D*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <span className="dec">{m[2]}</span>
      {m[3]}
    </>
  );
}

interface FigureValue {
  label: string;
  /** What the figure shows. */
  text: string;
  /** Shown in red (overdue). */
  bad?: boolean;
  good?: boolean;
  /** Beside the label (Interest earned's period). */
  action?: ReactNode;
}

/** What is being dragged while arranging. */
type Dragged = Block;

export function OverviewScreen() {
  const t = useT();
  const { books, fmt, snapshot, today, can, role, business } = useBooks();
  const { user, mode } = useApp();
  const open = useForms();
  const admin = can("manage");
  const s = books.summary;
  const heroRole: HeroRole = role ?? "viewer";
  const [range, setRange] = useState<"1" | "3" | "6" | "12" | "all">("6");
  const points = useMemo(() => {
    const first = firstActivity(books.book);
    if (!first) return [];
    const from = range === "all" ? first : maxDay(first, addMonths(today, -Number(range)));
    return history(books.book, from, today);
  }, [books.book, today, range]);
  const attention = needsAttention(books).slice(0, 6);
  const recent = [...snapshot.payments].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const collector = role === "collector";
  const waiting = snapshot.pending.filter((p) => p.status === "waiting");
  const waitingSum = waiting.reduce((a, p) => a + p.amount, 0);
  // A collector's own payments, waiting or decided, newest first.
  const mine = [...snapshot.pending].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const [period, setPeriod] = useAccountPref<Period>("interestPeriod", `acervus.interestPeriod.${user?.id ?? "anon"}`, (v) => (v && PERIODS.includes(v as Period) ? (v as Period) : "month"), (p) => p);
  const [hero, saveHero] = useAccountPref<HeroLayout>("hero", `acervus.hero.${user?.id ?? "anon"}`, (v) => parseHero(v, heroRole), (l) => JSON.stringify(l));
  const layoutHero = useMemo(() => parseHero(hero, heroRole), [hero, heroRole]);
  const [figAt, setFigAt] = useState(0);

  // ----- the figures -----
  const periodPicker = (named: Record<Period, string>) => <PeriodPicker value={period} names={named} onChange={setPeriod} />;
  const values = useMemo(() => {
    const named: Record<Period, string> = {
      day: t("Today", "Hoy"),
      week: t("This week", "Esta semana"),
      month: t("This month", "Este mes"),
      year: t("This year", "Este año"),
      all: t("All time", "Todo el tiempo"),
    };
    const span = spans(period, today);
    const earned = span ? interestIn(books.book, span.now) : realizedIncome(s);
    const soon = addDays(today, 7);
    const due7 = books.loans.filter((l) => l.delinquency.nextDue && l.delinquency.nextDue >= today && l.delinquency.nextDue <= soon).reduce((a, l) => a + l.delinquency.nextDueAmount, 0);
    const month = monthStart(today);
    const collected = snapshot.payments.filter((p) => p.paidOn >= month && p.paidOn <= today).reduce((a, p) => a + p.amount, 0);
    const then = history(books.book, addMonths(today, -6), addMonths(today, -6))[0];
    const gainNow = s.portfolioValue - netInvested(s);
    const gainThen = then ? then.portfolioValue - then.netInvested : 0;
    const gain6 = gainNow - gainThen;
    const pct = then && then.netInvested > 0 ? ratioLabel(gain6, then.netInvested) : null;
    const v: Record<HeroFigure, FigureValue> = {
      portfolio: { label: t("Total portfolio value", "Valor total del portafolio"), text: fmt.money(s.portfolioValue) },
      lentOut: { label: t("Capital lent out", "Capital prestado"), text: fmt.money(s.outstandingPrincipal) },
      interestEarned: {
        label: t("Interest earned", "Interés cobrado"),
        text: fmt.money(earned),
        action: <PeriodPicker value={period} names={named} onChange={setPeriod} />,
      },
      availableCapital: { label: t("Available capital", "Capital disponible"), text: fmt.money(s.availableCapital) },
      availableInterest: { label: t("Available interest", "Interés disponible"), text: fmt.money(s.availableInterest) },
      receivable: { label: t("Receivable", "Por cobrar"), text: fmt.money(s.interestReceivable + s.feesReceivable) },
      overdue: { label: t("Overdue amount", "Monto atrasado"), text: fmt.money(s.overdueAmount), bad: s.overdueAmount > 0 },
      collectedMonth: { label: t("Collected this month", "Cobrado este mes"), text: fmt.money(collected) },
      expectedInterest: { label: t("Expected interest / month", "Interés esperado / mes"), text: fmt.money(s.expectedMonthlyInterest) },
      dueNext7: { label: t("Due in next 7 days", "Vence en 7 días"), text: fmt.money(due7) },
      gain6m: { label: t("Gain (6M)", "Ganancia (6M)"), text: `${fmt.signed(gain6)}${pct ? ` · ${pct}` : ""}`, good: gain6 > 0, bad: gain6 < 0 },
      activeLoans: { label: t("Active loans", "Préstamos activos"), text: String(s.activeLoans) },
      overdueLoans: { label: t("Loans overdue", "Préstamos atrasados"), text: String(s.overdueLoans), bad: s.overdueLoans > 0 },
      toConfirm: { label: t("To confirm", "Por confirmar"), text: fmt.money(waitingSum) },
    };
    return v;
  }, [t, period, today, books, s, fmt, snapshot.payments, waitingSum, setPeriod]);

  // Phones swipe through the figures one at a time; the dots follow.
  const shownFigs = shownSlots(layoutHero).length;
  const periodNames: Record<Period, string> = {
    day: t("Today", "Hoy"),
    week: t("This week", "Esta semana"),
    month: t("This month", "Este mes"),
    year: t("This year", "Este año"),
    all: t("All time", "Todo el tiempo"),
  };
  const heroFigures = admin ? (
    <InHero slot="figures">
      <SixFigures s={s} book={books.book} fmt={fmt} today={today} period={period} periodAction={periodPicker(periodNames)} />
    </InHero>
  ) : (
    <InHero slot="figures">
      <div
        className="hero-figures"
        onScroll={(e) => {
          const el = e.currentTarget;
          const card = el.firstElementChild as HTMLElement | null;
          if (card) setFigAt(Math.round(el.scrollLeft / (card.offsetWidth + 10)));
        }}
      >
        {shownSlots(layoutHero).map(({ slot, rows }, i) => {
          const big = slot.big === "none" ? null : values[slot.big];
          return (
            <div key={i} className="hero-fig">
              {big && (
                <>
                  <div className="fig-label">
                    {big.label}
                    {big.action}
                  </div>
                  <div className={`fig-big num ${big.bad ? "bad" : ""}`}>
                    <Amount text={big.text} />
                  </div>
                </>
              )}
              {rows.length > 0 && (
                <div className={`fig-rows ${rows.length === 1 ? "one" : ""}`}>
                  {rows.map((r) => (
                    <div key={r} className="fig-row">
                      <span>{values[r].label}</span>
                      <b className={`num ${values[r].bad ? "chip-bad" : values[r].good ? "good" : ""}`}>{values[r].text}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shownFigs > 1 && (
        <div className="fig-dots" aria-hidden="true">
          {Array.from({ length: shownFigs }, (_, i) => (
            <i key={i} className={i === figAt ? "on" : ""} />
          ))}
        </div>
      )}
    </InHero>
  );

  // ----- arranging the blocks -----
  const [layout, saveLayout] = useStored<OverviewLayout>(`acervus.overview3.${user?.id ?? "anon"}`, parseLayout);
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState<Block | null>(null);
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
  const allowedBlocks: Block[] = [...(admin ? (["growth", "money"] as Block[]) : []), "today", "status", "attention", collector ? "mine" : "recent", ...(can("record") ? (["reminders"] as Block[]) : [])];
  const blockLabel: Record<Block, string> = {
    growth: t("Portfolio growth", "Crecimiento del portafolio"),
    money: t("Where your money is", "Dónde está tu dinero"),
    today: t("Needs attention today", "Requiere atención hoy"),
    status: t("Loans by status", "Préstamos por estado"),
    attention: t("Late and due soon", "Atrasados y por vencer"),
    mine: t("My recent payments", "Mis cobros recientes"),
    recent: t("Recent payments", "Pagos recientes"),
    reminders: t("WhatsApp reminders", "Recordatorios por WhatsApp"),
  };

  // Dragging with a mouse; on touch screens the arrows do the moving.
  const dragProps = (b: Block) =>
    editing
      ? {
          draggable: true,
          onDragStart: (e: DragEvent) => {
            dragged.current = b;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", b);
          },
          onDragEnd: () => {
            dragged.current = null;
            setOver(null);
          },
        }
      : {};
  const dropProps = (b: Block) =>
    editing
      ? {
          onDragOver: (e: DragEvent) => {
            const g = dragged.current;
            if (!g || g === b) return;
            e.preventDefault();
            setOver(b);
          },
          onDragLeave: () => setOver((o) => (o === b ? null : o)),
          onDrop: (e: DragEvent) => {
            const g = dragged.current;
            if (!g || g === b) return;
            e.preventDefault();
            setOver(null);
            edit(dropOnto(layout, g, b));
          },
        }
      : {};

  const growth = () => (
    <Card
      title={blockLabel.growth}
      action={
        <Segmented
          label={t("Range", "Rango")}
          value={range}
          onChange={setRange}
          options={[
            ["1", t("1M", "1M")],
            ["3", "3M"],
            ["6", "6M"],
            ["12", t("1Y", "1A")],
            ["all", t("All", "Todo")],
          ]}
        />
      }
    >
      <div className="card-body">
        {points.length > 1 ? (
          <>
            <div className="legend" aria-hidden="true">
              <span>
                <i />
                {t("Portfolio value", "Valor del portafolio")}
              </span>
              <span>
                <i className="dash" />
                {t("Capital invested", "Capital invertido")}
              </span>
            </div>
            <GrowthChart points={points} fmt={fmt} label={t("Portfolio value and capital invested over time", "Valor del portafolio y capital invertido en el tiempo")} />
          </>
        ) : (
          <Empty icon="chart">{t("The chart appears once there is activity on more than one day.", "El gráfico aparece cuando hay actividad en más de un día.")}</Empty>
        )}
      </div>
    </Card>
  );

  const money = () => {
    const parts: [string, number][] = [
      [t("Lent out", "Prestado"), s.outstandingPrincipal],
      [t("Available capital", "Capital disponible"), s.availableCapital],
      [t("Available interest", "Interés disponible"), s.availableInterest],
      [t("Receivable", "Por cobrar"), s.interestReceivable + s.feesReceivable],
    ];
    const total = parts.reduce((a, p) => a + Math.max(0, p[1]), 0);
    return (
      <Card title={blockLabel.money} action={<LinkButton to="/money" size="small" variant="ghost">{t("Movements", "Movimientos")}</LinkButton>}>
        <div className="card-body money-where">
          <div className="money-total num">
            <Amount text={fmt.money(s.portfolioValue)} />
          </div>
          {total > 0 && (
            <div className="money-bar" aria-hidden="true">
              {parts.map(([label, v], i) => (v > 0 ? <span key={label} className={`m${i}`} style={{ flexGrow: v }} /> : null))}
            </div>
          )}
          <ul className="money-list">
            {parts.map(([label, v], i) => (
              <li key={label}>
                <span className={`sw m${i}`} aria-hidden="true" />
                {label}
                {total > 0 && <span className="pct num">{((Math.max(0, v) / total) * 100).toFixed(1)}%</span>}
                <span className="amt num">{fmt.money(v)}</span>
              </li>
            ))}
          </ul>
          {mode === "online" && (
            <div className="money-acts">
              <Button size="small" variant="primary" icon="arrows" onClick={() => open({ kind: "entry", entry: "transfer" })}>
                {t("Move money", "Mover dinero")}
              </Button>
              <Button size="small" icon="edit" onClick={() => open({ kind: "entry", entry: "adjust" })}>
                {t("Adjust balances", "Ajustar saldos")}
              </Button>
            </div>
          )}
        </div>
      </Card>
    );
  };

  // ----- what needs attention today: up to three numbered lines -----
  const todayCard = () => {
    const late = books.loans.filter((l) => l.display === "overdue");
    const lateSum = late.reduce((a, l) => a + l.delinquency.overdueAmount, 0);
    const oldest = [...late].sort((a, b) => b.delinquency.daysOverdue - a.delinquency.daysOverdue)[0];
    const weekEnd = addDays(today, 7);
    // Only loans that still take payments (not written off or restructured).
    const dueWeek = books.loans.filter((l) => (l.display === "active" || l.display === "due_soon") && l.delinquency.nextDue && l.delinquency.nextDue >= today && l.delinquency.nextDue <= weekEnd);
    const dueSum = dueWeek.reduce((a, l) => a + l.delinquency.nextDueAmount, 0);
    const items: { key: string; to: string; strong: string; rest: string }[] = [];
    if (late.length > 0) {
      const d = oldest?.delinquency.daysOverdue ?? 0;
      const days = d === 1 ? t("1 day", "1 día") : t(`${d} days`, `${d} días`);
      const who = oldest?.client?.fullName ?? "—";
      items.push({
        key: "late",
        to: "/loans?show=overdue",
        strong: late.length === 1 ? t("1 loan is late", "1 préstamo está atrasado") : t(`${late.length} loans are late`, `${late.length} préstamos están atrasados`),
        rest: t(`, ${fmt.money(lateSum)} behind. The oldest is ${who}, ${days}.`, `, ${fmt.money(lateSum)} sin pagar. El más atrasado es ${who}, ${days}.`),
      });
    }
    if (admin && waiting.length > 0) {
      items.push({
        key: "confirm",
        to: "/confirm",
        strong: waiting.length === 1 ? t("1 collector payment", "1 cobro de un cobrador") : t(`${waiting.length} collector payments`, `${waiting.length} cobros de cobradores`),
        rest: waiting.length === 1 ? t(" is waiting for you to confirm.", " espera tu confirmación.") : t(" are waiting for you to confirm.", " esperan tu confirmación."),
      });
    }
    if (dueWeek.length > 0) {
      items.push({
        key: "week",
        to: "/loans",
        strong: dueWeek.length === 1 ? t("1 installment", "1 cuota") : t(`${dueWeek.length} installments`, `${dueWeek.length} cuotas`),
        rest:
          dueWeek.length === 1
            ? t(` falls due this week, ${fmt.money(dueSum)}.`, ` vence esta semana, ${fmt.money(dueSum)}.`)
            : t(` fall due this week, ${fmt.money(dueSum)} in all.`, ` vencen esta semana, ${fmt.money(dueSum)} en total.`),
      });
    }
    return (
      <Card
        className="today-card"
        title={
          <>
            <span className="today-ico" aria-hidden="true">
              <Icon name="alert" />
            </span>
            {blockLabel.today}
          </>
        }
      >
        {items.length === 0 ? (
          <Empty icon="check">{t("Nothing needs you today: no late loans and nothing due this week.", "Nada requiere tu atención hoy: ningún préstamo atrasado y nada vence esta semana.")}</Empty>
        ) : (
          <>
            <ol className="today-list">
              {items.map((it, i) => (
                <li key={it.key}>
                  <Link to={it.to}>
                    <span className="today-n num" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <b>{it.strong}</b>
                      {it.rest}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
            {late.length > 0 && (
              <div className="today-foot">
                <LinkButton to="/loans?show=overdue" size="small" variant="primary">
                  {t("Open late loans", "Ver préstamos atrasados")}
                </LinkButton>
              </div>
            )}
          </>
        )}
      </Card>
    );
  };

  // ----- loans by status: a bar and a short list -----
  const statusCard = () => {
    const live = books.loans.filter((l) => l.display !== "paid_off");
    const paidOff = books.loans.length - live.length;
    const late = live.filter((l) => l.display === "overdue");
    const groups: { key: string; label: string; n: number }[] = [
      { key: "ok", label: t("On time", "Al día"), n: live.filter((l) => l.display === "active" || l.display === "restructured").length },
      { key: "soon", label: t("Due soon", "Vence pronto"), n: live.filter((l) => l.display === "due_soon").length },
      { key: "late", label: t("Late up to 30 days", "Atrasados hasta 30 días"), n: late.filter((l) => l.delinquency.daysOverdue <= 30).length },
      { key: "later", label: t("Late over 30 days", "Atrasados más de 30 días"), n: late.filter((l) => l.delinquency.daysOverdue > 30).length },
      { key: "gone", label: t("Defaulted", "Incobrables"), n: live.filter((l) => l.display === "defaulted").length },
    ];
    const total = groups.reduce((a, g) => a + g.n, 0);
    return (
      <Card
        title={blockLabel.status}
        action={
          <LinkButton to="/loans" size="small" variant="ghost">
            {t("All loans", "Préstamos")}
          </LinkButton>
        }
      >
        <div className="card-body">
          {total === 0 ? (
            <Empty icon="loans">{t("Your loans show here by how they are being paid.", "Tus préstamos aparecen aquí según cómo se están pagando.")}</Empty>
          ) : (
            <>
              <div className="st-bar" aria-hidden="true">
                {groups.map((g) => (g.n > 0 ? <span key={g.key} className={`st-${g.key}`} style={{ flexGrow: g.n }} /> : null))}
              </div>
              <ul className="st-list">
                {groups.map((g) => (
                  <li key={g.key}>
                    <span className={`st-sw st-${g.key}`} aria-hidden="true" />
                    {g.label}
                    <span className="st-n num">
                      {g.n} · {Math.round((g.n / total) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
              {paidOff > 0 && <p className="st-foot">{paidOff === 1 ? t("1 loan paid off", "1 préstamo saldado") : t(`${paidOff} loans paid off`, `${paidOff} préstamos saldados`)}</p>}
            </>
          )}
        </div>
      </Card>
    );
  };

  const attentionList = () => (
    <Card
      title={
        <>
          {blockLabel.attention}
          {attention.length > 0 && <span className="count-pill">{t(`${attention.length} loans`, `${attention.length} préstamos`)}</span>}
        </>
      }
      action={<LinkButton to="/loans" size="small" variant="ghost">{t("All loans", "Préstamos")}</LinkButton>}
    >
      {attention.length === 0 ? (
        <Empty icon="check">{t("Nothing overdue or due in the next 5 days.", "Nada atrasado ni por vencer en los próximos 5 días.")}</Empty>
      ) : (
        <ul className="list ruled">
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
                  <StatusPill s={l.display} />
                </>
              }
            />
          ))}
        </ul>
      )}
    </Card>
  );

  const mineList = () => (
    <Card title={blockLabel.mine}>
      {mine.length === 0 ? (
        <Empty icon="receipt">{t("Payments you collect show here until the office confirms them.", "Los cobros que hagas aparecen aquí hasta que la oficina los confirme.")}</Empty>
      ) : (
        <ul className="list ruled">
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
    </Card>
  );

  // ----- WhatsApp (the regular app, through wa.me) -----
  const currency = snapshot.settings?.currencyCode ?? "DOP";
  const businessName = business?.name ?? snapshot.business.name;
  const [sent, setSent] = useState(() => sentToday(today));
  const todays = remindersFor(books.loans, today, currency);
  const waSentCount = todays.filter((r) => sent.has(reminderKey(r, today))).length;
  const remindersList = () => (
    <Card
      title={
        <>
          {blockLabel.reminders}
          {todays.length - waSentCount > 0 && <span className="count-pill">{todays.length - waSentCount}</span>}
        </>
      }
    >
      {todays.length === 0 ? (
        <Empty icon="chat">
          {t(
            "Clients with an installment due tomorrow or today, or who are late, appear here to remind on WhatsApp.",
            "Aquí aparecen los clientes con una cuota que vence mañana u hoy, o atrasados, para recordarles por WhatsApp.",
          )}
        </Empty>
      ) : (
        <ul className="list ruled">
          {todays.map((r) => {
            const key = reminderKey(r, today);
            const done = sent.has(key);
            const n = r.loanNo;
            const when =
              r.due.kind === "tomorrow"
                ? t(`Loan #${n} · due tomorrow`, `Préstamo #${n} · vence mañana`)
                : r.due.kind === "today"
                  ? t(`Loan #${n} · due today`, `Préstamo #${n} · vence hoy`)
                  : r.due.days === 1
                    ? t(`Loan #${n} · 1 day late`, `Préstamo #${n} · 1 día de atraso`)
                    : t(`Loan #${n} · ${r.due.days} days late`, `Préstamo #${n} · ${r.due.days} días de atraso`);
            return (
              <Row
                key={key}
                to={`/loans/${r.loanId}`}
                muted={done}
                lead={<Avatar name={r.client} />}
                title={r.client}
                sub={when}
                trail={<span className={`amount num ${r.due.kind === "late" ? "neg" : ""}`}>{fmt.money(r.amount)}</span>}
                aside={
                  r.phone ? (
                    <a
                      className={`btn ghost small wa-btn ${done ? "done" : ""}`}
                      href={waLink(r.phone, reminderText(r, t, fmt, businessName, snapshot.settings?.receiptText))}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={done ? t("Send it again", "Enviarlo de nuevo") : t("Open WhatsApp with the reminder written", "Abrir WhatsApp con el recordatorio escrito")}
                      onClick={() => setSent(markSent(key, today))}
                    >
                      {done ? <Icon name="check" /> : <WaLogo />}
                      <span className="wa-label">{done ? t("Sent", "Enviado") : "WhatsApp"}</span>
                    </a>
                  ) : (
                    <span className="wa-none">{t("No phone", "Sin teléfono")}</span>
                  )
                }
              />
            );
          })}
        </ul>
      )}
    </Card>
  );

  const recentList = () => (
    <Card title={blockLabel.recent} action={<LinkButton to="/payments" size="small" variant="ghost">{t("All payments", "Todos los pagos")}</LinkButton>}>
      {recent.length === 0 ? (
        <Empty icon="receipt">{t("No payments yet.", "Aún no hay pagos.")}</Empty>
      ) : (
        <ul className="list ruled">
          {recent.map((p) => {
            const l = books.loanById.get(p.loanId);
            return (
              <Row
                key={p._id}
                to={`/loans/${p.loanId}`}
                lead={<Avatar name={l?.client?.fullName ?? "?"} />}
                title={l?.client?.fullName ?? "—"}
                sub={`${fmt.dayShort(p.paidOn)} · ${t("interest", "interés")} ${fmt.money(p.interest)} · ${t("capital", "capital")} ${fmt.money(p.principal)}`}
                trail={<span className="amount num pos">+{fmt.money(p.amount)}</span>}
                aside={<WaReceiptButton payment={p} />}
              />
            );
          })}
        </ul>
      )}
    </Card>
  );

  // First steps on a new business (2026-11-10, usability item 5; the
  // Windows app's `render_setup`): capital, a client, the first loan. An
  // admin's to take; gone once the first loan exists.
  const setupSteps: { done: boolean; title: string; body: string; label: string; primary?: boolean; go: () => void }[] = [
    {
      done: snapshot.capital.length > 0,
      title: t("Record your starting capital", "Registra tu capital inicial"),
      body: t("The money you have set aside to lend.", "El dinero que apartaste para prestar."),
      label: t("Add capital", "Agregar capital"),
      go: () => open({ kind: "entry", entry: "contribution" }),
    },
    {
      done: snapshot.clients.length > 0,
      title: t("Add a client", "Agrega un cliente"),
      body: t("Name and optional contact details.", "Nombre y datos de contacto opcionales."),
      label: t("New client", "Nuevo cliente"),
      go: () => open({ kind: "client" }),
    },
    {
      done: false,
      title: t("Create the first loan", "Crea el primer préstamo"),
      body: t("See what the client pays, and when, before you confirm.", "Mira qué paga el cliente, y cuándo, antes de confirmar."),
      label: t("New loan", "Nuevo préstamo"),
      primary: true,
      go: () => open({ kind: "loan" }),
    },
  ];
  const setupDone = setupSteps.filter((s) => s.done).length;
  const setup =
    snapshot.loans.length === 0 && can("manage") && mode === "online" ? (
      <Card title={t("Set up your lending book", "Configura tu cartera")} action={<span className="small muted num">{t(`${setupDone} of 3 done`, `${setupDone} de 3 listos`)}</span>} className="setup-card">
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>
            {t("Three steps, and every figure on this screen comes from what you record.", "Tres pasos, y cada cifra de esta pantalla sale de lo que registres.")}
          </p>
          <ol className="setup-steps">
            {setupSteps.map((s, i) => (
              <li key={i} className={s.done ? "done" : ""}>
                <span className="setup-n" aria-hidden="true">
                  {s.done ? <Icon name="check" /> : i + 1}
                </span>
                <div>
                  <b>{s.title}</b>
                  <p>{s.body}</p>
                  {!s.done && (
                    <Button size="small" variant={s.primary ? "primary" : undefined} onClick={s.go}>
                      {s.label}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    ) : null;

  const content: Record<Block, () => ReactNode> = { growth, today: todayCard, status: statusCard, money, attention: attentionList, mine: mineList, recent: recentList, reminders: remindersList };
  const shownBlocks = layout.blocks.filter((b) => allowedBlocks.includes(b) && !layout.hidden.includes(b));

  // A block; while arranging, framed with a bar to drag it by, arrows,
  // Half/Full and Hide.
  const block = (b: Block) => {
    const at = shownBlocks.indexOf(b);
    const label = blockLabel[b];
    return (
      <div key={b} data-flip={`b-${b}`} className={`ov-block ${editing ? "framed" : ""} ${over === b ? "drop" : ""}`} {...dropProps(b)}>
        {editing && (
          <div className="ov-bar">
            <span className="ov-grip" {...dragProps(b)}>
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
    <div className="overview">
      {heroFigures}
      {/* Admins' six figures are fixed; the others pick their four. */}
      {!admin && (
        <InHero slot="actions">
          <CustomizeFigures layout={layoutHero} role={heroRole} labels={values} onChange={saveHero} />
        </InHero>
      )}
      {!editing && (
        <InHero slot="actions">
          <button type="button" className="glass-pill icon ov-arrange-top" aria-label={t("Arrange this Overview", "Organizar este Resumen")} title={t("Arrange this Overview", "Organizar este Resumen")} onClick={() => arrange(true)}>
            <Icon name="sliders" />
          </button>
        </InHero>
      )}
      <h1 className="sr-only">{t("Overview", "Resumen")}</h1>
      {editing && (
        <div className="ov-editbar">
          <Icon name="sliders" />
          <span className="grow">
            <b>{t("Arranging your Overview.", "Organizando tu Resumen.")}</b>{" "}
            {touch
              ? t("Use the buttons on each block to move or hide it.", "Usa los botones de cada bloque para moverlo u ocultarlo.")
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
      {setup}
      <div ref={box} className="ov-blocks">
        {rows.map((row) =>
          row.length === 2 ? (
            <div key={row.join("+")} className="ov-pair" style={{ "--cols": row.map((b) => (b === "growth" ? "1.6fr" : "1fr")).join(" ") } as CSSProperties}>
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

const fmtMoney = (fmt: Fmt, v: number) => fmt.money(v);

/** The sliders button beside the business: which figure goes in each of the
 *  hero's four places, and the two rows under it. "Nothing" leaves a spot
 *  empty; a place with nothing in it disappears. */
function CustomizeFigures({ layout, role, labels, onChange }: { layout: HeroLayout; role: HeroRole; labels: Record<HeroFigure, FigureValue>; onChange: (l: HeroLayout) => void }) {
  const t = useT();
  // On the page itself (above the figures and the floating bar): under its
  // button on wide screens, a sheet from the bottom on phones.
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const r = box.current?.getBoundingClientRect();
    setAt(r && r.width > 0 ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) } : null);
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!box.current?.contains(n) && !pop.current?.contains(n)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  // From the account menu on phones: /?customize=1 opens it once.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("customize") !== "1") return;
    setOpen(true);
    setParams({}, { replace: true });
  }, [params, setParams, setOpen]);
  const allowed = allowedFigures(role);
  const label = t("Customize figures", "Personalizar cifras");
  const select = (i: number, spot: "big" | 0 | 1, value: Pick) => (
    <select
      id={`hero-${i}-${spot}`}
      value={value}
      onChange={(e) => onChange(setPick(layout, i, spot, e.target.value as Pick))}
    >
      <option value="none">{t("Nothing", "Nada")}</option>
      {allowed
        .filter((f) => spot !== "big" || !ROW_ONLY.includes(f))
        .map((f) => (
          <option key={f} value={f}>
            {labels[f].label}
          </option>
        ))}
    </select>
  );
  return (
    <span className="hero-custom" ref={box}>
      <button type="button" className={`glass-pill icon ${open ? "on" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name="sliders" />
      </button>
      {open &&
        createPortal(
        <div ref={pop} className="hero-pop custom-pop" role="dialog" aria-label={label} style={at ? { top: at.top, right: at.right } : undefined}>
          <h4>{t("Your figures", "Tus cifras")}</h4>
          <div className="custom-grid">
            {layout.map((slot, i) => (
              <div key={i} className="custom-slot">
                <span className="micro-cap">{t(`Place ${i + 1}`, `Lugar ${i + 1}`)}</span>
                <label htmlFor={`hero-${i}-big`}>{t("Big figure", "Cifra grande")}</label>
                {select(i, "big", slot.big)}
                <label htmlFor={`hero-${i}-0`}>{t("Row 1", "Fila 1")}</label>
                {select(i, 0, slot.rows[0])}
                <label htmlFor={`hero-${i}-1`}>{t("Row 2", "Fila 2")}</label>
                {select(i, 1, slot.rows[1])}
              </div>
            ))}
          </div>
          <div className="custom-foot">
            <span>{t("Choose Nothing to leave a spot empty. A single row shows larger.", "Elige Nada para dejar un espacio vacío. Una sola fila se ve más grande.")}</span>
            <Button size="small" variant="ghost" onClick={() => onChange(defaultHero(role))}>
              {t("Reset", "Restablecer")}
            </Button>
            <Button size="small" variant="primary" onClick={() => setOpen(false)}>
              {t("Done", "Listo")}
            </Button>
          </div>
        </div>,
          document.body,
        )}
    </span>
  );
}
