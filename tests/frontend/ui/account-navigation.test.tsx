import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AcceptTeamInvitationPage from "../../../apps/frontend/app/team-invitations/[token]/accept/page";
import { TestModeAlert } from "../../../apps/frontend/app/test-mode-alert";

const state = vi.hoisted(() => ({
  pathname: "/templates",
  pending: false,
  testing: true,
  switchMode: vi.fn(),
  accept: vi.fn(),
  enter: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "invite/token" }),
  usePathname: () => state.pathname,
}));
vi.mock("../../../apps/frontend/lib/api/auth", () => ({
  authenticatedApiFetch: (...args: unknown[]) => state.accept(...args),
}));
vi.mock("../../../apps/frontend/lib/api/account-memberships", () => ({
  enterAccount: (...args: unknown[]) => state.enter(...args),
}));
vi.mock("../../../apps/frontend/lib/hooks/use-test-mode", () => ({
  useTestMode: () => ({
    isPending: state.pending,
    isTestMode: state.testing,
    setTestMode: state.switchMode,
  }),
}));
beforeEach(() => {
  state.pathname = "/templates";
  state.pending = false;
  state.testing = true;
  state.accept.mockReset();
  state.enter.mockReset();
  state.switchMode.mockReset();
});
it("accepts an encoded invitation once and enters the returned organization", async () => {
  let resolve!: (value: { member: { account_id: string } }) => void;
  state.accept.mockReturnValue(
    new Promise((value) => {
      resolve = value;
    }),
  );
  state.enter.mockResolvedValue(undefined);
  render(<AcceptTeamInvitationPage />);
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  const busy = screen.getByRole("button", {
    name: "Joining…",
  }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  fireEvent.click(busy);
  expect(state.accept).toHaveBeenCalledExactlyOnceWith(
    "/team-invitations/invite%2Ftoken/accept",
    { method: "POST" },
  );
  await act(async () =>
    resolve({ member: { account_id: "accepted-account" } }),
  );
  expect(state.enter).toHaveBeenCalledExactlyOnceWith(
    "accepted-account",
    "switch",
  );
});
it.each([new Error("Invitation expired"), "unavailable"])(
  "shows invitation errors and permits a retry",
  async (failure) => {
    state.accept
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ member: { account_id: "accepted-account" } });
    state.enter.mockResolvedValue(undefined);
    render(<AcceptTeamInvitationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      failure instanceof Error
        ? failure.message
        : "Invitation could not be accepted.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() =>
      expect(state.enter).toHaveBeenCalledWith("accepted-account", "switch"),
    );
  },
);
it("reports an account-switch failure instead of presenting an accepted session", async () => {
  state.accept.mockResolvedValue({
    member: { account_id: "accepted-account" },
  });
  state.enter.mockRejectedValue(new Error("Membership revoked"));
  render(<AcceptTeamInvitationPage />);
  fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Membership revoked",
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Accept invitation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it.each(["/auth/login", "/s/document", "/d/template"])(
  "hides test-mode controls on public route %s",
  (pathname) => {
    state.pathname = pathname;
    render(<TestModeAlert />);
    expect(screen.queryByRole("button")).toBeNull();
  },
);
it("hides the banner in production mode", () => {
  state.testing = false;
  render(<TestModeAlert />);
  expect(screen.queryByText("Test mode is active.")).toBeNull();
});
it("links to testing settings and exits test mode when requested", () => {
  render(<TestModeAlert />);
  expect(
    screen
      .getByRole("link", { name: "View testing API settings" })
      .getAttribute("href"),
  ).toBe("/settings/api");
  fireEvent.click(screen.getByRole("button", { name: "Exit test mode" }));
  expect(state.switchMode).toHaveBeenCalledExactlyOnceWith(false);
});
it("disables exit while an account switch is pending", () => {
  state.pending = true;
  render(<TestModeAlert />);
  const exit = screen.getByRole("button", {
    name: "Exit test mode",
  }) as HTMLButtonElement;
  expect(exit.disabled).toBe(true);
  fireEvent.click(exit);
  expect(state.switchMode).not.toHaveBeenCalled();
});
