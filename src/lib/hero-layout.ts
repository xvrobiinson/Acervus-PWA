// The four figures in the Overview's hero, as each person chose them: per
// slot a big figure and two small rows under it, any of which can be
// "none" (left empty). A slot with nothing in it is not shown, and a slot
// left with one row shows that row larger. Which figures a person may pick
// follows their role: totals of the business are for admins only.

export type HeroFigure =
  | "portfolio"
  | "lentOut"
  | "interestEarned"
  | "availableCapital"
  | "availableInterest"
  | "receivable"
  | "overdue"
  | "collectedMonth"
  | "expectedInterest"
  | "dueNext7"
  | "gain6m"
  | "activeLoans"
  | "overdueLoans"
  | "toConfirm";

export type Pick = HeroFigure | "none";

export interface HeroSlot {
  big: Pick;
  rows: [Pick, Pick];
}

export type HeroLayout = HeroSlot[];

export const HERO_SLOTS = 4;

export const HERO_FIGURES: HeroFigure[] = [
  "portfolio",
  "lentOut",
  "interestEarned",
  "availableCapital",
  "availableInterest",
  "receivable",
  "overdue",
  "collectedMonth",
  "expectedInterest",
  "dueNext7",
  "gain6m",
  "activeLoans",
  "overdueLoans",
  "toConfirm",
];

/** Figures that read as a sentence, not an amount: small rows only. */
export const ROW_ONLY: HeroFigure[] = ["gain6m"];

export type HeroRole = "admin" | "collector" | "viewer";

/** What a role may see. Collectors and viewers never see the business's
 *  totals (portfolio, capital, interest), the same rule as the rest of the app. */
export function allowedFigures(role: HeroRole): HeroFigure[] {
  if (role === "admin") return HERO_FIGURES.filter((f) => f !== "toConfirm");
  const team: HeroFigure[] = ["overdue", "overdueLoans", "receivable", "dueNext7", "activeLoans"];
  return role === "collector" ? [...team, "toConfirm"] : team;
}

/** The hero as the app ships, per role. */
export function defaultHero(role: HeroRole): HeroLayout {
  if (role === "admin")
    return [
      { big: "portfolio", rows: ["gain6m", "expectedInterest"] },
      { big: "lentOut", rows: ["activeLoans", "dueNext7"] },
      { big: "interestEarned", rows: ["availableInterest", "collectedMonth"] },
      { big: "availableCapital", rows: ["overdue", "overdueLoans"] },
    ];
  return [
    { big: "overdue", rows: ["overdueLoans", "none"] },
    { big: "dueNext7", rows: ["activeLoans", "none"] },
    { big: "receivable", rows: ["none", "none"] },
    role === "collector" ? { big: "toConfirm", rows: ["none", "none"] } : { big: "none", rows: ["none", "none"] },
  ];
}

function pick(v: unknown, allowed: HeroFigure[], bigOnly: boolean): Pick | null {
  if (v === "none") return "none";
  if (typeof v !== "string" || !allowed.includes(v as HeroFigure)) return null;
  if (bigOnly && ROW_ONLY.includes(v as HeroFigure)) return null;
  return v as HeroFigure;
}

/** Reads a saved hero. Anything unknown or not allowed for this role falls
 *  back to that spot's default, so a role change never shows a total. */
export function parseHero(value: unknown, role: HeroRole): HeroLayout {
  const d = defaultHero(role);
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return d;
    }
  }
  if (!Array.isArray(raw)) return d;
  const allowed = allowedFigures(role);
  return d.map((def, i) => {
    const s = raw[i] as Partial<HeroSlot> | undefined;
    if (!s || typeof s !== "object") return def;
    const rows = Array.isArray(s.rows) ? s.rows : [];
    return {
      big: pick(s.big, allowed, true) ?? def.big,
      rows: [pick(rows[0], allowed, false) ?? def.rows[0], pick(rows[1], allowed, false) ?? def.rows[1]],
    };
  });
}

/** The slots to draw: empty ones dropped. */
export function shownSlots(l: HeroLayout): { slot: HeroSlot; rows: HeroFigure[] }[] {
  return l
    .map((slot) => ({ slot, rows: slot.rows.filter((r): r is HeroFigure => r !== "none") }))
    .filter((s) => s.slot.big !== "none" || s.rows.length > 0);
}

/** Changes one spot of one slot. */
export function setPick(l: HeroLayout, slot: number, spot: "big" | 0 | 1, value: Pick): HeroLayout {
  return l.map((s, i) => {
    if (i !== slot) return s;
    if (spot === "big") return { ...s, big: value };
    const rows: [Pick, Pick] = [...s.rows];
    rows[spot] = value;
    return { ...s, rows };
  });
}
