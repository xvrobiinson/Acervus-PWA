// English and Spanish, like the desktop app: every string is written in both
// at the point of use, `t("Loans", "Préstamos")`. Papiamentu and Dutch (Beta)
// come from a catalog keyed by the English text (translations.json). The
// language is a per-device preference (defaulting to the browser's).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../../shared/domain/dates";
import catalog from "./translations.json";

export type T = (en: string, es: string) => string;

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
}

const KEY = "acervus.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "es" || saved === "pap" || saved === "nl") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

type Entry = [pap: string, nl: string];
const CATALOG = catalog as unknown as Record<string, Entry>;

/** Keys with {0}, {1}... as patterns: a text with figures in it is matched
 *  to its key, and the figures are put into the translation. */
const PATTERNS = Object.keys(CATALOG)
  .filter((k) => /\{\d\}/.test(k))
  .map((k) => {
    const order: number[] = [];
    const source = k.split(/(\{\d\})/).map((part) => {
      const m = part.match(/^\{(\d)\}$/);
      if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      order.push(Number(m[1]));
      return "([\\s\\S]*?)";
    });
    return { key: k, re: new RegExp(`^${source.join("")}$`), order };
  })
  // The most specific first: "Partly paid · {0} left" before "{0} left".
  .sort((x, y) => y.key.length - x.key.length);

/** A Papiamentu or Dutch text; missing, it falls back to the nearest language
 *  people there read: Spanish for Papiamentu, English for Dutch. */
export function translate(lang: "pap" | "nl", en: string, es: string): string {
  const i = lang === "pap" ? 0 : 1;
  const exact = CATALOG[en];
  if (exact) return exact[i];
  for (const p of PATTERNS) {
    const m = en.match(p.re);
    if (m) {
      const values: string[] = [];
      p.order.forEach((n, at) => (values[n] = m[at + 1]));
      return CATALOG[p.key][i].replace(/\{(\d)\}/g, (_, n) => values[Number(n)] ?? "");
    }
  }
  return lang === "pap" ? es : en;
}

const LangContext = createContext<LangState | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<LangState>(() => ({ lang, setLang, t: (en, es) => (lang === "es" ? es : lang === "en" ? en : translate(lang, en, es)) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const v = useContext(LangContext);
  if (!v) throw new Error("LangProvider missing");
  return v;
}

export function useT(): T {
  return useLang().t;
}

/** "1 loan" / "3 loans". */
export function plural(t: T, n: number, one: [string, string], many: [string, string]): string {
  return `${n} ${n === 1 ? t(...one) : t(...many)}`;
}
