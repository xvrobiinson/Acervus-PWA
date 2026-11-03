// The only server code in front of the PWA: serves the Windows installer at
// /download/windows from this site's own address, and what is known about it
// at /download/windows/info. Everything else is the built app (dist/),
// answered by Cloudflare's static assets as before.
//
// The installer lives in the desktop app's GitHub releases; every release
// also publishes it as AcervusFinance-Setup.exe, so "latest" always points
// at the newest one. It is streamed through, never stored here.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const REPO = "xvrobiinson/ACERVUS-APP";
const FILE_NAME = "AcervusFinance-Setup.exe";
const INSTALLER = `https://github.com/${REPO}/releases/latest/download/${FILE_NAME}`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/download/windows") return windowsInstaller(request);
    if (url.pathname === "/download/windows/info") return json(await installerInfo());
    return env.ASSETS.fetch(request);
  },
};

async function windowsInstaller(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const upstream = await fetch(INSTALLER, { method: request.method, redirect: "follow" });
  if (!upstream.ok) {
    return new Response("The download is not available right now. Please try again in a few minutes.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
    // Always ask again, so a new release is picked up at once.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: 200, headers });
}

/** What the download popup shows. A field that couldn't be found is null;
 *  nothing is ever made up. */
export interface InstallerInfo {
  /** The installer can be downloaded right now. */
  available: boolean;
  version: string | null;
  /** When the release was published (ISO time). */
  published: string | null;
  file: string;
  /** In bytes. */
  size: number | null;
}

// Kept for a few minutes per server instance, so visitors don't each ask
// GitHub (whose API allows few requests without a key).
const KEEP_MS = 10 * 60_000;
let kept: { at: number; info: InstallerInfo } | null = null;

export async function installerInfo(now = Date.now()): Promise<InstallerInfo> {
  if (kept && now - kept.at < KEEP_MS) return kept.info;
  const info = (await fromApi()) ?? (await fromDownload());
  // Only a full answer is kept; a failed look is tried again next time.
  if (info.available && info.version) kept = { at: now, info };
  return info;
}

/** Forgets the kept answer (tests). */
export function forgetInstallerInfo() {
  kept = null;
}

/** The release page's data: version, date and the installer's size. */
async function fromApi(): Promise<InstallerInfo | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "acervus-finance-pwa", "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!r.ok) return null;
    const release = (await r.json()) as { tag_name?: unknown; published_at?: unknown; assets?: { name?: unknown; size?: unknown }[] };
    const asset = release.assets?.find((a) => a.name === FILE_NAME);
    return {
      available: !!asset,
      version: typeof release.tag_name === "string" ? release.tag_name.replace(/^v/, "") : null,
      published: typeof release.published_at === "string" ? release.published_at : null,
      file: FILE_NAME,
      size: typeof asset?.size === "number" ? asset.size : null,
    };
  } catch {
    return null;
  }
}

/** When GitHub's API says no: the version from where "latest" leads, the
 *  size from the installer itself. No date. */
async function fromDownload(): Promise<InstallerInfo> {
  let version: string | null = null;
  try {
    const r = await fetch(`https://github.com/${REPO}/releases/latest`, { method: "HEAD", redirect: "manual" });
    const tag = /\/releases\/tag\/v?([^/?#]+)/.exec(r.headers.get("location") ?? "")?.[1];
    if (tag) version = decodeURIComponent(tag);
  } catch {
    /* unknown */
  }
  let available = false;
  let size: number | null = null;
  try {
    const r = await fetch(INSTALLER, { method: "HEAD", redirect: "follow" });
    available = r.ok;
    const length = Number(r.headers.get("content-length"));
    if (r.ok && length > 0) size = length;
  } catch {
    /* unavailable */
  }
  return { available, version, published: null, file: FILE_NAME, size };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
