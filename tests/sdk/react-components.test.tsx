import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SignaForm,
  SignaBuilder,
  DocusealForm,
  DocusealBuilder,
} from "../../packages/signa-react/src/index";

const wrappers = [
  {
    Component: SignaForm,
    tag: "signa-form",
    script: "signa-form-script",
    events: ["completed", "init", "declined", "load"],
    props: ["onComplete", "onInit", "onDecline", "onLoad"],
  },
  {
    Component: SignaBuilder,
    tag: "signa-builder",
    script: "signa-builder-script",
    events: ["send", "load", "upload", "save", "change"],
    props: ["onSend", "onLoad", "onUpload", "onSave", "onChange"],
  },
];

describe.each(wrappers)(
  "$tag React wrapper",
  ({ Component, tag, script, events, props }) => {
    it("loads the CDN script once and cleans event handlers on unmount", () => {
      const callbacks = Object.fromEntries(
        props.map((prop) => [prop, vi.fn()]),
      );
      const { container, unmount } = render(
        <Component token="token" {...callbacks} />,
      );
      const element = container.querySelector(tag)!;
      expect(document.getElementById(script)?.getAttribute("src")).toContain(
        "cdn.jsdelivr.net",
      );
      render(<Component token="other" />);
      expect(document.querySelectorAll(`#${script}`)).toHaveLength(1);
      for (const [i, event] of events.entries()) {
        fireEvent(element, new CustomEvent(event, { detail: { id: 42 } }));
        expect(callbacks[props[i]]).toHaveBeenCalledOnce();
      }
      unmount();
      for (const [i, event] of events.entries()) {
        fireEvent(element, new CustomEvent(event));
        expect(callbacks[props[i]]).toHaveBeenCalledOnce();
      }
    });
    it("maps explicit host, script, booleans and structured data to the custom element", () => {
      const { container, rerender } = render(
        <Component
          token="token"
          host=" sign.example/// "
          scriptUrl="https://cdn.example/embed.js"
          preview
          expand={false}
          withSignatureId={false}
          sendCopyEmail={false}
          fields={[{ name: "name" }]}
        />,
      );
      expect(document.getElementById(script)?.getAttribute("src")).toBe(
        "https://cdn.example/embed.js",
      );
      expect(container.querySelector(tag)?.getAttribute("data-host")).toBe(
        "https://sign.example",
      );
      expect(container.querySelector(tag)?.getAttribute("data-preview")).toBe(
        "true",
      );
      rerender(
        <Component
          token="next"
          host="http://localhost:3000/"
          preview={false}
        />,
      );
      expect(container.querySelector(tag)?.getAttribute("data-host")).toBe(
        "http://localhost:3000",
      );
    });
    it("uses the self-hosted script when explicitly opting out of the CDN", () => {
      render(
        <Component token="token" host="https://sign.example/" scriptUrl="" />,
      );
      expect(document.getElementById(script)?.getAttribute("src")).toBe(
        `https://sign.example/js/${tag === "signa-form" ? "form" : "builder"}.js`,
      );
    });
    it("handles optional callbacks and aliases", () => {
      const { container } = render(<Component token="token" />);
      for (const event of events)
        fireEvent(container.querySelector(tag)!, new CustomEvent(event));
      expect(DocusealForm).toBe(SignaForm);
      expect(DocusealBuilder).toBe(SignaBuilder);
    });
  },
);
