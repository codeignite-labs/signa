import { afterAll, beforeAll, beforeEach, vi } from "vitest";
// jsdom does not implement layout/scrolling. Keep the actual Radix controls in these tests.
const originalScroll = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
beforeAll(() =>
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  }),
);
afterAll(() => {
  if (originalScroll)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScroll,
    );
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
