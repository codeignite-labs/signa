import { afterEach, describe, expect, it, vi } from "vitest";

function fakeElement(dataset: Record<string, string | undefined>) {
  return class {
    dataset = dataset;
    isConnected = true;
    appendChild = vi.fn();
    dispatchEvent = vi.fn();
  };
}
async function bridge(
  kind: "form" | "builder",
  dataset: Record<string, string | undefined> = {},
) {
  vi.resetModules();
  const frame = {
    src: "",
    style: {},
    setAttribute: vi.fn(),
    contentWindow: { postMessage: vi.fn() },
  };
  vi.stubGlobal("HTMLElement", fakeElement(dataset));
  vi.spyOn(window.customElements, "get").mockReturnValue(undefined);
  const define = vi
    .spyOn(window.customElements, "define")
    .mockImplementation(() => {});
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((name: string) =>
    name === "iframe" ? frame : create(name)) as any);
  if (kind === "form")
    await import("../../packages/signa-react/browser/form.js");
  else await import("../../packages/signa-react/browser/builder.js");
  const Element = define.mock.calls[0][1] as any;
  return { element: new Element(), Element, frame };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(["form", "builder"] as const)("%s browser bridge", (kind) => {
  it("registers once, manages listeners and maps iframe query parameters", async () => {
    const { element, Element, frame } = await bridge(kind, {
      src: "https://sign.example/s/id",
      host: "https://host.example",
      externalId: "42",
      ignored: undefined,
    });
    expect(Element.observedAttributes).toContain("data-src");
    const remove = vi.spyOn(window, "removeEventListener");
    element.connectedCallback();
    expect(new URL(frame.src).searchParams.get("external-id")).toBe("42");
    expect(new URL(frame.src).searchParams.has("host")).toBe(false);
    expect(element.appendChild).toHaveBeenCalledOnce();
    element.attributeChangedCallback("data-src");
    expect(element.appendChild).toHaveBeenCalledOnce();
    element.disconnectedCallback();
    expect(remove).toHaveBeenCalledWith("message", element.onMessage);
    vi.mocked(window.customElements.get).mockReturnValue(Element);
    vi.resetModules();
    if (kind === "form")
      await import("../../packages/signa-react/browser/form.js");
    else await import("../../packages/signa-react/browser/builder.js");
    expect(window.customElements.define).toHaveBeenCalledOnce();
  });
  it("ignores missing source and disconnected attribute changes", async () => {
    const { element } = await bridge(kind);
    element.connectedCallback();
    expect(element.iframe).toBeUndefined();
    element.isConnected = false;
    element.attributeChangedCallback("data-src");
    element.sendAppearance?.();
    element.handleMessage({
      source: null,
      origin: "https://evil.example",
      data: null,
    });
    expect(element.dispatchEvent).not.toHaveBeenCalled();
  });
  it("forwards only known events from its own frame and clamps resize values", async () => {
    const { element, frame } = await bridge(kind, {
      src: "https://sign.example/s/id",
    });
    element.connectedCallback();
    const message = (data: any, source: any = frame.contentWindow) =>
      element.handleMessage({ data, source, origin: "https://sign.example" });
    message(null, {});
    message(null);
    message({ source: "other", type: "completed" });
    message({
      source: `signa${kind === "builder" ? "-builder" : ""}`,
      type: "unknown",
    });
    expect(element.dispatchEvent).not.toHaveBeenCalled();
    for (const type of kind === "form"
      ? ["completed", "declined", "init", "load"]
      : ["change", "save", "send", "load", "upload"]) {
      message({
        source: `signa${kind === "builder" ? "-builder" : ""}`,
        type,
        detail: { id: 42 },
      });
      expect(element.dispatchEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({ type, detail: { id: 42 }, bubbles: true }),
      );
    }
    for (const height of [10, 1000]) {
      message({
        source: `signa${kind === "builder" ? "-builder" : ""}`,
        type: "resize",
        height,
      });
      expect(frame.style.height).toBe(
        `${Math.max(height, kind === "form" ? 320 : 520)}px`,
      );
    }
    message({ source: "signa", type: "resize", height: "invalid" });
    message({ source: "signa", type: "resize", height: -1 });
  });
});

it("form appearance messages preserve iframe navigation and validate its origin", async () => {
  const { element, frame } = await bridge("form", {
    src: "/s/id",
    host: "https://sign.example",
  });
  element.connectedCallback();
  const url = frame.src;
  element.dataset.theme = "dark";
  element.attributeChangedCallback("data-theme");
  expect(frame.src).toBe(url);
  expect(frame.contentWindow.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: "appearance" }),
    "https://sign.example",
  );
  element.handleMessage({
    source: frame.contentWindow,
    origin: "https://evil.example",
    data: { source: "signa", type: "completed" },
  });
  expect(element.dispatchEvent).not.toHaveBeenCalled();
  element.handleMessage({
    source: frame.contentWindow,
    origin: "https://sign.example",
    data: { source: "signa", type: "appearance-ready" },
  });
  expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(2);
  expect(() => element.buildFrameUrl("javascript:alert(1)")).toThrow(/HTTP/);
  delete element.dataset.src;
  element.dataset.token = "/s/token";
  element.render();
  expect(frame.src).toContain("/s/token");
  delete element.dataset.host;
  expect(element.getFrameBaseUrl()).toBe(window.location.href);
});
it("builder resolves token, template JSON and host fallback safely", async () => {
  const { element } = await bridge("builder");
  expect(element.getBuilderSrc()).toBe("");
  for (const template of ["bad-json", "{}"]) {
    element.dataset.template = template;
    expect(element.getBuilderSrc()).toBe("");
  }
  element.dataset.host = "https://sign.example";
  element.dataset.template = '{"id":42}';
  expect(element.getBuilderSrc()).toContain("/templates/42/edit");
  element.dataset.token = "secret";
  expect(element.getBuilderSrc()).toContain("/templates/secret/edit");
  delete element.dataset.host;
  expect(element.getFrameBaseUrl()).toBe(window.location.href);
});
