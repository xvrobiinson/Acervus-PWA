// The Reports button in the hero (admins and viewers) and its panel from the
// right: a month's portfolio statement, collections in a period by client or
// by collector, and the loans overdue on a date. Each one exports as a PDF
// (a Letter page through the print dialog, like receipts) or as an Excel
// workbook. Everything is worked out on this device from the open books.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addMonths, monthStart, type Day } from "../../shared/domain/dates";
import { firstActivity } from "../../shared/domain/portfolio";
import { useT } from "../lib/i18n";
import { collections, monthlyStatement, overdue, reportHtml, reportSheets, type OverdueBand, type Report, type ReportCtx } from "../lib/reports";
import { xlsx } from "../lib/xlsx";
import { useBooks } from "../state/app";
import { Icon, type IconName } from "../ui/icons";
import { Button, Segmented, Sheet } from "../ui/kit";

export function ReportsButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="hero-dark-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="receipt" />
        {t("Reports", "Reportes")}
      </button>
      {/* On the page itself, above the + button and the header. */}
      {open && createPortal(<ReportsPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

const fileSafe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "acervus";

function saveBytes(name: string, bytes: Uint8Array, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function ReportsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { books, snapshot, today, fmt } = useBooks();
  const close = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const ctx: ReportCtx = { books, snapshot, today, t, fmt };
  const business = snapshot.business.name;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && !preview && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, preview]);

  // Months with activity, newest first.
  const months = useMemo(() => {
    const first = firstActivity(books.book) ?? today;
    const out: string[] = [];
    for (let m = monthStart(today); m >= monthStart(first) && out.length < 120; m = addMonths(m, -1)) out.push(m.slice(0, 7));
    return out;
  }, [books.book, today]);
  const monthName = (m: string) => {
    const s = new Date(`${m}-15T12:00:00`).toLocaleDateString(fmt.lang === "en" ? "en-GB" : fmt.lang === "nl" ? "nl" : "es", { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const [month, setMonth] = useState(() => (today.slice(8) <= "05" && months[1] ? months[1] : months[0]));
  const [from, setFrom] = useState<Day>(monthStart(today));
  const [to, setTo] = useState<Day>(today);
  const [by, setBy] = useState<"client" | "collector">("client");
  const [asOf, setAsOf] = useState<Day>(today);
  const [band, setBand] = useState<OverdueBand>("all");
  const range = from && to && from <= to;

  const excel = (r: Report) => saveBytes(`${fileSafe(business)}-${r.file}.xlsx`, xlsx(reportSheets(ctx, r, business)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const actions = (make: () => Report, ok = true, meta?: string) => (
    <div className="rp-acts">
      <Button size="small" variant="primary" icon="printer" disabled={!ok} onClick={() => setPreview(make())}>
        {t("Export PDF", "Exportar PDF")}
      </Button>
      <Button size="small" icon="download" disabled={!ok} onClick={() => excel(make())}>
        Excel
      </Button>
      {meta && <span className="rp-meta">{meta}</span>}
    </div>
  );
  const collected = range ? collections(ctx, from, to, by) : null;
  const late = overdue(ctx, asOf, band);
  return (
    <>
      {!preview && <div className="rp-scrim" onClick={onClose} aria-hidden="true" />}
      {/* The preview takes its place while open; closing it comes back here. */}
      <aside hidden={!!preview} className="rp-panel" role="dialog" aria-modal="true" aria-label={t("Reports", "Reportes")}>
        <div className="rp-head">
          <div>
            <h2>{t("Reports", "Reportes")}</h2>
            <p>{t("Pick a period, then export it.", "Elige un período y expórtalo.")}</p>
          </div>
          <button ref={close} type="button" className="acct-x" aria-label={t("Close", "Cerrar")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="rp-body">
          <ReportCard icon="chart" title={t("Monthly portfolio statement", "Estado mensual del portafolio")} text={t("Portfolio value, capital in and out, interest earned and every loan's balance for one month.", "Valor del portafolio, capital que entra y sale, interés cobrado y el saldo de cada préstamo en un mes.")}>
            <label className="rp-field">
              {t("Month", "Mes")}
              <select id="rp-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </label>
            {actions(() => monthlyStatement(ctx, month))}
          </ReportCard>
          <ReportCard icon="receipt" title={t("Collections report", "Reporte de cobros")} text={t("Payments received in a period, grouped by client or by collector.", "Pagos recibidos en un período, por cliente o por cobrador.")}>
            <div className="rp-fields">
              <label className="rp-field">
                {t("From", "Desde")}
                <input id="rp-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="rp-field">
                {t("To", "Hasta")}
                <input id="rp-to" type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
              </label>
            </div>
            <div className="rp-field">
              {t("Group by", "Agrupar por")}
              <Segmented
                label={t("Group by", "Agrupar por")}
                value={by}
                onChange={setBy}
                options={[
                  ["client", t("Client", "Cliente")],
                  ["collector", t("Collector", "Cobrador")],
                ]}
              />
            </div>
            {actions(
              () => collections(ctx, from, to, by),
              !!range,
              collected ? t(`${collected.facts[0].value} payment(s) · ${fmt.money(Number(collected.facts[1].value))}`, `${collected.facts[0].value} pago(s) · ${fmt.money(Number(collected.facts[1].value))}`) : t("Choose a start before the end.", "Elige un inicio antes del final."),
            )}
          </ReportCard>
          <ReportCard icon="alert" title={t("Overdue report", "Reporte de atrasos")} text={t("Every loan past due on a date, with days late, the amount behind and what's owed in total.", "Cada préstamo vencido en una fecha, con los días de atraso, el monto atrasado y el total adeudado.")}>
            <div className="rp-fields">
              <label className="rp-field">
                {t("As of", "Al")}
                <input id="rp-asof" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value || today)} />
              </label>
              <label className="rp-field">
                {t("Days late", "Días de atraso")}
                <select id="rp-band" value={band} onChange={(e) => setBand(e.target.value as OverdueBand)}>
                  <option value="all">{t("All overdue", "Todos los atrasados")}</option>
                  <option value="1-30">{t("1–30 days", "1–30 días")}</option>
                  <option value="31-90">{t("31–90 days", "31–90 días")}</option>
                  <option value="90+">{t("Over 90 days", "Más de 90 días")}</option>
                </select>
              </label>
            </div>
            {actions(() => overdue(ctx, asOf, band), true, t(`${late.facts[0].value} loan(s) · ${fmt.money(Number(late.facts[1].value))}`, `${late.facts[0].value} préstamo(s) · ${fmt.money(Number(late.facts[1].value))}`))}
          </ReportCard>
        </div>
      </aside>
      {preview && <ReportPreview html={reportHtml(ctx, preview, business)} title={preview.title} onExcel={() => excel(preview)} onClose={() => setPreview(null)} />}
    </>
  );
}

function ReportCard({ icon, title, text, children }: { icon: IconName; title: string; text: string; children: ReactNode }) {
  return (
    <section className="rp-card">
      <div className="rp-card-top">
        <span className="rp-icon">
          <Icon name={icon} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{text}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** The report as its Letter page, with Print / PDF (the print dialog saves the PDF). */
function ReportPreview({ html, title, onExcel, onClose }: { html: string; title: string; onExcel: () => void; onClose: () => void }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc) doc.documentElement.style.setProperty("--fit", String(Math.min(1, (frame.current!.clientWidth - 8) / 816)));
  };
  return (
    <Sheet
      wide
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button icon="download" onClick={onExcel}>
            Excel
          </Button>
          <Button variant="primary" icon="printer" onClick={() => frame.current?.contentWindow?.print()}>
            {t("Print / PDF", "Imprimir / PDF")}
          </Button>
        </>
      }
    >
      <iframe ref={frame} className="receipt-frame" title={title} srcDoc={html} onLoad={fit} />
      <p className="micro muted">
        {t(
          "To save a PDF, choose Print and then “Save as PDF” (on iPhone: Share › Save to Files). Letter paper.",
          "Para guardar un PDF, elige Imprimir y luego “Guardar como PDF” (en iPhone: Compartir › Guardar en Archivos). Papel carta.",
        )}
      </p>
    </Sheet>
  );
}
