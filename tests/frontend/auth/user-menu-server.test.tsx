// @vitest-environment node
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
import { UserMenu } from "../../../apps/frontend/app/templates/_components/user-menu";
it("server-renders a stable neutral avatar before browser account storage is available", () => {
  const markup = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <UserMenu />
    </QueryClientProvider>,
  );
  expect(markup).toContain("Open user menu");
  expect(markup).toContain("CO");
});
