import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ApiSettingsBody } from "../../../apps/frontend/app/settings/_components/api-settings-body";
import * as auth from "../../../apps/frontend/lib/api/auth";
const testMode = vi.hoisted(() => ({
  isPending: false,
  isTestMode: false,
  setTestMode: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock(
  "../../../apps/frontend/app/settings/_components/settings-sidebar",
  () => ({ SettingsSidebar: () => null }),
);
vi.mock("../../../apps/frontend/lib/hooks/use-test-mode", () => ({
  useTestMode: () => testMode,
}));
vi.mock("../../../apps/frontend/lib/api/auth", async (original) => ({
  ...(await original<typeof import("../../../apps/frontend/lib/api/auth")>()),
  getApiToken: vi.fn(),
  revealApiToken: vi.fn(),
  rotateApiToken: vi.fn(),
  updateApiTokenPermissions: vi.fn(),
}));
const token: auth.ApiToken = {
  id: "token-1",
  token: "********masked",
  role: "admin",
  permissions: ["templates:read"],
  permissions_note: "",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  last_used_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  testMode.isPending = false;
  testMode.isTestMode = false;
  vi.mocked(auth.getApiToken).mockResolvedValue(token);
  vi.mocked(auth.revealApiToken).mockResolvedValue({
    ...token,
    revealed_token: "secret-revealed",
  });
  vi.mocked(auth.rotateApiToken).mockResolvedValue({
    ...token,
    revealed_token: "secret-rotated",
  });
  vi.mocked(auth.updateApiTokenPermissions).mockImplementation(
    async (permissions) => ({ ...token, permissions }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
async function renderToken() {
  render(<ApiSettingsBody />);
  await screen.findByDisplayValue(token.token);
}
function password(value = "password") {
  fireEvent.change(
    screen.getByPlaceholderText("Enter your password to reveal or rotate"),
    { target: { value } },
  );
}
it("displays a masked key with its assigned scopes and a test-mode toggle", async () => {
  await renderToken();
  expect(
    screen
      .getByRole("switch", { name: "Read templates" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen
      .getByRole("switch", { name: "Manage webhooks" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("switch", { name: "Test mode" }));
  expect(testMode.setTestMode).toHaveBeenCalledWith(true);
});
it("blocks token controls until the key loads", () => {
  vi.mocked(auth.getApiToken).mockReturnValue(new Promise(() => {}));
  render(<ApiSettingsBody />);
  for (const name of ["SHOW", "COPY", "ROTATE"])
    expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(
      true,
    );
  fireEvent.click(screen.getByRole("switch", { name: "Manage webhooks" }));
  expect(auth.updateApiTokenPermissions).not.toHaveBeenCalled();
});
it.each([new Error("offline"), null])(
  "reports an API token load failure %s",
  async (failure) => {
    vi.mocked(auth.getApiToken).mockRejectedValue(failure);
    render(<ApiSettingsBody />);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "API token could not be loaded",
        {
          description:
            failure instanceof Error ? failure.message : "Please try again.",
        },
      ),
    );
  },
);
it.each(["SHOW", "ROTATE"])("requires a password before %s", async (name) => {
  await renderToken();
  fireEvent.click(screen.getByRole("button", { name }));
  expect(toast.error).toHaveBeenCalledWith("Password is required");
  expect(auth.revealApiToken).not.toHaveBeenCalled();
  expect(auth.rotateApiToken).not.toHaveBeenCalled();
});
it("reveals and hides a key after password reauthentication", async () => {
  await renderToken();
  password();
  fireEvent.click(screen.getByRole("button", { name: "SHOW" }));
  await screen.findByDisplayValue("secret-revealed");
  expect(auth.revealApiToken).toHaveBeenCalledWith("password");
  fireEvent.click(screen.getByRole("button", { name: "HIDE" }));
  expect(screen.getByDisplayValue(token.token)).toBeTruthy();
});
it("rotates the key while preserving currently selected scopes", async () => {
  await renderToken();
  password();
  fireEvent.click(screen.getByRole("button", { name: "ROTATE" }));
  await screen.findByDisplayValue("secret-rotated");
  expect(auth.rotateApiToken).toHaveBeenCalledWith({
    password: "password",
    permissions: ["templates:read"],
  });
  expect(toast.success).toHaveBeenCalledWith("API token rotated");
});
it.each(["SHOW", "ROTATE"])(
  "reports a %s reauthentication failure and re-enables controls",
  async (name) => {
    vi.mocked(auth.revealApiToken).mockRejectedValue(
      new Error("Invalid password"),
    );
    vi.mocked(auth.rotateApiToken).mockRejectedValue(null);
    await renderToken();
    password();
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        name === "SHOW"
          ? "API token could not be revealed"
          : "API token could not be rotated",
        {
          description:
            name === "SHOW" ? "Invalid password" : "Please try again.",
        },
      ),
    );
    expect(screen.getByRole("button", { name }).hasAttribute("disabled")).toBe(
      false,
    );
  },
);
it("adds and removes scopes using the server-returned permissions", async () => {
  await renderToken();
  fireEvent.click(screen.getByRole("switch", { name: "Manage webhooks" }));
  await waitFor(() =>
    expect(auth.updateApiTokenPermissions).toHaveBeenCalledWith([
      "templates:read",
      "webhooks:write",
    ]),
  );
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("API permissions updated"),
  );
  fireEvent.click(screen.getByRole("switch", { name: "Read templates" }));
  await waitFor(() =>
    expect(auth.updateApiTokenPermissions).toHaveBeenLastCalledWith([
      "webhooks:write",
    ]),
  );
});
it("rolls back a scope toggle after permission save fails", async () => {
  vi.mocked(auth.updateApiTokenPermissions).mockRejectedValue(
    new Error("Denied"),
  );
  await renderToken();
  fireEvent.click(screen.getByRole("switch", { name: "Manage webhooks" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "API permissions could not be updated",
      { description: "Denied" },
    ),
  );
  expect(
    screen
      .getByRole("switch", { name: "Manage webhooks" })
      .getAttribute("aria-checked"),
  ).toBe("false");
});
it("copies the displayed key and includes it in complete curl examples", async () => {
  await renderToken();
  fireEvent.click(screen.getByRole("button", { name: "COPY" }));
  await waitFor(() =>
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(token.token),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Request signature with submitters/ }),
  );
  expect(screen.getByText(/curl --location/).textContent).toContain(
    "Content-Type: application/json",
  );
  expect(screen.getByText(/curl --location/).textContent).toContain(
    token.token,
  );
  fireEvent.click(screen.getByRole("button", { name: /Template details/ }));
  expect(screen.getByText(/curl --location/).textContent).toContain(
    "/templates/1",
  );
  expect(screen.getByText(/curl --location/).textContent).not.toContain(
    "--data-raw",
  );
});
it("uses API_TOKEN in examples before a key is available and ignores empty copy requests", () => {
  vi.mocked(auth.getApiToken).mockReturnValue(new Promise(() => {}));
  render(<ApiSettingsBody />);
  fireEvent.click(
    screen.getByRole("button", { name: /Request signature by emails/ }),
  );
  expect(screen.getByText(/curl --location/).textContent).toContain(
    "API_TOKEN",
  );
});
