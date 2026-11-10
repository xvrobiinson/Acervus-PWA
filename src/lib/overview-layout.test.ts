import { describe, expect, it } from "vitest";
import { defaultLayout, dropOnto, layoutRows, nudge, parseLayout, setHalf, setShown, type Block } from "./overview-layout";

const ADMIN: Block[] = ["growth", "money", "today", "status", "attention", "recent"];
const COLLECTOR: Block[] = ["today", "status", "attention", "mine"];

describe("overview layout", () => {
  it("ships the chart beside today's attention, then the status beside the payments", () => {
    const l = defaultLayout();
    expect(layoutRows(l, ADMIN)).toEqual([["growth", "today"], ["status", "recent"], ["attention", "money"]]);
    expect(layoutRows(l, COLLECTOR)).toEqual([["today", "status"], ["mine", "attention"]]);
  });

  it("pairs half blocks next to each other and moves past hidden ones", () => {
    let l = setHalf(defaultLayout(), "today", false);
    expect(layoutRows(l, ADMIN)).toEqual([["growth"], ["today"], ["status", "recent"], ["attention", "money"]]);
    l = setShown(l, "status", false);
    l = nudge(l, "recent", -1, ADMIN);
    expect(l.blocks.filter((b) => ADMIN.includes(b))).toEqual(["growth", "recent", "status", "today", "attention", "money"]);
  });

  it("lands a dropped block where it was dropped", () => {
    const l = dropOnto(defaultLayout(), "recent", "growth");
    expect(l.blocks).toEqual(["recent", "growth", "today", "status", "mine", "attention", "money", "reminders"]);
  });

  it("survives a round trip and odd saved text", () => {
    const l = setShown(setHalf(defaultLayout(), "growth", false), "money", false);
    expect(parseLayout(JSON.stringify(l))).toEqual(l);
    expect(parseLayout(null)).toEqual(defaultLayout());
    expect(parseLayout("not json")).toEqual(defaultLayout());
    // An older layout with the figures block: dropped, the rest kept.
    const odd = parseLayout(JSON.stringify({ blocks: ["recent", "figures", "recent"], half: ["figures", "recent"] }));
    expect(odd.blocks).toEqual(["recent", "growth", "today", "status", "mine", "attention", "money", "reminders"]);
    expect(odd.half).toEqual(["recent"]);
  });
});
