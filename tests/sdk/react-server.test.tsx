// @vitest-environment node
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SignaForm, SignaBuilder } from "../../packages/signa-react/src/index";
it("renders an async script and custom element without browser globals", () => {
  for (const Component of [SignaForm, SignaBuilder]) {
    const html = renderToStaticMarkup(<Component token="id" />);
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("<script");
    expect(html).toContain("async=");
  }
});
