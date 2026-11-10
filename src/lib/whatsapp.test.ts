import { describe, expect, it } from "vitest";
import { makeFmt } from "./format";
import { phoneForLink, receiptText, reminderText, waLink, type Reminder } from "./whatsapp";
import { waCustom, waProblem, withWa } from "./wa-messages";

describe("WhatsApp links", () => {
  it("adds the country code a number lacks", () => {
    expect(phoneForLink("+1 809-555-1234", "DOP")).toBe("18095551234");
    expect(phoneForLink("(809) 555 1234", "DOP")).toBe("18095551234");
    expect(phoneForLink("1 809 555 1234", "DOP")).toBe("18095551234");
    expect(phoneForLink("9 512 3456", "XCG")).toBe("59995123456");
    expect(phoneForLink("00599 9 512 3456", "DOP")).toBe("59995123456");
    expect(phoneForLink("555", "DOP")).toBeNull();
    expect(phoneForLink("717 1234", "USD")).toBe("5997171234");
    expect(phoneForLink("555 1234", "DOP")).toBeNull();
    expect(phoneForLink("212 555 1234", "USD")).toBe("12125551234");
  });
  it("carries the message", () => {
    expect(waLink("18095551234", "Hola José, ¿5 & 6?\n— P")).toBe("https://wa.me/18095551234?text=Hola%20Jos%C3%A9%2C%20%C2%BF5%20%26%206%3F%0A%E2%80%94%20P");
  });
});

describe("the business's own WhatsApp wording", () => {
  const t = (en: string) => en;
  const fmt = makeFmt({ currencyCode: "DOP", numberStyle: "comma_dot", dateStyle: "medium" }, "en", "2026-11-10");
  const due: Reminder = { loanId: "l1", loanNo: 12, client: "Marta Quiroga", phone: "18095550142", due: { kind: "tomorrow" }, amount: 150000, on: "2026-11-11" };

  it("sends the built-in reminder until the business writes its own", () => {
    expect(reminderText(due, t, fmt, "Préstamos Valdez")).toBe(
      "Hi Marta, a friendly reminder that your installment of RD$1,500.00 on loan #12 is due tomorrow, Nov 11, 2026. Thank you!\n— Préstamos Valdez",
    );
    const wording = withWa({}, "tomorrow", "Buenas {client}! Mañana {date} toca {amount} (#{loan}).\n{business}");
    expect(reminderText(due, t, fmt, "Préstamos Valdez", wording)).toBe("Buenas Marta! Mañana Nov 11, 2026 toca RD$1,500.00 (#12).\nPréstamos Valdez");
    expect(waCustom(withWa(wording, "tomorrow", null), "tomorrow")).toBeNull();
  });

  it("puts the business's opening and closing lines around the receipt's figures", () => {
    const base = { number: 7, business: "Préstamos Valdez", paidOn: "2026-11-10", amount: 300000, paidWith: null, principal: 200000, interest: 100000, fee: 0, loanNo: 12, balance: null, show: { split: false, lateFees: false, loanNumber: false, balance: false }, client: "Marta Quiroga" };
    const plain = receiptText(base, t, fmt);
    expect(plain.split("\n")[0]).toBe("Receipt #7 — Préstamos Valdez");
    expect(plain.endsWith("Thank you for your payment!")).toBe(true);
    let wording = withWa({}, "receiptTop", "Gracias {client}!");
    wording = withWa(wording, "receiptEnd", "");
    const own = receiptText({ ...base, wording }, t, fmt).split("\n");
    expect(own[0]).toBe("Gracias Marta!");
    expect(own[own.length - 1]).toBe("Paid: RD$3,000.00");
  });

  it("refuses a message that is too long", () => {
    expect(waProblem(t, withWa({}, "late", "x".repeat(1001)))).toMatch(/too long/);
    expect(waProblem(t, withWa({}, "late", "x".repeat(1000)))).toBeNull();
  });
});
