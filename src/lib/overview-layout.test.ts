import { describe, expect, it } from "vitest";
import { defaultLayout, dropOnto, layoutRows, nudge, nudgeFigure, parseLayout, setFigureShown, setHalf, setShown, type Block } from "./overview-layout";

const ADMIN: Block[] = ["figures", "growth", "attention", "recent"];
const COLLECTOR: Block[] = ["figures", "attention", "mine"];

describe("overview layout", () => {
  it("ships as the Overview looked before", () => {
    const l = defaultLayout();
    expect(layoutRows(l, ADMIN)).toEqual([["figures"], ["growth", "attention"], ["recent"]]);
    // No chart for a collector: the list fills its row.
    expect(layoutRows(l, COLLECTOR)).toEqual([["figures"], ["attention"], ["mine"]]);
  });

  it("pairs half blocks next to each other and moves past hidden ones", () => {
    let l = setHalf(defaultLayout(), "recent", true);
    l = setShown(l, "attention", false);
    expect(layoutRows(l, ADMIN)).toEqual([["figures"], ["growth", "recent"]]);
    l = nudge(l, "recent", -1, ADMIN);
    expect(l.blocks.filter((b) => ADMIN.includes(b))).toEqual(["figures", "recent", "attention", "growth"]);
  });

  it("lands a dropped block where it was dropped", () => {
    let l = dropOnto(defaultLayout(), "figures", "attention");
    expect(l.blocks).toEqual(["growth", "attention", "figures", "mine", "recent"]);
    l = dropOnto(l, "recent", "growth");
    expect(l.blocks).toEqual(["recent", "growth", "attention", "figures", "mine"]);
  });

  it("survives a round trip and odd saved text", () => {
    let l = setFigureShown(defaultLayout(), "receivable", false);
    l = nudgeFigure(l, "overdue", -1, ["portfolio", "overdue", "receivable"]);
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout("not json")).toEqual(defaultLayout());
    const odd = parseLayout(JSON.stringify({ blocks: ["recent", "nope", "recent"], half: ["figures", "recent"] }));
    expect(odd.blocks).toEqual(["recent", "figures", "growth", "attention", "mine"]);
    expect(odd.half).toEqual(["recent"]);
  });
});
