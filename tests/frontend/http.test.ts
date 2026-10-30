import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});
const load = () => import("../../apps/frontend/lib/api/http");

describe("API client response and context boundary", () => {
  it.each(["", "https://api.example", "https://api.example/api/"])(
    "normalizes API base %s",
    async (base) => {
      vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", base);
      const client = await load();
      const fetch = vi.fn().mockResolvedValue(new Response('{"id":42}'));
      vi.stubGlobal("fetch", fetch);
      expect(await client.apiFetch("submissions/42")).toEqual({ id: 42 });
      expect(fetch.mock.calls[0][0]).toBe(
        `${base ? "https://api.example/api" : "/api"}/submissions/42`,
      );
      const headers = fetch.mock.calls[0][1].headers as Headers;
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Signa-Locale")).toBe(navigator.language);
      expect(headers.get("X-Signa-Timezone")).toBeTruthy();
      expect(client.resolveBrowserApiUrl()).toMatch(/^https?:\/\//);
    },
  );
  it("preserves explicit headers, uploads and fetch options", async () => {
    const client = await load();
    const fetch = vi.fn().mockImplementation(async () => new Response("true"));
    vi.stubGlobal("fetch", fetch);
    const body = new FormData();
    body.append("logo", new Blob(["logo"]), "logo.png");
    await client.apiFetch("/branding", {
      method: "POST",
      body,
      headers: { "X-Signa-Locale": "fr", "X-Signa-Timezone": "Africa/Nairobi" },
      credentials: "include",
    });
    const init = fetch.mock.calls[0][1];
    expect(init.body).toBe(body);
    expect(init.credentials).toBe("include");
    expect(init.headers.has("Content-Type")).toBe(false);
    expect(init.headers.get("X-Signa-Locale")).toBe("fr");
    expect(init.headers.get("X-Signa-Timezone")).toBe("Africa/Nairobi");
    await client.apiFetch("/raw", {
      headers: { "Content-Type": "text/plain" },
    });
    expect(fetch.mock.calls[1][1].headers.get("Content-Type")).toBe(
      "text/plain",
    );
  });
  it.each([204, 205, 200])("supports empty responses (%i)", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status })),
    );
    expect(await (await load()).apiFetch("/empty")).toBeUndefined();
  });
  it.each([
    [{ error: "Forbidden" }, "Forbidden"],
    [{ message: "Expired" }, "Expired"],
    [{ message: ["invalid"] }, "Bad Request"],
    [null, "Bad Request"],
  ])(
    "returns typed failures without losing server details: %j",
    async (details, message) => {
      const client = await load();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(details), {
            status: 400,
            statusText: "Bad Request",
          }),
        ),
      );
      try {
        await client.apiFetch("/private");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(client.ApiError);
        expect(error).toMatchObject({ status: 400, details, message });
      }
    },
  );
  it("handles non-JSON failures and propagates network/malformed success errors", async () => {
    const client = await load();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response("bad"));
    vi.stubGlobal("fetch", fetch);
    await expect(client.apiFetch("/one")).rejects.toMatchObject({
      message: "Request failed",
      details: null,
    });
    await expect(client.apiFetch("/two")).rejects.toThrow("offline");
    await expect(client.apiFetch("/three")).rejects.toBeInstanceOf(SyntaxError);
  });
});

it("omits missing browser context values rather than sending undefined headers", async () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("");
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    timeZone: "",
  } as Intl.ResolvedDateTimeFormatOptions);
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  await (await load()).apiFetch("/health");
  expect(fetch.mock.calls[0][1].headers.has("X-Signa-Timezone")).toBe(false);
  expect(fetch.mock.calls[0][1].headers.has("X-Signa-Locale")).toBe(false);
});
