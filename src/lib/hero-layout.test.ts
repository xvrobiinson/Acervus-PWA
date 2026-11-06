import { describe, expect, it } from "vitest";
import { allowedFigures, defaultHero, parseHero, setPick, shownSlots } from "./hero-layout";

describe("hero layout", () => {
  it("ships four slots, and never a total for collectors or viewers", () => {
    expect(defaultHero("admin")).toHaveLength(4);
    for (const role of ["collector", "viewer"] as const) {
      const allowed = allowedFigures(role);
      for (const s of defaultHero(role)) for (const p of [s.big, ...s.rows]) expect(p === "none" || allowed.includes(p)).toBe(true);
      expect(allowed).not.toContain("portfolio");
      expect(allowed).not.toContain("availableCapital");
    }
  });
  it("reads saved layouts and drops what the role may not see", () => {
    const saved = JSON.stringify([{ big: "portfolio", rows: ["overdue", "none"] }, { big: "bogus", rows: [] }]);
    const admin = parseHero(saved, "admin");
    expect(admin[0]).toEqual({ big: "portfolio", rows: ["overdue", "none"] });
    expect(admin[1]).toEqual(defaultHero("admin")[1]);
    const viewer = parseHero(saved, "viewer");
    expect(viewer[0].big).toBe(defaultHero("viewer")[0].big);
    expect(viewer[0].rows[0]).toBe("overdue");
    expect(parseHero("not json", "admin")).toEqual(defaultHero("admin"));
  });
  it("keeps sentence-like figures out of the big spot", () => {
    expect(parseHero([{ big: "gain6m", rows: ["gain6m", "none"] }], "admin")[0]).toEqual({ big: "portfolio", rows: ["gain6m", "none"] });
  });
  it("hides empty slots and counts the rows left", () => {
    let l = setPick(defaultHero("admin"), 0, "big", "none");
    l = setPick(l, 0, 0, "none");
    l = setPick(l, 0, 1, "none");
    l = setPick(l, 1, 1, "none");
    const shown = shownSlots(l);
    expect(shown).toHaveLength(3);
    expect(shown[0].rows).toEqual(["activeLoans"]);
  });
});
