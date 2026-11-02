// Papiamentu and Dutch come from a catalog keyed by the English text: figures
// are carried across, and a text the catalog doesn't know falls back.

import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("translate", () => {
  it("finds exact texts and carries figures across", () => {
    expect(translate("pap", "Loans", "Préstamos")).toBe("Fiansanan");
    expect(translate("nl", "Loans", "Préstamos")).toBe("Leningen");
    expect(translate("pap", "Loan #12", "x")).toBe("Fiansa #12");
    expect(translate("pap", "Partly paid · RD$5.00 left", "x")).toBe("Pagá parsialmente · falta RD$5.00");
    expect(translate("nl", "3 days overdue · RD$5.00", "x")).toBe("3 dagen achterstallig · RD$5.00");
  });
  it("falls back to Spanish for Papiamentu and English for Dutch", () => {
    expect(translate("pap", "Not in the catalog", "No está")).toBe("No está");
    expect(translate("nl", "Not in the catalog", "No está")).toBe("Not in the catalog");
  });
});
