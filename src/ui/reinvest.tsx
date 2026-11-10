// Keep as profit / Reinvest / Split (0.15): where each payment's interest
// goes. Late fees always stay profit.

import { useT } from "../lib/i18n";
import { Segmented } from "./kit";

type Way = "keep" | "reinvest" | "split";
const wayOf = (p: number): Way => (p <= 0 ? "keep" : p >= 100 ? "reinvest" : "split");

export function ReinvestPicker({ value, onChange, label }: { value: number; onChange: (p: number) => void; label: string }) {
  const t = useT();
  const way = wayOf(value);
  return (
    <div className="row reinvest-pick">
      <Segmented<Way>
        label={label}
        value={way}
        onChange={(w) => onChange(w === "keep" ? 0 : w === "reinvest" ? 100 : value > 0 && value < 100 ? value : 50)}
        options={[
          ["keep", t("Keep as profit", "Dejar como ganancia")],
          ["reinvest", t("Reinvest", "Reinvertir")],
          ["split", t("Split", "Dividir")],
        ]}
      />
      {way === "split" && (
        <label className="row reinvest-pct">
          <input
            className="input money"
            inputMode="numeric"
            aria-label={t("Percent reinvested", "Porcentaje reinvertido")}
            value={String(value)}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/\D/g, "") || "0");
              onChange(Math.min(Math.max(n, 1), 99));
            }}
          />
          <span className="small muted">{t("% reinvested", "% reinvertido")}</span>
        </label>
      )}
    </div>
  );
}
