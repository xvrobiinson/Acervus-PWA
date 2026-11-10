// Help: how Acervus works, in plain words (2026-11-10, usability item 13):
// the three loan types with an example each, the six cards, late fees,
// receipts and WhatsApp, and the welcome tour to replay. The Windows app's
// twin is src/ui/screens/help.rs.

import { useNavigate } from "react-router";
import { useT } from "../lib/i18n";
import { methodExplanation, methodSuits } from "../lib/labels";
import { useBooks } from "../state/app";
import { Button, Card } from "../ui/kit";
import { useTour } from "../ui/tour";
import { sixHints } from "./six-figures";

export function HelpScreen() {
  const t = useT();
  const { fmt } = useBooks();
  const tour = useTour();
  const navigate = useNavigate();
  const m = (c: number) => fmt.money(c);
  const cards: [string, string][] = [
    ["portfolio", t("Total portfolio value", "Valor total del portafolio")],
    ["capital", t("Available capital", "Capital disponible")],
    ["lent", t("Capital lent out", "Capital prestado")],
    ["interest", t("Available interest", "Interés disponible")],
    ["earned", t("Interest earned", "Interés cobrado")],
    ["overdue", t("Overdue amount", "Monto atrasado")],
  ];
  const hints = sixHints(t);
  // Examples on 10,000 at 10% a month in 4 monthly installments.
  const types: { key: "declining" | "flat" | "interest_only"; name: string; example: string }[] = [
    {
      key: "declining",
      name: t("Declining balance", "Saldo decreciente"),
      example: t(
        `${m(1000000)} at 10% a month in 4 months: ${m(350000)}, then ${m(325000)}, ${m(300000)} and ${m(275000)}. ${m(1250000)} in all.`,
        `${m(1000000)} al 10% mensual en 4 meses: ${m(350000)}, luego ${m(325000)}, ${m(300000)} y ${m(275000)}. ${m(1250000)} en total.`,
      ),
    },
    {
      key: "flat",
      name: t("Flat interest", "Interés fijo"),
      example: t(`${m(1000000)} at 10% a month in 4 months: ${m(350000)} each month, ${m(1400000)} in all.`, `${m(1000000)} al 10% mensual en 4 meses: ${m(350000)} cada mes, ${m(1400000)} en total.`),
    },
    {
      key: "interest_only",
      name: t("Interest only", "Solo interés"),
      example: t(
        `${m(1000000)} at 10% a month: ${m(100000)} of interest each month. Paying ${m(600000)} one month pays the interest and ${m(500000)} of capital, so the next interest is ${m(50000)}.`,
        `${m(1000000)} al 10% mensual: ${m(100000)} de interés cada mes. Si un mes paga ${m(600000)}, cubre el interés y ${m(500000)} de capital, y el próximo interés es ${m(50000)}.`,
      ),
    },
  ];
  return (
    <div className="help">
      <div className="topbar page-head">
        <div className="grow">
          <h1>{t("How Acervus works", "Cómo funciona Acervus")}</h1>
          <div className="small muted">{t("The essentials, in plain words.", "Lo esencial, en palabras sencillas.")}</div>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            navigate("/");
            tour.start();
          }}
        >
          {t("Replay the tour", "Repetir el recorrido")}
        </Button>
      </div>

      <Card title={t("The three loan types", "Los tres tipos de préstamo")}>
        <div className="card-body help-list">
          {types.map((x) => (
            <section key={x.key}>
              <h3>{x.name}</h3>
              <p>
                <b>{methodSuits(t, x.key)}</b> {methodExplanation(t, x.key)}
              </p>
              <p className="help-example">{x.example}</p>
            </section>
          ))}
        </div>
      </Card>

      <Card title={t("The six cards on the Overview", "Las seis tarjetas del Resumen")} className="section">
        <dl className="card-body help-terms">
          {cards.map(([k, name]) => (
            <div key={k}>
              <dt>{name}</dt>
              <dd>{hints[k]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t("Payments, late fees and receipts", "Pagos, mora y recibos")} className="section">
        <div className="card-body help-list">
          <section>
            <h3>{t("Recording a payment", "Registrar un pago")}</h3>
            <p>{t("A payment goes to the oldest installment first: its late fee, then its interest, then its capital. The form says in plain words what the amount pays before you save, and Undo takes it back for a few seconds after.", "Un pago va primero a la cuota más antigua: su mora, luego su interés y luego su capital. El formulario dice en palabras sencillas qué cubre el monto antes de guardar, y Deshacer lo revierte durante unos segundos después.")}</p>
          </section>
          <section>
            <h3>{t("Late fees", "Mora")}</h3>
            <p>{t("On installment loans, the day after a due date the part of that installment still unpaid gets the loan's late fee, once. It can be waived on the loan's page. Interest-only loans have no automatic late fee; you can add a charge to a payment.", "En préstamos a cuotas, el día después de un vencimiento, la parte sin pagar de esa cuota recibe la mora del préstamo, una vez. Se puede perdonar en la página del préstamo. Los préstamos de solo interés no tienen mora automática; puedes agregar un cargo a un pago.")}</p>
          </section>
          <section>
            <h3>{t("Receipts", "Recibos")}</h3>
            <p>{t("Each business picks its payment receipt in Settings: the full schedule, or the next payment on one short page. On a receipt printer's roll (58, 80 or 112 mm), chosen on the receipt window, the short one always prints.", "Cada negocio elige su recibo de pago en Ajustes: el calendario completo, o el próximo pago en una página corta. En el rollo de una impresora de recibos (58, 80 o 112 mm), elegido en la ventana del recibo, siempre sale el corto.")}</p>
          </section>
          <section>
            <h3>{t("WhatsApp", "WhatsApp")}</h3>
            <p>{t("Remind opens WhatsApp with today's reminder written (the day before a due date, on the day, or once late); a receipt button sends the receipt as text. You press Send in WhatsApp, from your own number.", "Recordar abre WhatsApp con el recordatorio de hoy escrito (el día antes del vencimiento, el día, o cuando está atrasado); el botón de recibo envía el recibo como texto. Tú presionas Enviar en WhatsApp, desde tu propio número.")}</p>
          </section>
        </div>
      </Card>

      <Card title={t("Words you'll see", "Palabras que verás")} className="section">
        <dl className="card-body help-terms">
          <div>
            <dt>{t("Defaulted", "Incobrable")}</dt>
            <dd>{t("Marked as unlikely to be paid back: no more interest is charged. Reinstate it to record payments again.", "Marcado como difícil de cobrar: ya no se cobra interés. Reactívalo para volver a registrar pagos.")}</dd>
          </div>
          <div>
            <dt>{t("Restructured", "Reestructurado")}</dt>
            <dd>{t("Its terms were replaced on its status date: no new interest is charged on it after that.", "Sus condiciones se reemplazaron en la fecha de su estado: desde entonces no se cobra interés nuevo.")}</dd>
          </div>
          <div>
            <dt>{t("Pending confirmation", "Pendiente de confirmación")}</dt>
            <dd>{t("A payment a collector took that counts once the office confirms the money reached them.", "Un pago que tomó un cobrador y que cuenta cuando la oficina confirma que el dinero le llegó.")}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
