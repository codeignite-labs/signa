import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ThemeModeSwitcher } from "../../../apps/frontend/app/templates/_components/theme-mode-switcher";
import { ThemeSwitcher } from "../../../apps/frontend/components/kibo-ui/theme-switcher";
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let listeners: Set<() => void>;
beforeEach(() => {
  document.documentElement.classList.remove("dark");
  listeners = new Set();
  media = {
    matches: false,
    addEventListener: vi.fn((_name: string, listener: () => void) =>
      listeners.add(listener),
    ),
    removeEventListener: vi.fn((_name: string, listener: () => void) =>
      listeners.delete(listener),
    ),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
});
it("uses the system theme by default and persists explicit user choices", () => {
  render(<ThemeModeSwitcher />);
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
  expect(localStorage.getItem("signa.theme")).toBe("dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
  expect(localStorage.getItem("signa.theme")).toBe("light");
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "System theme" }));
  expect(localStorage.getItem("signa.theme")).toBe("system");
});
it.each(["dark", "light", "invalid"])(
  "restores a persisted %s preference and follows system changes only in system mode",
  (stored) => {
    localStorage.setItem("signa.theme", stored);
    render(<ThemeModeSwitcher />);
    expect(document.documentElement.classList.contains("dark")).toBe(
      stored === "dark",
    );
    media.matches = true;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(
      stored !== "light",
    );
  },
);
it("applies a cross-tab theme preference and unsubscribes all listeners on unmount", () => {
  const view = render(<ThemeModeSwitcher />);
  localStorage.setItem("signa.theme", "dark");
  act(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "signa.theme" })),
  );
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  view.unmount();
  expect(media.removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});
it("falls back to the system theme when browser storage reads are blocked", () => {
  media.matches = true;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  render(<ThemeModeSwitcher />);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
it("renders a stable system appearance on the server", () => {
  localStorage.setItem("signa.theme", "dark");
  const markup = renderToString(<ThemeModeSwitcher />);
  expect(markup).toContain('aria-label="System theme"');
  expect(markup).toContain('aria-label="Dark theme"');
});
it("supports an uncontrolled standalone theme switcher and notifies its host of the selected value", () => {
  const changed = vi.fn();
  render(<ThemeSwitcher defaultValue="light" onChange={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Dark theme" }));
  expect(changed).toHaveBeenCalledWith("dark");
});
