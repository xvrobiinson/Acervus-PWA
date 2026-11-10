// The landing hero's app window: the web app recording a payment, told with
// real screenshots (public/landing/hero, demo data in US$) and a drawn
// pointer. Overview → + → Record payment → pick the loan → type 3000 → save
// → "Payment saved" → Payments, then again. It follows the page's language
// and light or dark, waits until its pictures are in, pauses out of view or
// in a hidden tab, and stays on the still Overview with reduced motion.
//
// The pictures are 1200 x 900; everything placed over them uses that space,
// as percentages, so it scales with the window. They were taken from the web
// app's demo (built with the demo books in US$, and a copy with the payment
// recorded for the last two), with the spots below measured from the real
// buttons in each language. Retaken 2026-11-10 in the clean look.

import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../ui/motion";

const W = 1200;
const H = 900;
const FRAMES = ["overview", "menu", "form", "loan", "filled", "after", "payments"] as const;
type Frame = (typeof FRAMES)[number];
type Box = [number, number, number, number];

/** Where things are in the pictures (measured; Spanish labels move two). */
const AT = {
  rest: [690, 560] as [number, number],
  add: [1148, 844] as [number, number], // the + button
  record: { en: [1090, 783], es: [1095, 783] } as Record<"en" | "es", [number, number]>, // its Record payment
  loan: [600, 328] as [number, number], // the form's loan field
  amount: [465, 336] as [number, number], // the amount field
  typed: [519, 318, 582, 354] as Box, // where the digits go (the field is right-aligned)
  textRight: 581, // where the amount's text ends
  sample: [506, 336] as [number, number], // a spot of the field's own color
  save: [800, 842] as [number, number], // the form's Save payment
  payments: { en: [508, 36], es: [532, 36] } as Record<"en" | "es", [number, number]>, // the nav's Payments
  overdue: [1003, 222, 1140, 247] as Box, // the Overdue amount figure
  newRow: [42, 337, 1158, 389] as Box, // today's payment on Payments
};

const pc = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (el: HTMLElement, [x0, y0, x1, y1]: Box) =>
  Object.assign(el.style, { left: pc(x0, W), top: pc(y0, H), width: pc(x1 - x0, W), height: pc(y1 - y0, H) });

/** Light or dark as the landing page shows it (its CSS decides). */
function pageTheme(): "light" | "dark" {
  return getComputedStyle(document.documentElement).getPropertyValue("--lp-light").trim() === "none" ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (typeof window === "undefined" ? "light" : pageTheme()));
  useEffect(() => {
    const check = () => setTheme(pageTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", check);
    const watch = new MutationObserver(check);
    watch.observe(document.documentElement, { attributes: true });
    check();
    return () => {
      media.removeEventListener("change", check);
      watch.disconnect();
    };
  }, []);
  return theme;
}

