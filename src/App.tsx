// Routes, the signed-in shell (side rail on wide screens, tab bar and "+"
// button on phones), the offline/sync banner and the update prompt.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigationType } from "react-router";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useT } from "./lib/i18n";
import { releaseSplash, splashProgress } from "./lib/splash";
import { leaveDemo } from "./demo/demo";
import { InviteScreen, SignIn, SignUp, Welcome } from "./screens/auth";
import { ClientDetail, ClientForm, ClientsScreen } from "./screens/clients";
import { MessagesButton } from "./screens/collect";
import { HistoryScreen } from "./screens/history";
import { LandingScreen } from "./screens/landing";
import { LegalScreen } from "./screens/legal";
import { LoanDetail, LoanForm, LoansScreen } from "./screens/loans";
import { EntryForm, MoneyScreen, type EntryFormKind } from "./screens/money";
import { MoreScreen } from "./screens/more";
import { OverviewScreen } from "./screens/overview";
import { PaymentForm } from "./screens/payment";
import { PaymentsScreen } from "./screens/payments";
import { ReportsScreen } from "./screens/reports";
import { SettingsScreen } from "./screens/settings";
import { SyncScreen } from "./screens/sync";
import { useApp } from "./state/app";
import { Icon, type IconName } from "./ui/icons";
import { AccountButton } from "./ui/account";
import { HeroFiguresSlot, HeroHeader, HeroSlots, SearchBox, type NavItem } from "./ui/hero";
import { Banner, Button, LaunchScreen } from "./ui/kit";
import { usePresence } from "./ui/motion";

/** Running as the installed app (home screen or desktop window), where the
 *  public landing page is never shown. Covers installs made before the
 *  manifest opened on sign-in, and iOS, which reports it its own way. */
