// Shows a receipt and prints it (the print dialog also saves a PDF), or
// downloads it as an HTML file.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LateFeeRecord, LoanRecord, PaymentRecord } from "../../shared/domain/records";
import { useT } from "../lib/i18n";
import { useBooks } from "../state/app";
import { Button, Empty, Segmented, Sheet } from "../ui/kit";
import { loanReceiptHtml, PAPERS, paymentReceiptHtml, pendingReceiptHtml, type Paper, type ReceiptContext } from "./receipt";

/** The paper this device prints receipts on (a thermal printer's roll or
 *  Letter), remembered on this device. */
const PAPER_KEY = "acervus.paper";
function usePaper(): [Paper, (p: Paper) => void] {
  const [paper, setPaper] = useState<Paper>(() => {
    try {
      const v = localStorage.getItem(PAPER_KEY) as Paper | null;
      return v && PAPERS.includes(v) ? v : "letter";
    } catch {
      return "letter";
    }
  });
  const save = (p: Paper) => {
    setPaper(p);
    try {
      localStorage.setItem(PAPER_KEY, p);
    } catch {
      /* storage blocked: it applies until the app closes */
    }
  };
  return [paper, save];
}

/** Width of the page on screen, in CSS pixels (96 per inch). */
const PAPER_PX: Record<Paper, number> = { letter: 816, "58mm": 219, "80mm": 302, "112mm": 423 };

/** The logo as a data: URL, so it is inside the receipt (prints offline once loaded). */
function useLogo(url: string | null | undefined): string | null {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return setData(null);
    let alive = true;
    fetch(url)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.readAsDataURL(b);
          }),
      )
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

/** `pending`: a collector's payment waiting for an admin (no balances yet). */
export function ReceiptSheet({ kind, id, onClose }: { kind: "payment" | "loan" | "pending"; id: string; onClose: () => void }) {
  const t = useT();
  const { snapshot, fmt } = useBooks();
  const logo = useLogo(snapshot.settings?.logoUrl);
  const frame = useRef<HTMLIFrameElement>(null);
  const [chosenPaper, setPaper] = usePaper();
  // A loan receipt is the client's agreement: always a Letter page.
  const paper: Paper = kind === "loan" ? "letter" : chosenPaper;
  const html = useMemo(() => {
    const s = snapshot.settings;
    if (!s) return null;
    const c: ReceiptContext = { t, fmt, settings: s, businessName: snapshot.business.name, logo, paper };
    const pending = kind === "pending" ? snapshot.pending.find((p) => p._id === id) : undefined;
    const loanId = kind === "loan" ? id : kind === "pending" ? pending?.loanId : snapshot.payments.find((p) => p._id === id)?.loanId;
    const loan = snapshot.loans.find((l) => l._id === loanId);
    const client = loan && snapshot.clients.find((x) => x._id === loan.clientId);
    if (!loan || !client) return null;
    if (pending) return pendingReceiptHtml(c, { loan: loan as unknown as LoanRecord, client, pending });
    return kind === "loan"
      ? loanReceiptHtml(c, { loan: loan as unknown as LoanRecord, client })
      : paymentReceiptHtml(c, {
          loan: loan as unknown as LoanRecord,
          client,
          payments: snapshot.payments as unknown as PaymentRecord[],
          lateFees: snapshot.lateFees as unknown as LateFeeRecord[],
          paymentId: id,
        });
  }, [snapshot, kind, id, t, fmt, logo, paper]);
  const fit = () => {
    // Scale the Letter page to the screen; printing uses the real size.
    const doc = frame.current?.contentDocument;
    if (doc) doc.documentElement.style.setProperty("--fit", String(Math.min(1, (frame.current!.clientWidth - 8) / (PAPER_PX[paper] + 32))));
  };
  const download = () => {
    if (!html) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `${kind === "loan" ? "loan" : "receipt"}-${id.slice(-6)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return (
    <Sheet
      wide
      title={kind === "loan" ? t("Loan receipt", "Recibo del préstamo") : t("Payment receipt", "Recibo de pago")}
      onClose={onClose}
      footer={
        <>
          <Button icon="download" onClick={download} disabled={!html}>
            {t("Download", "Descargar")}
          </Button>
          <Button variant="primary" icon="printer" disabled={!html} onClick={() => frame.current?.contentWindow?.print()}>
            {t("Print / PDF", "Imprimir / PDF")}
          </Button>
        </>
      }
    >
      {html ? (
        <>
          {kind !== "loan" && (
            <div className="receipt-paper">
              <Segmented
                label={t("Paper", "Papel")}
                value={paper}
                onChange={setPaper}
                options={PAPERS.map((p) => [p, p === "letter" ? t("Letter", "Carta") : p.replace("mm", " mm")] as [Paper, string])}
              />
            </div>
          )}
          <iframe ref={frame} className="receipt-frame" title={t("Receipt", "Recibo")} srcDoc={html} onLoad={fit} />
          <p className="micro muted">
            {paper === "letter"
              ? t(
                  "To save a PDF, choose Print and then “Save as PDF” (on iPhone: Share › Save to Files). Letter paper.",
                  "Para guardar un PDF, elige Imprimir y luego “Guardar como PDF” (en iPhone: Compartir › Guardar en Archivos). Papel carta.",
                )
              : t(
                  "For a receipt printer: in the print window choose the printer and its roll size, margins None. Rolls always print the short receipt. This device remembers the paper.",
                  "Para una impresora de recibos: en la ventana de impresión elige la impresora y el tamaño del rollo, márgenes Ninguno. En rollo siempre sale el recibo corto. Este dispositivo recuerda el papel.",
                )}
          </p>
        </>
      ) : (
        // Everything a receipt needs is already on this device; missing means
        // the record or the receipt settings aren't there, not still loading.
        <Empty icon="receipt">{t("This receipt can't be shown: its record or the receipt settings are missing.", "No se puede mostrar este recibo: falta su registro o la configuración de recibos.")}</Empty>
      )}
    </Sheet>
  );
}
