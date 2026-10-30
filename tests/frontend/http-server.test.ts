// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
it.each(["http://backend:3001/", "http://backend:3001/api"])(
  "resolves relative API requests on the server through %s",
  async (internal) => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    vi.stubEnv("INTERNAL_API_URL", internal);
    const client = await import("../../apps/frontend/lib/api/http");
    expect(client.resolveApiUrl()).toBe("http://backend:3001/api");
    expect(client.resolveBrowserApiUrl()).toBe("/api");
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await client.apiFetch("/health");
    expect(fetch.mock.calls[0][0]).toBe("http://backend:3001/api/health");
    expect(fetch.mock.calls[0][1].headers.has("X-Signa-Locale")).toBe(false);
  },
);
it("defaults internal requests safely and respects an absolute public API", async () => {
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", undefined);
  vi.stubEnv("INTERNAL_API_URL", undefined);
  expect(
    (await import("../../apps/frontend/lib/api/http")).resolveApiUrl(),
  ).toBe("http://127.0.0.1:3001/api");
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://api.example/api");
  expect(
    (await import("../../apps/frontend/lib/api/http")).resolveApiUrl(),
  ).toBe("https://api.example/api");
});
