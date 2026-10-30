import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({
  pathname: "/templates",
  replace: vi.fn(),
  session: null as object | null,
  listener: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => routing.pathname,
  useRouter: () => ({ replace: routing.replace }),
}));
vi.mock("../../apps/frontend/lib/api/auth", () => ({
  getAuthSession: () => routing.session,
  subscribeToAuthSessionChange: (listener: () => void) => {
    routing.listener = listener;
    return routing.unsubscribe;
  },
}));
import { AuthRouteGuard } from "../../apps/frontend/app/auth-route-guard";
beforeEach(() => {
  routing.replace.mockClear();
  routing.unsubscribe.mockClear();
  routing.session = null;
});
it.each([
  "/",
  "/auth/login",
  "/s/id",
  "/d/id",
  "/ai-assistant",
  "/api/docs",
  "/s",
])("keeps public route %s available without login", (pathname) => {
  routing.pathname = pathname;
  const page = render(
    <AuthRouteGuard>
      <h1>Public content</h1>
    </AuthRouteGuard>,
  );
  expect(page.getByText("Public content")).toBeTruthy();
  expect(routing.replace).not.toHaveBeenCalled();
});
it.each(["/templates", "/settings/users", "/sneaky", "/documents"])(
  "redirects unauthenticated private route %s and preserves its return path",
  (pathname) => {
    routing.pathname = pathname;
    render(<AuthRouteGuard>Private</AuthRouteGuard>);
    expect(routing.replace).toHaveBeenCalledWith(
      `/auth/login?next=${encodeURIComponent(pathname)}`,
    );
  },
);
it("reacts to session changes, avoids auth-page loops and disposes its subscription", () => {
  routing.pathname = "/auth/login";
  const page = render(<AuthRouteGuard>Login</AuthRouteGuard>);
  routing.session = { account: { id: "one" } };
  act(() => routing.listener?.());
  expect(routing.replace).toHaveBeenCalledWith("/templates");
  routing.pathname = "/templates";
  page.rerender(<AuthRouteGuard>Templates</AuthRouteGuard>);
  routing.replace.mockClear();
  act(() => routing.listener?.());
  expect(routing.replace).not.toHaveBeenCalled();
  routing.session = null;
  act(() => routing.listener?.());
  expect(routing.replace).toHaveBeenCalledWith("/auth/login?next=%2Ftemplates");
  page.unmount();
  expect(routing.unsubscribe).toHaveBeenCalled();
});
