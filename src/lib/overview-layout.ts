// How a person arranged the blocks on their Overview's panel: which show, in
// what order, and which take half the width (two half blocks in a row sit
// side by side on wide screens; a phone stacks everything in order). The
// figures live in the hero above (src/lib/hero-layout.ts). Kept in this
// device's storage, per person, the way the Windows app keeps it per PC.

export type Block = "growth" | "today" | "status" | "money" | "attention" | "mine" | "recent" | "reminders";

// The clean look (2026-11-09): the chart beside what needs attention today,
// then loans by status beside the payments, then the lists.
export const BLOCKS: Block[] = ["growth", "today", "status", "recent", "mine", "attention", "money", "reminders"];

export interface OverviewLayout {
  /** Every block, in order (hidden ones keep their place). */
  blocks: Block[];
  hidden: Block[];
  half: Block[];
}

/** The Overview as the app ships: every block half wide (two to a row),
 *  except the WhatsApp reminders. */
export function defaultLayout(): OverviewLayout {
  // Today's WhatsApp reminders take the whole width under the lists.
  return { blocks: [...BLOCKS], hidden: [], half: BLOCKS.filter((b) => b !== "reminders") };
}

function known<T extends string>(all: readonly T[], v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) if (all.includes(x as T) && !out.includes(x as T)) out.push(x as T);
  return out;
}

function complete<T>(order: T[], all: readonly T[]): T[] {
  return [...order, ...all.filter((x) => !order.includes(x))];
}

/** Reads a saved layout. Unknown names are dropped and anything missing
 *  comes back at the end, so an older or newer app never loses a block. */
export function parseLayout(text: string | null): OverviewLayout {
  const d = defaultLayout();
  if (!text) return d;
  let raw: Partial<Record<keyof OverviewLayout, unknown>>;
  try {
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (!raw || typeof raw !== "object") return d;
  return {
    blocks: complete(raw.blocks ? known(BLOCKS, raw.blocks) : d.blocks, BLOCKS),
    hidden: raw.hidden ? known(BLOCKS, raw.hidden) : d.hidden,
    half: raw.half ? known(BLOCKS, raw.half) : d.half,
  };
}

/** The shown blocks among `allowed`, in rows: two half blocks next to each
 *  other share a row; a half block with no half partner fills its row. */
export function layoutRows(l: OverviewLayout, allowed: Block[]): Block[][] {
  const shown = l.blocks.filter((b) => allowed.includes(b) && !l.hidden.includes(b));
  const rows: Block[][] = [];
  for (let i = 0; i < shown.length; i++) {
    const next = shown[i + 1];
    if (next && l.half.includes(shown[i]) && l.half.includes(next)) {
      rows.push([shown[i], next]);
      i++;
    } else rows.push([shown[i]]);
  }
  return rows;
}

function swap<T>(all: T[], a: T, b: T): T[] {
  const out = [...all];
  const i = out.indexOf(a);
  const j = out.indexOf(b);
  if (i >= 0 && j >= 0) [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Moves a block one place (`by` -1 or 1) among the shown, allowed ones, so
 *  every press visibly moves it. */
export function nudge(l: OverviewLayout, b: Block, by: -1 | 1, allowed: Block[]): OverviewLayout {
  const shown = l.blocks.filter((x) => allowed.includes(x) && !l.hidden.includes(x));
  const other = shown[shown.indexOf(b) + by];
  return other ? { ...l, blocks: swap(l.blocks, b, other) } : l;
}

/** Puts `moved` where `onto` is: a drag dropped on another block. */
function place<T>(all: T[], moved: T, onto: T): T[] {
  const out = all.filter((x) => x !== moved);
  const to = all.indexOf(onto);
  if (to < 0 || moved === onto) return all;
  out.splice(to, 0, moved);
  return out;
}

export const dropOnto = (l: OverviewLayout, moved: Block, onto: Block): OverviewLayout => ({ ...l, blocks: place(l.blocks, moved, onto) });

export function setShown(l: OverviewLayout, b: Block, shown: boolean): OverviewLayout {
  const hidden = l.hidden.filter((x) => x !== b);
  return { ...l, hidden: shown ? hidden : [...hidden, b] };
}

export function setHalf(l: OverviewLayout, b: Block, half: boolean): OverviewLayout {
  const rest = l.half.filter((x) => x !== b);
  return { ...l, half: half ? [...rest, b] : rest };
}
