// WhatsApp buttons used across the screens (2026-11-09, like the Windows
// app's src/app/whatsapp.rs): a payment's receipt as text, and a client's
// chat, with today's reminder written when one is due (then marked sent on
// this device). Everything opens the regular WhatsApp through wa.me.

import { useState, type MouseEvent } from "react";
import { useT } from "../lib/i18n";
import { paidWithLabel } from "../lib/labels";
import { markSent, phoneForLink, receiptText, reminderKey, reminders, reminderText, sentToday, waLink } from "../lib/whatsapp";
import { balanceAfterPayment, nextAfterPayment, receiptShow } from "../receipts/receipt";
import { useBooks } from "../state/app";
import type { Snapshot } from "../state/types";
import { Icon } from "./icons";

type Payment = Snapshot["payments"][number];

/** The links, from the business's currency, name and receipt switches. */
export function useWhatsApp() {
  const t = useT();
  const { books, fmt, snapshot, today, business } = useBooks();
  const currency = snapshot.settings?.currencyCode ?? "DOP";
  const businessName = business?.name ?? snapshot.business.name;
  const phoneOf = (raw: string | null | undefined) => (raw ? phoneForLink(raw, currency) : null);

  /** A payment's receipt as text, or null when the client has no number. */
  const receiptLink = (p: Payment): string | null => {
    const l = books.loanById.get(p.loanId);
    const phone = phoneOf(l?.client?.phone);
    if (!l || !phone) return null;
    const text = receiptText(
      {
        number: p.recordNo,
        business: businessName,
        paidOn: p.paidOn,
        amount: p.amount,
        paidWith: p.paidWith ? paidWithLabel(t, p.paidWith) : null,
        principal: p.principal,
        interest: p.interest,
        fee: p.fee,
        loanNo: l.loan.recordNo,
        balance: balanceAfterPayment(l.loan, snapshot.payments, snapshot.lateFees, p._id),
        show: receiptShow(snapshot.settings ?? {}),
        format: snapshot.settings?.receiptFormat ?? "full",
        next: nextAfterPayment(l.loan, snapshot.payments, snapshot.lateFees, p._id),
        client: l.client?.fullName,
        wording: snapshot.settings?.receiptText,
      },
      t,
      fmt,
    );
    return waLink(phone, text);
  };

  /** A client's chat: today's most urgent reminder (on this loan when one is
   *  given) written, or an empty chat. Null when the client has no number. */
  const clientChat = (clientId: string, loanId?: string) => {
    const view = books.clientById.get(clientId);
    const phone = phoneOf(view?.client.phone);
    if (!view || !phone) return null;
    const loans = view.loans.filter((l) => !loanId || l.loan._id === loanId);
    const due = reminders(loans, today, currency)[0];
    if (!due) return { href: `https://wa.me/${phone}`, key: null };
    return { href: waLink(phone, reminderText(due, t, fmt, businessName, snapshot.settings?.receiptText)), key: reminderKey(due, today) };
  };

  /** Whether a payment's receipt can go out (its client has a number):
   *  cheap, for showing the button; the text is written on the tap. */
  const canSendReceipt = (p: Payment): boolean => !!phoneOf(books.loanById.get(p.loanId)?.client?.phone);
  return { receiptLink, canSendReceipt, clientChat, today };
}

/** WhatsApp's own mark in its green (2026-11-10, the owner's pick; on every
 *  WhatsApp button), so people see at once that the button opens WhatsApp. */
export function WaLogo() {
  return (
    <svg className="wa-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/** Clicks on these sit inside rows that open something else. */
const keepInside = (e: MouseEvent) => e.stopPropagation();

/** A small icon link that sends a payment's receipt; nothing without a number. */
export function WaReceiptButton({ payment }: { payment: Payment }) {
  const t = useT();
  const { can } = useBooks();
  const { receiptLink, canSendReceipt } = useWhatsApp();
  if (!can("record") || !canSendReceipt(payment)) return null;
  const label = t("Send the receipt on WhatsApp", "Enviar el recibo por WhatsApp");
  // The receipt is written when tapped (it replays the loan), not for every row.
  return (
    <button
      type="button"
      className="btn ghost small icon wa-btn"
      title={label}
      aria-label={label}
      onClick={(e) => {
        keepInside(e);
        const href = receiptLink(payment);
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      <WaLogo />
    </button>
  );
}

/** "Remind" when a reminder is due today (then "Sent"), else "WhatsApp". */
export function WaClientButton({ clientId, loanId, small }: { clientId: string; loanId?: string; small?: boolean }) {
  const t = useT();
  const { clientChat, today } = useWhatsApp();
  const [sent, setSent] = useState(() => sentToday(today));
  const chat = clientChat(clientId, loanId);
  if (!chat) return null;
  const done = chat.key !== null && sent.has(chat.key);
  const title = chat.key
    ? done
      ? t("Reminder sent today. Send it again", "Recordatorio enviado hoy. Enviarlo de nuevo")
      : t("Open WhatsApp with today's reminder written", "Abrir WhatsApp con el recordatorio de hoy escrito")
    : t("Open a WhatsApp chat with this client", "Abrir un chat de WhatsApp con este cliente");
  return (
    <a
      className={["btn", small ? "small" : "", "wa-btn", done ? "done" : ""].filter(Boolean).join(" ")}
      href={chat.href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      onClick={(e) => {
        keepInside(e);
        if (chat.key) setSent(markSent(chat.key, today));
      }}
    >
      {done ? <Icon name="check" /> : <WaLogo />}
      <span>{chat.key ? (done ? t("Sent", "Enviado") : t("Remind", "Recordar")) : "WhatsApp"}</span>
    </a>
  );
}
