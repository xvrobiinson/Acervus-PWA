// The signed-in app's hero header (wide screens): the section nav and, on
// the right, search, the bell and the account icon; under it today's date,
// a greeting and the business (its logo and name open the switcher). Both
// rows stay on top while scrolling and on every page. The Overview adds its
// figures under them and its own buttons beside the business, through the
// two slots here; they fold away as the page scrolls.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useT } from "../lib/i18n";
import { useApp, useBooks } from "../state/app";
import { ReportsButton } from "../screens/reports-panel";
import { BusinessSwitch } from "./account";
import { Icon, type IconName } from "./icons";

// ----- slots ---------------------------------------------------------------

interface Slots {
  figures: HTMLElement | null;
  actions: HTMLElement | null;
}
const SlotCtx = createContext<{ slots: Slots; set: (k: keyof Slots, el: HTMLElement | null) => void }>({ slots: { figures: null, actions: null }, set: () => {} });

export function HeroSlots({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ figures: null, actions: null });
  const set = useCallback((k: keyof Slots, el: HTMLElement | null) => setSlots((s) => (s[k] === el ? s : { ...s, [k]: el })), []);
  const value = useMemo(() => ({ slots, set }), [slots, set]);
  return <SlotCtx.Provider value={value}>{children}</SlotCtx.Provider>;
}

/** Where a slot's content lands. */
function Slot({ name, className }: { name: keyof Slots; className: string }) {
  const { set } = useContext(SlotCtx);
  const ref = useCallback((el: HTMLDivElement | null) => set(name, el), [name, set]);
  return <div className={className} ref={ref} />;
}

/** Puts its children into the hero (the figures, or the buttons beside the business). */
export function InHero({ slot, children }: { slot: keyof Slots; children: ReactNode }) {
  const { slots } = useContext(SlotCtx);
  const el = slots[slot];
  return el ? createPortal(children, el) : null;
}

// ----- folding -------------------------------------------------------------

/** 0 at the top of the page, 1 once the figures have scrolled away: the
 *  header's own background fades in and the figures fade out. */
function useFold() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      frame = 0;
      const p = Math.max(0, Math.min(1, (window.scrollY - 6) / 120));
      root.style.setProperty("--fold", p.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      root.style.removeProperty("--fold");
    };
  }, []);
}

// ----- the header ----------------------------------------------------------

export interface NavItem {
  to: string;
  icon: IconName;
  label: string;
}

export function HeroHeader({ nav, right }: { nav: NavItem[]; right: ReactNode }) {
  const t = useT();
  useFold();
  return (
    <header className="hero-top">
      <div className="hero-bar">
        <nav className="hero-nav" aria-label={t("Sections", "Secciones")}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hero-right">{right}</div>
      </div>
      <Identity />
    </header>
  );
}

/** The figures' place under the header (filled by the Overview). */
export function HeroFiguresSlot() {
  return <Slot name="figures" className="hero-figs" />;
}

function greeting(t: (en: string, es: string) => string): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return t("Good morning", "Buenos días");
  if (h >= 12 && h < 18) return t("Good afternoon", "Buenas tardes");
  if (h >= 18 && h < 22) return t("Good evening", "Buenas noches");
  return t("Good night", "Buenas noches");
}

function Identity() {
  const t = useT();
  const app = useApp();
  const { snapshot } = useBooks();
  const name = app.business?.name ?? snapshot.business.name;
  const locale = app.fmt.lang === "en" ? "en-GB" : app.fmt.lang === "nl" ? "nl" : "es";
  const now = new Date();
  const date = `${now.toLocaleDateString(locale, { weekday: "long" })}, ${now.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}`;
  const logo = snapshot.settings?.logoUrl ?? null;
  return (
    <div className="hero-id">
      <div className="who">
        <div className="date">{date.charAt(0).toUpperCase() + date.slice(1)}</div>
        <div className="greet">{greeting(t)}</div>
        <BusinessSwitch>
          <BizMark name={name} logo={logo} />
          <span className="biz-title">{name}</span>
        </BusinessSwitch>
      </div>
      <div className="hero-acts">
        <Slot name="actions" className="hero-slot" />
        {/* Admins and viewers; collectors have no reports. */}
        {app.role !== "collector" && <ReportsButton />}
      </div>
    </div>
  );
}

/** The business's logo from Settings › Business, or its initials. */
export function BizMark({ name, logo, small }: { name: string; logo: string | null; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span className={`biz-mark ${small ? "small" : ""}`} aria-hidden="true">
      {logo && !broken ? <img src={logo} alt="" onError={() => setBroken(true)} /> : letters || "·"}
    </span>
  );
}

