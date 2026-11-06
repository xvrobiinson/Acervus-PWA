// The top-right of the signed-in app: the light/dark pill, and the account
// icon whose ring shows how the app is doing (most serious first), opening
// the account menu: who you are, why the ring has its color, the
// businesses, Sync, Settings and Sign out. Also the business switcher the
// business name opens.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Id } from "../../convex/_generated/dataModel";
import { useT } from "../lib/i18n";
import { roleLabel } from "../lib/labels";
import { NewBusinessForm } from "../screens/auth";
import { useSignOut } from "../screens/settings";
import { useApp } from "../state/app";
import { Icon, type IconName } from "./icons";
import { Sheet } from "./kit";
import { openReports } from "../screens/reports-panel";

type Theme = "light" | "dark";

function shownTheme(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light or dark on this device, as a sun | moon pill (the same choice as
 *  Settings › This device › Theme). */
export function ThemePill() {
  const t = useT();
  const [theme, setTheme] = useState<Theme>(shownTheme);
  useEffect(() => {
    const check = () => setTheme(shownTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", check);
    const watch = new MutationObserver(check);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", check);
      watch.disconnect();
    };
  }, []);
  const dark = theme === "dark";
  const label = dark ? t("Switch to light", "Cambiar a claro") : t("Switch to dark", "Cambiar a oscuro");
  return (
    <button
      type="button"
      className={`theme-pill ${dark ? "dark" : ""}`}
      role="switch"
      aria-checked={dark}
      aria-label={t("Dark mode", "Modo oscuro")}
      title={label}
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("acervus.theme", next);
        } catch {
          /* still switched for this visit */
        }
      }}
    >
      <span className="thumb" aria-hidden="true" />
      <span className={`o ${dark ? "" : "on"}`} aria-hidden="true">
        <Icon name="sun" />
      </span>
      <span className={`o ${dark ? "on" : ""}`} aria-hidden="true">
        <Icon name="moon" />
      </span>
    </button>
  );
}

/** 3 needs action now, 2 needs a look, 1 all good, 0 still checking. */
export type Severity = 0 | 1 | 2 | 3;
interface Reason {
  sev: Severity;
  text: string;
  fix?: { label: string; go: () => void };
}

/** How the app is doing, from real state only: the sync outbox, the
 *  connection, the session, and (admins and office staff) collector
 *  payments waiting. New messages are left out: the bell counts them. */
export function useAppStatus(): { sev: Severity; reasons: Reason[] } {
  const t = useT();
  const app = useApp();
  const navigate = useNavigate();
  const waiting = app.ops.filter((o) => o.status === "pending" || o.status === "syncing").length;
  const review = app.ops.filter((o) => o.status === "needs_review").length;
  const toConfirm = app.role !== "collector" ? (app.snapshot?.pending.filter((p) => p.status === "waiting").length ?? 0) : 0;
  const offline = app.mode === "offline" || !app.online;
  const reasons: Reason[] = [];
  if (app.mode === "demo") return { sev: 1, reasons };
  if (app.lastSync?.report.blocked === "auth")
    reasons.push({ sev: 3, text: t("Your session ended: changes can't sync", "Tu sesión terminó: los cambios no se sincronizan"), fix: { label: t("Sign in", "Iniciar sesión"), go: () => void app.signOut() } });
  if (review > 0)
    reasons.push({ sev: 3, text: t(`${review} change(s) need your review`, `${review} cambio(s) necesitan tu revisión`), fix: { label: t("Review", "Revisar"), go: () => navigate("/sync") } });
  if (offline)
    reasons.push({
      sev: 2,
      text: waiting > 0 ? t(`Offline: ${waiting} change(s) wait to sync`, `Sin conexión: ${waiting} cambio(s) esperan`) : t("Offline: showing the copy on this device", "Sin conexión: se muestra la copia de este dispositivo"),
      fix: waiting > 0 ? { label: t("View", "Ver"), go: () => navigate("/sync") } : undefined,
    });
  if (toConfirm > 0)
    reasons.push({ sev: 2, text: t(`${toConfirm} collector payment(s) to confirm`, `${toConfirm} pago(s) de cobradores por confirmar`), fix: { label: t("Open", "Abrir"), go: () => navigate("/confirm") } });
  // Not offline, but the live connection isn't up yet: still checking.
  if (!offline && !app.connected && reasons.length === 0) return { sev: 0, reasons };
  const sev = reasons.reduce<Severity>((m, r) => (r.sev > m ? r.sev : m), 1);
  return { sev, reasons: reasons.sort((a, b) => b.sev - a.sev) };
}

