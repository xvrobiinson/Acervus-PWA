import { describe, expect, it } from "vitest";
import type { LateFeeRecord, LoanRecord, PaymentRecord } from "../../shared/domain/records";
import snap from "../demo/snapshot.json";
import { makeFmt } from "../lib/format";
import { receiptText } from "../lib/whatsapp";
import { nextAfterPayment, paymentReceiptHtml, receiptShow, type Paper, type ReceiptContext, type ReceiptFormat } from "./receipt";

// The demo books (src/demo/snapshot.json): loan #9 is a monthly declining
// loan with late installments; loan #1 pays interest only.
const s = snap as unknown as {
  today: string;
  settings: ReceiptContext["settings"] & { currencyCode: string; numberStyle: "comma_dot"; dateStyle: "medium" };
  business: { name: string };
  loans: LoanRecord[];
  payments: PaymentRecord[];
  lateFees: LateFeeRecord[];
  clients: { _id: string; fullName: string; idNumber: string; phone: string; address: string }[];
};
const t = (en: string) => en;
const fmt = makeFmt(s.settings, "en", s.today);
const loanNo = (n: number) => s.loans.find((l) => l.recordNo === n)!;
const lastPayment = (l: LoanRecord) => s.payments.filter((p) => p.loanId === l._id).sort((a, b) => (a.paidOn < b.paidOn ? 1 : -1))[0];
const html = (n: number, receiptFormat: ReceiptFormat, paper: Paper = "letter") => {
  const loan = loanNo(n);
  const c: ReceiptContext = { t, fmt, settings: { ...s.settings, receiptFormat }, businessName: s.business.name, logo: null, paper };
  const client = s.clients.find((x) => x._id === loan.clientId)!;
  return paymentReceiptHtml(c, { loan, client, payments: s.payments, lateFees: s.lateFees, paymentId: lastPayment(loan)._id })!;
};

describe("next payment after a payment", () => {
  it("is the next installment plus everything late", () => {
    const loan = loanNo(9);
    expect(nextAfterPayment(loan, s.payments, s.lateFees, lastPayment(loan)._id)).toEqual({ on: "2026-11-01", amount: 771740, late: 503740, interest: false });
  });

  it("is the next interest payment on an interest-only loan", () => {
    const loan = loanNo(1);
    const next = nextAfterPayment(loan, s.payments, s.lateFees, lastPayment(loan)._id);
    expect(next?.interest).toBe(true);
    expect(next!.on! > lastPayment(loan).paidOn).toBe(true);
    expect(next!.amount).toBeGreaterThan(0);
  });
});

describe("payment receipt format", () => {
  it("prints the full schedule unless the business chose the next payment", () => {
    expect(html(9, "full")).toContain("Payment history");
    const short = html(9, "next");
    expect(short).not.toContain("Payment history");
    expect(short).not.toContain("Installments ·");
    expect(short).toContain("Your next payment");
    expect(short).toContain("Includes RD$5,037.40 that is already late");
    expect(short).toContain("RD$7,717.40");
  });

  it("names the next interest payment on interest-only loans", () => {
    expect(html(1, "next")).toContain("Your next interest payment");
  });

  it("prints the short receipt on every roll, one column wide", () => {
    for (const paper of ["58mm", "80mm", "112mm"] as Paper[]) {
      const roll = html(9, "full", paper);
      expect(roll).toContain("Your next payment");
      expect(roll).not.toContain("Payment history");
      expect(roll).toContain(`width:${paper.replace("mm", "")}mm`);
    }
  });
});

describe("WhatsApp receipt text", () => {
  it("adds the next payment when the business chose it", () => {
    const loan = loanNo(9);
    const p = lastPayment(loan);
    const base = { number: p.recordNo, business: "B", paidOn: p.paidOn, amount: p.amount, paidWith: null, principal: p.principal, interest: p.interest, fee: p.fee, loanNo: 9, balance: null, show: receiptShow(s.settings) };
    const next = nextAfterPayment(loan, s.payments, s.lateFees, p._id);
    expect(receiptText({ ...base, format: "full", next }, t, fmt)).not.toContain("Next payment");
    const text = receiptText({ ...base, format: "next", next }, t, fmt);
    expect(text).toContain("Next payment: RD$7,717.40 by Nov 1, 2026");
    expect(text).toContain("(includes RD$5,037.40 already late)");
  });
});
