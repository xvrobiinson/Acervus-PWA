// The app's building blocks (the desktop kit's roles, for touch): buttons,
// cards, stats, rows, pills, fields, sheets, toasts. Screens use these and
// the CSS tokens, never raw colors.

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useT } from "../lib/i18n";
import { holdSplash } from "../lib/splash";
import { Icon, type IconName } from "./icons";
import { useCountUp } from "./motion";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";

export function Button({
  variant = "secondary",
  size,
  icon,
  loading,
  block,
  children,
  className,
  ...rest
}: {
  variant?: Variant;
  size?: "small";
  icon?: IconName;
  loading?: boolean;
  block?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = ["btn", variant === "secondary" ? "" : variant, size, !children ? "icon" : "", block ? "block" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** The Acervus loader: the logo's ring turning, dot and all.
 *  `page` for a whole screen that is loading, `small` for a part of one;
 *  buttons keep their own small spinner. With reduced motion it turns slowly. */
export function AcervusLoader({ size = "page", label }: { size?: "page" | "small"; label?: string }) {
  const t = useT();
  return (
    <div className={`acervus-loader ${size}`} role="status" aria-live="polite">
      <svg className="ring-mark" viewBox="0 0 512 512" aria-hidden="true">
        <path d="M386.7 251.5 A133 133 0 1 1 300.5 145" />
        <circle cx="357" cy="184" r="29" />
      </svg>
      <span className="sr-only">{label ?? t("Loading Acervus Finance…", "Cargando Acervus Finance…")}</span>
    </div>
  );
}

/** The whole screen while the app starts or loads a business: the launch
 *  splash's Orbit (styled in index.html, where the first one shows before
 *  the app's code loads). While it is on screen it keeps the launch splash
 *  up, so that one opens straight onto the finished screen. */
export function LaunchScreen() {
  const t = useT();
  useEffect(() => holdSplash(), []);
  return (
    <div className="boot waiting" role="status" aria-label={t("Loading Acervus Finance…", "Cargando Acervus Finance…")}>
      <div className="boot-tile">
        <svg viewBox="0 0 512 512" aria-hidden="true">
          <rect className="tile" width="512" height="512" rx="112" />
          <path className="ring" d="M386.7 251.5 A133 133 0 1 1 300.5 145" />
          <circle className="pulse" cx="357" cy="184" r="27" />
          <circle className="dot" cx="357" cy="184" r="27" />
        </svg>
      </div>
      <div className="boot-word" aria-hidden="true">
        {[..."Acervus"].map((c, i) => (
          <span key={i} style={{ "--i": i } as CSSProperties}>
            {c}
          </span>
        ))}
      </div>
      <div className="boot-sub" aria-hidden="true">
        Finance
      </div>
      <div className="boot-line" aria-hidden="true">
        <i />
      </div>
    </div>
  );
}

export function LinkButton({ to, variant = "secondary", icon, children, size }: { to: string; variant?: Variant; icon?: IconName; children?: ReactNode; size?: "small" }) {
  return (
    <Link to={to} className={["btn", variant === "secondary" ? "" : variant, size, !children ? "icon" : ""].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Hue = "accent" | "info" | "pos" | "warn" | "neg" | "neutral";

/** One figure on its own card. With `icon`, the icon sits in a colored
 *  square (`hue`) and the label reads in ink beside it. */
export function Stat({
  label,
  value,
  caption,
  lead,
  tone,
  icon,
  hue = "accent",
  count,
  action,
  above,
}: {
  /** A small line above the value (the period shown). */
  above?: ReactNode;
  /** A small control on the label's row (the period switch). */
  action?: ReactNode;
  label: string;
  value: string;
  /** The number behind `value` and how to write it: counts up from 0 the
   *  first time the figure is shown. */
  count?: { value: number; format: (n: number) => string };
  caption?: ReactNode;
  lead?: boolean;
  tone?: "pos" | "neg" | "warn";
  icon?: IconName;
  hue?: Hue;
}) {
  return (
    <div className={`stat ${lead ? "lead" : ""}`}>
      {icon ? (
        <div className="label squared">
          <span className={`square ${hue}`} aria-hidden="true">
            <Icon name={icon} />
          </span>
          {label}
          {action}
        </div>
      ) : (
        <div className="label">{label}</div>
      )}
      {above && <div className="above">{above}</div>}
      <div className={`value num-left ${tone ?? ""}`} style={{ textAlign: "left" }}>
        {count ? <CountUp value={count.value} format={count.format} final={value} /> : value}
      </div>
      {caption && <div className="caption">{caption}</div>}
    </div>
  );
}

/** A figure counting up; screen readers get the final value at once. */
export function CountUp({ value, format, final }: { value: number; format: (n: number) => string; final: string }) {
  const shown = useCountUp(value);
  return (
    <>
      <span aria-hidden="true">{shown === value ? final : format(Math.round(shown))}</span>
      <span className="sr-only">{final}</span>
    </>
  );
}

/** An amount that counts up from zero when its page opens. */
export function Count({ v, fmt }: { v: number; fmt: { money: (c: number) => string } }) {
  return <CountUp value={v} format={fmt.money} final={fmt.money(v)} />;
}

/** A small "i" that explains something in one sentence: on hover and
 *  keyboard focus, or a tap on phones (tap again or elsewhere to close). */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return (
    <span className={`info-tip ${open ? "open" : ""}`} ref={box}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      <span className="info-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Pill({ tone, title, children }: { tone?: "pos" | "warn" | "neg" | "accent"; title?: string; children: ReactNode }) {
  return (
    <span className={`pill ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return <span className="avatar" aria-hidden="true">{letters || "·"}</span>;
}

export function Row({
  to,
  onClick,
  lead,
  title,
  sub,
  trail,
  muted,
  meter,
  aside,
}: {
  to?: string;
  onClick?: () => void;
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  trail?: ReactNode;
  muted?: boolean;
  /** 0 to 1: a thin bar under the text that fills when the row appears. */
  meter?: { value: number; label: string };
  /** A control beside the row (a WhatsApp link), outside its own link. */
  aside?: ReactNode;
}) {
  const body = (
    <>
      {lead}
      <div className="grow">
        <div className="title">{title}</div>
        {sub && <div className="sub">{sub}</div>}
        {meter && (
          <div className="meter" role="img" aria-label={meter.label}>
            <i style={{ width: `${Math.round(Math.min(1, Math.max(0, meter.value)) * 100)}%` }} />
          </div>
        )}
      </div>
      {trail && <div className="trail">{trail}</div>}
    </>
  );
  const cls = `list-row ${muted ? "muted" : ""}`;
  return (
    <li className={aside ? "has-aside" : undefined}>
      {to ? (
        <Link to={to} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" className={cls} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {aside && <div className="row-aside">{aside}</div>}
    </li>
  );
}

export function Empty({ icon = "search", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <p>{children}</p>
    </div>
  );
}

export function Banner({
  tone,
  icon,
  children,
  action,
  className,
}: {
  tone: "offline" | "warn" | "error" | "info" | "ok";
  icon: IconName;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`banner ${tone} ${className ?? ""}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} />
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {children(fid)}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

/** A page's search box as a rounded pill (inner pages of the hero look). */
export function FilterPill({ value, onChange, placeholder, label, id }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; id?: string }) {
  return (
    <label className="filter-pill">
      <Icon name="search" />
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </label>
  );
}

/** A page's views as pill tabs, each with an optional count. */
export function TabsPill<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string, number?][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs-pill" role="tablist" aria-label={label}>
      {options.map(([v, text, count]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {text}
          {count ? <span className="tab-count">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** How much of a loan's capital is back: a thin bar and the percent. */
export function PaidBack({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className="paid-back" title={label} aria-label={label}>
      <span className="bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="num">{pct}%</span>
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** The sheets open now, newest last: Escape belongs to the top one. */
const openSheets: symbol[] = [];

const SheetGuard = createContext<{ guard: (go: () => void) => void; clean: () => void }>({ guard: (go) => go(), clean: () => {} });

/** Runs `go` (leaving the sheet's current page), first asking when
 *  something was typed there and not saved. */
export function useSheetGuard() {
  return useContext(SheetGuard).guard;
}

/** After a save: what was typed in the sheet is no longer at risk. */
export function useSheetClean() {
  return useContext(SheetGuard).clean;
}

/** A form or detail over the page: a bottom sheet on phones, a dialog on
 *  wide screens. Escape and the backdrop close it, after asking when
 *  something was typed in it (the X and the form's own buttons close it as
 *  before). With `onBack`, a back button leads to the page before. A field
 *  inside `data-instant` saves on its own and never counts as typing. */
export function Sheet({
  title,
  onClose,
  onBack,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const me = useRef(Symbol("sheet"));
  const typed = useRef(false);
  const [asking, setAsking] = useState<(() => void) | null>(null);
  const guard = useCallback((go: () => void) => {
    if (!typed.current) return go();
    setAsking(() => go);
  }, []);
  const clean = useCallback(() => {
    typed.current = false;
  }, []);
  const leave = useCallback(
    (go: () => void) =>
      guard(() => {
        typed.current = false;
        go();
      }),
    [guard],
  );
  useEffect(() => {
    const self = me.current;
    openSheets.push(self);
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not(.sheet-close)")?.focus({ preventScroll: true });
    return () => {
      openSheets.splice(openSheets.indexOf(self), 1);
      if (openSheets.length === 0) document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openSheets[openSheets.length - 1] === me.current) leave(onClose);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose, leave]);
  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && leave(onClose)}>
      <div
        className={`sheet ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        ref={ref}
        onChangeCapture={(e) => {
          if (!(e.target as HTMLElement).closest("[data-instant]")) typed.current = true;
        }}
      >
        <div className="sheet-head">
          {onBack && <Button variant="ghost" icon="back" className="sheet-back" aria-label={t("Back", "Atrás")} onClick={() => leave(onBack)} />}
          <h2>{title}</h2>
          <Button variant="ghost" icon="close" className="sheet-close" aria-label={t("Close", "Cerrar")} onClick={onClose} />
        </div>
        <SheetGuard.Provider value={{ guard: leave, clean }}>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </SheetGuard.Provider>
      </div>
      {asking && (
        <Confirm
          title={t("Discard changes?", "¿Descartar los cambios?")}
          danger
          confirmLabel={t("Discard", "Descartar")}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            const go = asking;
            setAsking(null);
            typed.current = false;
            go();
          }}
        >
          {t("What you typed here will be lost.", "Lo que escribiste aquí se perderá.")}
        </Confirm>
      )}
    </div>,
    document.body,
  );
}

/** Asks before something that can't be undone. */
export function Confirm({
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  needsReason,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  needsReason?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel", "Cancelar")}</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div>{children}</div>
        {needsReason && (
          <Field label={t("Reason (kept in the history)", "Motivo (queda en el historial)")}>
            {(id) => <textarea id={id} className="input" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
    </Sheet>
  );
}

// ----- toasts ----------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  error?: boolean;
  action?: ToastAction;
}
/** A button on a toast, such as Undo. */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}
const ToastCtx = createContext<(text: string, error?: boolean, action?: ToastAction) => void>(() => {});
const SavedCtx = createContext<(text: string) => void>(() => {});

/** Shows a check that draws itself, with `text`, for a moment: for saves
 *  that matter (a payment). */
export function useSaved() {
  return useContext(SavedCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [saved, setSaved] = useState<{ id: number; text: string } | null>(null);
  const flash = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setSaved({ id, text });
    setTimeout(() => setSaved((x) => (x?.id === id ? null : x)), 1500);
  }, []);
  const push = useCallback((text: string, error?: boolean, action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, error, action }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), error ? 7000 : action ? 7000 : 4000);
  }, []);
  const act = (x: Toast) => {
    setToasts((ts) => ts.filter((y) => y.id !== x.id));
    void x.action?.run();
  };
  return (
    <ToastCtx.Provider value={push}>
      <SavedCtx.Provider value={flash}>{children}</SavedCtx.Provider>
      {saved && (
        <div key={saved.id} className="saved-flash" role="status">
          <svg viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="33" />
            <path d="M22 37l9 9 19-20" pathLength={1} />
          </svg>
          <b>{saved.text}</b>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.error ? "error" : ""}`}>
            <Icon name={x.error ? "alert" : "check"} width={18} height={18} />
            <span>{x.text}</span>
            {x.action && (
              <button type="button" className="toast-act" onClick={() => act(x)}>
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