const initials = (name: string, email: string) =>
  (name.trim() || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const ROLE_ICON: Record<"admin" | "collector" | "viewer", IconName> = { admin: "shield", collector: "briefcase", viewer: "eye" };

function Face({ sev }: { sev: Severity }) {
  const app = useApp();
  const role = app.role ?? "viewer";
  return (
    <>
      <span className={`ring s${sev}`} aria-hidden="true" />
      <span className="face" aria-hidden="true">
        {initials(app.user?.name ?? "", app.user?.email ?? "?")}
      </span>
      <span className="role" aria-hidden="true">
        <Icon name={ROLE_ICON[role]} />
      </span>
    </>
  );
}

/** A panel under its button that closes on Escape or a click elsewhere;
 *  phones get it as a sheet from the bottom. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, box };
}

function MenuItem({ icon, title, sub, onClick, trail, className }: { icon: ReactNode; title: string; sub?: string; onClick: () => void; trail?: ReactNode; className?: string }) {
  return (
    <button type="button" role="menuitem" className={`menu-item ${className ?? ""}`} onClick={onClick}>
      <span className="ic">{icon}</span>
      <span className="tx">
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </span>
      {trail}
    </button>
  );
}

/** The businesses this person belongs to, to switch between, and New. */
function BusinessItems({ done, onNew }: { done: () => void; onNew: () => void }) {
  const t = useT();
  const app = useApp();
  return (
    <>
      {(app.businesses ?? []).map((b) => (
        <MenuItem
          key={b.businessId}
          icon={<span className="letters">{initials(b.name, b.name)}</span>}
          title={b.name}
          sub={roleLabel(t, b.role)}
          trail={b.businessId === app.businessId ? <Icon name="check" className="mark" /> : undefined}
          onClick={() => {
            if (b.businessId !== app.businessId) app.setBusinessId(b.businessId as Id<"businesses">);
            done();
          }}
        />
      ))}
      {app.mode === "online" && <MenuItem icon={<Icon name="plus" />} title={t("New business", "Nuevo negocio")} onClick={onNew} />}
    </>
  );
}

function NewBusinessSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Sheet title={t("New business", "Nuevo negocio")} onClose={onClose}>
      <NewBusinessForm onCreated={onClose} />
    </Sheet>
  );
}

