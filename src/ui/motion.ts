// Motion helpers for what CSS can't do alone: numbers that count up, items
// that stay a moment to slide away, and one switch for people who asked
// their device for less motion (then everything shows at once, still).

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** The person asked for less motion. Read once per call; cheap. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches;
}

/** The same, kept up to date for a component. */
export function useReducedMotion(): boolean {
  const [still, setStill] = useState(reducedMotion);
  useEffect(() => {
    const m = window.matchMedia?.(QUERY);
    if (!m) return;
    const on = () => setStill(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return still;
}

/** Eases a number from 0 to `target` the first time it is shown, then
 *  follows changes at once (a live total never animates on every update). */
export function useCountUp(target: number, ms = 800): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  const now = useRef(shown);
  const done = useRef(reducedMotion());
  useEffect(() => {
    if (done.current) {
      now.current = target;
      setShown(target);
      return;
    }
    // From wherever it is (a new figure mid-count carries on from there).
    const from = now.current;
    let frame = 0;
    const t0 = performance.now();
    const tick = (at: number) => {
      const p = Math.min(1, (at - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      now.current = p < 1 ? from + (target - from) * eased : target;
      setShown(now.current);
      if (p < 1) frame = requestAnimationFrame(tick);
      else done.current = true;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return shown;
}

export interface Presence<T> {
  item: T;
  /** Gone from the list; shown a moment longer to slide away. */
  leaving: boolean;
}

/** The list, plus items just removed from it, each kept in its old place for
 *  `ms` so it can slide away instead of vanishing. */
export function usePresence<T>(items: T[], key: (t: T) => string, ms = 320): Presence<T>[] {
  const last = useRef<T[]>(items);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [leaving, setLeaving] = useState<Map<string, { item: T; index: number }>>(new Map());
  const now = new Set(items.map(key));
  const gone = reducedMotion() ? [] : last.current.map((item, index) => ({ item, index })).filter(({ item }) => !now.has(key(item)));
  useEffect(() => {
    if (gone.length === 0) {
      last.current = items;
      return;
    }
    setLeaving((m) => {
      const next = new Map(m);
      for (const g of gone) next.set(key(g.item), g);
      return next;
    });
    last.current = items;
    const ids = gone.map((g) => key(g.item));
    // Not cleared on the next render (the list is a new array each time);
    // only when the component goes away.
    timers.current.push(
      setTimeout(
        () =>
          setLeaving((m) => {
            const next = new Map(m);
            for (const id of ids) next.delete(id);
            return next;
          }),
        ms,
      ),
    );
    // `gone` is derived from `items`; listing it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const out: Presence<T>[] = items.map((item) => ({ item, leaving: false }));
  const all = new Map(leaving);
  for (const g of gone) all.set(key(g.item), g);
  for (const [id, g] of [...all].sort((a, b) => a[1].index - b[1].index)) {
    if (now.has(id)) continue;
    out.splice(Math.min(g.index, out.length), 0, { item: g.item, leaving: true });
  }
  return out;
}

/** Slides the `[data-flip]` items inside `ref` from where they were to
 *  where they now are, when a rearrangement was announced with `capture()`
 *  just before it happened. Positions are taken relative to the container,
 *  so scrolling never sets things moving. */
export function useFlip<T extends HTMLElement>(ref: { current: T | null }, change: unknown) {
  const before = useRef<Map<string, { x: number; y: number }> | null>(null);
  const places = () => {
    const box = ref.current?.getBoundingClientRect();
    const out = new Map<string, { x: number; y: number }>();
    if (!box) return out;
    ref.current!.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r = el.getBoundingClientRect();
      out.set(el.dataset.flip!, { x: r.left - box.left, y: r.top - box.top });
    });
    return out;
  };
  useLayoutEffect(() => {
    const was = before.current;
    before.current = null;
    if (!was || reducedMotion() || !ref.current) return;
    const now = places();
    ref.current.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const a = was.get(el.dataset.flip!);
      const b = now.get(el.dataset.flip!);
      if (!b) return;
      if (!a) {
        el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "cubic-bezier(.23, 1, .32, 1)" });
        return;
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.23, 1, .32, 1)" });
    });
    // `change` is what moved things; the rest is read from the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change]);
  return { capture: () => (before.current = places()) };
}
