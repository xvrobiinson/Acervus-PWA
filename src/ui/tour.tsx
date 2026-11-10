// The welcome tour (2026-11-10, the owner's spec): a few short cards that
// point at the real parts of the Overview, one at a time, with Next, Back,
// "Step 2 of 6" and Skip tutorial. Nothing covers the app: it keeps working
// underneath, and leaving the Overview pauses the tour behind a small
// "Resume tour" pill. Offered once to someone new; finished or skipped, it
// stays away (kept with the account, so on every device and in the Windows
// app too), and Settings, Help and the account menu replay it. The Windows
// app's twin is src/ui/kit/tour.rs.

import { useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../../convex/_generated/api";
import { useT, type T } from "../lib/i18n";
import { useApp } from "../state/app";
import type { Role } from "../state/types";

/** Bumped when the tour gains steps worth showing again. */
export const TOUR_VERSION = 1;

interface Step {
  /** Where it points: the first of these that is on screen. None: a card in the middle. */
  targets: string[];
  title: string;
  text: string;
}

/** The tour for each role, from the welcome to the finish. */
export function tourSteps(t: T, role: Role | undefined): Step[] {
  const welcome: Step = {
    targets: [],
    title: t("Welcome to Acervus", "Bienvenido a Acervus"),
    text: t("A one-minute tour of the essentials. You can skip it now and replay it any time from your account menu.", "Un recorrido de un minuto por lo esencial. Puedes saltarlo ahora y repetirlo cuando quieras desde el menú de tu cuenta."),
  };
  const finish: Step = {
    targets: [],
    title: t("You're ready", "Todo listo"),
    text: t("That's the essentials. Start with the first steps on your Overview, and find this tour again in your account menu.", "Eso es lo esencial. Empieza con los primeros pasos de tu Resumen, y encuentra este recorrido de nuevo en el menú de tu cuenta."),
  };
  const clients = ['.hero-nav a[href="/clients"]', '.tabbar a[href="/clients"]'];
  // Phones keep Payments under More.
  const payments = ['.hero-nav a[href="/payments"]', '.tabbar a[href="/more"]'];
  const searchAccount: Step = {
    targets: [".hero-right"],
    title: t("Search and your account", "Buscar y tu cuenta"),
    text: t("Find anyone by name, phone or loan number. Settings, Help and this tour are in your account menu.", "Encuentra a cualquiera por nombre, teléfono o número de préstamo. Ajustes, Ayuda y este recorrido están en el menú de tu cuenta."),
  };
  if (role === "collector") {
    return [
      welcome,
      { targets: clients, title: t("Your clients", "Tus clientes"), text: t("The people assigned to you, with their loans and what each one owes.", "Las personas asignadas a ti, con sus préstamos y lo que debe cada una.") },
      { targets: [".fab"], title: t("Record a payment", "Registrar un pago"), text: t("Tap + whenever a client pays you. Choose the loan, type the amount, done.", "Toca + cada vez que un cliente te pague. Elige el préstamo, escribe el monto y listo.") },
      {
        targets: [],
        title: t("Pending confirmation", "Pendiente de confirmación"),
        text: t("What you collect counts once the office confirms the money reached them. Until then the client's receipt says “Pending confirmation”.", "Lo que cobras cuenta cuando la oficina confirma que el dinero le llegó. Hasta entonces el recibo del cliente dice “Pendiente de confirmación”."),
      },
      { targets: payments, title: t("Receipts and reminders", "Recibos y recordatorios"), text: t("Send a receipt or a reminder on WhatsApp from any payment or loan.", "Envía un recibo o un recordatorio por WhatsApp desde cualquier pago o préstamo.") },
      searchAccount,
      finish,
    ];
  }
  if (role === "viewer") {
    return [
      welcome,
      { targets: [".hero-figs"], title: t("The business at a glance", "El negocio de un vistazo"), text: t("What the business has, what is lent out and what is late. Tap the i on a card for what it means.", "Lo que tiene el negocio, lo prestado y lo atrasado. Toca la i de una tarjeta para ver qué significa.") },
      { targets: ['.hero-nav a[href="/reports"]', '.tabbar a[href="/more"]'], title: t("Portfolio", "Portafolio"), text: t("How the money has grown, month by month, and where it is now.", "Cómo ha crecido el dinero, mes a mes, y dónde está ahora.") },
      searchAccount,
      finish,
    ];
  }
  return [
    welcome,
    { targets: [".hero-figs"], title: t("Your business at a glance", "Tu negocio de un vistazo"), text: t("What you have, what is lent out and what is late. Tap the i on any card for what it means.", "Lo que tienes, lo prestado y lo atrasado. Toca la i de cualquier tarjeta para ver qué significa.") },
    { targets: [".today-card"], title: t("Needs attention today", "Requiere atención hoy"), text: t("What to deal with today: late loans, payments to confirm and what falls due this week.", "Lo que hay que atender hoy: préstamos atrasados, pagos por confirmar y lo que vence esta semana.") },
    { targets: [".fab"], title: t("Add from anywhere", "Agrega desde cualquier lugar"), text: t("The + button: a client, a loan, a payment, money in or out.", "El botón +: un cliente, un préstamo, un pago, entradas o salidas de dinero.") },
    { targets: clients, title: t("Clients and loans", "Clientes y préstamos"), text: t("Each client has their loans; each loan its installments, payments and receipts.", "Cada cliente tiene sus préstamos; cada préstamo sus cuotas, pagos y recibos.") },
    { targets: payments, title: t("Payments and WhatsApp", "Pagos y WhatsApp"), text: t("Record a payment in seconds, then send the receipt or a reminder on WhatsApp.", "Registra un pago en segundos y luego envía el recibo o un recordatorio por WhatsApp.") },
    searchAccount,
    finish,
  ];
}

interface TourCtx {
  /** Opens the tour at the welcome (Settings, Help, the account menu). */
  start: () => void;
}
const Ctx = createContext<TourCtx>({ start: () => {} });
export const useTour = () => useContext(Ctx);

const localKey = (who: string) => `acervus.tour.${who}`;
function readLocal(who: string): string | null {
  try {
    return localStorage.getItem(localKey(who));
  } catch {
    return null;
  }
}
function writeLocal(who: string, v: string) {
  try {
    localStorage.setItem(localKey(who), v);
  } catch {
    /* storage blocked: the account still keeps it */
  }
}

/** Provides the tour and shows it over the signed-in app. */
export function TourProvider({ role, children }: { role: Role | undefined; children: ReactNode }) {
  const t = useT();
  const { mode, user } = useApp();
  const online = mode === "online";
  const who = user?.id ?? "demo";
  const remote = useQuery(api.prefs.mine, online ? {} : "skip");
  const save = useMutation(api.prefs.save);
  const [at, setAt] = useState<number | null>(null);
  const offered = useRef(false);
  const { pathname } = useLocation();
  const steps = useMemo(() => tourSteps(t, role), [t, role]);

  const remember = useCallback(
    (how: "done" | "skipped") => {
      const v = `${how}:${TOUR_VERSION}`;
      writeLocal(who, v);
      if (online) void save({ tour: v }).catch(() => {});
    },
    [who, online, save],
  );

  // Offered once to someone who hasn't finished or skipped it: on the
  // Overview, a moment after it opens (the splash is gone by then).
  const known = online ? (remote === undefined ? undefined : (remote.tour ?? readLocal(who))) : readLocal(who);
  useEffect(() => {
    if (offered.current || known === undefined || known !== null || pathname !== "/") return;
    // Marked offered only when it opens: an effect that runs twice (React's
    // development check) cancels its first timer and starts another.
    const id = setTimeout(() => {
      offered.current = true;
      setAt(0);
    }, 1400);
    return () => clearTimeout(id);
  }, [known, pathname]);

  const ctx = useMemo(() => ({ start: () => setAt(0) }), []);
  const close = (how: "done" | "skipped") => {
    setAt(null);
    remember(how);
  };
  return (
    <Ctx.Provider value={ctx}>
      {children}
      {at !== null && <TourCard steps={steps} at={at} onAt={setAt} onClose={close} />}
    </Ctx.Provider>
  );
}

/** The first of `targets` that is on screen and visible. */
function find(targets: string[]): HTMLElement | null {
  for (const s of targets) {
    for (const el of document.querySelectorAll<HTMLElement>(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

function TourCard({ steps, at, onAt, onClose }: { steps: Step[]; at: number; onAt: (n: number) => void; onClose: (how: "done" | "skipped") => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const step = steps[at];
  const last = at === steps.length - 1;
  const counted = steps.length - 2;
  const card = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const away = pathname !== "/";
  // Which way the person went last: a missing step is skipped that way, so
  // Back never bounces forward again.
  const back = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Follow the target (scrolling, resizing); a step whose target isn't on
  // screen (hidden by Arrange, a phone without it) skips itself.
  useLayoutEffect(() => {
    if (away) return;
    if (step.targets.length === 0) {
      setBox(null);
      return;
    }
    const el = find(step.targets);
    if (!el) {
      if (back.current && at > 0) onAt(at - 1);
      else onAt(at + 1 < steps.length ? at + 1 : at);
      return;
    }
    const r0 = el.getBoundingClientRect();
    if (r0.top < 70 || r0.bottom > window.innerHeight - 140) el.scrollIntoView({ block: "center", behavior: "smooth" });
    let frame = 0;
    let last = "";
    const follow = () => {
      // Drawn again only when it moved.
      const r = el.getBoundingClientRect();
      const key = `${r.top},${r.left},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        setBox(r);
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [at, step, steps.length, away, onAt]);

  // The card beside its target: under it when there is room, else above;
  // on phones it sits at the bottom like a sheet (CSS).
  useLayoutEffect(() => {
    const c = card.current;
    if (!c || !box) return setPlace(null);
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const below = box.bottom + 14 + h < window.innerHeight - 12;
    const top = below ? box.bottom + 14 : Math.max(12, box.top - 14 - h);
    const left = Math.min(Math.max(12, box.left + box.width / 2 - w / 2), window.innerWidth - w - 12);
    setPlace({ top, left });
  }, [box]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current("skipped");
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  if (away) {
    return (
      <button type="button" className="tour-resume" onClick={() => navigate("/")}>
        {t("Resume tour", "Seguir el recorrido")}
      </button>
    );
  }
  const pad = 6;
  return (
    <>
      {box && (
        <div
          className="tour-ring"
          aria-hidden="true"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      )}
      <div
        ref={card}
        className={`tour-card ${box ? "pointing" : "centered"}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        style={box && place ? { top: place.top, left: place.left } : undefined}
        key={at}
      >
        {at > 0 && !last && (
          <div className="tour-progress">
            <span>{t(`Step ${at} of ${counted}`, `Paso ${at} de ${counted}`)}</span>
            <span className="tour-dots" aria-hidden="true">
              {Array.from({ length: counted }, (_, i) => (
                <i key={i} className={i + 1 === at ? "on" : i + 1 < at ? "past" : ""} />
              ))}
            </span>
          </div>
        )}
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-acts">
          {!last && (
            <button type="button" className="tour-skip" onClick={() => onClose("skipped")}>
              {t("Skip tutorial", "Saltar el recorrido")}
            </button>
          )}
          <span className="grow" />
          {at > 1 && !last && (
            <button type="button" className="btn small" onClick={() => {
                back.current = true;
                onAt(at - 1);
              }}>
              {t("Back", "Atrás")}
            </button>
          )}
          {last ? (
            <button type="button" className="btn small primary" onClick={() => onClose("done")}>
              {t("Finish", "Terminar")}
            </button>
          ) : (
            <button type="button" className="btn small primary" onClick={() => {
                back.current = false;
                onAt(at + 1);
              }} autoFocus>
              {at === 0 ? t("Start", "Empezar") : t("Next", "Siguiente")}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
