// The business's own WhatsApp wording (2026-11-10, the owner's request):
// the three reminders and an opening and closing line for receipts, one
// wording for the whole business. Kept with the receipt wording in the
// settings' `receiptText` map (keys `receipt_wa_*`, "=" + the text; none
// is the built-in text), so every phone and PC sends the same. The Windows
// app's twin is `ReceiptText`'s `wa_*` fields (src/services/receipt_text.rs).

import type { T } from "./i18n";

export const WA_KEYS = {
  tomorrow: "receipt_wa_tomorrow",
  today: "receipt_wa_today",
  late: "receipt_wa_late",
  receiptTop: "receipt_wa_top",
  receiptEnd: "receipt_wa_end",
} as const;
export type WaKey = keyof typeof WA_KEYS;

/** The tags a message can hold; each is filled in when it is sent. */
export const WA_TAGS = ["client", "amount", "date", "loan", "business"] as const;
export type WaTags = Record<(typeof WA_TAGS)[number], string>;

export const WA_MAX = 1000;

/** The built-in wording, with tags (what the apps sent before it could be changed). */
export function waDefaults(t: T): Record<WaKey, string> {
  const thanks = `${t("Thank you!", "¡Gracias!")}\n— {business}`;
  return {
    tomorrow:
      t(
        "Hi {client}, a friendly reminder that your installment of {amount} on loan #{loan} is due tomorrow, {date}.",
        "Hola {client}, le recordamos que su cuota de {amount} del préstamo #{loan} vence mañana, {date}.",
      ) +
      " " +
      thanks,
    today: t("Hi {client}, your installment of {amount} on loan #{loan} is due today, {date}.", "Hola {client}, su cuota de {amount} del préstamo #{loan} vence hoy, {date}.") + " " + thanks,
    late:
      t(
        "Hi {client}, loan #{loan} has {amount} past due since {date}. Please get in touch with us to bring it up to date.",
        "Hola {client}, el préstamo #{loan} tiene {amount} atrasado desde el {date}. Por favor comuníquese con nosotros para ponerse al día.",
      ) +
      " " +
      thanks,
    receiptTop: "",
    receiptEnd: t("Thank you for your payment!", "¡Gracias por su pago!"),
  };
}

// Line breaks are kept (a message has lines); other control characters go.
const clean = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim(); // eslint-disable-line no-control-regex

/** The business's own wording for `key`, or null for the built-in. */
export function waCustom(map: Record<string, string> | undefined, key: WaKey): string | null {
  const v = map?.[WA_KEYS[key]];
  return v !== undefined && v.startsWith("=") ? v.slice(1) : null;
}

/** The wording to send: the business's own, else the built-in. */
export function waTemplate(map: Record<string, string> | undefined, key: WaKey, t: T): string {
  return waCustom(map, key) ?? waDefaults(t)[key];
}

/** The map with one message changed (null: back to the built-in). */
export function withWa(map: Record<string, string>, key: WaKey, value: string | null): Record<string, string> {
  const next = { ...map };
  if (value === null) delete next[WA_KEYS[key]];
  else next[WA_KEYS[key]] = `=${clean(value)}`;
  return next;
}

export function fillWa(template: string, tags: Partial<WaTags>): string {
  return Object.entries(tags).reduce((s, [k, v]) => s.split(`{${k}}`).join(v ?? ""), template);
}

/** What stops the messages being saved, or null. */
export function waProblem(t: T, map: Record<string, string>): string | null {
  for (const k of Object.keys(WA_KEYS) as WaKey[]) {
    const v = waCustom(map, k);
    if (v !== null && [...v].length > WA_MAX) return t(`A message is too long (${WA_MAX} characters at most)`, `Un mensaje es muy largo (máximo ${WA_MAX} caracteres)`);
  }
  return null;
}