function installedApp(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.matchMedia?.("(display-mode: window-controls-overlay)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function App() {
  const app = useApp();
  const t = useT();
  const location = useLocation();
  const deletion = useQuery(api.account.status, app.mode === "online" ? {} : "skip");
  // The launch splash: its line follows the start, and it opens once no
  // loading screen holds it (src/lib/splash.ts).
  const step = app.mode === "loading" ? 0.3 : app.mode === "signed_out" || app.businesses?.length === 0 ? 1 : app.businesses === null ? 0.55 : app.snapshot ? 1 : 0.8;
  useEffect(() => splashProgress(step), [step]);
  useEffect(() => releaseSplash());

  // Signing out: the splash until the sign-in page takes over.
  if (app.leaving) return <LaunchScreen />;
  // The Terms and the Privacy Policy are public: readable signed in or out.
  if (location.pathname === "/terms") return <LegalScreen page="terms" />;
  if (location.pathname === "/privacy") return <LegalScreen page="privacy" />;
  // Someone who has never signed in on this device sees the landing page at
  // once, without waiting for the sign-in check; not while the launch
  // splash is still up (public/splash.js).
  if (app.mode === "loading" && location.pathname === "/" && !localStorage.getItem("acervus.lastUser") && !installedApp() && !document.getElementById("boot")) return <LandingScreen />;
  if (app.mode === "loading") return <Splash />;
  if (app.mode === "signed_out") {
    return (
      <>
        <AutoUpdate />
        <Routes>
          <Route path="/" element={installedApp() ? <Navigate to="/sign-in" replace /> : <LandingScreen />} />
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/sign-up" element={<SignUp />} />
          <Route path="/invite" element={<InviteScreen />} />
          <Route path="*" element={<Navigate to={`/sign-in${location.search}`} replace />} />
        </Routes>
      </>
    );
  }
  if (location.pathname === "/invite") return <InviteScreen />;
  if (app.mode === "online" && deletion?.deletesAt) return <AccountDeleting deletesAt={deletion.deletesAt} />;
  if (app.businesses === null) return <Splash />;
  if (app.businesses.length === 0) {
    return app.mode === "online" ? (
      <Welcome />
    ) : (
      <Splash message={t("Connect to the internet once to set up your business.", "Conéctate a internet una vez para configurar tu negocio.")} />
    );
  }
  if (!app.snapshot) {
    return app.mode === "online" ? (
      <Splash />
    ) : (
      <Splash
        message={t(
          "This business hasn't been opened on this device yet, so there is no offline copy. Connect to the internet to load it.",
          "Este negocio aún no se ha abierto en este dispositivo, así que no hay copia sin conexión. Conéctate para cargarlo.",
        )}
      />
    );
  }
  return (
    <FormsProvider>
      <Shell>
        <ScreenMotion>
        <Routes>
          <Route path="/" element={<OverviewScreen />} />
          <Route path="/clients" element={<ClientsScreen />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/loans" element={<LoansScreen />} />
          <Route path="/loans/:id" element={<LoanDetail />} />
          {/* The business's balances and returns: admins only. */}
          <Route path="/money" element={app.can("manage") ? <MoneyScreen /> : <Navigate to="/" replace />} />
          <Route path="/reports" element={app.can("manage") ? <ReportsScreen /> : <Navigate to="/" replace />} />
          {/* A collector sees the history of their own loans only (on each loan). */}
          <Route path="/history" element={app.role !== "collector" ? <HistoryScreen /> : <Navigate to="/" replace />} />
          <Route path="/payments" element={<PaymentsScreen />} />
          {/* To confirm is a tab of Payments now; old links still land there. */}
          <Route path="/confirm" element={<Navigate to={app.role !== "collector" ? "/payments?tab=confirm" : "/"} replace />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/sync" element={<SyncScreen />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ScreenMotion>
      </Shell>
    </FormsProvider>
  );
}

/** Each screen slides in from the side: from the right going forward, from
 *  the left going back. Only the new screen moves, so nothing waits. */
function ScreenMotion({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const back = useNavigationType() === "POP";
  return (
    <div key={pathname} className={`screen-in ${back ? "back" : ""}`}>
      {children}
    </div>
  );
}

/** While an account waits to be deleted: nothing else, but the way back. */
function AccountDeleting({ deletesAt }: { deletesAt: number }) {
  const app = useApp();
  const t = useT();
  const cancel = useMutation(api.account.cancelDeletion);
  const when = new Date(deletesAt).toLocaleDateString(app.fmt.lang === "es" ? "es" : "en", { dateStyle: "long" });
  return (
    <div className="auth splash">
      <div className="panel stack" style={{ alignItems: "center", textAlign: "center" }}>
        <img className="logo" src="/pwa-192x192.png" alt="" />
        <p>{t(`Your account will be deleted on ${when}.`, `Tu cuenta se borrará el ${when}.`)}</p>
        <Button variant="primary" onClick={() => void cancel({})}>
          {t("Keep my account", "Conservar mi cuenta")}
        </Button>
        <Button variant="ghost" icon="logout" onClick={() => void app.signOut()}>
          {t("Sign out", "Cerrar sesión")}
        </Button>
      </div>
    </div>
  );
}

/** How long the start screen waits before saying it is slow. */
const SLOW_MS = 15_000;

/** The start screen: the Orbit launch screen while signing in and loading the business,
 *  or a message. Never a splash forever: when the server takes too long it
 *  says so and offers to try again (or to go on offline when this device
 *  has a copy). */
function Splash({ message }: { message?: string }) {
  const app = useApp();
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (message) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [message]);
  if (!message && !slow) return <LaunchScreen />;
  return (
    <div className="auth splash">
      <div className="panel stack" style={{ alignItems: "center", textAlign: "center" }}>
        <img className="logo" src="/pwa-192x192.png" alt="" />
        {message ? (
          <p>{message}</p>
        ) : (
          <>
            <p>{t("This is taking longer than usual. Check your connection, then try again.", "Esto está tardando más de lo normal. Revisa tu conexión y vuelve a intentarlo.")}</p>
            <Button variant="primary" icon="sync" onClick={() => window.location.reload()}>
              {t("Try again", "Reintentar")}
            </Button>
            {app.canGoOffline && <Button onClick={app.continueOffline}>{t("Continue offline", "Continuar sin conexión")}</Button>}
          </>
        )}
        {app.user && (
          <Button variant="ghost" icon="logout" onClick={() => void app.signOut()}>
            {t("Sign out", "Cerrar sesión")}
          </Button>
        )}
      </div>
    </div>
  );
}

// ----- forms opened from anywhere ------------------------------------------

export type FormRequest =
  | { kind: "payment"; loanId?: string; paymentId?: string }
  | { kind: "loan"; clientId?: string; loanId?: string }
  | { kind: "client"; clientId?: string; afterCreate?: (id: string) => void }
  | { kind: "entry"; entry: EntryFormKind; id?: string };

const FormsCtx = createContext<(r: FormRequest | null) => void>(() => {});
export const useForms = () => useContext(FormsCtx);

function FormsProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<FormRequest | null>(null);
  const close = () => setForm(null);
  return (
    <FormsCtx.Provider value={setForm}>
      {children}
      {form?.kind === "payment" && <PaymentForm loanId={form.loanId} paymentId={form.paymentId} onClose={close} />}
      {form?.kind === "loan" && <LoanForm clientId={form.clientId} loanId={form.loanId} onClose={close} />}
      {form?.kind === "client" && <ClientForm clientId={form.clientId} onClose={close} afterCreate={form.afterCreate} />}
      {form?.kind === "entry" && <EntryForm kind={form.entry} id={form.id} onClose={close} />}
    </FormsCtx.Provider>
  );
}

// ----- shell ---------------------------------------------------------------

function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const t = useT();
  const open = useForms();
  const waiting = app.ops.filter((o) => o.status === "pending" || o.status === "syncing").length;
  const review = app.ops.filter((o) => o.status === "needs_review").length;
  const toConfirm = app.snapshot?.pending.filter((p) => p.status === "waiting").length ?? 0;
  const team = app.role !== "collector";
  // The phone's tab bar.
  const nav: [string, IconName, string][] = [
    ["/", "home", t("Overview", "Resumen")],
    ["/clients", "users", t("Clients", "Clientes")],
    ["/loans", "loans", t("Loans", "Préstamos")],
    ...(app.can("manage") ? [["/money", "wallet", t("Money", "Dinero")] as [string, IconName, string]] : []),
  ];
  // The hero's section nav (wide screens).
  const heroNav: NavItem[] = [
    { to: "/", icon: "home", label: t("Overview", "Resumen") },
    { to: "/clients", icon: "users", label: t("Clients", "Clientes") },
    { to: "/loans", icon: "loans", label: t("Loans", "Préstamos") },
    { to: "/payments", icon: "receipt", label: t("Payments", "Pagos") },
    ...(app.can("manage") ? [{ to: "/reports", icon: "chart" as IconName, label: t("Portfolio", "Portafolio") }] : []),
  ];
  const quickItems: [string, IconName, () => void, boolean][] = [
    [t("Record payment", "Registrar pago"), "receipt", () => open({ kind: "payment" }), app.can("record")],
    [t("New loan", "Nuevo préstamo"), "loans", () => open({ kind: "loan" }), app.can("manage") && app.mode === "online"],
    [t("New client", "Nuevo cliente"), "users", () => open({ kind: "client" }), app.can("record")],
    [t("Expense", "Gasto"), "wallet", () => open({ kind: "entry", entry: "expense" }), app.can("record")],
    [t("Income", "Ingreso"), "wallet", () => open({ kind: "entry", entry: "income" }), app.can("record")],
  ];
  // The hero look applies while this shell is up (src/hero.css).
  useEffect(() => {
    document.documentElement.classList.add("hero-ui");
    return () => document.documentElement.classList.remove("hero-ui");
  }, []);
  // The hero's background reaches 40px under the panel's top edge, wherever
  // that is (with or without the Overview's figures).
  const mainRef = useRef<HTMLElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    const sheet = sheetRef.current;
    if (!main || !sheet) return;
    const size = () => main.style.setProperty("--hero-h", `${sheet.offsetTop + 40}px`);
    size();
    const watch = new ResizeObserver(size);
    watch.observe(main);
    for (const el of main.querySelectorAll(".hero-top, .hero-figs")) watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <HeroSlots>
      <div className="shell hero-shell">
        <main className="main" ref={mainRef}>
          <div className="hero-bg" aria-hidden="true" />
          <HeroHeader
            nav={heroNav}
            right={
              <>
                <SearchBox />
                {app.mode === "online" && <MessagesButton />}
                <AccountButton />
              </>
            }
          />
          <HeroFiguresSlot />
          <div className="hero-tail" />
          <div className="sheet-panel" ref={sheetRef}>
            <StatusBanner waiting={waiting} review={review} />
            <UpdatePrompt />
            {children}
          </div>
        </main>
      <nav className="tabbar" aria-label={t("Sections", "Secciones")}>
        {[...nav, ...(team ? [["/more", "more", t("More", "Más")] as [string, IconName, string]] : [])].map(([to, icon, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
            <Icon name={icon} />
            {label}
            {to === "/more" && toConfirm > 0 && <span className="dot" />}
          </NavLink>
        ))}
      </nav>
        {app.can("record") && <AddButton items={quickItems.filter(([, , , ok]) => ok)} note={app.mode !== "online" && app.can("manage")} />}
      </div>
    </HeroSlots>
  );
}

/** The "+" button, bottom right on every screen: opens a stack of what can
 *  be added, Record payment (used most) nearest the button. */
function AddButton({ items, note }: { items: [string, IconName, () => void, boolean][]; note: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  // Shown top to bottom; the first item (Record payment) ends up last, by the button.
  const stack = [...items].reverse();
  return (
    <>
      <div className={`add-scrim ${open ? "on" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className={`add ${open ? "open" : ""}`}>
        <div className="add-stack" role="menu" aria-label={t("Add", "Agregar")} aria-hidden={!open}>
          {note && <p className="add-note">{t("New loans need a connection.", "Los préstamos nuevos necesitan conexión.")}</p>}
          {stack.map(([label, icon, go], i) => {
            const primary = i === stack.length - 1;
            return (
              <button
                key={label}
                ref={primary ? first : undefined}
                type="button"
                role="menuitem"
                tabIndex={open ? 0 : -1}
                className={`add-item ${primary ? "primary" : ""}`}
                style={{ transitionDelay: open ? `${(stack.length - 1 - i) * 30}ms` : "0ms" }}
                onClick={() => {
                  setOpen(false);
                  go();
                }}
              >
                <span className="ic">
                  <Icon name={icon} />
                </span>
                {label}
              </button>
            );
          })}
        </div>
        <button type="button" className="fab" aria-label={open ? t("Close", "Cerrar") : t("Add", "Agregar")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="plus" />
        </button>
      </div>
    </>
  );
}

/** Says whether what's on screen is live, and whether changes are waiting. */
function StatusBanner({ waiting, review }: { waiting: number; review: number }) {
  const app = useApp();
  const t = useT();
  const when = app.savedAt ? new Date(app.savedAt).toLocaleString(app.fmt.lang === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short" }) : "—";
  const offline = app.mode === "offline" || !app.connected;
  // The offline banner stays a moment when the connection is back, to slide away.
  const offlineShown = usePresence(offline ? ["offline"] : [], (x) => x, 240);
  // Changes that finish sending say so for a moment, with a check.
  const [upToDate, setUpToDate] = useState(false);
  const hadWaiting = useRef(waiting);
  useEffect(() => {
    const before = hadWaiting.current;
    hadWaiting.current = waiting;
    if (before > 0 && waiting === 0 && !offline) {
      setUpToDate(true);
      const timer = setTimeout(() => setUpToDate(false), 2200);
      return () => clearTimeout(timer);
    }
  }, [waiting, offline]);
  // The demo says so, with the way to start for real.
  if (app.mode === "demo") {
    return (
      <Banner
        tone="info"
        icon="info"
        action={
          <Button size="small" variant="primary" onClick={() => leaveDemo("/sign-up")}>
            {t("Create a free account", "Crea una cuenta gratis")}
          </Button>
        }
      >
        {t("You're trying Acervus Finance with sample data. Nothing you do here is saved.", "Estás probando Acervus Finance con datos de ejemplo. Nada de lo que hagas aquí se guarda.")}
      </Banner>
    );
  }
  return (
    <>
      {offlineShown.length > 0 ? (
        <Banner tone="offline" icon="cloudOff" className={offlineShown[0].leaving ? "leaving" : ""}>
          <strong>{t("Offline.", "Sin conexión.")}</strong>{" "}
          {t(`Showing the copy saved on this device (${when}).`, `Mostrando la copia guardada en este dispositivo (${when}).`)}{" "}
          {waiting > 0 && t(`${waiting} change(s) will sync when you're back online.`, `${waiting} cambio(s) se sincronizarán al volver la conexión.`)}
        </Banner>
      ) : waiting > 0 ? (
        <Banner tone="info" icon="sync" className={app.syncing ? "syncing" : ""} action={<NavLink to="/sync" className="btn small ghost">{t("View", "Ver")}</NavLink>}>
          {app.syncing ? t(`Syncing ${waiting} change(s)…`, `Sincronizando ${waiting} cambio(s)…`) : t(`${waiting} change(s) waiting to sync.`, `${waiting} cambio(s) esperando sincronizar.`)}
        </Banner>
      ) : upToDate ? (
        <Banner tone="ok" icon="check" className="done">
          {t("Up to date. Your changes reached the server.", "Al día. Tus cambios llegaron al servidor.")}
        </Banner>
      ) : null}
      {review > 0 && (
        <Banner tone="warn" icon="alert" action={<NavLink to="/sync" className="btn small">{t("Review", "Revisar")}</NavLink>}>
          {t(`${review} change(s) made offline need your review before they can be saved.`, `${review} cambio(s) hechos sin conexión necesitan tu revisión antes de guardarse.`)}
        </Banner>
      )}
      {app.lastSync?.report.blocked === "auth" && (
        <Banner tone="error" icon="alert" action={<Button size="small" onClick={() => void app.signOut()}>{t("Sign in", "Iniciar sesión")}</Button>}>
          {t("Your session ended. Sign in again to sync; your changes are kept on this device.", "Tu sesión terminó. Inicia sesión para sincronizar; tus cambios siguen guardados en este dispositivo.")}
        </Banner>
      )}
    </>
  );
}

/** Signed out there is nothing to lose, so a new version is applied at
 *  once; otherwise the sign-in pages would keep showing the old one. */
function AutoUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  useEffect(() => {
    if (needRefresh) void updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);
  return null;
}

function UpdatePrompt() {
  const t = useT();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });
  if (!needRefresh) return null;
  return (
    <Banner tone="info" icon="download" action={<Button size="small" variant="primary" onClick={() => void updateServiceWorker(true)}>{t("Update", "Actualizar")}</Button>}>
      {t("A new version of the app is ready.", "Hay una versión nueva de la aplicación.")}
    </Banner>
  );
}
