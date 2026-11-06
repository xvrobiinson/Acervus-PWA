// The growth chart: portfolio value (a smooth line over a soft fill) against
// capital invested (a thin dashed step line), from real end-of-day values.
// A few faint guide lines, a crosshair with the day's figures under the
// pointer, and the newest point glowing.

import { useEffect, useRef, useState } from "react";
import type { HistoryPoint } from "../../shared/domain/portfolio";
import type { Fmt } from "../lib/format";
import { useT } from "../lib/i18n";

/** A smooth path through the points that never overshoots them (monotone cubic). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return "";
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) m.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0] || 1));
  const tan: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) tan.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  tan.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / m[i];
    const b = tan[i + 1] / m[i];
    const q = a * a + b * b;
    if (q > 9) {
      const k = 3 / Math.sqrt(q);
      tan[i] = k * a * m[i];
      tan[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    d += `C${(pts[i][0] + dx).toFixed(1)},${(pts[i][1] + tan[i] * dx).toFixed(1)} ${(pts[i + 1][0] - dx).toFixed(1)},${(pts[i + 1][1] - tan[i + 1] * dx).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

/** Round guide-line values that cover lo..hi in 3 to 5 steps. */
function ticks(lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo);
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => span / s <= 5) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

function Pulse({ x, y }: { x: number; y: number }) {
  return (
    <g className="pdot" transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
      <circle className="pulse-ring" r="4.5" />
      <circle className="pulse-ring r2" r="4.5" />
      <circle className="pulse-core" r="4.5" />
    </g>
  );
}

export function GrowthChart({ points, fmt, label }: { points: HistoryPoint[]; fmt: Fmt; label: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = () => setW(Math.max(280, Math.round(el.clientWidth)));
    size();
    const watch = new ResizeObserver(size);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  if (points.length < 2) return null;
  const H = 240;
  const pad = { l: 52, r: 10, t: 12, b: 26 };
  const values = points.flatMap((p) => [p.portfolioValue, p.netInvested]);
  const gl = ticks(Math.min(...values), Math.max(...values));
  const lo = gl[0];
  const hi = gl[gl.length - 1] === lo ? lo + 100 : gl[gl.length - 1];
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = smooth(points.map((p, i) => [x(i), y(p.portfolioValue)]));
  const area = `${line}L${x(points.length - 1).toFixed(1)},${H - pad.b}L${x(0).toFixed(1)},${H - pad.b}Z`;
  let cap = `M${x(0).toFixed(1)},${y(points[0].netInvested).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) cap += `H${x(i).toFixed(1)}V${y(points[i].netInvested).toFixed(1)}`;
  const last = points.length - 1;
  const mid = Math.floor(points.length / 2);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const mx = ((clientX - r.left) / r.width) * W;
    setAt(Math.max(0, Math.min(last, Math.round(((mx - pad.l) / (W - pad.l - pad.r)) * last))));
  };
  const p = at === null ? null : points[at];
  const g = p ? p.portfolioValue - p.netInvested : 0;
  return (
    <figure className="chart growth" style={{ margin: 0 }} aria-label={label}>
      <div className="chart-box" ref={box}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={label}
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={() => setAt(null)}
        >
          <defs>
            <linearGradient id="growth-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="fill-top" />
              <stop offset="1" className="fill-bottom" />
            </linearGradient>
          </defs>
          {gl.map((v) => (
            <g key={v}>
              <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} />
              <text className="tick" x={pad.l - 10} y={y(v) + 4} textAnchor="end">
                {fmt.compact(v)}
              </text>
            </g>
          ))}
          <path d={area} fill="url(#growth-fill)" />
          <path className="line2" d={cap} />
          <path className="line" d={line} />
          {p === null ? (
            <Pulse x={x(last)} y={y(points[last].portfolioValue)} />
          ) : (
            <g>
              <line className="cross" x1={x(at!)} x2={x(at!)} y1={pad.t} y2={H - pad.b} />
              <circle className="cap-dot" cx={x(at!)} cy={y(p.netInvested)} r="3.5" />
              <Pulse x={x(at!)} y={y(p.portfolioValue)} />
            </g>
          )}
          <text className="tick" x={pad.l} y={H - 6}>
            {fmt.dayShort(points[0].date)}
          </text>
          <text className="tick" x={(pad.l + W - pad.r) / 2} y={H - 6} textAnchor="middle">
            {fmt.dayShort(points[mid].date)}
          </text>
          <text className="tick" x={W - pad.r} y={H - 6} textAnchor="end">
            {fmt.dayShort(points[last].date)}
          </text>
        </svg>
        {p && (
          <div className="chart-tip" style={x(at!) + 220 > W ? { right: W - x(at!) + 14 } : { left: x(at!) + 14 }}>
            <div className="td">{fmt.day(p.date)}</div>
            <div className="tr">
              <span>{t("Portfolio value", "Valor del portafolio")}</span>
              <b className="num">{fmt.money(p.portfolioValue)}</b>
            </div>
            <div className="tr">
              <span>{t("Capital invested", "Capital invertido")}</span>
              <span className="num">{fmt.money(p.netInvested)}</span>
            </div>
            <div className="tr">
              <span>{t("Gain", "Ganancia")}</span>
              <span className={`num ${g >= 0 ? "pos" : "neg"}`}>{fmt.signed(g)}</span>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
