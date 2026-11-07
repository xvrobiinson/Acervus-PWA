// The admins' six figures in the Overview's hero (Cards Option B, picked
// 2026-11-07, the same as the Windows app): the business's totals, each on
// a small card with its icon, its amount and a line under it. All six in a
// row on wide screens; below that, four (tablets) or two (phones) at a time,
// the rest a swipe away, with dots for where you are. Amounts shrink to fit
// their card and are never cut.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Day } from "../../shared/domain/dates";
import { ratioLabel } from "../../shared/domain/money";
import { gain, netInvested, realizedIncome, totalExpenses, type Book, type Summary } from "../../shared/domain/portfolio";
import type { Fmt } from "../lib/format";
import { useT } from "../lib/i18n";
import { interestIn, spans, type Period } from "../lib/periods";
import { Icon, type IconName } from "../ui/icons";

type Tone = "plain" | "good" | "bad";

interface Six {
  key: string;
  icon: IconName;
  chip: "accent" | "info" | "good" | "bad" | "plain";
  label: string;
  amount: string;
  bad?: boolean;
  lines: { text: string; tone: Tone }[];
  action?: ReactNode;
}

const toneOf = (v: number): Tone => (v > 0 ? "good" : v < 0 ? "bad" : "plain");

export function SixFigures({ s, book, fmt, today, period, periodAction }: { s: Summary; book: Book; fmt: Fmt; today: Day; period: Period; periodAction: ReactNode }) {
  const t = useT();
  // 1. Total portfolio value: the gain on what was invested.
  const inv = netInvested(s);
  const g = gain(s);
  const portfolioLines =
    inv > 0
      ? [
          { text: `${fmt.signed(g)} (${g > 0 ? "+" : ""}${ratioLabel(g, inv) ?? ""})`, tone: toneOf(g) },
          { text: t(`on ${fmt.money(inv)} invested`, `sobre ${fmt.money(inv)} invertido`), tone: "plain" as Tone },
        ]
      : [{ text: t("No capital recorded yet", "Aún no hay capital registrado"), tone: "plain" as Tone }];
  // 2. Available capital: its share of the portfolio.
  const share = s.portfolioValue > 0 ? ratioLabel(s.availableCapital, s.portfolioValue) : null;
  // 3. Available interest: what expenses took from it.
  const spent = totalExpenses(s);
  // 5. Interest earned in the chosen period, against the one before.
  const span = spans(period, today);
  let earned = realizedIncome(s);
  let earnedLines: { text: string; tone: Tone }[] = [{ text: t("Received, all time", "Cobrado en total"), tone: "plain" }];
  if (span) {
    const now = interestIn(book, span.now);
    const before = interestIn(book, span.before);
    const diff = now - before;
    const pct = before > 0 ? ` (${diff > 0 ? "+" : ""}${ratioLabel(diff, before) ?? ""})` : "";
    const versus: Record<Exclude<Period, "all">, string> = {
      day: t("vs yesterday", "vs ayer"),
      week: t("vs last week", "vs la semana pasada"),
      month: t("vs last month", "vs el mes pasado"),
      year: t("vs last year", "vs el año pasado"),
    };
    earned = now;
    earnedLines = [
      { text: `${fmt.signed(diff)}${pct}`, tone: toneOf(diff) },
      { text: versus[period as Exclude<Period, "all">], tone: "plain" },
    ];
  }
  // 6. Overdue amount: how many loans are behind.
  const late = s.overdueAmount > 0;
  const n = s.activeLoans;
  const cards: Six[] = [
    { key: "portfolio", icon: "wallet", chip: "accent", label: t("Total portfolio value", "Valor total del portafolio"), amount: fmt.money(s.portfolioValue), lines: portfolioLines },
    {
      key: "capital",
      icon: "landmark",
      chip: "accent",
      label: t("Available capital", "Capital disponible"),
      amount: fmt.money(s.availableCapital),
      lines: [{ text: share ? t(`${share} of portfolio`, `${share} del portafolio`) : t("Ready to lend", "Listo para prestar"), tone: "plain" }],
    },
    {
      key: "lent",
      icon: "loans",
      chip: "info",
      label: t("Capital lent out", "Capital prestado"),
      amount: fmt.money(s.outstandingPrincipal),
      lines: [{ text: n === 1 ? t("across 1 active loan", "en 1 préstamo activo") : t(`across ${n} active loans`, `en ${n} préstamos activos`), tone: "plain" }],
    },
    {
      key: "interest",
      icon: "coins",
      chip: "good",
      label: t("Available interest", "Interés disponible"),
      amount: fmt.money(s.availableInterest),
      lines: [{ text: spent > 0 ? t(`${fmt.money(spent)} spent in expenses`, `${fmt.money(spent)} usado en gastos`) : t("Interest and fees on hand", "Interés y cargos en mano"), tone: "plain" }],
    },
    { key: "earned", icon: "trendingUp", chip: "good", label: t("Interest earned", "Interés cobrado"), amount: fmt.money(earned), lines: earnedLines, action: periodAction },
    {
      key: "overdue",
      icon: "alert",
      chip: late ? "bad" : "plain",
      label: t("Overdue amount", "Monto atrasado"),
      amount: fmt.money(s.overdueAmount),
      bad: late,
      lines: [
        {
          text:
            s.overdueLoans === 0
              ? t("Nothing past due", "Nada vencido")
              : s.overdueLoans === 1
                ? t("1 loan behind", "1 préstamo atrasado")
                : t(`${s.overdueLoans} loans behind`, `${s.overdueLoans} préstamos atrasados`),
          tone: late ? "bad" : "plain",
        },
      ],
    },
  ];

  // Where the swipe is: one dot per screenful.
  const row = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [at, setAt] = useState(0);
  const measure = () => {
    const el = row.current;
    if (!el) return;
    const p = el.scrollWidth > el.clientWidth + 2 ? Math.ceil(el.scrollWidth / el.clientWidth - 0.05) : 1;
    setPages(p);
    const room = el.scrollWidth - el.clientWidth;
    setAt(room > 0 ? Math.round((el.scrollLeft / room) * (p - 1)) : 0);
  };
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <>
      <div className="hero-six" ref={row} onScroll={measure}>
        {cards.map((c) => (
          <div key={c.key} className="six-card">
            <div className="six-top">
              <span className={`six-ico ${c.chip}`}>
                <Icon name={c.icon} />
              </span>
              <span className="six-label">{c.label}</span>
              {c.action}
            </div>
            <div className={`six-amt num ${c.bad ? "bad" : ""}`} style={{ "--len": c.amount.length } as CSSProperties}>
              {c.amount}
            </div>
            <div className="six-sub">
              {c.lines.map((l, i) => (
                <div key={i} className={l.tone}>
                  {l.text}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {pages > 1 && (
        <div className="six-dots" aria-hidden="true">
          {Array.from({ length: pages }, (_, i) => (
            <i key={i} className={i === at ? "on" : ""} />
          ))}
        </div>
      )}
    </>
  );
}