// ----- search --------------------------------------------------------------

interface Hit {
  key: string;
  kind: "client" | "loan";
  title: string;
  sub: string;
  to: string;
  letters: string;
}

/** Search clients and loans from anywhere: results while typing, arrows
 *  and Enter to open one, Ctrl+K to get here. */
export function SearchBox() {
  const t = useT();
  const { books, fmt } = useBooks();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", away);
    };
  }, []);
  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const digits = s.replace(/\D/g, "");
    const clients: Hit[] = books.clients
      .filter((c) => !c.client.archivedAt)
      .filter((c) => c.client.fullName.toLowerCase().includes(s) || (digits.length >= 3 && c.client.phone.replace(/\D/g, "").includes(digits)) || (c.client.idNumber ?? "").toLowerCase().includes(s))
      .slice(0, 5)
      .map((c) => ({
        key: c.client._id,
        kind: "client",
        title: c.client.fullName,
        sub: c.loans.length ? t(`${c.loans.length} loan(s) · ${fmt.money(c.outstanding)} owed`, `${c.loans.length} préstamo(s) · ${fmt.money(c.outstanding)} adeudado`) : c.client.phone || t("No loans", "Sin préstamos"),
        to: `/clients/${c.client._id}`,
        letters: initials(c.client.fullName),
      }));
    const number = s.replace(/^#/, "");
    const loans: Hit[] = books.loans
      .filter((l) => String(l.loan.recordNo) === number || (l.client?.fullName ?? "").toLowerCase().includes(s))
      .slice(0, 5)
      .map((l) => ({
        key: l.loan._id,
        kind: "loan",
        title: t(`Loan #${l.loan.recordNo} · ${l.client?.fullName ?? "—"}`, `Préstamo #${l.loan.recordNo} · ${l.client?.fullName ?? "—"}`),
        sub: l.payoff > 0 ? t(`${fmt.money(l.payoff)} to pay it off`, `${fmt.money(l.payoff)} para saldarlo`) : t("Paid back", "Pagado"),
        to: `/loans/${l.loan._id}`,
        letters: "#",
      }));
    return [...clients, ...loans];
  }, [q, books, fmt, t]);
  useEffect(() => setAt(0), [q]);
  // Another page: the results close.
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    navigate(h.to);
  };
  const show = open && q.trim().length > 0;
  const label = t("Search clients and loans", "Buscar clientes y préstamos");
  return (
    <div className="hero-search" ref={box}>
      <label className="glass-pill search-pill">
        <input
          ref={input}
          type="search"
          value={q}
          placeholder={t("Search clients & loans…", "Buscar clientes y préstamos…")}
          aria-label={label}
          role="combobox"
          aria-expanded={show}
          aria-controls="hero-search-results"
          aria-activedescendant={show && hits[at] ? `hit-${hits[at].key}` : undefined}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((i) => Math.min(hits.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && hits[at]) {
              e.preventDefault();
              go(hits[at]);
            }
          }}
        />
        <span className="search-ic" aria-hidden="true">
          <Icon name="search" />
        </span>
      </label>
      {show && (
        <div className="hero-pop search-results" id="hero-search-results" role="listbox" aria-label={label}>
          {hits.length === 0 ? (
            <p className="search-empty">{t(`Nothing matches "${q.trim()}". Try a name, a phone number or a loan number.`, `Nada coincide con "${q.trim()}". Prueba un nombre, un teléfono o un número de préstamo.`)}</p>
          ) : (
            (["client", "loan"] as const).map((kind) => {
              const group = hits.filter((h) => h.kind === kind);
              if (!group.length) return null;
              return (
                <div key={kind}>
                  <h4>{kind === "client" ? t("Clients", "Clientes") : t("Loans", "Préstamos")}</h4>
                  {group.map((h) => (
                    <button
                      key={h.key}
                      id={`hit-${h.key}`}
                      type="button"
                      role="option"
                      aria-selected={hits[at] === h}
                      className={`menu-item ${hits[at] === h ? "on" : ""}`}
                      onMouseEnter={() => setAt(hits.indexOf(h))}
                      onClick={() => go(h)}
                    >
                      <span className="ic">
                        <span className="letters">{h.letters}</span>
                      </span>
                      <span className="tx">
                        <b>{h.title}</b>
                        <small>{h.sub}</small>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
