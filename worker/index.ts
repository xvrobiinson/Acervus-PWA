// The only server code in front of the PWA: serves the Windows installer at
// /download/windows from this site's own address, and what is known about it
// at /download/windows/info (also what the desktop app's "Update available"
// reads: the newest version, its SHA-256 and what's new in plain words).
// Everything else is the built app (dist/),
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
  /** The installer's SHA-256 (hex), from the release's SHA256SUMS.txt: the
   *  desktop checks its download against it before running it. */
  sha256: string | null;
  /** What's new in this version, in plain words (the release's
   *  whats-new.json, written with the version in the desktop repo). */
  notes: { en: string[]; es: string[] } | null;
}

/** What GitHub says about the release itself. */
type Found = Omit<InstallerInfo, "sha256" | "notes">;

// Kept for a few minutes per server instance, so visitors don't each ask
// GitHub (whose API allows few requests without a key).
const KEEP_MS = 10 * 60_000;
let kept: { at: number; info: InstallerInfo } | null = null;

export async function installerInfo(now = Date.now()): Promise<InstallerInfo> {
  if (kept && now - kept.at < KEEP_MS) return kept.info;
  const found = (await fromApi()) ?? (await fromDownload());
  const [sha256, notes] = found.version ? await Promise.all([sumOf(found.version), notesOf(found.version)]) : [null, null];
  const info: InstallerInfo = { ...found, sha256, notes };
  // Only a full answer is kept; a failed look is tried again next time.
  if (info.available && info.version) kept = { at: now, info };
  return info;
}

/** Forgets the kept answer (tests). */
export function forgetInstallerInfo() {
  kept = null;
}

/** The release page's data: version, date and the installer's size. */
async function fromApi(): Promise<Found | null> {
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

/** When GitHub's API says no (it allows few requests per address, and
 *  Cloudflare's addresses are shared): the version from where "latest"
 *  leads, the date from the public releases feed, the size from the
 *  installer itself. */
async function fromDownload(): Promise<Found> {
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
  return { available, version, published: version ? await feedDate(version) : null, file: FILE_NAME, size };
}

/** The release's files, by version (never "latest", which could move on
 *  between two requests). */
const asset = (version: string, name: string) => `https://github.com/${REPO}/releases/download/v${encodeURIComponent(version)}/${name}`;

/** The installer's SHA-256 from the release's checksums. */
async function sumOf(version: string): Promise<string | null> {
  try {
    const r = await fetch(asset(version, "SHA256SUMS.txt"), { redirect: "follow" });
    if (!r.ok) return null;
    for (const line of (await r.text()).split(/\r?\n/)) {
      const [hash, name] = line.trim().split(/\s+\*?/);
      if (name === FILE_NAME && /^[0-9a-f]{64}$/i.test(hash ?? "")) return hash.toLowerCase();
    }
  } catch {
    /* unknown */
  }
  return null;
}

/** What's new, when the release has notes for this version (same major and
 *  minor: a patch release keeps its version's notes). */
async function notesOf(version: string): Promise<{ en: string[]; es: string[] } | null> {
  try {
    const r = await fetch(asset(version, "whats-new.json"), { redirect: "follow" });
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: unknown; en?: unknown; es?: unknown };
    const lines = (v: unknown) =>
      Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every((s) => typeof s === "string" && s.length > 0 && s.length <= 300) ? (v as string[]) : null;
    const [en, es] = [lines(j.en), lines(j.es)];
    const same = typeof j.version === "string" && version.split(".").slice(0, 2).join(".") === j.version.split(".").slice(0, 2).join(".");
    return en && es && same ? { en, es } : null;
  } catch {
    return null;
  }
}

/** The release's date from the releases feed, only for the entry of that
 *  very version. */
async function feedDate(version: string): Promise<string | null> {
  try {
    const r = await fetch(`https://github.com/${REPO}/releases.atom`, { headers: { "User-Agent": "acervus-finance-pwa" } });
    if (!r.ok) return null;
    const feed = await r.text();
    for (const entry of feed.split("<entry>").slice(1)) {
      const tag = /\/releases\/tag\/v?([^"/?#<]+)/.exec(entry)?.[1];
      if (tag && decodeURIComponent(tag) === version) {
        const when = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1]?.trim();
        return when && !Number.isNaN(Date.parse(when)) ? when : null;
      }
    }
  } catch {
    /* unknown */
  }
  return null;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
