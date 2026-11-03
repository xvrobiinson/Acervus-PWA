// The launch splash (#boot in index.html, "Rising Bars"). It stays up until
// the app sends `acervus:ready` (src/lib/splash.ts), plays its intro first
// and stays at least 1.1 s so a fast start doesn't flash, then zooms open
// onto the app. A plain script, not inline, because the CSP allows scripts
// from this site only.
(() => {
  const boot = document.getElementById("boot");
  if (!boot) return;
  let lastUser = null;
  try {
    lastUser = localStorage.getItem("acervus.lastUser");
  } catch {
    /* ignore */
  }
  const installed =
    matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;
  // The public pages open at once: the Terms, the Privacy Policy, and the
  // landing page for someone who has never signed in here (as in App.tsx).
  const path = location.pathname;
  if (path === "/terms" || path === "/privacy" || (path === "/" && !lastUser && !installed)) {
    boot.remove();
    return;
  }

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const STAY_MS = still ? 0 : 1400; // the intro, which is longer than the 1.1 s minimum
  const shownAt = performance.now();

  // The phone's status bar matches the splash while it shows.
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const colors = metas.map((m) => m.content);
  metas.forEach((m) => (m.content = "#0D0E13"));

  // The line under the name: the app's milestones, and a slow creep between
  // them so it never looks stuck.
  const line = boot.querySelector(".boot-line i");
  let progress = 0.08;
  const show = (p) => {
    progress = Math.max(progress, Math.min(1, p));
    line.style.transform = `scaleX(${progress})`;
  };
  const creep = setInterval(() => show(progress + (0.9 - progress) * 0.05), 200);
  addEventListener("acervus:progress", (e) => show(Number(e.detail) || 0));

  let done = false;
  const open = () => {
    if (done) return;
    done = true;
    clearInterval(creep);
    show(1);
    setTimeout(
      () => {
        boot.classList.add("out");
        setTimeout(() => {
          boot.classList.add("gone");
          metas.forEach((m, i) => (m.content = colors[i]));
        }, still ? 0 : 420);
        setTimeout(() => boot.remove(), still ? 300 : 1300);
      },
      Math.max(0, STAY_MS - (performance.now() - shownAt)),
    );
  };
  addEventListener("acervus:ready", open);
  // Never up for good: if the app can't start, its own screen says why.
  setTimeout(open, 20_000);
})();
