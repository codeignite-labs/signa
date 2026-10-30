import { beforeEach, expect, it, vi } from "vitest";
import * as auth from "../../apps/frontend/lib/api/auth";

const session = () => ({
  access_token: "existing-api-token",
  user: {
    id: "reader",
    email: "reader@example.test",
    first_name: "Reader",
    last_name: null,
    role: "viewer" as const,
  },
  account: {
    id: "one",
    name: "Example Organization",
    locale: "en-US",
    timezone: "UTC",
  },
});
const token = (exp: unknown) =>
  `header.${btoa(JSON.stringify({ exp })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}.signature`;
let redirect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  redirect = vi.fn();
  const original = window;
  vi.stubGlobal("window", {
    localStorage,
    location: { pathname: "/templates", search: "?page=2", replace: redirect },
    addEventListener: original.addEventListener.bind(original),
    removeEventListener: original.removeEventListener.bind(original),
    dispatchEvent: original.dispatchEvent.bind(original),
  });
});
it("persists sessions and locale, emits updates, then clears auth and all tenant branding on logout", () => {
  const listener = vi.fn();
  const unsubscribe = auth.subscribeToAuthSessionChange(listener);
  auth.saveAuthSession({
    ...session(),
    account: { ...session().account, locale: "fr-FR" },
  });
  expect(listener).toHaveBeenCalledOnce();
  expect(auth.getAuthToken()).toBe("existing-api-token");
  expect(localStorage.getItem("signa.locale")).toBe("fr");
  localStorage.setItem("signa.branding.one", "cache");
  localStorage.setItem("signa.branding.two", "cache");
  localStorage.setItem("other", "keep");
  auth.clearAuthSession();
  expect(auth.getAuthSession()).toBeNull();
  expect(localStorage.getItem("signa.branding.two")).toBeNull();
  expect(localStorage.getItem("other")).toBe("keep");
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  auth.saveAuthSession(session());
  expect(listener).toHaveBeenCalledTimes(2);
});
it("expires JWTs at the safety-skew boundary and disposes stale branding", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  for (const seconds of [-1, 0, 15]) {
    auth.saveAuthSession({
      ...session(),
      access_token: token(Date.now() / 1000 + seconds),
    });
    localStorage.setItem("signa.branding.one", "cached");
    expect(auth.getAuthSession()).toBeNull();
    expect(localStorage.getItem("signa.branding.one")).toBeNull();
  }
  auth.saveAuthSession({
    ...session(),
    access_token: token(Date.now() / 1000 + 16),
  });
  expect(auth.getAuthSession()?.account.id).toBe("one");
});
it("tolerates opaque tokens and invalid expiry claims, while discarding corrupt storage", () => {
  for (const access_token of [
    "opaque-token",
    "header.not-base64.signature",
    token("not-a-number"),
    token(null),
  ]) {
    auth.saveAuthSession({ ...session(), access_token });
    expect(auth.getAuthToken()).toBe(access_token);
  }
  for (const value of ["not-json", "null", "{}"]) {
    localStorage.setItem("signa.auth", value);
    expect(auth.getAuthSession()).toBeNull();
    expect(localStorage.getItem("signa.auth")).toBeNull();
  }
});
it("adds the current tenant token and preserves caller headers without trusting an injected authorization", async () => {
  auth.saveAuthSession(session());
  const fetch = vi.fn().mockResolvedValue(new Response('{"id":42}'));
  vi.stubGlobal("fetch", fetch);
  expect(
    await auth.authenticatedApiFetch("/templates", {
      headers: { Authorization: "Bearer injected", "X-Request-Id": "request" },
    }),
  ).toEqual({ id: 42 });
  const headers = fetch.mock.calls[0][1].headers;
  expect(headers.get("Authorization")).toBe("Bearer existing-api-token");
  expect(headers.get("X-Request-Id")).toBe("request");
});
it("rejects unauthenticated and revoked sessions while retaining a valid session after forbidden or network errors", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(auth.authenticatedApiFetch("/private")).rejects.toMatchObject({
    status: 401,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(redirect).toHaveBeenCalledWith(
    "/auth/login?next=%2Ftemplates%3Fpage%3D2",
  );
  auth.saveAuthSession(session());
  fetch.mockResolvedValueOnce(
    new Response('{"error":"Revoked"}', { status: 401 }),
  );
  await expect(auth.authenticatedApiFetch("/private")).rejects.toMatchObject({
    status: 401,
  });
  expect(auth.getAuthSession()).toBeNull();
  auth.saveAuthSession(session());
  fetch
    .mockResolvedValueOnce(new Response("{}", { status: 403 }))
    .mockRejectedValueOnce(new Error("offline"));
  await expect(auth.authenticatedApiFetch("/private")).rejects.toMatchObject({
    status: 403,
  });
  await expect(auth.authenticatedApiFetch("/private")).rejects.toThrow(
    "offline",
  );
  expect(auth.getAuthSession()).not.toBeNull();
  auth.clearAuthSession();
  window.location.pathname = "/auth/login";
  redirect.mockClear();
  await expect(auth.authenticatedApiFetch("/private")).rejects.toMatchObject({
    status: 401,
  });
  expect(redirect).not.toHaveBeenCalled();
});
it("merges account/profile changes immediately but preserves the membership role", async () => {
  auth.saveAuthSession(session());
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('{"id":"reader","first_name":"Updated","role":"admin"}'),
    )
    .mockResolvedValueOnce(new Response('{"id":"one","name":"Renamed"}'));
  vi.stubGlobal("fetch", fetch);
  await auth.updateProfile({ first_name: "Updated" });
  expect(auth.getAuthSession()?.user).toMatchObject({
    first_name: "Updated",
    role: "viewer",
  });
  await auth.updateAccount({ name: "Renamed" });
  expect(auth.getAuthSession()?.account.name).toBe("Renamed");
});
it("replaces the tenant session when entering/leaving test mode and clears it when deleting the account", async () => {
  auth.saveAuthSession(session());
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...session(),
          account: { ...session().account, id: "testing", is_test_mode: true },
        }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(session())))
    .mockResolvedValueOnce(new Response('{"id":"one"}'));
  vi.stubGlobal("fetch", fetch);
  await auth.startTestingAccount();
  expect(auth.getAuthSession()?.account.id).toBe("testing");
  await auth.stopTestingAccount();
  expect(auth.getAuthSession()?.account.id).toBe("one");
  await auth.deleteAccount();
  expect(auth.getAuthSession()).toBeNull();
});

it("does not restore a stale account or profile after logout races a pending update", async () => {
  for (const update of [
    () => auth.updateProfile({ first_name: "Changed" }),
    () => auth.updateAccount({ name: "Changed" }),
  ]) {
    auth.saveAuthSession(session());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        auth.clearAuthSession();
        return new Response('{"id":"changed"}');
      }),
    );
    await update();
    expect(auth.getAuthSession()).toBeNull();
  }
});
