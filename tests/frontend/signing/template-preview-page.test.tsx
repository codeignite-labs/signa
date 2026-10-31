import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ push: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routing,
  useParams: () => ({ id: "template" }),
}));
vi.mock("sonner", () => ({ toast: notifications }));
import TemplateFormPreviewPage from "../../../apps/frontend/app/templates/[id]/form/page";
import { saveAuthSession } from "../../../apps/frontend/lib/api/auth";
import { jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.push.mockClear();
  notifications.error.mockClear();
  saveAuthSession({
    access_token: "token",
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
  });
  fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      id: "template",
      name: "Customer agreement",
      documents: [
        {
          uuid: "document",
          preview_images: [
            {
              id: "first",
              url: "/first.png",
              metadata: { width: 600, height: 800 },
            },
            { url: "/second.png", metadata: {} },
          ],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
it("loads authenticated preview pages and keeps an editor return link with explicit dimension fallbacks", async () => {
  render(<TemplateFormPreviewPage />);
  expect(screen.getByText("Loading preview")).toBeTruthy();
  await screen.findByRole("heading", { name: "Customer agreement" });
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "/templates/template/edit",
  );
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("width"),
  ).toBe("600");
  expect(
    screen.getByAltText("Customer agreement page 1").getAttribute("height"),
  ).toBe("800");
  expect(
    screen.getByAltText("Customer agreement page 2").getAttribute("width"),
  ).toBe("1000");
  expect(
    screen.getByAltText("Customer agreement page 2").getAttribute("height"),
  ).toBe("1400");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/templates/template");
});
it("renders an empty document list without remaining stuck in loading", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ id: "template", name: "Empty template", documents: [] }),
  );
  render(<TemplateFormPreviewPage />);
  await screen.findByRole("heading", { name: "Empty template" });
  expect(screen.queryByText("Loading preview")).toBeNull();
});
it("redirects an expired session to login", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Expired" }, 401));
  render(<TemplateFormPreviewPage />);
  await waitFor(() => expect(routing.push).toHaveBeenCalledWith("/auth/login"));
});
it.each([new Error("Missing PDF"), null])(
  "shows preview load failures with a link back to the editor",
  async (failure) => {
    fetchMock.mockRejectedValueOnce(failure);
    render(<TemplateFormPreviewPage />);
    await screen.findByRole("heading", { name: "Preview unavailable" });
    const message =
      failure instanceof Error
        ? failure.message
        : "Template preview could not be loaded.";
    expect(screen.getByText(message)).toBeTruthy();
    expect(notifications.error).toHaveBeenCalledWith("Preview unavailable", {
      description: message,
    });
    expect(
      screen.getByRole("link", { name: "Back to editor" }).getAttribute("href"),
    ).toBe("/templates/template/edit");
  },
);
