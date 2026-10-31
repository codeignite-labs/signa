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
const notifications = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routing }));
vi.mock("sonner", () => ({ toast: notifications }));
import { SigningPage } from "../../../apps/frontend/app/s/[slug]/signing-page";
import { signingForm, jsonResponse } from "./signing-fixtures";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  routing.replace.mockClear();
  notifications.error.mockClear();
  notifications.success.mockClear();
  fetchMock = vi
    .fn()
    .mockImplementation(async () => jsonResponse(signingForm()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/s/slug");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
async function loadForm(form = signingForm()) {
  fetchMock.mockResolvedValueOnce(jsonResponse(form));
  render(<SigningPage slug="slug" />);
  await screen.findByRole("heading", { name: "Customer agreement" });
  await act(async () => {
    await Promise.resolve();
  });
}
it("does not label a newly typed phone as server accepted or verified", async () => {
  const form = signingForm({
    fields: [
      {
        uuid: "phone",
        type: "phone",
        name: "Phone",
        validation: { phone_country: "US" },
      },
    ],
  });
  await loadForm(form);
  const input = (await screen.findAllByRole("textbox")).find(
    (element) => element.getAttribute("type") === "tel",
  )!;
  fireEvent.change(input, { target: { value: "4155552671" } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText(/Phone number is valid and verified/)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Use valid number" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("requires server phone validation before completion and does not call it SMS verification", async () => {
  const form = signingForm({
    fields: [
      {
        uuid: "phone",
        type: "phone",
        name: "Phone",
        validation: { phone_country: "US" },
      },
    ],
  });
  await loadForm(form);
  const input = (await screen.findAllByRole("textbox")).find(
    (element) => element.getAttribute("type") === "tel",
  )!;
  fireEvent.change(input, { target: { value: "4155552671" } });
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await waitFor(() =>
    expect(notifications.error).toHaveBeenCalledWith("Signing failed", {
      description: "Enter a valid phone number before continuing.",
    }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ phone: "+14155552671", valid: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use valid number" }));
  await screen.findByRole("button", { name: "Accepted" });
  expect(screen.queryByText(/valid and verified/)).toBeNull();
  const completed = {
    ...form,
    values: { phone: "+14155552671" },
    submitter: { ...form.submitter, completed_at: "2026-10-31" },
  };
  fetchMock.mockResolvedValueOnce(jsonResponse(completed));
  fireEvent.click(screen.getByRole("button", { name: "SIGN AND COMPLETE" }));
  await screen.findByText("Form has been completed!");
  expect(fetchMock.mock.calls[2][0]).toBe("/api/signing/slug/complete");
});
it("only labels an SMS verified phone after successful verification and invalidates it on edit", async () => {
  const form = signingForm({
    fields: [
      {
        uuid: "phone",
        type: "phone",
        name: "Phone",
        validation: { phone_country: "US" },
      },
    ],
  });
  await loadForm(form);
  const input = (await screen.findAllByRole("textbox")).find(
    (element) => element.getAttribute("type") === "tel",
  )!;
  fireEvent.change(input, { target: { value: "4155552671" } });
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByPlaceholderText("Code"), {
    target: { value: "123456" },
  });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ...form, values: { phone: "+14155552671" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await screen.findByText(/Phone number is valid and verified/);
  fireEvent.change(input, { target: { value: "4155552672" } });
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByText(/valid and verified/)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Use valid number" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
