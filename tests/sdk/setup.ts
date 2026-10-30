import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  if (typeof document === "undefined") return;
  document.head
    .querySelectorAll('script[id^="signa-"]')
    .forEach((node) => node.remove());
});
