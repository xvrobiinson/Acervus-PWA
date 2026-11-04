// "Try the demo" on the landing page: the app on sample data, in this
// browser only. Nothing is sent to the server: reads come from the bundled
// snapshot (made from convex/fixtures/desktop-demo.json by the real server
// code), and anything that would save says it's a demo instead. Leaving the
// demo (or closing the tab) forgets it.

import { ConvexError } from "convex/values";
import type { BusinessSummary, Snapshot } from "../state/types";
import sample from "./snapshot.json";

const FLAG = "acervus.demo";

export const demoSnapshot = sample as unknown as Snapshot;

export const demoBusiness = {
  businessId: demoSnapshot.business._id,
  name: demoSnapshot.business.name,
  role: "admin",
  timezone: demoSnapshot.business.timezone,
} as BusinessSummary;

/** This tab is showing the demo. */
export function inDemo(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/** Opens the app on the sample data. */
export function startDemo() {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* without it the demo can't open; the landing page stays */
  }
  location.assign("/");
}

/** Leaves the demo for `to` (the landing page, or creating an account). */
export function leaveDemo(to = "/") {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  location.assign(to);
}

/** What a save does in the demo. */
export const demoError = () => new ConvexError({ code: "demo" });
