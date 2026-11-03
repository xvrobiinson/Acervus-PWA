import { beforeEach, describe, expect, it, vi } from "vitest";

// The launch splash opens once, and only when no loading screen holds it.
describe("launch splash", () => {
  let opened: number;
  beforeEach(() => {
    vi.resetModules();
    opened = 0;
    const target = new EventTarget();
    target.addEventListener("acervus:ready", () => opened++);
    (globalThis as { window?: unknown }).window = target;
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("stays up while the loading screen holds it", async () => {
    const { holdSplash, releaseSplash } = await import("./splash");
    const release = holdSplash();
    releaseSplash();
    await tick();
    expect(opened).toBe(0);
    release();
    await tick();
    expect(opened).toBe(1);
  });

  it("survives a remount without opening early", async () => {
    const { holdSplash } = await import("./splash");
    const first = holdSplash();
    first();
    const second = holdSplash();
    await tick();
    expect(opened).toBe(0);
    second();
    await tick();
    expect(opened).toBe(1);
  });

  it("opens only once", async () => {
    const { releaseSplash } = await import("./splash");
    releaseSplash();
    releaseSplash();
    await tick();
    releaseSplash();
    await tick();
    expect(opened).toBe(1);
  });
});
