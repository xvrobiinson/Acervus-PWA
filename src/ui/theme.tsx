// The sun/moon button: switches between light and dark on this device, the
// same choice as Settings › This device › Theme (saved as `acervus.theme`).

import { useEffect, useState } from "react";
import { Icon } from "./icons";

type Theme = "light" | "dark";

function shown(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeButton({ className, label }: { className: string; label: (next: Theme) => string }) {
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "light" : shown()));
  useEffect(() => {
    const check = () => setTheme(shown());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", check);
    const watch = new MutationObserver(check);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", check);
      watch.disconnect();
    };
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className={className}
      aria-label={label(next)}
      title={label(next)}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("acervus.theme", next);
        } catch {
          /* still switched for this visit */
        }
      }}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
