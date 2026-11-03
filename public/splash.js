// The launch splash (#boot in index.html, "Rising Bars"). It stays up until
// the app sends `acervus:ready` (src/lib/splash.ts), always plays its whole
// intro first, then zooms open onto the app. A plain script, not inline,
// because the CSP allows scripts from this site only.
(() => {
  const boot = document.getElementById("boot");
  if (!boot) return;
  const read = (store, key) => {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  };

  // Light or dark like the app, before the first paint (main.tsx sets the
  // same again later).
  const theme = read(localStorage, "acervus.theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

  // Signing in or out asks the next page for the splash (splashNext in
  // src/lib/splash.ts): "enter" plays it in full, "leave" carries on the
  // splash the last page was already showing.
  const next = read(sessionStorage, "acervus.splash");
  try {
    sessionStorage.removeItem("acervus.splash");
  } catch {
    /* ignore */
  }

  // The Terms and the Privacy Policy open at once; every other page,
  // the landing page too, starts with the splash.
  const path = location.pathname;
  if (path === "/terms" || path === "/privacy") {
    boot.remove();
    return;
  }

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const carryOn = next === "leave";
  if (carryOn) boot.classList.add("cont");
  // The intro's length (SPLASH_INTRO_MS in src/lib/splash.ts): it always
  // plays to the end, however fast the app is ready. With the zoom and the
  // fade the whole splash is over in under 3.5 s.
  const STAY_MS = still || carryOn ? 0 : 2200;
  const shownAt = performance.now();

  // The phone's status bar matches the splash while it shows.
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const colors = metas.map((m) => m.content);
  metas.forEach((m) => (m.content = dark ? "#0D0E13" : "#F6F7FB"));

  // The line under the name: the app's milestones, and a slow creep between
  // them so it never looks stuck.
  const line = boot.querySelector(".boot-line i");
  let progress = carryOn ? 1 : 0.08;
  const show = (p) => {
    progress = Math.max(progress, Math.min(1, p));
    line.style.transform = `scaleX(${progress})`;
  };
  show(progress);
  const creep = setInterval(() => show(progress + (0.9 - progress) * 0.04), 200);
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
        }, still ? 0 : 450);
        setTimeout(() => boot.remove(), still ? 300 : 1250);
      },
      Math.max(0, STAY_MS - (performance.now() - shownAt)),
    );
  };
  addEventListener("acervus:ready", open);
  // Never up for good: if the app can't start, its own screen says why.
  setTimeout(open, 20_000);
})();
