import React, { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({
  replace: vi.fn(),
  provider: "google",
  search: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ provider: routing.provider }),
  useRouter: () => routing,
  useSearchParams: () => routing.search,
}));
import OAuthCallbackPage from "../../../apps/frontend/app/auth/oauth/[provider]/callback/page";
import {
  getAuthSession,
  getSocialAuthStateKey,
} from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "../signing/signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
const stateKey = getSocialAuthStateKey("google");
beforeEach(() => {
  routing.replace.mockClear();
  routing.provider = "google";
  routing.search = new URLSearchParams("code=code&state=state");
  window.sessionStorage.clear();
  window.sessionStorage.setItem(stateKey, "state");
  fetchMock = vi.fn().mockImplementation(async () =>
    jsonResponse({
      access_token: "oauth-token",
      user: {
        id: "user",
        email: "casey@example.test",
        role: "admin",
        first_name: null,
        last_name: null,
      },
      account: {
        id: "account",
        name: "Example",
        locale: "en-US",
        timezone: "UTC",
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
it("verifies state, consumes it once and completes Google OAuth through the backend", async () => {
  render(
    <StrictMode>
      <OAuthCallbackPage />
    </StrictMode>,
  );
  expect(screen.getByText("Completing secure sign-in...")).toBeTruthy();
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith("/templates"),
  );
  expect(window.sessionStorage.getItem(stateKey)).toBeNull();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/oauth/google/callback");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    code: "code",
    state: "state",
  });
  expect(getAuthSession()?.access_token).toBe("oauth-token");
});
it.each([
  ["microsoft", "", "Unsupported sign-in provider."],
  [
    "google",
    "error_description=Consent+declined&error=denied",
    "Consent declined",
  ],
  ["google", "error=denied", "denied"],
])(
  "shows provider errors without exchanging credentials for %s %s",
  async (provider, query, message) => {
    routing.provider = provider;
    routing.search = new URLSearchParams(query);
    render(<OAuthCallbackPage />);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("link", { name: "Back to sign in" })
        .getAttribute("href"),
    ).toBe("/auth/login");
  },
);
it.each(["", "code=code", "state=state", "code=code&state=attacker-state"])(
  "rejects missing or mismatched state in %s",
  async (query) => {
    routing.search = new URLSearchParams(query);
    render(<OAuthCallbackPage />);
    await screen.findByText(
      "The sign-in response could not be verified. Please try again.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(stateKey)).toBe("state");
  },
);
it("rejects callbacks without locally retained state", async () => {
  window.sessionStorage.removeItem(stateKey);
  render(<OAuthCallbackPage />);
  await screen.findByText(
    "The sign-in response could not be verified. Please try again.",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([true, false])(
  "renders callback exchange failure with structured response %s",
  async (structured) => {
    if (structured)
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: "OAuth session rejected" }, 401),
      );
    else fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<OAuthCallbackPage />);
    await screen.findByText(
      structured
        ? "OAuth session rejected"
        : "Social sign-in failed. Please try again.",
    );
    expect(window.sessionStorage.getItem(stateKey)).toBeNull();
    expect(routing.replace).not.toHaveBeenCalled();
  },
);
