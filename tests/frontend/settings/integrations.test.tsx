import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { IntegrationsSettingsBody } from "../../../apps/frontend/app/settings/_components/integrations-settings-body";
import * as auth from "../../../apps/frontend/lib/api/auth";
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  listAccountEmailIntegrations: vi.fn(),
  connectAccountEmailIntegration: vi.fn(),
  disconnectAccountEmailIntegration: vi.fn(),
}));
const integration: auth.AccountEmailIntegration = {
  provider: "gmail",
  name: "Gmail",
  connected: false,
  configured: true,
  email: null,
  connected_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.listAccountEmailIntegrations).mockResolvedValue([integration]);
  vi.mocked(auth.connectAccountEmailIntegration).mockResolvedValue({
    provider: "gmail",
    configured: true,
    connected: false,
    url: "https://accounts.google.com/test-oauth",
  });
  vi.mocked(auth.disconnectAccountEmailIntegration).mockResolvedValue(
    integration,
  );
});
it("offers Gmail and excludes the removed Microsoft sign-in integration", async () => {
  render(<IntegrationsSettingsBody />);
  await waitFor(() =>
    expect(auth.listAccountEmailIntegrations).toHaveBeenCalled(),
  );
  expect(screen.getByRole("button", { name: "Connect Gmail" })).toBeTruthy();
  expect(screen.queryByText(/Microsoft|Outlook/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
});
it.each([new Error("offline"), null])(
  "shows integration load failure %s",
  async (failure) => {
    vi.mocked(auth.listAccountEmailIntegrations).mockRejectedValue(failure);
    render(<IntegrationsSettingsBody />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Integrations could not be loaded",
        {
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        },
      ),
    );
  },
);
it.each([false, true])(
  "explains a missing OAuth configuration when configured=%s",
  async (configured) => {
    vi.mocked(auth.connectAccountEmailIntegration).mockResolvedValue({
      provider: "gmail",
      configured,
      connected: false,
      url: null,
    });
    render(<IntegrationsSettingsBody />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Integration is not configured",
        expect.objectContaining({
          description: expect.stringContaining("OAuth client ID"),
        }),
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Connect Gmail" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("navigates to the Google OAuth URL supplied by the backend", async () => {
  const assign = vi.fn();
  const browserWindow = window;
  vi.stubGlobal(
    "window",
    new Proxy(browserWindow, {
      get(target, key) {
        return key === "location"
          ? { ...browserWindow.location, assign }
          : Reflect.get(target, key);
      },
    }),
  );
  render(<IntegrationsSettingsBody />);
  fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      "https://accounts.google.com/test-oauth",
    ),
  );
  expect(auth.connectAccountEmailIntegration).toHaveBeenCalledWith("gmail");
});
it("shows a reconnect button and connected address, then removes it after disconnect", async () => {
  vi.mocked(auth.listAccountEmailIntegrations).mockResolvedValue([
    { ...integration, connected: true, email: "sender@example.test" },
  ]);
  render(<IntegrationsSettingsBody />);
  await screen.findByText("sender@example.test");
  expect(screen.getByRole("button", { name: "Re-connect Gmail" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Gmail disconnected"),
  );
  expect(screen.queryByText("sender@example.test")).toBeNull();
  expect(auth.disconnectAccountEmailIntegration).toHaveBeenCalledWith("gmail");
});
it("uses a provider-name fallback for a connection without an address", async () => {
  vi.mocked(auth.listAccountEmailIntegrations).mockResolvedValue([
    { ...integration, connected: true },
  ]);
  render(<IntegrationsSettingsBody />);
  await screen.findByText("Gmail connected");
});
it.each([new Error("OAuth unavailable"), undefined])(
  "preserves connection controls after OAuth failure %s",
  async (failure) => {
    vi.mocked(auth.connectAccountEmailIntegration).mockRejectedValue(failure);
    render(<IntegrationsSettingsBody />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Gmail" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Integration connection failed",
        {
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        },
      ),
    );
    expect(
      screen
        .getByRole("button", { name: "Connect Gmail" })
        .hasAttribute("disabled"),
    ).toBe(false);
  },
);
it("retains the connected integration on disconnect failure", async () => {
  vi.mocked(auth.listAccountEmailIntegrations).mockResolvedValue([
    { ...integration, connected: true },
  ]);
  vi.mocked(auth.disconnectAccountEmailIntegration).mockRejectedValue(
    new Error("permission denied"),
  );
  render(<IntegrationsSettingsBody />);
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Integration disconnect failed", {
      description: "permission denied",
    }),
  );
  expect(screen.getByText("Gmail connected")).toBeTruthy();
});
