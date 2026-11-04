import { describe, expect, it } from "vitest";
import { computeBooks } from "../state/books";
import { demoBusiness, demoSnapshot } from "./demo";

// The demo's sample data (made from convex/fixtures/desktop-demo.json by the
// server's own import and snapshot) must keep working as the app changes.
describe("demo sample data", () => {
  it("is a whole business the app can work out", () => {
    const books = computeBooks(demoSnapshot, demoSnapshot.today);
    expect(demoSnapshot.loans.length).toBeGreaterThan(0);
    expect(books.loanById.size).toBe(demoSnapshot.loans.length);
    expect(demoBusiness.businessId).toBe(demoSnapshot.business._id);
    expect(demoSnapshot.me.role).toBe("admin");
  });
});
