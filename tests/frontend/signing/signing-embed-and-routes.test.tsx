import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ replace: vi.fn() }));
const confetti = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("canvas-confetti", () => ({ default: confetti }));
import PublicSigningPage from "../../../apps/frontend/app/s/[slug]/page";
import PublicSigningCompletedPage from "../../../apps/frontend/app/s/[slug]/completed/page";
import { SigningPage } from "../../../apps/frontend/app/s/[slug]/signing-page";
import { signingForm, jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  confetti.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async () => jsonResponse(signingForm()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/s/slug");
});
it("passes async route params, focus and tracking through to signing", async () => {
  const element = await PublicSigningPage({
    params: Promise.resolve({ slug: "route-slug" }),
    searchParams: Promise.resolve({ f: "field", t: "route-tracking" }),
  });
  render(element);
  await screen.findByPlaceholderText("Full name");
  expect(fetchMock.mock.calls[0][0]).toBe(
    "/api/signing/route-slug?t=route-tracking",
  );
});
it("passes async completed route params to the completed page", async () => {
  const form = signingForm();
  form.submitter.completed_at = "2026-10-30";
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(
    await PublicSigningCompletedPage({
      params: Promise.resolve({ slug: "completed-slug" }),
    }),
  );
  await screen.findByText("Customer agreement");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/signing/completed-slug");
});
it("posts iframe init/load/resize events and disconnects its resize observer on unmount", async () => {
  window.history.replaceState({}, "", "/s/slug?embed=true");
  const postMessage = vi.fn();
  const host = { postMessage };
  vi.spyOn(window, "parent", "get").mockReturnValue(host as unknown as Window);
  let resize: (() => void) | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const view = render(<SigningPage slug="slug" />);
  await screen.findByPlaceholderText("Full name");
  expect(observe).toHaveBeenCalledWith(document.body);
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      source: "signa",
      type: "init",
      detail: expect.objectContaining({ title: "Customer agreement" }),
    }),
    "*",
  );
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ source: "signa", type: "load" }),
    "*",
  );
  resize?.();
  expect(postMessage).toHaveBeenCalledWith(
    {
      source: "signa",
      type: "resize",
      height: document.documentElement.scrollHeight,
    },
    "*",
  );
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
it("does not enable iframe behavior merely because it has a different parent", async () => {
  const postMessage = vi.fn();
  vi.spyOn(window, "parent", "get").mockReturnValue({
    postMessage,
  } as unknown as Window);
  const observed = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observed;
      disconnect() {}
    },
  );
  render(<SigningPage slug="slug" />);
  await screen.findByPlaceholderText("Full name");
  expect(observed).not.toHaveBeenCalled();
  expect(postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "load" }),
    "*",
  );
});
it("celebrates completion only when organization settings enable confetti", async () => {
  const form = signingForm();
  form.configs.with_confetti = true;
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" />);
  const input = await screen.findByPlaceholderText("Full name");
  fireEvent.change(input, { target: { value: "Casey" } });
  await act(async () => {
    await Promise.resolve();
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      ...form,
      values: { "field-1": "Casey" },
      submitter: { ...form.submitter, completed_at: "2026-10-31" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await screen.findByText("Form has been completed!");
  await waitFor(() =>
    expect(confetti).toHaveBeenCalledWith({
      particleCount: 140,
      spread: 70,
      origin: { y: 0.7 },
    }),
  );
});
