import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const notices = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: notices }));
import { Pattern as CheckboxPattern } from "../../../apps/frontend/components/examples/c-checkbox-1";
import { Pattern as SwitchPattern } from "../../../apps/frontend/components/examples/c-switch-9";
import { Pattern as DeactivationPattern } from "../../../apps/frontend/components/examples/c-alert-dialog-8";
import { Pattern as TeamEmptyPattern } from "../../../apps/frontend/components/examples/c-empty-8";
import { Pattern as SearchEmptyPattern } from "../../../apps/frontend/components/examples/c-empty-16";
import { Pattern as ToastKindsPattern } from "../../../apps/frontend/components/examples/c-sonner-4";
import { Pattern as ToastClosePattern } from "../../../apps/frontend/components/examples/c-sonner-18";
import { Pattern as ToastProgressPattern } from "../../../apps/frontend/components/examples/c-sonner-21";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  notices.mockClear();
  for (const callback of [
    notices.success,
    notices.error,
    notices.warning,
    notices.info,
    notices.loading,
    notices.custom,
  ])
    callback.mockClear();
});
afterEach(() => vi.useRealTimers());
it("lets users toggle the example checkbox and two-factor switch with their labels", async () => {
  const view = render(<CheckboxPattern />);
  fireEvent.click(screen.getByLabelText("Basic checkbox"));
  expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
    "true",
  );
  view.unmount();
  render(<SwitchPattern />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Two-factor authentication" }),
  );
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  fireEvent.focus(screen.getByRole("button"));
  expect(await screen.findByRole("tooltip")).toHaveProperty(
    "textContent",
    "Adds an extra layer of security by requiring a verification code on login.",
  );
});
it("requires confirmation for the deactivation example and supports cancellation", async () => {
  render(<DeactivationPattern />);
  fireEvent.click(screen.getByRole("button", { name: "Deactivate Account" }));
  await screen.findByRole("alertdialog");
  fireEvent.click(screen.getByRole("button", { name: "Keep My Account" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Deactivate Account" }));
  fireEvent.click(screen.getByRole("button", { name: "Deactivate Anyway" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
it("shows useful empty-state guidance and hides decorative search artwork from assistive technology", () => {
  const view = render(<TeamEmptyPattern />);
  expect(screen.getByText("No team members")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Invite People" })).toBeTruthy();
  view.unmount();
  const search = render(<SearchEmptyPattern />);
  expect(screen.getByText("Looking for something?")).toBeTruthy();
  expect(search.container.querySelector("[aria-hidden=true]")).toBeTruthy();
  expect(screen.getByText(/Type a keyword/)).toBeTruthy();
});
it("uses distinct toast methods for notification severities and supports a dismiss control", () => {
  const view = render(<ToastKindsPattern />);
  for (const name of [
    "Default",
    "Success",
    "Error",
    "Warning",
    "Info",
    "Loading",
  ])
    fireEvent.click(screen.getByRole("button", { name }));
  expect(notices).toHaveBeenCalledWith("Default notification");
  expect(notices.success).toHaveBeenCalledWith(
    "Operation completed",
    expect.anything(),
  );
  expect(notices.error).toHaveBeenCalledWith(
    "Operation failed",
    expect.anything(),
  );
  expect(notices.warning).toHaveBeenCalledWith(
    "Proceed with caution",
    expect.anything(),
  );
  expect(notices.info).toHaveBeenCalledWith(
    "System update available",
    expect.anything(),
  );
  expect(notices.loading).toHaveBeenCalledWith("Processing...");
  view.unmount();
  render(<ToastClosePattern />);
  fireEvent.click(
    screen.getByRole("button", { name: "Toast with Close Button" }),
  );
  expect(notices).toHaveBeenCalledWith(
    "File uploaded successfully",
    expect.objectContaining({
      closeButton: true,
      description: "report-2025.pdf has been saved to your documents.",
    }),
  );
});
it("updates one toast through preparing, upload progress and completion instead of stacking notices", () => {
  vi.useFakeTimers();
  notices.custom.mockReturnValue("upload-toast");
  render(<ToastProgressPattern />);
  fireEvent.click(screen.getByRole("button", { name: "Updatable Toast" }));
  const toastView = render(notices.custom.mock.calls.at(-1)![0]());
  expect(screen.getByText("Preparing upload...")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  toastView.rerender(notices.custom.mock.calls.at(-1)![0]());
  expect(screen.getByText("Uploading files... 30%")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  toastView.rerender(notices.custom.mock.calls.at(-1)![0]());
  expect(screen.getByText("Uploading files... 70%")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1000));
  toastView.rerender(notices.custom.mock.calls.at(-1)![0]());
  expect(screen.getByText("Upload complete!")).toBeTruthy();
  expect(screen.getByText("3 files uploaded successfully.")).toBeTruthy();
  expect(notices.custom.mock.calls.slice(1).map((call) => call[1].id)).toEqual([
    "upload-toast",
    "upload-toast",
    "upload-toast",
  ]);
  expect(notices.custom.mock.calls.at(-1)![1].duration).toBe(4000);
});
