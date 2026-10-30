import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ replace: vi.fn() }));
const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { UserMenu } from "../../../apps/frontend/app/templates/_components/user-menu";
import {
  clearAuthSession,
  getAuthSession,
  saveAuthSession,
  type AuthResponse,
} from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "../signing/signing-fixtures";
const session: AuthResponse = {
  access_token: "test-token",
  user: {
    id: "user",
    email: "casey@example.test",
    role: "admin",
    first_name: "Casey",
    last_name: "Example",
  },
  account: { id: "account", name: "Example", locale: "en-US", timezone: "UTC" },
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  notifications.success.mockClear();
  notifications.error.mockClear();
  saveAuthSession(session);
  fetchMock = vi
    .fn()
    .mockImplementation(async () =>
      jsonResponse({
        ...session,
        account: { ...session.account, is_test_mode: true },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("PointerEvent", MouseEvent);
});
function menu() {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <UserMenu />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
function openMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Open user menu" }),
    { button: 0, ctrlKey: false },
  );
}
it("shows initials, workspace links and signs out while clearing the persisted session", async () => {
  menu();
  expect(screen.getByText("CE")).toBeTruthy();
  openMenu();
  expect(
    await screen.findByRole("menuitem", {
      name: "Switch account / Invitations",
    }),
  ).toHaveProperty("href", "http://localhost:3000/settings/accounts");
  fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(getAuthSession()).toBeNull();
  expect(routing.replace).toHaveBeenCalledWith("/auth/login");
});
it.each([
  ["Casey", "", "casey@example.test", "C"],
  ["", "", "casey@example.test", "CA"],
  ["", "", "", "C"],
  ["   ", "", "casey@example.test", "CO"],
])(
  "derives initials from available identity fields",
  (first_name, last_name, email, initials) => {
    saveAuthSession({
      ...session,
      user: { ...session.user, first_name, last_name, email },
    });
    menu();
    expect(screen.getByText(initials)).toBeTruthy();
  },
);
it("updates initials when the account session changes", () => {
  menu();
  act(() => {
    saveAuthSession({
      ...session,
      user: { ...session.user, first_name: "New", last_name: "Name" },
    });
  });
  expect(screen.getByText("NN")).toBeTruthy();
});
it("handles a missing session without exposing stale user initials", () => {
  clearAuthSession();
  menu();
  expect(screen.getByText("C")).toBeTruthy();
});
it("toggles test mode through the real API and invalidates account-scoped queries", async () => {
  const { client } = menu();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  openMenu();
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Test mode" }),
  );
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith("Test mode enabled"),
  );
  expect(invalidate).toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/testing-account");
});
