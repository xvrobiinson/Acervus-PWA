import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetInstallerInfo, installerInfo } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
  forgetInstallerInfo();
});

function stub(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    return answer(url, init);
  });
  return calls;
}

describe("installer info", () => {
  it("reads the version, date and size from the latest release", async () => {
    stub(() =>
      Response.json({
        tag_name: "v0.12.2",
        published_at: "2026-11-02T18:00:00Z",
        assets: [
          { name: "AcervusFinance-Setup-0.12.2.exe", size: 1 },
          { name: "AcervusFinance-Setup.exe", size: 11642900 },
        ],
      }),
    );
    expect(await installerInfo()).toEqual({ available: true, version: "0.12.2", published: "2026-11-02T18:00:00Z", file: "AcervusFinance-Setup.exe", size: 11642900 });
  });

  it("says unavailable when the release has no installer", async () => {
    stub(() => Response.json({ tag_name: "v0.13.0", published_at: "2026-11-03T00:00:00Z", assets: [] }));
    const info = await installerInfo();
    expect(info.available).toBe(false);
    expect(info.size).toBeNull();
  });

  it("falls back to the download itself and the feed when the API refuses", async () => {
    stub((url) => {
      if (url.includes("api.github.com")) return new Response("rate limited", { status: 403 });
      if (url.endsWith("releases.atom"))
        return new Response(
          `<feed><entry><updated>2026-11-04T00:00:00Z</updated><link rel="alternate" href="https://github.com/xvrobiinson/ACERVUS-APP/releases/tag/v0.13.0-beta"/></entry><entry><updated>2026-11-03T00:02:16Z</updated><link rel="alternate" href="https://github.com/xvrobiinson/ACERVUS-APP/releases/tag/v0.12.2"/></entry></feed>`,
        );
      if (url.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: "https://github.com/xvrobiinson/ACERVUS-APP/releases/tag/v0.12.2" } });
      return new Response(null, { status: 200, headers: { "content-length": "11642900" } });
    });
    expect(await installerInfo()).toEqual({ available: true, version: "0.12.2", published: "2026-11-03T00:02:16Z", file: "AcervusFinance-Setup.exe", size: 11642900 });
  });

  it("leaves the date out when the feed has no entry for the version", async () => {
    stub((url) => {
      if (url.includes("api.github.com")) return new Response("rate limited", { status: 403 });
      if (url.endsWith("releases.atom")) return new Response("<feed></feed>");
      if (url.endsWith("/releases/latest")) return new Response(null, { status: 302, headers: { location: "https://github.com/xvrobiinson/ACERVUS-APP/releases/tag/v0.12.2" } });
      return new Response(null, { status: 200, headers: { "content-length": "5" } });
    });
    expect((await installerInfo()).published).toBeNull();
  });

  it("invents nothing when GitHub can't be reached", async () => {
    stub(() => {
      throw new TypeError("network down");
    });
    expect(await installerInfo()).toEqual({ available: false, version: null, published: null, file: "AcervusFinance-Setup.exe", size: null });
  });

  it("keeps a full answer for a while, and asks again after a failure", async () => {
    const calls = stub(() => Response.json({ tag_name: "v1.0.0", published_at: null, assets: [{ name: "AcervusFinance-Setup.exe", size: 5 }] }));
    await installerInfo(1_000);
    await installerInfo(2_000);
    expect(calls).toHaveLength(1);
    await installerInfo(1_000 + 11 * 60_000);
    expect(calls).toHaveLength(2);
  });
});