export function HeroDemo({ es, alt, saved }: { es: boolean; alt: string; saved: string }) {
  const theme = useTheme();
  const lang = es ? "es" : "en";
  const src = (f: Frame) => `/landing/hero/${f}-${lang}-${theme}.jpg`;
  // The first picture alone at first; the rest once it is in.
  const [all, setAll] = useState(false);
  const win = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = win.current;
    if (!root || !all || reducedMotion()) return;
    const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    const imgs = Object.fromEntries(FRAMES.map((f) => [f, q<HTMLImageElement>(`img[data-f="${f}"]`)])) as Record<Frame, HTMLImageElement>;
    const cover = q<HTMLDivElement>(".lp-demo-cover");
    const caret = q<HTMLDivElement>(".lp-demo-caret");
    const cursor = q<HTMLDivElement>(".lp-demo-cursor");
    const toast = q<HTMLDivElement>(".lp-demo-toast");
    const glow = q<HTMLDivElement>(".lp-demo-glow");
    place(cover, AT.typed);

    let stopped = false;
    let inView = true;
    let shown = !document.hidden;
    const playing = () => inView && shown;
    const seen = new IntersectionObserver(([e]) => (inView = e.isIntersecting), { threshold: 0.2 });
    seen.observe(root);
    const onVisible = () => (shown = !document.hidden);
    document.addEventListener("visibilitychange", onVisible);

    // Time that only runs while the window is in view.
    const run = (ms: number, each?: (k: number) => void) =>
      new Promise<void>((resolve, reject) => {
        let t = 0;
        let last = performance.now();
        const tick = (now: number) => {
          if (stopped) return reject(new Error("stopped"));
          if (playing()) t += now - last;
          last = now;
          const k = Math.min(1, t / ms);
          each?.(k);
          if (k < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    const wait = (ms: number) => run(ms);

    let pos: [number, number] = [...AT.rest];
    const point = ([x, y]: [number, number]) => {
      pos = [x, y];
      cursor.style.left = pc(x, W);
      cursor.style.top = pc(y, H);
    };
    // Along a gentle curve, easing in and out.
    const move = (to: [number, number], ms: number) => {
      const from = pos;
      const bend = [(from[0] + to[0]) / 2 + (to[1] - from[1]) * 0.12, (from[1] + to[1]) / 2 - (to[0] - from[0]) * 0.08];
      return run(ms, (k) => {
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const u = 1 - e;
        point([u * u * from[0] + 2 * u * e * bend[0] + e * e * to[0], u * u * from[1] + 2 * u * e * bend[1] + e * e * to[1]]);
      });
    };
    const click = async () => {
      cursor.classList.add("down");
      const ring = document.createElement("div");
      ring.className = "lp-demo-ripple";
      ring.style.left = pc(pos[0], W);
      ring.style.top = pc(pos[1], H);
      root.appendChild(ring);
      setTimeout(() => ring.remove(), 600);
      await wait(130);
      cursor.classList.remove("down");
    };
    const show = (frame: Frame, instant = false) => {
      for (const f of FRAMES) {
        imgs[f].classList.toggle("instant", instant);
        imgs[f].classList.toggle("on", f === frame);
      }
    };
    const point_at = (box: Box | null) => {
      if (box) place(glow, box);
      glow.classList.toggle("on", !!box);
    };
    // The first `n` digits of the amount, written over the field (it is
    // right-aligned, so they grow to the left), the text cursor after them.
    const typed = (n: number) => {
      const [, y0, , y1] = AT.typed;
      cover.hidden = caret.hidden = n === 0;
      cover.textContent = "3000".slice(0, n);
      cover.style.fontSize = `${(root.clientWidth * 16) / W}px`;
      place(caret, [AT.textRight + 0.5, y0 + 6, AT.textRight + 1.9, y1 - 6]);
    };
    // The field's own color hides its "0.00"; the digits take the field's ink.
    const fieldColor = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const g = c.getContext("2d")!;
        g.drawImage(imgs.loan, AT.sample[0], AT.sample[1], 1, 1, 0, 0, 1, 1);
        const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
        cover.style.background = `rgb(${r}, ${gr}, ${b})`;
        cover.style.color = caret.style.color = r + gr + b > 384 ? "#1a1d21" : "#eceef0";
      } catch {
        /* the picture keeps its "0.00" under the digits */
      }
    };

    const story = async () => {
      // Every picture in, and the window tilted in.
      await Promise.all(Object.values(imgs).map((i) => i.decode().catch(() => {})));
      fieldColor();
      await wait(1200);
      if (stopped) return;
      cursor.hidden = false;
      for (;;) {
        show("overview");
        toast.classList.remove("on");
        point_at(null);
        typed(0);
        await wait(1200);
        await move(AT.add, 1100);
        await click();
        show("menu");
        await wait(600);
        await move(AT.record[lang], 600);
        await click();
        show("form");
        await wait(700);
        await move(AT.loan, 800);
        await click();
        show("loan");
        await wait(650);
        await move(AT.amount, 650);
        await click();
        await wait(250);
        for (let n = 1; n <= 4; n++) {
          typed(n);
          await wait(n === 1 ? 150 : 190);
        }
        await wait(250);
        show("filled", true);
        typed(0);
        await wait(900);
        await move(AT.save, 900);
        await click();
        show("after");
        await wait(200);
        toast.classList.add("on");
        point_at(AT.overdue);
        await move([1000, 520], 900);
        await wait(1500);
        point_at(null);
        toast.classList.remove("on");
        await move(AT.payments[lang], 1000);
        await click();
        show("payments");
        await wait(350);
        point_at(AT.newRow);
        await move([700, 430], 900);
        await wait(1900);
        point_at(null);
        await move(AT.rest, 800);
      }
    };
    point(AT.rest);
    story().catch(() => {});
    return () => {
      stopped = true;
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      cursor.hidden = true;
      cursor.classList.remove("down");
      typed(0);
      point_at(null);
      toast.classList.remove("on");
      show("overview", true);
    };
  }, [all, lang, theme]);

  // Changing language or theme: the new first picture, then the rest.
  useEffect(() => setAll(false), [lang, theme]);

  return (
    <div className="lp-hero-shot lp-demo" ref={win} role="img" aria-label={alt}>
      {FRAMES.filter((f) => all || f === "overview").map((f) => (
        <img
          key={f}
          data-f={f}
          className={f === "overview" ? "on instant" : ""}
          src={src(f)}
          alt=""
          decoding="async"
          fetchPriority={f === "overview" ? "high" : "low"}
          onLoad={f === "overview" ? () => setTimeout(() => setAll(true), 300) : undefined}
        />
      ))}
      <div className="lp-demo-cover" hidden />
      <div className="lp-demo-caret" hidden />
      <div className="lp-demo-glow" />
      <div className="lp-demo-toast" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.3 2.4 2.4 4.8-5" />
        </svg>
        {saved}
      </div>
      <div className="lp-demo-cursor" aria-hidden="true" hidden>
        <svg viewBox="0 0 24 30">
          <path d="M2 1.5v23.2l6.1-5.6 3.9 9.1 4.1-1.8-3.9-8.9h8.3z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