/** The account icon with its status ring, and the account menu. */
export function AccountButton() {
  const t = useT();
  const app = useApp();
  const navigate = useNavigate();
  const { sev, reasons } = useAppStatus();
  const { open, setOpen, box } = usePopover();
  const [creating, setCreating] = useState(false);
  const signOut = useSignOut();
  // The ring pulses once when its color changes.
  const [pulse, setPulse] = useState(false);
  const was = useRef(sev);
  useEffect(() => {
    if (was.current === sev) return;
    was.current = sev;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 900);
    return () => clearTimeout(timer);
  }, [sev]);
  const role = app.role ?? "viewer";
  const headline: Record<Severity, string> = {
    3: t("Needs your attention", "Necesita tu atención"),
    2: t("Something needs a look", "Algo necesita revisión"),
    1: t("Everything is up to date", "Todo está al día"),
    0: t("Checking…", "Comprobando…"),
  };
  const why = reasons.length ? reasons.map((r) => r.text).join(" · ") : headline[sev];
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const synced = app.lastSync ? new Date(app.lastSync.at).toLocaleTimeString(app.fmt.lang === "es" ? "es" : "en", { timeStyle: "short" }) : null;
  return (
    <div className="acct" ref={box}>
      <button
        type="button"
        className={`acct-btn ${pulse ? "pulse" : ""} ${sev === 3 ? "alarm" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("Account", "Cuenta")}: ${app.user?.name || app.user?.email || ""}, ${roleLabel(t, role)}. ${why}`}
        title={`${roleLabel(t, role)} · ${why}`}
        onClick={() => setOpen(!open)}
      >
        <Face sev={sev} />
      </button>
      {open && (
        <div className="acct-panel" role="menu">
          <div className="acct-head">
            <span className="acct-btn still">
              <Face sev={sev} />
            </span>
            <span className="who">
              <b className="ellipsis">{app.user?.name || app.user?.email}</b>
              {app.user?.name && <small className="ellipsis">{app.user.email}</small>}
              <span className="pill accent">
                <Icon name={ROLE_ICON[role]} />
                {roleLabel(t, role)}
              </span>
            </span>
            <button type="button" className="acct-x" aria-label={t("Close", "Cerrar")} onClick={() => setOpen(false)}>
              <Icon name="close" />
            </button>
          </div>
          <div className={`acct-status s${sev}`}>
            <div className="st-title">
              <span className="dot" />
              {headline[sev]}
            </div>
            <ul>
              {reasons.length === 0 ? (
                <li>
                  <span className="sev s1" />
                  <span>{sev === 0 ? t("Connecting to the server", "Conectando con el servidor") : synced ? t(`Synced, last at ${synced}`, `Sincronizado, última vez a las ${synced}`) : t("Synced", "Sincronizado")}</span>
                </li>
              ) : (
                reasons.map((r) => (
                  <li key={r.text}>
                    <span className={`sev s${r.sev}`} />
                    <span>{r.text}</span>
                    {r.fix && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          r.fix!.go();
                        }}
                      >
                        {r.fix.label}
                      </button>
                    )}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="acct-sec">
            <h4>{t("Business", "Negocio")}</h4>
            <BusinessItems
              done={() => setOpen(false)}
              onNew={() => {
                setOpen(false);
                setCreating(true);
              }}
            />
          </div>
          <div className="acct-sec phone-only">
            {role !== "collector" && (
              <MenuItem
                icon={<Icon name="receipt" />}
                title={t("Reports", "Reportes")}
                sub={t("Monthly statement, collections, overdue", "Estado mensual, cobros, atrasos")}
                onClick={() => {
                  setOpen(false);
                  openReports();
                }}
              />
            )}
            <MenuItem
              icon={<Icon name="sliders" />}
              title={t("Customize figures", "Personalizar cifras")}
              sub={t("Which figures the Overview shows", "Qué cifras muestra el Resumen")}
              onClick={() => {
                setOpen(false);
                navigate("/?customize=1");
              }}
            />
          </div>
          <div className="acct-sec">
            <div className="menu-item static">
              <span className="ic">
                <Icon name="sun" />
              </span>
              <span className="tx">
                <b>{t("Appearance", "Apariencia")}</b>
              </span>
              <ThemePill />
            </div>
            <MenuItem
              icon={<Icon name="sync" />}
              title={t("Sync", "Sincronización")}
              sub={app.mode === "offline" || !app.online ? t("Offline", "Sin conexión") : t("Changes on this device and the server", "Cambios de este dispositivo y el servidor")}
              onClick={() => go("/sync")}
            />
            {role !== "collector" && <MenuItem icon={<Icon name="history" />} title={t("Change history", "Historial de cambios")} sub={t("Who changed what, and when", "Quién cambió qué y cuándo")} onClick={() => go("/history")} />}
            <MenuItem icon={<Icon name="settings" />} title={t("Settings", "Ajustes")} sub={t("Business, team, receipts, formats", "Negocio, equipo, recibos, formatos")} onClick={() => go("/settings")} />
          </div>
          <button
            type="button"
            role="menuitem"
            className="acct-out"
            onClick={() => {
              setOpen(false);
              signOut.start();
            }}
          >
            <Icon name="logout" />
            {t("Sign out", "Cerrar sesión")}
          </button>
        </div>
      )}
      {creating && <NewBusinessSheet onClose={() => setCreating(false)} />}
      {signOut.confirm}
    </div>
  );
}

/** The business name (and logo): opens the list of businesses to switch. */
export function BusinessSwitch({ children }: { children: ReactNode }) {
  const t = useT();
  const app = useApp();
  const navigate = useNavigate();
  const { open, setOpen, box } = usePopover();
  const [creating, setCreating] = useState(false);
  return (
    <div className="biz-switch" ref={box}>
      <button type="button" className={`biz-hit ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} title={t("Switch business", "Cambiar de negocio")} onClick={() => setOpen(!open)}>
        {children}
        <Icon name="caret" className="caret" />
      </button>
      {open && (
        <div className="biz-panel" role="menu">
          <h4>{t("Switch business", "Cambiar de negocio")}</h4>
          <BusinessItems
            done={() => setOpen(false)}
            onNew={() => {
              setOpen(false);
              setCreating(true);
            }}
          />
          {app.can("manage") && app.mode === "online" && (
            <MenuItem
              icon={<Icon name="settings" />}
              title={t("Business settings", "Ajustes del negocio")}
              onClick={() => {
                setOpen(false);
                navigate("/settings?open=business");
              }}
            />
          )}
        </div>
      )}
      {creating && <NewBusinessSheet onClose={() => setCreating(false)} />}
    </div>
  );
}
