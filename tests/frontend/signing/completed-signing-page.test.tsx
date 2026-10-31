import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ replace: vi.fn() }));
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { CompletedSigningPage } from "../../../apps/frontend/app/s/[slug]/completed-signing-page";
import { signingForm, jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
const completed = () => {
  const form = signingForm();
  form.submitter.completed_at = "2026-10-30T12:00:00Z";
  return form;
};
beforeEach(() => {
  routing.replace.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi.fn().mockImplementation(async () => jsonResponse(completed()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/s/slug/completed");
});
it("shows loading, completion date, and downloads every completed document", async () => {
  const form = completed();
  form.fields = [{ type: "signature" }];
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  const clicks = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  render(<CompletedSigningPage slug="slug" />);
  expect(screen.getByText("Loading completed document")).toBeTruthy();
  expect(await screen.findByText("Signed on October 30, 2026")).toBeTruthy();
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      documents: [
        { url: "/signed.pdf", filename: "signed.pdf" },
        { url: "/audit.pdf", filename: "audit.pdf" },
      ],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "DOWNLOAD DOCUMENTS" }));
  await waitFor(() => expect(clicks).toHaveBeenCalledTimes(2));
  const links = clicks.mock.instances as HTMLAnchorElement[];
  expect(
    links.map((link) => [
      link.getAttribute("href"),
      link.download,
      link.rel,
      link.target,
    ]),
  ).toEqual([
    ["/signed.pdf", "signed.pdf", "noreferrer", "_blank"],
    ["/audit.pdf", "audit.pdf", "noreferrer", "_blank"],
  ]);
});
it("labels non-signature completions and queues a copy email", async () => {
  render(<CompletedSigningPage slug="slug" />);
  expect(await screen.findByText("Completed on October 30, 2026")).toBeTruthy();
  fetchMock.mockResolvedValueOnce(jsonResponse({ status: "queued" }));
  fireEvent.click(screen.getByRole("button", { name: "SEND COPY TO EMAIL" }));
  await waitFor(() =>
    expect(notifications.success).toHaveBeenCalledWith(
      "Document copy email queued",
    ),
  );
  expect(fetchMock.mock.calls[1][0]).toBe("/api/send_submission_email");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    submitter_slug: "slug",
  });
});
it("resubmits and carries embedded appearance options into the new signing link", async () => {
  window.history.replaceState(
    {},
    "",
    "/s/slug/completed?embed=true&theme=dark&primary-color=%23123456&discard=1",
  );
  // Browser media preference is only a boundary of the real branding component.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(<CompletedSigningPage slug="slug" />);
  await screen.findByText("Customer agreement");
  const next = signingForm();
  next.submitter.slug = "resubmitted";
  fetchMock.mockResolvedValueOnce(jsonResponse(next));
  fireEvent.click(screen.getByRole("button", { name: "RESUBMIT" }));
  await waitFor(() =>
    expect(routing.replace).toHaveBeenCalledWith(
      "/s/resubmitted?embed=true&theme=dark&primary-color=%23123456",
    ),
  );
});
it("redirects unfinished links back to signing", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse(signingForm()));
  render(<CompletedSigningPage slug="slug" />);
  await waitFor(() => expect(routing.replace).toHaveBeenCalledWith("/s/slug"));
});
it.each([new Error("Connection lost"), "untyped rejection"])(
  "shows a useful load error",
  async (failure) => {
    fetchMock.mockRejectedValueOnce(failure);
    render(<CompletedSigningPage slug="slug" />);
    await screen.findByText("Completed document unavailable");
    expect(
      screen.getByText(
        failure instanceof Error
          ? failure.message
          : "Completed document could not be loaded.",
      ),
    ).toBeTruthy();
  },
);
it.each([
  [
    403,
    "Denied",
    "Authentication is required to download completed documents for this account.",
  ],
  [500, "Unavailable", "Unavailable"],
])(
  "handles download status %i without leaving controls disabled",
  async (status, error, message) => {
    render(<CompletedSigningPage slug="slug" />);
    await screen.findByText("Customer agreement");
    fetchMock.mockResolvedValueOnce(jsonResponse({ error }, status));
    const button = screen.getByRole("button", { name: "DOWNLOAD DOCUMENTS" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(notifications.error).toHaveBeenCalledWith("Download failed", {
        description: message,
      }),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
  },
);
it.each([
  [
    "DOWNLOAD DOCUMENTS",
    "Download failed",
    "Document could not be downloaded.",
  ],
  [
    "SEND COPY TO EMAIL",
    "Copy email failed",
    "Document copy email could not be sent.",
  ],
  ["RESUBMIT", "Resubmit failed", "This document cannot be resubmitted."],
])("handles untyped failures for %s", async (button, title, fallback) => {
  render(<CompletedSigningPage slug="slug" />);
  await screen.findByText("Customer agreement");
  fetchMock.mockRejectedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(title, {
      description: fallback,
    }),
  );
});
it.each([
  ["SEND COPY TO EMAIL", "Copy email failed"],
  ["RESUBMIT", "Resubmit failed"],
])("preserves specific error messages for %s", async (button, title) => {
  render(<CompletedSigningPage slug="slug" />);
  await screen.findByText("Customer agreement");
  fetchMock.mockRejectedValueOnce(new Error("Specific failure"));
  fireEvent.click(screen.getByRole("button", { name: button }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith(title, {
      description: "Specific failure",
    }),
  );
});
