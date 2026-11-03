// The Windows download popup on the landing page: the newest version (read
// from the release, never written here), a short install guide, and the
// download itself, which starts only from its own button.

import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "../lib/i18n";
import { AcervusLoader, Banner, Button, Sheet } from "../ui/kit";
import type { InstallerInfo } from "../../worker/index";

/** The latest Windows installer, served from this site (worker/index.ts), so
 *  the download starts at once and the visitor stays on the page. */
export const DESKTOP_DOWNLOAD = "/download/windows";
const INFO = "/download/windows/info";
/** Where the release and its SHA-256 checksums are published. */
const RELEASE_PAGE = "https://github.com/xvrobiinson/ACERVUS-APP/releases/latest";
/** A started download keeps the button off this long (no double downloads). */
const BUSY_MS = 5_000;

type Load = { state: "loading" } | { state: "ok"; info: InstallerInfo } | { state: "failed" };

export function DownloadSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [phase, setPhase] = useState<"idle" | "checking" | "started" | "unavailable">("idle");
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let alive = true;
    fetch(INFO)
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? (r.json() as Promise<InstallerInfo>) : Promise.reject(new Error(String(r.status)))))
      .then((info) => alive && setLoad({ state: "ok", info }))
      .catch(() => alive && setLoad({ state: "failed" }));
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, []);

  const info = load.state === "ok" ? load.info : null;
  const missing = (info && !info.available) || phase === "unavailable";

  const download = async () => {
    // A ref, not state: two quick clicks both see the first one.
    if (busy.current) return;
    busy.current = true;
    setPhase("checking");
    let ok = false;
    try {
      const r = await fetch(DESKTOP_DOWNLOAD, { method: "HEAD", cache: "no-store" });
      ok = r.ok && !!r.headers.get("content-type")?.includes("octet-stream");
    } catch {
      ok = false;
    }
    if (!ok) {
      busy.current = false;
      setPhase("unavailable");
      return;
    }
    const a = document.createElement("a");
    a.href = DESKTOP_DOWNLOAD;
    a.download = info?.file ?? "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPhase("started");
    timer.current = setTimeout(() => {
      busy.current = false;
      setPhase("idle");
    }, BUSY_MS);
  };

  const locale = lang === "es" || lang === "pap" ? "es" : "en";
  const date = info?.published ? new Date(info.published).toLocaleDateString(locale, { dateStyle: "long" }) : null;
  const size = info?.size ? `${(info.size / 1_048_576).toFixed(1)} MB` : null;
  const unknown = t("Not available", "No disponible");

  return (
    <Sheet
      wide
      title={t("Download Acervus Finance for Windows", "Descargar Acervus Finance para Windows")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("Close", "Cerrar")}</Button>
          <Button variant="primary" icon="download" loading={phase === "checking"} disabled={phase === "started" || !!(info && !info.available)} onClick={() => void download()}>
            {phase === "started" ? t("Download started", "Descarga iniciada") : t("Download Installer", "Descargar instalador")}
          </Button>
        </>
      }
    >
      <div className="dl stack">
        <p className="muted">
          {t(
            "Get the latest desktop version of Acervus Finance. Follow these simple steps to download and install the application.",
            "Obtén la versión de escritorio más reciente de Acervus Finance. Sigue estos pasos sencillos para descargar e instalar la aplicación.",
          )}
        </p>

        <section className="dl-facts" aria-label={t("Latest version", "Versión más reciente")}>
          {load.state === "loading" ? (
            <div className="loading-block">
              <AcervusLoader size="small" label={t("Loading the latest version…", "Cargando la versión más reciente…")} />
            </div>
          ) : (
            <dl>
              <dt>{t("Application", "Aplicación")}</dt>
              <dd>Acervus Finance</dd>
              <dt>{t("Latest version", "Versión más reciente")}</dt>
              <dd>{info?.version ?? unknown}</dd>
              <dt>{t("Released", "Publicada")}</dt>
              <dd>{date ?? unknown}</dd>
              <dt>{t("Installer", "Instalador")}</dt>
              <dd className="dl-file">{info?.file ?? "AcervusFinance-Setup.exe"}</dd>
              <dt>{t("Size", "Tamaño")}</dt>
              <dd>{size ?? unknown}</dd>
            </dl>
          )}
          {load.state === "failed" && (
            <p className="small muted">
              {t("The version details can't be loaded right now. The download always gives you the newest version.", "Los detalles de la versión no se pueden cargar ahora. La descarga siempre te da la versión más reciente.")}
            </p>
          )}
        </section>

        {missing && (
          <Banner tone="warn" icon="alert">
            {t("The installer isn't available right now. Please try again in a few minutes.", "El instalador no está disponible ahora. Inténtalo de nuevo en unos minutos.")}
          </Banner>
        )}
        {phase === "started" && (
          <Banner tone="info" icon="download">
            {t("Your download has started. When it finishes, open AcervusFinance-Setup.exe from your Downloads folder.", "Tu descarga empezó. Cuando termine, abre AcervusFinance-Setup.exe desde tu carpeta de Descargas.")}
          </Banner>
        )}

        <ol className="dl-steps">
          <li>
            <h3>{t("Download", "Descarga")}</h3>
            <p>{t("Click the Download Installer button below.", "Haz clic en el botón Descargar instalador de abajo.")}</p>
          </li>
          <li>
            <h3>{t("Windows security warning", "Aviso de seguridad de Windows")}</h3>
            <p>
              {t(
                "Your browser or Windows may show a warning when you download or open the installer. This can happen when Windows doesn't yet recognize an app's publisher or digital signature. For example:",
                "Tu navegador o Windows pueden mostrar un aviso al descargar o abrir el instalador. Esto puede pasar cuando Windows aún no reconoce al editor o la firma digital de una aplicación. Por ejemplo:",
              )}
            </p>
            <ul>
              <li>{t("Your browser may ask whether to keep the file before downloading it.", "Tu navegador puede preguntarte si quieres conservar el archivo antes de descargarlo.")}</li>
              <li>{t("Microsoft Defender SmartScreen may show “Windows protected your PC”.", "Microsoft Defender SmartScreen puede mostrar “Windows protegió tu PC”.")}</li>
              <li>{t("Windows may call it an unrecognized app.", "Windows puede llamarla una aplicación no reconocida.")}</li>
            </ul>
            <p>
              {t(
                "A warning like this doesn't mean the file is harmful, and it doesn't prove it is safe either. It means Windows can't vouch for the publisher yet.",
                "Un aviso así no significa que el archivo sea dañino, y tampoco demuestra que sea seguro. Significa que Windows todavía no puede responder por el editor.",
              )}
            </p>
            <p>
              {t(
                "If you have checked the installer and trust where it came from, you can review the warning and continue with Windows' own buttons: in the browser's downloads, choose Keep; in the SmartScreen window, click More info, check the details, then Run anyway.",
                "Si revisaste el instalador y confías en su origen, puedes revisar el aviso y continuar con los botones de Windows: en las descargas del navegador, elige Conservar; en la ventana de SmartScreen, haz clic en Más información, revisa los detalles y luego en Ejecutar de todas formas.",
              )}{" "}
              <a href={RELEASE_PAGE} target="_blank" rel="noopener noreferrer">
                {t("Each release publishes the installer's SHA-256 checksum, so you can compare it.", "Cada versión publica la suma SHA-256 del instalador, para que puedas compararla.")}
              </a>
            </p>
            <p className="dl-never">
              {t(
                "Never turn off Microsoft Defender, SmartScreen or your antivirus to install it.",
                "Nunca desactives Microsoft Defender, SmartScreen ni tu antivirus para instalarla.",
              )}
            </p>
          </li>
          <li>
            <h3>{t("Install", "Instala")}</h3>
            <p>{t("Open the downloaded installer and follow the Windows installation steps.", "Abre el instalador descargado y sigue los pasos de instalación de Windows.")}</p>
          </li>
          <li>
            <h3>{t("Launch", "Abre la app")}</h3>
            <p>
              {t(
                "Open Acervus Finance from the Start menu. Use it offline with no account, or sign in to keep it in step with the web and phone app.",
                "Abre Acervus Finance desde el menú Inicio. Úsala sin conexión y sin cuenta, o inicia sesión para mantenerla al día con la app web y de teléfono.",
              )}
            </p>
          </li>
        </ol>
      </div>
    </Sheet>
  );
}
