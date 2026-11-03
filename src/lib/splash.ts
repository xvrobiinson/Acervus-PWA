// Tells the launch splash (index.html + public/splash.js) how the start is
// going. The app's loading screen holds it up while it is on screen; once
// nothing holds it after a render, the splash opens onto whatever the app
// now shows (Overview, sign-in, a message). Sent once per page load.

let holds = 0;
let sent = false;

function openIfFree() {
  queueMicrotask(() => {
    if (holds || sent) return;
    sent = true;
    window.dispatchEvent(new Event("acervus:ready"));
  });
}

/** Keeps the splash up until the returned release is called. The check
 *  waits a microtask, so a remount (StrictMode) doesn't open it early. */
export function holdSplash(): () => void {
  holds++;
  return () => {
    holds--;
    openIfFree();
  };
}

/** After each render of the app: opens the splash once nothing holds it. */
export function releaseSplash() {
  openIfFree();
}

/** How far the start has got, from 0 to 1 (the line under the name). */
export function splashProgress(p: number) {
  window.dispatchEvent(new CustomEvent("acervus:progress", { detail: p }));
}
